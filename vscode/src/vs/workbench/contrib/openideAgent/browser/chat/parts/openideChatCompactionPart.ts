/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { IOpenideChatCompactionContent, IOpenideChatContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { ICompactionSnapshot } from '../../../common/openideAgentTypes.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { t } from '../../../common/openideStrings.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import '../media/openideChatCompaction.css';

export const OPENIDE_CHAT_COMPACTION_CLASS = 'openide-chat-compaction-card';

type CompactionStatus = IOpenideChatCompactionContent['status'];

/**
 * "Contexto compactado": the card that says the conversation was summarised to fit the window.
 *
 * Ported from the webview's `renderCompaction` and its
 * `.compaction-*` styles (:553-570). It updates IN PLACE from running to finished — the webview
 * kept an `activeCompaction` reference for that, and the reducer does the same thing on its side by
 * rewriting the content at `draft.compactionIndex` (openideChatReducer.ts:206-212). Here that
 * translates to one part whose `tryUpdate` accepts a new status, which is what keeps the row from
 * being re-created and losing the spinner's animation frame.
 */
export class OpenideChatCompactionPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _icon: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _detail: HTMLElement;
	private readonly _kind: HTMLElement;
	private readonly _explanation: HTMLElement;

	private _content: IOpenideChatCompactionContent;

	constructor(content: IOpenideChatCompactionContent, _context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_COMPACTION_CLASS}`, { role: 'status', 'aria-live': 'polite' });
		this._icon = append(this.domNode, $('span.openide-chat-compaction-icon', { 'aria-hidden': 'true' }));
		const copy = append(this.domNode, $('span.openide-chat-compaction-copy'));
		this._title = append(copy, $('span.openide-chat-compaction-title'));
		this._explanation = append(copy, $('span.openide-chat-compaction-explanation'));
		this._detail = append(copy, $('span.openide-chat-compaction-detail'));
		this._kind = append(this.domNode, $('span.openide-chat-compaction-kind'));

		this._render();
	}

	private _render(): void {
		const status = this._content.status;
		this.domNode.classList.toggle('openide-chat-compaction-failed', status === 'failed');
		this.domNode.classList.toggle('openide-chat-compaction-running', status === 'started');

		// One quiet streaming label owns progress; the card remains stable through completion.
		this._icon.className = `codicon codicon-${compactionGlyph(status)} openide-chat-compaction-icon`;
		setOpenideChatShimmer(this._title, status === 'started');
		this._explanation.textContent = t('chatSurface.compaction.explanation');
		this._explanation.hidden = status !== 'started';

		this._title.textContent = compactionTitle(status);

		const detail = compactionDetail(status, this._content.snapshot, this._content.message);
		this._detail.textContent = detail;
		// Hidden and not empty: an empty span still contributes its line-height and would leave the
		// card looking lopsided next to a card that has a detail.
		this._detail.classList.toggle('hidden', !detail);

		this._kind.textContent = compactionOrigin(this._content.origin);
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'compaction')
			&& other.status === this._content.status
			&& other.origin === this._content.origin
			&& other.message === this._content.message
			&& sameSnapshot(other.snapshot, this._content.snapshot);
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'compaction')) {
			return false;
		}
		this._content = other;
		this._render();
		// Gaining or losing the detail line changes the card's height by one line.
		this._onDidChangeHeight.fire();
		return true;
	}
}

/** the removed chat webview. */
function compactionGlyph(status: CompactionStatus): string {
	switch (status) {
		case 'started': return 'fold';
		case 'failed': return 'error';
		case 'skipped': return 'info';
		default: return 'check';
	}
}

/** the removed chat webview. */
function compactionTitle(status: CompactionStatus): string {
	switch (status) {
		case 'started': return t('chatSurface.compaction.started');
		case 'failed': return t('chatSurface.compaction.failed');
		case 'skipped': return t('chatSurface.compaction.skipped');
		default: return t('chatSurface.compaction.completed');
	}
}

/** the removed chat webview. `automatic` is the unnamed default, as in the webview's ternary. */
function compactionOrigin(origin: ICompactionSnapshot['origin']): string {
	switch (origin) {
		case 'manual': return t('chatSurface.compaction.manual');
		case 'recovery': return t('chatSurface.compaction.recovery');
		default: return t('chatSurface.compaction.automatic');
	}
}

/**
 * The numbers win over the message (the removed chat webview).
 *
 * "82K → 12K tokens · 85% liberado" answers the only question the card raises; the free-text message
 * is the fallback for the statuses that have no numbers to show.
 */
function compactionDetail(status: CompactionStatus, snapshot: ICompactionSnapshot | undefined, message: string | undefined): string {
	if (status === 'completed' && snapshot) {
		return t('chatSurface.compaction.tokens', formatCompactionTokens(snapshot.beforeTokens), formatCompactionTokens(snapshot.afterTokens), Math.round(snapshot.savingsPercent || 0));
	}
	if (status === 'started' && snapshot) {
		return t('chatSurface.compaction.before', formatCompactionTokens(snapshot.beforeTokens));
	}
	return message ?? '';
}

/**
 * the removed chat webview.
 *
 * One decimal under 10K and none above, because "12.3K" and "123K" are both four characters wide —
 * the card's detail line is sized for that and a fifth character would push the origin badge.
 */
function formatCompactionTokens(value: number): string {
	const n = Number(value) || 0;
	if (n >= 1000) {
		return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '')}K`;
	}
	return String(Math.round(n));
}

function sameSnapshot(a: ICompactionSnapshot | undefined, b: ICompactionSnapshot | undefined): boolean {
	if (!a || !b) {
		return a === b;
	}
	return a.beforeTokens === b.beforeTokens && a.afterTokens === b.afterTokens && a.savingsPercent === b.savingsPercent;
}
