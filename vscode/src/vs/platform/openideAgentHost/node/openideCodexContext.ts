/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from '../../../base/common/path.js';
import { OPENIDE_CAPABILITY_INSTRUCTIONS } from '../common/openideCapabilityCatalog.js';

/** Read the CLI's effective value, including trusted project layers, without parsing its TOML ourselves. */
export async function readCodexDeveloperInstructions(executable: string, cwd: string | undefined): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(executable, ['app-server'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
		let pending = '';
		let settled = false;
		const finish = (error?: Error, instructions = '') => {
			if (settled) { return; }
			settled = true;
			clearTimeout(timer);
			child.stdin.end();
			// EOF lets Codex dispose its transports; bound shutdown if an older CLI ignores EOF.
			const stop = setTimeout(() => child.kill(), 1000);
			child.once('exit', () => clearTimeout(stop));
			if (error) { reject(error); } else { resolve(instructions); }
		};
		const timer = setTimeout(() => finish(new Error('Codex configuration discovery timed out')), 10_000);
		const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
		child.once('error', () => finish(new Error('Could not start Codex configuration discovery')));
		child.stdin.on('error', () => finish(new Error('Codex configuration transport closed')));
		child.once('exit', () => finish(new Error('Codex exited before returning its configuration')));
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			if (settled) { return; }
			pending += chunk;
			if (pending.length > 4 * 1024 * 1024) { finish(new Error('Codex configuration response exceeded its limit')); return; }
			let newline: number;
			while (!settled && (newline = pending.indexOf('\n')) !== -1) {
				const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
				let message: { id?: number; error?: object; result?: { config?: { developer_instructions?: string | null } } };
				try { message = JSON.parse(line); } catch { finish(new Error('Invalid Codex configuration response')); return; }
				if (message.id !== 1 && message.id !== 2) { continue; }
				if (message.error) { finish(new Error('Codex rejected configuration discovery')); return; }
				if (message.id === 1) {
					send({ method: 'initialized', params: {} });
					send({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: cwd ?? null } });
				} else {
					const config = message.result?.config;
					if (!config || !Object.hasOwn(config, 'developer_instructions') || (config.developer_instructions !== null && typeof config.developer_instructions !== 'string')) {
						finish(new Error('Codex did not expose its effective developer instructions')); return;
					}
					finish(undefined, config.developer_instructions ?? '');
				}
			}
		});
		send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'openide-context', version: '1.0.0' } } });
	});
}

/** A named launch profile keeps existing instructions out of argv and leaves user config files intact. */
export async function prepareCodexContextProfile(executable: string, cwd: string | undefined, serverName: string): Promise<{ name: string; path: string; instructions: string }> {
	const help = await new Promise<string>((resolve, reject) => execFile(executable, ['--help'], { cwd, windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024 }, (error, stdout) => error ? reject(new Error('Could not inspect Codex profile support')) : resolve(stdout)));
	if (!help.includes('CONFIG_PROFILE_V2')) { throw new Error('This Codex version does not support additive profile files'); }
	const existing = await readCodexDeveloperInstructions(executable, cwd);
	const name = `openide-${randomBytes(12).toString('hex')}`;
	const profileHome = process.env['CODEX_HOME'] || join(homedir(), '.codex');
	const path = join(profileHome, `${name}.config.toml`);
	const guidance = `OpenIDE tools for this session are served by ${serverName}.\n${OPENIDE_CAPABILITY_INSTRUCTIONS}`;
	const instructions = existing ? `${existing}\n\n${guidance}` : guidance;
	await mkdir(profileHome, { recursive: true, mode: 0o700 });
	await writeFile(path, `developer_instructions = ${JSON.stringify(instructions)}\n`, { flag: 'wx', mode: 0o600 });
	return { name, path, instructions };
}
