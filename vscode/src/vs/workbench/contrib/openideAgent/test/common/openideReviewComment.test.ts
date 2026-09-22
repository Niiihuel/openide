/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { reviewCommentContext, reviewCommentPrompt, reviewDiffContext } from '../../common/openideReviewComment.js';

suite('OpenIDE review comment context', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('carries the reviewed path and immutable selection with a safe code fence', () => {
		const prompt = reviewCommentPrompt({ path: 'src/first.ts', text: '  Handle an empty result  ', selection: { path: 'src/first.ts', startLine: 4, endLine: 6, languageId: 'typescript', text: 'const fence = "```";\nreturn result;' } });
		assert.ok(prompt.includes('src/first.ts (4-6)') && prompt.includes('Handle an empty result') && prompt.includes('````typescript') && prompt.includes('return result;'));
	});
	test('diff reference preserves actual edits without copying the complete file', () => {
		const context = reviewDiffContext('src/first.ts', [{ t: 'del', x: 'return result;' }, { t: 'add', x: 'return result ?? [];' }], 1, 1);
		assert.ok(context.includes('-return result;') && context.includes('+return result ?? [];') && context.includes('src/first.ts'));
		assert.ok(reviewCommentContext({ path: 'src/first.ts', text: 'Fix it', diffContext: context }).includes(context));
		assert.ok(reviewDiffContext('large.ts', Array.from({ length: 120 }, () => ({ t: 'add', x: 'x'.repeat(240) })), 120, 0).length <= 8000);
	});
});
