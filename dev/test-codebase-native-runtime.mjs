// Copyright (c) OpenIDE. Licensed under the MIT License.
// Exercise the production bridge and resident workspace lifecycle over a real native process.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { NativeCodebase } from '../vscode/out/vs/platform/openideCodebase/node/openideNativeCodebase.js';
import { NativeGraphRuntime } from '../vscode/out/vs/platform/openideCodebase/node/openideNativeGraph.js';
import { CancellationTokenSource } from '../vscode/out/vs/base/common/cancellation.js';

const binary = fileURLToPath(new URL(`../vscode/native/bin/openide-codebase${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
class RecordedNative extends NativeCodebase {
	calls = [];
	resetAfterUpload = false;
	async call(method, params, token) {
		this.calls.push({ method, params });
		const result = await super.call(method, params, token);
		if (this.resetAfterUpload && method === 'graphUpdate' && params.files?.length) {
			this.resetAfterUpload = false;
			this.reset();
		}
		return result;
	}
}
const native = new RecordedNative(binary), runtime = new NativeGraphRuntime(native);
const evidence = { provider: 'regex', confidence: 0.45, verified: false, indexedAt: 1 };
const node = name => ({ id: name, kind: 'file', name, uri: `file:///workspace/${name}.ts`, degree: 0, evidence });
const alpha = node('alpha'), beta = node('beta'), gamma = node('gamma');
const moduleNode = { id: 'import-beta', kind: 'module', name: './beta', qualifiedName: './beta', uri: beta.uri, degree: 0, evidence };
const alphaPayload = { nodes: [alpha, moduleNode], edges: [{ source: alpha.id, target: moduleNode.id, type: 'IMPORTS', evidence }] };
const betaPayload = { nodes: [beta], edges: [] };
let files = new Map([[alpha.uri, alphaPayload], [beta.uri, betaPayload]]);
const finalize = () => runtime.finalize([...files.keys()], files);
const uploadedUris = () => native.calls.filter(call => call.method === 'graphUpdate').flatMap(call => call.params.files.map(file => file.uri));
const makeSnapshot = (version, nodes, dirtyUris = []) => ({ version: { version, workspaceKey: 'fixture', builtAt: version, staleCount: dirtyUris.length, nodeCount: nodes.length, edgeCount: 0 }, nodes, edges: [], communities: [], dirtyUris });
const query = snapshot => runtime.querySnapshot(snapshot, 'search', { arguments: ['alpha', {}] }, true);
try {
	const initial = await finalize();
	assert.deepEqual(initial.aliases, { 'import-beta': 'beta' });
	assert.deepEqual(uploadedUris(), [alpha.uri, beta.uri]);
	native.calls = [];
	assert.deepEqual(await finalize(), initial);
	assert.deepEqual(uploadedUris(), [], 'unchanged payloads stay resident');

	const changedAlpha = { ...alphaPayload, nodes: [alpha, { ...moduleNode, qualifiedName: './gamma' }] };
	files = new Map([[alpha.uri, changedAlpha], [beta.uri, betaPayload], [gamma.uri, { nodes: [gamma], edges: [] }]]);
	native.calls = [];
	assert.deepEqual((await finalize()).aliases, { 'import-beta': 'gamma' });
	assert.deepEqual(uploadedUris(), [alpha.uri, gamma.uri], 'only changed and new payloads cross stdio');
	files.delete(gamma.uri);
	native.calls = [];
	assert.deepEqual((await finalize()).aliases, {});
	assert.ok(native.calls.some(call => call.method === 'graphUpdate' && call.params.removed.includes(gamma.uri)));
	assert.deepEqual(uploadedUris(), []);

	native.reset();
	native.calls = [];
	assert.ok(await finalize());
	assert.deepEqual(uploadedUris(), [...files.keys()], 'process restart replays the current generation');
	files.set(alpha.uri, alphaPayload);
	native.resetAfterUpload = true;
	assert.equal(await finalize(), undefined, 'a mid-upload restart cannot publish an incomplete native graph');
	assert.deepEqual((await finalize()).aliases, initial.aliases, 'next operation replays after interrupted upload');

	const snapshot = makeSnapshot(8, [alpha, beta]);
	native.calls = [];
	const result = await query(snapshot);
	assert.equal(result.indexVersion, 8);
	assert.equal(result.isStale, false);
	assert.deepEqual(result.data.map(node => node.id), ['alpha']);
	assert.equal(native.calls.filter(call => call.method === 'queryReset').length, 1);
	native.calls = [];
	assert.deepEqual(await query(snapshot), result);
	assert.deepEqual(native.calls.map(call => call.method), ['queryRun'], 'repeated queries reuse the resident snapshot');
	native.reset();
	native.calls = [];
	assert.deepEqual(await query(snapshot), result);
	assert.equal(native.calls.filter(call => call.method === 'queryReset').length, 1, 'query snapshot replays after restart');
	const stale = makeSnapshot(9, [alpha, beta], [alpha.uri]);
	const staleResult = await query(stale);
	assert.equal(staleResult.indexVersion, 9);
	assert.equal(staleResult.isStale, true);

	const cancellation = new CancellationTokenSource(); cancellation.cancel();
	await assert.rejects(runtime.finalize([...files.keys()], files, cancellation.token), /cancel/i);
	await assert.rejects(runtime.querySnapshot(stale, 'search', { arguments: ['alpha', {}] }, true, cancellation.token), /cancel/i);
	cancellation.dispose();
	assert.deepEqual((await finalize()).aliases, initial.aliases);
	assert.equal((await query(stale)).indexVersion, 9);
	runtime.reset();
	native.calls = [];
	assert.ok(await finalize());
	assert.deepEqual(uploadedUris(), [...files.keys()], 'workspace reset clears resident generation references');

	const missing = new NativeCodebase(binary + '-missing'), missingRuntime = new NativeGraphRuntime(missing);
	try {
		assert.equal(await missingRuntime.finalize([...files.keys()], files), undefined);
		assert.equal(await missingRuntime.querySnapshot(stale, 'search', { arguments: ['alpha', {}] }, true), undefined);
		assert.ok(missing.getMetrics().lastFailure);
	} finally { missingRuntime.reset(); missing.dispose(); }
	console.log('PASS: resident graph deltas, removals, restart replay, mid-upload interruption, cached queries, numeric version/freshness, cancellation and missing-binary fallback.');
} finally { runtime.reset(); native.dispose(); }
