/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { lstat, mkdtemp, readFile, readlink, realpath, rename, rm, writeFile } from 'fs/promises';
import { devNull, tmpdir } from 'os';
import { dirname, isAbsolute, join, relative, sep } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { IOpenideSubagentWorktree, IOpenideSubagentWorktreeApplyResult } from '../common/openideProcessIsolation.js';

const execute = promisify(execFile);
const maximumPatchBytes = 64 * 1024 * 1024;
interface IEntry { readonly mode: string; readonly object: string }
interface ILease extends IOpenideSubagentWorktree { readonly source: string; readonly container: string; readonly gitFile: string; shellPids: number[]; applied: boolean }
const applying = new Set<string>();
const activeContainers = new Set<string>();
const discarding = new Set<string>();
interface IPersistedLease extends ILease { readonly version: 2; readonly ownerPid: number; readonly released: boolean }
function inside(root: string, candidate: string): boolean { const rest = relative(root, candidate); return !rest || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`)); }

/** Window-owned detached worktrees; explicit apply preserves the source branch, index and dirty files. */
export class OpenideSubagentWorktrees {
	private readonly leases = new Map<string, ILease>();
	private readonly creating = new Set<string>();
	private readonly markerWrites = new Map<string, Promise<void>>();
	private disposed = false;

	async create(runId: string, workspaceRoot: string): Promise<IOpenideSubagentWorktree> {
		if (this.disposed || !runId || runId.length > 256 || this.leases.has(runId) || this.creating.has(runId) || !isAbsolute(workspaceRoot)) { throw new Error('Invalid or duplicate subagent worktree request.'); }
		this.creating.add(runId);
		let container: string | undefined;
		try {
			const source = await realpath(workspaceRoot);
			const repository = (await this.git(source, ['rev-parse', '--show-toplevel'])).trim();
			if (await realpath(repository) !== source) { throw new Error('Subagent worktrees require the repository root, not a nested folder.'); }
			await this.rejectExternalFilters(source);
			if ((await this.git(source, ['status', '--porcelain', '--untracked-files=normal'])).trim()) { throw new Error('Commit or stash local changes before creating an isolated subagent worktree.'); }
			const baseCommit = (await this.git(source, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
			container = await realpath(await mkdtemp(join(tmpdir(), 'openide-subagent-worktree-')));
			const path = join(container, 'workspace');
			await this.git(source, ['worktree', 'add', '--detach', '--', path, baseCommit]);
			if (this.disposed) { await this.git(source, ['worktree', 'remove', '--force', '--', path]); throw new Error('The worktree owner disconnected during creation.'); }
			const lease: ILease = { runId, path, baseCommit, source, container, gitFile: await readFile(join(path, '.git'), 'utf8'), shellPids: [], applied: false };
			await this.persist(lease, false);
			activeContainers.add(container);
			this.leases.set(runId, lease);
			return { runId, path, baseCommit };
		} catch (error) { if (container) { await rm(container, { recursive: true, force: true }); } throw error; }
		finally { this.creating.delete(runId); }
	}

	async trackShell(workspaceRoot: string, pid: number): Promise<void> {
		if (this.disposed || !Number.isSafeInteger(pid) || pid <= 0) { throw new Error('The worktree process owner is unavailable.'); }
		const lease = [...this.leases.values()].find(lease => lease.path === workspaceRoot);
		if (!lease) { return; }
		if (applying.has(lease.source) || discarding.has(lease.container)) { throw new Error('Cannot launch a worktree shell during apply or discard.'); }
		if (!lease.shellPids.includes(pid)) { lease.shellPids.push(pid); await this.persist(lease, false); }
	}

	private requireStopped(lease: ILease): void {
		for (const pid of lease.shellPids ?? []) {
			try { process.kill(pid, 0); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { continue; } }
			throw new Error('A recorded worktree shell process may still be running; stop it before apply, discard or recovery.');
		}
	}

	async apply(runId: string): Promise<IOpenideSubagentWorktreeApplyResult> {
		const lease = this.lease(runId);
		this.requireStopped(lease);
		if (discarding.has(lease.container)) { throw new Error('Cannot apply a worktree while discard is active.'); }
		if (lease.applied) { throw new Error('This worktree has already been applied.'); }
		if (applying.has(lease.source)) { throw new Error('Another subagent is applying changes to this repository.'); }
		applying.add(lease.source);
		const snapshotIndex = join(lease.container, `snapshot-${randomUUID()}`);
		const targetIndex = join(lease.container, `target-${randomUUID()}`);
		try {
			await this.verifyLease(lease);
			await this.rejectExternalFilters(lease.source);
			await this.rejectExternalFilters(lease.path);
			if ((await this.git(lease.source, ['rev-parse', 'HEAD'])).trim() !== lease.baseCommit) { throw new Error('The repository HEAD changed after this worktree was created.'); }
			const base = await this.tree(lease.source, lease.baseCommit);
			await this.git(lease.path, ['read-tree', lease.baseCommit], snapshotIndex);
			const tracked = (await this.git(lease.path, ['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--name-only', '-z', lease.baseCommit])).split('\0').filter(Boolean);
			const untracked = (await this.git(lease.path, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
			let capturedBytes = 0;
			for (const file of [...new Set([...tracked, ...untracked])]) {
				const previous = base.get(file);
				const current = await this.entry(lease.path, file, lease.source);
				if (current?.mode === '120000' || current?.mode === '160000') {
					if (previous?.mode === current.mode && previous.object === current.object) { continue; }
					throw new Error(`Subagent apply does not support changed symlinks or submodules: ${file}`);
				}
				if (previous?.mode === '120000' || previous?.mode === '160000') { throw new Error(`Subagent apply does not support removing or replacing links: ${file}`); }
				if (current?.bytes) { capturedBytes += current.bytes; }
				if (capturedBytes > maximumPatchBytes) { throw new Error('Worktree snapshot exceeds the apply byte budget.'); }
				if (previous?.mode === current?.mode && previous?.object === current?.object) { continue; }
				const update = current ? `${current.mode} ${current.object}\t${file}\0` : `0 ${'0'.repeat(lease.baseCommit.length)}\t${file}\0`;
				await this.gitInput(lease.path, ['update-index', '-z', '--index-info'], update, snapshotIndex);
			}
			const changedPaths = (await this.git(lease.path, ['diff', '--cached', '--no-renames', '--name-only', '-z', lease.baseCommit], snapshotIndex)).split('\0').filter(Boolean);
			if (changedPaths.length > 1024) { throw new Error('Too many files changed for one subagent apply.'); }
			if (!changedPaths.length) { lease.applied = true; await this.persist(lease, this.disposed); return { changedPaths }; }
			// Raw content checks also catch assume-unchanged files and ignored untracked collisions.
			for (const file of changedPaths) {
				const previous = base.get(file);
				const current = await this.entry(lease.source, file, lease.source);
				if (previous?.mode !== current?.mode || previous?.object !== current?.object) { throw new Error(`Local changes conflict with subagent apply: ${file}`); }
			}
			if ((await this.git(lease.source, ['diff', '--cached', '--name-only', lease.baseCommit, '--', ...changedPaths])).trim()) { throw new Error('Staged local changes conflict with subagent apply.'); }
			const patch = await this.git(lease.path, ['diff', '--cached', '--binary', '--no-renames', '--no-ext-diff', '--no-textconv', lease.baseCommit], snapshotIndex);
			// All Git staging happens in private indexes. The main index retains unrelated staged
			// work, and the applied delta is left unstaged for the user to inspect and commit.
			await this.git(lease.source, ['read-tree', lease.baseCommit], targetIndex);
			// Refresh stat data; unrelated dirty paths may report failure. Apply still checks every
			// touched preimage against this private base index immediately before mutation.
			await this.git(lease.source, ['update-index', '--refresh'], targetIndex).catch(() => undefined);
			await this.gitInput(lease.source, ['apply', '--check', '--index', '--binary', '--whitespace=nowarn', '-'], patch, targetIndex);
			if ((await this.git(lease.source, ['rev-parse', 'HEAD'])).trim() !== lease.baseCommit) { throw new Error('The repository HEAD changed during apply.'); }
			await this.gitInput(lease.source, ['apply', '--index', '--binary', '--whitespace=nowarn', '-'], patch, targetIndex);
			lease.applied = true;
			await this.persist(lease, this.disposed);
			return { changedPaths };
		} finally {
			applying.delete(lease.source);
			await Promise.all([rm(snapshotIndex, { force: true }), rm(targetIndex, { force: true })]);
		}
	}

	async discard(runId: string): Promise<void> {
		const lease = this.lease(runId);
		this.requireStopped(lease);
		if (applying.has(lease.source) || discarding.has(lease.container)) { throw new Error('Cannot discard a worktree while apply or discard is active.'); }
		discarding.add(lease.container);
		try {
			await this.verifyLease(lease);
			await this.git(lease.source, ['worktree', 'remove', '--force', '--', lease.path]);
			await rm(lease.container, { recursive: true, force: true });
			this.leases.delete(runId);
			activeContainers.delete(lease.container);
		} finally { discarding.delete(lease.container); }
	}

	/** Lists abandoned worktrees registered with this repository; live owners cannot be adopted. */
	async recoverable(workspaceRoot: string): Promise<IOpenideSubagentWorktree[]> {
		return (await this.orphans(workspaceRoot)).map(({ runId, path, baseCommit }) => ({ runId, path, baseCommit }));
	}

	async recover(runId: string, workspaceRoot: string): Promise<IOpenideSubagentWorktree> {
		if (this.disposed || this.leases.has(runId)) { throw new Error('Invalid or duplicate worktree recovery.'); }
		const matches = (await this.orphans(workspaceRoot)).filter(lease => lease.runId === runId);
		if (matches.length !== 1) { throw new Error('No unique abandoned worktree is available for this run.'); }
		const lease = matches[0];
		if (activeContainers.has(lease.container)) { throw new Error('This worktree already has a live owner.'); }
		activeContainers.add(lease.container);
		try { await this.persist(lease, false); } catch (error) { activeContainers.delete(lease.container); throw error; }
		this.leases.set(runId, lease);
		return { runId, path: lease.path, baseCommit: lease.baseCommit };
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		// Disconnect relinquishes ownership, never deletes potentially valuable agent output.
		await Promise.allSettled([...this.leases.values()].map(async lease => {
			await this.persist(lease, true);
			activeContainers.delete(lease.container);
		}));
		this.leases.clear();
	}

	private persist(lease: ILease, released: boolean): Promise<void> {
		// Concurrent shell launches must not let an older marker erase a later live PID.
		const operation = (this.markerWrites.get(lease.container) ?? Promise.resolve()).catch(() => undefined).then(async () => {
			const temporary = join(lease.container, `lease-${randomUUID()}.json`);
			await writeFile(temporary, JSON.stringify({ ...lease, version: 2, ownerPid: process.pid, released }), { mode: 0o600 });
			await rename(temporary, join(lease.container, 'lease.json'));
		});
		this.markerWrites.set(lease.container, operation);
		const cleanup = () => { if (this.markerWrites.get(lease.container) === operation) { this.markerWrites.delete(lease.container); } };
		operation.then(cleanup, cleanup);
		return operation;
	}

	private async orphans(workspaceRoot: string): Promise<ILease[]> {
		const source = await realpath(workspaceRoot);
		if (applying.has(source)) { return []; }
		const rows = (await this.git(source, ['worktree', 'list', '--porcelain', '-z'])).split('\0');
		const leases: ILease[] = [];
		for (const row of rows) {
			if (!row.startsWith('worktree ')) { continue; }
			const path = row.slice(9);
			const container = dirname(path);
			if (dirname(container) !== await realpath(tmpdir()) || !container.slice(dirname(container).length + 1).startsWith('openide-subagent-worktree-') || join(container, 'workspace') !== path || activeContainers.has(container)) { continue; }
			try {
				const lease = JSON.parse(await readFile(join(container, 'lease.json'), 'utf8')) as IPersistedLease;
				if (lease.version !== 2 || lease.source !== source || lease.path !== path || lease.container !== container || !lease.runId || !/^[a-f0-9]{40,64}$/.test(lease.baseCommit) || typeof lease.applied !== 'boolean' || typeof lease.gitFile !== 'string' || !Array.isArray(lease.shellPids) || lease.shellPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) { continue; }
				if (!lease.released) {
					try { process.kill(lease.ownerPid, 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { continue; } }
				}
				await this.verifyLease(lease);
				this.requireStopped(lease);
				leases.push(lease);
			} catch { /* Ignore unrelated or invalid registrations rather than modifying them. */ }
		}
		return leases;
	}

	private lease(runId: string): ILease {
		const lease = this.leases.get(runId);
		if (!lease) { throw new Error('No worktree belongs to this owner and run.'); }
		return lease;
	}

	private async verifyLease(lease: ILease): Promise<void> {
		if (await realpath(lease.path) !== lease.path || dirname(lease.path) !== lease.container || await readFile(join(lease.path, '.git'), 'utf8') !== lease.gitFile) { throw new Error('The managed worktree path was replaced.'); }
	}

	private async entry(root: string, file: string, objectStore: string): Promise<(IEntry & { bytes?: number }) | undefined> {
		if (!file || isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.git' || !part)) { throw new Error('Invalid worktree path.'); }
		const path = join(root, file);
		let metadata;
		try { metadata = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
		if (!inside(root, await realpath(dirname(path)))) { throw new Error(`A worktree path escapes through a directory link: ${file}`); }
		if (metadata.isDirectory()) { throw new Error(`Subagent apply does not support submodule directories: ${file}`); }
		if (!metadata.isSymbolicLink() && !metadata.isFile()) { throw new Error(`Unsupported worktree resource: ${file}`); }
		if (metadata.size > maximumPatchBytes) { throw new Error('A worktree file exceeds the apply byte budget.'); }
		const data = metadata.isSymbolicLink() ? await readlink(path) : await readFile(path);
		const object = (await this.gitInput(objectStore, ['hash-object', '-w', '--no-filters', '--stdin'], data)).trim();
		return { mode: metadata.isSymbolicLink() ? '120000' : metadata.mode & 0o111 ? '100755' : '100644', object, bytes: metadata.size };
	}

	private async tree(root: string, revision: string): Promise<Map<string, IEntry>> {
		return new Map((await this.git(root, ['ls-tree', '-rz', revision])).split('\0').filter(Boolean).map(row => { const tab = row.indexOf('\t'); const [mode, , object] = row.slice(0, tab).split(' '); return [row.slice(tab + 1), { mode, object }]; }));
	}

	private async rejectExternalFilters(root: string): Promise<void> {
		let configured: string;
		try { configured = await this.git(root, ['config', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$']); }
		catch (error) { if ((error as { code?: number }).code === 1) { return; } throw error; }
		if (configured.split('\n').some(line => /^\S+\s+\S/.test(line))) { throw new Error('Isolated worktrees do not support repository filter commands, including Git LFS filters.'); }
	}

	private gitEnvironment(index?: string): NodeJS.ProcessEnv {
		const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull };
		for (const key of Object.keys(environment)) { if (key.startsWith('GIT_') && !['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'].includes(key)) { delete (environment as NodeJS.ProcessEnv)[key]; } }
		return { ...environment, ...(index ? { GIT_INDEX_FILE: index } : {}) };
	}

	private async git(root: string, args: readonly string[], index?: string): Promise<string> {
		const { stdout } = await execute('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', maxBuffer: maximumPatchBytes, timeout: 30000, env: this.gitEnvironment(index) });
		return stdout;
	}

	private gitInput(root: string, args: readonly string[], input: string | Buffer, index?: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = execFile('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-C', root, ...args], { encoding: 'utf8', maxBuffer: maximumPatchBytes, timeout: 30000, env: this.gitEnvironment(index) }, (error, stdout) => error ? reject(error) : resolve(stdout));
			child.stdin?.on('error', reject);
			child.stdin?.end(input);
		});
	}
}
