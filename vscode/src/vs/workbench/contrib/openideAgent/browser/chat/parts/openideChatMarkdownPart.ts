/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../../base/browser/dom.js';
import { IRenderedMarkdown } from '../../../../../../base/browser/markdownRenderer.js';
import { MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { IOpenideChatContent, IOpenideChatMarkdownContent, isOpenideChatMarkdownContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { OpenideChatMarkdownRenderer } from '../openideChatMarkdown.js';
import '../media/openideChatMarkdown.css';

/** Root class of the part. The stylesheet keys the transcript's typography off it. */
export const OPENIDE_CHAT_MARKDOWN_CLASS = 'openide-chat-markdown';

/**
 * Present while the turn is still streaming. Kept as a class instead of an inserted caret node
 * so the caret survives a re-render: the node would be wiped by the next markdown pass.
 */
export const OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS = 'openide-chat-markdown-streaming';

/**
 * Assistant prose, rendered while it streams.
 *
 * Renders into a single owned element and re-renders in place on every delta. Re-rendering is
 * not free, but the alternative — letting the list drop and rebuild the part per token — loses
 * the text selection the user is making mid-answer and re-runs every code block tokenization
 * from scratch anyway. Incremental DOM morphing is the later optimisation, not the contract.
 */
export class OpenideChatMarkdownPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatMarkdownContent;
	/**
	 * Completeness *at the time of the last render*, not the item's current value. The two
	 * differ for exactly one frame — the one where the turn finishes — and that frame is what
	 * forces the final re-render, see `hasSameContent`.
	 */
	private _renderedAsComplete: boolean;

	private readonly _rendered = this._register(new MutableDisposable<IRenderedMarkdown>());

	get content(): IOpenideChatMarkdownContent {
		return this._content;
	}

	constructor(
		content: IOpenideChatMarkdownContent,
		context: IOpenideChatContentPartContext,
		private readonly _renderer: OpenideChatMarkdownRenderer,
	) {
		super();

		this._content = content;
		this._renderedAsComplete = context.element.isComplete;
		this.domNode = $(`div.${OPENIDE_CHAT_MARKDOWN_CLASS}`);
		this._render();
	}

	/**
	 * Renders into `domNode`.
	 *
	 * The previous result is disposed *before* rendering, not after: its link listeners are
	 * attached to this very node and its pending code block promises write into it by
	 * `data-code` lookup (base/browser/markdownRenderer.ts:250-262). Disposing first sets that
	 * render's `isDisposed`, so a slow tokenization from three deltas ago cannot land on top of
	 * the current text.
	 */
	private _render(): void {
		this._rendered.clear();
		this.domNode.classList.toggle(OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS, !this._renderedAsComplete);

		this._rendered.value = this._renderer.render(
			this._content.value,
			{
				// A half-written ``` fence or ** pair would otherwise render as literal
				// asterisks and backticks that flip to formatting on the next token.
				fillInIncompleteTokens: !this._renderedAsComplete,
				// Code block highlighting and images resolve after this call returns, so the
				// height the list just measured is already wrong by then.
				asyncRenderCallback: () => this._onDidChangeHeight.fire(),
			},
			this.domNode,
		);
	}

	/**
	 * Pure by contract — the renderer calls it to decide whether to touch the DOM at all.
	 *
	 * Two things force a re-render beyond a changed value: the turn completing (the synthesized
	 * closing tokens from `fillInIncompleteTokens` must go away, otherwise a final answer ending
	 * mid-word keeps a phantom closing fence), and `supportThemeIcons`, which changes how the
	 * same string is parsed.
	 */
	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
		if (!isOpenideChatMarkdownContent(other)) {
			return false;
		}

		if (element.isComplete !== this._renderedAsComplete) {
			return false;
		}

		return other.value.value === this._content.value.value
			&& !!other.value.supportThemeIcons === !!this._content.value.supportThemeIcons;
	}

	/**
	 * Absorbs any other markdown content, because this part owns its whole subtree and can
	 * always repaint it. Returning true here is what keeps the same DOM node alive across a
	 * streamed answer; only a different *kind* of content justifies rebuilding the part.
	 */
	tryUpdate(other: IOpenideChatContent, element: IOpenideChatItem): boolean {
		if (!isOpenideChatMarkdownContent(other)) {
			return false;
		}

		this._content = other;
		this._renderedAsComplete = element.isComplete;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
