/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserAgentSessionModel } from '../../../../../platform/browserView/common/browserAgentSessionModel.js';
import { BrowserAgentOverlay, browserAgentActionLabel } from '../../browser/browserAgentOverlay.js';

suite('Browser agent native overlay', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const frame = () => new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
	const actionFrame = async (overlay: BrowserAgentOverlay, action: string) => {
		for (let index = 0; index < 120 && overlay.domNode.dataset.action !== action; index++) { await frame(); }
		assert.strictEqual(overlay.domNode.dataset.action, action);
	};
	function fixture(reducedMotion = true) {
		const parent = mainWindow.document.createElement('div');
		parent.style.cssText = 'position:relative;width:500px;height:500px';
		mainWindow.document.body.appendChild(parent);
		store.add(toDisposable(() => parent.remove()));
		const model = store.add(new BrowserAgentSessionModel('session'));
		const overlay = store.add(new BrowserAgentOverlay(parent, model, { reducedMotion, observeResize: false }));
		overlay.layout(500, 500);
		return { parent, model, overlay };
	}

	test('synthetic events render cursor and target through the same letterbox transform', async () => {
		const { model, overlay } = fixture();
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'click', viewport: { width: 1000, height: 500, deviceScaleFactor: 2 }, point: { x: .1, y: .2, space: 'normalized' }, target: { x: 200, y: 200, width: 400, height: 100, space: 'device', label: 'Continue' } });
		await frame();
		const cursor = overlay.domNode.querySelector<HTMLElement>('.browser-agent-cursor')!;
		const target = overlay.domNode.querySelector<HTMLElement>('.browser-agent-target')!;
		assert.deepStrictEqual({ cursor: cursor.style.transform, target: target.style.transform, width: target.style.width, label: overlay.domNode.querySelector('.browser-agent-label')?.textContent, click: overlay.domNode.dataset.lastClick },
			{ cursor: 'translate3d(50px, 175px, 0px)', target: 'translate3d(50px, 175px, 0px)', width: '100px', label: 'Clicking "Continue"', click: '1' });
		overlay.layout(200, 100); await frame();
		assert.deepStrictEqual({ cursor: cursor.style.transform, target: target.style.transform, width: target.style.width }, { cursor: 'translate3d(20px, 20px, 0px)', target: 'translate3d(20px, 20px, 0px)', width: '40px' });
	});

	test('target changes and sensitive typing never expose values or raw errors', async () => {
		const { model, overlay } = fixture();
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'focus', viewport: { width: 500, height: 500 }, target: { x: 10, y: 20, width: 100, height: 30 } });
		await frame();
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'type', description: 'secret-value', target: { x: 100, y: 200, width: 120, height: 40, sensitive: true, label: 'secret-label' } });
		await actionFrame(overlay, 'type');
		assert.deepStrictEqual({ text: overlay.domNode.querySelector('.browser-agent-label')?.textContent, target: overlay.domNode.querySelector<HTMLElement>('.browser-agent-target')?.style.transform, leaked: overlay.domNode.textContent?.includes('secret') }, { text: 'Typing…', target: 'translate3d(100px, 200px, 0px)', leaked: false });
		assert.strictEqual(browserAgentActionLabel({ sessionId: 'session', sequence: 3, timestamp: 3, action: 'error', error: 'secret-value' }), 'Browser action failed');
	});

	test('click reuses pulse nodes and disposal cancels active animations and listeners', async () => {
		const { model, overlay, parent } = fixture(false);
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'doubleClick', viewport: { width: 500, height: 500 }, point: { x: 100, y: 100 } });
		await timeout(160);
		const ripples = [...overlay.domNode.querySelectorAll<HTMLElement>('.browser-agent-ripple')];
		const animations = ripples.flatMap(node => node.getAnimations());
		assert.deepStrictEqual({ count: ripples.length, animations: animations.length, click: overlay.domNode.dataset.lastClick }, { count: 2, animations: 2, click: '1' });
		overlay.dispose();
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'click', point: { x: 400, y: 400 } });
		await frame();
		assert.deepStrictEqual({ connected: parent.childElementCount, playStates: animations.map(animation => animation.playState) }, { connected: 0, playStates: ['idle', 'idle'] });
	});

	test('consecutive moves start at the last rendered cursor position without jumping', async () => {
		const { model, overlay } = fixture(false);
		const cursor = overlay.domNode.querySelector<HTMLElement>('.browser-agent-cursor')!;
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'move', viewport: { width: 500, height: 500 }, point: { x: 50, y: 50 } });
		await frame();
		const initial = cursor.style.transform;
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'move', point: { x: 450, y: 450 } });
		await frame();
		assert.strictEqual(cursor.style.transform, initial);
		await frame();
		const inFlight = cursor.style.transform;
		assert.notStrictEqual(inFlight, initial);
		assert.notStrictEqual(inFlight, 'translate3d(450px, 450px, 0px)');
		model.acceptEvent({ sessionId: 'session', sequence: 3, timestamp: 3, action: 'move', point: { x: 100, y: 200 } });
		await frame();
		const position = new DOMMatrix(cursor.style.transform);
		const previous = new DOMMatrix(inFlight);
		assert.ok(Math.hypot(position.m41 - previous.m41, position.m42 - previous.m42) < 150, 'movement continues from its current position');
		assert.notStrictEqual(cursor.style.transform, 'translate3d(100px, 200px, 0px)');
	});

	test('cursor uses Bibata at 20 CSS pixels and stays visible before and after actions', async () => {
		const { model, overlay } = fixture();
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'navigate', phase: 'started', viewport: { width: 500, height: 500 } });
		await frame();
		const cursor = overlay.domNode.querySelector<HTMLElement>('.browser-agent-cursor')!;
		const glyph = cursor.querySelector<HTMLElement>('.browser-agent-cursor-glyph')!;
		const style = getComputedStyle(glyph);
		assert.deepStrictEqual({ hidden: cursor.hidden, width: style.width, height: style.height, position: cursor.style.transform }, { hidden: false, width: '20px', height: '20px', position: 'translate3d(250px, 250px, 0px)' });
		assert.ok(style.backgroundImage.includes('bibataModernClassic.svg'));
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'success' });
		await actionFrame(overlay, 'success');
		await timeout(1700);
		assert.deepStrictEqual({ settled: overlay.domNode.classList.contains('settled'), hidden: cursor.hidden, opacity: getComputedStyle(cursor).opacity, hudOpacity: getComputedStyle(overlay.domNode.querySelector('.browser-agent-hud')!).opacity }, { settled: true, hidden: false, opacity: '1', hudOpacity: '1' });
	});

	test('a runtime batch paints every distinct action without waiting on the renderer', async () => {
		const { model, overlay } = fixture();
		const actions = ['navigate', 'click', 'type', 'keypress', 'hover', 'focus', 'scroll', 'screenshot', 'success'] as const;
		for (const [index, action] of actions.entries()) {
			model.acceptEvent({ sessionId: 'session', sequence: index + 1, timestamp: index + 1, step: index + 1, action, phase: 'completed', viewport: { width: 500, height: 500 }, point: { x: 100 + index * 20, y: 200 } });
		}
		assert.strictEqual(model.state.status, 'completed', 'runtime is already finished');
		const painted: string[] = [];
		for (let index = 0; index < 180; index++) {
			await frame();
			const action = overlay.domNode.dataset.action!;
			if (action === 'scroll') { assert.strictEqual(overlay.domNode.querySelector<HTMLElement>('.browser-agent-scroll')?.hidden, false); }
			if (painted.at(-1) !== action) { painted.push(action); }
			if (action === 'success') { break; }
		}
		assert.deepStrictEqual(painted, actions);
	});

	test('fast completed clicks remain waypoints before a following mouse movement', async () => {
		const { model, overlay } = fixture(false);
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'move', viewport: { width: 500, height: 500 }, point: { x: 50, y: 50 } });
		await frame();
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'click', phase: 'completed', point: { x: 300, y: 200 } });
		model.acceptEvent({ sessionId: 'session', sequence: 3, timestamp: 3, action: 'move', point: { x: 450, y: 400 } });
		for (let index = 0; index < 90 && !overlay.domNode.dataset.lastClick; index++) { await frame(); }
		const cursor = overlay.domNode.querySelector<HTMLElement>('.browser-agent-cursor')!;
		assert.deepStrictEqual({ click: overlay.domNode.dataset.lastClick, position: cursor.style.transform }, { click: '2', position: 'translate3d(300px, 200px, 0px)' });
		await timeout(650);
		assert.strictEqual(cursor.style.transform, 'translate3d(450px, 400px, 0px)');
	});

	test('closing a session hides its surface and fences subsequent events', async () => {
		const { model, overlay } = fixture();
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'navigate', url: 'https://user:password@example.test/settings?token=secret#private', viewport: { width: 500, height: 500 } });
		assert.strictEqual(overlay.domNode.querySelector('.browser-agent-label')?.textContent, 'Opening example.test/settings…');
		model.close();
		const accepted = model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'move', point: { x: 1, y: 1 } });
		await frame();
		assert.deepStrictEqual({ accepted, hidden: overlay.domNode.hidden, sequence: overlay.domNode.dataset.sequence }, { accepted: false, hidden: true, sequence: '1' });
	});

	test('resize updates during a click move the target without replaying the click effect', async () => {
		const { model, overlay } = fixture();
		model.acceptEvent({ sessionId: 'session', sequence: 1, timestamp: 1, action: 'click', phase: 'started', viewport: { width: 500, height: 500 }, point: { x: 100, y: 100 }, target: { x: 90, y: 90, width: 20, height: 20 } });
		await frame();
		model.acceptEvent({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'click', phase: 'updated', point: { x: 200, y: 100 }, target: { x: 190, y: 90, width: 20, height: 20 } });
		await frame();
		assert.deepStrictEqual({ click: overlay.domNode.dataset.lastClick, target: overlay.domNode.querySelector<HTMLElement>('.browser-agent-target')?.style.transform }, { click: undefined, target: 'translate3d(190px, 90px, 0px)' });
		model.acceptEvent({ sessionId: 'session', sequence: 3, timestamp: 3, action: 'click', phase: 'completed', point: { x: 200, y: 100 } });
		await frame();
		assert.strictEqual(overlay.domNode.dataset.lastClick, '3');
	});
});
