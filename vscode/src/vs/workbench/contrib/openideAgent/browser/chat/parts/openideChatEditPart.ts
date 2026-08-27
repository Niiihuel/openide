/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow, scheduleAtNextAnimationFrame } from '../../../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { DomScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenideChatContent, IOpenideChatEditContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { appendOpenideChatEditDiff } from './openideChatEditDiff.js';
import { OpenideChatFileRow } from './openideChatFileRow.js';
import '../media/openideChatFiles.css';

export const OPENIDE_CHAT_EDIT_CARD_CLASS = 'openide-chat-edit-card';

const OPEN_TOOLTIP = 'Abrir el archivo y revisar el cambio';
const REVIEW_TOOLTIP = 'Revisar el cambio en el editor';
const EXPAND_TOOLTIP = 'Expandir diff';
const COLLAPSE_TOOLTIP = 'Compactar diff';
/** Webview `.part.edit-card:not(.open) .ediff { max-height: 108px }` (openideChatHtml.ts:381). */
const COLLAPSED_HEIGHT = 108;

/**
 * The `write_file` / `edit_file` card.
 *
 * Visually this is the webview's `.part.edit-card` (openideChatHtml.ts:340-347): one bordered
 * card, one header, file icon + basename + `nuevo` badge + ±N, and clicking anywhere on it opens
 * the change. What is NOT here is the `.ediff` body — the inline diff, its fade, its expand
 * chevron and the 200 lines of overflow measuring behind them. That is the product decision in
 * section 6.2 of the migration plan: the diff is reviewed in the EDITOR, so the card is a remote
 * control for `OpenideEditReview`, not a second, worse diff viewer that has to re-tokenize code
 * with a regex highlighter to show eight lines of context.
 *
 * `openDiff` is the whole remote control, and it is already two behaviours in one
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
	private readonly _expand: HTMLButtonElement;
	private readonly _diffTokens = this._register(new MutableDisposable<CancellationTokenSource>());
	/** The workbench scrollbar over the diff — the IDE's own, never Chromium's. */
	private readonly _scrollable = this._register(new MutableDisposable<DomScrollableElement>());
	private _renderedDiff: readonly unknown[] | undefined;

	constructor(
		content: IOpenideChatEditContent,
		context: IOpenideChatContentPartContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._content = content;
		this._isComplete = context.element.isComplete;
		this.domNode = $(`div.${OPENIDE_CHAT_EDIT_CARD_CLASS}`);
		this._row = this._register(instantiationService.createInstance(OpenideChatFileRow, {
			className: 'openide-chat-edit-head',
			onClick: () => this._openReview(),
		}));
		append(this.domNode, this._row.domNode);
		// The trailing button is not a duplicate of the row click: it is the affordance that took
		// the place of the expand chevron, so the card still LOOKS actionable at rest. Without it
		// a bordered card with a filename reads as a label nobody thinks to click.
		this._row.setActions([{ icon: 'go-to-file', tooltip: REVIEW_TOOLTIP, run: () => this._openReview() }]);

		// The body: the inline diff, its fade and the chevron that expands it — the webview's
		// `.part-body` + `.ediff` + `.edit-fade` + `.edit-expand` (openideChatHtml.ts:3141-3160),
		// which is also Cursor's edit block: a few lines at rest, the chevron only on hover and
		// only when there is more underneath.
		this._body = append(this.domNode, $('div.openide-chat-edit-body'));
		this._expand = $('button.openide-chat-edit-expand', { type: 'button' });
		append(this._expand, $('span.codicon.codicon-chevron-down'));
		this._register(addDisposableListener(this._expand, 'click', event => {
			event.stopPropagation();
			this._toggleOpen();
		}));
		this._render();
	}

	private _render(): void {
		const diff = this._content.diff;
		this._row.setFile(diff.path);
		// Pending = the write is in flight and its diff has not landed. Once the turn settles a
		// card without a diff is a failed or empty write, and must stop pretending to work.
		this._row.setPending(!diff.diffLines && !this._isComplete);
		this._renderDiff();
		// Per-EDIT numbers, not the turn's accumulated ones: the webview header shows
		// `m.editAdded`/`m.editRemoved` (openideChatHtml.ts:3352-3354) precisely so a card says what
		// THIS write did, while the tray keeps showing the running total against the baseline.
		this._row.setStats({ added: diff.editAdded, removed: diff.editRemoved, created: diff.created });
		this.domNode.classList.toggle('openide-chat-edit-created', !!diff.created);
		this.domNode.title = OPEN_TOOLTIP;
	}

	private _renderDiff(): void {
		const lines = this._content.diff.diffLines;
		if (lines === this._renderedDiff) {
			return;
		}
		this._renderedDiff = lines;
		this._diffTokens.value = undefined;
		this._scrollable.value = undefined;
		this._body.replaceChildren();
		this.domNode.classList.remove('open', 'needs-expand');
		this.domNode.classList.toggle('has-diff', !!lines?.length);
		if (!lines?.length) {
			return;
		}
		const tokens = new CancellationTokenSource();
		this._diffTokens.value = tokens;
		const diff = appendOpenideChatEditDiff(this._body, this._content.diff.path, lines, !!this._content.diff.created, this._languageService, tokens.token, () => this._scrollable.value?.scanDomNode());
		const scrollable = new DomScrollableElement(diff, {
			vertical: ScrollbarVisibility.Auto,
			horizontal: ScrollbarVisibility.Auto,
			useShadows: false,
			horizontalScrollbarSize: 8,
			verticalScrollbarSize: 8,
		});
		this._scrollable.value = scrollable;
		scrollable.getDomNode().classList.add('openide-chat-edit-scroll');
		append(this._body, scrollable.getDomNode());
		append(this._body, $('div.openide-chat-edit-fade'));
		this._expand.title = EXPAND_TOOLTIP;
		append(this._body, this._expand);
		// Measured, not counted: `needs-expand` must be false for a one-line replacement even
		// though it has a diff, or every card grows a chevron that does nothing.
		scheduleAtNextAnimationFrame(getWindow(this.domNode), () => {
			if (!diff.isConnected || tokens.token.isCancellationRequested) {
				return;
			}
			let height = 0;
			for (const row of diff.children) {
				height += row.getBoundingClientRect().height;
			}
			this.domNode.classList.toggle('needs-expand', height > COLLAPSED_HEIGHT + 1);
			scrollable.scanDomNode();
		});
		this._onDidChangeHeight.fire();
	}

	private _toggleOpen(): void {
		const open = this.domNode.classList.toggle('open');
		this._expand.replaceChildren($(`span.codicon.codicon-chevron-${open ? 'up' : 'down'}`));
		this._expand.title = open ? COLLAPSE_TOOLTIP : EXPAND_TOOLTIP;
		this._scrollable.value?.scanDomNode();
		this._onDidChangeHeight.fire();
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
