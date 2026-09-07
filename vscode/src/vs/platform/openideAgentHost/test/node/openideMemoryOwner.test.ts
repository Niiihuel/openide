/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mkdtemp, mkdir, rm, readFile, symlink, copyFile, readdir, writeFile, stat, utimes, rename, link } from 'fs/promises';
import { tmpdir } from 'os';
import { createServer } from 'http';
import { join } from 'path';
import { OpenideMemoryOwner } from '../../node/openideMemoryOwner.js';
import { extractCodebaseNotes, linkCodebaseNotes } from '../../../openideCodebase/common/openideCodebaseNotes.js';
import { serializeMemoryRecord } from '../../../openideCodebase/common/openideMemoryRecord.js';
import { makeEvidence } from '../../../openideCodebase/common/openideCodebaseMemoryTypes.js';

suite('OpenIDE authored memory owner', () => {
	let root: string; let profile: string; let owner: OpenideMemoryOwner;
	const others: OpenideMemoryOwner[] = [];
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-memory-')); profile = join(root, 'profile'); await mkdir(profile); owner = new OpenideMemoryOwner(profile); await owner.setWorkspace([root]); });
	teardown(async () => { owner.dispose(); for (const other of others.splice(0)) { other.dispose(); } await rm(root, { recursive: true, force: true }); });
	const save = () => ({ action: 'save' as const, topic: 'payments/retry', body: '# Retry policy\nReuse the idempotency key.', operationId: 'request:1', related: ['src/pay.ts#retry'], session: 'session', message: 'request' });

	test('persists Markdown, survives restart and keeps node identity after editing and moving', async () => {
		const first = (await owner.request(save())).document!;
		const before = await readFile(join(root, first.path), 'utf8');
		assert.ok(before.startsWith('---\n')); assert.ok(before.includes('source_message: "request"'));
		owner.dispose(); owner = new OpenideMemoryOwner(profile); await owner.setWorkspace([root]);
		assert.strictEqual((await owner.request({ action: 'get', id: first.record.id })).document?.hash, first.hash);
		const second = (await owner.request({ ...save(), id: first.record.id, expectedRevision: 1, expectedHash: first.hash, operationId: 'request:2', body: '# A clearer title\nReuse the same key.' })).document!;
		assert.strictEqual(second.record.revision, 2);
		const a = extractCodebaseNotes('workspace', `file://${root}/${first.path}`, before).nodes.find(node => node.kind === 'note');
		const b = extractCodebaseNotes('workspace', `file://${root}/.openide/memory/notes/renamed.md`, await readFile(join(root, second.path), 'utf8')).nodes.find(node => node.kind === 'note');
		assert.strictEqual(a?.id, b?.id); assert.ok(a?.id);
	});
	test('serializes native and external legacy writes and rejects oversized replacements', async () => {
		const other = new OpenideMemoryOwner(profile); others.push(other); await other.setWorkspace([root]);
		await Promise.all([owner.request({ action: 'legacy', legacyAction: 'add', body: 'Native decision' }), other.request({ action: 'legacy', legacyAction: 'add', body: 'External decision' })]);
		const text = await readFile(join(root, '.openide/MEMORY.md'), 'utf8'); assert.ok(text.includes('Native decision') && text.includes('External decision'));
		await assert.rejects(owner.request({ action: 'legacy', legacyAction: 'replace', oldText: 'Native decision', body: 'x'.repeat(7000), maxChars: 1500 }), /limit/);
		assert.strictEqual(await readFile(join(root, '.openide/MEMORY.md'), 'utf8'), text);
	});
	test('rejects stale revision, duplicate IDs, dirty buffers and symlink destinations', async () => {
		const first = (await owner.request(save())).document!;
		await assert.rejects(owner.request({ ...save(), id: first.record.id, operationId: 'next', expectedRevision: 1, expectedHash: 'stale' }), /conflict/);
		await owner.setDirty([join(root, first.path)]);
		await assert.rejects(owner.request({ ...save(), id: first.record.id, operationId: 'next', expectedRevision: 1, expectedHash: first.hash }), /unsaved/);
		await owner.setDirty([]);
		await copyFile(join(root, first.path), join(root, '.openide/memory/notes/copy.md'));
		await assert.rejects(owner.request({ action: 'list' }), /Duplicate/);
		await rm(join(root, '.openide/memory/notes/copy.md'));
		await symlink(join(root, first.path), join(root, '.openide/MEMORY.md'));
		await assert.rejects(owner.request({ action: 'legacy', legacyAction: 'add', body: 'bad' }), /links/);
	});
	test('failed read never turns an existing path into empty memory', async () => {
		await mkdir(join(root, '.openide/MEMORY.md'), { recursive: true });
		await assert.rejects(owner.request({ action: 'legacy', legacyAction: 'add', body: 'lost' }));
	});
	test('replays one operation without a second note, then forget prevents resurrection', async () => {
		const first = (await owner.request(save())).document!;
		assert.strictEqual((await owner.request(save())).document?.hash, first.hash);
		await owner.request({ action: 'forget', id: first.record.id, expectedRevision: 1, expectedHash: first.hash });
		assert.deepStrictEqual((await owner.request({ action: 'list' })).documents, []);
		await assert.rejects(owner.request(save()), /forgotten/);
	});
	test('links path plus symbol only inside the note root', async () => {
		const first = (await owner.request(save())).document!;
		const uri = `file://${root}/${first.path}`;
		const extracted = extractCodebaseNotes('workspace', uri, await readFile(join(root, first.path), 'utf8'));
		const evidence = makeEvidence('authored');
		const nodes = [...extracted.nodes, ...['a', 'b'].flatMap((id, index) => [
			{ id: `${id}file`, kind: 'file' as const, name: 'pay.ts', uri: `${index ? 'file:///other' : `file://${root}`}/src/pay.ts`, degree: 0, evidence },
			{ id, kind: 'function' as const, name: 'retry', uri: `${index ? 'file:///other' : `file://${root}`}/src/pay.ts`, degree: 0, evidence },
		])];
		const edges = linkCodebaseNotes(nodes); assert.strictEqual(edges.length, 1); assert.strictEqual(edges[0].target, 'a');
	});
	test('forgetting a superseding note does not reactivate the old decision', async () => {
		const first = (await owner.request(save())).document!;
		const second = (await owner.request({ ...save(), operationId: 'new-decision', supersedes: first.record.id, body: 'The replacement decision.' })).document!;
		await owner.request({ action: 'forget', id: second.record.id, expectedRevision: second.record.revision, expectedHash: second.hash });
		const old = (await owner.request({ action: 'get', id: first.record.id })).document!;
		assert.strictEqual(old.record.status, 'superseded');
	});
	test('rejects roots outside the connection assignment', async () => {
		await assert.rejects(owner.request({ ...save(), root: profile }), /assigned/);
	});
	test('reconciles warm cache after same-size edit, restored mtime, rename and deletion', async () => {
		const first = (await owner.request(save())).document!;
		await owner.request({ action: 'list' });
		const path = join(root, first.path); const metadata = await stat(path);
		await writeFile(path, (await readFile(path, 'utf8')).replace('Reuse the', 'Share the'));
		await utimes(path, metadata.atime, metadata.mtime);
		const edited = (await owner.request({ action: 'get', id: first.record.id })).document!;
		assert.ok(edited.record.body.includes('Share the'));
		assert.notStrictEqual(edited.hash, first.hash);
		await assert.rejects(owner.request({ ...save(), id: first.record.id, expectedRevision: 1, expectedHash: first.hash, operationId: 'stale-update' }), /conflict/);
		const renamed = join(root, '.openide/memory/notes/renamed.md'); await rename(path, renamed);
		assert.strictEqual((await owner.request({ action: 'get', id: first.record.id })).document?.path, '.openide/memory/notes/renamed.md');
		await rm(renamed);
		assert.deepStrictEqual((await owner.request({ action: 'list' })).documents, []);
	});
	test('warm cache rejects new hard links and malformed documents without publishing an empty snapshot', async () => {
		const first = (await owner.request(save())).document!; await owner.request({ action: 'list' });
		const path = join(root, first.path); const original = await readFile(path, 'utf8');
		const linked = join(root, 'linked.md'); await link(path, linked);
		await assert.rejects(owner.request({ action: 'get', id: first.record.id }), /links/);
		await rm(linked); await writeFile(path, 'invalid markdown');
		await assert.rejects(owner.request({ action: 'list' }), /Invalid/);
		await writeFile(path, original);
		assert.strictEqual((await owner.request({ action: 'get', id: first.record.id })).document?.hash, first.hash);
	});
	test('isolates cached records from caller mutation and observes another owner write', async () => {
		const first = (await owner.request(save())).document!;
		const listed = (await owner.request({ action: 'list' })).documents!;
		listed[0].record.body = 'caller tampering';
		assert.strictEqual((await owner.request({ action: 'get', id: first.record.id })).document?.record.body, first.record.body);
		const other = new OpenideMemoryOwner(profile); others.push(other); await other.setWorkspace([root]);
		await other.request({ ...save(), id: first.record.id, expectedRevision: first.record.revision, expectedHash: first.hash, operationId: 'other-window', body: 'Updated by the other window.' });
		assert.strictEqual((await owner.request({ action: 'get', id: first.record.id })).document?.record.body, 'Updated by the other window.');
	});
	test('persists separate checkpoint jobs, lists pending recovery and retains legacy state', async () => {
		const pending = { watermark: 'first', status: 'pending' as const, transcript: 'A durable decision.' };
		await owner.request({ action: 'checkpoint', session: 'chat', checkpoint: pending });
		await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'turn:1', checkpoint: pending });
		await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'turn:2', checkpoint: { ...pending, watermark: 'second', status: 'deferred' } });
		owner.dispose(); owner = new OpenideMemoryOwner(profile); await owner.setWorkspace([root]);
		assert.deepStrictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.map(entry => entry.id).sort(), ['', 'turn:1', 'turn:2']);
		await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'turn:1', checkpoint: { ...pending, status: 'saved' } });
		assert.deepStrictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.map(entry => entry.id).sort(), ['', 'turn:2']);
		assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'turn:2' })).checkpoint?.watermark, 'second');
		assert.deepStrictEqual((await owner.request({ action: 'checkpoint-list', session: 'other-chat' })).checkpoints, []);
	});
	test('rejects oversized UTF-8 checkpoint state before acknowledging an unreadable job', async () => {
		await assert.rejects(owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'large', checkpoint: { watermark: 'large', status: 'pending', transcript: '漢'.repeat(12000) } }), /Invalid memory checkpoint/);
		assert.deepStrictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints, []);
	});

	test('bounds checkpoint jobs without discarding pending work and reclaims completed entries', async () => {
		for (let index = 0; index < 100; index++) { await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: `turn:${index}`, checkpoint: { watermark: String(index), status: 'pending' } }); }
		await assert.rejects(owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'overflow', checkpoint: { watermark: 'overflow', status: 'pending' } }), /full/);
		assert.strictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.length, 100);
		await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'turn:0', checkpoint: { watermark: '0', status: 'saved' } });
		await owner.request({ action: 'checkpoint', session: 'chat', checkpointId: 'new-turn', checkpoint: { watermark: 'new', status: 'pending' } });
		assert.strictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.length, 100);
	});
	for (const revoke of ['workspace change', 'root revocation', 'disconnect']) {
		test(`does not commit when ${revoke} invalidates the generation during file synchronization`, async () => {
			owner.dispose();
			let started!: () => void; let release!: () => void;
			const syncing = new Promise<void>(resolve => { started = resolve; });
			const blocked = new Promise<void>(resolve => { release = resolve; });
			owner = new OpenideMemoryOwner(profile, async file => { started(); await blocked; await file.sync(); });
			await owner.setWorkspace([root]);
			const writing = owner.request(save());
			await syncing;
			if (revoke === 'disconnect') { owner.dispose(); } else { await owner.setWorkspace(revoke === 'workspace change' ? [profile] : []); }
			release();
			await assert.rejects(writing, /workspace changed|disconnected/i);
			assert.deepStrictEqual(await readdir(join(root, '.openide/memory/notes')), []);
		});
	}

	test('bounds operation receipts independently of the authored-note budget', async () => {
		const first = (await owner.request(save())).document!;
		const receipts = Array.from({ length: 300 }, (_, index) => `operation-${index}-${'x'.repeat(180)}`);
		await writeFile(join(root, first.path), serializeMemoryRecord({ ...first.record, applied_operations: receipts }));
		const current = (await owner.request({ action: 'get', id: first.record.id })).document!;
		const updated = (await owner.request({ ...save(), id: current.record.id, expectedRevision: current.record.revision, expectedHash: current.hash, body: 'Still a concise note.', operationId: 'latest-operation', maxBytes: 1024 })).document!;
		assert.strictEqual(updated.record.applied_operations?.length, 300);
		assert.strictEqual(updated.record.applied_operations?.at(-1), 'latest-operation');
		assert.strictEqual(updated.record.applied_operations?.includes(receipts[0]), false);
		assert.strictEqual((await owner.request({ action: 'get', id: updated.record.id })).document?.record.applied_operations?.length, 300);
	});

	test('semantic network does not block canonical mutations and excludes forgotten or changed snapshots', async function () {
		this.timeout(5000);
		const first = (await owner.request(save())).document!;
		const second = (await owner.request({ ...save(), topic: 'payments/limits', operationId: 'limits', body: 'Old limit.' })).document!;
		let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
		let started!: () => void; const startedPromise = new Promise<void>(resolve => { started = resolve; });
		let removals = 0;
		const server = createServer(async (request, response) => {
			request.resume();
			if (request.method === 'DELETE') { removals++; }
			if (request.url === '/memories' && request.method === 'POST') { started(); await blocked; }
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify(request.url === '/search' ? { results: [first, second].map(document => ({ metadata: { record_id: document.record.id, source_hash: document.hash } })) } : {}));
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const semantic = owner.request({ action: 'semantic', query: 'retry', semanticEndpoint: `http://127.0.0.1:${address.port}` });
		try {
			await startedPromise;
			await owner.request({ ...save(), topic: 'payments/limits', operationId: 'updated-limits', id: second.record.id, expectedRevision: second.record.revision, expectedHash: second.hash, body: 'New limit.' });
			const forgotten = owner.request({ action: 'forget', id: first.record.id, expectedRevision: first.record.revision, expectedHash: first.hash });
			// This read completes while the HTTP response remains deliberately blocked.
			assert.deepStrictEqual((await owner.request({ action: 'list' })).documents?.map(document => document.record.body), ['New limit.']);
			unblock();
			assert.deepStrictEqual((await semantic).semanticIds, []);
			assert.strictEqual((await forgotten).forgottenPath, first.path);
			assert.strictEqual(removals, 3);
		} finally { unblock(); await semantic.catch(() => undefined); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
	});

});
