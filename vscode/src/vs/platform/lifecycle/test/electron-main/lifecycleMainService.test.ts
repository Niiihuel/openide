/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IAuxiliaryWindow } from '../../../auxiliaryWindow/electron-main/auxiliaryWindow.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { InMemoryTestStateMainService } from '../../../test/electron-main/workbenchTestServices.js';
import { INativeWindowConfiguration } from '../../../window/common/window.js';
import { ICodeWindow, ILoadEvent, LoadReason, UnloadReason } from '../../../window/electron-main/window.js';
import { LifecycleMainService } from '../../electron-main/lifecycleMainService.js';

suite('Agents runtime lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let nextId = 1;

	class TestLifecycle extends LifecycleMainService {
		readonly unloads: { windowId: number; reason: UnloadReason }[] = [];
		veto = false;
		constructor() { super(new NullLogService(), new InMemoryTestStateMainService(), upcastPartial<IEnvironmentMainService>({ args: { _: [] } })); }
		override async unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean> {
			this.unloads.push({ windowId: window.id, reason });
			return this.veto;
		}
	}

	function nativeWindow(visible: boolean) {
		const events = new EventEmitter();
		let closed = false;
		let showCount = 0;
		const native: BrowserWindow = upcastPartial<BrowserWindow>({
			on: (event, listener) => { events.on(event, listener); return native; },
			removeListener: (event, listener) => { events.removeListener(event, listener); return native; },
			isVisible: () => visible,
			isDestroyed: () => closed,
			hide: () => { visible = false; },
			show: () => { showCount++; visible = true; },
			close: () => {
				let prevented = false;
				events.emit('close', { preventDefault: () => { prevented = true; } });
				if (!prevented) { destroy(); }
			},
		});
		const destroy = () => { if (!closed) { closed = true; events.emit('closed'); } };
		store.add(toDisposable(destroy));
		return { native, get closed() { return closed; }, get showCount() { return showCount; } };
	}

	function owner(service: TestLifecycle, visible: boolean, hiddenOwner = true) {
		const host = nativeWindow(visible);
		const willLoad = store.add(new Emitter<ILoadEvent>());
		let config: INativeWindowConfiguration | undefined;
		const window = upcastPartial<ICodeWindow>({
			id: nextId++, win: host.native, onWillLoad: willLoad.event,
			get config() { return config; }, close: () => host.native.close(),
		});
		service.registerWindow(window);
		// CodeWindow gets its configuration on first load, after lifecycle registration.
		config = upcastPartial<INativeWindowConfiguration>({ openideAgentWindowOwner: hiddenOwner });
		willLoad.fire({ reason: LoadReason.INITIAL, workspace: undefined });
		return { window, host };
	}

	function companion(service: TestLifecycle, parentId: number) {
		const host = nativeWindow(true);
		service.registerAuxWindow(upcastPartial<IAuxiliaryWindow>({ id: nextId++, parentId, win: host.native, keepWorkbenchAlive: true }));
		return host;
	}

	test('closing the final companion closes an initially hidden owner through normal unload', async () => {
		const service = store.add(new TestLifecycle());
		const { window, host } = owner(service, false);
		const first = companion(service, window.id);
		const last = companion(service, window.id);
		first.native.close();
		assert.strictEqual(host.closed, false);
		last.native.close();
		await timeout(0);
		assert.deepStrictEqual({ closed: host.closed, showCount: host.showCount, unloads: service.unloads }, { closed: true, showCount: 0, unloads: [{ windowId: window.id, reason: UnloadReason.CLOSE }] });
	});

	test('a dirty-close veto keeps the owner visible and alive for user resolution', async () => {
		const service = store.add(new TestLifecycle());
		service.veto = true;
		const { window, host } = owner(service, false);
		companion(service, window.id).native.close();
		await timeout(0);
		assert.deepStrictEqual({ closed: host.closed, visible: host.native.isVisible(), showCount: host.showCount, unloads: service.unloads.length }, { closed: false, visible: true, showCount: 1, unloads: 1 });
	});

	test('closing companions preserves a visible IDE, including a revealed Agents owner', async () => {
		const service = store.add(new TestLifecycle());
		const regular = owner(service, true, false);
		const revealed = owner(service, true);
		companion(service, regular.window.id).native.close();
		companion(service, revealed.window.id).native.close();
		await timeout(0);
		assert.deepStrictEqual({ closed: [regular.host.closed, revealed.host.closed], unloads: service.unloads }, { closed: [false, false], unloads: [] });
	});
});
