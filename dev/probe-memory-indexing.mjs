// Copyright (c) OpenIDE. Licensed under the MIT License.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Emitter, Event } from '../vscode/out/vs/base/common/event.js';
import { URI } from '../vscode/out/vs/base/common/uri.js';
import { VSBuffer } from '../vscode/out/vs/base/common/buffer.js';
import { FileChangesEvent, FileChangeType } from '../vscode/out/vs/platform/files/common/files.js';
import { OpenideCodebaseMemoryWatcher } from '../vscode/out/vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryWatcher.js';
import { OpenideCodebaseQueryService } from '../vscode/out/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.js';

const report = { methodology: 'Fixed-behavior regression probe. Production compiled watcher and query classes with mock service boundaries. Watcher receives public file events; asserts no lost changes, IPC batch <=500 and <=8 concurrent reads. Query timings are hot-snapshot Node CPU, not renderer FPS or end-to-end IO.', watcher: [], query: [], sourceHashes: {} };
const configuration = { getValue: () => undefined, onDidChangeConfiguration: Event.None };
for (const count of [500, 501, 2000]) {
 let reads = 0, inflight = 0, maxReads = 0;
 const batches = [], received = new Set();
 const events = new Emitter();
 let finish;
 const done = new Promise(resolve => { finish = resolve; });
 const watcher = new OpenideCodebaseMemoryWatcher({
  watch: () => ({ dispose() {} }), onDidFilesChange: events.event,
  stat: async () => ({ size: 19, isDirectory: false }),
  readFile: async () => { reads++; maxReads = Math.max(maxReads, ++inflight); await Promise.resolve(); inflight--; return { value: VSBuffer.fromString('export const n = 1;') }; },
 }, { getWorkspace: () => ({ folders: [{ uri: URI.file('/fixture') }] }), onDidChangeWorkspaceFolders: Event.None }, configuration, {
  indexIncremental: async changes => {
   assert.ok(changes.length <= 500);
   batches.push(changes.length);
   changes.forEach(change => received.add(change.uri));
   if (received.size === count) { finish(); }
   return { phase: 'idle', processed: changes.length, total: changes.length };
  },
 }, { isWorkspaceTrusted: () => true, onDidChangeTrust: Event.None });
 let timer;
 try {
  events.fire(new FileChangesEvent(Array.from({ length: count }, (_, i) => ({ resource: URI.file(`/fixture/file-${i}.ts`), type: FileChangeType.UPDATED })), false));
  await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Watcher drain timed out')), 10000); })]);
  assert.equal(received.size, count); assert.equal(reads, count); assert.ok(maxReads <= 8);
  report.watcher.push({ count, reads, maxConcurrentReads: maxReads, batches, indexedUnique: received.size });
 } finally { clearTimeout(timer); watcher.dispose(); events.dispose(); }
}
function snap(count, version = 1) {
 const nodes = Array.from({ length: count }, (_, i) => ({ id: `node-${i}`, name: `retryPayment${i}`, kind: 'function', uri: `file:///fixture/service-${Math.floor(i / 20)}.ts`, degree: 0, evidence: { provider: 'regex', confidence: .5, verified: false, indexedAt: 0 }, signature: 'retryPayment(idempotencyKey: string): Payment' }));
 return { nodes, edges: [], dirtyUris: [], communities: [], version: { version, workspaceKey: 'fixture', builtAt: 0, staleCount: 0, nodeCount: count, edgeCount: 0 } };
}
for (const count of [5000, 25000, 100000]) {
 const query = new OpenideCodebaseQueryService({ onDidChange: Event.None, getSnapshot: async () => snap(count) }, configuration);
 try {
  await query.search('retry payment idempotency');
  const samples = [];
  for (let i = 0; i < 9; i++) { const start = performance.now(); const result = await query.search('retry payment idempotency'); assert.ok(result.data.length); samples.push(performance.now() - start); }
  const sorted = samples.toSorted((a, b) => a - b);
  report.query.push({ nodes: count, p50Ms: sorted[4], p95Ms: sorted[8], samples });
 } finally { query.dispose(); }
}
const changed = new Emitter();
let resolveFirst, calls = 0;
const first = new Promise(resolve => { resolveFirst = resolve; });
const service = new OpenideCodebaseQueryService({ onDidChange: changed.event, getSnapshot: () => ++calls === 1 ? first : Promise.resolve(snap(1, 2)) }, configuration);
try {
 const a = service.search('payment'), b = service.search('payment');
 assert.equal(calls, 1);
 changed.fire({ version: 2 }); resolveFirst(snap(1, 1));
 const results = await Promise.all([a, b]);
 const after = await service.search('payment');
 assert.deepEqual(results.map(result => result.indexVersion), [2, 2]); assert.equal(after.indexVersion, 2); assert.equal(calls, 2);
 report.snapshotRace = { parallelQueries: 2, initialSharedLoads: 1, remoteSnapshotCalls: calls, changeVersionDuringLoad: 2, nextSearchVersion: after.indexVersion, staleCachedAfterInvalidation: false };
} finally { service.dispose(); changed.dispose(); }
for (const relative of ['vs/workbench/contrib/openideAgent/browser/openideCodebaseMemoryWatcher', 'vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService']) {
 for (const [directory, extension] of [['src', 'ts'], ['out', 'js']]) {
  const file = `vscode/${directory}/${relative}.${extension}`;
  report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(new URL(`../${file}`, import.meta.url))).digest('hex');
 }
}
await fs.mkdir(new URL('../.build/performance-cli-investigation/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../.build/performance-cli-implementation/reproductions.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
