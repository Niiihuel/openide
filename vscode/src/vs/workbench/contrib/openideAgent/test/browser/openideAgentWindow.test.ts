/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextMenuService, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { ITitleService } from '../../../../services/title/browser/titleService.js';
import { IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { OpenideChatWidget } from '../../browser/chat/openideChatWidget.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideAgentWindow } from '../../browser/openideAgentWindow.js';

suite('OpenIDE agent window lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture() {
		const requests: DeferredPromise<IAuxiliaryWindow>[] = [];
		const focused: Window[] = [];
		const shutdown = store.add(new Emitter<void>());
		const window = store.add(new OpenideAgentWindow(
			upcastPartial<OpenideChatWidget>({}),
			undefined,
			upcastPartial<IAuxiliaryWindowService>({ open: () => {
				const request = new DeferredPromise<IAuxiliaryWindow>();
				requests.push(request);
				return request.p;
			} }),
			upcastPartial<IInstantiationService>({}),
			NullHoverService,
			upcastPartial<IContextViewService>({}),
			upcastPartial<IContextMenuService>({}),
			upcastPartial<IWorkspaceContextService>({}),
			upcastPartial<IHostService>({ focus: async target => { focused.push(target); } }),
			upcastPartial<IStorageService>({ getObject: () => undefined }),
			upcastPartial<IOpenideAgentService>({}),
			upcastPartial<ITitleService>({}),
			upcastPartial<IStatusbarService>({}),
			upcastPartial<IEditorGroupsService>({}),
			new TestConfigurationService(),
			undefined!,
			undefined!,
			undefined!,
			undefined!,
			upcastPartial<ILifecycleService>({ onDidShutdown: shutdown.event }),
		));
		return { window, requests, focused, shutdown };
	}

	function auxiliary(id: number) {
		const unload = store.add(new Emitter<void>());
		const styles = new DeferredPromise<void>();
		let disposed = false;
		const window = upcastPartial<CodeWindow>({ vscodeWindowId: id });
		const auxiliary = upcastPartial<IAuxiliaryWindow>({
			window,
			onUnload: unload.event,
			whenStylesHaveLoaded: styles.p,
			dispose: () => { disposed = true; },
		});
		return { auxiliary, window, unload, get disposed() { return disposed; } };
	}

	test('concurrent opens share the mounting promise even after the native window is created', async () => {
		const f = fixture();
		const first = f.window.open();
		const second = f.window.open();
		assert.strictEqual(first, second);
		const target = auxiliary(100);
		await f.requests[0].complete(target.auxiliary);
		await timeout(0);
		assert.strictEqual(f.window.open(), first);
		target.unload.fire();
		await assert.rejects(first, isCancellationError);
		assert.deepStrictEqual({ requests: f.requests.length, focused: f.focused, disposed: target.disposed }, { requests: 1, focused: [], disposed: true });
	});

	test('closing before stylesheet completion settles opening and permits a fresh native window', async () => {
		const f = fixture();
		const first = f.window.open();
		const initial = auxiliary(101);
		await f.requests[0].complete(initial.auxiliary);
		await timeout(0);
		initial.unload.fire();
		await assert.rejects(first, isCancellationError);
		const reopened = f.window.open();
		assert.strictEqual(f.requests.length, 2);
		const replacement = auxiliary(102);
		await f.requests[1].complete(replacement.auxiliary);
		await timeout(0);
		replacement.unload.fire();
		await assert.rejects(reopened, isCancellationError);
		assert.deepStrictEqual({ disposed: [initial.disposed, replacement.disposed], focused: f.focused }, { disposed: [true, true], focused: [] });
	});

	test('disposal while styles are pending settles opening without waiting for CSS', async () => {
		const f = fixture();
		const pending = f.window.open();
		const target = auxiliary(104);
		await f.requests[0].complete(target.auxiliary);
		await timeout(0);
		f.window.dispose();
		await assert.rejects(pending, isCancellationError);
		assert.strictEqual(target.disposed, true);
	});

	test('disposal during native creation disposes the arriving window without mounting a companion', async () => {
		const f = fixture();
		const pending = f.window.open();
		f.window.dispose();
		const target = auxiliary(103);
		await f.requests[0].complete(target.auxiliary);
		await assert.rejects(pending, isCancellationError);
		assert.strictEqual(target.disposed, true);
	});

	test('workbench shutdown closes the companion before waiting for pagehide or pending styles', async () => {
		const f = fixture();
		const pending = f.window.open();
		const target = auxiliary(105);
		await f.requests[0].complete(target.auxiliary);
		await timeout(0);
		f.shutdown.fire();
		assert.strictEqual(target.disposed, true);
		await assert.rejects(pending, isCancellationError);
	});

	test('workbench shutdown fences a native window that arrives after its owner shuts down', async () => {
		const f = fixture();
		const pending = f.window.open();
		f.shutdown.fire();
		const target = auxiliary(106);
		await f.requests[0].complete(target.auxiliary);
		await assert.rejects(pending, isCancellationError);
		assert.deepStrictEqual({ disposed: target.disposed, focused: f.focused }, { disposed: true, focused: [] });
	});

	test('opening a disposed runtime rejects without creating a native window', async () => {
		const f = fixture();
		f.window.dispose();
		await assert.rejects(f.window.open(), isCancellationError);
		assert.strictEqual(f.requests.length, 0);
	});
});
