#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const matchesPath = (file, entry) => file === entry.path || file.startsWith(`${entry.path}/`);
export function readPolicy(file) {
	const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (policy.schemaVersion !== 1 || !Array.isArray(policy.removals) || !Array.isArray(policy.upstreamEdits)) { throw new Error('Invalid fork exception manifest.'); }
	for (const entry of [...policy.removals, ...policy.upstreamEdits]) {
		if (typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '..' || part === '.') || ['owner', 'rationale', 'validation'].some(key => typeof entry[key] !== 'string' || !entry[key].trim())) {
			throw new Error(`Incomplete fork exception: ${JSON.stringify(entry)}`);
		}
	}
	return policy;
}
function tree(args, cwd) {
	const entries = new Map();
	for (const row of git([...args, '-r', '-z'], cwd).split('\0').filter(Boolean)) {
		const tab = row.indexOf('\t');
		const [mode, type, object] = row.slice(0, tab).split(' ');
		entries.set(row.slice(tab + 1), { mode, type, object });
	}
	return entries;
}
function subsystem(file) {
	const segments = file.split('/');
	if (file.startsWith('src/vs/workbench/contrib/')) { return segments.slice(0, 5).join('/'); }
	if (file.startsWith('src/vs/')) { return segments.slice(0, 4).join('/'); }
	return segments.slice(0, segments.length > 1 ? 2 : 1).join('/');
}
export function inventory({ upstreamGitDir, baseCommit, forkRepo, forkRevision = 'HEAD', forkTreeRevision, policy }) {
	let base;
	try { base = git([`--git-dir=${upstreamGitDir}`, 'rev-parse', '--verify', `${baseCommit}^{commit}`]).trim(); }
	catch { throw new Error(`Missing upstream base ${baseCommit}. Acquire it explicitly: git init --bare <store>; git --git-dir=<store> fetch --depth=1 https://github.com/microsoft/vscode.git ${baseCommit}. Then pass --upstream-git-dir <store>.`); }
	const forkCommit = git(['rev-parse', '--verify', `${forkRevision}^{commit}`], forkRepo).trim();
	const forkTree = git(['rev-parse', '--verify', `${forkTreeRevision ?? forkCommit}:vscode`], forkRepo).trim();
	const before = tree([`--git-dir=${upstreamGitDir}`, 'ls-tree', base]);
	const after = tree(['ls-tree', forkTree], forkRepo);
	const changes = [];
	for (const file of [...new Set([...before.keys(), ...after.keys()])].sort(compare)) {
		const old = before.get(file), current = after.get(file);
		if (old && current && old.mode === current.mode && old.object === current.object && old.type === current.type) { continue; }
		const status = !old ? 'added' : !current ? 'deleted' : 'modified';
		const exception = (status === 'deleted' ? policy.removals : policy.upstreamEdits).find(entry => matchesPath(file, entry));
		changes.push({ path: file, subsystem: subsystem(file), status, before: old ?? null, after: current ?? null, modeChanged: !!old && !!current && old.mode !== current.mode, openidePrefixed: /openide/i.test(file), exception: exception ?? null });
	}
	const totals = { added: 0, modified: 0, deleted: 0, modeChanged: 0, nonOpenideAdditions: 0, unexpectedDeletions: 0 };
	const subsystems = {};
	for (const change of changes) {
		totals[change.status]++;
		if (change.modeChanged) { totals.modeChanged++; }
		if (change.status === 'added' && !change.openidePrefixed) { totals.nonOpenideAdditions++; }
		if (change.status === 'deleted' && !change.exception) { totals.unexpectedDeletions++; }
		const group = subsystems[change.subsystem] ??= { added: 0, modified: 0, deleted: 0 };
		group[change.status]++;
	}
	return { schemaVersion: 1, exceptionPolicySha256: createHash('sha256').update(JSON.stringify(policy)).digest('hex'), countingPolicy: 'path identity; no rename detection; blob/type/mode changes count once', source: forkTreeRevision ? 'index snapshot' : 'committed trees', baseCommit: base, forkCommit, forkTree, totals, subsystems, changes };
}
export function summary(report) {
	return [`Upstream: ${report.baseCommit}`, `Fork: ${report.forkCommit}`, `Tree: ${report.forkTree} (${report.source})`, report.countingPolicy, '', ...Object.entries(report.totals).map(([key, value]) => `${key}: ${value}`), '', 'Subsystem\tadded\tmodified\tdeleted', ...Object.entries(report.subsystems).sort(([a], [b]) => compare(a, b)).map(([name, counts]) => `${name}\t${counts.added}\t${counts.modified}\t${counts.deleted}`), '', ...report.changes.filter(change => change.status === 'deleted' && !change.exception).map(change => `UNEXPECTED DELETION: ${change.path}`)].join('\n') + '\n';
}
export function writeReport(directory, report, worktree) {
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, 'fork-delta.json'), JSON.stringify(report, null, 2) + '\n');
	fs.writeFileSync(path.join(directory, 'fork-delta.txt'), summary(report));
	if (worktree !== undefined) { fs.writeFileSync(path.join(directory, 'worktree-status.json'), JSON.stringify({ porcelainV1: worktree }, null, 2) + '\n'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const options = {};
		for (let index = 2; index < process.argv.length; index += 2) {
			const key = process.argv[index];
			if (!['--upstream-git-dir', '--base', '--fork-repo', '--fork-revision', '--manifest', '--output'].includes(key) || !process.argv[index + 1]) { throw new Error(`Unknown or incomplete option: ${key}`); }
			options[key] = process.argv[index + 1];
		}
		if (!options['--upstream-git-dir'] || !options['--base']) { throw new Error('Usage: node dev/audit-fork-delta.mjs --upstream-git-dir <store> --base <commit> [--fork-repo .] [--fork-revision HEAD] [--output <directory>]'); }
		const forkRepo = path.resolve(options['--fork-repo'] ?? '.');
		const report = inventory({ upstreamGitDir: path.resolve(options['--upstream-git-dir']), baseCommit: options['--base'], forkRepo, forkRevision: options['--fork-revision'] ?? 'HEAD', policy: readPolicy(options['--manifest'] ?? path.join(forkRepo, 'dev/codeoss-preserved-paths.json')) });
		const status = git(['status', '--porcelain=v1', '-z'], forkRepo).split('\0').filter(Boolean);
		if (options['--output']) { writeReport(options['--output'], report, status); }
		console.log(summary(report));
		console.log(`Worktree: ${status.length ? 'dirty (excluded from committed inventory)' : 'clean'}`);
		if (report.totals.unexpectedDeletions) { process.exitCode = 1; }
	} catch (error) { console.error(error.message); process.exitCode = 1; }
}
