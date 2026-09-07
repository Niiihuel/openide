/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { UnavailableOpenideNativeServices } from '../../common/openideNativeServicesUnavailable.js';

suite('OpenIDE native capabilities in unsupported hosts', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('loads native capability consumers without Electron or shared-process services', () => {
		const services = new UnavailableOpenideNativeServices();
		const subscriptions = store.add(new DisposableStore());
		const received: string[] = [];
		subscriptions.add(services.host.onDidRequestIdeTool(() => received.push('tool')));
		subscriptions.add(services.host.onDidChangeMcpServerStatus(() => received.push('mcp')));
		subscriptions.add(services.codebase.onProgress(() => received.push('index')));
		assert.deepStrictEqual({ available: services.available, received }, { available: false, received: [] });
	});

	test('native mutations and provider requests explicitly fail instead of reporting success', async () => {
		const services = new UnavailableOpenideNativeServices();
		const operations = [
			() => services.host.probeShell('echo test'),
			() => services.host.ideServerStop(),
			() => services.browserAutomation.disposeSession(),
			() => services.playwright.getSummary('session', 'page'),
			() => services.codebase.clear('workspace'),
			() => services.requests.request({ url: 'https://example.invalid', callSite: 'test' }, CancellationToken.None),
		];
		for (const operation of operations) {
			await assert.rejects(operation, /requires the desktop application/);
		}
	});
});
