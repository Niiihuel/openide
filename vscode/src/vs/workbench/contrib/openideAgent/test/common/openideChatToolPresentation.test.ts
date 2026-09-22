/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { openideChatAuthoringFileLabel, openideChatToolPresentation } from '../../common/chat/openideChatToolPresentation.js';
import { openideChatToolStepLabel } from '../../common/chat/openideChatLiveStatus.js';

suite('OpenIDE tool activity presentation', () => {
	test('skills retain their name across partial arguments and distinct outcomes', () => {
		const args = '{"name":"rtk","description":"secret description","content":"private unfinished';
		const states = ['running', 'success', 'error', 'cancelled'] as const;
		assert.deepStrictEqual(states.map(state => {
			const { verb, detail } = openideChatToolPresentation('skill_save', args, state);
			return { verb, detail };
		}), [
			{ verb: 'Saving skill', detail: 'rtk' }, { verb: 'Saved skill', detail: 'rtk' },
			{ verb: 'Could not save skill', detail: 'rtk' }, { verb: 'Saving skill cancelled', detail: 'rtk' },
		]);
		assert.strictEqual(openideChatToolStepLabel('skill_view', '{"name":"rtk"}'), 'Loading skill rtk');
	});

	test('rules reflect delete and scope, and failed memory does not claim it was updated', () => {
		assert.deepStrictEqual([
			openideChatToolPresentation('rule_manage', '{"action":"delete","name":"rtk","scope":"global"}', 'success').verb,
			openideChatToolPresentation('rule_manage', '{"action":"save","name":"rtk","scope":"global"}', 'error').detail,
			openideChatToolPresentation('memory', '{"target":"user","action":"add","content":"private note"}', 'error'),
		], ['Deleted rule', 'rtk · Global', { verb: 'Could not update memory', detail: 'Global', icon: 'database', authoring: 'memory' }]);
	});

	test('MCP shows the exact tool while excluding its arguments', () => {
		const direct = openideChatToolPresentation('mcp_github_create_issue', '{"token":"secret"}', 'running');
		const wrapped = openideChatToolPresentation('mcp_call', '{"tool":"mcp_github_create_issue","arguments":{"token":"secret"}}', 'running');
		assert.deepStrictEqual(direct, wrapped);
		assert.strictEqual(openideChatToolStepLabel('mcp_call', '{"tool":"mcp_github_create_issue","arguments":'), 'Running MCP tool mcp_github_create_issue');
	});

	test('native configuration file edits identify hooks, MCP and skills without mislabelling source files', () => {
		assert.deepStrictEqual([
			openideChatToolStepLabel('edit_file', '{"path":".openide/hooks.json","old_text":"secret"}'),
			openideChatAuthoringFileLabel('.openide/mcp.json', 'created'),
			openideChatAuthoringFileLabel('C:\\project\\.agents\\skills\\rtk\\SKILL.md', 'updated'),
			openideChatAuthoringFileLabel('src/hooks.ts', 'updated'),
			openideChatAuthoringFileLabel('src/config.json', 'updated'),
		], ['Updating hooks hooks.json', 'Created MCP configuration', 'Updated skill', undefined, undefined]);
	});
});
