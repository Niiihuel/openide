/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createProviderSetupDraft, providerIdFromName, providerSetupConfiguration, validateProviderSetupDraft } from '../../common/openideProviderSetup.js';

suite('OpenIDE provider setup validation', () => {
	function draft() {
		return { ...createProviderSetupDraft(), name: 'My provider', id: 'my-provider', baseUrl: 'http://localhost:11434/v1' };
	}

	test('generates readable identifiers without changing an existing provider', () => {
		assert.deepStrictEqual([
			providerIdFromName('  Mi API — Córdoba '), providerIdFromName('123 local API'),
			createProviderSetupDraft({ id: 'existing-id', label: 'Renamed', company: 'Acme', auth: 'apiKey', protocol: 'openai-responses', baseUrl: 'https://example.com/custom', defaultModel: 'model/a' }),
		], ['mi-api-cordoba', 'local-api', {
			name: 'Renamed', id: 'existing-id', baseUrl: 'https://example.com/custom', protocol: 'openai-responses', auth: 'apiKey', defaultModel: 'model/a', apiKey: '', idEdited: true, originalId: 'existing-id',
		}]);
	});

	test('rejects missing fields and case-insensitive duplicate IDs', () => {
		assert.deepStrictEqual({
			empty: validateProviderSetupDraft(createProviderSetupDraft()),
			duplicate: validateProviderSetupDraft(draft(), ['MY-PROVIDER']),
			own: validateProviderSetupDraft({ ...draft(), originalId: 'my-provider' }, ['my-provider']),
			changed: validateProviderSetupDraft({ ...draft(), originalId: 'previous' }, []),
		}, {
			empty: { name: 'nameRequired', id: 'idInvalid', baseUrl: 'urlRequired' },
			duplicate: { id: 'idExists' }, own: {}, changed: { id: 'idImmutable' },
		});
	});

	test('accepts local and nested API addresses but rejects credentials and ambiguous suffixes', () => {
		const urls = [
			'http://127.0.0.1:1234/v1', 'http://[::1]:1234/api/v2', 'https://gateway.example.com/team/anthropic',
			'localhost:1234/v1', 'file:///tmp/api', 'https:/example.com', 'https://exa\nmple.com/v1', 'https://user:fake@example.com/v1', 'https://example.com/v1?key=fake', 'https://example.com/v1#models',
		];
		assert.deepStrictEqual(urls.map(baseUrl => validateProviderSetupDraft({ ...draft(), baseUrl }).baseUrl), [
			undefined, undefined, undefined, 'urlInvalid', 'urlInvalid', 'urlInvalid', 'urlInvalid', 'urlCredentials', 'urlQuery', 'urlQuery',
		]);
	});

	test('keys stay out of configuration and only surrounding whitespace is normalized', () => {
		const value = { ...draft(), baseUrl: ' https://example.com/team/v2/ ', apiKey: '  fake-key  ', defaultModel: ' model/a ' };
		assert.deepStrictEqual({ errors: validateProviderSetupDraft(value), configuration: providerSetupConfiguration(value) }, {
			errors: {}, configuration: { id: 'my-provider', label: 'My provider', company: 'My provider', baseUrl: 'https://example.com/team/v2', auth: 'apiKey', protocol: 'openai', defaultModel: 'model/a', dynamicModels: true },
		});
		assert.deepStrictEqual(['Bearer fake-key', 'fake\nkey', 'fake key'].map(apiKey => validateProviderSetupDraft({ ...value, apiKey }).apiKey), ['apiKeyInvalid', 'apiKeyInvalid', 'apiKeyInvalid']);
		assert.deepStrictEqual(validateProviderSetupDraft({ ...value, auth: 'none', apiKey: 'unused value' }), {});
	});

	test('editing preserves an explicit advanced discovery override', () => {
		const value = createProviderSetupDraft({ id: 'local', label: 'Local', company: 'Local', protocol: 'openai', auth: 'none', baseUrl: 'http://localhost:1234', defaultModel: 'my-model', dynamicModels: false });
		value.name = 'Renamed';
		assert.deepStrictEqual({ dynamicModels: providerSetupConfiguration(value).dynamicModels, defaultModel: providerSetupConfiguration(value).defaultModel }, { dynamicModels: false, defaultModel: 'my-model' });
	});
});
