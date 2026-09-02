/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideChatTerminalsTray } from '../../browser/chat/parts/openideChatTerminalsTray.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { IBackgroundTerminalEvent } from '../../common/openideAgentTypes.js';

/**
 * The tray that was not there.
 *
 * `run_command` with `background: true` routes to `silent` in the reducer because this tray is its
 * surface — there is no transcript card for a dev server. Without the tray the call rendered
 * nothing anywhere, so `npm run dev` in the native chat looked like a tool that did nothing. These
 * are real-DOM asserts for exactly that: a running process is on screen, an exited one is gone, and
 * the two buttons do the two different things they look like they do.
 */
suite('OpenIDE ChatTerminalsTray', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IStub {
		readonly service: IOpenideAgentService;
		readonly fire: (event: IBackgroundTerminalEvent) => void;
		readonly revealed: string[];
		readonly killed: string[];
	}

	function stubService(): IStub {
		const emitter = store.add(new Emitter<IBackgroundTerminalEvent>());
		const revealed: string[] = [];
		const killed: string[] = [];
		const service = {
			onDidChangeBackgroundTerminal: emitter.event,
			revealBackgroundTerminal: async (id: string) => { revealed.push(id); },
			killBackgroundTerminal: (id: string) => { killed.push(id); },
		} as unknown as IOpenideAgentService;
		return { service, fire: event => emitter.fire(event), revealed, killed };
	}

	function createTray(): { tray: OpenideChatTerminalsTray; parent: HTMLElement; stub: IStub } {
		const parent = $('div');
		const stub = stubService();
		const tray = store.add(new OpenideChatTerminalsTray(parent, stub.service, NullHoverService));
		return { tray, parent, stub };
	}

	const rows = (tray: OpenideChatTerminalsTray) => tray.domNode.querySelectorAll('.openide-chat-terms-row');
	const countText = (tray: OpenideChatTerminalsTray) => tray.domNode.querySelector('.openide-chat-terms-count')?.textContent ?? '';
	const isHidden = (tray: OpenideChatTerminalsTray) => tray.domNode.classList.contains('hidden');

	test('starts hidden and empty: an idle chat shows no tray at all', () => {
		const { tray } = createTray();
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('a running terminal appears with its command', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		assert.strictEqual(isHidden(tray), false);
		assert.strictEqual(rows(tray).length, 1);
		const label = tray.domNode.querySelector('.openide-chat-terms-label');
		assert.strictEqual(label?.textContent, 'npm run dev');
		// The full command is the tooltip, and the tooltip is the WORKBENCH hover: no `title=`
		// attribute is left on the row, or the OS would draw its own tip over the IDE's.
		assert.strictEqual((label as HTMLElement).title, '');
	});

	test('the heading counts and pluralises', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		assert.strictEqual(countText(tray), '1 Background Terminal');
		stub.fire({ id: 'b', command: 'tsc -w', status: 'running' });
		assert.strictEqual(countText(tray), '2 Background Terminals');
		assert.strictEqual(rows(tray).length, 2);
	});

	test('a repeated running event updates the row instead of duplicating it', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		stub.fire({ id: 'a', command: 'npm run dev -- --port 3001', status: 'running' });
		assert.strictEqual(rows(tray).length, 1);
		assert.strictEqual(tray.domNode.querySelector('.openide-chat-terms-label')?.textContent, 'npm run dev -- --port 3001');
	});

	test('an exited terminal leaves, and the tray goes with the last one', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		stub.fire({ id: 'b', command: 'tsc -w', status: 'running' });
		stub.fire({ id: 'a', command: 'npm run dev', status: 'exited', exitCode: 0 });
		assert.strictEqual(rows(tray).length, 1);
		assert.strictEqual(isHidden(tray), false);
		stub.fire({ id: 'b', command: 'tsc -w', status: 'exited', exitCode: 1 });
		assert.strictEqual(tray.isEmpty, true);
		assert.strictEqual(isHidden(tray), true);
	});

	test('an exit for a terminal that was never tray-worthy is ignored, not crashed on', () => {
		// `trackBackgroundTerminal` only announces commands that pass `isBackgroundTrayWorthy`, but
		// it announces the EXIT of the same set — a stray exit still must not throw.
		const { tray, stub } = createTray();
		stub.fire({ id: 'ghost', command: 'cat x', status: 'exited' });
		assert.strictEqual(tray.isEmpty, true);
	});

	test('clicking the row reveals the terminal without killing it', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		(rows(tray)[0] as HTMLElement).click();
		assert.deepStrictEqual(stub.revealed, ['a']);
		assert.deepStrictEqual(stub.killed, []);
	});

	test('the stop button kills it and does NOT also reveal it', () => {
		// Without `stopPropagation` the same click bubbles to the row, so the terminal being killed
		// is revealed and focused on its way out.
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		(tray.domNode.querySelector('.openide-chat-terms-stop') as HTMLElement).click();
		assert.deepStrictEqual(stub.killed, ['a']);
		assert.deepStrictEqual(stub.revealed, [], 'the click must not reach the row');
	});

	test('the toggle collapses the body and keeps the heading', () => {
		const { tray, stub } = createTray();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		const body = tray.domNode.querySelector('.openide-chat-terms-body')!;
		const toggle = tray.domNode.querySelector('.openide-chat-terms-toggle') as HTMLElement;
		assert.strictEqual(body.classList.contains('hidden'), false);
		toggle.click();
		assert.strictEqual(body.classList.contains('hidden'), true);
		assert.strictEqual(isHidden(tray), false, 'collapsing is not closing');
		assert.strictEqual(countText(tray), '1 Background Terminal');
		toggle.click();
		assert.strictEqual(body.classList.contains('hidden'), false);
	});

	test('height changes are announced, because the tray sits between transcript and composer', () => {
		const { tray, stub } = createTray();
		let fired = 0;
		store.add(tray.onDidChangeHeight(() => fired++));
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		assert.ok(fired > 0, 'appearing changes the layout');
		const before = fired;
		(tray.domNode.querySelector('.openide-chat-terms-toggle') as HTMLElement).click();
		assert.ok(fired > before, 'so does collapsing');
	});

	test('a disposed tray stops listening', () => {
		const parent = $('div');
		const stub = stubService();
		const tray = new OpenideChatTerminalsTray(parent, stub.service, NullHoverService);
		tray.dispose();
		stub.fire({ id: 'a', command: 'npm run dev', status: 'running' });
		assert.strictEqual(tray.isEmpty, true);
	});
});
