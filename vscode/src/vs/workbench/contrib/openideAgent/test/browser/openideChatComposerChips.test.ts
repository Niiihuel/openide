/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	capabilityText, composerPayload, extractComposerLinks, linkLabel, normalizeComposerLink,
	OpenideChatComposerChips, REFERENCE_LIMIT,
} from '../../browser/chat/openideChatComposerChips.js';

suite('OpenIDE ChatComposerChips', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	suite('helpers', () => {
		test('normalizeComposerLink keeps http(s) and strips trailing punctuation', () => {
			assert.deepStrictEqual(normalizeComposerLink('https://a.b/c).'), { url: 'https://a.b/c', suffix: ').' });
			assert.deepStrictEqual(normalizeComposerLink('www.example.com'), { url: 'https://www.example.com/', suffix: '' });
			assert.strictEqual(normalizeComposerLink('ftp://x.y'), undefined);
			assert.strictEqual(normalizeComposerLink('not a url'), undefined);
		});

		test('extractComposerLinks pulls URLs out of prose but not out of markup attributes', () => {
			const parsed = extractComposerLinks('mirá https://a.b/x y www.c.d también');
			assert.deepStrictEqual(parsed.links, ['https://a.b/x', 'https://www.c.d/']);
			assert.strictEqual(parsed.text, 'mirá y también');
			const svg = extractComposerLinks('<svg xmlns="http://www.w3.org/2000/svg">');
			assert.deepStrictEqual(svg.links, []);
			assert.strictEqual(svg.text, '<svg xmlns="http://www.w3.org/2000/svg">');
		});

		test('linkLabel drops the scheme and the bare slash', () => {
			assert.strictEqual(linkLabel('https://example.com/'), 'example.com');
			assert.strictEqual(linkLabel('https://example.com/a/b?q=1#h'), 'example.com/a/b?q=1#h');
		});

		test('capabilityText strips the chip prefixes', () => {
			assert.strictEqual(capabilityText('/review src', [{ kind: 'command', name: 'review' }]), 'src');
			assert.strictEqual(capabilityText('/review', [{ kind: 'command', name: 'review' }]), '');
		});

		test('composerPayload puts the command first and the links last', () => {
			const payload = composerPayload('fix it', [{ kind: 'command', name: 'review' }, { kind: 'skill', name: 'tests' }], ['https://a.b/']);
			assert.strictEqual(payload.text, '/review fix it\nhttps://a.b/');
			assert.strictEqual(payload.displayText, '/review /tests fix it');
			const bare = composerPayload('', [{ kind: 'skill', name: 'tests' }], []);
			assert.strictEqual(bare.text, '/tests');
		});
	});

	function create() {
		const host = $('div');
		const changes: number[] = [];
		const focuses: number[] = [];
		const chips = store.add(new OpenideChatComposerChips(host, () => changes.push(1), () => focuses.push(1)));
		return { host, chips, changes, focuses };
	}

	test('starts empty with all strips hidden', () => {
		const { host, chips } = create();
		assert.strictEqual(chips.isEmpty, true);
		assert.strictEqual(host.querySelectorAll('[hidden]').length, 3);
	});

	test('references are unique and capped', () => {
		const { host, chips } = create();
		for (let i = 0; i < REFERENCE_LIMIT; i++) { assert.strictEqual(chips.addReference({ path: `src/${i}.ts` }), true); }
		assert.strictEqual(chips.addReference({ path: 'src/0.ts' }), true, 'duplicate is a no-op, not a refusal');
		assert.strictEqual(chips.addReference({ path: 'src/extra.ts' }), false);
		assert.strictEqual(chips.references.length, REFERENCE_LIMIT);
		assert.strictEqual(host.querySelectorAll('.openide-chat-reference-chip').length, REFERENCE_LIMIT);
		assert.strictEqual(host.querySelector('.openide-chat-reference-chip .openide-chat-chip-name')?.textContent, '0.ts');
	});

	test('a second command replaces the first; skills accumulate', () => {
		const { chips } = create();
		chips.addCapability({ kind: 'command', name: 'review' });
		chips.addCapability({ kind: 'skill', name: 'tests' });
		chips.addCapability({ kind: 'command', name: 'commit' });
		assert.deepStrictEqual(chips.capabilities.map(c => c.name), ['tests', 'commit']);
	});

	test('remove button drops the chip and refocuses the prompt', () => {
		const { host, chips, focuses } = create();
		chips.addLinks(['https://a.b/', 'https://a.b/']);
		assert.strictEqual(chips.links.length, 1);
		host.querySelector<HTMLButtonElement>('.openide-chat-link-chip .openide-chat-chip-remove')!.click();
		assert.strictEqual(chips.links.length, 0);
		assert.strictEqual(chips.isEmpty, true);
		assert.strictEqual(focuses.length, 1);
	});

	test('restore and clear', () => {
		const { chips, changes } = create();
		chips.restore([{ path: 'a.ts', iconClasses: 'x' }], [{ kind: 'skill', name: 's' }], ['https://z.z/']);
		assert.strictEqual(chips.isEmpty, false);
		const before = changes.length;
		chips.clear();
		assert.strictEqual(chips.isEmpty, true);
		assert.strictEqual(changes.length, before + 1);
		chips.clear();
		assert.strictEqual(changes.length, before + 1, 'clearing an empty strip does not repaint');
	});
});
