/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { timeout } from '../../../../../base/common/async.js';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { IRequestContext } from '../../../../../base/parts/request/common/request.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IMeteredConnectionService } from '../../../../../platform/meteredConnection/common/meteredConnection.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { IStorageService, InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { PostUpdateWidgetContribution } from '../../browser/postUpdateWidget.js';

class TestRequestService extends mock<IRequestService>() {
	requestCount = 0;
	body = JSON.stringify({ markdown: '', title: 'Test release', buttons: [{ label: 'Open', commandId: 'test.open' }] });
	override async request(): Promise<IRequestContext> {
		this.requestCount++;
		return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(this.body)) };
	}
}

suite('PostUpdateWidgetContribution (Electron)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const key = 'postUpdateWidget/lastKnownVersion';

	function setup(options: { metered?: boolean; focused?: boolean; previous?: string; current?: string; empty?: boolean; enabled?: boolean } = {}) {
		const requests = new TestRequestService();
		if (options.empty) { requests.body = ''; }
		const config = new TestConfigurationService({ update: { showPostInstallInfo: options.enabled !== false } });
		store.add(config.onDidChangeConfigurationEmitter);
		const storage: IStorageService = store.add(new InMemoryStorageService());
		if (options.previous) { storage.store(key, JSON.stringify({ version: options.previous, timestamp: 0 }), StorageScope.APPLICATION, StorageTarget.MACHINE); }
		const focus = store.add(new Emitter<boolean>());
		let focused = options.focused !== false;
		const shown: boolean[] = [];
		store.add(new PostUpdateWidgetContribution(
			new class extends mock<IAccessibilityService>() { },
			new class extends mock<ICommandService>() { }, config,
			new class extends mock<IHostService>() {
				override hadLastFocus() { return Promise.resolve(focused); }
				override onDidChangeFocus = focus.event;
			},
			new class extends mock<IHoverService>() {
				override showInstantHover(options: Parameters<IHoverService['showInstantHover']>[0], takeFocus?: boolean) {
					shown.push(!!takeFocus);
					const target = options.target;
					store.add(toDisposable(() => { if ('dispose' in target) { target.dispose?.(); } }));
					return new class extends mock<NonNullable<ReturnType<IHoverService['showInstantHover']>>>() { };
				}
			},
			new class extends mock<ILayoutService>() { override mainContainer = document.createElement('div'); },
			new class extends mock<IMarkdownRendererService>() { },
			new class extends mock<IMeteredConnectionService>() { override readonly isConnectionMetered = !!options.metered; },
			new class extends mock<IOpenerService>() { },
			new class extends mock<IProductService>() {
				override readonly version = '1.136.0';
				override readonly openideVersion = options.current ?? '1.3.1';
				// No commit, as in development; announcements must follow the OpenIDE version.
			}, requests, storage,
			new class extends mock<ITelemetryService>() { },
		));
		return { requests, shown, storage, focus: () => { focused = true; focus.fire(true); } };
	}

	test('announces patch releases without commit metadata and without stealing focus', async () => {
		const f = setup({ previous: '1.3.0' });
		await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
		assert.strictEqual(f.storage.getObject<{ version: string }>(key, StorageScope.APPLICATION)?.version, '1.3.1');
		f.focus(); await timeout(0);
		assert.strictEqual(f.requests.requestCount, 1);
	});

	test('defers to the focused window', async () => {
		const f = setup({ previous: '1.2.0', focused: false });
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
		f.focus(); await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
	});

	test('failed fetch is not marked seen and can retry', async () => {
		const f = setup({ previous: '1.3.0', empty: true });
		await timeout(0);
		assert.strictEqual(f.storage.getObject<{ version: string }>(key, StorageScope.APPLICATION)?.version, '1.3.0');
		f.requests.body = JSON.stringify({ markdown: '', title: 'Recovered release' });
		f.focus(); await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
	});

	test('fresh installs establish a baseline', async () => {
		const f = setup();
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
		assert.strictEqual(f.storage.getObject<{ version: string }>(key, StorageScope.APPLICATION)?.version, '1.3.1');
	});

	test('same version does not show again', async () => {
		const f = setup({ previous: '1.3.1' });
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
	});

	test('downgrades do not announce an upgrade', async () => {
		const f = setup({ previous: '1.4.0' });
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
	});

	test('disabled automatic highlights remain available explicitly', async () => {
		const f = setup({ previous: '1.3.0', enabled: false });
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
		await CommandsRegistry.getCommand('_update.showUpdateInfo')!.handler(undefined as never);
		assert.deepStrictEqual(f.shown, [true]);
	});

	test('metered connections preserve the explicit command', async () => {
		const f = setup({ previous: '1.3.0', metered: true });
		await timeout(0);
		assert.strictEqual(f.requests.requestCount, 0);
		await CommandsRegistry.getCommand('_update.showUpdateInfo')!.handler(undefined as never);
		assert.deepStrictEqual(f.shown, [true]);
	});
});
