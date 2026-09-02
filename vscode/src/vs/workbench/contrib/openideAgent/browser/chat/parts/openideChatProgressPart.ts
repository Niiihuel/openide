/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, reset } from '../../../../../../base/browser/dom.js';
import { IOpenideChatContent, IOpenideChatProgressContent, isOpenideChatProgressContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { OPENIDE_CHAT_PART_LIVE_CLASS } from './openideChatActivityRow.js';
// For `.openide-chat-part-live`: the class is declared there, with the rows it was written for.
import '../media/openideChatActivity.css';

export const OPENIDE_CHAT_PROGRESS_CLASS = 'openide-chat-progress';

/**
 * Only the trailing line of a live turn animates; a settled line must not keep pulsing.
 *
 * This is the shared shimmer (`openideChatActivity.css`), not a second copy of the recipe. There
 * used to be one — `.openide-chat-progress-active`, byte-identical to `.openide-chat-shimmer` and
 * carrying the same defect: it was applied to this row, which is a flex container, so
 * `background-clip: text` had no text of its own to clip against and the sweep never showed.
 */
export const OPENIDE_CHAT_PROGRESS_LABEL_CLASS = 'openide-chat-progress-label';
export const OPENIDE_CHAT_SHIMMER_CLASS = 'openide-chat-shimmer';

/**
 * Decides whether this line is the one still happening. Anything rendered after it means the
 * step it described already produced its outcome, so the animation has to stop even though the
 * turn as a whole is still running.
 */
function isActiveProgress(content: IOpenideChatProgressContent, followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
	return content.shimmer !== false && !element.isComplete && followingContent.length === 0;
}

/**
 * The single-line fallback row.
 *
 * Stage 1 has a part for markdown and nothing else, so every other event lands here. The reducer
 * already carries `sourceEvent`, which is what makes a missing part greppable from a screenshot
 * instead of a silent gap in the transcript.
 */
export class OpenideChatProgressPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;
	private readonly _label: HTMLElement;

	private readonly _content: IOpenideChatProgressContent;
	private readonly _active: boolean;

	constructor(
		content: IOpenideChatProgressContent,
		context: IOpenideChatContentPartContext,
	) {
		super();

		this._content = content;
		this._active = isActiveProgress(content, context.content.slice(context.contentIndex + 1), context.element);
		this.domNode = $(`div.${OPENIDE_CHAT_PROGRESS_CLASS}`);
		// The text lives in a child: the shimmer clips a gradient to it, and a flex row owns no
		// text of its own to clip against.
		this._label = $(`span.${OPENIDE_CHAT_PROGRESS_LABEL_CLASS}`);
		this.domNode.appendChild(this._label);
		this._render();
	}

	private _render(): void {
		// An ACTIVE line is the step in flight, and the step in flight is drawn once: on the turn's
		// status line, which is already saying this exact text and swaps it out for the next step.
		// The row keeps existing so that the moment something lands after it — which is what makes
		// `_active` false and rebuilds the part — the line settles into the transcript as a record.
		this.domNode.classList.toggle(OPENIDE_CHAT_PART_LIVE_CLASS, this._active);
		this._label.classList.toggle(OPENIDE_CHAT_SHIMMER_CLASS, this._active);
		// Plain text on purpose: this row exists to surface events nobody wrote a part for yet,
		// and running unreviewed strings through a markdown renderer widens that surface.
		reset(this._label, this._content.text);
	}

	hasSameContent(other: IOpenideChatContent, followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
		if (!isOpenideChatProgressContent(other)) {
			return false;
		}
		return other.text === this._content.text && isActiveProgress(other, followingContent, element) === this._active;
	}

	// No `tryUpdate`: the part is a single text node, so recreating it is as cheap as mutating it,
	// and an in-place update would have to recompute `_active` without seeing what follows the
	// line — the one input `hasSameContent` gets and `tryUpdate` does not.
}
