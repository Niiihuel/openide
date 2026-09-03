/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IOpenideChatContent, IOpenideChatPlanUpdateContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem, isOpenideChatResponseItem } from '../../../common/chat/openideChatItem.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { openOpenideChatPlan, resolveOpenideChatPlanUri } from './openideChatPlanActions.js';
import '../media/openideChatPlan.css';

export const OPENIDE_CHAT_PLAN_TOUCH_CLASS = 'openide-chat-plan-touch';

/**
 * "Actualizando el plan…": one clickable line, never a diff.
 *
 * The webview's `startPlanTouch` / `finishPlanTouch` and the
 * `.flatrow.plan-touch` styles (:518-523). The reason it is a line and not an edit card is written
 * down at :437-439: the agent ticks the plan's checkboxes with `edit_file` on
 * `.openide/plans/*.md`, and showing that diff filled the chat with raw markdown while the plan
 * editor was already showing the same change, animated and in context.
 *
 * The pulse stops when the row settles. Unlike the webview, which settles on the tool result, this
 * part has no result to settle on — the reducer deliberately drops it (openideChatReducerTools.ts:
 * 170-176: "a plan line shows the plan advanced, OK: edited… on top of that is noise"). So the
 * signal used here is the only one the content model has: something was rendered after this row, or
 * the turn finished. Both mean the write is over.
 */
export class OpenideChatPlanUpdatePart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _text: HTMLElement;
	private _content: IOpenideChatPlanUpdateContent;
	private _settled: boolean;

	constructor(
		content: IOpenideChatPlanUpdateContent,
		context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IHoverService hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this._settled = isPlanUpdateSettled(context.content.slice(context.contentIndex + 1), context.element);

		this.domNode = $(`div.${OPENIDE_CHAT_PLAN_TOUCH_CLASS}`);
		append(this.domNode, $('span.codicon.codicon-checklist'));
		this._text = append(this.domNode, $('span.openide-chat-plan-touch-text'));
		this._register(setupChatTooltip(hoverService, this.domNode, () => t('chat.part.openPlan')));
		this.domNode.setAttribute('role', 'button');
		this.domNode.setAttribute('tabindex', '0');

		this._register(addDisposableListener(this.domNode, 'click', () => this._open()));
		this._register(addDisposableListener(this.domNode, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				this._open();
			}
		}));

		this._render();
	}

	private _render(): void {
		// Without the count the webview's `finishPlanTouch` cannot say "· N tareas" either: it reads
		// it out of the edit_file result, which never reaches the native content model.
		this._text.textContent = this._settled ? 'Plan actualizado' : 'Actualizando el plan…';
		// The line said it was working with a spinning glyph alone; the text stayed flat while every
		// other in-flight line in the transcript breathes. Same class, so there is one recipe.
		setOpenideChatShimmer(this._text, !this._settled);
		this.domNode.classList.toggle('openide-chat-plan-touch-done', this._settled);
	}

	private _open(): void {
		const uri = resolveOpenideChatPlanUri(this._contextService, this._content.path);
		if (uri) {
			openOpenideChatPlan(this._commandService, uri);
		}
	}

	/**
	 * Also false when only the settled state moved, so the pulse actually stops.
	 *
	 * This is the case `followingContent` exists for: the content object itself never changes again
	 * after the reducer pushes it, so a comparison that only looked at `path` would leave the row
	 * pulsing for the rest of the conversation.
	 */
	hasSameContent(other: IOpenideChatContent, followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'planUpdate') || other.path !== this._content.path) {
			return false;
		}
		return isPlanUpdateSettled(followingContent, element) === this._settled;
	}

	tryUpdate(other: IOpenideChatContent, element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'planUpdate') || other.path !== this._content.path) {
			return false;
		}
		this._content = other;
		// The item is the only thing `tryUpdate` receives, so the tail is recomputed from it rather
		// than trusted from the constructor's index, which a re-render may have shifted.
		this._settled = isPlanUpdateSettledInItem(element, this._content);
		this._render();
		return true;
	}
}

function isPlanUpdateSettled(followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
	return followingContent.length > 0 || element.isComplete;
}

/** Same question as above, asked when only the item is at hand: is anything rendered after this row. */
function isPlanUpdateSettledInItem(element: IOpenideChatItem, content: IOpenideChatPlanUpdateContent): boolean {
	if (!isOpenideChatResponseItem(element)) {
		return element.isComplete;
	}
	const index = element.content.lastIndexOf(content);
	if (index < 0) {
		return element.isComplete;
	}
	return isPlanUpdateSettled(element.content.slice(index + 1), element);
}
