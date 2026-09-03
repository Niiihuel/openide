/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { allowedMarkdownHtmlAttributes, allowedMarkdownHtmlTags } from '../../../../../base/browser/markdownRenderer.js';
import { OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS } from '../../browser/chat/openideChatMarkdown.js';

/**
 * What an assistant turn is allowed to draw.
 *
 * The list is deliberately narrower than upstream's, and the two failure modes it sits between are
 * opposite: allow a tag upstream does not and the sanitizer is being widened by hand, drop one the
 * model actually writes and — with `replaceWithPlaintext` on — the tag is PRINTED instead of drawn.
 * The second one shipped: task lists rendered as the literal text `<input type="checkbox">` because
 * `input` had been excluded on the belief that the transcript never emits checkboxes.
 */
suite('OpenIDE chat markdown tags', () => {

	test('never allows a tag upstream would not', () => {
		const upstream = new Set<string>(allowedMarkdownHtmlTags as readonly string[]);
		const extra = OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS.filter(tag => !upstream.has(tag));
		assert.deepStrictEqual(extra, [], 'these tags are ours alone and nothing sanitises them upstream');
	});

	test('stays narrower than upstream: the point of the list is what it leaves out', () => {
		assert.ok(OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS.length < allowedMarkdownHtmlTags.length);
		for (const tag of ['details', 'summary', 'label', 'source', 'video', 'audio', 'form']) {
			assert.strictEqual(OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS.includes(tag), false, `${tag} must stay out`);
		}
	});

	test('allows the checkbox of a task list', () => {
		// `- [x] hecho` is how the agent reports plans and summaries, and marked turns every one of
		// them into an `<input type="checkbox">`. Dropping the tag printed it as text.
		assert.ok(OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS.includes('input'));
		// It is only safe because the attributes that make an input interactive are not allowed and
		// `renderMarkdown` forces `disabled` on every checkbox it finds.
		const attributes = new Set(allowedMarkdownHtmlAttributes.filter((a): a is string => typeof a === 'string'));
		assert.ok(attributes.has('type') && attributes.has('checked') && attributes.has('disabled'));
		for (const dangerous of ['name', 'formaction', 'onclick', 'onchange', 'form']) {
			assert.strictEqual(attributes.has(dangerous), false, `${dangerous} would make the input live`);
		}
	});

	test('carries the tags the transcript actually needs', () => {
		// `span`/`div` are what the codicons and the tokenized code block markup are built from:
		// without them every syntax-highlighted fence renders as one flat colour.
		for (const tag of ['a', 'code', 'pre', 'span', 'div', 'li', 'ul', 'ol', 'table', 'img']) {
			assert.ok(OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS.includes(tag), `${tag} is missing`);
		}
	});
});
