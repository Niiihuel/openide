/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawn } from 'child_process';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IOpenideRunJournalEvent, OPENIDE_UNKNOWN_TOOL_OUTCOME, reconstructOpenideJournalRequest } from '../../common/openideRunJournal.js';
import { OpenideRunJournalStore } from '../../node/openideRunJournalStore.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('OpenIDE durable run journal (real disk)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-journal-')); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	const event = (index: number): IOpenideRunJournalEvent => ({ kind: 'run/start', runId: `run-${index}`, payload: { messages: [] } });

	test('serializes concurrent owners and snapshots input before queuing', async () => {
		const first = new OpenideRunJournalStore(root);
		const second = new OpenideRunJournalStore(root);
		const mutable = { kind: 'model/request' as const, runId: 'a', payload: { request: { model: 'original', messages: [{ role: 'user', content: 'source' }] } } };
		const initial = first.append('session', mutable);
		mutable.payload.request.model = 'mutated';
		await Promise.all([initial, ...Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).append('session', event(index)))]);
		const records = await second.read('session');
		assert.deepStrictEqual(records.map(record => record.seq), Array.from({ length: 21 }, (_, index) => index));
		assert.deepStrictEqual(JSON.parse(JSON.stringify(reconstructOpenideJournalRequest(records, 0))), { model: 'original', messages: [{ role: 'user', content: 'source' }] });
	});

	test('recovers a torn final line but refuses complete corruption', async () => {
		const store = new OpenideRunJournalStore(root);
		await store.append('session', event(0));
		const file = join(root, (await readdir(root))[0]);
		const durable = await readFile(file);
		await appendFile(file, '{"version":');
		assert.strictEqual((await store.read('session')).length, 1);
		assert.deepStrictEqual(await readFile(file), durable);
		await appendFile(file, '{"version":1}\n');
		await assert.rejects(store.append('session', event(1)));
		assert.strictEqual((await readFile(file)).length, durable.length + Buffer.byteLength('{"version":1}\n'));
	});

	test('rotates a full legacy journal without rewriting its accepted prefix', async () => {
		const legacy = new OpenideRunJournalStore(root);
		await legacy.append('a', event(0));
		const base = join(root, (await readdir(root))[0]);
		const prefix = await readFile(base);
		const store = new OpenideRunJournalStore(root, { segmentBytes: prefix.length });
		await store.append('a', event(1));
		await store.append('a', event(2));
		assert.deepStrictEqual(await readFile(base), prefix);
		assert.strictEqual((await readdir(root)).length, 3);
		const records = await new OpenideRunJournalStore(root).read('a');
		assert.deepStrictEqual(records.map(record => record.seq), [0, 1, 2]);
		assert.strictEqual(records[1].previousHash, records[0].hash);
		assert.strictEqual(records[2].previousHash, records[1].hash);
	});

	test('record bounds still fail without altering the accepted prefix', async () => {
		const store = new OpenideRunJournalStore(root, { recordBytes: 400 });
		await store.append('a', event(0));
		await assert.rejects(store.append('a', { ...event(1), payload: { content: 'x'.repeat(401) } }), /capacity/);
		assert.strictEqual((await store.read('a')).length, 1);
	});

	test('recovers a tool at the rotation boundary exactly once', async () => {
		const store = new OpenideRunJournalStore(root, { segmentRecords: 1 });
		await store.append('a', { kind: 'tool/intent', runId: 'run', payload: { operationId: 'op', callId: 'call', name: 'write_file' } });
		const recovered = await store.recover('a');
		assert.deepStrictEqual(recovered.map(record => record.event.kind), ['tool/intent', 'tool/unknown']);
		assert.strictEqual((await store.recover('a')).length, 2);
		assert.strictEqual((await readdir(root)).length, 2);
	});

	test('failed rotation checkpoint preserves history and retries the empty final segment', async () => {
		const store = new OpenideRunJournalStore(root, { segmentRecords: 1 });
		await store.append('a', event(0));
		const failed = new OpenideRunJournalStore(root, { segmentRecords: 1 }, async () => { throw new Error('disk failure'); });
		await assert.rejects(failed.append('a', event(1)), /disk failure/);
		assert.strictEqual((await store.read('a')).length, 1);
		await store.append('a', event(2));
		assert.deepStrictEqual((await store.read('a')).map(record => record.event.runId), ['run-0', 'run-2']);
		assert.strictEqual((await readdir(root)).length, 2);
	});

	test('does not repair or trust a changed archived segment, including a cached same-size edit', async () => {
		const store = new OpenideRunJournalStore(root, { segmentRecords: 1 });
		await store.append('a', event(0));
		await store.append('a', event(1));
		const base = join(root, (await readdir(root)).find(name => name.split('.').length === 2)!);
		const prefix = await readFile(base, 'utf8');
		await writeFile(base, prefix.replace('run-0', 'run-X'));
		await assert.rejects(store.append('a', event(2)), /corrupt/);
		await writeFile(base, prefix.slice(0, -1));
		await assert.rejects(store.recover('a'), /corrupt/);
		assert.strictEqual(await readFile(base, 'utf8'), prefix.slice(0, -1));
	});

	test('rejects missing segments and serializes multiple owners across rotations', async () => {
		const first = new OpenideRunJournalStore(root, { segmentRecords: 1 });
		const second = new OpenideRunJournalStore(root, { segmentRecords: 1 });
		await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).append('a', event(index))));
		assert.deepStrictEqual((await first.read('a')).map(record => record.seq), [0, 1, 2, 3, 4, 5, 6, 7]);
		await rm(join(root, (await readdir(root)).find(name => name.endsWith('.00000001.jsonl'))!));
		await assert.rejects(first.append('a', event(9)), /segments/);
	});

	test('failed fsync acknowledgement rolls back physical bytes before a subsequent successful append', async () => {
		const store = new OpenideRunJournalStore(root);
		await store.append('session', event(0));
		const file = join(root, (await readdir(root))[0]);
		const before = await readFile(file);
		const failed = new OpenideRunJournalStore(root, {}, async handle => { await handle.sync(); throw new Error('injected disk checkpoint failure'); });
		await assert.rejects(failed.append('session', event(1)), /checkpoint failure/);
		assert.deepStrictEqual(await readFile(file), before);
		await store.append('session', event(2));
		assert.deepStrictEqual((await store.read('session')).map(record => record.event.runId), ['run-0', 'run-2']);
	});

	test('restart after SIGKILL preserves tool intent and recovers uncertainty exactly once', async function () {
		if (process.platform === 'win32') { this.skip(); }
		this.timeout(15000);
		const moduleUrl = new URL('../../node/openideRunJournalStore.js', import.meta.url).href;
		const effect = join(root, 'effect.txt');
		const code = `import { OpenideRunJournalStore } from ${JSON.stringify(moduleUrl)};
import { writeFile } from 'fs/promises';
const store = new OpenideRunJournalStore(${JSON.stringify(join(root, 'journal'))});
await store.append('session', {kind:'tool/intent',runId:'run',payload:{operationId:'0:call',callId:'call',name:'write_file',argumentsJson:'{}'}});
await writeFile(${JSON.stringify(effect)}, 'performed once');
process.stdout.write('effect-ready\\n');
setInterval(() => {}, 1000);`;
		const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', chunk => { stderr += chunk; });
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
		try {
			await Promise.race([new Promise<void>(resolve => child.stdout.once('data', () => resolve())), exited.then(() => { throw new Error(`child exited before checkpoint: ${stderr}`); })]);
			child.kill('SIGKILL');
			assert.strictEqual((await exited).signal, 'SIGKILL');
			const store = new OpenideRunJournalStore(join(root, 'journal'));
			const records = await store.recover('session');
			assert.deepStrictEqual(records.map(record => record.event.kind), ['tool/intent', 'tool/unknown']);
			assert.strictEqual(records[1].event.payload['outcome'], OPENIDE_UNKNOWN_TOOL_OUTCOME);
			assert.strictEqual((await store.recover('session')).length, 2);
			assert.strictEqual(await readFile(effect, 'utf8'), 'performed once');
		} finally { if (child.exitCode === null) { child.kill('SIGKILL'); } await exited; }
	});

	test('refuses a modified complete record before acknowledging subsequent writes', async () => {
		const store = new OpenideRunJournalStore(root);
		await store.append('session', event(0));
		const file = join(root, (await readdir(root))[0]);
		await writeFile(file, (await readFile(file, 'utf8')).replace('run-0', 'run-X'));
		await assert.rejects(store.recover('session'), /corrupt/);
	});
});
