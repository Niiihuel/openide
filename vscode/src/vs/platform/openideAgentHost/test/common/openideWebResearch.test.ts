/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { canonicalWebUrl, isPrivateWebAddress, stripWebHtml, validatePublicWebUrl } from '../../common/openideWebResearch.js';

suite('OpenIDE web research security', () => {
	test('blocks local, private, metadata and credentialed URLs', () => {
		for (const url of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://169.254.169.254/latest', 'https://user:pass@example.com/']) {
			assert.throws(() => validatePublicWebUrl(url));
		}
		assert.throws(() => validatePublicWebUrl('http://example.com'));
		assert.strictEqual(validatePublicWebUrl('https://example.com/docs').hostname, 'example.com');
	});

	test('classifies IPv4 and IPv6 private ranges', () => {
		for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '172.16.0.1', '192.168.1.1', '224.0.0.1', '::1', 'fe80::1', 'fd00::1']) { assert.strictEqual(isPrivateWebAddress(address), true, address); }
		assert.strictEqual(isPrivateWebAddress('8.8.8.8'), false);
		assert.strictEqual(isPrivateWebAddress('2606:4700:4700::1111'), false);
	});

	test('enforces allowlist and blocklist', () => {
		assert.strictEqual(validatePublicWebUrl('https://docs.example.com/a', { allowedHosts: ['example.com'] }).hostname, 'docs.example.com');
		assert.throws(() => validatePublicWebUrl('https://other.test/a', { allowedHosts: ['example.com'] }));
		assert.throws(() => validatePublicWebUrl('https://docs.example.com/a', { blockedHosts: ['example.com'] }));
	});

	test('canonicalizes tracking parameters and extracts inert readable HTML', () => {
		assert.strictEqual(canonicalWebUrl('https://example.com/a?utm_source=x&ok=1#frag'), 'https://example.com/a?ok=1');
		const result = stripWebHtml('<title>A &amp; B</title><script>steal()</script><h1>Hello</h1><p>World &lt;3</p><form>secret</form>', 1000);
		assert.strictEqual(result.title, 'A & B');
		assert.match(result.text, /Hello/);
		assert.match(result.text, /World <3/);
		assert.doesNotMatch(result.text, /steal|secret/);
	});
});
