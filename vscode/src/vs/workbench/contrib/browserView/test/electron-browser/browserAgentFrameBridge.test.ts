/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../../../../platform/browserView/common/cdp/types.js';
import { IBrowserViewCDPService } from '../../common/browserView.js';
import { BrowserAgentFrameBridge, IBrowserAgentFrame } from '../../electron-browser/browserAgentFrameBridge.js';

class FrameCDPService extends Disposable implements IBrowserViewCDPService {
	declare readonly _serviceBrand: undefined;
	readonly messages = this._register(new Emitter<CDPResponse | CDPEvent>());
	readonly requests: CDPRequest[] = [];
	readonly destroyed: string[] = [];
	delayGroup: (() => Promise<string>) | undefined;
	delayMethod: string | undefined;
	async createSessionGroup(): Promise<string> { return this.delayGroup?.() ?? 'frame-group'; }
	async destroySessionGroup(group: string): Promise<void> { this.destroyed.push(group); }
	onCDPMessage(): Event<CDPResponse | CDPEvent> { return this.messages.event; }
	onDidDestroy(): Event<void> { return Event.None; }
	async sendCDPMessage(_groupId: string, message: CDPRequest): Promise<void> {
		this.requests.push(message);
		if (message.method !== this.delayMethod) {
			const result = message.method === 'Target.getTargets'
				? { targetInfos: [{ targetId: 'target', type: 'page', vscodeBrowserViewId: 'browser' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'frame-session' } : {};
			queueMicrotask(() => this.messages.fire({ id: message.id, result, sessionId: message.sessionId }));
		}
	}
}

suite('BrowserAgentFrameBridge', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };

	test('attaches only to its browser and acknowledges every frame', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		const frames: IBrowserAgentFrame[] = [];
		store.add(bridge.onDidFrame(frame => frames.push(frame)));
		await bridge.start();
		const params = { data: 'fixture', sessionId: 4, metadata: { deviceWidth: 800, deviceHeight: 600, pageScaleFactor: 1.25, offsetTop: 0, scrollOffsetX: 0, scrollOffsetY: 45 } };
		cdp.messages.fire({ method: 'Page.screencastFrame', sessionId: 'unrelated', params });
		cdp.messages.fire({ method: 'Page.screencastFrame', sessionId: 'frame-session', params });
		await flush();
		assert.deepStrictEqual({ frames, methods: cdp.requests.map(request => request.method) }, {
			frames: [{ dataUrl: 'data:image/jpeg;base64,fixture', width: 800, height: 600, pageScaleFactor: 1.25, offsetTop: 0, scrollX: 0, scrollY: 45 }],
			methods: ['Target.getTargets', 'Target.attachToTarget', 'Page.enable', 'Page.startScreencast', 'Page.screencastFrameAck'],
		});
		bridge.dispose();
		await flush();
	});

	test('disposal stops and detaches without destroying the native page', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		let frameCount = 0;
		store.add(bridge.onDidFrame(() => frameCount++));
		await bridge.start();
		bridge.dispose();
		bridge.dispatchMouse('mousePressed', { x: 10, y: 20 });
		cdp.messages.fire({ method: 'Page.screencastFrame', sessionId: 'frame-session', params: {} });
		await flush();
		assert.deepStrictEqual({ methods: cdp.requests.slice(4).map(request => request.method), destroyed: cdp.destroyed, frameCount }, {
			methods: ['Page.stopScreencast', 'Target.detachFromTarget'], destroyed: ['frame-group'], frameCount: 0,
		});
	});

	test('disposal during group creation destroys a late group without attaching', async () => {
		const cdp = store.add(new FrameCDPService());
		let finish: ((group: string) => void) | undefined;
		cdp.delayGroup = () => new Promise(resolve => { finish = resolve; });
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		const started = bridge.start();
		bridge.dispose();
		finish!('late-group');
		await started;
		assert.deepStrictEqual({ requests: cdp.requests, destroyed: cdp.destroyed }, { requests: [], destroyed: ['late-group'] });
	});

	test('disposal rejects pending commands and prevents a late attachment', async () => {
		const cdp = store.add(new FrameCDPService());
		cdp.delayMethod = 'Target.attachToTarget';
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		const started = bridge.start();
		const rejected = assert.rejects(started, /closed/);
		await flush();
		bridge.dispose();
		await rejected;
		await flush();
		assert.deepStrictEqual(cdp.requests.map(request => request.method), ['Target.getTargets', 'Target.attachToTarget']);
	});

	test('mirror input forwards transformed coordinates and releases listeners on dispose', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		await bridge.start();
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		document.body.appendChild(surface);
		store.add(toDisposable(() => surface.remove()));
		const input = store.add(bridge.bindInput(surface, (x, y) => ({ x: x * 2, y: y * 2 })));
		surface.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, button: 0, buttons: 1, detail: 1 }));
		surface.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 30, button: 0, buttons: 0, detail: 1 }));
		surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
		surface.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }));
		surface.dispatchEvent(new WheelEvent('wheel', { clientX: 20, clientY: 30, deltaY: 80 }));
		input.dispose();
		surface.dispatchEvent(new MouseEvent('mousedown', { clientX: 80, clientY: 90 }));
		await flush();
		assert.deepStrictEqual(cdp.requests.slice(4).map(request => ({ method: request.method, params: request.params })), [
			{ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 40, y: 60, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 } },
			{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 40, y: 60, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 } },
			{ method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, text: 'a', unmodifiedText: 'a', autoRepeat: false, modifiers: 0 } },
			{ method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0, text: undefined, unmodifiedText: undefined, autoRepeat: false, modifiers: 0 } },
			{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 40, y: 60, deltaX: 0, deltaY: 80, modifiers: 0 } },
		]);
		bridge.dispose();
		await flush();
	});

	test('releases pressed page buttons outside the surface, on blur and before bridge disposal', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		await bridge.start();
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		document.body.appendChild(surface);
		store.add(toDisposable(() => surface.remove()));
		store.add(bridge.bindInput(surface, (x, y) => x < 100 ? { x, y } : undefined));
		const targetWindow = surface.ownerDocument.defaultView!;
		const down = () => surface.dispatchEvent(new MouseEvent('mousedown', { clientX: 20, clientY: 30, button: 0, buttons: 1, detail: 1 }));
		down();
		targetWindow.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 300, button: 0, detail: 1 }));
		down();
		targetWindow.dispatchEvent(new FocusEvent('blur'));
		down();
		bridge.dispose();
		down();
		await flush();
		assert.deepStrictEqual(cdp.requests.filter(request => request.method === 'Input.dispatchMouseEvent').map(request => request.params), [
			{ type: 'mousePressed', x: 20, y: 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 },
			{ type: 'mouseReleased', x: 20, y: 30, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 },
			{ type: 'mousePressed', x: 20, y: 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 },
			{ type: 'mouseReleased', x: 20, y: 30, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 },
			{ type: 'mousePressed', x: 20, y: 30, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 },
			{ type: 'mouseReleased', x: 20, y: 30, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 },
		]);
	});

	test('reads native clipboard explicitly and preserves Workbench shortcuts', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		await bridge.start();
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		document.body.appendChild(surface);
		store.add(toDisposable(() => surface.remove()));
		let reads = 0;
		store.add(bridge.bindInput(surface, () => undefined, async () => { reads++; return 'clipboard text'; }));
		surface.focus();
		const shortcut = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, cancelable: true });
		const paste = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, cancelable: true });
		surface.dispatchEvent(shortcut);
		surface.dispatchEvent(paste);
		await flush();
		assert.deepStrictEqual({ shortcutPrevented: shortcut.defaultPrevented, pastePrevented: paste.defaultPrevented, reads, commands: cdp.requests.slice(4).map(request => ({ method: request.method, params: request.params })) }, {
			shortcutPrevented: false, pastePrevented: true, reads: 1,
			commands: [{ method: 'Input.insertText', params: { text: 'clipboard text' } }],
		});
		bridge.dispose();
		await flush();
	});

	test('ignores a late clipboard read after replacing the input surface', async () => {
		const cdp = store.add(new FrameCDPService());
		const bridge = store.add(new BrowserAgentFrameBridge('browser', cdp));
		await bridge.start();
		const surface = document.createElement('div');
		surface.tabIndex = 0;
		document.body.appendChild(surface);
		store.add(toDisposable(() => surface.remove()));
		const read = new DeferredPromise<string>();
		const input = store.add(bridge.bindInput(surface, () => undefined, () => read.p));
		surface.focus();
		surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, cancelable: true }));
		input.dispose();
		read.complete('late clipboard text');
		await flush();
		assert.deepStrictEqual(cdp.requests.slice(4), []);
		bridge.dispose();
		await flush();
	});
});
