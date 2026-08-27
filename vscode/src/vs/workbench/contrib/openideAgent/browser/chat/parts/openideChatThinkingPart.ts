/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { IOpenideChatContent, IOpenideChatThinkingContent, isOpenideChatThinkingContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { OPENIDE_CHAT_SHIMMER_CLASS, setOpenideChatShimmer } from './openideChatActivityRow.js';
import '../media/openideChatActivity.css';

export const OPENIDE_CHAT_REASONING_CLASS = 'openide-chat-reasoning';

/**
 * Wording of the summary line, transcribed from `finalizeReasoning` (openideChatHtml.ts:2814-2821).
 *
 * The "briefly" branch is not a nicety: reasoning that lasted under two seconds rounds to "1s",
 * and a card announcing it thought for one second reads as a bug rather than as a step.
 */
function thinkingLabel(content: IOpenideChatThinkingContent): string {
	if (!content.isComplete) {
		return localize('openide.chat.thinking', "Thinking");
	}
	const seconds = Math.max(1, Math.round((content.durationMs ?? 0) / 1000));
	return seconds < 2
		? localize('openide.chat.thoughtBriefly', "Thought briefly")
		: localize('openide.chat.thoughtFor', "Thought for {0}s", seconds);
}

/**
 * The reasoning card.
 *
 * Ported from the webview's `.reasoning` block: a `<details>` that is OPEN while the model is
 * reasoning — the user watches it being written — and collapses itself the moment the block
 * settles, leaving the masked two-line peek behind. Nothing about it is a VS Code chat "thinking"
 * widget; the shimmer on the label and the mask on the body are the whole visual identity.
 */
export class OpenideChatThinkingPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _details: HTMLDetailsElement;
	private readonly _label: HTMLElement;
	private readonly _think: HTMLElement;

	private _content: IOpenideChatThinkingContent;

	/**
	 * Whether the auto-collapse already ran. Without it every later re-render of a finished turn
	 * would slam the card shut again, so a user who opened it to read the reasoning could not keep
	 * it open while the rest of the answer streamed in below.
	 */
	private _collapsedOnComplete: boolean;
	/** `openide.chat.thinking.defaultOpen`: the card never auto-collapses and restores open. */
	private readonly _defaultOpen: boolean;

	constructor(content: IOpenideChatThinkingContent, context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this._defaultOpen = context.thinkingDefaultOpen === true;
		this._collapsedOnComplete = content.isComplete;

		this._details = $(`details.${OPENIDE_CHAT_REASONING_CLASS}`) as HTMLDetailsElement;
		// Open while live, closed once settled — the state the webview creates the node in. With
		// `thinking.defaultOpen` the settled state is ALSO open: the user asked to read reasoning.
		this._details.open = !content.isComplete || this._defaultOpen;
		this.domNode = this._details;

		const summary = append(this._details, $('summary.openide-chat-reasoning-summary'));
		this._label = append(summary, $('span.openide-chat-reasoning-label'));
		append(summary, $('span.codicon.codicon-chevron-right.openide-chat-reasoning-chevron'));
		this._think = append(this._details, $('div.openide-chat-think'));

		// A <details> resizes without any of our code running, so the list would keep the height it
		// measured before the user clicked and clip (or leave a gap under) the card.
		this._register(this._registerToggle());

		this._render();
	}

	private _registerToggle() {
		const listener = () => this._onDidChangeHeight.fire();
		this._details.addEventListener('toggle', listener);
		return { dispose: () => this._details.removeEventListener('toggle', listener) };
	}

	private _render(): void {
		this._label.textContent = thinkingLabel(this._content);
		setOpenideChatShimmer(this._label, !this._content.isComplete);
		// Plain text, never markdown: reasoning is the model's scratch pad and routinely contains
		// half-open fences and stray angle brackets that a renderer would either eat or mangle.
		this._think.textContent = this._content.text;
		if (!this._content.isComplete) {
			// The card is a 320px scroll box; while it streams the user wants the newest line, which
			// is exactly what the webview does on every reasoning delta.
			this._think.scrollTop = this._think.scrollHeight;
		}
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatThinkingContent(other)) {
			return false;
		}
		return other.text === this._content.text
			&& other.isComplete === this._content.isComplete
			&& other.durationMs === this._content.durationMs;
	}

	/**
	 * Absorbs the next snapshot instead of being rebuilt.
	 *
	 * Rebuilding would reset `<details>.open` on every reasoning delta, so a card the user collapsed
	 * mid-stream would spring back open a few characters later. It would also reset the scroll box.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatThinkingContent(other)) {
			return false;
		}

		const wasComplete = this._content.isComplete;
		this._content = other;
		this._render();

		if (other.isComplete && !wasComplete && !this._collapsedOnComplete) {
			this._collapsedOnComplete = true;
			if (!this._defaultOpen) {
				this._details.open = false;
			}
		}

		this._onDidChangeHeight.fire();
		return true;
	}
}

/** Re-exported so the stylesheet's contract is greppable from the part that depends on it. */
export const OPENIDE_CHAT_THINKING_SHIMMER_CLASS = OPENIDE_CHAT_SHIMMER_CLASS;
