/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { createServer, Server } from 'http';
import { OpenideMem0Adapter } from '../../node/openideMem0Adapter.js';
import { IOpenideMemoryDocument } from '../../../openideCodebase/common/openideMemoryRecord.js';

suite('OpenIDE optional Mem0 adapter', () => {
	let server: Server; let endpoint: string;
	const requests: { url: string; method: string; body: Record<string, unknown>; key?: string }[] = [];
	const document: IOpenideMemoryDocument = { path: '.openide/memory/notes/mem_fixture1.md', hash: 'source-hash', record: { schema: 1, id: 'mem_fixture1', topic_key: 'test/topic', kind: 'decision', revision: 1, status: 'active', source_kind: 'native', source_session: 's', source_message: 'm', evidence_kind: 'inferred', operation_id: 'operation', created: '', updated: '', related: [], body: 'The canonical decision.' } };
	setup(async () => {
		requests.length = 0;
		server = createServer(async (request, response) => {
			let text = ''; for await (const chunk of request) { text += chunk; }
			requests.push({ url: request.url ?? '', method: request.method ?? '', body: text ? JSON.parse(text) : {}, key: request.headers['x-api-key'] as string | undefined });
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify(request.url === '/search' ? { results: [
				{ user_id: 'scope', metadata: { record_id: 'mem_fixture1', source_hash: 'source-hash' } },
				{ user_id: 'other', metadata: { record_id: 'mem_fixture1', source_hash: 'source-hash' } },
				{ user_id: 'scope', metadata: { record_id: 'mem_fixture1', source_hash: 'obsolete' } },
				{ user_id: 'scope', metadata: { record_id: 'mem_deleted1', source_hash: 'source-hash' } },
			] } : { results: [] }));
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address === 'object'); endpoint = `http://127.0.0.1:${address.port}`;
	});
	teardown(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
	test('uses scoped replacement, disables extraction, and validates every returned source hash', async () => {
		const adapter = new OpenideMem0Adapter(endpoint, 'scope', 'fixture-key');
		await adapter.put(document);
		assert.strictEqual(requests[0].method, 'DELETE'); assert.ok(requests[0].url.includes('user_id=scope') && requests[0].url.includes('run_id=mem_fixture1'));
		assert.strictEqual(requests[1].body.infer, false); assert.strictEqual(requests[1].key, 'fixture-key');
		assert.deepStrictEqual(await adapter.search('decision', [document]), ['mem_fixture1']);
		assert.deepStrictEqual(requests.at(-1)?.body.filters, { user_id: 'scope' });
	});
	test('refuses remote or credential-bearing endpoints', () => {
		for (const url of ['https://remote.example', 'http://user:pass@localhost', 'file:///tmp/memory', 'http://localhost/?token=secret']) { assert.throws(() => new OpenideMem0Adapter(url, 'scope')); }
	});
});
