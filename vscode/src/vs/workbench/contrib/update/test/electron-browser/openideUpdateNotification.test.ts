/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotification, INotificationService, NoOpNotification, NotificationPriority } from '../../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IUpdateService, State, UpdateType } from '../../../../../platform/update/common/update.js';
import { OpenideUpdateNotificationContribution } from '../../../openideUpdate/browser/openideUpdateNotification.js';
import { SHOW_UPDATE_STATUS_COMMAND_ID } from '../../browser/updateTitleBarEntry.js';

suite('OpenIDE update notification center', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function setup(initial: State = State.Uninitialized, popoverEnabled = true) {
		const instantiation = store.add(new TestInstantiationService());
		const states = store.add(new Emitter<State>());
		const notifications: INotification[] = [];
		const commands: string[] = [];
		let closed = 0;
		instantiation.stub(IUpdateService, { state: initial, onStateChange: states.event });
		instantiation.stub(IProductService, { nameShort: 'OpenIDE', version: '1.136.1', openideVersion: '1.1.0' });
		instantiation.stub(INotificationService, { notify: (notification: INotification) => {
			notifications.push(notification);
			return new class extends NoOpNotification { override close() { closed++; } }();
		} });
		instantiation.stub(ICommandService, { executeCommand: async <R>(id: string) => {
			commands.push(id);
			return popoverEnabled as R;
		} });
		store.add(instantiation.createInstance(OpenideUpdateNotificationContribution));
		return { states, notifications, commands, closed: () => closed };
	}

	const update = { version: 'build', productVersion: '1.2.0' };

	test('records automatic discovery without a second toast and deduplicates progress', () => {
		const f = setup();
		f.states.fire(State.AvailableForDownload(update));
		f.states.fire(State.Downloading(update, false, false, 100, 200));
		f.states.fire(State.Ready(update, false, false));
		assert.deepStrictEqual(f.notifications.map(n => ({ id: n.id, priority: n.priority })), [
			{ id: 'openide.update.available.1.2.0', priority: NotificationPriority.SILENT }
		]);
		assert.match(String(f.notifications[0].message), /1\.2\.0/);
		assert.deepStrictEqual(f.commands, []);
	});

	test('announces an update already known when the window restores', () => {
		const f = setup(State.Ready(update, false, false));
		assert.strictEqual(f.notifications.length, 1);
	});

	test('ignores the installed version and empty metadata', () => {
		const f = setup();
		f.states.fire(State.AvailableForDownload({ version: 'build' }));
		f.states.fire(State.AvailableForDownload({ version: 'build', productVersion: '1.1.0' }));
		assert.deepStrictEqual(f.notifications, []);
	});

	test('clears resolved notifications and announces a different version', () => {
		const f = setup(State.AvailableForDownload(update));
		f.states.fire(State.Idle(UpdateType.Archive));
		assert.strictEqual(f.closed(), 1);
		f.states.fire(State.AvailableForDownload({ ...update, productVersion: '1.2.1' }));
		assert.deepStrictEqual(f.notifications.map(n => n.id), ['openide.update.available.1.2.0', 'openide.update.available.1.2.1']);
	});

	for (const enabled of [true, false]) {
		test(`opens update details with title bar enabled=${enabled}`, async () => {
			const f = setup(State.AvailableForDownload(update), enabled);
			await f.notifications[0].actions?.primary?.[0].run();
			assert.deepStrictEqual(f.commands, enabled ? [SHOW_UPDATE_STATUS_COMMAND_ID] : [SHOW_UPDATE_STATUS_COMMAND_ID, 'openide.update.check']);
		});
	}
});
