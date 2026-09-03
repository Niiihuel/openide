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
import { IProviderRateLimits, mergeUsageAccountsByIdentity } from '../../common/openideUsage.js';
import { usageAccountKeyFromToken } from '../../common/openideUsageIdentity.js';

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: unknown) => encodeBase64(VSBuffer.fromString(JSON.stringify(value)), false, true);
	return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.firma`;
}

function usage(accountKey: string | null, ok = true): IProviderRateLimits {
	return {
		providerId: 'x',
		fetchedAt: Date.now(),
		windows: ok ? [{ label: '5h', usedPercent: 10, limitMinutes: 300, resetsAt: null, resetDescription: null }] : [],
		status: ok ? 'ok' : 'error',
		accountKey,
	};
}

const isCli = (id: string) => id.startsWith('cli-');

suite('OpenIDE usage account identity', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the key is issuer + subject, so two providers cannot collide on the same id', () => {
		const openai = usageAccountKeyFromToken(jwt({ iss: 'https://auth.openai.com', sub: '12345' }));
		const xai = usageAccountKeyFromToken(jwt({ iss: 'https://auth.x.ai', sub: '12345' }));
		assert.strictEqual(openai, 'https://auth.openai.com#12345');
		assert.notStrictEqual(openai, xai, 'the same id under two issuers can NOT be the same account');
	});

	test('the billed-account claim outranks the user, including when it is nested', () => {
		// OpenAI publishes it inside a namespaced object; the account is what is billed, not the user.
		const nested = usageAccountKeyFromToken(jwt({
			iss: 'https://auth.openai.com',
			sub: 'user-abc',
			'https://api.openai.com/auth': { chatgpt_account_id: 'acct-999' },
		}));
		assert.strictEqual(nested, 'https://auth.openai.com#acct-999');
		// Top-level account claims win over `sub` too.
		assert.strictEqual(
			usageAccountKeyFromToken(jwt({ iss: 'https://i', sub: 'user', account_id: 'acct-1' })),
			'https://i#acct-1',
		);
	});

	test('a credential that says nothing yields no key', () => {
		// Anthropic's opaque token: not a JWT at all.
		assert.strictEqual(usageAccountKeyFromToken('sk-ant-oat01-abcdef'), undefined);
		assert.strictEqual(usageAccountKeyFromToken(''), undefined);
		assert.strictEqual(usageAccountKeyFromToken(undefined), undefined);
		// A JWT without an issuer, or without any subject claim, is not enough to merge on.
		assert.strictEqual(usageAccountKeyFromToken(jwt({ sub: '1' })), undefined);
		assert.strictEqual(usageAccountKeyFromToken(jwt({ iss: 'https://i' })), undefined);
		// Garbage never throws.
		assert.strictEqual(usageAccountKeyFromToken('a.b.c'), undefined);
	});

	test('the issuer is compared case-insensitively but the subject is not', () => {
		assert.strictEqual(
			usageAccountKeyFromToken(jwt({ iss: 'https://Auth.OpenAI.com', sub: 'Acct-A' })),
			'https://auth.openai.com#Acct-A',
		);
	});
});

suite('OpenIDE usage account merge', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the same account from two sources becomes one row that names both', () => {
		const key = 'https://auth.openai.com#acct-1';
		const merged = mergeUsageAccountsByIdentity([
			{ id: 'openai-codex', label: 'ChatGPT (Codex subscription)', usage: usage(key) },
			{ id: 'cli-codex', label: 'Codex CLI', usage: usage(key) },
		], isCli);
		assert.strictEqual(merged.length, 1);
		// The in-app account keeps the row: it is the one the chat actually spends.
		assert.strictEqual(merged[0].account.id, 'openai-codex');
		assert.deepStrictEqual(merged[0].alsoFrom, ['Codex CLI']);
	});

	test('a row with data wins over one without, whichever source it came from', () => {
		const key = 'https://auth.x.ai#u1';
		const merged = mergeUsageAccountsByIdentity([
			{ id: 'xai-oauth', label: 'Grok', usage: usage(key, false) },
			{ id: 'cli-grok', label: 'Grok CLI', usage: usage(key, true) },
		], isCli);
		assert.strictEqual(merged.length, 1);
		assert.strictEqual(merged[0].account.id, 'cli-grok', 'the row that carries data is the useful one');
		assert.deepStrictEqual(merged[0].alsoFrom, ['Grok']);
	});

	test('rows without an identity are never merged, even when they look alike', () => {
		// Anthropic: two rows, no claims. Merging them would hide a real subscription.
		const merged = mergeUsageAccountsByIdentity([
			{ id: 'anthropic-oauth', label: 'Claude', usage: usage(null) },
			{ id: 'cli-claude', label: 'Claude Code', usage: usage(null) },
			{ id: 'openrouter', label: 'OpenRouter', usage: undefined },
		], isCli);
		assert.strictEqual(merged.length, 3);
		assert.deepStrictEqual(merged.map(row => row.alsoFrom), [[], [], []]);
	});

	test('different accounts of the same provider stay apart', () => {
		const merged = mergeUsageAccountsByIdentity([
			{ id: 'openai-codex', label: 'Trabajo', usage: usage('https://auth.openai.com#acct-1') },
			{ id: 'cli-codex', label: 'Personal', usage: usage('https://auth.openai.com#acct-2') },
		], isCli);
		assert.strictEqual(merged.length, 2);
	});

	test('three sources of one account fold into a single row without repeating a name', () => {
		const key = 'https://auth.openai.com#acct-1';
		const merged = mergeUsageAccountsByIdentity([
			{ id: 'cli-codex', label: 'Codex CLI', usage: usage(key) },
			{ id: 'openai-codex', label: 'ChatGPT', usage: usage(key) },
			{ id: 'other-codex', label: 'Codex CLI', usage: usage(key) },
		], isCli);
		assert.strictEqual(merged.length, 1);
		assert.strictEqual(merged[0].account.id, 'openai-codex');
		assert.deepStrictEqual(merged[0].alsoFrom, ['Codex CLI']);
	});
});
