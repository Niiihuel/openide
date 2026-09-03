/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { IPlanTargetContext, resolvePlanTarget } from '../../common/openidePlanTarget.js';

/**
 * The plan's breadcrumb button literally said "Model" instead of the model, and Build
 * started with the provider default: two different fallbacks for the same question.
 * These tests pin the single policy.
 */
suite('OpenIDE plan target', () => {

	function context(overrides: Partial<IPlanTargetContext> = {}): IPlanTargetContext {
		return {
			activeProviderId: 'anthropic',
			modelForProvider: providerId => providerId === 'anthropic' ? 'claude-opus-5' : '',
			defaultModelForProvider: providerId => providerId === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5',
			...overrides,
		};
	}

	test('the frontmatter wins over whatever is active in the chat', () => {
		const target = resolvePlanTarget({ execProvider: 'openai', execModel: 'gpt-5-mini' }, context());
		assert.deepStrictEqual(target, { providerId: 'openai', model: 'gpt-5-mini' });
	});

	test('with no execModel, the plan uses the chat\'s active model', () => {
		// This is the "in tune with the chat" behaviour: picking a model down in the composer changes
		// what the plan runs with, without editing the .md.
		assert.deepStrictEqual(resolvePlanTarget({}, context()), { providerId: 'anthropic', model: 'claude-opus-5' });
	});

	test('the catalog default is the last resort, not the first', () => {
		const target = resolvePlanTarget({}, context({ modelForProvider: () => '' }));
		assert.strictEqual(target.model, 'claude-sonnet-5');
	});

	test('an explicit execProvider pulls in the model chosen for THAT provider', () => {
		// The tuning bug in reverse: taking the active provider's model with the plan's provider.
		const target = resolvePlanTarget({ execProvider: 'openai' }, context());
		assert.deepStrictEqual(target, { providerId: 'openai', model: 'gpt-5' });
	});

	test('with no provider connected it returns empty instead of inventing a model', () => {
		const target = resolvePlanTarget({}, context({ activeProviderId: '', modelForProvider: () => '', defaultModelForProvider: () => '' }));
		assert.deepStrictEqual(target, { providerId: '', model: '' });
	});
});
