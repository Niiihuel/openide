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
import { applyTextPatch, contentHash } from '../common/openideMessageChanges.js';
import { IFileChange, IFileRollbackResult, IMessageChangeSet, IMessageRollbackResult } from '../common/openideAgentTypes.js';
import { resolvePathInsideWorkspace } from '../common/openideWorkspacePath.js';

import { URI } from '../../../../base/common/uri.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';

/** Production adapters supply dirty-buffer/resource checks and a main-process lease. */
export interface IOpenideRestoreSafety {
	validateResource?(resource: URI): Promise<string | undefined>;
	acquire?(resources: readonly string[]): Promise<string | undefined>;
	release?(lease: string): Promise<void>;
}

/** Reject dirty buffers and symlink traversal, including symlinked parent directories. */
export function createOpenideRestoreSafety(fileService: IFileService, workingCopyService: IWorkingCopyService, host: IOpenideAgentHostService, hasActiveWriters: () => boolean = () => false): IOpenideRestoreSafety {
	return {
		acquire: resources => host.acquireRestoreLocks(resources),
		release: lease => host.releaseRestoreLocks(lease),
		validateResource: async resource => {
			if (hasActiveWriters()) { return 'An agent may still be writing to the workspace.'; }
			if (resource.scheme !== 'file') { return 'Only local files can be restored.'; }
			if (workingCopyService.isDirty(resource)) { return 'The editor has unsaved changes.'; }
			let candidate = resource;
			for (;;) {
				try {
					const stat = await fileService.stat(candidate);
					if (stat.isSymbolicLink || (candidate.toString() === resource.toString() && !stat.isFile)) { return 'Symbolic links and non-file resources require manual review.'; }
				} catch (error) {
					if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) { return 'The resource type could not be verified.'; }
				}
				const parent = dirname(candidate);
				if (parent.toString() === candidate.toString()) { break; }
				candidate = parent;
			}
			return workingCopyService.isDirty(resource) ? 'The editor has unsaved changes.' : undefined;
		},
	};
}

// Shared by native messages and CLI snapshots in this renderer. The lease also serializes
// cooperating restores in other windows; external writers still require provider checks.
let restoreQueue: Promise<void> = Promise.resolve();

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

export class OpenideRestoreEngine {
	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly safety: IOpenideRestoreSafety = {},
	) { }

	private roots() { return this.contextService.getWorkspace().folders.map(folder => folder.uri); }
	private resolve(path: string) { return resolvePathInsideWorkspace(path, this.roots()); }

	private async read(path: string): Promise<ICurrentFile> {
		const uri = this.resolve(path);
		if (!uri) { throw new Error(`Path outside the workspace: ${path}`); }
		if (!await this.fileService.exists(uri)) { return { exists: false, content: '' }; }
		try {
			const file = await this.fileService.readFile(uri, { atomic: true });
			const content = file.value.toString();
			if (content.includes('\0') || !VSBuffer.fromString(content).equals(file.value)) { throw new RollbackRecheckConflict('Binary or non-UTF-8 files cannot be safely restored.'); }
			return { exists: true, content, etag: file.etag, mtime: file.mtime };
		}
		catch (error) {
			if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) { return { exists: false, content: '' }; }
			throw error;
		}
	}

	private async prepare(change: IFileChange, assumedAbsent: ReadonlySet<string> = new Set()): Promise<IPreparedRollback> {
		const uri = this.resolve(change.uri);
		if (!uri) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Path outside the workspace.' } }; }
		for (const path of [change.uri, ...(change.originalUri ? [change.originalUri] : [])]) {
			const resource = this.resolve(path);
			if (!resource) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Path outside the workspace.' } }; }
			const reason = await this.safety.validateResource?.(resource);
			if (reason) { return { change, result: { uri: change.uri, status: 'conflict', reason } }; }
		}
		const current = assumedAbsent.has(change.uri) ? { exists: false, content: '' } : await this.read(change.uri);
		switch (change.operation) {
			case 'create':
				if (!current.exists) { return { change, result: { uri: change.uri, status: 'skipped', reason: 'The created file no longer exists.' } }; }
				if (!change.afterHash || contentHash(current.content) !== change.afterHash) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: 'The created file changed after the message; it will not be deleted.' } };
				}
				return { change, action: 'delete', validated: current, result: { uri: change.uri, status: 'reverted' } };
			case 'delete':
				if (current.exists) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'The deleted path exists again; it will not be overwritten.' } }; }
				if (change.beforeContent === undefined) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'The previous content is missing.' } }; }
				return { change, action: 'write', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
			case 'modify': {
				if (!current.exists) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'The modified file no longer exists.' } }; }
				if (change.afterHash && contentHash(current.content) === change.afterHash && change.beforeContent !== undefined) {
					return { change, action: 'write', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
				}
				if (!change.reversePatch) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'There is no safe reverse patch.' } }; }
				const patched = applyTextPatch(current.content, change.reversePatch, change.beforeContent);
				if (patched.conflict || patched.content === undefined) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: patched.conflict ?? 'The reverse patch could not be applied.' } };
				}
				return { change, action: 'write', content: patched.content, validated: current, result: { uri: change.uri, status: 'reverted' } };
			}
			case 'rename': {
				if (!change.originalUri) { return { change, result: { uri: change.uri, status: 'conflict', reason: 'Rename without an original path.' } }; }
				const original = assumedAbsent.has(change.originalUri) ? { exists: false, content: '' } : await this.read(change.originalUri);
				if (original.exists || !current.exists || !change.afterHash || contentHash(current.content) !== change.afterHash) {
					return { change, result: { uri: change.uri, status: 'conflict', reason: 'The move source or destination changed after the message.' } };
				}
				return { change, action: 'move', content: change.beforeContent, validated: current, result: { uri: change.uri, status: 'reverted' } };
			}
		}
	}

	rollback(changeSet: IMessageChangeSet, includeNonConflicting = false): Promise<IMessageRollbackResult> {
		let resolve!: (result: IMessageRollbackResult) => void;
		let reject!: (error: unknown) => void;
		const result = new Promise<IMessageRollbackResult>((res, rej) => { resolve = res; reject = rej; });
		restoreQueue = restoreQueue.then(() => this.withLease(changeSet, includeNonConflicting).then(resolve, reject));
		return result;
	}

	private async withLease(changeSet: IMessageChangeSet, includeNonConflicting: boolean): Promise<IMessageRollbackResult> {
		if (changeSet.state === 'unavailable' || !changeSet.files.length) { return this.rollbackNow(changeSet, includeNonConflicting); }
		const paths = changeSet.files.flatMap(file => [file.uri, ...(file.originalUri ? [file.originalUri] : [])]);
		const resources = paths.map(path => this.resolve(path));
		if (resources.some(resource => !resource)) {
			return { messageId: changeSet.messageId, status: 'conflict', files: changeSet.files.map(file => ({ uri: file.uri, status: 'conflict', reason: 'Path outside the workspace.' })) };
		}
		const lease = await this.safety.acquire?.(resources.map(resource => resource!.fsPath));
		if (this.safety.acquire && !lease) {
			return { messageId: changeSet.messageId, status: 'unavailable', files: changeSet.files.map(file => ({ uri: file.uri, status: 'conflict', reason: 'Another window is restoring this resource or coordination is unavailable.' })) };
		}
		try { return await this.rollbackNow(changeSet, includeNonConflicting); }
		finally { if (lease) { await this.safety.release?.(lease); } }
	}

	private async rollbackNow(changeSet: IMessageChangeSet, includeNonConflicting: boolean): Promise<IMessageRollbackResult> {
		if (changeSet.state === 'unavailable') {
			return { messageId: changeSet.messageId, status: 'unavailable', files: changeSet.files.map(file => ({ uri: file.uri, status: 'conflict', reason: changeSet.unavailableReason ?? 'Old checkpoint, not safe to revert.' })) };
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
				// Recheck before writing; provider etags constrain the remaining external-writer race.
				const rechecked = await this.prepare(item.change, new Set(applied.filter(done => done.action === 'move').map(done => done.change.uri)));
				if (rechecked.result.status === 'conflict' || !rechecked.action) {
					item.result = rechecked.result.status === 'conflict' ? rechecked.result : { uri: item.change.uri, status: 'skipped', reason: rechecked.result.reason };
					if (!includeNonConflicting) { throw new RollbackRecheckConflict(item.result.reason ?? 'The file changed during the rollback.'); }
					continue;
				}
				const backup = await this.read(item.change.uri);
				// Compare against the exact state validated by prepare(), not against a later read
				// that could observe a concurrent edit twice.
				const expectedCurrent = rechecked.validated ?? backup;
				if (backup.exists !== expectedCurrent.exists || backup.content !== expectedCurrent.content || (backup.etag && expectedCurrent.etag && backup.etag !== expectedCurrent.etag)) {
					item.result = { uri: item.change.uri, status: 'conflict', reason: 'The file changed during the rollback commit.' };
					throw new RollbackRecheckConflict(item.result.reason);
				}
				for (const path of [item.change.uri, ...(item.change.originalUri ? [item.change.originalUri] : [])]) {
					const reason = await this.safety.validateResource?.(this.resolve(path)!);
					if (reason) { item.result = { uri: item.change.uri, status: 'conflict', reason }; throw new RollbackRecheckConflict(reason); }
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
						item.result = { uri: item.change.uri, status: 'conflict', reason: `The file changed and was preserved at ${quarantine.path}.` };
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
						item.result = { uri: item.change.uri, status: 'conflict', reason: 'The file changed during the move.' };
						throw new RollbackRecheckConflict(item.result.reason);
					}
					if (rechecked.content !== undefined) {
						const stat = await this.fileService.writeFile(original, VSBuffer.fromString(rechecked.content), { etag: moved.etag, mtime: moved.mtime, atomic: { postfix: '.openide-rollback' } });
						item.appliedState = { exists: true, content: rechecked.content, etag: stat.etag, mtime: stat.mtime };
					} else { item.appliedState = { exists: true, content: moved.value.toString(), etag: moved.etag, mtime: moved.mtime }; }
					continue;
				}
				item.appliedState ??= await this.read(item.action === 'move' && item.change.originalUri ? item.change.originalUri : item.change.uri);
				if (!applied.includes(item)) { applied.push(item); }
			}
		} catch (error) {
			const operationResult = error instanceof Error ? toFileOperationResult(error) : undefined;
			if (operationResult === FileOperationResult.FILE_MODIFIED_SINCE || operationResult === FileOperationResult.FILE_MOVE_CONFLICT || operationResult === FileOperationResult.FILE_NOT_FOUND) {
				const active = prepared.find(item => item.result.status === 'reverted' && !applied.includes(item));
				if (active) { active.result = { uri: active.change.uri, status: 'conflict', reason: 'The file changed during the conditional rollback operation.' }; }
				error = new RollbackRecheckConflict('The file changed during the rollback.');
			}
			for (const item of applied.reverse()) {
				const backup = backups.get(item);
				const uri = this.resolve(item.change.uri)!;
				try {
					if (item.quarantine) {
						if (!await this.fileService.exists(uri)) { await this.fileService.move(item.quarantine, uri, false); item.quarantine = undefined; item.result = { uri: item.change.uri, status: 'conflict', reason: 'The preserved concurrent version was restored; the rollback was not applied.' }; continue; }
						else { item.result = { uri: item.change.uri, status: 'conflict', reason: `The preserved copy remains at ${item.quarantine.path}.` }; continue; }
					} else if (item.action === 'move' && item.change.originalUri) {
						const original = this.resolve(item.change.originalUri)!;
						const current = await this.read(item.change.originalUri);
						if (!item.appliedState || current.content !== item.appliedState.content || (current.etag && item.appliedState.etag && current.etag !== item.appliedState.etag) || (current.mtime && item.appliedState.mtime && current.mtime !== item.appliedState.mtime) || await this.fileService.exists(uri)) { item.result = { uri: item.change.uri, status: 'conflict', reason: 'The move was not compensated because its endpoints changed.' }; continue; }
						await this.fileService.move(original, uri, false);
					} else {
						const current = await this.read(item.change.uri);
						if (!item.appliedState || current.exists !== item.appliedState.exists || current.content !== item.appliedState.content || (current.etag && item.appliedState.etag && current.etag !== item.appliedState.etag) || (current.mtime && item.appliedState.mtime && current.mtime !== item.appliedState.mtime)) { item.result = { uri: item.change.uri, status: 'conflict', reason: 'Not compensated because the file changed again.' }; continue; }
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
							item.result = { uri: item.change.uri, status: 'conflict', reason: `The concurrent version was preserved at ${quarantine.path}.` }; continue;
						}
						await this.fileService.del(quarantine);
					}
					item.result = { uri: item.change.uri, status: 'skipped', reason: 'Rollback compensated because of a concurrent conflict.' };
				} catch { item.result = { uri: item.change.uri, status: 'conflict', reason: 'The compensation could not complete without overwriting data.' }; }
			}
			if (!(error instanceof RollbackRecheckConflict)) { throw error; }
			for (const item of prepared) {
				if (!applied.includes(item) && item.result.status === 'reverted') {
					item.result = { uri: item.change.uri, status: 'skipped', reason: 'Atomic rollback aborted because of a conflict in another file.' };
				}
			}
			const conflictResults = prepared.map(item => item.result);
			return { messageId: changeSet.messageId, status: 'conflict', files: conflictResults };
		}
		// Batch commit: the delete quarantines are only destroyed once all the other
		// operations have finished without conflict.
		for (const item of applied) {
			if (item.quarantine) { await this.fileService.del(item.quarantine); item.quarantine = undefined; }
		}
		const results = prepared.map(item => item.result);
		const effectiveConflicts = results.filter(result => result.status === 'conflict');
		const reverted = results.some(result => result.status === 'reverted');
		return { messageId: changeSet.messageId, status: effectiveConflicts.length ? (reverted ? 'partial' : 'conflict') : (reverted ? 'reverted' : 'noop'), files: results };
	}
}
