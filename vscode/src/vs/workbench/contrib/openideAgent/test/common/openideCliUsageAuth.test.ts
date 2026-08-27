/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	CLI_TOKEN_SKEW_MS,
	cliCredentialExpired,
	cliUsageAccountOf,
	isCliUsageAccountId,
	OPENIDE_CLI_USAGE_ACCOUNTS,
	parseClaudeCliCredentials,
	parseCliCredential,
	parseCodexCliAuth,
	parseGeminiCliCredentials,
	parseGrokCliAuth,
} from '../../common/openideCliUsageAuth.js';

function jwtWith(payload: Record<string, unknown>): string {
	const encode = (value: unknown) => encodeBase64(VSBuffer.fromString(JSON.stringify(value)), false, true);
	return `${encode({ alg: 'none' })}.${encode(payload)}.firma`;
}

suite('OpenIDE CLI usage credential stores', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('every CLI account routes through parseCliCredential and carries a cli- id', () => {
		for (const def of OPENIDE_CLI_USAGE_ACCOUNTS) {
			assert.strictEqual(isCliUsageAccountId(def.id), true, def.id);
			assert.strictEqual(cliUsageAccountOf(def.id), def);
			// A garbage store never throws — a corrupt file must read as "signed out".
			assert.strictEqual(parseCliCredential(def.kind, 'no es json'), undefined, def.id);
			assert.strictEqual(parseCliCredential(def.kind, '{}'), undefined, def.id);
		}
		assert.strictEqual(isCliUsageAccountId('anthropic'), false);
		assert.strictEqual(cliUsageAccountOf('anthropic'), undefined);
	});

	test('Claude Code: claudeAiOauth with token, expiry and plan', () => {
		const parsed = parseClaudeCliCredentials(JSON.stringify({
			claudeAiOauth: { accessToken: 'sk-ant-oat-x', refreshToken: 'sk-ant-ort-y', expiresAt: 1_756_000_000_000, scopes: ['user:inference'], subscriptionType: 'max' },
		}));
		assert.deepStrictEqual(parsed, { token: 'sk-ant-oat-x', expiresAt: 1_756_000_000_000, refreshToken: 'sk-ant-ort-y', plan: 'max' });
		// Sin accessToken no hay cuenta, aunque el resto esté.
		assert.strictEqual(parseClaudeCliCredentials(JSON.stringify({ claudeAiOauth: { refreshToken: 'r' } })), undefined);
	});

	test('Codex: tokens.access_token with the expiry read from the JWT exp claim', () => {
		const token = jwtWith({ exp: 1_756_000_000, 'https://api.openai.com/auth': { chatgpt_account_id: 'acc' } });
		const parsed = parseCodexCliAuth(JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'id', access_token: token, refresh_token: 'rt', account_id: 'acc' }, last_refresh: '2026-08-26T00:00:00Z' }));
		assert.strictEqual(parsed?.token, token);
		assert.strictEqual(parsed?.expiresAt, 1_756_000_000_000);
		assert.strictEqual(parsed?.refreshToken, 'rt');
		// Un access_token opaco (sin exp legible) queda sin expiry: el 401 decide.
		const opaque = parseCodexCliAuth(JSON.stringify({ tokens: { access_token: 'opaco' } }));
		assert.strictEqual(opaque?.expiresAt, null);
	});

	test('Gemini CLI: google-auth-library shape with expiry_date', () => {
		const parsed = parseGeminiCliCredentials(JSON.stringify({ access_token: 'ya29.x', refresh_token: '1//r', expiry_date: 1_756_000_000_000, token_type: 'Bearer' }));
		assert.deepStrictEqual(parsed, { token: 'ya29.x', expiresAt: 1_756_000_000_000, refreshToken: '1//r', plan: null });
	});

	test('Grok: prefers the auth.x.ai issuer over stale alternates (Orca ordering)', () => {
		const fresh = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		const both = parseGrokCliAuth(JSON.stringify({
			'https://otro.issuer': { key: 'alterno', expires_at: fresh },
			'https://auth.x.ai': { key: 'preferido', expires_at: fresh },
		}));
		assert.strictEqual(both?.token, 'preferido');
		// Un preferido vencido gana igual sobre el alterno (la fila dice la verdad: expirado).
		const expiredPreferred = parseGrokCliAuth(JSON.stringify({
			'https://otro.issuer': { key: 'alterno', expires_at: fresh },
			'https://auth.x.ai::team': { key: 'preferido-vencido', expires_at: new Date(Date.now() - 1000).toISOString() },
		}));
		assert.strictEqual(expiredPreferred?.token, 'preferido-vencido');
		// El alterno solo cuenta cuando NO existe ninguna entrada del issuer por defecto.
		const fallbackOnly = parseGrokCliAuth(JSON.stringify({ 'https://otro.issuer': { key: 'alterno' } }));
		assert.strictEqual(fallbackOnly?.token, 'alterno');
		const emptyPreferred = parseGrokCliAuth(JSON.stringify({ 'https://auth.x.ai': {}, 'https://otro.issuer': { key: 'alterno' } }));
		assert.strictEqual(emptyPreferred, undefined);
	});

	test('cliCredentialExpired applies the skew and tolerates a store without expiry', () => {
		const now = Date.now();
		const base = { token: 't', refreshToken: null, plan: null };
		assert.strictEqual(cliCredentialExpired({ ...base, expiresAt: null }, now), false);
		assert.strictEqual(cliCredentialExpired({ ...base, expiresAt: now + CLI_TOKEN_SKEW_MS + 1000 }, now), false);
		assert.strictEqual(cliCredentialExpired({ ...base, expiresAt: now + CLI_TOKEN_SKEW_MS - 1000 }, now), true);
		assert.strictEqual(cliCredentialExpired({ ...base, expiresAt: now - 1000 }, now), true);
	});
});
