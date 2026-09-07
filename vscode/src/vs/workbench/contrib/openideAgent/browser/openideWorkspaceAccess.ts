/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { readableToBuffer, VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import type { IModelService } from '../../../../editor/common/services/model.js';
import { FileOperationResult, IFileContent, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import type { ITextFileService } from '../../../services/textfile/common/textfiles.js';

export interface IOpenideFileObservation {
	readonly id: string;
	readonly resource: URI;
	readonly owner: string;
	readonly text: string;
	readonly diskBytes: VSBuffer;
	readonly source: 'editor' | 'disk';
	readonly version: number | undefined;
	readonly dirty: boolean;
	readonly etag: string;
	readonly mtime: number;
}

/** Editor-visible observations with conservative, owner-scoped mutation preconditions.
 * Disk content is compared as well as metadata: equal-size external edits must invalidate a read.
 * This is optimistic validation, not an OS transaction against arbitrary external writers.
 */
export class OpenideWorkspaceAccess {
	private readonly observations = new Map<string, IOpenideFileObservation>();
	private retainedChars = 0;

	constructor(
		private readonly files: IFileService,
		private readonly models: IModelService,
		private readonly textFiles: ITextFileService,
		private readonly validate: (resource: URI, workspaceRoot?: URI, mutation?: boolean) => Promise<void>,
	) { }

	private key(resource: URI, owner: string): string { return JSON.stringify([owner, resource.toString()]); }

	private async snapshot(resource: URI, owner: string, workspaceRoot?: URI): Promise<IOpenideFileObservation> {
		await this.validate(resource, workspaceRoot);
		let disk: IFileContent | undefined;
		try { disk = await this.files.readFile(resource); }
		catch (error) {
			if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND || !this.models.getModel(resource)) { throw error; }
		}
		const model = this.models.getModel(resource);
		if (!disk && !model) { throw new Error('The file and its editor buffer are no longer available.'); }
		return {
			id: generateUuid(), resource, owner, diskBytes: disk?.value ?? VSBuffer.alloc(0),
			text: model ? model.getValue() : disk!.value.toString(), source: model ? 'editor' : 'disk',
			version: model?.getVersionId(), dirty: !disk || this.textFiles.isDirty(resource), etag: disk?.etag ?? '', mtime: disk?.mtime ?? 0,
		};
	}

	async read(resource: URI, owner: string, workspaceRoot?: URI): Promise<IOpenideFileObservation> {
		const observation = await this.snapshot(resource, owner, workspaceRoot);
		const key = this.key(resource, owner);
		const previous = this.observations.get(key);
		if (previous) { this.retainedChars -= previous.text.length + previous.diskBytes.byteLength; }
		this.observations.delete(key);
		this.observations.set(key, observation);
		this.retainedChars += observation.text.length + observation.diskBytes.byteLength;
		while (this.observations.size > 256 || this.retainedChars > 16_000_000) {
			const first = this.observations.entries().next().value;
			if (!first) { break; }
			this.observations.delete(first[0]);
			this.retainedChars -= first[1].text.length + first[1].diskBytes.byteLength;
		}
		return observation;
	}

	async requireCurrent(resource: URI, owner: string, expected?: string, workspaceRoot?: URI): Promise<IOpenideFileObservation> {
		await this.validate(resource, workspaceRoot, true);
		const observed = this.observations.get(this.key(resource, owner));
		if (!observed || (expected !== undefined && observed.id !== expected)) {
			throw new Error('Read this file with read_file before modifying it; expected_observation must belong to this run and path.');
		}
		let current = await this.snapshot(resource, owner, workspaceRoot);
		if (current.dirty) { throw new Error('The editor has unsaved changes. Save or discard them before modifying this file.'); }
		let editorBytes: VSBuffer | undefined;
		if (current.source === 'editor') {
			// A clean model can lag a filesystem notification. Compare its encoded content with disk,
			// including the owner's encoding/BOM, rather than treating the dirty flag as synchronization.
			const encoded = await this.textFiles.getEncodedReadable(resource, current.text);
			editorBytes = encoded instanceof VSBuffer ? encoded : readableToBuffer(encoded);
			current = await this.snapshot(resource, owner, workspaceRoot);
		}
		if (current.dirty) { throw new Error('The editor has unsaved changes. Save or discard them before modifying this file.'); }
		if (current.text !== observed.text || !current.diskBytes.equals(observed.diskBytes) || current.source !== observed.source || current.version !== observed.version) {
			throw new Error('The file changed since it was read. Read it again before modifying it.');
		}
		if (editorBytes && !editorBytes.equals(current.diskBytes)) {
			throw new Error('The clean editor buffer has not synchronized with disk. Wait for it to reload, then read_file again before modifying it.');
		}
		return { ...current, id: observed.id };
	}

	/** Observe a missing destination immediately before create/move; dirty untitled-backed models count as existing. */
	async requireMissing(resource: URI, workspaceRoot?: URI): Promise<void> {
		await this.validate(resource, workspaceRoot, true);
		const exists = await this.files.exists(resource);
		if (exists || this.models.getModel(resource) || this.textFiles.isDirty(resource)) {
			throw new Error('The destination already exists; read it before modifying it.');
		}
	}

	async write(resource: URI, owner: string, value: string, expected?: string, workspaceRoot?: URI, token: CancellationToken = CancellationToken.None): Promise<{ before?: string; observation: IOpenideFileObservation }> {
		await this.validate(resource, workspaceRoot, true);
		let before: IOpenideFileObservation | undefined;
		try { await this.files.stat(resource); }
		catch (error) {
			if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) { throw error; }
			if (expected !== undefined || this.observations.has(this.key(resource, owner))) { throw new Error('The observed file no longer exists. Read the workspace again before recreating it.'); }
			await this.requireMissing(resource, workspaceRoot);
			if (token.isCancellationRequested) { throw new CancellationError(); }
			await this.files.createFile(resource, VSBuffer.fromString(value), { overwrite: false });
			return { observation: await this.read(resource, owner, workspaceRoot) };
		}
		before = await this.requireCurrent(resource, owner, expected, workspaceRoot);
		if (before.text !== value) {
			// Obtain the encoded bytes before the final model/disk validation; encoding resolution may await.
			const encoded = await this.textFiles.getEncodedReadable(resource, value);
			before = await this.requireCurrent(resource, owner, before.id, workspaceRoot);
			if (token.isCancellationRequested) { throw new CancellationError(); }
			await this.files.writeFile(resource, encoded, { etag: before.etag, mtime: before.mtime });
			// Reload clean open models through their owner; never reset a buffer that became dirty.
			if (!this.textFiles.isDirty(resource) && this.textFiles.files.get(resource)) {
				await this.textFiles.files.resolve(resource, { reload: { async: false } });
			}
		}
		return { before: before.text, observation: await this.read(resource, owner, workspaceRoot) };
	}

	async remove(resource: URI, owner: string, expected?: string, workspaceRoot?: URI, token: CancellationToken = CancellationToken.None): Promise<string> {
		const before = await this.requireCurrent(resource, owner, expected, workspaceRoot);
		if (token.isCancellationRequested) { throw new CancellationError(); }
		await this.files.del(resource, { recursive: false });
		this.forget(resource, owner);
		return before.text;
	}

	async rename(from: URI, to: URI, owner: string, expected?: string, workspaceRoot?: URI, token: CancellationToken = CancellationToken.None): Promise<string> {
		await this.requireMissing(to, workspaceRoot);
		const before = await this.requireCurrent(from, owner, expected, workspaceRoot);
		if (token.isCancellationRequested) { throw new CancellationError(); }
		await this.files.move(from, to, false);
		this.forget(from, owner);
		await this.read(to, owner, workspaceRoot);
		return before.text;
	}

	private forget(resource: URI, owner: string): void {
		const key = this.key(resource, owner);
		const previous = this.observations.get(key);
		if (previous) { this.retainedChars -= previous.text.length + previous.diskBytes.byteLength; }
		this.observations.delete(key);
	}

	dispose(): void { this.observations.clear(); this.retainedChars = 0; }
}
