/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFile } from 'child_process';
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { IOpenideProcessIsolationRequest, openidePreparedProcessCommand } from '../../common/openideProcessIsolation.js';
import { OpenideProcessIsolation } from '../../node/openideProcessIsolation.js';

const execute = promisify(execFile);
suite('OpenIDE kernel process isolation', () => {
	let temporary: string, root: string;
	let backend: OpenideProcessIsolation;
	const request = (script: string, readonly = false): IOpenideProcessIsolationRequest => ({ mode: 'required', executable: process.execPath, args: ['-e', script], workspaceRoot: root, cwd: root, readonly, network: 'deny' });
	setup(async () => { temporary = await mkdtemp(join(tmpdir(), 'openide-isolation-test-')); root = join(temporary, 'workspace'); await mkdir(root); backend = new OpenideProcessIsolation(process.env.OPENIDE_TEST_BWRAP); });
	teardown(async () => { await rm(temporary, { recursive: true, force: true }); });
	async function requireKernel(context: Mocha.Context): Promise<void> { const status = await backend.status(); if (!status.available) { console.log(`SKIP kernel confinement: ${status.reason}`); context.skip(); } }

	test('off mode is explicit and required mode refuses unsupported hosts', async () => {
		const unsupported = new OpenideProcessIsolation(undefined, 'darwin');
		const original = request('process.exit(0)');
		assert.deepStrictEqual((await unsupported.prepare({ ...original, mode: 'off' })).status, { mode: 'off', state: 'off', backend: 'none' });
		await assert.rejects(unsupported.prepare(original), /Required process isolation is unavailable/);
	});

	test('quoted wrapper argv never evaluates payload in the outer terminal shell', () => {
		assert.strictEqual(openidePreparedProcessCommand({ executable: '/runner', args: ['$(touch outside)', "a'b", 'line\nbreak'], cwd: root, status: { mode: 'required', state: 'confined', backend: 'bubblewrap' } }), "'/runner' '$(touch outside)' 'a'\\''b' 'line\nbreak'");
	});

	test('kernel denies outside reads/writes and secret inheritance while workspace writes succeed', async function () {
		await requireKernel(this);
		const outside = join(temporary, 'outside.txt'); await writeFile(outside, 'private');
		await symlink(outside, join(root, 'escape'));
		const script = `const fs=require('fs'); let denied=0; for(const p of [${JSON.stringify(outside)},'escape']){try{fs.readFileSync(p)}catch{denied++}}; try{fs.writeFileSync(${JSON.stringify(outside)},'bad')}catch{denied++}; fs.writeFileSync('allowed.txt','inside'); console.log(JSON.stringify({denied,secret:process.env.OPENIDE_TEST_SECRET??null}));`;
		const wrapped = await backend.prepare(request(script));
		const { stdout } = await execute(wrapped.executable, [...wrapped.args], { cwd: root, env: { ...process.env, OPENIDE_TEST_SECRET: 'must-not-cross' }, timeout: 10000 });
		// /tmp is private scratch: a same-named outside write may create a shadow file,
		// but cannot read or mutate the real host file checked below.
		assert.deepStrictEqual(JSON.parse(stdout), { denied: 2, secret: null });
		assert.strictEqual(await readFile(outside, 'utf8'), 'private');
		assert.strictEqual(await readFile(join(root, 'allowed.txt'), 'utf8'), 'inside');
	});

	test('readonly workspace denies mutation and network namespace blocks host loopback', async function () {
		await requireKernel(this);
		await writeFile(join(root, 'existing.txt'), 'original');
		const server = createServer(socket => socket.end('host'));
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		try {
			const address = server.address(); assert.ok(address && typeof address !== 'string');
			const script = `const fs=require('fs'),net=require('net');let readonly=false;try{fs.writeFileSync('existing.txt','bad')}catch{readonly=true};const s=net.connect(${address.port},'127.0.0.1');s.once('connect',()=>{console.log(JSON.stringify({readonly,network:false}));s.destroy()});s.once('error',()=>console.log(JSON.stringify({readonly,network:true})));`;
			const wrapped = await backend.prepare(request(script, true));
			const { stdout } = await execute(wrapped.executable, [...wrapped.args], { cwd: root, timeout: 10000 });
			assert.deepStrictEqual(JSON.parse(stdout), { readonly: true, network: true });
			assert.strictEqual(await readFile(join(root, 'existing.txt'), 'utf8'), 'original');
		} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
	});

	test('linked worktree Git metadata is readable but readonly and source files stay invisible', async function () {
		await requireKernel(this);
		const source = join(temporary, 'source'); await mkdir(source);
		await execute('git', ['init', '-q', source]);
		await writeFile(join(source, 'file.txt'), 'base');
		await execute('git', ['-C', source, 'add', '.']);
		await execute('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']);
		await execute('git', ['-C', source, 'worktree', 'add', '--detach', root]);
		const script = `const fs=require('fs'),cp=require('child_process');let denied=0;for(const p of ['.git',${JSON.stringify(join(source, '.git', 'config'))}]){try{fs.writeFileSync(p,'bad')}catch{denied++}};try{fs.readFileSync(${JSON.stringify(join(source, 'file.txt'))})}catch{denied++};const git=cp.spawnSync('git',['status','--porcelain'],{encoding:'utf8'});console.log(JSON.stringify({denied,status:git.status,output:git.stdout}));`;
		const wrapped = await backend.prepare(request(script));
		const { stdout } = await execute(wrapped.executable, [...wrapped.args], { cwd: root, timeout: 10000 });
		assert.deepStrictEqual(JSON.parse(stdout), { denied: 3, status: 0, output: '' });
	});

	test('hard links and symlink cwd escapes fail before launch', async function () {
		await requireKernel(this);
		await writeFile(join(temporary, 'private.txt'), 'private'); await link(join(temporary, 'private.txt'), join(root, 'alias'));
		await assert.rejects(backend.prepare(request('')), /hard-linked/);
		await rm(join(root, 'alias')); await symlink(temporary, join(root, 'outside'));
		await assert.rejects(backend.prepare({ ...request(''), cwd: join(root, 'outside') }), /escapes/);
	});
});
