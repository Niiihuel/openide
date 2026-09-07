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
	const scripts = Object.fromEntries(['valid-layers-check', 'typecheck-client', 'transpile-client'].map(task => [task, `node -e "if(require('node:fs').existsSync('../fail-validation'))process.exit(1)"`]));
	json(upstream, 'package.json', { version: '1.0.0', scripts });
	fs.writeFileSync(path.join(upstream, '.nvmrc'), '22.22.1\n');
	fs.writeFileSync(path.join(upstream, 'engine.txt'), 'base\n');
	fs.writeFileSync(path.join(upstream, 'removed.txt'), 'base\n');
	git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'base');
	const base = git(upstream, 'rev-parse', 'HEAD');
	json(upstream, 'package.json', { version: '1.1.0', scripts });
	fs.writeFileSync(path.join(upstream, '.nvmrc'), '24.18.0\n');
	fs.writeFileSync(path.join(upstream, 'engine.txt'), 'target\n');
	fs.writeFileSync(path.join(upstream, 'removed.txt'), 'target\n');
	git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'target');
	const target = git(upstream, 'rev-parse', 'HEAD');
	fs.mkdirSync(path.join(fork, 'dev'));
	for (const file of ['codeoss-sync.mjs', 'audit-fork-delta.mjs']) {
		fs.copyFileSync(new URL(file, import.meta.url), path.join(fork, 'dev', file));
	}
	json(fork, 'dev/codeoss-preserved-paths.json', { schemaVersion: 1, removals: [{ path: 'removed.txt', owner: 'Test', rationale: 'Replaced', validation: 'Fixture' }], upstreamEdits: [] });
	fs.mkdirSync(path.join(fork, 'vscode'));
	fs.mkdirSync(path.join(fork, 'vscode/node_modules/mocha/bin'), { recursive: true });
	fs.writeFileSync(path.join(fork, 'vscode/node_modules/mocha/bin/mocha.js'), 'process.exit(0);');
	json(fork, 'vscode/package.json', { version: '1.0.0', scripts });
	json(fork, 'vscode/package-lock.json', { version: '1.0.0', packages: { '': { version: '1.0.0' } } });
	fs.writeFileSync(path.join(fork, 'vscode/engine.txt'), conflict ? 'OpenIDE\n' : 'base\n');
	fs.writeFileSync(path.join(fork, '.nvmrc'), '22.22.1\n');
	fs.writeFileSync(path.join(fork, 'vscode/.nvmrc'), '22.22.1\n');
	json(fork, 'openide-version.json', { version: '7.0.0', codeOss: { version: '1.0.0', commit: base } });
	git(fork, 'add', '.'); git(fork, 'commit', '-qm', 'OpenIDE');
	git(fork, 'remote', 'add', 'codeoss', upstream);
	const run = (...args) => spawnSync(process.execPath, ['dev/codeoss-sync.mjs', ...args], { cwd: fork, encoding: 'utf8' });
	const metadata = () => JSON.parse(fs.readFileSync(path.join(fork, 'openide-version.json'), 'utf8'));
	return { fork, upstream, base, target, run, metadata };
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
	git(f.fork, 'commit', '-qm', 'Integrated');
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


test('refuses staged edits and untracked managed files without touching them', t => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.fork, 'vscode/engine.txt'), 'staged work\n');
	git(f.fork, 'add', 'vscode/engine.txt');
	assert.notEqual(f.run(f.target).status, 0);
	assert.equal(git(f.fork, 'show', ':vscode/engine.txt'), 'staged work');
	git(f.fork, 'restore', '--staged', '--worktree', 'vscode/engine.txt');
	fs.writeFileSync(path.join(f.fork, 'vscode/untracked.txt'), 'local');
	assert.notEqual(f.run(f.target).status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
});

test('preserves unrelated staged and unstaged work', t => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.fork, 'notes.txt'), 'staged notes');
	git(f.fork, 'add', 'notes.txt');
	fs.writeFileSync(path.join(f.fork, 'notes.txt'), 'working notes');
	assert.equal(f.run(f.target).status, 0);
	assert.equal(git(f.fork, 'show', ':notes.txt'), 'staged notes');
	assert.equal(fs.readFileSync(path.join(f.fork, 'notes.txt'), 'utf8'), 'working notes');
});

test('unexpected committed deletions fail with inventory evidence', t => {
	const f = fixture(t);
	git(f.fork, 'rm', 'vscode/engine.txt');
	git(f.fork, 'commit', '-qm', 'Accidental deletion');
	const result = f.run(f.target);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Unexpected fork deletions/);
	const report = JSON.parse(fs.readFileSync(path.join(f.fork, '.build/codeoss-sync/reports/fork-delta.json')));
	assert.equal(report.totals.unexpectedDeletions, 1);
	assert.equal(f.metadata().codeOss.commit, f.base);
});

test('preparation and failed validation do not advance metadata; retry runs checks', t => {
	const f = fixture(t);
	assert.equal(f.run(f.target, '--prepare').status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	fs.writeFileSync(path.join(f.fork, 'fail-validation'), '');
	const result = f.run('--continue');
	assert.notEqual(result.status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	const report = JSON.parse(fs.readFileSync(path.join(f.fork, '.build/codeoss-sync/reports/sync-result.json')));
	assert.equal(report.validations[0].passed, false);
	assert.match(report.error, /valid-layers-check/);
	fs.rmSync(path.join(f.fork, 'fail-validation'));
	assert.equal(f.run('--continue').status, 0);
	assert.equal(f.metadata().codeOss.commit, f.target);
});

test('upstream rename and deletion apply with deterministic path counting', t => {
	const f = fixture(t);
	git(f.upstream, 'mv', 'engine.txt', 'renamed.txt');
	git(f.upstream, 'rm', 'removed.txt');
	git(f.upstream, 'commit', '-qm', 'Rename and delete');
	const target = git(f.upstream, 'rev-parse', 'HEAD');
	const result = f.run(target);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.existsSync(path.join(f.fork, 'vscode/engine.txt')), false);
	assert.equal(fs.readFileSync(path.join(f.fork, 'vscode/renamed.txt'), 'utf8'), 'target\n');
	assert.equal(fs.existsSync(path.join(f.fork, 'vscode/removed.txt')), false);
});

test('conflict reports remain available before continuation', t => {
	const f = fixture(t, true);
	assert.notEqual(f.run(f.target).status, 0);
	const report = JSON.parse(fs.readFileSync(path.join(f.fork, '.build/codeoss-sync/reports/sync-result.json')));
	assert.deepEqual(report.conflicts, ['vscode/engine.txt']);
	assert.ok(fs.existsSync(path.join(f.fork, '.build/codeoss-sync/reports/upstream.patch')));
	assert.ok(fs.existsSync(path.join(f.fork, '.build/codeoss-sync/reports/fork-delta.json')));
});


test('refuses unstaged conflict resolutions and changed base on continuation', t => {
	const f = fixture(t, true);
	assert.notEqual(f.run(f.target).status, 0);
	fs.writeFileSync(path.join(f.fork, 'vscode/engine.txt'), 'resolution\n');
	assert.notEqual(f.run('--continue').status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	git(f.fork, 'add', 'vscode/engine.txt');
	const originalHead = git(f.fork, 'rev-parse', 'HEAD');
	git(f.fork, 'commit', '-qm', 'Premature commit');
	assert.notEqual(f.run('--continue').status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	git(f.fork, 'reset', '--soft', originalHead);
	assert.equal(f.run('--continue').status, 0);
});

test('modified fork file deleted upstream conflicts and can continue with explicit deletion', t => {
	const f = fixture(t, true);
	git(f.upstream, 'rm', 'engine.txt');
	git(f.upstream, 'commit', '-qm', 'Remove engine');
	const target = git(f.upstream, 'rev-parse', 'HEAD');
	assert.notEqual(f.run(target).status, 0);
	assert.equal(f.metadata().codeOss.commit, f.base);
	assert.equal(fs.readFileSync(path.join(f.fork, 'vscode/engine.txt'), 'utf8'), 'OpenIDE\n');
	git(f.fork, 'rm', 'vscode/engine.txt');
	const result = f.run('--continue');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(f.metadata().codeOss.commit, target);
});
