/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'crypto';
import { BigIntStats } from 'fs';
import { FileHandle, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IOpenideMemoryCheckpointState, IOpenideMemoryDocument, IOpenideMemoryRecord, IOpenideMemoryRequest, IOpenideMemoryResponse, isMemoryRecordId, MEMORY_MAX_NOTE_BYTES, MEMORY_MAX_NOTES, MEMORY_NOTES_DIRECTORY, MEMORY_SESSIONS_DIRECTORY, memorySourceFingerprint, mutateLegacyMemory, parseMemoryRecord, serializeMemoryRecord } from '../../openideCodebase/common/openideMemoryRecord.js';
import { OpenideMem0Adapter } from './openideMem0Adapter.js';
import { validateOpenideWorkspacePath } from './openideWorkspacePaths.js';

interface CachedMemoryDocument { readonly signature: string; readonly document: IOpenideMemoryDocument }
function fileSignature(stat: BigIntStats): string { return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.mode}:${stat.nlink}`; }
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
async function readOptional(path: string): Promise<string | undefined> {
	try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
}

/** Per-connection scope and dirty-buffer registration; cooperating writers share a native queue. */
export class OpenideMemoryOwner extends Disposable {
	private static readonly queues = new Map<string, Promise<void>>();
	private static readonly projections = new Map<string, Promise<void>>();
	private readonly documentsByRoot = new Map<string, Map<string, CachedMemoryDocument>>();
	private static readonly dirty = new Map<OpenideMemoryOwner, ReadonlySet<string>>();
	private roots: readonly string[] = [];
	private generation = 0;
	constructor(private readonly userDataPath: string, private readonly syncFile: (file: FileHandle) => Promise<void> = file => file.sync()) { super(); }
	async setWorkspace(roots: readonly string[]): Promise<void> {
		const generation = ++this.generation;
		const canonical = await Promise.all(roots.map(root => realpath(root)));
		if (generation !== this.generation || this._store.isDisposed) { throw new Error('Memory workspace registration was superseded.'); }
		this.roots = canonical; this.documentsByRoot.clear(); OpenideMemoryOwner.dirty.delete(this);
	}
	async setDirty(paths: readonly string[]): Promise<void> {
		if (paths.length > 1000 || paths.some(path => typeof path !== 'string')) { throw new Error('Invalid dirty-memory registration.'); }
		OpenideMemoryOwner.dirty.set(this, new Set(await Promise.all(paths.map(async path => { try { return await realpath(path); } catch { return resolve(path); } }))));
	}
	private assertWritable(path: string): void {
		if (this._store.isDisposed) { throw new Error('Memory owner disconnected.'); }
		if ([...OpenideMemoryOwner.dirty.values()].some(paths => paths.has(resolve(path)))) { throw new Error('Memory has unsaved editor changes. Save or revert them before updating it.'); }
	}
	private async safePath(root: string, path: string): Promise<void> {
		await validateOpenideWorkspacePath({ roots: [root], path, mutation: true });
		let cursor = path;
		while (cursor !== root) {
			try { const stat = await lstat(cursor); if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) { throw new Error('Memory paths cannot be symbolic links or shared hard links.'); } }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
			const parent = dirname(cursor); if (parent === cursor) { throw new Error('Invalid memory path.'); } cursor = parent;
		}
	}
	private async atomicWrite(root: string, path: string, content: string, expected: string | undefined, checkScope: () => void): Promise<void> {
		checkScope();
		await this.safePath(root, path); this.assertWritable(path);
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		const file = await open(temporary, 'wx', 0o600);
		try { await file.writeFile(content, 'utf8'); await this.syncFile(file); } finally { await file.close(); }
		try {
			await this.safePath(root, path); this.assertWritable(path);
			if (await readOptional(path) !== expected) { throw new Error('Memory revision conflict: the file changed during the write.'); }
			// This is the commit boundary. A generation revoked during awaited IO must
			// not publish a write; after dispatching rename/link, preserve its receipt.
			checkScope();
			if (expected === undefined) {
				// Exclusive creation prevents replacing a file created outside our mutation owner.
				await link(temporary, path);
			} else { await rename(temporary, path); }
			if (process.platform !== 'win32') { const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
		} finally { await unlink(temporary).catch(() => undefined); }
	}
	/** Reconcile membership and metadata on every access; filesystem events alone can be delayed or lost. */
	private async documents(root: string): Promise<IOpenideMemoryDocument[]> {
		const generation = this.generation;
		const cached = this.documentsByRoot.get(root) ?? new Map<string, CachedMemoryDocument>();
		const next = new Map<string, CachedMemoryDocument>();
		const paths: string[] = [];
		for (const directory of [MEMORY_NOTES_DIRECTORY, MEMORY_SESSIONS_DIRECTORY]) {
			const path = join(root, directory); await this.safePath(root, path);
			let names: string[];
			try { names = await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { continue; } throw error; }
			if (names.length > 2000) { throw new Error('Memory directory exceeds its scan limit.'); }
			paths.push(...names.sort().filter(name => name.endsWith('.md')).map(name => `${directory}/${name}`));
		}
		// Directory ancestors were validated above. Bound concurrent metadata IO, and validate
		// changed paths again before reading. Include ctime so restoring mtime cannot hide edits.
		for (let offset = 0; offset < paths.length; offset += 32) {
			await Promise.all(paths.slice(offset, offset + 32).map(async path => {
				const target = join(root, path); const stat = await lstat(target, { bigint: true });
				if (stat.isSymbolicLink() || stat.nlink > 1n) { throw new Error('Memory paths cannot be symbolic links or shared hard links.'); }
				if (!stat.isFile()) { throw new Error(`Invalid memory Markdown: ${path}`); }
				if (stat.size > 128n * 1024n) { throw new Error(`Memory document is too large: ${path}`); }
				const signature = fileSignature(stat); const previous = cached.get(path);
				if (previous?.signature === signature) { next.set(path, previous); return; }
				await this.safePath(root, target);
				const text = await readFile(target, 'utf8');
				if (fileSignature(await lstat(target, { bigint: true })) !== signature) { throw new Error('Memory changed while reading. Retry the request.'); }
				const record = parseMemoryRecord(text);
				if (!record) { throw new Error(`Invalid memory Markdown: ${path}`); }
				next.set(path, { signature, document: { path, hash: hash(text), record } });
			}));
		}
		const ids = new Set<string>();
		const result = paths.map(path => {
			const document = next.get(path)!.document;
			if (ids.has(document.record.id)) { throw new Error(`Duplicate memory identity: ${document.record.id}`); }
			ids.add(document.record.id); return document;
		});
		// Publish only a complete, valid scan; never treat failures as empty memory. Callers
		// receive copies so an in-process client cannot mutate the trusted cache.
		if (generation !== this.generation || this._store.isDisposed) { throw new Error('Memory workspace changed.'); }
		this.documentsByRoot.set(root, next);
		return structuredClone(result);
	}
	private enqueue<T>(queues: Map<string, Promise<void>>, root: string, work: () => Promise<T>): Promise<T> {
		const previous = queues.get(root) ?? Promise.resolve();
		const result = previous.then(work);
		const tail = result.then(() => undefined, () => undefined); queues.set(root, tail);
		void tail.then(() => { if (queues.get(root) === tail) { queues.delete(root); } });
		return result;
	}
	async request(request: IOpenideMemoryRequest): Promise<IOpenideMemoryResponse> {
		if (!request || typeof request !== 'object' || this._store.isDisposed) { throw new Error('Invalid memory request.'); }
		const user = request.action === 'legacy' && request.legacyTarget === 'user';
		const root = user ? await realpath(this.userDataPath) : request.root ? await realpath(request.root) : this.roots[0];
		if (!root || !user && !this.roots.includes(root)) { throw new Error('Memory requires an assigned local workspace root.'); }
		const generation = this.generation;
		const checkScope = () => {
			if (generation !== this.generation || this._store.isDisposed) { throw new Error('Memory workspace changed.'); }
		};
		const canonical = <T>(work: () => Promise<T>) => this.enqueue(OpenideMemoryOwner.queues, root, async () => { checkScope(); return work(); });
		if (request.action === 'semantic') {
			return this.enqueue(OpenideMemoryOwner.projections, root, async () => {
				const documents = await canonical(() => this.documents(root));
				const response = await this.semantic(root, request, documents, checkScope);
				// Network may overlap saves/forget/manual edits. Only return IDs still matching
				// the exact active canonical version used for this projection.
				const current = await canonical(() => this.documents(root));
				const active = new Map(this.activeDocuments(current).map(document => [document.record.id, document.hash]));
				const hashes = new Map(documents.map(document => [document.record.id, document.hash]));
				return { semanticIds: response.semanticIds?.filter(id => active.has(id) && active.get(id) === hashes.get(id)) };
			});
		}
		const response = await canonical(() => this.run(root, request, checkScope));
		if (request.action === 'forget' && response.forgotten) {
			// Persisted projection manifests retain pending IDs across crashes. A slow server
			// can delay this receipt, but never prevents canonical reads or writes.
			return this.enqueue(OpenideMemoryOwner.projections, root, async () => {
				checkScope();
				return { ...response, ...await this.removeProjection(root, response.forgotten!, checkScope) };
			});
		}
		return response;
	}
	private activeDocuments(documents: readonly IOpenideMemoryDocument[]): IOpenideMemoryDocument[] {
		const superseded = new Set(documents.map(document => document.record.supersedes));
		return documents.filter(document => document.record.kind !== 'session' && document.record.status === 'active' && !superseded.has(document.record.id));
	}

	private async run(root: string, request: IOpenideMemoryRequest, checkScope: () => void): Promise<IOpenideMemoryResponse> {
		const write = (root: string, path: string, content: string, expected: string | undefined) => this.atomicWrite(root, path, content, expected, checkScope);
		if (request.action === 'legacy') {
			const profilePath = request.userMemoryPath ? relative(resolve(this.userDataPath), resolve(request.userMemoryPath)).replace(/\\/g, '/') : 'User/openideAgent/USER.md';
			const userPath = join(root, profilePath);
			if (request.legacyTarget === 'user' && !/^User\/(?:profiles\/[^/]+\/)?openideAgent\/USER\.md$/.test(profilePath)) { throw new Error('Invalid profile memory path.'); }
			const path = request.legacyTarget === 'user' ? userPath : join(root, '.openide', 'MEMORY.md');
			await this.safePath(root, path); const before = await readOptional(path);
			if (!request.legacyAction) { return { text: before ?? '' }; }
			const maxChars = request.legacyTarget === 'user' ? 1500 : Math.min(100000, Math.max(500, request.maxChars ?? 3000));
			const updated = mutateLegacyMemory(before ?? '', request.legacyAction, request.body ?? '', request.oldText ?? '', maxChars);
			await write(root, path, updated, before); return { text: updated };
		}
		const stateRoot = join(this.userDataPath, 'User', 'globalStorage', 'openide', 'memory', hash(root));
		if (request.action === 'checkpoint' || request.action === 'checkpoint-list') { return this.checkpoint(stateRoot, request, checkScope); }
		const documents = await this.documents(root);
		if (request.action === 'list') { return { documents }; }
		const existing = request.id ? documents.find(document => document.record.id === request.id) : undefined;
		if (request.action === 'get') { if (!existing) { throw new Error('Memory not found.'); } return { document: existing }; }
		if (request.action === 'forget') {
			if (!request.id || !isMemoryRecordId(request.id)) { throw new Error('Invalid memory identity.'); }
			if (!existing) { return { forgotten: request.id }; }
			if (request.expectedRevision !== existing.record.revision || request.expectedHash !== existing.hash) { throw new Error('Read the current memory before forgetting it.'); }
			const path = join(root, existing.path); await this.safePath(root, path); this.assertWritable(path);
			if (hash((await readOptional(path)) ?? '') !== existing.hash) { throw new Error('Memory changed before deletion.'); }
			// Keep historical predecessors inactive when their superseding record is forgotten.
			// Do this before deleting the head: partial failure cannot reactivate obsolete advice.
			let predecessor = existing.record.supersedes; const visited = new Set<string>();
			while (predecessor && !visited.has(predecessor)) {
				visited.add(predecessor);
				const old = documents.find(document => document.record.id === predecessor);
				if (!old) { break; }
				if (old.record.status !== 'superseded') {
					const oldPath = join(root, old.path); const before = await readOptional(oldPath);
					if (!before || hash(before) !== old.hash) { throw new Error('Historical memory changed during forgetting.'); }
					await write(root, oldPath, serializeMemoryRecord({ ...old.record, status: 'superseded', revision: old.record.revision + 1, updated: new Date().toISOString() }), before);
				}
				predecessor = old.record.supersedes;
			}
			const tombstone = join(stateRoot, 'forgotten', `${request.id}.json`);
			await write(await realpath(this.userDataPath), tombstone, JSON.stringify({ id: request.id, operation: existing.record.operation_id }), await readOptional(tombstone));
			checkScope();
			await unlink(path);
			await rm(join(stateRoot, 'history', request.id), { recursive: true, force: true });
			return { forgotten: request.id, forgottenPath: existing.path };
		}
		if (request.action !== 'save') { throw new Error('Unknown memory operation.'); }
		const topic = request.topic?.trim() ?? ''; const body = request.body?.trim() ?? ''; const operation = request.operationId ?? '';
		if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{2,159}$/.test(topic) || !body || !operation || operation.length > 256) { throw new Error('Memory needs a stable topic, nonempty body and operation ID.'); }
		if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}/.test(body)) { throw new Error('Memory cannot contain private keys or access tokens.'); }
		const replay = documents.find(document => document.record.operation_id === operation);
		if (replay) {
			if (replay.record.topic_key !== topic || replay.record.body !== body) { throw new Error('Memory operation ID was reused for different content.'); }
			return { document: replay };
		}
		const id = request.id ?? `mem_${hash(operation).slice(0, 32)}`;
		if (!isMemoryRecordId(id) || await readOptional(join(stateRoot, 'forgotten', `${id}.json`))) { throw new Error('Invalid or forgotten memory operation.'); }
		const superseded = new Set(documents.map(document => document.record.supersedes));
		const matching = documents.find(document => document.record.topic_key === topic && document.record.status === 'active' && !superseded.has(document.record.id));
		if (matching && matching.record.id !== id && matching.record.id !== request.supersedes) { throw new Error(`Memory topic exists: read ${matching.record.id} and update its current revision.`); }
		if (request.supersedes && (request.supersedes === id || !documents.some(document => document.record.id === request.supersedes))) { throw new Error('Superseded memory must name a different existing record.'); }
		if (request.id && !existing) { throw new Error('Memory to update was not found.'); }
		if (existing && (request.expectedRevision !== existing.record.revision || request.expectedHash !== existing.hash)) { throw new Error('Memory revision conflict: read the current note before updating.'); }
		const kind = request.kind ?? existing?.record.kind ?? 'discovery';
		if (existing && (kind === 'session') !== (existing.record.kind === 'session')) { throw new Error('A handoff cannot be converted into a durable note in place.'); }
		if (!['decision', 'convention', 'discovery', 'bugfix', 'preference', 'session'].includes(kind)) { throw new Error('Invalid memory kind.'); }
		const related = [...new Set(request.related ?? existing?.record.related ?? [])];
		if (related.length > 32 || related.some(value => typeof value !== 'string' || value.length > 500 || (/^[a-zA-Z]:|[|]/.test(value) || value.startsWith('/')) || value.split('#')[0].split(/[\\/]/).includes('..'))) { throw new Error('Memory links must be bounded workspace-relative references.'); }
		if (!existing && documents.filter(document => document.record.kind !== 'session').length >= Math.min(2000, Math.max(1, request.maxNotes ?? MEMORY_MAX_NOTES)) && kind !== 'session') { throw new Error('Memory note limit reached. Consolidate or forget existing notes.'); }
		if (!existing && kind === 'session' && documents.filter(document => document.record.kind === 'session').length >= 200) { throw new Error('Memory handoff limit reached. Remove old handoffs first.'); }
		const relatedHashes: string[] = [];
		for (const reference of related) {
			const relative = reference.split('#')[0];
			if (!relative.includes('.') || relative.startsWith('.openide/')) { continue; }
			const target = join(root, relative); await this.safePath(root, target);
			let fingerprint = 'missing';
			try { const stat = await lstat(target); if (stat.isFile() && stat.size <= 2 * 1024 * 1024) { fingerprint = memorySourceFingerprint(await readFile(target, 'utf8')); } }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
			relatedHashes.push(`${relative}|${fingerprint}`);
		}
		const now = new Date().toISOString();
		const record: IOpenideMemoryRecord = { schema: 1, id, topic_key: topic, kind, status: 'active', revision: (existing?.record.revision ?? 0) + 1,
			created: existing?.record.created ?? now, updated: now, source_kind: request.origin === 'external' ? 'external' : request.origin === 'subagent' ? 'subagent' : 'native',
			source_session: (request.session ?? '').slice(0, 256), source_message: (request.message ?? '').slice(0, 256), evidence_kind: 'inferred', operation_id: operation, applied_operations: [...new Set([...(existing?.record.applied_operations ?? []), ...(existing?.record.operation_id ? [existing.record.operation_id] : []), operation])].slice(-300), related, related_hashes: relatedHashes, body, supersedes: request.supersedes ?? existing?.record.supersedes };
		const text = serializeMemoryRecord(record);
		// Receipt metadata has its own bounded history; it must not silently consume the
		// configured authored-note budget. The full file remains subject to the hard IO cap.
		if (Buffer.byteLength(text) > 128 * 1024 || Buffer.byteLength(serializeMemoryRecord({ ...record, applied_operations: undefined })) > Math.min(128 * 1024, Math.max(1024, request.maxBytes ?? MEMORY_MAX_NOTE_BYTES))) { throw new Error('Memory note exceeds its byte limit. Write a concise note.'); }
		const path = existing?.path ?? `${kind === 'session' ? MEMORY_SESSIONS_DIRECTORY : MEMORY_NOTES_DIRECTORY}/${id}.md`;
		const before = await readOptional(join(root, path));
		if (existing && hash(before ?? '') !== existing.hash) { throw new Error('Memory changed before update.'); }
		if (existing && before) {
			const history = join(stateRoot, 'history', id, `${existing.record.revision}-${existing.hash}.md`);
			if (await readOptional(history) === undefined) { await write(await realpath(this.userDataPath), history, before, undefined); }
			const files = (await readdir(dirname(history))).sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]));
			for (const old of files.slice(20)) { await unlink(join(dirname(history), old)); }
		}
		await write(root, join(root, path), text, before);
		return { document: { path, hash: hash(text), record } };
	}
	private async checkpoint(stateRoot: string, request: IOpenideMemoryRequest, checkScope: () => void): Promise<IOpenideMemoryResponse> {
		if (!request.session || request.session.length > 256 || (request.checkpointId?.length ?? 0) > 256) { throw new Error('Memory checkpoint needs a bounded session and checkpoint identity.'); }
		const profile = await realpath(this.userDataPath);
		const directory = join(stateRoot, 'checkpoints', hash(request.session));
		const legacyPath = `${directory}.json`;
		const entries = async () => {
			await this.safePath(profile, directory);
			try {
				const names = await readdir(directory);
				if (names.length > 2000) { throw new Error('Memory checkpoint directory exceeds its scan limit.'); }
				const files = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
				if (files.length > 100) { throw new Error('Memory checkpoint queue exceeds its limit.'); }
				return files;
			} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error; }
		};
		const readState = async (path: string) => {
			await this.safePath(profile, path);
			try { if ((await lstat(path)).size > 40000) { throw new Error('Memory checkpoint exceeds its byte limit.'); } }
			catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
			return readOptional(path);
		};
		const decode = (text: string, name: string): { id: string; state: IOpenideMemoryCheckpointState; created?: number } => {
			const entry: { id: string; state: IOpenideMemoryCheckpointState; created?: number } = JSON.parse(text);
			if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 256 || `${hash(entry.id)}.json` !== name) { throw new Error('Invalid memory checkpoint identity.'); }
			if (entry.created !== undefined && (typeof entry.created !== 'number' || !Number.isFinite(entry.created) || entry.created < 0)) { throw new Error('Invalid memory checkpoint creation time.'); }
			this.validateCheckpoint(entry.state); return entry;
		};
		if (request.action === 'checkpoint-list') {
			const checkpoints: { id: string; state: IOpenideMemoryCheckpointState; created?: number }[] = [];
			const legacy = await readState(legacyPath);
			if (legacy) { const state: IOpenideMemoryCheckpointState = JSON.parse(legacy); this.validateCheckpoint(state); if (state.status === 'pending' || state.status === 'deferred') { checkpoints.push({ id: '', state }); } }
			for (const name of await entries()) {
				const text = await readState(join(directory, name));
				if (!text) { continue; }
				const entry = decode(text, name);
				if (entry.state.status === 'pending' || entry.state.status === 'deferred') { checkpoints.push(entry); }
			}
			checkpoints.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
			return { checkpoints: checkpoints.map(({ id, state }) => ({ id, state })) };
		}
		const path = request.checkpointId ? join(directory, `${hash(request.checkpointId)}.json`) : legacyPath;
		const before = await readState(path);
		if (!request.checkpoint) {
			const checkpoint: IOpenideMemoryCheckpointState | undefined = before ? request.checkpointId ? decode(before, `${hash(request.checkpointId)}.json`).state : JSON.parse(before) : undefined;
			if (checkpoint) { this.validateCheckpoint(checkpoint); }
			return { checkpoint };
		}
		this.validateCheckpoint(request.checkpoint);
		if (request.checkpointId && !before) {
			const names = await entries();
			if (names.length >= 100) {
				let removed = false;
				for (const name of names) {
					const text = await readState(join(directory, name)); if (!text) { continue; }
					const state = decode(text, name).state;
					if (state.status === 'saved' || state.status === 'no_durable_change') { await unlink(join(directory, name)); removed = true; break; }
				}
				if (!removed) { throw new Error('Memory checkpoint queue is full. Recover pending captures first.'); }
			}
		}
		const created = before && request.checkpointId ? decode(before, `${hash(request.checkpointId)}.json`).created ?? Date.now() : Date.now();
		const text = JSON.stringify(request.checkpointId ? { id: request.checkpointId, state: request.checkpoint, created } : request.checkpoint);
		await this.atomicWrite(profile, path, text, before, checkScope);
		return { checkpoint: request.checkpoint };
	}
	private validateCheckpoint(state: IOpenideMemoryCheckpointState): void {
		if (!state || !['pending', 'saved', 'no_durable_change', 'deferred'].includes(state.status) || typeof state.watermark !== 'string' || state.watermark.length > 128 || Buffer.byteLength(JSON.stringify(state), 'utf8') > 32768 || (state.candidates?.length ?? 0) > 3) { throw new Error('Invalid memory checkpoint.'); }
	}
	private async semantic(root: string, request: IOpenideMemoryRequest, documents: readonly IOpenideMemoryDocument[], checkScope: () => void): Promise<IOpenideMemoryResponse> {
		const stateRoot = join(this.userDataPath, 'User', 'globalStorage', 'openide', 'memory', hash(root));
		if (!request.semanticEndpoint || !request.query) { throw new Error('Mem0 endpoint and query are required.'); }
		const adapter = new OpenideMem0Adapter(request.semanticEndpoint, `openide:${hash(root)}`, process.env['OPENIDE_MEM0_API_KEY']);
		const manifestPath = join(stateRoot, 'semantic', `${hash(request.semanticEndpoint)}.json`);
		let before = await readOptional(manifestPath);
		const manifest: Record<string, string> = before ? JSON.parse(before).hashes : {};
		const persist = async () => {
			checkScope();
			const text = JSON.stringify({ endpoint: request.semanticEndpoint, hashes: manifest });
			await this.atomicWrite(await realpath(this.userDataPath), manifestPath, text, before, checkScope); before = text;
		};
		const active = this.activeDocuments(documents);
		let completed = 0;
		for (const id of Object.keys(manifest)) {
			if (!active.some(document => document.record.id === id)) { checkScope(); await adapter.remove(id); delete manifest[id]; await persist(); if (++completed >= 12) { break; } }
		}
		for (const document of active) {
			if (completed >= 12) { break; }
			if (manifest[document.record.id] !== document.hash) {
				checkScope();
				// Journal before network: a crash between remote insertion and its receipt must
				// still leave a retry/deletion target in the durable projection manifest.
				manifest[document.record.id] = `pending:${document.hash}`; await persist();
				await adapter.put(document); manifest[document.record.id] = document.hash; await persist(); completed++;
			}
		}
		await persist();
		checkScope();
		return { semanticIds: await adapter.search(request.query, active) };
	}
	private async removeProjection(root: string, id: string, checkScope: () => void): Promise<IOpenideMemoryResponse> {
		const stateRoot = join(this.userDataPath, 'User', 'globalStorage', 'openide', 'memory', hash(root));
		let pending = false;
		let manifests: string[] = [];
		try { manifests = await readdir(join(stateRoot, 'semantic')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
		for (const name of manifests.filter(name => name.endsWith('.json'))) {
			try {
				const path = join(stateRoot, 'semantic', name); const before = await readOptional(path);
				if (!before) { continue; }
				const mirror = JSON.parse(before) as { endpoint: string; hashes: Record<string, string> };
				checkScope();
				await new OpenideMem0Adapter(mirror.endpoint, `openide:${hash(root)}`, process.env['OPENIDE_MEM0_API_KEY']).remove(id);
				delete mirror.hashes[id]; await this.atomicWrite(await realpath(this.userDataPath), path, JSON.stringify(mirror), before, checkScope);
			} catch { pending = true; }
		}
		return { forgotten: id, projectionWarning: pending ? 'Markdown removed. Mem0 deletion is pending; canonical retrieval already excludes the record.' : undefined };
	}
	override dispose(): void { this.generation++; this.documentsByRoot.clear(); OpenideMemoryOwner.dirty.delete(this); super.dispose(); }
}
