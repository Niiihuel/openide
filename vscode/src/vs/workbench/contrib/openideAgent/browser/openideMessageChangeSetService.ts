/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — lifecycle and safe rollback of change sets isolated by messageId.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { applyTextPatch, consolidateFileChange, contentHash, createFileChange } from '../common/openideMessageChanges.js';
import { FileChangeOperation, IFileChange, IFileEditEvent, IFileRollbackResult, IMessageChangeSet, IMessageRollbackResult } from '../common/openideAgentTypes.js';
import { resolvePathInsideWorkspace } from '../common/openideWorkspacePath.js';

interface IOpenBuilder {
	readonly messageId: string;
	readonly timestamp: number;
	readonly files: Map<string, IFileChange>;
}

interface IPreparedRollback {
	readonly change: IFileChange;
	result: IFileRollbackResult;
	readonly action?: 'write' | 'delete' | 'move';
	readonly content?: string;
	readonly validated?: ICurrentFile;
	appliedState?: ICurrentFile;
	quarantine?: ReturnType<typeof joinPath>;
}

interface ICurrentFile {
	readonly exists: boolean;
	readonly content: string;
	readonly etag?: string;
	readonly mtime?: number;
}

class RollbackRecheckConflict extends Error { }

export class OpenideMessageChangeSetService {
	private readonly builders = new Map<string, IOpenBuilder>();
	private readonly finalized = new Map<string, IMessageChangeSet>();
	private rollbackQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
	) { }

	begin(messageId: string): void {
		if (!this.builders.has(messageId)) {
			this.builders.set(messageId, { messageId, timestamp: Date.now(), files: new Map() });
		}
	}

	hasOpen(messageId: string): boolean { return this.builders.has(messageId); }

	snapshot(messageId: string): IMessageChangeSet | undefined {
		const builder = this.builders.get(messageId);
		return builder ? { messageId, timestamp: builder.timestamp, state: 'open', files: [...builder.files.values()].map(structuredCloneFileChange) } : undefined;
	}

	record(messageId: string, event: IFileEditEvent): void {
		const builder = this.builders.get(messageId);
		if (!builder) { return; }
		const next = createFileChange(event.path, event.operation, event.beforeContent, event.afterContent, event.originalPath);
		if (event.operation === 'rename' && event.originalPath) {
			const sourcePrevious = builder.files.get(event.originalPath);
			const destinationPrevious = builder.files.get(event.path);
			builder.files.delete(event.originalPath);
			builder.files.delete(event.path);
			// Si el destino tuvo historia previa (p.ej. delete B; rename A→B), conservarla como
			// a second independent operation. On rollback the rename is undone first and
			// then the original destination is restored, without mixing A/B contents.
			if (destinationPrevious) { builder.files.set(`\0destination:${event.path}`, destinationPrevious); }
			const consolidated = consolidateFileChange(sourcePrevious, next);
			if (consolidated) { builder.files.set(event.path, consolidated); }
			return;
		}
		const previous = builder.files.get(event.path);
		builder.files.delete(event.path);
		const consolidated = consolidateFileChange(previous, next);
		if (consolidated) { builder.files.set(consolidated.uri, consolidated); }
	}

	finalize(messageId: string, cancelled = false): IMessageChangeSet {
		const builder = this.builders.get(messageId);
		if (!builder) {
			return this.finalized.get(messageId) ?? { messageId, timestamp: Date.now(), state: cancelled ? 'cancelled' : 'finalized', files: [] };
		}
		this.builders.delete(messageId);
		const set: IMessageChangeSet = {
			messageId,
			timestamp: builder.timestamp,
			state: cancelled ? 'cancelled' : 'finalized',
			files: [...builder.files.values()].map(file => structuredCloneFileChange(file)),
		};
		this.finalized.set(messageId, set);
		// Idempotency only during the same emission tick; the durable session is the real owner.
		queueMicrotask(() => this.finalized.delete(messageId));
		return set;
	}

	private roots() { return this.contextService.getWorkspace().folders.map(folder => folder.uri); }
	private resolve(path: string) { return resolvePathInsideWorkspace(path, this.roots()); }

	private async read(path: string): Promise<ICurrentFile> {
		const uri = this.resolve(path);
		if (!uri) { throw new Error(`Ruta fuera del workspace: ${path}`); }
		if (!await this.fileService.exists(uri)) { return { exists: false, content: '' }; }
		try {
			const file = await this.fileService.readFile(uri, { atomic: true });
			return { exists: true, content: file.value.toString(), etag: file.etag, mtime: file.mtime };
		}
		catch (error) {
			if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) { return { exists: false, content: '' }; }
			throw error;
		}
	}

	private async prepare(change: IFileChange, assumedAbsent: ReadonlySet<string> = new Set()): Promise<IPreparedRollback> {
		const uri = this.resolve(change.uri);
		if (!uri) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Ruta fuera del workspace.' } }; }
		const current = assumedAbsent.has(change.uri) ? { exists: false, content: '' } : await this.read(change.uri);
		switch (change.operation) {
			case 'create':
				if (!current.exists) { return { change, result: { uri: change.uri, status: 'skipped', reason: 'El archivo creado ya no existe.' } }; }
				if (!change.afterHash || contentHash(current.content) !== change.afterHash) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: 'El archivo creado cambió después del mensaje; no se eliminará.' } };
				}
				return { change, action: 'delete', validated: current, result: { uri: change.uri, status: 'reverted' } };
			case 'delete':
				if (current.exists) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'La ruta eliminada volvió a existir; no se sobrescribirá.' } }; }
				if (change.beforeContent === undefined) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Falta el contenido anterior.' } }; }
				return { change, action: 'write', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
			case 'modify': {
				if (!current.exists) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'El archivo modificado ya no existe.' } }; }
				if (change.afterHash && contentHash(current.content) === change.afterHash && change.beforeContent !== undefined) {
					return { change, action: 'write', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
				}
				if (!change.reversePatch) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'No existe un parche inverso seguro.' } }; }
				const patched = applyTextPatch(current.content, change.reversePatch, change.beforeContent);
				if (patched.conflict || patched.content === undefined) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: patched.conflict ?? 'No se pudo aplicar el parche inverso.' } };
				}
				return { change, action: 'write', content: patched.content, validated: current, result: { uri: change.uri, status: 'reverted' } };
			}
			case 'rename': {
				if (!change.originalUri) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Rename sin ruta original.' } }; }
				const original = assumedAbsent.has(change.originalUri) ? { exists: false, content: '' } : await this.read(change.originalUri);
				if (original.exists || !current.exists || !change.afterHash || contentHash(current.content) !== change.afterHash) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: 'El origen o destino del movimiento cambió después del mensaje.' } };
				}
				return { change, action: 'move', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
			}
		}
	}

	rollback(changeSet: IMessageChangeSet, includeNonConflicting = false): Promise<IMessageRollbackResult> {
		let resolve!: (result: IMessageRollbackResult) => void;
		let reject!: (error: unknown) => void;
		const result = new Promise<IMessageRollbackResult>((res, rej) => { resolve = res; reject = rej; });
		this.rollbackQueue = this.rollbackQueue.then(() => this.rollbackNow(changeSet, includeNonConflicting).then(resolve, reject));
		return result;
	}

	private async rollbackNow(changeSet: IMessageChangeSet, includeNonConflicting: boolean): Promise<IMessageRollbackResult> {
		if (changeSet.state === 'unavailable') {
			return { messageId: changeSet.messageId, status: 'unavailable', files: changeSet.files.map(file => ({ uri: file.uri, status: 'conflict', reason: changeSet.unavailableReason ?? 'Checkpoint antiguo no seguro.' })) };
		}
		if (!changeSet.files.length) { return { messageId: changeSet.messageId, status: 'noop', files: [] }; }
		const prepared: IPreparedRollback[] = [];
		const assumedAbsent = new Set<string>();
		for (const change of [...changeSet.files].reverse()) {
			const item = await this.prepare(change, assumedAbsent);
			prepared.push(item);
			if (item.action === 'delete' || change.operation === 'rename') { assumedAbsent.add(change.uri); }
		}
		const conflicts = prepared.filter(item => item.result.status === 'conflict');
		if (conflicts.length && !includeNonConflicting) {
			return { messageId: changeSet.messageId, status: 'conflict', files: prepared.map(item => item.result) };
		}
		const backups = new Map<IPreparedRollback, ICurrentFile>();
		const applied: IPreparedRollback[] = [];
		try {
			for (const item of prepared) {
				if (!item.action || item.result.status !== 'reverted') { continue; }
				// Closes the TOCTOU window: recompute the same preflight immediately before writing.
				const rechecked = await this.prepare(item.change, new Set(applied.filter(done => done.action === 'move').map(done => done.change.uri)));
				if (rechecked.result.status === 'conflict' || !rechecked.action) {
					item.result = rechecked.result.status === 'conflict' ? rechecked.result : { uri: item.change.uri, status: 'skipped', reason: rechecked.result.reason };
					if (!includeNonConflicting) { throw new RollbackRecheckConflict(item.result.reason ?? 'El archivo cambió durante el rollback.'); }
					continue;
				}
				const backup = await this.read(item.change.uri);
				// Compare against the exact state validated by prepare(), not against a later read
				// that could observe a concurrent edit twice.
				const expectedCurrent = rechecked.validated ?? backup;
				if (backup.exists !== expectedCurrent.exists || backup.content !== expectedCurrent.content || (backup.etag && expectedCurrent.etag && backup.etag !== expectedCurrent.etag)) {
					item.result = { uri: item.change.uri, status: 'conflict', reason: 'El archivo cambió durante el commit del rollback.' };
					throw new RollbackRecheckConflict(item.result.reason);
				}
				backups.set(item, backup);
				const uri = this.resolve(item.change.uri)!;
				if (rechecked.action === 'delete') {
					// IFileService offers no conditional delete. A move without overwrite preserves the
					// observed content in a unique quarantine; validate afterwards and only then delete it.
					const quarantine = joinPath(dirname(uri), `.${uri.path.split('/').pop()}.openide-rollback-${generateUuid()}`);
					item.quarantine = quarantine;
					await this.fileService.move(uri, quarantine, false);
					applied.push(item);
					const moved = await this.fileService.readFile(quarantine, { atomic: true });
					if (moved.value.toString() !== backup.content) {
						item.result = { uri: item.change.uri, status: 'conflict', reason: `El archivo cambió y quedó preservado en ${quarantine.path}.` };
						throw new RollbackRecheckConflict(item.result.reason);
					}
					// Keep the quarantine and the applied item until the WHOLE batch completes. Only the
					// final commit deletes the copy; a later failure can still compensate for it.
					item.appliedState = { exists: false, content: '' };
				}
				else if (rechecked.action === 'write') {
					const output = rechecked.content ?? '';
					const stat = !backup.exists
						? await this.fileService.createFile(uri, VSBuffer.fromString(output), { overwrite: false })
						: await this.fileService.writeFile(uri, VSBuffer.fromString(output), { etag: backup.etag, mtime: backup.mtime, atomic: { postfix: '.openide-rollback' } });
					item.appliedState = { exists: true, content: output, etag: stat.etag, mtime: stat.mtime };
				}
				else {
					const original = this.resolve(item.change.originalUri!)!;
					await this.fileService.move(uri, original, false);
					// The move already changed the workspace: record it before any later write.
					applied.push(item);
					const moved = await this.fileService.readFile(original, { atomic: true });
					if (moved.value.toString() !== backup.content) {
						await this.fileService.move(original, uri, false);
						applied.pop();
						item.result = { uri: item.change.uri, status: 'conflict', reason: 'El archivo cambió durante el movimiento.' };
						throw new RollbackRecheckConflict(item.result.reason);
					}
					if (rechecked.content !== undefined) {
						const stat = await this.fileService.writeFile(original, VSBuffer.fromString(rechecked.content), { etag: moved.etag, mtime: moved.mtime, atomic: { postfix: '.openide-rollback' } });
						item.appliedState = { exists: true, content: rechecked.content, etag: stat.etag, mtime: stat.mtime };
					} else { item.appliedState = { exists: true, content: moved.value.toString(), etag: moved.etag, mtime: moved.mtime }; }
					continue;
				}
				item.appliedState ??= await this.read(item.action === 'move' && item.change.originalUri ? item.change.originalUri : item.change.uri);
				applied.push(item);
			}
		} catch (error) {
			const operationResult = error instanceof Error ? toFileOperationResult(error) : undefined;
			if (operationResult === FileOperationResult.FILE_MODIFIED_SINCE || operationResult === FileOperationResult.FILE_MOVE_CONFLICT || operationResult === FileOperationResult.FILE_NOT_FOUND) {
				const active = prepared.find(item => item.result.status === 'reverted' && !applied.includes(item));
				if (active) { active.result = { uri: active.change.uri, status: 'conflict', reason: 'El archivo cambió durante la operación condicional de rollback.' }; }
				error = new RollbackRecheckConflict('El archivo cambió durante el rollback.');
			}
			for (const item of applied.reverse()) {
				const backup = backups.get(item);
				const uri = this.resolve(item.change.uri)!;
				try {
					if (item.quarantine) {
						if (!await this.fileService.exists(uri)) { await this.fileService.move(item.quarantine, uri, false); item.quarantine = undefined; item.result = { uri: item.change.uri, status: 'conflict', reason: 'Se restauró la versión concurrente preservada; no se aplicó el rollback.' }; continue; }
						else { item.result = { uri: item.change.uri, status: 'conflict', reason: `La copia preservada permanece en ${item.quarantine.path}.` }; continue; }
					} else if (item.action === 'move' && item.change.originalUri) {
						const original = this.resolve(item.change.originalUri)!;
						const current = await this.read(item.change.originalUri);
						if (!item.appliedState || current.content !== item.appliedState.content || (current.etag && item.appliedState.etag && current.etag !== item.appliedState.etag) || (current.mtime && item.appliedState.mtime && current.mtime !== item.appliedState.mtime) || await this.fileService.exists(uri)) { item.result = { uri: item.change.uri, status: 'conflict', reason: 'No se compensó el move porque sus endpoints cambiaron.' }; continue; }
						await this.fileService.move(original, uri, false);
					} else {
						const current = await this.read(item.change.uri);
						if (!item.appliedState || current.exists !== item.appliedState.exists || current.content !== item.appliedState.content || (current.etag && item.appliedState.etag && current.etag !== item.appliedState.etag) || (current.mtime && item.appliedState.mtime && current.mtime !== item.appliedState.mtime)) { item.result = { uri: item.change.uri, status: 'conflict', reason: 'No se compensó porque el archivo volvió a cambiar.' }; continue; }
					}
					if (backup?.exists) {
						const current = await this.read(item.change.uri);
						if (!current.exists) { await this.fileService.createFile(uri, VSBuffer.fromString(backup.content), { overwrite: false }); }
						else { await this.fileService.writeFile(uri, VSBuffer.fromString(backup.content), { etag: current.etag, mtime: current.mtime, atomic: { postfix: '.openide-compensate' } }); }
					} else if (await this.fileService.exists(uri)) {
						const quarantine = joinPath(dirname(uri), `.${uri.path.split('/').pop()}.openide-compensate-${generateUuid()}`);
						await this.fileService.move(uri, quarantine, false);
						const preserved = await this.fileService.readFile(quarantine, { atomic: true });
						if (!item.appliedState || preserved.value.toString() !== item.appliedState.content || (preserved.etag && item.appliedState.etag && preserved.etag !== item.appliedState.etag)) {
							item.result = { uri: item.change.uri, status: 'conflict', reason: `La versión concurrente quedó preservada en ${quarantine.path}.` }; continue;
						}
						await this.fileService.del(quarantine);
					}
					item.result = { uri: item.change.uri, status: 'skipped', reason: 'Rollback compensado por un conflicto concurrente.' };
				} catch { item.result = { uri: item.change.uri, status: 'conflict', reason: 'La compensación no pudo completarse sin sobrescribir datos.' }; }
			}
			if (!(error instanceof RollbackRecheckConflict)) { throw error; }
			for (const item of prepared) {
				if (!applied.includes(item) && item.result.status === 'reverted') {
					item.result = { uri: item.change.uri, status: 'skipped', reason: 'Rollback atómico abortado por conflicto en otro archivo.' };
				}
			}
			const conflictResults = prepared.map(item => item.result);
			return { messageId: changeSet.messageId, status: 'conflict', files: conflictResults };
		}
		// Batch commit: the delete quarantines are only destroyed once all the others
		// operaciones terminaron sin conflicto.
		for (const item of applied) {
			if (item.quarantine) { await this.fileService.del(item.quarantine); item.quarantine = undefined; }
		}
		const results = prepared.map(item => item.result);
		const effectiveConflicts = results.filter(result => result.status === 'conflict');
		const reverted = results.some(result => result.status === 'reverted');
		return { messageId: changeSet.messageId, status: effectiveConflicts.length ? (reverted ? 'partial' : 'conflict') : (reverted ? 'reverted' : 'noop'), files: results };
	}
}

function structuredCloneFileChange(file: IFileChange): IFileChange {
	return JSON.parse(JSON.stringify(file)) as IFileChange;
}

export function fileEditEvent(path: string, operation: FileChangeOperation, beforeContent?: string, afterContent?: string, originalPath?: string): IFileEditEvent {
	return { path, operation, beforeContent, afterContent, originalPath };
}
