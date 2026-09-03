/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { parseSubagentDefinition, serializeSubagentDefinition, updateSubagentDefinition } from '../../common/openideSubagentDefinition.js';

suite('OpenIDE subagent definition', () => {
	const resource = URI.file('/workspace/.openide/agents/security-auditor.md');
	test('parses canonical frontmatter and prompt', () => {
		const parsed = parseSubagentDefinition('---\nname: security-auditor\nmodel: default\ndescription: Security review\nreadonly: true\nis_background: true\ntools:\n  - search_text\n  - read_file\n---\nSystem prompt', resource, 'workspace', 1);
		assert.strictEqual(parsed.definition?.name, 'security-auditor');
		assert.deepStrictEqual(parsed.definition?.tools, ['search_text', 'read_file']);
		assert.strictEqual(parsed.definition?.systemPrompt, 'System prompt');
		assert.strictEqual(parsed.definition?.profile, undefined);
		assert.strictEqual(parsed.diagnostics.filter(d => d.severity === 'error').length, 0);
	});
	test('normalizes background alias on save', () => {
		const parsed = parseSubagentDefinition('---\nname: test-runner\ndescription: Tests\nbackground: true\n---\nPrompt', resource, 'imported', 1);
		assert.strictEqual(parsed.definition?.isBackground, true);
		const serialized = serializeSubagentDefinition(parsed.definition!);
		assert.match(serialized, /is_background: true/);
		assert.doesNotMatch(serialized, /^background:/m);
	});
	test('round trips boolean-looking strings', () => {
		const serialized = serializeSubagentDefinition({ name: 'true', model: 'false', description: 'true', readonly: true, isBackground: false, tools: ['false'], systemPrompt: 'Prompt' });
		const parsed = parseSubagentDefinition(serialized, resource, 'workspace', 1);
		assert.strictEqual(parsed.definition?.name, 'true');
		assert.strictEqual(parsed.definition?.model, 'false');
		assert.deepStrictEqual(parsed.definition?.tools, ['false']);
	});
	test('round trips profile and explicit provider/model target', () => {
		const source = '---\nname: planner\nmodel: gpt/sol\nprofile: planning\ndescription: Plan\nreadonly: true\n---\nPrompt';
		const parsed = parseSubagentDefinition(source, resource, 'workspace', 1);
		assert.strictEqual(parsed.definition?.profile, 'planning');
		assert.strictEqual(parsed.definition?.model, 'gpt/sol');
		assert.match(serializeSubagentDefinition(parsed.definition!), /profile: planning/);
	});
	test('accepts the debug routing profile', () => {
		const parsed = parseSubagentDefinition('---\nname: debugger\nprofile: debug\ndescription: Diagnose\nreadonly: true\n---\nPrompt', resource, 'workspace', 1);
		assert.strictEqual(parsed.definition?.profile, 'debug');
		assert.strictEqual(parsed.diagnostics.filter(d => d.severity === 'error').length, 0);
	});
	test('reports invalid schema and preserves updates', () => {
		const invalid = parseSubagentDefinition('---\nname: Bad Name\n---\nPrompt', resource, 'workspace', 1);
		assert.ok(invalid.diagnostics.some(d => d.severity === 'error'));
		const source = '---\nname: explorer\ndescription: Explore\nreadonly: true\n---\nPrompt';
		assert.match(updateSubagentDefinition(source, resource, 'workspace', 1, { description: 'Explore code' }), /description: Explore code/);
	});
});
