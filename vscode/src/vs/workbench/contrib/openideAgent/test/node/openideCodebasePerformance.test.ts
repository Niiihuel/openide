/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ICodebaseMemorySnapshotDto, DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS } from '../../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { ICodebaseIndexVersion, makeEvidence } from '../../../../../platform/openideCodebase/common/openideCodebaseMemoryTypes.js';
import { OpenideCodebaseMemoryWatcher } from '../../browser/openideCodebaseMemoryWatcher.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';
import { ICodebaseMemoryService, CodebaseMemoryService } from '../../browser/openideCodebaseMemoryService.js';
import { OpenideCodebaseQueryService } from '../../browser/openideCodebaseQueryService.js';
import { CodebaseMemoryChannel } from '../../../../../code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryChannel.js';
import { CodebaseMemoryStorage } from '../../../../../code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.js';

const configuration = { getValue: () => undefined, onDidChangeConfiguration: Event.None } as IConfigurationService;
const snapshot = (version: number): ICodebaseMemorySnapshotDto => ({ nodes: [{ id: 'payment', name: 'payment', kind: 'function', uri: 'file:///fixture/payment.ts', degree: 0, evidence: makeEvidence('regex') }], edges: [], dirtyUris: [], version: { version, workspaceKey: 'fixture', builtAt: 0, staleCount: 0, nodeCount: 1, edgeCount: 0 } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

suite('OpenIDE graph performance regressions', () => {
	test('shares query loads and never reinstalls an invalidated snapshot', async () => {
		const changed = new Emitter<ICodebaseIndexVersion>();
		const first = deferred<ICodebaseMemorySnapshotDto>();
		let calls = 0;
		const query = new OpenideCodebaseQueryService({ onDidChange: changed.event, getSnapshot: () => ++calls === 1 ? first.promise : Promise.resolve(snapshot(2)) } as ICodebaseMemoryService, configuration);
		try {
			const a = query.search('payment'); const b = query.search('payment');
			assert.strictEqual(calls, 1);
			changed.fire(snapshot(2).version); first.resolve(snapshot(1));
			assert.deepStrictEqual((await Promise.all([a, b, query.search('payment')])).map(result => result.indexVersion), [2, 2, 2]);
			assert.strictEqual(calls, 2);
		} finally { query.dispose(); changed.dispose(); }
	});

	test('retries a failed shared query load', async () => {
		let calls = 0;
		const query = new OpenideCodebaseQueryService({ onDidChange: Event.None, getSnapshot: async () => { if (++calls === 1) { throw new Error('offline'); } return snapshot(2); } } as ICodebaseMemoryService, configuration);
		try { await assert.rejects(query.search('payment'), /offline/); assert.strictEqual((await query.search('payment')).indexVersion, 2); }
		finally { query.dispose(); }
	});

	test('bounded top-k preserves deterministic ranking, substring search and limits', async () => {
		const source = snapshot(1);
		const nodes = ['xPayment', 'paymentZ', 'payment', 'paymentA', 'other'].map((name, i) => ({ ...source.nodes[0], id: String(i), uri: `file:///fixture/${i}.ts`, name }));
		const query = new OpenideCodebaseQueryService({ onDidChange: Event.None, getSnapshot: async () => ({ ...source, nodes }) } as ICodebaseMemoryService, configuration);
		try {
			assert.deepStrictEqual((await query.search('payment', { limit: 3 })).data.map(node => node.name), ['payment', 'paymentZ', 'paymentA']);
			assert.strictEqual((await query.search('aym', { limit: 10 })).data.length, 4);
			assert.deepStrictEqual((await query.search('payment', { limit: 0 })).data, []);
		} finally { query.dispose(); }
	});

	for (const count of [501, 2000]) {
		test(`drains ${count} changes without exceeding IPC or read concurrency`, async () => {
			const files = new Emitter<FileChangesEvent>();
			const done = deferred<void>(); let reads = 0; let peak = 0; let active = 0;
			const received: string[] = []; const sizes: number[] = [];
			const watcher = new OpenideCodebaseMemoryWatcher({
				watch: () => ({ dispose() { } }), onDidFilesChange: files.event,
				stat: async () => ({ size: 1, isDirectory: false }),
				readFile: async () => { reads++; peak = Math.max(peak, ++active); await Promise.resolve(); active--; return { value: VSBuffer.fromString('x') }; },
			} as unknown as IFileService, { getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService, configuration, {
				indexIncremental: async changes => { sizes.push(changes.length); received.push(...changes.map(change => change.uri)); if (received.length === count) { done.resolve(); } return { phase: 'idle', processed: changes.length, total: changes.length }; },
			} as ICodebaseMemoryService, { isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None } as IWorkspaceTrustManagementService);
			try {
				files.fire(new FileChangesEvent(Array.from({ length: count }, (_, i) => ({ resource: URI.file(`/fixture/${i}.ts`), type: FileChangeType.UPDATED })), false));
				await done.promise;
				assert.deepStrictEqual({ unique: new Set(received).size, reads, bounded: sizes.every(size => size <= 500), peak }, { unique: count, reads: count, bounded: true, peak: 8 });
			} finally { watcher.dispose(); files.dispose(); }
		});
	}

	test('preserves a newer URI revision arriving during a rejected send', async () => {
		const files = new Emitter<FileChangesEvent>(); const sent = deferred<void>();
		const completed = deferred<void>(); let attempts = 0; let content = 'old'; const bodies: string[] = [];
		const uri = URI.file('/fixture/a.ts');
		const emit = () => files.fire(new FileChangesEvent([{ resource: uri, type: FileChangeType.UPDATED }], false));
		const watcher = new OpenideCodebaseMemoryWatcher({ watch: () => ({ dispose() { } }), onDidFilesChange: files.event, stat: async () => ({ size: 3, isDirectory: false }), readFile: async () => ({ value: VSBuffer.fromString(content) }) } as unknown as IFileService,
			{ getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService, configuration,
			{ indexIncremental: async changes => { bodies.push(changes[0].content!); if (++attempts === 1) { sent.resolve(); throw new Error('retry'); } completed.resolve(); return { phase: 'idle', processed: changes.length, total: changes.length }; } } as ICodebaseMemoryService,
			{ isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None } as IWorkspaceTrustManagementService);
		try { emit(); await sent.promise; content = 'new'; emit(); await completed.promise; assert.deepStrictEqual(bodies, ['old', 'new']); }
		finally { watcher.dispose(); files.dispose(); }
	});

	test('renderer facade shares loads and rejects stale responses after invalidation', async () => {
		const changed = new Emitter<{ workspaceKey: string; version: ICodebaseIndexVersion }>();
		const first = deferred<ICodebaseMemorySnapshotDto>(); const loading = deferred<void>(); let calls = 0;
		const service = new CodebaseMemoryService({ userRoamingDataHome: URI.file('/profile') } as IEnvironmentService,
			{ codebase: { initialize: async () => 'fixture', onProgress: Event.None, onDidChange: changed.event, getSnapshot: () => { loading.resolve(); return ++calls === 1 ? first.promise : Promise.resolve(snapshot(2)); } } } as unknown as IOpenideNativeServices,
			{ getWorkspace: () => ({ folders: [] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService,
			{ isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None } as IWorkspaceTrustManagementService, configuration);
		try {
			const a = service.getSnapshot(); const b = service.getSnapshot();
			await loading.promise;
			assert.strictEqual(calls, 1);
			changed.fire({ workspaceKey: 'fixture', version: snapshot(2).version });
			await Promise.resolve(); first.resolve(snapshot(1));
			assert.deepStrictEqual((await Promise.all([a, b])).map(value => value?.version.version), [2, 2]);
			await service.getSnapshot(); assert.strictEqual(calls, 2);
		} finally { service.dispose(); changed.dispose(); }
	});

	test('oversized files are purged without reading and transient reads retry', async () => {
		const files = new Emitter<FileChangesEvent>(); const done = deferred<void>(); let failures = 0;
		const received: { uri: string; deleted?: boolean }[] = []; const readUris: string[] = [];
		const watcher = new OpenideCodebaseMemoryWatcher({ watch: () => ({ dispose() { } }), onDidFilesChange: files.event,
			stat: async (uri: URI) => ({ size: uri.path.endsWith('large.ts') ? 600 * 1024 : 1, isDirectory: false }),
			readFile: async (uri: URI) => { readUris.push(uri.path); if (failures++ === 0) { throw new Error('temporary'); } return { value: VSBuffer.fromString('x') }; },
		} as unknown as IFileService, { getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService, configuration,
			{ indexIncremental: async changes => { received.push(...changes); if (received.length === 2) { done.resolve(); } return { phase: 'idle', processed: changes.length, total: changes.length }; } } as ICodebaseMemoryService,
			{ isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None } as IWorkspaceTrustManagementService);
		try {
			files.fire(new FileChangesEvent(['large', 'small'].map(name => ({ resource: URI.file(`/fixture/${name}.ts`), type: FileChangeType.UPDATED })), false));
			await done.promise;
			assert.deepStrictEqual({ deleted: received.filter(change => change.deleted).map(change => change.uri), readUris }, { deleted: ['file:///fixture/large.ts'], readUris: ['/fixture/small.ts', '/fixture/small.ts'] });
		} finally { watcher.dispose(); files.dispose(); }
	});

	test('disposing during a read prevents an IPC write', async () => {
		const files = new Emitter<FileChangesEvent>(); const reading = deferred<void>(); const release = deferred<{ value: VSBuffer }>(); let writes = 0;
		const watcher = new OpenideCodebaseMemoryWatcher({ watch: () => ({ dispose() { } }), onDidFilesChange: files.event, stat: async () => ({ size: 1, isDirectory: false }), readFile: async () => { reading.resolve(); return release.promise; } } as unknown as IFileService,
			{ getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }), onDidChangeWorkspaceFolders: Event.None } as unknown as IWorkspaceContextService, configuration,
			{ indexIncremental: async changes => { writes++; return { phase: 'idle', processed: changes.length, total: changes.length }; } } as ICodebaseMemoryService,
			{ isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None } as IWorkspaceTrustManagementService);
		try {
			files.fire(new FileChangesEvent([{ resource: URI.file('/fixture/a.ts'), type: FileChangeType.UPDATED }], false));
			await reading.promise; watcher.dispose(); release.resolve({ value: VSBuffer.fromString('x') });
			await new Promise(resolve => setTimeout(resolve, 0)); assert.strictEqual(writes, 0);
		} finally { watcher.dispose(); files.dispose(); }
	});

	test('channel snapshots wait for prior mutations and reject oversized UTF-8 payloads', async () => {
		const channel = new CodebaseMemoryChannel({ del: async () => undefined } as unknown as IFileService);
		try {
			const key = await channel.initialize(['file:///fixture'], true, { ...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, persistIndex: false });
			const first = channel.indexIncremental(key, [{ uri: 'file:///fixture/a.ts', content: 'export function first() {}' }]);
			const second = channel.indexIncremental(key, [{ uri: 'file:///fixture/b.ts', content: 'export function second() {}' }]);
			const read = channel.getSnapshot(key);
			await Promise.all([first, second]);
			const result = await read;
			assert.deepStrictEqual(result?.nodes.filter(node => node.kind === 'function').map(node => node.name).sort(), ['first', 'second']);
			await assert.rejects(channel.indexIncremental(key, [{ uri: 'file:///fixture/a.ts', content: 'é'.repeat(300 * 1024) }]), /demasiado grande/);
		} finally { channel.dispose(); }
	});

	test('storage delta counters remain correct and exposed snapshots stay isolated', async () => {
		const storage = new CodebaseMemoryStorage({ del: async () => undefined } as unknown as IFileService, URI.file('/unused'));
		try {
			await storage.setPersist(false); await storage.load('fixture');
			await storage.writeFile('a', '1', 'typescript', { uri: 'a', nodes: snapshot(1).nodes, edges: [] });
			const previous = storage.getManifest()!;
			storage.markStale('a'); storage.markStale('a');
			assert.strictEqual(storage.getVersion()!.staleCount, 1);
			await storage.writeFile('a', '2', 'typescript', { uri: 'a', nodes: [], edges: [] });
			await storage.writeFile('b', '3', 'typescript', { uri: 'b', nodes: snapshot(1).nodes, edges: [] });
			storage.markStale('b'); await storage.removeFile('b');
			assert.deepStrictEqual({ stale: storage.getVersion()!.staleCount, nodes: storage.getVersion()!.nodeCount, oldHash: previous.files['a'].hash, oldKeys: Object.keys(previous.files) }, { stale: 0, nodes: 0, oldHash: '1', oldKeys: ['a'] });
		} finally { storage.dispose(); }
	});
});
