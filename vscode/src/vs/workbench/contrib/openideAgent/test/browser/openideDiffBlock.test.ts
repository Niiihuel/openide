/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideDiffBlock } from '../../browser/openideDiffBlock.js';
import '../../browser/chat/media/openideChatNative.css';

suite('OpenIDE inline diff geometry and lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create() {
		const host = document.body.appendChild($('.openide-chat-native'));
		host.style.width = '440px';
		const row = host.appendChild($('.openide-chat-row'));
		store.add(toDisposable(() => host.remove()));
		const languages = store.add(new Emitter<void>());
		const service = new class extends mock<ILanguageService>() {
			override onDidChange = languages.event;
			override guessLanguageIdByFilepathOrFirstLine(): string { return 'unknown'; }
		};
		const block = store.add(new OpenideDiffBlock(service, NullHoverService));
		row.appendChild(block.domNode);
		return { host, block, languages };
	}

	for (const long of [false, true]) {
		test(`all rows fill the canvas with ${long ? 'overflowing' : 'short'} code, including after resize and scroll`, async () => {
			const { host, block } = create();
			block.setDiff({ path: 'file.ts', lines: [{ t: 'del', x: 'old' }, { t: 'add', x: long ? 'new '.repeat(100) : 'new' }, { t: 'add', x: '' }] });
			await timeout(40);
			const viewport = block.domNode.querySelector<HTMLElement>('.openide-diff')!;
			const rows = [...block.domNode.querySelectorAll<HTMLElement>('.openide-diff-line')];
			for (const width of [440, 260, 620]) {
				host.style.width = `${width}px`;
				block.setOpen(width === 260);
				const sizes = rows.map(row => row.getBoundingClientRect().width);
				assert.ok(sizes.every(size => Math.abs(size - sizes[0]) < 1));
				assert.ok(sizes[0] >= viewport.clientWidth);
				assert.ok(viewport.getBoundingClientRect().width <= width);
				viewport.scrollLeft = viewport.scrollWidth;
				assert.ok(rows.every(row => row.getBoundingClientRect().right >= viewport.getBoundingClientRect().right - 1));
			}
		});
	}

	test('replacing or clearing a diff cancels pending language listeners', async () => {
		const { block, languages } = create();
		for (let i = 0; i < 30; i++) {
			block.setDiff({ path: 'unknown.ext', lines: [{ t: 'add', x: String(i) }] });
		}
		assert.strictEqual(languages.hasListeners(), true);
		block.setDiff(undefined);
		await timeout(0);
		assert.strictEqual(languages.hasListeners(), false);
	});

	test('fold measurement is cancelled when the diff is disposed', () => {
		const { block, languages } = create();
		block.setDiff({ path: 'file.ts', lines: Array.from({ length: 30 }, () => ({ t: 'add', x: 'new' })) });
		block.dispose();
		assert.strictEqual(languages.hasListeners(), false);
	});
});
