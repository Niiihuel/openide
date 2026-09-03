/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IOpenideChatContent, IOpenideChatMarkdownContent, isOpenideChatMarkdownContent } from '../../../common/chat/openideChatContent.js';
import { splitOpenOpenideChatDiagram } from '../../../common/chat/openideChatDiagramSplit.js';
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
 * Renders into a single owned element and reconciles it in place on every delta, block by block.
 * The markdown is parsed whole — that is cheap — into a detached root, and each top-level block is
 * compared with the one already on screen at the same position by its markup: equal blocks stay,
 * along with their tokenized code, their selection and their hovers; only the blocks that moved
 * are swapped in. On a streamed answer that is the last block, occasionally two, so the row does
 * not re-lay out its whole subtree per frame and the fences above the caret are never touched.
 *
 * It used to re-render everything into `domNode` on every delta. That kept the selection alive
 * but paid the full price — a rebuilt subtree and, through the async tokenizer, every fence of the
 * answer tokenized again — several times a second for the length of the turn.
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

	/** The markup each block on screen was adopted with. What `_reconcile` compares against. */
	private readonly _signatures = new WeakMap<Element, string>();
	/** Tooltips and hovers, owned per block so a kept block keeps them and a dropped one lets go. */
	private readonly _extras = new Map<Element, DisposableStore>();

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
		this.domNode = $(`div.${OPENIDE_CHAT_MARKDOWN_CLASS}.rendered-markdown`);
		this._register(this._renderer.attachLinkActivation(this.domNode));
		// A fence rendered before its grammar had loaded is plain text until this fires.
		this._register(this._renderer.onDidLoadTokenizer(() => {
			if (this._render()) {
				this._onDidChangeHeight.fire();
			}
		}));
		this._register(toDisposable(() => {
			for (const store of this._extras.values()) {
				store.dispose();
			}
			this._extras.clear();
		}));
		this._render();
	}

	/**
	 * Renders the current content and reconciles `domNode` with it. Returns whether the DOM moved.
	 */
	private _render(): boolean {
		this.domNode.classList.toggle(OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS, !this._renderedAsComplete);

		// A diagram fence that has not closed yet is held back: raw graph JSON scrolling past is
		// not something anybody reads. The SOURCE keeps accumulating in this same content untouched
		// — the split still extracts the real diagram row only when the fence closes
		// (openideChatDiagramSplit) — and what the reader gets meanwhile is the turn's live line
		// saying "Sketching the diagram…" (`openideChatLiveStatusLabel` reads this same open fence).
		//
		// It used to be a placeholder right here: a full diagram FRAME — dotted paper, hairline
		// border, 64px tall — with a shimmering line inside it, a card standing in for a picture
		// that does not exist yet. It could not even shimmer properly: the renderer below resets
		// this container on every delta, so that node was rebuilt several times a second and its
		// sweep restarted from zero each time. The live line is one node, outside this subtree, and
		// it animates for the whole turn.
		const pending = this._renderedAsComplete ? undefined : splitOpenOpenideChatDiagram(this._content.value.value);

		const rendered = this._renderer.renderBlocks(
			pending ? { ...this._content.value, value: pending.prose } : this._content.value,
			{
				// A half-written ``` fence or ** pair would otherwise render as literal
				// asterisks and backticks that flip to formatting on the next token.
				fillInIncompleteTokens: !this._renderedAsComplete,
			},
		);
		try {
			return this._reconcile(rendered.element);
		} finally {
			// Nothing of the render outlives this call: the fences were tokenized synchronously and
			// the root's own listeners belong to a scratch element. The blocks were adopted.
			rendered.dispose();
		}
	}

	/**
	 * Adopts from `root` the top-level blocks that differ from what `domNode` shows at the same
	 * position, and drops what `domNode` has past the end. Position-based on purpose: a streamed
	 * answer only ever changes its tail, and a block that shifts (a list splitting in two once
	 * `fillInIncompleteTokens` stops closing it) simply re-adopts everything after it, once.
	 */
	private _reconcile(root: HTMLElement): boolean {
		const host = this.domNode;
		const current = Array.from(host.children);
		const next = Array.from(root.children) as HTMLElement[];
		let changed = false;
		let index = 0;
		for (; index < next.length; index++) {
			const fresh = next[index];
			const signature = signatureOf(fresh);
			const shown = current[index];
			if (shown && this._signatures.get(shown) === signature) {
				continue;
			}
			changed = true;
			this._signatures.set(fresh, signature);
			if (shown) {
				this._dropExtras(shown);
				shown.replaceWith(fresh);
			} else {
				host.appendChild(fresh);
			}
			const store = new DisposableStore();
			this._extras.set(fresh, store);
			this._renderer.attachNodeExtras(fresh, store);
			// The list measured the row before the image had a size.
			// eslint-disable-next-line no-restricted-syntax
			for (const image of fresh.querySelectorAll('img')) {
				if (!image.complete) {
					store.add(addDisposableListener(image, 'load', () => this._onDidChangeHeight.fire()));
				}
			}
		}
		for (; index < current.length; index++) {
			changed = true;
			this._dropExtras(current[index]);
			current[index].remove();
		}
		return changed;
	}

	private _dropExtras(node: Element): void {
		this._extras.get(node)?.dispose();
		this._extras.delete(node);
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
	 * always reconcile it. Returning true here is what keeps the same DOM node alive across a
	 * streamed answer; only a different *kind* of content justifies rebuilding the part.
	 */
	tryUpdate(other: IOpenideChatContent, element: IOpenideChatItem): boolean {
		if (!isOpenideChatMarkdownContent(other)) {
			return false;
		}

		const completed = element.isComplete !== this._renderedAsComplete;
		this._content = other;
		this._renderedAsComplete = element.isComplete;
		if (this._render() || completed) {
			this._onDidChangeHeight.fire();
		}
		return true;
	}
}

/**
 * What a block is compared by across renders: its markup, minus the placeholder id the base
 * renderer mints per fence (`defaultGenerator.nextId()`), which differs on every render of the
 * same source and would otherwise make every fence look new.
 */
function signatureOf(block: HTMLElement): string {
	return block.outerHTML.replace(/ data-code="[^"]*"/g, '');
}
