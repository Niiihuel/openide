/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { identityFromClaims, identityFromTokenResponse, jwtClaims } from '../../common/openideOAuthIdentity.js';

/** A JWT with the given claims. Only the payload is real — nothing here verifies a signature. */
function jwt(claims: Record<string, unknown>): string {
	const segment = (value: object) => encodeBase64(VSBuffer.fromString(JSON.stringify(value)), false, true);
	return `${segment({ alg: 'none' })}.${segment(claims)}.signature`;
}

suite('OpenIDE — OAuth session identity', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('jwtClaims', () => {
		test('reads the payload of a three-part token', () => {
			assert.deepEqual(jwtClaims(jwt({ email: 'ada@example.com' })), { email: 'ada@example.com' });
		});

		test('decodes a payload whose length needs base64 padding', () => {
			// Lengths not divisible by 3 are exactly where a missing `=` breaks the decode.
			for (const email of ['a@b.co', 'ab@b.co', 'abc@b.co']) {
				assert.deepEqual(jwtClaims(jwt({ email })), { email }, email);
			}
		});

		test('returns undefined for what is not a JWT', () => {
			// An opaque access token is the common case, not an error.
			for (const token of ['sk-ant-oat01-abcdef', '', 'a.b', 'a.b.c.d', undefined, 42, null]) {
				assert.equal(jwtClaims(token), undefined, String(token));
			}
		});

		test('returns undefined when the payload is not JSON', () => {
			assert.equal(jwtClaims('header.bm90LWpzb24.signature'), undefined);
		});
	});

	suite('identityFromClaims', () => {
		test('prefers the email over the other names', () => {
			assert.equal(identityFromClaims({ name: 'Ada L', preferred_username: 'ada', email: 'ada@example.com' }), 'ada@example.com');
		});

		test('falls back to a username when there is no email', () => {
			assert.equal(identityFromClaims({ preferred_username: 'ada' }), 'ada');
		});

		test('finds an email nested under a namespaced claim', () => {
			// OpenAI puts it under `https://api.openai.com/auth`, not under `email`.
			const claims = { 'https://api.openai.com/auth': { user_email: 'ada@example.com' } };
			assert.equal(identityFromClaims(claims), 'ada@example.com');
		});

		test('ignores empty strings and non-strings', () => {
			assert.equal(identityFromClaims({ email: '   ', name: 7, preferred_username: 'ada' }), 'ada');
		});

		test('returns undefined for nothing usable', () => {
			assert.equal(identityFromClaims({ sub: 'user_123' }), undefined);
			assert.equal(identityFromClaims(undefined), undefined);
		});
	});

	suite('identityFromTokenResponse', () => {
		test('reads the account object Anthropic returns', () => {
			assert.equal(identityFromTokenResponse({ account: { email_address: 'ada@example.com' } }), 'ada@example.com');
		});

		test('reads the id_token OpenAI signs', () => {
			const json = { access_token: 'opaque', id_token: jwt({ email: 'ada@example.com' }) };
			assert.equal(identityFromTokenResponse(json), 'ada@example.com');
		});

		test('falls back to the access token when it is itself a JWT', () => {
			// This is what names sessions signed in before the identity was ever stored.
			assert.equal(identityFromTokenResponse({ access_token: jwt({ email: 'ada@example.com' }) }), 'ada@example.com');
		});

		test('prefers the explicit account over anything decoded', () => {
			const json = { account: { email: 'primary@example.com' }, id_token: jwt({ email: 'other@example.com' }) };
			assert.equal(identityFromTokenResponse(json), 'primary@example.com');
		});

		test('returns undefined when the provider says nothing', () => {
			assert.equal(identityFromTokenResponse({ access_token: 'sk-opaque', expires_in: 3600 }), undefined);
			assert.equal(identityFromTokenResponse({}), undefined);
			assert.equal(identityFromTokenResponse(undefined), undefined);
		});
	});
});
