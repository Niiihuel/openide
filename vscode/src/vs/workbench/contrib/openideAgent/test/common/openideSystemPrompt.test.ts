/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentMode } from '../../common/openideAgentTypes.js';
import { buildOpenideSystemPrompt, IOpenidePromptContext } from '../../common/openideSystemPrompt.js';

suite('OpenIDE system prompt assembly', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const context: IOpenidePromptContext = { os: 'Linux', date: '2026-09-05', workspace: { name: 'fixture', path: '/repo' }, subagentsEnabled: true, subagents: [{ name: 'reviewer', description: 'Review changes' }] };

	test('preserves context section order and the frozen memory values', () => {
		const memory = { project: 'PROJECT_SENTINEL', user: 'USER_SENTINEL' };
		const prompt = buildOpenideSystemPrompt(context, 'agent', memory, '\nSKILLS_SENTINEL', '\nRULES_SENTINEL');
		const sections = ['Environment context:', 'REGISTERED SUBAGENTS', 'Project navigation:', 'PROJECT_SENTINEL', 'USER_SENTINEL', 'SKILLS_SENTINEL', 'RULES_SENTINEL', 'COMPLEXITY TRIAGE', 'AGENT MODE (execution'];
		const positions = sections.map(section => prompt.indexOf(section));
		assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
		assert.ok(prompt.includes('- OS: Linux\n- Workspace: fixture (/repo)\n- Date: 2026-09-05'));
		assert.deepStrictEqual(memory, { project: 'PROJECT_SENTINEL', user: 'USER_SENTINEL' });
	});

	test('each execution mode retains its policy and Ask does not offer delegation', () => {
		for (const [mode, suffix] of [['agent', 'AGENT MODE (execution'], ['ask', 'ASK MODE (read-only)'], ['plan', 'PLAN MODE (read-only)'], ['debug', 'DEBUG MODE (diagnosis']] satisfies [AgentMode, string][]) {
			const prompt = buildOpenideSystemPrompt(context, mode);
			assert.ok(prompt.lastIndexOf(suffix) > prompt.indexOf('COMPLEXITY TRIAGE'));
			assert.strictEqual(prompt.includes('REGISTERED SUBAGENTS'), mode !== 'ask');
		}
	});

	test('an absent workspace and disabled delegation omit optional context without placeholders', () => {
		const prompt = buildOpenideSystemPrompt({ ...context, workspace: undefined, subagentsEnabled: false }, 'agent');
		assert.deepStrictEqual({ noFolder: prompt.includes('- Workspace: (no folder open)'), registry: prompt.includes('REGISTERED SUBAGENTS'), projectMemory: prompt.includes('PROJECT MEMORY ('), userMemory: prompt.includes('ABOUT THE USER ('), undefinedValue: prompt.includes('undefined') },
			{ noFolder: true, registry: false, projectMemory: false, userMemory: false, undefinedValue: false });
	});
});
