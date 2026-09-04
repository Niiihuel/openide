/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	chooseCredential, CREDENTIAL_KEY, credentialFromEnv, ICredentialSourcesSnapshot,
	oauthSignalsFor, OPENIDE_CREDENTIAL_SOURCES, parseOpencodeAuth,
} from '../../common/openideCredentialSources.js';

suite('OpenIDE credential sources', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('opencode: only static keys become credentials, OAuth is only a signal', () => {
		// Shape taken from a real ~/.local/share/opencode/auth.json.
		const scan = parseOpencodeAuth(JSON.stringify({
			opencode: { type: 'api', key: 'sk-zen-1' },
			openai: { type: 'oauth', access: 'a', refresh: 'r', expires: 1788488348765, accountId: 'acc' },
			enterprise: { type: 'wellknown', key: 'w', token: 't' },
			broken: { type: 'api' },
		}));
		assert.deepStrictEqual(scan.keys, { opencode: { [CREDENTIAL_KEY]: 'sk-zen-1' } });
		// A copied OAuth token dies at its first refresh (it is bound to the client id that minted
		// it), so it must never reach the chain — it is reported to be OFFERED, not used.
		assert.deepStrictEqual(scan.oauth, ['openai']);
		// `wellknown` points at a custom auth server; the stored value is not a usable secret. And
		// an `api` entry with no key is not one either.
		assert.deepStrictEqual(Object.keys(scan.keys), ['opencode']);
	});

	test('opencode: a missing, empty or malformed file is silence, not an error', () => {
		for (const text of ['', 'not json', '[]', 'null', '{}']) {
			const scan = parseOpencodeAuth(text);
			assert.deepStrictEqual(scan.keys, {});
			assert.deepStrictEqual(scan.oauth, []);
		}
	});

	test('one env name is the key; several mean ALL of them or nothing', () => {
		const one = credentialFromEnv(['OPENAI_API_KEY'], { OPENAI_API_KEY: 'sk-1' });
		assert.strictEqual(one?.values[CREDENTIAL_KEY], 'sk-1');
		assert.strictEqual(one?.origin.kind, 'env');
		assert.strictEqual(one?.origin.label, 'OPENAI_API_KEY');
		assert.strictEqual(credentialFromEnv(['OPENAI_API_KEY'], {}), undefined);

		// watsonx needs a key AND a project id: half of it is not a credential.
		const names = ['WATSONX_AI_APIKEY', 'WATSONX_AI_PROJECT_ID'];
		assert.strictEqual(credentialFromEnv(names, { WATSONX_AI_APIKEY: 'k' }), undefined);
		const both = credentialFromEnv(names, { WATSONX_AI_APIKEY: 'k', WATSONX_AI_PROJECT_ID: 'p' });
		assert.strictEqual(both?.values['WATSONX_AI_PROJECT_ID'], 'p');
		// The first name is the secret by the registry's convention, also under the shared field so
		// a single-secret consumer keeps working against a multi-value provider.
		assert.strictEqual(both?.values[CREDENTIAL_KEY], 'k');

		assert.strictEqual(credentialFromEnv([], { ANY: 'x' }), undefined);
	});

	test('precedence: what the user set HERE wins over the machine', () => {
		const snapshot: ICredentialSourcesSnapshot = {
			env: { OPENAI_API_KEY: 'sk-env' },
			sources: [{ id: 'opencode', scan: { keys: { openai: { [CREDENTIAL_KEY]: 'sk-opencode' } }, oauth: [] } }],
		};
		const lookup = { registryId: 'openai', envNames: ['OPENAI_API_KEY'], snapshot };

		const stored = chooseCredential({ ...lookup, stored: 'sk-store' });
		assert.strictEqual(stored?.values[CREDENTIAL_KEY], 'sk-store');
		assert.strictEqual(stored?.origin.kind, 'store');

		// No key here: the environment answers before another tool's file.
		const env = chooseCredential(lookup);
		assert.strictEqual(env?.values[CREDENTIAL_KEY], 'sk-env');
		assert.strictEqual(env?.origin.kind, 'env');

		// Nothing in the environment: the tool's file is the last word.
		const source = chooseCredential({ ...lookup, snapshot: { ...snapshot, env: {} } });
		assert.strictEqual(source?.values[CREDENTIAL_KEY], 'sk-opencode');
		assert.strictEqual(source?.origin.kind, 'source');
		assert.strictEqual(source?.origin.label, 'opencode');
	});

	test('nothing anywhere is undefined, not an empty credential', () => {
		assert.strictEqual(chooseCredential({}), undefined);
		assert.strictEqual(chooseCredential({ registryId: 'openai', envNames: ['OPENAI_API_KEY'], snapshot: { env: {}, sources: [] } }), undefined);
		// A provider the registry does not name cannot be matched against another tool's file.
		assert.strictEqual(chooseCredential({ envNames: [], snapshot: { env: {}, sources: [{ id: 'opencode', scan: { keys: { openai: { key: 'x' } }, oauth: [] } }] } }), undefined);
	});

	test('OAuth elsewhere is reported per source, with its label', () => {
		const snapshot: ICredentialSourcesSnapshot = {
			env: {},
			sources: [{ id: 'opencode', scan: { keys: {}, oauth: ['openai', 'anthropic'] } }],
		};
		assert.deepStrictEqual(oauthSignalsFor('openai', snapshot), [{ sourceId: 'opencode', label: 'opencode' }]);
		assert.deepStrictEqual(oauthSignalsFor('groq', snapshot), []);
		assert.deepStrictEqual(oauthSignalsFor(undefined, snapshot), []);
		assert.deepStrictEqual(oauthSignalsFor('openai', undefined), []);
	});

	test('every declared source is complete: an id, a label, a path and a parser', () => {
		assert.ok(OPENIDE_CREDENTIAL_SOURCES.length > 0);
		for (const source of OPENIDE_CREDENTIAL_SOURCES) {
			assert.ok(source.id && source.label, 'a source needs a name the UI can print');
			assert.ok(source.path.length, 'a source needs a path to read');
			// Path segments, never a joined string: main joins them with its own separator, so a
			// literal '/' here would be a source that only works on one platform.
			assert.ok(source.path.every(segment => !segment.includes('/') && !segment.includes('\\')));
			assert.deepStrictEqual(source.parse('{}'), { keys: {}, oauth: [] });
		}
	});
});
