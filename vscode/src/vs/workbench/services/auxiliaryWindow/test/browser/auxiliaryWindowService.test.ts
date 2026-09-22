/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureCodeWindow } from '../../../../../base/browser/window.js';
import { Barrier, DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestContextMenuService, TestEnvironmentService, TestHostService, TestLayoutService } from '../../../../test/browser/workbenchTestServices.js';
import { AuxiliaryWindow } from '../../browser/auxiliaryWindowService.js';

suite('Auxiliary window disposal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture() {
		const frame = document.body.appendChild(document.createElement('iframe'));
		store.add(toDisposable(() => frame.remove()));
		const targetWindow = frame.contentWindow!;
		ensureCodeWindow(targetWindow, 9401);
		const styles = new Barrier();
		styles.open();
		const window = store.add(new AuxiliaryWindow(targetWindow, targetWindow.document.body, styles, new TestConfigurationService(), new TestHostService(), TestEnvironmentService, new TestContextMenuService(), new TestLayoutService()));
		return { window, targetWindow };
	}

	test('owner disposal closes without starting another asynchronous unload veto', () => {
		const { window, targetWindow } = fixture();
		let preparations = 0;
		let closeAccepted = false;
		store.add(window.onBeforeUnload(event => event.join(async () => { preparations++; return true; })));
		store.add(window.onWillDispose(() => {
			closeAccepted = targetWindow.dispatchEvent(new Event('beforeunload', { cancelable: true }));
		}));
		window.dispose();
		assert.deepStrictEqual({ preparations, closeAccepted }, { preparations: 0, closeAccepted: true });
	});

	test('normal user close still waits for preparation and respects cancellation', async () => {
		const { window, targetWindow } = fixture();
		let preparations = 0;
		store.add(window.onBeforeUnload(event => event.join(async () => { preparations++; return false; })));
		const event = new Event('beforeunload', { cancelable: true });
		targetWindow.dispatchEvent(event);
		await timeout(0);
		assert.deepStrictEqual({ preparations, prevented: event.defaultPrevented }, { preparations: 1, prevented: true });
	});

	test('disposal can close while a prior user close preparation is pending', async () => {
		const { window, targetWindow } = fixture();
		const preparation = new DeferredPromise<boolean>();
		let preparations = 0;
		let closeAccepted = false;
		store.add(window.onBeforeUnload(event => event.join(() => { preparations++; return preparation.p; })));
		const first = new Event('beforeunload', { cancelable: true });
		targetWindow.dispatchEvent(first);
		store.add(window.onWillDispose(() => {
			closeAccepted = targetWindow.dispatchEvent(new Event('beforeunload', { cancelable: true }));
		}));
		window.dispose();
		await preparation.complete(true);
		await timeout(0);
		assert.deepStrictEqual({ preparations, firstPrevented: first.defaultPrevented, closeAccepted }, { preparations: 1, firstPrevented: true, closeAccepted: true });
	});
});
