/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IMeteredConnectionService } from '../../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../../product/common/productService.js';
import { IRequestService } from '../../../request/common/request.js';
import { IApplicationStorageMainService } from '../../../storage/electron-main/storageMainService.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { IUpdate, State, StateType } from '../../common/update.js';
import { LinuxUpdateService } from '../../electron-main/updateService.linux.js';

class TestLinuxUpdateService extends LinuxUpdateService {
	readonly check = new DeferredPromise<{ lastest: boolean; update: IUpdate }>();
	checkToken: CancellationToken | undefined;
	override _isLatestVersion(_url: string, _explicit: boolean, token?: CancellationToken) {
		this.checkToken = token;
		return this.check.p;
	}
	beginCheck(): void { this.quality = 'stable'; this.doCheckForUpdates(false); }
	cancel(): Promise<void> { return this.cancelUpdate(); }
	download(): Promise<void> { return this.doDownloadUpdate(State.AvailableForDownload({ version: 'build', productVersion: '1.2.0', url: 'https://example.test/update', size: 3, sha256hash: 'a'.repeat(64) })); }
}

suite('OpenIDE Linux update lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function service(request: IRequestService = new class extends mock<IRequestService>() { }) {
		return store.add(new TestLinuxUpdateService(
			new class extends mock<ILifecycleMainService>() { override when() { return new Promise<void>(() => { }); } },
			new TestConfigurationService(),
			new class extends mock<IEnvironmentMainService>() { override readonly isBuilt = false; },
			request,
			store.add(new NullLogService()),
			new class extends mock<INativeHostMainService>() { },
			new class extends mock<IProductService>() { override readonly updateUrl = 'https://example.test'; override readonly commit = 'build'; },
			NullTelemetryService,
			new class extends mock<IApplicationStorageMainService>() { },
			new class extends mock<IMeteredConnectionService>() { override readonly onDidChangeIsConnectionMetered = Event.None; },
			new class extends mock<IWindowsMainService>() { override getWindows() { return []; } override readonly onDidSignalReadyWindow = Event.None; },
		));
	}

	test('cancels the manifest request and ignores a late response', async () => {
		const updater = service();
		updater.beginCheck();
		await updater.cancel();
		assert.strictEqual(updater.checkToken?.isCancellationRequested, true);
		await updater.check.complete({ lastest: false, update: { version: 'build' } });
		await timeout(0);
		assert.strictEqual(updater.state.type, StateType.CheckingForUpdates);
	});

	test('waits for cancelled download cleanup before completing cancellation', async () => {
		const previous = process.env['OPENIDE_APPIMAGE_PATH'];
		process.env['OPENIDE_APPIMAGE_PATH'] = '/tmp/openide-cancellation-test.AppImage';
		try {
			const requested = new DeferredPromise<void>();
			let requestToken: CancellationToken | undefined;
			const updater = service(new class extends mock<IRequestService>() {
				override async request(_options: Parameters<IRequestService['request']>[0], token: CancellationToken): Promise<never> {
					requestToken = token;
					requested.complete();
					return new Promise((_resolve, reject) => {
						const listener = token.onCancellationRequested(() => { listener.dispose(); reject(new CancellationError()); });
					});
				}
			});
			const download = updater.download();
			await requested.p;
			await updater.cancel();
			assert.strictEqual(requestToken?.isCancellationRequested, true);
			await download;
			assert.notStrictEqual(updater.state.type, StateType.Ready);
		} finally {
			if (previous === undefined) { delete process.env['OPENIDE_APPIMAGE_PATH']; }
			else { process.env['OPENIDE_APPIMAGE_PATH'] = previous; }
		}
	});
});
