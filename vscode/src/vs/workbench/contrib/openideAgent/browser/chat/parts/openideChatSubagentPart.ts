/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { localize } from '../../../../../../nls.js';
import { IOpenideChatContent, IOpenideChatSubagentContent, isOpenideChatContentOfKind, OpenideChatSubagentStatus } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { appendSubagentTimelineEvent, lastSubagentToolStart, subagentStatusText, subagentToolCount } from './openideChatSubagentTimeline.js';
import '../media/openideChatSubagent.css';

export const OPENIDE_CHAT_SUB_CARD_CLASS = 'openide-chat-sub-card';

/** Status glyph of the head, transcribed from `onSubagentDone` (openideChatHtml.ts:3697-3698). */
function statusIconClasses(status: OpenideChatSubagentStatus): string {
	switch (status) {
		case 'completed': return 'codicon-pass-filled openide-chat-sub-st-ok';
		case 'failed': return 'codicon-error openide-chat-sub-st-err';
		case 'cancelled': return 'codicon-circle-slash';
		case 'running':
		default: return 'codicon-loading openide-chat-sub-spin';
	}
}

function countLabel(status: OpenideChatSubagentStatus, tools: number): string {
	if (status === 'cancelled') {
		return localize('openide.chat.subagent.cancelled', "cancelled");
	}
	if (!tools) {
		return '';
	}
	return tools === 1
		? localize('openide.chat.subagent.oneTool', "1 tool")
		: localize('openide.chat.subagent.nTools', "{0} tools", tools);
}

/**
 * A delegated specialist, as a card.
 *
 * The webview builds this card live from `subagentEvent` frames; here it is rebuilt from the
 * persisted timeline the reducer carries on the content, which is the only version that survives a
 * reload. The look is the webview's: 40px head with a status glyph, title, model and tool counter,
 * a shimmering status line under it while it runs, and a 240px scrolling body.
 *
 * Collapsed by default, exactly like `onSubagentStart` creates it — a specialist that expanded
 * itself would push the user's own conversation off screen every time one starts.
 */
export interface IOpenideChatSubagentAction {
	readonly runId: string;
	readonly action: 'cancel' | 'open';
}

const _onDidRequestAction = new Emitter<IOpenideChatSubagentAction>();
/**
 * Stop / "open chat" on a specialist card. The part cannot reach the orchestration nor the session
 * store (the mirror session of a run is the controller's), so the widget picks both up here — the
 * same seam the mode suggestion card uses.
 */
export const onDidRequestOpenideChatSubagentAction: Event<IOpenideChatSubagentAction> = _onDidRequestAction.event;

export class OpenideChatSubagentPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _head: HTMLElement;
	private readonly _statusIcon: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _model: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _stop: HTMLButtonElement;
	private readonly _open: HTMLButtonElement;
	private readonly _status: HTMLElement;
	private readonly _body: HTMLElement;

	/** `toolCallId` → its row, so a failing result can tint the call it belongs to. */
	private readonly _toolRows = new Map<string, HTMLElement>();

	private _content: IOpenideChatSubagentContent;
	/**
	 * How many timeline events already have a row. The timeline is append-only, so replaying only
	 * the tail is what keeps a long-running specialist from rebuilding its whole body per frame.
	 */
	private _renderedEvents = 0;
	private _renderedSummary: string | undefined;

	constructor(content: IOpenideChatSubagentContent, _context: IOpenideChatContentPartContext) {
		super();

		this._content = content;

		this.domNode = $(`div.${OPENIDE_CHAT_SUB_CARD_CLASS}.openide-chat-sub-collapsed`);
		this._head = append(this.domNode, $('div.openide-chat-sub-head'));
		this._statusIcon = append(this._head, $('span.codicon.openide-chat-sub-st'));
		this._title = append(this._head, $('span.openide-chat-sub-title'));
		this._model = append(this._head, $('span.openide-chat-sub-model'));
		this._count = append(this._head, $('span.openide-chat-sub-count'));
		// Transcribed from the webview's card head (openideChatHtml.ts:3612-3710): Stop while the
		// specialist runs, "open chat" always. Both stop the click so the head does not toggle.
		this._stop = append(this._head, $('button.openide-chat-sub-action.openide-chat-sub-stop')) as HTMLButtonElement;
		this._stop.type = 'button';
		this._stop.title = localize('openide.chat.subagent.stop', "Detener especialista");
		append(this._stop, $('span.codicon.codicon-debug-stop'));
		this._register(addDisposableListener(this._stop, 'click', event => {
			event.stopPropagation();
			_onDidRequestAction.fire({ runId: this._content.runId, action: 'cancel' });
		}));
		this._open = append(this._head, $('button.openide-chat-sub-action.openide-chat-sub-open')) as HTMLButtonElement;
		this._open.type = 'button';
		this._open.title = localize('openide.chat.subagent.open', "Abrir el chat del especialista");
		append(this._open, $('span.codicon.codicon-comment-discussion'));
		this._register(addDisposableListener(this._open, 'click', event => {
			event.stopPropagation();
			_onDidRequestAction.fire({ runId: this._content.runId, action: 'open' });
		}));
		append(this._head, $('span.codicon.codicon-chevron-up.openide-chat-sub-chev'));
		this._status = append(this.domNode, $('div.openide-chat-sub-status'));
		this._body = append(this.domNode, $('div.openide-chat-sub-body'));

		this._head.setAttribute('role', 'button');
		this._head.setAttribute('tabindex', '0');
		this._head.setAttribute('aria-expanded', 'false');
		this._register(this._registerToggle());

		this._render();
	}

	private _registerToggle() {
		const toggle = () => {
			const collapsed = this.domNode.classList.toggle('openide-chat-sub-collapsed');
			this._head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
			this._onDidChangeHeight.fire();
		};
		const onClick = () => toggle();
		// Enter/Space on a div with role=button is not free the way it is on a <button>; a <button>
		// is not usable here because the head contains its own focusable affordances in the webview.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggle();
			}
		};
		this._head.addEventListener('click', onClick);
		this._head.addEventListener('keydown', onKeyDown);
		return {
			dispose: () => {
				this._head.removeEventListener('click', onClick);
				this._head.removeEventListener('keydown', onKeyDown);
			},
		};
	}

	private _render(): void {
		const content = this._content;
		const running = content.status === 'running';

		this._statusIcon.className = `codicon openide-chat-sub-st ${statusIconClasses(content.status)}`;

		const title = content.title || localize('openide.chat.subagent.default', "Specialist");
		this._title.textContent = title;
		this._title.title = title;
		this._model.textContent = content.model ?? '';
		this._model.title = content.model ?? '';

		const tools = subagentToolCount(content.timeline);
		this._count.textContent = countLabel(content.status, tools);

		this._head.setAttribute('aria-label', this._ariaLabel(title));

		this._stop.classList.toggle('hidden', !running);
		this._renderStatusLine(running);
		this._appendNewEvents();
		this._renderResultSummary();

		this.domNode.classList.toggle('openide-chat-sub-done', !running);
		this.domNode.classList.toggle(`openide-chat-sub-status-${content.status}`, true);
	}

	private _ariaLabel(title: string): string {
		switch (this._content.status) {
			case 'completed': return localize('openide.chat.subagent.aria.done', "Specialist completed: {0}", title);
			case 'failed': return localize('openide.chat.subagent.aria.failed', "Specialist failed: {0}", title);
			case 'cancelled': return localize('openide.chat.subagent.aria.cancelled', "Specialist cancelled: {0}", title);
			default: return localize('openide.chat.subagent.aria.running', "Specialist running: {0}", title);
		}
	}

	/**
	 * The live line under the head.
	 *
	 * The shimmer belongs to this line and never to the title — painting it on the title left an
	 * animating heading on a finished run, which is the bug the webview's comment at
	 * openideChatHtml.ts:3700-3702 records.
	 */
	private _renderStatusLine(running: boolean): void {
		const last = running ? lastSubagentToolStart(this._content.timeline) : undefined;
		const text = last?.toolName ? subagentStatusText(last.toolName, last.argumentsJson) : '';
		this._status.textContent = text;
		this._status.classList.toggle('hidden', !text);
		setOpenideChatShimmer(this._status, !!text);
	}

	private _appendNewEvents(): void {
		const timeline = this._content.timeline;
		// A shorter timeline than the one already painted means this is a different run's history
		// (a restore replacing a live card), so the body is rebuilt rather than appended to.
		if (timeline.length < this._renderedEvents) {
			this._body.textContent = '';
			this._toolRows.clear();
			this._renderedEvents = 0;
			this._renderedSummary = undefined;
		}
		for (let i = this._renderedEvents; i < timeline.length; i++) {
			appendSubagentTimelineEvent(this._body, this._toolRows, timeline[i]);
		}
		this._renderedEvents = timeline.length;
		this._body.scrollTop = this._body.scrollHeight;
	}

	private _renderResultSummary(): void {
		const summary = this._content.run?.result?.summary;
		if (!summary || summary === this._renderedSummary) {
			return;
		}
		this._renderedSummary = summary;
		const node = append(this._body, $('div.openide-chat-sub-text.openide-chat-sub-result'));
		node.textContent = summary;
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'subagent')) {
			return false;
		}
		return other.runId === this._content.runId
			&& other.status === this._content.status
			&& other.title === this._content.title
			&& other.model === this._content.model
			&& other.timeline.length === this._content.timeline.length
			&& other.run?.result?.summary === this._content.run?.result?.summary;
	}

	/** Same run, newer snapshot. Another `runId` is another specialist and gets its own card. */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'subagent') || other.runId !== this._content.runId) {
			return false;
		}
		this._content = other;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
