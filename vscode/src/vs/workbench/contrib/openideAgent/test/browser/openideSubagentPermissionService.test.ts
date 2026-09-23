/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { SubagentPermissionService } from '../../browser/openideSubagentPermissionService.js';
import { ISubagentDefinition } from '../../common/openideSubagentTypes.js';

suite('OpenIDE subagent permissions', () => {
	const service = new SubagentPermissionService();
	const definition: ISubagentDefinition = { id: 'workspace:auditor', name: 'auditor', description: 'Audit', model: 'default', readonly: true, isBackground: true, tools: ['read_file', 'write_file'], systemPrompt: 'Audit', resource: URI.file('/a.md'), scope: 'workspace', version: 1 };
	test('readonly blocks writes at the tool layer', () => {
		assert.strictEqual(service.checkTool(definition, 'write_file', 'write').allowed, false);
		assert.deepStrictEqual(service.allowedTools(definition, ['read_file', 'write_file']), ['read_file']);
	});
	test('readonly cannot start or save a browser debug capture', () => {
		const browserDefinition = { ...definition, tools: [] };
		assert.deepStrictEqual(service.allowedTools(browserDefinition, ['browser_debug_start', 'browser_debug_status', 'browser_debug_stop', 'browser_debug_discard']), ['browser_debug_status']);
		assert.deepStrictEqual({
			start: service.checkTool(browserDefinition, 'browser_debug_start', 'safe').allowed,
			stop: service.checkTool(browserDefinition, 'browser_debug_stop', 'write').allowed,
			discard: service.checkTool(browserDefinition, 'browser_debug_discard', 'safe').allowed,
		}, { start: false, stop: false, discard: false });
	});
	test('prevents nesting cycles and depth overflow', () => {
		assert.strictEqual(service.validateNesting(definition.id, 1, [definition.id], 2).allowed, false);
		assert.strictEqual(service.validateNesting(definition.id, 3, [], 2).allowed, false);
		assert.strictEqual(service.validateNesting(definition.id, 1, [], 2).allowed, true);
	});
});
