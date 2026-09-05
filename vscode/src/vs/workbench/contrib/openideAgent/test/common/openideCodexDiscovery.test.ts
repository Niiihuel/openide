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
		return { provider: new CodexProvider(service), calls };
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
});
