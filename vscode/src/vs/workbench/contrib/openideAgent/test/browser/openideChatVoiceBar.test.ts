/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideChatComposerControls } from '../../browser/chat/openideChatComposerControls.js';
import { OpenideChatComposerVoice, VoiceState } from '../../browser/chat/openideChatComposerVoice.js';
import { OpenideChatVoiceBar } from '../../browser/chat/openideChatVoiceBar.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';

suite('OpenIDE Chat Voice Bar', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function host(): HTMLElement {
		const node = mainWindow.document.createElement('div'); mainWindow.document.body.appendChild(node);
		store.add(toDisposable(() => node.remove())); return node;
	}

	test('waveform uses bounded recorded samples and stops changing outside recording', () => {
		const node = host(); const calls: string[] = [];
		const bar = store.add(new OpenideChatVoiceBar(node, NullHoverService, { cancel: () => calls.push('cancel'), stop: () => calls.push('stop'), send: () => calls.push('send') }));
		const send = node.querySelector<HTMLButtonElement>('.openide-composer-voice-send')!;
		bar.setState('starting'); send.click(); assert.deepStrictEqual(calls, []);
		bar.setState('recording'); bar.setLevel(.7);
		const bars = node.querySelectorAll<HTMLElement>('.openide-composer-voice-wave > span');
		assert.strictEqual(bars.length, 128); assert.ok(Math.abs(Number(bars[127].style.transform.slice(7, -1)) - .7) < .001);
		send.click(); assert.deepStrictEqual(calls, ['send']);
		bar.setState('busy'); const quiet = bars[127].style.transform;
		bar.setLevel(1); assert.strictEqual(bars[127].style.transform, quiet);
		assert.strictEqual(send.disabled, true);
		node.querySelector<HTMLButtonElement>('.openide-composer-voice-cancel')!.click();
		assert.deepStrictEqual(calls, ['send', 'cancel']);
		bar.setState('idle'); assert.strictEqual(bar.domNode.hidden, true);
	});

	function controls() {
		const node = host(); const row = node.appendChild(mainWindow.document.createElement('div'));
		let state: VoiceState = 'idle'; let sends = 0; let stops = 0; let releases = 0;
		const finish = new DeferredPromise<boolean>();
		let controls: OpenideChatComposerControls;
		const setState = (value: VoiceState) => { state = value; controls.applyVoiceState(value); };
		const voice = {
			get state() { return state; }, capability: { available: true }, refreshCapability: async () => {},
			toggle: () => setState('starting'), beginHold: () => { setState('starting'); return true; },
			endHold: () => { releases++; setState('busy'); }, cancel: () => setState('idle'),
			stop: async () => { stops++; setState('busy'); const result = await finish.p; setState('idle'); return result; },
		} as unknown as OpenideChatComposerVoice;
		const service = new class extends mock<IOpenideAgentService>() {
			override onDidChange = Event.None;
			override onDidChangePlanFollow = Event.None;
			override getPermissionMode() { return 'ask' as const; }
			override isPlanFollowEnabled() { return false; }
			override async ensureModelCatalog() { }
			override getActiveProviderId() { return ''; }
			override findProvider() { return undefined; }
			override getModel() { return ''; }
			override getModelReasoning() { return undefined; }
			override async isConnected() { return false; }
		};
		controls = store.add(new OpenideChatComposerControls(row, service, {} as IContextViewService, {} as ICommandService, NullHoverService, voice, {
			send: () => sends++, stop: () => {}, attach: () => {}, files: () => {}, tools: () => {}, goal: () => {},
		}));
		return { node, row, controls, setState, finish, counts: () => ({ sends, stops, releases }) };
	}

	test('send waits for successful final transcription and cancel invalidates pending send', async () => {
		for (const cancel of [false, true]) {
			const h = controls(); h.setState('recording');
			h.node.querySelector<HTMLButtonElement>('.openide-composer-voice-send')!.click();
			assert.deepStrictEqual(h.counts(), { sends: 0, stops: 1, releases: 0 });
			h.node.querySelector<HTMLButtonElement>('.openide-composer-voice-send')!.click();
			if (cancel) { h.node.querySelector<HTMLButtonElement>('.openide-composer-voice-cancel')!.click(); }
			await h.finish.complete(true); await timeout(0);
			assert.deepStrictEqual(h.counts(), { sends: cancel ? 0 : 1, stops: 1, releases: 0 });
		}
	});

	test('changing conversation invalidates a send after stop resolved but before its continuation', async () => {
		const h = controls(); h.setState('recording');
		h.node.querySelector<HTMLButtonElement>('.openide-composer-voice-send')!.click();
		void h.finish.complete(true);
		h.setState('idle');
		h.controls.cancelVoice();
		await timeout(0);
		assert.strictEqual(h.counts().sends, 0);
	});

	test('pointer hold survives bar-induced boundary events and releases capture exactly once', () => {
		const h = controls(); const mic = h.node.querySelector<HTMLButtonElement>('.openide-composer-mic')!;
		// The browser only grants capture to trusted pointers. Model that per-element API here;
		// event handlers, UI state transitions and boundary-event guards remain the real controls.
		let captured: number | undefined;
		mic.setPointerCapture = id => { captured = id; };
		mic.hasPointerCapture = id => captured === id;
		mic.releasePointerCapture = () => { captured = undefined; mic.dispatchEvent(new mainWindow.PointerEvent('lostpointercapture')); };
		h.controls.setVoiceMode('holdToTalk');
		mic.dispatchEvent(new mainWindow.PointerEvent('pointerdown', { button: 0, pointerId: 9 }));
		h.setState('recording');
		mic.dispatchEvent(new mainWindow.PointerEvent('pointerleave', { pointerId: 9 }));
		assert.strictEqual(captured, 9); assert.strictEqual(h.counts().releases, 0);
		mic.dispatchEvent(new mainWindow.PointerEvent('pointerup', { pointerId: 9 }));
		assert.strictEqual(captured, undefined); assert.strictEqual(h.counts().releases, 1);
	});

	test('hold-to-talk retains the focused trigger until key release; toggle moves focus into the bar', () => {
		const h = controls(); const mic = h.node.querySelector<HTMLButtonElement>('.openide-composer-mic')!;
		h.controls.setVoiceMode('holdToTalk'); mic.focus();
		mic.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		assert.strictEqual(h.row.classList.contains('openide-composer-recording-row-hidden'), false);
		h.setState('recording');
		assert.strictEqual(mainWindow.document.activeElement, mic);
		assert.strictEqual(h.row.classList.contains('openide-composer-recording-row-hidden'), false);
		mic.dispatchEvent(new mainWindow.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
		assert.strictEqual(h.counts().releases, 1);
		h.setState('idle'); h.controls.setVoiceMode('toggle'); mic.focus(); mic.click();
		assert.strictEqual(h.row.classList.contains('openide-composer-recording-row-hidden'), true);
		assert.strictEqual(mainWindow.document.activeElement, h.node.querySelector('.openide-composer-voice-cancel'));
	});
});
