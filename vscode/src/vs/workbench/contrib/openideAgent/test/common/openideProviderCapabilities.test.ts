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

	test('forma OpenAI: {data:[{id}]}', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }), ['gpt-5', 'gpt-5-mini']);
	});

	test('forma Antigravity: las claves del mapa son los ids', () => {
		const response = {
			models: {
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)', quotaInfo: { remainingFraction: 1 } },
				'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['claude-sonnet-4-6', 'gemini-3.6-flash-medium']);
	});

	test('las superficies internas numeradas no llegan al selector', () => {
		const response = {
			models: {
				'chat_20706': { displayName: 'chat_20706' },
				'chat_23310': {},
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['gemini-3.6-flash-medium']);
	});

	test('una entrada sin displayName cae si hay entradas con nombre', () => {
		const response = {
			models: {
				'experimento-interno': {},
				'gemini-3.6-flash-medium': { displayName: 'Gemini 3.6 Flash (Medium)' },
			},
		};
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['gemini-3.6-flash-medium']);
	});

	test('si NINGUNA entrada trae displayName no se filtra nada', () => {
		// Fail-open: a change in the response shape must not leave the user with no models.
		const response = { models: { 'gemini-3.6-flash-medium': {}, 'claude-sonnet-4-6': {} } };
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['claude-sonnet-4-6', 'gemini-3.6-flash-medium']);
	});

	test('si TODO fuera superficie interna tampoco se vacía la lista', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse({ models: { 'chat_1': {}, 'chat_2': {} } }), ['chat_1', 'chat_2']);
	});

	test('un id que sólo empieza con chat_ pero nombra un modelo se conserva', () => {
		const response = { models: { 'chat_gemini_pro': { displayName: 'Chat Gemini Pro' } } };
		assert.deepStrictEqual(modelIdsFromProviderResponse(response), ['chat_gemini_pro']);
	});

	test('respuesta vacía o inesperada no rompe', () => {
		assert.deepStrictEqual(modelIdsFromProviderResponse(undefined), []);
		assert.deepStrictEqual(modelIdsFromProviderResponse([]), []);
		assert.deepStrictEqual(modelIdsFromProviderResponse({}), []);
	});
});
