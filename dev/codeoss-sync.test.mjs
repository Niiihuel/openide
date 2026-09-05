import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
function fixture(t, conflict = false) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-sync-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const upstream = path.join(dir, 'upstream');
	const fork = path.join(dir, 'fork');
	for (const repo of [upstream, fork]) {
		fs.mkdirSync(repo);
		git(repo, 'init', '-q');
		git(repo, 'config', 'user.name', 'Sync Test');
		git(repo, 'config', 'user.email', 'sync@example.invalid');
	}
	json(upstream, 'package.json', { version: '1.0.0' });
	fs.writeFileSync(path.join(upstream, '.nvmrc'), '22.22.1\n');
	fs.writeFileSync(path.join(upstream, 'engine.txt'), 'base\n');
	fs.writeFileSync(path.join(upstream, 'removed.txt'), 'base\n');
	git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'base');
	const base = git(upstream, 'rev-parse', 'HEAD');
	json(upstream, 'package.json', { version: '1.1.0' });
	fs.writeFileSync(path.join(upstream, '.nvmrc'), '24.18.0\n');
	fs.writeFileSync(path.join(upstream, 'engine.txt'), 'target\n');
	fs.writeFileSync(path.join(upstream, 'removed.txt'), 'target\n');
	git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'target');
	const target = git(upstream, 'rev-parse', 'HEAD');
	fs.mkdirSync(path.join(fork, 'dev'));
	for (const file of ['codeoss-sync.mjs', 'codeoss-preserved-paths.json']) {
		fs.copyFileSync(new URL(file, import.meta.url), path.join(fork, 'dev', file));
	}
	fs.mkdirSync(path.join(fork, 'vscode'));
	json(fork, 'vscode/package.json', { version: '1.0.0' });
	json(fork, 'vscode/package-lock.json', { version: '1.0.0', packages: { '': { version: '1.0.0' } } });
	fs.writeFileSync(path.join(fork, 'vscode/engine.txt'), conflict ? 'OpenIDE\n' : 'base\n');
	fs.writeFileSync(path.join(fork, '.nvmrc'), '22.22.1\n');
	fs.writeFileSync(path.join(fork, 'vscode/.nvmrc'), '22.22.1\n');
	json(fork, 'openide-version.json', { version: '7.0.0', codeOss: { version: '1.0.0', commit: base } });
	git(fork, 'add', '.'); git(fork, 'commit', '-qm', 'OpenIDE');
	git(fork, 'remote', 'add', 'codeoss', upstream);
	const run = ref => spawnSync(process.execPath, ['dev/codeoss-sync.mjs', ref], { cwd: fork, encoding: 'utf8' });
	const metadata = () => JSON.parse(fs.readFileSync(path.join(fork, 'openide-version.json'), 'utf8'));
	return { fork, base, target, run, metadata };
}

test('fetches the target, preserves product version and deliberate removals, synchronizes Node', t => {
	const f = fixture(t);
	const result = f.run(f.target);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(f.metadata().codeOss.commit, f.target);
	assert.equal(f.metadata().version, '7.0.0');
	assert.equal(fs.readFileSync(path.join(f.fork, 'vscode/engine.txt'), 'utf8'), 'target\n');
	assert.equal(fs.existsSync(path.join(f.fork, 'vscode/removed.txt')), false);
	assert.equal(fs.readFileSync(path.join(f.fork, '.nvmrc'), 'utf8'), '24.18.0\n');
	assert.equal(f.run(f.target).status, 0);
});

test('never advances metadata while a conflict is unresolved; continues after resolution', t => {
	const f = fixture(t, true);
	assert.notEqual(f.run(f.target).status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	assert.notEqual(f.run('--continue').status, 0);
	fs.writeFileSync(path.join(f.fork, 'vscode/engine.txt'), 'OpenIDE + target\n');
	git(f.fork, 'add', 'vscode/engine.txt');
	const result = f.run('--continue');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(f.metadata().codeOss.commit, f.target);
});

test('refuses unstaged local changes before applying upstream', t => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.fork, 'vscode/engine.txt'), 'unsaved work\n');
	assert.notEqual(f.run(f.target).status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	assert.equal(fs.readFileSync(path.join(f.fork, 'vscode/engine.txt'), 'utf8'), 'unsaved work\n');
});
