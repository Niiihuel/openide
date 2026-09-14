/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { CodexProvider } from '../../common/providers/codexProvider.js';

suite('OpenIDE Codex discovery', () => {
	function setup(body: string, statusCode = 200) {
		const calls: IRequestOptions[] = [];
		const service: IRequestService = {
			_serviceBrand: undefined, onDidCompleteRequest: Event.None,
			async request(options) { calls.push(options); return { res: { statusCode, headers: {} }, stream: bufferToStream(VSBuffer.fromString(body)) }; },
			async resolveProxy() { return undefined; }, async lookupAuthorization() { return undefined; },
			async lookupKerberosAuthorization() { return undefined; }, async loadCertificates() { return []; },
		};
		return { provider: new CodexProvider(service), calls, setBody: (value: string) => { body = value; } };
	}
	const credential = { kind: 'oauth' as const, token: 'test-token' };

	test('discovers new model slugs from the account catalog, excluding hidden models', async () => {
		const { provider, calls } = setup(JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }, { slug: 'internal', visibility: 'hide' }, { slug: 'gpt-6-astra' }, {}] }));
		assert.deepStrictEqual(await provider.listModels({ credential }, CancellationToken.None), ['gpt-6-astra']);
		assert.strictEqual(calls[0].url, 'https://chatgpt.com/backend-api/codex/models?client_version=0.153.4');
	});

	test('honors endpoint overrides and reports discovery failures', async () => {
		const { provider, calls } = setup('{}', 401);
		await assert.rejects(() => provider.listModels({ credential, baseUrl: 'https://example.test/codex/' }, CancellationToken.None), /HTTP 401/);
		assert.ok(calls[0].url?.startsWith('https://example.test/codex/models?'));
	});

	test('rejects malformed responses and does not use API keys for subscription discovery', async () => {
		const { provider, calls } = setup('{}');
		await assert.rejects(() => provider.listModels({ credential }, CancellationToken.None), /Invalid Codex/);
		assert.deepStrictEqual(await provider.listModels({ credential: { kind: 'apiKey', value: 'test-key' } }, CancellationToken.None), []);
		assert.strictEqual(calls.length, 1);
	});

	test('preserves Astra max effort instead of clamping it to high', async () => {
		const { provider, calls } = setup('data: {"type":"response.completed","response":{}}\n\n');
		await provider.streamChat({ credential, model: 'gpt-6-astra', effort: 'max', messages: [] }, () => {}, CancellationToken.None);
		assert.strictEqual(JSON.parse(calls[0].data!).reasoning.effort, 'max');
	});
	test('priority capability comes from visible live model tiers and is isolated by provider and endpoint', async () => {
		const { provider, setBody } = setup(JSON.stringify({ models: [
			{ slug: 'fast-model', service_tiers: [{ id: 'priority' }] },
			{ slug: 'standard-model', service_tiers: [] },
			{ slug: 'hidden', visibility: 'hide', service_tiers: [{ id: 'priority' }] },
		] }));
		assert.strictEqual(provider.getFastModeCapability('fast-model', 'account').supported, false);
		assert.strictEqual(provider.getFastModeCapability('gpt-6-astra', 'account').supported, false);
		await provider.listModels({ credential, providerId: 'account' }, CancellationToken.None);
		assert.deepStrictEqual(provider.getFastModeCapability('fast-model', 'account'), { supported: true, serviceTier: 'priority' });
		assert.strictEqual(provider.getFastModeCapability('standard-model', 'account').supported, false);
		assert.strictEqual(provider.getFastModeCapability('hidden', 'account').supported, false);
		assert.strictEqual(provider.getFastModeCapability('fast-model', 'other').supported, false);
		assert.strictEqual(provider.getFastModeCapability('fast-model', 'account', 'https://other.test').supported, false);
		setBody('{}');
		await assert.rejects(() => provider.listModels({ credential, providerId: 'account' }, CancellationToken.None));
		assert.strictEqual(provider.getFastModeCapability('fast-model', 'account').supported, false);
	});

	test('transmits priority only for an explicit supported request and clears capability on account reset', async () => {
		const { provider, calls, setBody } = setup(JSON.stringify({ models: [{ slug: 'fast-model', service_tiers: [{ id: 'priority' }] }] }));
		await provider.listModels({ credential, providerId: 'account' }, CancellationToken.None);
		setBody('data: {"type":"response.completed","response":{}}\n\n');
		const request = { credential, providerId: 'account', model: 'fast-model', messages: [] };
		await provider.streamChat(request, () => {}, CancellationToken.None);
		assert.strictEqual(JSON.parse(calls.at(-1)!.data!).service_tier, undefined);
		await provider.streamChat({ ...request, serviceTier: 'priority' }, () => {}, CancellationToken.None);
		assert.strictEqual(JSON.parse(calls.at(-1)!.data!).service_tier, 'priority');
		await provider.streamChat(request, () => {}, CancellationToken.None);
		assert.strictEqual(JSON.parse(calls.at(-1)!.data!).service_tier, undefined);
		await provider.streamChat({ ...request, model: 'unknown', serviceTier: 'priority' }, () => {}, CancellationToken.None);
		assert.strictEqual(JSON.parse(calls.at(-1)!.data!).service_tier, undefined);
		provider.resetSessionState();
		assert.strictEqual(provider.getFastModeCapability('fast-model', 'account').supported, false);
	});

});
