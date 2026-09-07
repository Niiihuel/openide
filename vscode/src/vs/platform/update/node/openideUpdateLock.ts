/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { localize } from '../../../nls.js';

/**
 * Hold a Linux advisory lock until release or the caller's pipe closes (including SIGKILL).
 * Never unlink the lock file: unlinking would let another process lock a different inode.
 * The launcher uses the same flock protocol before touching the update journal.
 */
export function acquireOpenideUpdateLock(path: string, waitSeconds = 0): Promise<() => Promise<void>> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.env['OPENIDE_FLOCK'] || 'flock', [...(waitSeconds ? ['-w', String(waitSeconds)] : ['-n']), '-x', path, 'sh', '-c', 'printf "locked\\n"; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
		const closed = new Promise<void>(done => child.once('close', () => done()));
		let acquired = false;
		const timer = setTimeout(() => { child.stdin.end(); child.kill(); reject(new Error(localize('openide.update.lockTimeout', "Timed out acquiring the update lock."))); }, 10000);
		child.stdin.on('error', () => { /* The lock holder may exit before stdin is closed. */ });
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('close', () => {
			clearTimeout(timer);
			if (!acquired) { reject(new Error(localize('openide.update.lockBusy', "Another OpenIDE process is updating this installation."))); }
		});
		child.stdout.once('data', () => {
			clearTimeout(timer);
			acquired = true;
			resolve(async () => { child.stdin.end(); await closed; });
		});
	});
}
