/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenideChatContent, IOpenideChatEditContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { OpenideDiffBlock } from '../../openideDiffBlock.js';
import { OpenideChatFileRow } from './openideChatFileRow.js';
import '../media/openideChatFiles.css';

export const OPENIDE_CHAT_EDIT_CARD_CLASS = 'openide-chat-edit-card';

/**
 * The `write_file` / `edit_file` card.
 *
 * Visually this is the webview's `.part.edit-card`: one bordered card, one header — file icon +
 * basename + `nuevo` badge + ±N — and, under it, the inline diff. The diff is NOT this part's:
 * it is `OpenideDiffBlock`, the one block the product has for showing a change inline, shared
 * with the Agent Changes view so a change looks the same wherever it is met. The card only
 * decides when the block is shown (once the write's diff lands) and what sits above it.
 *
 * Clicking the header opens the change in the editor. `openDiff` is the whole remote control, and it is already two behaviours in one
 * (openideAgentService.ts:1543-1559): a file with a pending snapshot opens with the inline review
 * attached, a file already kept or reverted opens flat. That is exactly the difference between
 * "revisar el cambio" and "abrir el archivo", decided by state rather than by two buttons the user
 * would have to choose between.
 *
 * There is deliberately no Keep/Undo here even though the dock row has them: accepting is a
 * per-file operation on the CURRENT state of the workspace, and offering it from a card that
 * belongs to an old turn invites accepting numbers that have since changed. The tray, which only
 * ever shows what is still pending, owns that.
 */
export class OpenideChatEditPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatEditContent;
	private _isComplete: boolean;
	private readonly _row: OpenideChatFileRow;
	private readonly _body: HTMLElement;
	/** The stand-in bars, while the write has no diff yet. Kept so they are never rebuilt. */
	private _skeleton: HTMLElement | undefined;
	private readonly _diff: OpenideDiffBlock;

	constructor(
		content: IOpenideChatEditContent,
		context: IOpenideChatContentPartContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IHoverService hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this._isComplete = context.element.isComplete;
		this.domNode = $(`div.${OPENIDE_CHAT_EDIT_CARD_CLASS}`);
		// The card is a plain div: the row inside it is the `role=button`, and it carries the
		// accessible name, so this hover only says out loud what a click on the card does.
		this._register(setupChatTooltip(hoverService, this.domNode, () => t('chat.part.openEdit'), { aria: false }));
		this._row = this._register(instantiationService.createInstance(OpenideChatFileRow, {
			className: 'openide-chat-edit-head',
			onClick: () => this._openReview(),
		}));
		append(this.domNode, this._row.domNode);
		// The trailing button is not a duplicate of the row click: it is the affordance that took
		// the place of the expand chevron, so the card still LOOKS actionable at rest. Without it
		// a bordered card with a filename reads as a label nobody thinks to click.
		this._row.setActions([{ icon: 'go-to-file', tooltip: () => t('chat.part.reviewEdit'), run: () => this._openReview() }]);

		// The body: the skeleton while the write is in flight, then the shared diff block — the
		// webview's `.part-body` + `.ediff`, which is also Cursor's edit block: a few lines at
		// rest, the chevron only on hover and only when there is more underneath.
		this._body = append(this.domNode, $('div.openide-chat-edit-body'));
		this._diff = this._register(instantiationService.createInstance(OpenideDiffBlock));
		append(this._body, this._diff.domNode);
		this._register(this._diff.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
		this._render();
	}

	private _render(): void {
		const diff = this._content.diff;
		this._row.setFile(diff.path);
		// Pending = the write is in flight and its diff has not landed. Once the turn settles a
		// card without a diff is a failed or empty write, and must stop pretending to work.
		const pending = !diff.diffLines && !this._isComplete;
		this._row.setPending(pending);
		this._renderPending(pending);
		this._renderDiff();
		// Per-EDIT numbers, not the turn's accumulated ones: the webview header shows
		// `m.editAdded`/`m.editRemoved` precisely so a card says what
		// THIS write did, while the tray keeps showing the running total against the baseline.
		this._row.setStats({ added: diff.editAdded, removed: diff.editRemoved, created: diff.created });
		// After the stats: they rebuild that lane, and the badge lives beside them.
		this._row.setWaiting(this._content.waitingFor);
		this.domNode.classList.toggle('openide-chat-edit-created', !!diff.created);
	}

	/**
	 * Bars where the diff will go, while the write is still in flight.
	 *
	 * The card used to be a bare filename until the whole diff landed, so a large file looked like
	 * a row that had stopped — the same reason the plan card fakes its body. Built ONCE and then
	 * only shown or hidden: rebuilding it on every delta of the write would restart the sweep and
	 * the bars would never finish one.
	 */
	private _renderPending(pending: boolean): void {
		if (pending && !this._skeleton) {
			const skeleton = $('div.openide-chat-edit-sk.openide-chat-sk');
			for (const width of ['w90', 'w55', 'w76']) {
				append(skeleton, $(`div.openide-chat-sk-line.openide-chat-sk-${width}`));
			}
			this._skeleton = skeleton;
			this._body.insertBefore(skeleton, this._diff.domNode);
		}
		this.domNode.classList.toggle('pending', pending);
		if (!pending && this._skeleton) {
			this._skeleton.remove();
			this._skeleton = undefined;
		}
	}

	private _renderDiff(): void {
		const diff = this._content.diff;
		const lines = diff.diffLines;
		this.domNode.classList.toggle('has-diff', !!lines?.length);
		this._diff.setDiff(lines?.length ? { path: diff.path, lines, created: !!diff.created } : undefined);
	}

	private _openReview(): void {
		this._agentService.openDiff(this._content.diff.path).catch(error => {
			// Loud on purpose: a click that resolves to nothing reads as a broken card, and the
			// common cause (the file moved or the workspace changed) is worth saying out loud.
			this._notificationService.error(error instanceof Error ? error.message : String(error));
		});
	}

	hasSameContent(other: IOpenideChatContent, _following: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'edit')) {
			return false;
		}
		// A pending card has to hear the turn settle even when its content never changes: that is
		// the only event that stops the name shimmering on a write that produced no diff.
		if (!other.diff.diffLines && element.isComplete !== this._isComplete) {
			return false;
		}
		return sameEdit(other, this._content);
	}

	/**
	 * Absorbs the fileDiff that lands after the card was already painted from `toolStart`.
	 *
	 * This is the whole reason the part implements `tryUpdate`: the card exists from the moment the
	 * model starts writing the path, and the numbers arrive one event later. Recreating the part
	 * there would drop the row under the pointer mid-hover.
	 */
	tryUpdate(other: IOpenideChatContent, element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'edit') || other.diff.path !== this._content.diff.path) {
			return false;
		}
		this._content = other;
		this._isComplete = element.isComplete;
		this._render();
		return true;
	}
}

function sameEdit(a: IOpenideChatEditContent, b: IOpenideChatEditContent): boolean {
	return a.diff.path === b.diff.path
		&& a.diff.created === b.diff.created
		&& a.diff.editAdded === b.diff.editAdded
		&& a.diff.editRemoved === b.diff.editRemoved
		&& a.diff.diffLines === b.diff.diffLines;
}
