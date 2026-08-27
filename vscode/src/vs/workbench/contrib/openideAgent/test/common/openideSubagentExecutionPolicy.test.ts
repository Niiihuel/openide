/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { assessReviewWorkload, resolveReviewerCount, resolveSubagentExecutionBudget } from '../../common/openideSubagentExecutionPolicy.js';

suite('OpenIDE subagent execution policy', () => {
	test('uses smaller role-specific budgets', () => {
		const review = resolveSubagentExecutionBudget('review', false);
		const debug = resolveSubagentExecutionBudget('debug', false);
		const research = resolveSubagentExecutionBudget('research', false);
		const implementation = resolveSubagentExecutionBudget('implementation', true);
		assert.ok(review.maxIterations < research.maxIterations);
		assert.ok(research.maxIterations < implementation.maxIterations);
		assert.ok(research.maxIterations < debug.maxIterations);
		assert.ok(review.maxOutputTokens < implementation.maxOutputTokens);
	});

	test('keeps one reviewer for standard changes', () => {
		const workload = assessReviewWorkload(['src/view.ts'], '--- a/src/view.ts\n+++ b/src/view.ts\n-old\n+new');
		assert.strictEqual(workload.risk, 'standard');
		assert.strictEqual(resolveReviewerCount('agent', 4, workload), 1);
	});

	test('keeps review token usage bounded for high-risk changes', () => {
		const workload = assessReviewWorkload(['src/auth/token.ts'], '--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n-old token\n+new token');
		assert.strictEqual(workload.risk, 'high');
		assert.strictEqual(resolveReviewerCount('agent', 2, workload), 1);
		assert.strictEqual(resolveReviewerCount('debug', 2, workload), 1);
	});
});
