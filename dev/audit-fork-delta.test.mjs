import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { inventory, readPolicy, summary } from './audit-fork-delta.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-inventory-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const upstream = path.join(directory, 'upstream'), forkRepo = path.join(directory, 'fork');
	for (const repo of [upstream, forkRepo]) {
		fs.mkdirSync(repo);
		git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
	}
	for (const [name, text] of [['mode.sh', 'same\n'], ['old.txt', 'rename\n'], ['deleted.txt', 'gone\n'], ['edited.txt', 'before\n'], ['tab\tname.txt', 'before\n']]) { fs.writeFileSync(path.join(upstream, name), text); }
	git(upstream, 'add', '.'); git(upstream, 'commit', '-qm', 'Base');
	fs.mkdirSync(path.join(forkRepo, 'vscode'));
	for (const [name, text] of [['mode.sh', 'same\n'], ['new.txt', 'rename\n'], ['edited.txt', 'after\n'], ['tab\tname.txt', 'after\n'], ['ordinary-new.txt', 'addition\n'], ['openideNew.txt', 'addition\n']]) { fs.writeFileSync(path.join(forkRepo, 'vscode', name), text); }
	git(forkRepo, 'add', '.'); git(forkRepo, 'update-index', '--chmod=+x', 'vscode/mode.sh'); git(forkRepo, 'commit', '-qm', 'Fork');
	const policy = { schemaVersion: 1, removals: [{ path: 'old.txt', owner: 'Test', rationale: 'Renamed', validation: 'Fixture' }], upstreamEdits: [] };
	return { directory, upstream, forkRepo, options: { upstreamGitDir: path.join(upstream, '.git'), baseCommit: git(upstream, 'rev-parse', 'HEAD'), forkRepo, forkRevision: 'HEAD', policy } };
}

test('counts path additions/deletions, mode changes and unusual names deterministically', t => {
	const f = fixture(t);
	const report = inventory(f.options);
	assert.deepEqual(report.totals, { added: 3, modified: 3, deleted: 2, modeChanged: 1, nonOpenideAdditions: 2, unexpectedDeletions: 1 });
	assert.ok(report.changes.find(change => change.path === 'tab\tname.txt'));
	assert.equal(report.changes.find(change => change.path === 'old.txt').exception.owner, 'Test');
	assert.equal(report.changes.find(change => change.path === 'mode.sh').before.mode, '100644');
	assert.equal(report.changes.find(change => change.path === 'mode.sh').after.mode, '100755');
	assert.match(summary(report), /UNEXPECTED DELETION: deleted.txt/);
	assert.deepEqual(inventory(f.options), report);
});

test('fresh clone gives the same committed inventory and dirty edits do not change it', t => {
	const f = fixture(t);
	const before = inventory(f.options);
	fs.writeFileSync(path.join(f.forkRepo, 'vscode/edited.txt'), 'uncommitted');
	git(f.forkRepo, 'add', 'vscode/edited.txt');
	assert.deepEqual(inventory(f.options), before);
	const clone = path.join(f.directory, 'fresh');
	git(f.directory, 'clone', '-q', f.forkRepo, clone);
	assert.deepEqual(inventory({ ...f.options, forkRepo: clone }), before);
});

test('missing base fails with explicit acquisition instructions', t => {
	const f = fixture(t);
	assert.throws(() => inventory({ ...f.options, baseCommit: '0'.repeat(40) }), /Acquire it explicitly: git init --bare/);
});

test('manifest requires rationale, owner and validation', t => {
	const f = fixture(t);
	const file = path.join(f.directory, 'policy.json');
	fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, removals: [{ path: 'deleted.txt' }], upstreamEdits: [] }));
	assert.throws(() => readPolicy(file), /Incomplete fork exception/);
});

test('CLI writes failure inventory and separate dirtiness evidence', t => {
	const f = fixture(t);
	const file = path.join(f.directory, 'policy.json'), output = path.join(f.directory, 'reports');
	fs.writeFileSync(file, JSON.stringify(f.options.policy));
	fs.writeFileSync(path.join(f.forkRepo, 'notes.txt'), 'local work');
	const result = spawnSync(process.execPath, [new URL('audit-fork-delta.mjs', import.meta.url).pathname, '--upstream-git-dir', f.options.upstreamGitDir, '--base', f.options.baseCommit, '--fork-repo', f.forkRepo, '--manifest', file, '--output', output], { encoding: 'utf8' });
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /dirty/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'fork-delta.json'))).totals.unexpectedDeletions, 1);
	assert.ok(JSON.parse(fs.readFileSync(path.join(output, 'worktree-status.json'))).porcelainV1.some(row => row.includes('notes.txt')));
});
