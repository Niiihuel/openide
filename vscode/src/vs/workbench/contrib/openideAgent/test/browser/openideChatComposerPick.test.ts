/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IBrowserPickResult } from '../../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { OpenideChatComposerPick } from '../../browser/chat/openideChatComposerPick.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';

/**
 * Pick & Polish in the composer.
 *
 * The chip and the pending selection used to be two halves of one thing in two files — the webview
 * drew the chip, the host held the payload — which is what made the chip a display of state it did
 * not own. Holding both here is what lets it behave like the attachment it is: it belongs to the
 * message being composed, travels with it on Send, and comes back if that message is rejected.
 */
suite('OpenIDE ChatComposerPick', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const PICK: IBrowserPickResult = {
		selector: 'button.primary',
		html: '<button class="primary">Guardar</button>',
		styles: 'color: rgb(255,255,255)',
		rect: { x: 0, y: 0, w: 10, h: 10 },
		pageUrl: 'http://localhost:3000/settings',
	};

	function create() {
		const strip = $('div');
		const emitter = store.add(new Emitter<IBrowserPickResult>());
		const service = { onDidPickElement: emitter.event } as unknown as IOpenideAgentService;
		const changes: number[] = [];
		const picks: number[] = [];
		const pick = store.add(new OpenideChatComposerPick(
			strip, service, NullHoverService,
			() => changes.push(1),
			() => picks.push(1),
		));
		return { pick, strip, fire: (result: IBrowserPickResult) => emitter.fire(result), changes, picks };
	}

	const selectorText = (strip: HTMLElement) => strip.querySelector('.openide-chat-pick-selector')?.textContent ?? '';

	test('no pick, no chip', () => {
		const { pick, strip } = create();
		assert.strictEqual(pick.isEmpty, true);
		assert.strictEqual(strip.hidden, true);
	});

	test('a pick shows the selector and takes focus', () => {
		const { pick, strip, fire, picks } = create();
		fire(PICK);
		assert.strictEqual(pick.isEmpty, false);
		assert.strictEqual(strip.hidden, false);
		assert.strictEqual(selectorText(strip), 'button.primary');
		assert.strictEqual(picks.length, 1, 'arriving is what focuses the prompt');
	});

	test('a second pick replaces the first', () => {
		// The picker is a pointer: two elements pointed at one after the other is a correction, not
		// a selection of both.
		const { strip, fire } = create();
		fire(PICK);
		fire({ ...PICK, selector: 'div.card' });
		assert.strictEqual(strip.querySelectorAll('.openide-chat-pick-selector').length, 1);
		assert.strictEqual(selectorText(strip), 'div.card');
	});

	test('the × clears the chip WITHOUT stealing focus', () => {
		// Focusing on dismiss would fight whatever the user clicked next.
		const { pick, strip, fire, picks } = create();
		fire(PICK);
		const picksAfterArrival = picks.length;
		(strip.querySelector('.openide-chat-pick-remove') as HTMLElement).click();
		assert.strictEqual(pick.isEmpty, true);
		assert.strictEqual(strip.hidden, true);
		assert.strictEqual(picks.length, picksAfterArrival, 'dismissing is not picking');
	});

	test('both appearing and going re-measure the card', () => {
		const { strip, fire, changes } = create();
		fire(PICK);
		const afterArrival = changes.length;
		assert.ok(afterArrival > 0);
		(strip.querySelector('.openide-chat-pick-remove') as HTMLElement).click();
		assert.ok(changes.length > afterArrival, 'the card shrinks when the chip goes');
	});

	test('take() hands the payload over exactly once', () => {
		const { pick, strip, fire } = create();
		fire(PICK);
		const taken = pick.take();
		assert.strictEqual(taken?.selector, 'button.primary');
		// The prose the agent receives travels with it — that is the whole payload.
		assert.ok(taken?.context.includes('[Pick & Polish'));
		assert.strictEqual(pick.isEmpty, true, 'the turn that carries it is the only one that does');
		assert.strictEqual(strip.hidden, true);
		assert.strictEqual(pick.take(), undefined);
	});

	test('restore() puts a rejected turn\'s pick back on screen', () => {
		const { pick, strip, fire } = create();
		fire(PICK);
		const taken = pick.take();
		pick.restore(taken);
		assert.strictEqual(pick.isEmpty, false);
		assert.strictEqual(strip.hidden, false);
		assert.strictEqual(selectorText(strip), 'button.primary');
	});

	test('restore(undefined) is a no-op, so the common path costs nothing', () => {
		const { pick, strip } = create();
		pick.restore(undefined);
		assert.strictEqual(pick.isEmpty, true);
		assert.strictEqual(strip.hidden, true);
	});

	test('the screenshot rides along when the pick captured one', () => {
		const { pick, fire } = create();
		fire({ ...PICK, screenshotBase64: 'AAAA' });
		assert.deepStrictEqual(pick.pending?.image, { mimeType: 'image/jpeg', data: 'AAAA' });
		// …and the in-page pick, whose rect is relative to the preview iframe, carries none.
		fire(PICK);
		assert.strictEqual(pick.pending?.image, undefined);
	});

	test('a disposed chip stops listening', () => {
		const strip = $('div');
		const emitter = store.add(new Emitter<IBrowserPickResult>());
		const service = { onDidPickElement: emitter.event } as unknown as IOpenideAgentService;
		const pick = new OpenideChatComposerPick(strip, service, NullHoverService, () => { }, () => { });
		pick.dispose();
		emitter.fire(PICK);
		assert.strictEqual(pick.isEmpty, true);
	});
});
