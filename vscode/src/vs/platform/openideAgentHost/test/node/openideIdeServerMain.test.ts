/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { NullLogService } from '../../../log/common/log.js';
import { OpenideIdeServerMain } from '../../electron-main/openideIdeServerMain.js';
import { IIdeDiscoveryStatus, IIdeServerInfo } from '../../common/openideIdeServer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('OpenIDE IDE server ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const options = { ideName: 'test', workspaceFolders: [tmpdir()], lockRootDir: tmpdir() };
	function server() { return store.add(new OpenideIdeServerMain(new NullLogService())); }
	async function call(info: IIdeServerInfo, method = 'tools/call') {
		const response = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
			method: 'POST', headers: { Authorization: `Bearer ${info.authToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'getWorkspaceFolders', arguments: {} } }),
		});
		return response.json();
	}

	test('same workspace has separate endpoints and dispatch, and closing A keeps B alive', async () => {
		const a = server(); const b = server();
		const [ai, bi] = await Promise.all([a.start(options), b.start(options)]);
		assert.notStrictEqual(ai.port, bi.port);
		assert.notStrictEqual(ai.authToken, bi.authToken);
		const received: string[] = [];
		store.add(a.onDidRequestTool(request => { received.push('A'); a.respondTool(request.requestId, { content: [{ type: 'text', text: 'A' }] }); }));
		store.add(b.onDidRequestTool(request => { received.push('B'); b.respondTool(request.requestId, { content: [{ type: 'text', text: 'B' }] }); }));
		await call(bi); a.dispose(); await call(bi);
		assert.deepStrictEqual(received, ['B', 'B']);
	});

	test('concurrent starts by one owner create one endpoint', async () => {
		const owner = server();
		const [a, b] = await Promise.all([owner.start(options), owner.start(options)]);
		assert.strictEqual(a, b);
	});

	test('disconnect during startup cannot leave a published listener', async () => {
		const owner = server(); const start = owner.start(options); owner.stop();
		await assert.rejects(start, /disconnected/);
		assert.strictEqual(owner.serverInfo, undefined);
	});

	test('owner config paths do not overwrite another window with the same session id', () => {
		const a = server(); const b = server();
		const ap = a.writeSessionMcpConfig('same-session', 'A');
		const bp = b.writeSessionMcpConfig('same-session', 'B');
		assert.notStrictEqual(ap, bp);
		a.stop();
		assert.strictEqual(readFileSync(bp, 'utf8'), 'B');
	});

	test('HTTP parked calls settle on stop and foreign request IDs cannot answer them', async () => {
		const a = server(); const b = server(); const ai = await a.start(options);
		const received = new Promise<void>(resolve => store.add(a.onDidRequestTool(request => {
			b.respondTool(request.requestId, { content: [{ type: 'text', text: 'foreign' }] });
			resolve();
		})));
		const pending = call(ai); await received; a.stop();
		const result = await pending;
		assert.strictEqual(result.error?.data, 'IDE server stopping');
	});

	test('restart revokes previous authentication', async () => {
		const owner = server(); const old = await owner.start(options); owner.stop();
		const current = await owner.start(options);
		assert.notStrictEqual(old.authToken, current.authToken);
		const response = await fetch(`http://127.0.0.1:${current.port}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${old.authToken}` } });
		assert.strictEqual(response.status, 401);
	});
	test('aborting one HTTP call cancels its renderer work and preserves another call with the same RPC id', async () => {
		const owner = server(); const info = await owner.start(options);
		const requested: string[] = [];
		let firstReady!: () => void;
		const ready = new Promise<void>(resolve => { firstReady = resolve; });
		store.add(owner.onDidRequestTool(request => { requested.push(request.requestId); firstReady(); }));
		const cancelled = new Promise<string>(resolve => store.add(owner.onDidCancelTool(resolve)));
		const abort = new AbortController();
		const first = fetch(`http://127.0.0.1:${info.port}/mcp`, {
			method: 'POST', headers: { Authorization: `Bearer ${info.authToken}` },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getWorkspaceFolders' } }),
			signal: abort.signal,
		});
		const rejection = assert.rejects(first, /abort/i);
		await ready;
		const secondReady = new Promise<void>(resolve => store.add(owner.onDidRequestTool(() => resolve())));
		const second = call(info); await secondReady;
		abort.abort(); await rejection;
		assert.strictEqual(await cancelled, requested[0]);
		owner.respondTool(requested[0], { content: [{ type: 'text', text: 'late' }] });
		owner.respondTool(requested[1], { content: [{ type: 'text', text: 'second' }] });
		assert.strictEqual((await second).result.content[0].text, 'second');
	});

	test('a disposed owner cannot create a new endpoint', async () => {
		const owner = server(); owner.dispose();
		await assert.rejects(owner.start(options), /disconnected/);
	});

	test('authenticated HTTP discovery reports window evidence and progressive help without renderer activation', async () => {
		const owner = server(); const info = await owner.start(options);
		const observations: IIdeDiscoveryStatus[] = [];
		store.add(owner.onDidChangeDiscovery(status => observations.push(status)));
		const initialized = await call(info, 'initialize');
		const listed = await call(info, 'tools/list');
		assert.ok(initialized.result.instructions.includes('live browser'));
		assert.ok(listed.result.tools.some((tool: { name: string }) => tool.name === 'openide_capabilities'));
		const response = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
			method: 'POST', headers: { Authorization: `Bearer ${info.authToken}` },
			body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'openide_capabilities', arguments: { family: 'memory' } } }),
		});
		const help = await response.json();
		assert.ok(help.result.content[0].text.includes('not registered'));
		assert.deepStrictEqual(observations.map(status => [!!status.initializedAt, !!status.toolsListedAt]), [[true, false], [true, true]]);
		owner.stop();
		assert.deepStrictEqual(observations.at(-1), { toolCount: 0 });
	});

});
