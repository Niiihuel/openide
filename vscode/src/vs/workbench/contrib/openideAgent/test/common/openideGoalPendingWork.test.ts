/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideGoalBackgroundWork, openideGoalPendingBackgroundReason } from '../../common/openideGoalPendingWork.js';

suite('OpenIDE goal background completion guard', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const task = (patch: Partial<IOpenideGoalBackgroundWork> = {}): IOpenideGoalBackgroundWork => ({ conversationId: 'session', command: 'npm run dev', running: true, disposed: false, ...patch });

	test('a live server requires explicit review rather than implicit exemption by command name', () => {
		assert.match(openideGoalPendingBackgroundReason('session', [task()])!, /waiting for 1 background command/);
		assert.match(openideGoalPendingBackgroundReason('session', [task()])!, /development servers/);
	});

	test('finished persistent terminals and disposed terminals cannot keep a goal blocked', () => {
		assert.strictEqual(openideGoalPendingBackgroundReason('session', [task({ running: false }), task({ disposed: true })]), undefined);
	});

	test('conversation identity is exact and does not use prefixes or a shared shell', () => {
		assert.strictEqual(openideGoalPendingBackgroundReason('session', [task({ conversationId: 'session:other' }), task({ conversationId: '' })]), undefined);
		assert.strictEqual(openideGoalPendingBackgroundReason('', [task({ conversationId: '' })]), undefined);
	});

	test('diagnostics bound command output while retaining the total pending count', () => {
		const reason = openideGoalPendingBackgroundReason('session', Array.from({ length: 10 }, () => task({ command: 'x'.repeat(10000) })))!;
		assert.match(reason, /10 background command/);
		assert.ok(reason.length < 800);
	});
});
