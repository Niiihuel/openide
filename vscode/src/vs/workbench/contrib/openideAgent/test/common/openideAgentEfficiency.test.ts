/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { compactAgentToolResult, resolveRetrievedContextBudget, shouldCompressMcpTools, stablePromptCacheKey } from '../../common/openideAgentEfficiency.js';

suite('OpenIDE agent efficiency', () => {
	test('scales retrieved context to the active model window', () => {
		assert.strictEqual(resolveRetrievedContextBudget(12_000, 32_000), 1_280);
		assert.strictEqual(resolveRetrievedContextBudget(12_000, 200_000), 4_000);
		assert.strictEqual(resolveRetrievedContextBudget(4_000, 200_000), 4_000);
		assert.strictEqual(resolveRetrievedContextBudget(500, 8_000), 500);
	});

	test('compacts oversized tool results while preserving head and tail', () => {
		const source = `HEAD${'x'.repeat(20_000)}TAIL`;
		const compacted = compactAgentToolResult('run_command', source, 32_000);
		assert.ok(compacted.length <= 8_000);
		assert.ok(compacted.startsWith('HEAD'));
		assert.ok(compacted.endsWith('TAIL'));
		assert.ok(compacted.includes('truncado por presupuesto'));
	});

	test('compresses only large MCP catalogs', () => {
		assert.strictEqual(shouldCompressMcpTools(8), false);
		assert.strictEqual(shouldCompressMcpTools(9), true);
	});

	test('builds stable content-addressed cache keys', () => {
		assert.strictEqual(stablePromptCacheKey('system', 'tools'), stablePromptCacheKey('system', 'tools'));
		assert.notStrictEqual(stablePromptCacheKey('system', 'tools'), stablePromptCacheKey('system changed', 'tools'));
	});
});
