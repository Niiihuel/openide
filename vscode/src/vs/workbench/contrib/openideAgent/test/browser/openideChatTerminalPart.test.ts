/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { summarizeCommandExecutables, terminalCardTitle } from '../../browser/chat/parts/openideChatTerminalPart.js';

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
