// Copyright (c) OpenIDE. Licensed under the MIT License.
// Differential queries against the production common TypeScript fallback. Uses the real
// resident Rust process; every graph is uploaded once and all subsequent queries send arguments.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Event, Emitter } from '../vscode/out/vs/base/common/event.js';
import { CodebaseQueryEngine, validateCodebaseQueryRequest, executeCodebaseQuery } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseQueryEngine.js';
import { OpenideCodebaseQueryService } from '../vscode/out/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'vscode/native/bin', `openide-codebase${process.platform === 'win32' ? '.exe' : ''}`);
const evidence = (provider = 'regex', confidence = 0.45) => ({ provider, confidence, verified: provider === 'language-server', indexedAt: 1 });
const nodes = [];
const edges = [];
const addNode = (id, name = id, extra = {}) => nodes.push({ id, name, kind: 'function', uri: `file:///fixture/${id}.ts`, degree: 0, evidence: evidence(), ...extra });
const addEdge = (source, target, type = 'CALLS', provider = 'regex', confidence = 0.45) => edges.push({ id: `${source}:${target}:${type}:${edges.length}`, source, target, type, evidence: evidence(provider, confidence) });
for (const [id, name] of [['a', 'payment'], ['b', 'paymentHandler'], ['c', 'handler'], ['d', 'PaymentGateway'], ['e', 'paymentTests'], ['hub', 'utilities'], ['isolated', 'unconnected'], ['name-1', 'payment'], ['name_1', 'payment'], ['Name1', 'payment'], ['name1', 'payment'], ['é', 'payment'], ['Á', 'payment'], ['astral', '𐐀𐐁𐐂'], ['greek', 'ΜΈΣΟΣ']]) addNode(id, name);
addNode('doc', 'Design', { kind: 'note', documentation: 'QuasarRecovery payment integration', evidence: evidence('authored', 1), metadata: { id: 'note-current', supersedes: 'note-old' } });
addNode('old-note', 'OldQuasarRecovery', { kind: 'note', metadata: { id: 'note-old' } });
addNode('superseded-note', 'SupersededQuasarRecovery', { kind: 'note', metadata: { id: 'note-other', status: 'superseded' } });
addNode('signature-only', 'short', { signature: 'QuasarRecoveryContext' });
addNode('qualified-only', 'entity', { qualifiedName: 'payment QuasarRecovery', language: 'typescript' });
addNode('path-only', 'other', { uri: 'file:///fixture/payment/index.py', language: 'python', kind: 'file' });
addEdge('a', 'b', 'CALLS', 'language-server', 0.95);
addEdge('b', 'c', 'CALLS', 'regex', 0.4);
addEdge('d', 'b', 'CALLED_BY', 'language-server', 0.9);
addEdge('e', 'a', 'TESTS', 'regex', 0.7);
addEdge('c', 'd', 'IMPORTS', 'language-server', 0.85);
addEdge('doc', 'a', 'REFERENCES', 'authored', 1);
addEdge('old-note', 'a', 'REFERENCES');
addEdge('a', 'hub', 'CALLS');
addEdge('missing', 'a', 'CALLS');
addEdge('a', 'a', 'CALLS');
for (let i = 0; i < 110; i++) { addNode(`leaf-${i}`, `paymentLeaf${i}`); addEdge('hub', `leaf-${i}`, 'CALLS'); }
let seed = 19;
const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
for (let i = 0; i < 170; i++) addNode(`random-${i}`, `${['payment', 'gateway', 'cache', 'camelCase', 'HttpRequest'][i % 5]}${i}`, { degree: i % 31, language: i % 2 ? 'typescript' : 'python', kind: i % 3 ? 'function' : 'class', documentation: i % 7 ? '' : 'QuasarRecovery gateway payment', evidence: evidence(i % 2 ? 'regex' : 'language-server', i % 2 ? 0.45 : 0.9) });
for (let i = 0; i < 350; i++) addEdge(`random-${random(170)}`, `random-${random(170)}`, ['CALLS', 'CALLED_BY', 'IMPORTS', 'TESTS', 'TESTED_BY'][random(5)], i % 3 ? 'regex' : 'language-server', i % 3 ? 0.4 : 0.95);
const snapshot = { nodes, edges, dirtyUris: ['file:///fixture/a.ts'], version: { version: 17, workspaceKey: 'fixture', builtAt: 0, staleCount: 1, nodeCount: nodes.length, edgeCount: edges.length }, communities: [{ id: 'module', label: 'Payments', members: ['file:///fixture/a.ts', 'file:///fixture/b.ts'] }] };
snapshot.collationIds = nodes.map(node => node.id).sort((a, b) => a.localeCompare(b));
const queries = [];
const q = (method, ...args) => queries.push({ method, arguments: args });
for (const text of ['payment', 'ayment', 'payment handler', 'payment gateway QuasarRecovery', 'quiero conocer los payment gateways', 'findHTTP camelCase', 'QuasarRecovery', '𐐀𐐁𐐂', 'ΜΈΣΟΣ', 'xxx', '', 'the and como']) {
 q('search', text); q('pickSeeds', text); q('pickSeeds', text, 1); q('pickSeeds', text, 0);
 for (const options of [{ limit: 0 }, { limit: 1 }, { limit: 3.8 }, { kinds: ['CLASS'], languages: ['PYTHON'], limit: 10 }, { pathPrefix: 'FIXTURE/A', limit: 50 }]) q('search', text, options);
}
for (const target of ['a', 'PAYMENT', 'hub', 'doc', 'old-note', 'missing', ...Array.from({length: 8}, (_, i) => `random-${i}`)]) {
 for (const direction of ['both', 'incoming', 'outgoing']) { q('explore', target, direction, undefined, 3); q('explore', target, direction, ['CALLS', 'CALLED_BY'], 4, 7); }
 q('explore', target, 'both', [], 0, 0);
 q('callers', target, true, 5); q('callees', target, true, 5);
 q('impact', [target]); q('impact', [target, 'a'], false, false, 2);
 q('relatedTests', [target], 3); q('relatedTests', [target], -1);
 q('path', target, 'd'); q('path', target, target); q('path', target, 'isolated', ['CALLS'], 6);
}
q('communityLabel', 'file:///fixture/a.ts'); q('communityLabel', 'missing');
q('search', Array.from({length: 50}, (_, i) => `payment${i}`).join(' '));

let processChild;
let sequence = 0;
const pending = new Map();
const report = { nodes: nodes.length, edges: edges.length, queriesPerMode: queries.length, modes: [], facade: [] };
function rpc(method, params) {
 return new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native query timed out: ${method}`)); }, 30_000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  processChild.stdin.write(`${JSON.stringify({version: 1, id, method, params})}\n`);
 });
}
try {
  processChild = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: processChild.stdout }).on('line', line => {
   let value; try { value = JSON.parse(line); } catch { for (const request of pending.values()) request.reject(new Error('Invalid native JSON')); pending.clear(); return; }
   const request = pending.get(value.id); if (!request) return;
   pending.delete(value.id); if (value.error) request.reject(new Error(value.error)); else request.resolve(value.result);
  });
  processChild.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  processChild.on('exit', code => { for (const request of pending.values()) request.reject(new Error(`Native query exited: ${code}`)); pending.clear(); });
 for (const includeHeuristic of [true, false]) for (const maxTraversalDepth of [1, 3, 6, 2.5]) {
  const configuration = { onDidChangeConfiguration: Event.None, getValue: key => key === 'openide.memory.showHeuristicRelations' ? includeHeuristic : maxTraversalDepth };
  const engine = new CodebaseQueryEngine({ onDidChange: Event.None, getSnapshot: async () => snapshot }, configuration);
  const requests = queries.map(query => ({ ...query, includeHeuristic, maxTraversalDepth }));
  let results;
  const start = performance.now();
   const version = `${includeHeuristic}:${maxTraversalDepth}`;
   await rpc('queryReset', { version, indexVersion: snapshot.version.version, includeHeuristic });
   await rpc('queryAppend', { version, nodes, edges, communities: snapshot.communities, dirtyUris: snapshot.dirtyUris, collationIds: snapshot.collationIds });
   results = [];
   for (const request of requests) results.push(await rpc('queryRun', { version, method: request.method, args: { arguments: request.arguments, maxTraversalDepth } }));
  const nativeMs = performance.now() - start;
  const tsStart = performance.now();
  try {
   for (let i = 0; i < requests.length; i++) {
    const expected = await executeCodebaseQuery(engine, requests[i]);
    assert.deepEqual(results[i], expected ?? null, JSON.stringify({includeHeuristic,maxTraversalDepth,request: requests[i]}));
   }
  } finally { engine.dispose(); }
  report.modes.push({ includeHeuristic, maxTraversalDepth, queries: requests.length, nativeMs, tsMs: performance.now()-tsStart });
 }
 // Ensure the real renderer facade calls the remote path without downloading the graph.
 let requests = 0;
 const changed = new Emitter();
 const remoteResult = { data: [nodes[0]], indexVersion: 17, isStale: false, providers: ['regex'], confidence: 0.45 };
 const facade = new OpenideCodebaseQueryService({ onDidChange: Event.None, getSnapshot: async () => { throw new Error('Renderer fetched full graph'); }, query: async request => { requests++; assert.equal(request.includeHeuristic, true); return remoteResult; } }, { onDidChangeConfiguration: changed.event, getValue: () => undefined });
 assert.deepEqual(await facade.search('payment'), remoteResult); assert.equal(requests, 1); facade.dispose(); changed.dispose();
 await assert.rejects(facade.search('payment'), /cancel/i);
 report.facade.push('Remote query path avoids snapshots; disposal cancels queries');
 const configurationChanged = new Emitter();
 let includeHeuristic = true;
 let release;
 let started;
 const firstStarted = new Promise(resolve => started = resolve);
 const calls = [];
 const racing = new OpenideCodebaseQueryService({ onDidChange: Event.None, getSnapshot: async () => { throw new Error('Renderer fetched full graph'); }, query: async request => { calls.push(request.includeHeuristic); if (calls.length === 1) { started(); return new Promise(resolve => release = resolve); } return { ...remoteResult, indexVersion: 18 }; } }, { onDidChangeConfiguration: configurationChanged.event, getValue: key => key === 'openide.memory.showHeuristicRelations' ? includeHeuristic : 3 });
 const waiting = racing.search('payment');
 await firstStarted;
 includeHeuristic = false;
 configurationChanged.fire({ affectsConfiguration: key => key === 'openide.memory.showHeuristicRelations' });
 release(remoteResult);
 assert.equal((await waiting).indexVersion, 18);
 assert.deepEqual(calls, [true, false]);
 racing.dispose(); configurationChanged.dispose();
 report.facade.push('Configuration changes retry the in-flight query instead of returning filtered stale results');
 let queryStarted;
 const queryActive = new Promise(resolve => queryStarted = resolve);
 const cancelling = new OpenideCodebaseQueryService({ onDidChange: Event.None, query: async (_request, token) => { queryStarted(); return new Promise((_resolve, reject) => token.onCancellationRequested(() => reject(new Error('Cancelled in transport')))); } }, { onDidChangeConfiguration: Event.None, getValue: () => undefined });
 const active = cancelling.search('payment');
 await queryActive; cancelling.dispose();
 await assert.rejects(active, /cancel/i);
 report.facade.push('Disposing forwards cancellation to active remote work');

 for (const invalid of [{}, { method: 'execute', arguments: [], includeHeuristic:true,maxTraversalDepth:3 }, { method:'search', arguments:[{}],includeHeuristic:true,maxTraversalDepth:3 }, { method:'explore', arguments:['a','sideways'],includeHeuristic:true,maxTraversalDepth:3 }]) assert.throws(() => validateCodebaseQueryRequest(invalid));
 await mkdir(path.join(root, '.build/codebase-native'), { recursive: true });
 await writeFile(path.join(root, '.build/codebase-native/query-results.json'), JSON.stringify(report,null,2));
 console.log(`PASS: ${queries.length * report.modes.length} differential queries, Unicode/ranking/filter/hub/evidence/notes/depth parity; renderer remote path and cancellation.`);
 console.log(JSON.stringify(report.modes));
} finally {
 if (processChild && processChild.exitCode === null) { processChild.stdin.end(); const exit = once(processChild, 'exit'); const timer = setTimeout(() => processChild.kill(), 1000); await exit; clearTimeout(timer); }
}
