/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { OpenideChatTerminalPart, summarizeCommandExecutables, terminalCardTitle } from '../../browser/chat/parts/openideChatTerminalPart.js';
import { IOpenideChatContentPartContext } from '../../browser/chat/openideChatContentPart.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { t } from '../../common/openideStrings.js';
import '../../browser/chat/media/openideChatNative.css';

/**
 * The one-line header of the terminal card names the executables a command chains ("cd, bun").
 * Getting it wrong is visible on every `run_command`: a `;` inside a quoted script would surface
 * half a JavaScript statement as a program, and `2>&1` would split a command that is not chained.
 */
suite('OpenIDE ChatTerminalPart — header summary', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names the executable of each chained command, once, in order', () => {
		assert.strictEqual(summarizeCommandExecutables('cd /repo && npm install && npm test'), 'cd, npm');
		assert.strictEqual(summarizeCommandExecutables('ls -la | grep foo || echo none; pwd'), 'ls, grep, echo, pwd');
	});

	test('does not split inside quotes and skips leading env assignments', () => {
		const command = 'cd /repo && PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/x/bin/chromium bun -e '
			+ '\'import cfg from "./playwright.config.ts"; console.log(JSON.stringify(cfg.use,null,2));\' '
			+ '&& PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/x/bin/chromium bun run e2e:ui 2>&1';
		assert.strictEqual(summarizeCommandExecutables(command), 'cd, bun');
		assert.strictEqual(summarizeCommandExecutables('echo "a && b; c" && make'), 'echo, make');
	});

	test('reduces paths to the program and looks past wrappers', () => {
		assert.strictEqual(summarizeCommandExecutables('./node_modules/.bin/tsc -p . && sudo -E make'), 'tsc, make');
		assert.strictEqual(summarizeCommandExecutables('time env FOO=1 node script.js'), 'node');
	});

	test('ignores subshell punctuation and compound-command keywords', () => {
		assert.strictEqual(summarizeCommandExecutables('(cd build && cmake ..)'), 'cd, cmake');
		assert.strictEqual(summarizeCommandExecutables('for f in *.ts; do echo $f; done'), 'for, echo');
		assert.strictEqual(summarizeCommandExecutables(''), '');
		assert.strictEqual(summarizeCommandExecutables('   '), '');
	});

	test('the title is the description when there is one, else the first executable', () => {
		assert.strictEqual(terminalCardTitle('cd x && bun test', 'Verify config and rerun E2E'), 'Verify config and rerun E2E');
		assert.strictEqual(terminalCardTitle('cd x && bun test', '   '), 'cd');
		assert.strictEqual(terminalCardTitle('FOO=1 ./scripts/run.sh --fast'), 'run.sh');
		assert.strictEqual(terminalCardTitle(''), '');
	});
});

suite('OpenIDE ChatTerminalPart — output viewport', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(output: string, width = 360) {
		const host = mainWindow.document.createElement('div');
		host.className = 'monaco-workbench openide-chat-native';
		host.style.cssText = `position:fixed;top:0;left:0;width:${width}px;--oi-chat-card-radius:8px;--oi-chat-card-border:gray`;
		mainWindow.document.body.append(host);
		store.add(toDisposable(() => host.remove()));
		const part = store.add(new OpenideChatTerminalPart({
			kind: 'terminal', callId: 'viewport', command: 'curl http://localhost:3000',
			background: false, output, state: 'exited', exitCode: 0,
		}, {} as IOpenideChatContentPartContext, {
			createInstance: () => ({ dispose() { } }),
		} as unknown as IInstantiationService, {} as IContextViewService, {} as IOpenideAgentService, {
			setupDelayedHover: () => toDisposable(() => { }),
		} as unknown as IHoverService));
		host.append(part.domNode);
		return {
			host, part,
			out: part.domNode.querySelector<HTMLElement>('.openide-chat-term-out')!,
			fold: part.domNode.querySelector<HTMLElement>('.openide-chat-term-fold')!,
			button: part.domNode.querySelector<HTMLButtonElement>('.openide-fold-expand')!,
		};
	}

	async function layout() {
		for (let frame = 0; frame < 4; frame++) {
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		}
	}

	test('short output stays readable without an unnecessary expansion overlay', async () => {
		const { part, button, out } = create('200 http://localhost:3000');
		await layout();
		assert.strictEqual(mainWindow.getComputedStyle(button).display, 'none');
		assert.strictEqual(out.scrollHeight, out.clientHeight);
		assert.strictEqual(mainWindow.getComputedStyle(part.domNode.querySelector('.openide-fold-fade')!).display, 'none');
	});

	test('long output expands in a separate footer without covering the frame or last visible line', async () => {
		const { part, button, out } = create(Array.from({ length: 40 }, (_, i) => `Build step ${i}`).join('\n'));
		await layout();
		assert.ok(button.getBoundingClientRect().top >= out.getBoundingClientRect().bottom);
		assert.ok(button.getBoundingClientRect().bottom < part.domNode.getBoundingClientRect().bottom);
		assert.strictEqual(out.clientHeight, 108);
		assert.strictEqual(button.getAttribute('aria-label'), t('chat.part.expandOutput'));
		button.click();
		await layout();
		assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
		assert.strictEqual(out.clientHeight, 320);
		assert.strictEqual(mainWindow.getComputedStyle(out).overflowY, 'auto');
		button.click();
		await layout();
		assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
		assert.strictEqual(out.clientHeight, 108);
	});

	test('resizing a finished card remeasures wrapped output and exposes expansion', async () => {
		const { host, fold, button } = create('abcdefghij '.repeat(20), 800);
		await layout();
		assert.strictEqual(fold.classList.contains('needs-expand'), false);
		host.style.width = '220px';
		await layout();
		assert.strictEqual(fold.classList.contains('needs-expand'), true);
		assert.notStrictEqual(mainWindow.getComputedStyle(button).display, 'none');
		let bubbled = false;
		host.addEventListener('keydown', () => { bubbled = true; }, { once: true });
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.strictEqual(bubbled, false, 'The chat tree must not intercept expansion keystrokes');
	});
});
