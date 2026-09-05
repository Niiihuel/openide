/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Action } from '../../../../../base/common/actions.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IActionViewItemFactory, IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IStorageService, InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IUpdateService, State } from '../../../../../platform/update/common/update.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IChatService } from '../../../chat/common/chatService/chatService.js';
import { UpdateTitleBarContribution, UpdateTitleBarEntry } from '../../browser/updateTitleBarEntry.js';
import { UpdateTooltip } from '../../browser/updateTooltip.js';

suite('OpenIDE update announcement', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(focused = true, enabled = true) {
		const instantiation = store.add(new TestInstantiationService());
		const states = store.add(new Emitter<State>());
		const focus = store.add(new Emitter<boolean>());
		let factory: IActionViewItemFactory | undefined;
		const shown: boolean[] = [];
		instantiation.stub(IActionViewItemService, { register: (_menu: MenuId, _command: string | MenuId, provider: IActionViewItemFactory) => {
			factory = provider;
			return toDisposable(() => { });
		} });
		instantiation.stub(IChatService, { requestInProgressObs: observableValue('request', false) });
		instantiation.stub(IConfigurationService, new TestConfigurationService({ update: { titleBar: enabled } }));
		instantiation.stub(IContextKeyService, new MockContextKeyService());
		instantiation.stub(IHostService, { hadLastFocus: async () => focused, onDidChangeFocus: focus.event });
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		instantiation.stub(IUpdateService, { state: State.Uninitialized, onStateChange: states.event });
		instantiation.stubInstance(UpdateTooltip, { renderState: () => { }, dispose: () => { } });
		instantiation.stubInstance(UpdateTitleBarEntry, { showTooltip: (takeFocus = false) => { shown.push(takeFocus); } });
		const contribution = store.add(instantiation.createInstance(UpdateTitleBarContribution));
		assert(factory);
		factory(store.add(new Action('update', 'Update')), {}, instantiation, 1);
		return { states, shown, contribution, focus: () => { focused = true; focus.fire(true); } };
	}

	test('announces a detected update without taking keyboard focus', async () => {
		const f = setup();
		await timeout(0);
		f.states.fire(State.AvailableForDownload({ version: 'build', productVersion: '1.2.0' }));
		await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
		f.states.fire(State.Ready({ version: 'build', productVersion: '1.2.0' }, false, false));
		await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
	});

	test('defers the automatic popover until the window receives focus', async () => {
		const f = setup(false);
		f.states.fire(State.AvailableForDownload({ version: 'build', productVersion: '1.2.0' }));
		await timeout(0);
		assert.deepStrictEqual(f.shown, []);
		f.focus();
		await timeout(0);
		assert.deepStrictEqual(f.shown, [false]);
	});

	test('respects a disabled title bar indicator', async () => {
		const f = setup(true, false);
		f.states.fire(State.AvailableForDownload({ version: 'build', productVersion: '1.2.0' }));
		await timeout(0);
		assert.deepStrictEqual(f.shown, []);
	});
});
