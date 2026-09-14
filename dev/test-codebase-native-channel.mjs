// Copyright (c) OpenIDE. Licensed under the MIT License.
// Exercise the authenticated production channel, canonical graph and resident native queries.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FileService } from '../vscode/out/vs/platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../vscode/out/vs/platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../vscode/out/vs/platform/log/common/log.js';
import { CodebaseMemoryServerChannel } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryServerChannel.js';
import { DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { executeCodebaseSnapshotQuery } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseQueryEngine.js';
import { VSBuffer } from '../vscode/out/vs/base/common/buffer.js';
import { URI } from '../vscode/out/vs/base/common/uri.js';
import { CancellationTokenSource } from '../vscode/out/vs/base/common/cancellation.js';
globalThis._VSCODE_FILE_ROOT = fileURLToPath(new URL('../vscode/out/', import.meta.url));
const fs = new FileService(new NullLogService()), provider = new InMemoryFileSystemProvider();
const registration = fs.registerProvider('file', provider), server = new CodebaseMemoryServerChannel(fs);
const folder = URI.file('/native-channel'), other = URI.file('/native-other');
const options = { ...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, persistIndex: false };
const request = (method, args) => ({ method, arguments: args, includeHeuristic: true, maxTraversalDepth: 3 });
try {
 await fs.createFolder(folder); await fs.createFolder(other);
 const a = URI.joinPath(folder, 'alpha.ts'), b = URI.joinPath(folder, 'beta.ts');
 await fs.writeFile(a, VSBuffer.fromString('export function alpha() { return 1; }'));
 await fs.writeFile(b, VSBuffer.fromString('import { alpha } from "./alpha";\nexport function beta() { return alpha(); }'));
 await fs.writeFile(URI.joinPath(other, 'private.ts'), VSBuffer.fromString('export const otherWorkspace = 1;'));
 const key = await server.call('window-a', 'initialize', [[folder.toString()], true, options]);
 const otherKey = await server.call('window-b', 'initialize', [[other.toString()], true, options]);
 await server.call('window-a', 'rebuildFull', [key]); await server.call('window-b', 'rebuildFull', [otherKey]);
 const runtime = server.service.runtimes.get(key);
 assert.equal(runtime.indexer.getMetrics().fallbackBatches, 0);
 const calls = [], call = runtime.indexer.native.call.bind(runtime.indexer.native);
 runtime.indexer.native.call = async (...args) => { calls.push(args[0]); return call(...args); };
 const search = request('search', ['alpha']);
 const snapshot = await server.call('window-a', 'getSnapshot', [key]);
 assert.ok(snapshot.edges.some(edge => edge.type === 'IMPORTS' && edge.target.includes('alpha.ts::file')));
 const expected = await executeCodebaseSnapshotQuery(snapshot, search);
 assert.deepEqual(await server.call('window-a', 'query', [key, search]), expected);
 const initialUploads = calls.filter(x => x === 'queryAppend').length;
 assert.ok(initialUploads > 0);
 for (let i = 0; i < 5; i++) { assert.deepEqual(await server.call('window-a', 'query', [key, search]), expected); }
 assert.equal(calls.filter(x => x === 'queryAppend').length, initialUploads, 'repeated queries reuse the resident graph');
 assert.equal(runtime.indexer.native.getMetrics().lastFailure, undefined);
 await assert.rejects(server.call('window-b', 'query', [key, search]), /autorizada/);
 await assert.rejects(server.call('window-a', 'query', [key, { ...search, method: 'eval' }]), /Invalid/);
 await server.call('window-a', 'indexIncremental', [key, [{ uri: a.toString(), content: 'export function renamedAlpha() { return 2; }' }]]);
 const next = await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]);
 assert.ok(next.data.some(node => node.name === 'renamedAlpha'));
 assert.ok(next.indexVersion > expected.indexVersion);
 assert.ok(calls.filter(x => x === 'queryAppend').length > initialUploads);
 // Losing the native process must replay state, not silently query an empty or previous graph.
 runtime.indexer.native.reset();
 assert.deepEqual(await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]), next);
 // Missing/unsupported native builds use one cached shared-process TS engine.
 const nativeCall = runtime.indexer.native.call;
 runtime.indexer.native.call = async () => undefined;
 assert.deepEqual(await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]), next);
 const fallback = runtime.fallbackQuery.engine;
 assert.deepEqual(await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]), next);
 assert.equal(runtime.fallbackQuery.engine, fallback);
 runtime.indexer.native.call = nativeCall;
 assert.deepEqual(await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]), next);
 assert.equal(runtime.fallbackQuery, undefined, 'release fallback graph when native recovers');
 const cts = new CancellationTokenSource(); cts.cancel();
 await assert.rejects(server.call('window-a', 'query', [key, search], cts.token), /Cancel/); cts.dispose();
 // Trust revocation cancels a pending native operation as well as clearing the process.
 let release, entered;
 const gate = new Promise(resolve => { release = resolve; });
 const started = new Promise(resolve => { entered = resolve; });
 const beforeTrustCall = runtime.indexer.native.call;
 runtime.indexer.native.call = async (...args) => { if (args[0] === 'queryRun') { entered(); await gate; } return beforeTrustCall(...args); };
 const pending = server.call('window-a', 'query', [key, search]);
 const rejected = assert.rejects(pending, /Cancel/);
 await started;
 await server.call('window-a', 'setTrusted', [key, false]);
 release(); await rejected;
 runtime.indexer.native.call = beforeTrustCall;
 assert.equal(runtime.indexer.native.child, undefined);
 await assert.rejects(server.call('window-a', 'query', [key, search]), /autorizada/);
 await server.call('window-a', 'setTrusted', [key, true]);
 assert.deepEqual(await server.call('window-a', 'query', [key, request('search', ['renamedAlpha'])]), next);
 await server.call('window-a', 'clear', [key]);
 assert.deepEqual((await server.call('window-a', 'query', [key, search])).data, []);
 assert.ok((await server.call('window-b', 'query', [otherKey, request('search', ['otherWorkspace'])])).data.length, 'clearing one workspace preserves the other');
 console.log('PASS: authenticated channel native queries, canonical aliases, cached uploads, incremental versioning, restart, cancellation, trust revocation, clear and workspace isolation.');
} finally { server.dispose(); registration.dispose(); provider.dispose(); fs.dispose(); }
