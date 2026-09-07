/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { FileService } from '../../../files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../files/node/diskFileSystemProvider.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IMeteredConnectionService } from '../../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../../product/common/productService.js';
import { IRequestService } from '../../../request/common/request.js';
import { IApplicationStorageMainService } from '../../../storage/electron-main/storageMainService.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { IUpdate, StateType, UpdateType } from '../../common/update.js';
import { Win32UpdateService } from '../../electron-main/updateService.win32.js';

class TestWindowsUpdateService extends Win32UpdateService {
	cacheDirectory = '';
	update: IUpdate = { version: 'build', url: 'https://example.test/installer', size: 6, sha256hash: createHash('sha256').update('signed').digest('hex') };
	override get cachePath() { return Promise.resolve(this.cacheDirectory); }
	protected override getUpdateType() { return UpdateType.Setup; }
	override async _isLatestVersion() { return { lastest: false, update: this.update }; }
	check(): void { this.quality = 'stable'; this.doCheckForUpdates(true); }
}

suite('OpenIDE Windows update cache', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	for (const scenario of ['valid cache', 'corrupt cache', 'missing cache', 'invalid download'] as const) {
		test(scenario, async () => {
			const dir = await mkdtemp(join(tmpdir(), 'openide-win-update-'));
			try {
				const log = store.add(new NullLogService());
				const files = store.add(new FileService(log));
				store.add(files.registerProvider('file', store.add(new DiskFileSystemProvider(log))));
				let requests = 0;
				const updater = store.add(new TestWindowsUpdateService(
					new class extends mock<ILifecycleMainService>() { override when() { return new Promise<void>(() => { }); } override setRelaunchHandler() { } },
					new TestConfigurationService({ update: { enableWindowsBackgroundUpdates: false } }),
					NullTelemetryService,
					new class extends mock<IEnvironmentMainService>() { override readonly isBuilt = false; },
					new class extends mock<IRequestService>() { override async request() { requests++; return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(scenario === 'invalid download' ? 'broken' : 'signed')) }; } },
					log, files,
					new class extends mock<INativeHostMainService>() { },
					new class extends mock<IProductService>() { override readonly applicationName = 'openide'; override readonly nameShort = 'OpenIDE'; override readonly quality = 'stable'; override readonly target = 'user'; override readonly commit = 'old'; },
					new class extends mock<IApplicationStorageMainService>() { },
					new class extends mock<IMeteredConnectionService>() { override readonly onDidChangeIsConnectionMetered = Event.None; }
				));
				updater.cacheDirectory = dir;
				const installer = join(dir, 'OpenIDE-stable-build.exe');
				if (scenario !== 'missing cache') { await writeFile(installer, scenario === 'valid cache' ? 'signed' : 'broken'); }
				const finished = new Promise<void>(resolve => {
					const listener = updater.onStateChange(state => { if (state.type === StateType.Ready || state.type === StateType.Idle) { listener.dispose(); resolve(); } });
					store.add(listener);
				});
				updater.check();
				await finished;
				if (scenario === 'invalid download') {
					assert.strictEqual(updater.state.type, StateType.Idle);
					await assert.rejects(readFile(installer), { code: 'ENOENT' });
				} else {
					assert.deepStrictEqual({ state: updater.state.type, requests, bytes: await readFile(installer, 'utf8') }, { state: StateType.Ready, requests: scenario === 'valid cache' ? 0 : 1, bytes: 'signed' });
				}
			} finally { await rm(dir, { recursive: true, force: true }); }
		});
	}
});
