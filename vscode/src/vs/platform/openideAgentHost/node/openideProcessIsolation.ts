/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { lstat, opendir, realpath } from 'fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'path';
import { promisify } from 'util';
import { findExecutable } from '../../../base/node/processes.js';
import { IOpenidePreparedProcess, IOpenideProcessIsolationRequest, IOpenideProcessIsolationStatus } from '../common/openideProcessIsolation.js';

const execute = promisify(execFile);
const runtimePaths = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/nix/store'];
const configurationPaths = ['/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/ssl/certs', '/etc/passwd', '/etc/group', '/etc/hosts', '/etc/resolv.conf'];
function contains(root: string, candidate: string): boolean { const rest = relative(root, candidate); return !rest || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`)); }

/** Linux argv adapter. Required mode rejects unavailable kernels; it never runs the original argv. */
export class OpenideProcessIsolation {
	constructor(private readonly executable?: string, private readonly platform = process.platform) { }

	async status(): Promise<IOpenideProcessIsolationStatus> {
		if (this.platform !== 'linux') { return { available: false, backend: 'none', reason: 'Process isolation is currently implemented only for Linux.' }; }
		const executable = this.executable ?? await findExecutable('bwrap');
		if (!executable) { return { available: false, backend: 'none', reason: 'bubblewrap is not installed or is not on PATH.' }; }
		try {
			await execute(executable, ['--unshare-all', '--die-with-parent', '--ro-bind', '/', '/', '--', '/bin/sh', '-c', 'exit 0'], { timeout: 5000, maxBuffer: 8192 });
			return { available: true, backend: 'bubblewrap' };
		} catch { return { available: false, backend: 'bubblewrap', reason: 'The kernel or host policy does not permit the required bubblewrap namespaces.' }; }
	}

	async prepare(request: IOpenideProcessIsolationRequest): Promise<IOpenidePreparedProcess> {
		if (!['off', 'required'].includes(request.mode) || !['deny', 'allow'].includes(request.network) || !request.executable || request.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) { throw new Error('Invalid process isolation request.'); }
		if (request.mode === 'off') { return { executable: request.executable, args: [...request.args], cwd: request.cwd, status: { mode: 'off', state: 'off', backend: 'none' } }; }
		const status = await this.status();
		if (!status.available) { throw new Error(`Required process isolation is unavailable: ${status.reason}`); }
		if (!isAbsolute(request.workspaceRoot) || !isAbsolute(request.cwd)) { throw new Error('Isolation requires absolute workspace and working directory paths.'); }
		const [root, cwd] = await Promise.all([realpath(request.workspaceRoot), realpath(request.cwd)]);
		if (root === dirname(root) || ['/tmp', '/home', '/etc', '/proc', '/dev', '/run', '/nix', ...runtimePaths].some(path => root === path || contains(root, path))) { throw new Error('The selected workspace is too broad for process isolation.'); }
		if (!contains(root, cwd)) { throw new Error('The process working directory escapes its workspace.'); }
		await this.validateWorkspace(root, !!request.readonly, request.network === 'deny');
		const program = await findExecutable(request.executable, cwd);
		if (!program) { throw new Error(`The process executable is unavailable: ${request.executable}`); }
		const actualProgram = await realpath(program);
		const wrapper = this.executable ?? await findExecutable('bwrap');
		if (!wrapper) { throw new Error('Required bubblewrap executable disappeared.'); }
		const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv'];
		if (request.network === 'allow') { args.push('--share-net'); }
		for (const source of [...runtimePaths, ...configurationPaths]) { await this.mountReadonly(args, source); }
		args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/tmp/openide-home');
		args.push(request.readonly ? '--ro-bind' : '--bind', root, root);
		await this.mountReadonly(args, join(root, '.git'));
		// Linked worktrees reference a common Git directory outside their root. Make only that
		// metadata readable; commits, index writes and hooks remain outside the process grant.
		try {
			const { stdout } = await execute('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 5000, maxBuffer: 8192 });
			await this.mountReadonly(args, stdout.trim());
		} catch { /* A workspace need not be a Git repository. */ }
		if (!runtimePaths.some(runtime => contains(runtime, actualProgram)) && !contains(root, actualProgram)) { args.push('--ro-bind', actualProgram, actualProgram); }
		const executablePaths = [...new Set([dirname(actualProgram), '/usr/bin', '/bin', '/usr/sbin', '/sbin', ...(process.env.PATH ?? '').split(':').filter(path => path.startsWith('/nix/store/'))])];
		for (const [key, value] of Object.entries({ PATH: executablePaths.join(':'), HOME: '/tmp/openide-home', TMPDIR: '/tmp', TERM: 'xterm-256color', LANG: 'C.UTF-8', GIT_OPTIONAL_LOCKS: '0' })) { args.push('--setenv', key, value); }
		args.push('--chdir', cwd, '--', actualProgram, ...request.args);
		return { executable: wrapper, args, cwd, status: { mode: 'required', state: 'confined', backend: 'bubblewrap' } };
	}

	private async mountReadonly(args: string[], source: string): Promise<void> {
		try {
			args.push('--ro-bind', await realpath(source), source);
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
	}

	private async validateWorkspace(root: string, readonly: boolean, denyNetwork: boolean): Promise<void> {
		const directories = [root];
		let visited = 0;
		while (directories.length) {
			const directory = directories.pop()!;
			for await (const entry of await opendir(directory)) {
				if (++visited > 250000) { throw new Error('Workspace isolation preflight exceeded its entry budget.'); }
				if (directory === root && entry.name === '.git') { continue; }
				const file = join(directory, entry.name);
				const metadata = await lstat(file);
				if (metadata.isDirectory()) { directories.push(file); }
				if ((!readonly && metadata.isFile() && metadata.nlink > 1) || (denyNetwork && metadata.isSocket())) {
					throw new Error('Workspace contains a hard-linked writable file or a local socket that cannot be confined safely.');
				}
			}
		}
	}
}
