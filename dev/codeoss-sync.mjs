#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory, matchesPath, readPolicy, writeReport } from './audit-fork-delta.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const stateFile = git('rev-parse', '--git-path', 'openide-codeoss-sync.json');
const reportDir = path.join(root, '.build/codeoss-sync/reports');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const metadata = readJson('openide-version.json');
const managed = ['vscode', 'openide-version.json', '.nvmrc'];
let policy;
const upstreamGitDir = path.resolve(git('rev-parse', '--git-dir'));
let state;
let validations = [];
function publish(error) {
	fs.mkdirSync(reportDir, { recursive: true });
	writeJson(path.join(reportDir, 'sync-result.json'), { state: state ?? null, error: error ?? null, conflicts: git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean), validations });
}
function audit(base, staged = false) {
	const report = inventory({ upstreamGitDir, baseCommit: base, forkRepo: root, forkRevision: 'HEAD', forkTreeRevision: staged ? git('write-tree') : undefined, policy });
	writeReport(reportDir, report, git('status', '--porcelain=v1', '-z').split('\0').filter(Boolean));
	if (report.totals.unexpectedDeletions) { throw new Error(`Unexpected fork deletions: review ${reportDir}/fork-delta.txt and declare intentional removals before syncing.`); }
}
function runValidation(label, command, args) {
	const log = path.join(reportDir, `${label}.log`);
	const fd = fs.openSync(log, 'w');
	let result;
	try { result = spawnSync(command, args, { cwd: path.join(root, 'vscode'), stdio: ['ignore', fd, fd] }); }
	finally { fs.closeSync(fd); }
	validations.push({ label, passed: result.status === 0, exitCode: result.status, error: result.error?.message ?? null });
	publish();
	if (result.status !== 0) { throw new Error(`Integration check ${label} failed; see ${log}. Base metadata was not advanced. Repair and use --continue.`); }
}
function finish() {
	if (metadata.codeOss.commit !== state.previousCommit || git('rev-parse', 'HEAD') !== state.forkCommit) { throw new Error('The integration base changed. Restore the original HEAD and metadata before continuing.'); }
	if (git('diff', '--name-only', '--diff-filter=U')) { throw new Error('Resolve remaining conflicts and stage them before --continue.'); }
	if (git('diff', '--name-only', '--', ...managed)) { throw new Error('Stage resolved integration changes before --continue; unstaged managed files are present.'); }
	const pkg = readJson('vscode/package.json');
	if (pkg.version !== state.version) { throw new Error(`package.json must declare API ${state.version}.`); }
	const lock = readJson('vscode/package-lock.json');
	lock.version = state.version;
	lock.packages[''].version = state.version;
	writeJson('vscode/package-lock.json', lock);
	fs.copyFileSync('vscode/.nvmrc', '.nvmrc');
	git('add', '--', 'vscode/package-lock.json', '.nvmrc');
	audit(state.commit, true);
	if (process.argv.includes('--prepare')) {
		publish();
		console.log('Integration staged; install dependencies using .nvmrc, then run ./dev/sync-codeoss.sh --continue. Base metadata remains unchanged until validation passes.');
		return;
	}
	const validatedTree = git('write-tree');
	for (const task of ['valid-layers-check', 'typecheck-client', 'transpile-client']) { runValidation(task, 'npm', ['run', task]); }
	runValidation('agent-and-host-tests', process.execPath, ['node_modules/mocha/bin/mocha.js', '--ui', 'tdd', '--timeout', '30000', '--exit', 'out/vs/platform/openideAgentHost/test/common/*.test.js', 'out/vs/platform/openideAgentHost/test/node/*.test.js', 'out/vs/base/parts/ipc/test/common/ipc.test.js', 'out/vs/workbench/contrib/openideAgent/test/common/*.test.js', 'out/vs/workbench/contrib/openideAgent/test/node/*.test.js']);
	if (git('diff', '--name-only', '--', ...managed) || git('diff', '--name-only', '--diff-filter=U')) { throw new Error('Validation changed managed source; review and stage the changes, then --continue.'); }
	if (git('write-tree') !== validatedTree) { throw new Error('The staged tree changed during validation; review and run --continue again.'); }
	metadata.codeOss = { version: state.version, commit: state.commit };
	writeJson('openide-version.json', metadata);
	git('add', '--', 'openide-version.json');
	fs.rmSync(stateFile, { force: true });
	publish();
	console.log(`Code OSS ${state.version} integrated and validated; OpenIDE remains ${metadata.version}. Review subsystem evidence and Node hashes before committing.`);
}
try {
	fs.mkdirSync(reportDir, { recursive: true });
	policy = readPolicy('dev/codeoss-preserved-paths.json');
	if (process.argv.includes('--continue')) {
		state = readJson(stateFile);
		finish();
	} else {
		if (fs.existsSync(stateFile)) { state = readJson(stateFile); throw new Error('Pending integration: resolve it and use --continue.'); }
		if (git('status', '--porcelain=v1', '--untracked-files=all', '--', ...managed) || git('diff', '--name-only', '--diff-filter=U')) { throw new Error('Commit or stash staged, unstaged and untracked changes in managed paths before synchronizing. Unrelated local work can remain.'); }
		const current = metadata.codeOss.commit;
		let ref = process.argv.slice(2).find(arg => arg !== '--prepare');
		if (!ref) {
			const response = await fetch('https://update.code.visualstudio.com/api/update/linux-x64/stable/0000000000000000000000000000000000000000');
			if (!response.ok) { throw new Error(`Could not query stable: HTTP ${response.status}`); }
			ref = (await response.json()).version;
		}
		if (typeof ref !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref)) { throw new Error('Invalid upstream ref.'); }
		if (!git('remote').split('\n').includes('codeoss')) { git('remote', 'add', 'codeoss', 'https://github.com/microsoft/vscode.git'); }
		git('fetch', '--no-tags', 'codeoss', current);
		git('fetch', '--no-tags', 'codeoss', ref);
		const commit = git('rev-parse', 'FETCH_HEAD^{commit}');
		const version = JSON.parse(git('show', `${commit}:package.json`)).version;
		audit(current);
		if (commit === current) { publish(); console.log(`Code OSS ${version} is already integrated.`); }
		else {
			// git apply cannot represent a modify/delete conflict itself: preserve the
			// local file and install the base/ours index stages after other paths apply.
			const modifyDeleteConflicts = [];
			for (const file of git('diff', '--no-renames', '--name-only', '-z', '--diff-filter=D', current, commit).split('\0').filter(Boolean)) {
				if (policy.removals.some(entry => matchesPath(file, entry))) { continue; }
				const before = git('ls-tree', '-z', current, '--', file).split('\t')[0].split(' ');
				const local = git('ls-files', '--stage', '-z', '--', `vscode/${file}`).split('\t')[0].split(' ');
				if (local[1] && (before[0] !== local[0] || before[2] !== local[1])) {
					modifyDeleteConflicts.push({ path: file, baseMode: before[0], baseObject: before[2], localMode: local[0], localObject: local[1] });
				}
			}
			state = { schemaVersion: 1, commit, version, previousCommit: current, forkCommit: git('rev-parse', 'HEAD'), modifyDeleteConflicts };
			const patchFile = git('rev-parse', '--git-path', 'openide-codeoss-sync.patch');
			const fd = fs.openSync(patchFile, 'w');
			try {
				const diff = spawnSync('git', ['diff', '--binary', '--no-renames', current, commit, '--', '.', ...[...policy.removals, ...modifyDeleteConflicts].map(entry => `:(exclude,literal)${entry.path}`)], { stdio: ['ignore', fd, 'inherit'] });
				if (diff.status !== 0) { throw new Error('Could not generate upstream delta.'); }
			} finally { fs.closeSync(fd); }
			const reportFd = fs.openSync(path.join(reportDir, 'upstream.patch'), 'w');
			try {
				const diff = spawnSync('git', ['diff', '--binary', '--no-renames', current, commit], { stdio: ['ignore', reportFd, 'inherit'] });
				if (diff.status !== 0) { throw new Error('Could not write incoming upstream patch report.'); }
			} finally { fs.closeSync(reportFd); }
			const result = fs.statSync(patchFile).size ? spawnSync('git', ['apply', '--3way', '--index', '--directory=vscode', patchFile], { stdio: 'inherit' }) : { status: 0 };
			if (result.status === 0 || git('diff', '--name-only', '--diff-filter=U')) {
				for (const conflict of modifyDeleteConflicts) {
					const file = `vscode/${conflict.path}`;
					execFileSync('git', ['update-index', '-z', '--index-info'], { input: `0 ${'0'.repeat(conflict.baseObject.length)}\t${file}\0${conflict.baseMode} ${conflict.baseObject} 1\t${file}\0${conflict.localMode} ${conflict.localObject} 2\t${file}\0` });
				}
			}
			if (result.status !== 0 || modifyDeleteConflicts.length) {
				if (git('diff', '--name-only', '--diff-filter=U')) { writeJson(stateFile, state); throw new Error('Resolve conflicts, stage them, then run ./dev/sync-codeoss.sh --continue.'); }
				throw new Error(`Delta could not be applied; base metadata remains unchanged. Review ${patchFile}.`);
			}
			writeJson(stateFile, state);
			finish();
		}
	}
} catch (error) {
	publish(error.message);
	console.error(error.message);
	process.exitCode = 1;
}
