/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { modelIdsFromProviderResponse } from '../../common/openideProviderCapabilities.js';

/**
 * Antigravity returns `{models: {"<id>": {displayName, quotaInfo}}}` and mixes internal entries
 * into it (`chat_20706`, `chat_23310`) that used to reach the chat picker as if they were
 * modelos elegibles.
 */
suite('OpenIDE provider model discovery', () => {

	test('OpenAI shape: {data:[{id}]}', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }), ['gpt-5', 'gpt-5-mini']);
	});

	test('Antigravity shape: the map keys are the ids', () => {
		const response = {
			models: {
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)', quotaInfo: { remainingFraction: 1 } },
				'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['claude-sonnet-4-6', 'gemini-3.6-flash-medium']);
	});

	test('the numbered internal surfaces never reach the picker', () => {
		const response = {
			models: {
				'chat_20706': { displayName: 'chat_20706' },
				'chat_23310': {},
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['gemini-3.6-flash-medium']);
	});

	test('an entry with no displayName is dropped when named entries exist', () => {
		const response = {
			models: {
				'experimento-interno': {},
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['gemini-3.6-flash-medium']);
	});

	test('if NO entry carries a displayName nothing is filtered', () => {
		// Fail-open: a change in the response shape must not leave the user with no models.
		const response = { models: { 'gemini-3.6-flash-medium': {}, 'claude-sonnet-4-6': {} } };
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['claude-sonnet-4-6', 'gemini-3.6-flash-medium']);
	});

	test('if EVERYTHING were an internal surface the list is still not emptied', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse({ models: { 'chat_1': {}, 'chat_2': {} } }), ['chat_1', 'chat_2']);
	});

	test('an id that merely starts with chat_ but names a model is kept', () => {
		const response = { models: { 'chat_gemini_pro': { displayName: 'Chat Gemini Pro' } } };
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['chat_gemini_pro']);
	});

	test('an empty or unexpected response does not break', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse(undefined), []);
		assert.deepStrictEqual(modelIdsFromProviderResponse([]), []);
		assert.deepStrictEqual(modelIdsFromProviderResponse({}), []);
	});
});
