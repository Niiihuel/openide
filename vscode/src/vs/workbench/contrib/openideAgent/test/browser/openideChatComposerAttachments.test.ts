/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { ATTACH_LIMIT, OpenideChatComposerAttachments } from '../../browser/chat/openideChatComposerAttachments.js';

suite('OpenIDE ChatComposerAttachments', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const file = (name = 'reference.png') => new File(['image bytes'], name, { type: 'image/png' });
	function create() {
		const strip = $('div');
		const attachments = store.add(new OpenideChatComposerAttachments(strip, $('div'), NullHoverService, new class extends mock<IFileService>() { }, () => { }));
		return { strip, attachments };
	}

	test('concurrent file reads respect the attachment limit', async () => {
		const { strip, attachments } = create();
		await Promise.all(Array.from({ length: ATTACH_LIMIT + 3 }, (_, i) => attachments.addFile(file(`${i}.png`))));
		assert.deepStrictEqual({ images: attachments.images.length, chips: strip.children.length }, { images: ATTACH_LIMIT, chips: ATTACH_LIMIT });
	});

	test('clear and restore invalidate pending reads even with an empty strip', async () => {
		const { attachments } = create();
		const first = attachments.addFile(file());
		attachments.clear();
		await first;
		assert.strictEqual(attachments.isEmpty, true);
		const second = attachments.addFile(file());
		attachments.restore([{ name: 'restored.png', mimeType: 'image/png', data: 'restored' }]);
		await second;
		assert.deepStrictEqual(attachments.images.map(image => image.name), ['restored.png']);
	});

	test('filenames remain readable and each remove action names its attachment', async () => {
		const { strip, attachments } = create();
		await attachments.addFile(file('design-reference.png'));
		const remove = strip.querySelector<HTMLButtonElement>('.openide-attach-remove')!;
		assert.deepStrictEqual({ name: attachments.images[0].name, label: strip.querySelector('.openide-attach-name')?.textContent, accessible: remove.getAttribute('aria-label')?.includes('design-reference.png') }, { name: 'design-reference.png', label: 'design-reference.png', accessible: true });
		remove.click();
		assert.strictEqual(attachments.isEmpty, true);
	});
});
