/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideGoal } from '../../../../../platform/openideAgentHost/common/openideGoal.js';
import { parseOpenideGoalDocument } from '../../common/openideGoalDocument.js';

suite('OpenIDE goal Markdown contract proposals', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const goal = upcastPartial<IOpenideGoal>({ id: 'goal-id', revision: 3 });
	const document = (criteria: string, objective = 'Repair the failing integration') => `---\nschema_version: 1\nid: goal-id\nrevision: 3\nplan_ref: "plan.md"\n---\n\n# Goal\n\n${objective}\n\n## Acceptance criteria\n\n${criteria}\n`;

	test('extracts only the proposed objective and criteria, including explicit commands', () => {
		assert.deepStrictEqual(parseOpenideGoalDocument(document('- C1: Test passes\n  Command: npm test -- --run regression\n- C2: Layout reviewed', 'Repair the integration\n\nKeep the existing API.'), goal), {
			objective: 'Repair the integration\n\nKeep the existing API.',
			criteria: [{ text: 'Test passes', command: 'npm test -- --run regression' }, { text: 'Layout reviewed' }],
		});
	});

	test('accepts CRLF document edits without changing command contents', () => {
		assert.deepStrictEqual(parseOpenideGoalDocument(document('- C1: Test passes\n  Command: npm test').replace(/\n/g, '\r\n'), goal), {
			objective: 'Repair the failing integration', criteria: [{ text: 'Test passes', command: 'npm test' }],
		});
	});

	test('refuses identity or revision changes and missing metadata', () => {
		const valid = document('- C1: Test passes');
		for (const candidate of [valid.replace('id: goal-id', 'id: another-goal'), valid.replace('revision: 3', 'revision: 4'), valid.replace(/^---[\s\S]*?---\n/, '')]) {
			assert.throws(() => parseOpenideGoalDocument(candidate, goal), /identity and revision/);
		}
	});

	test('does not interpret checked boxes or freeform assertions as verified criteria', () => {
		for (const lines of ['- [x] C1: Already passed', '- C1: Test passes\nAll tests verified', '  Command: npm test', '- C1: Test passes\n  Command: npm test\n  Command: true']) {
			assert.throws(() => parseOpenideGoalDocument(document(lines), goal), /criterion/);
		}
	});

	test('requires an objective and bounds criteria count and document size', () => {
		assert.throws(() => parseOpenideGoalDocument(document('- C1: Test passes', ' '), goal), /objective/);
		assert.throws(() => parseOpenideGoalDocument(document(''), goal), /1 to 50/);
		assert.throws(() => parseOpenideGoalDocument(document(Array.from({ length: 51 }, (_, i) => `- C${i + 1}: Test ${i}`).join('\n')), goal), /1 to 50/);
		assert.throws(() => parseOpenideGoalDocument('x'.repeat(256001), goal), /size limit/);
	});
});
