/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatSubagentContent, isOpenideChatContentOfKind, OpenideChatSubagentStatus } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { appendSubagentTimelineEvent, updateSubagentTimelineRow, lastSubagentToolStart, subagentStatusText, subagentToolCount } from './openideChatSubagentTimeline.js';
import { OpenideChatThinkingPart } from './openideChatThinkingPart.js';
import { createSubagentAvatar, subagentAvatarKind } from '../../openideSubagentAvatar.js';
import { subagentTaskTitle } from '../../../common/openideSubagentTitle.js';
import '../media/openideChatSubagent.css';

export const OPENIDE_CHAT_SUB_CARD_CLASS = 'openide-chat-sub';

/** What the status glyph means, for its tooltip: a coloured dot has to be readable in words too. */
function statusText(status: OpenideChatSubagentStatus): string {
	switch (status) {
		case 'completed': return t('chat.part.subagentDone');
		case 'failed': return t('chat.part.subagentFailed');
		case 'cancelled': return t('chat.part.subagentCancelled');
		default: return t('chat.part.subagentRunning');
	}
}

function countLabel(status: OpenideChatSubagentStatus, tools: number): string {
	if (status === 'cancelled') { return t('chat.part.subagentCancelled'); }
	if (!tools) { return ''; }
	return tools === 1 ? t('chat.part.subagentOneTool') : t('chat.part.subagentNTools', String(tools));
}

/**
 * Whether naming the specialist's model tells the user anything.
 *
 * A badge repeating the model the turn is already running is noise, so it only appears when the
 * specialist was routed somewhere else — which is the whole point of showing it: the orchestrator
 * picked a different model for this task. `'default'` is never a model, it is the placeholder the
 * run carries until routing resolves, and printing it says less than printing nothing.
 */
export function subagentModelBadge(model: string | undefined, parentModel: string | undefined): string {
	const normalized = normalizeModel(model);
	if (!normalized || normalized === 'default') { return ''; }
	return normalized === normalizeModel(parentModel) ? '' : model!.trim();
}

/** Case-folded, and without the `provider:` prefix the picker's ids carry but a run's model does not. */
function normalizeModel(model: string | undefined): string {
	const trimmed = (model ?? '').trim().toLowerCase();
	return trimmed.slice(trimmed.lastIndexOf(':') + 1);
}

export interface IOpenideChatSubagentAction {
	readonly runId: string;
	readonly action: 'cancel' | 'open';
	readonly sourceWindow: Window;
	readonly parentSessionId?: string;
}

const _onDidRequestAction = new Emitter<IOpenideChatSubagentAction>();
/**
 * Stop / open on a specialist row. The part cannot reach the orchestration nor the session store
 * (the mirror session of a run is the controller's), so the widget picks both up here — the same
 * seam the mode suggestion card uses.
 */
export const onDidRequestOpenideChatSubagentAction: Event<IOpenideChatSubagentAction> = _onDidRequestAction.event;

/** A specialist with a complete, lazily rendered activity history. */
export class OpenideChatSubagentPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _head: HTMLElement;
	private readonly _statusIcon: HTMLElement;
	private _avatarKind: string | undefined;
	private _activityVisible = true;
	private _activityDirty = false;
	private readonly _title: HTMLElement;
	private readonly _model: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _stop: HTMLButtonElement;
	private readonly _chevron: HTMLButtonElement;
	private readonly _status: HTMLElement;
	private readonly _body: HTMLElement;

	/** `toolCallId` → its row, so a failing result can tint the call it belongs to. */
	private readonly _toolRows = new Map<string, HTMLElement>();
	/** Disclosures and hovers owned by the expanded history. */
	private readonly _tailStore = this._register(new DisposableStore());

	private _content: IOpenideChatSubagentContent;
	private _open = false;
	/** Stable rows retain selection and disclosure state across streaming updates. */
	private readonly _timelineRows = new Map<number, HTMLElement>();
	private _renderedCount = 0;
	private _firstSequence: number | undefined;
	private readonly _thinkingParts = new Map<number, OpenideChatThinkingPart>();
	private _summary: HTMLElement | undefined;

	constructor(
		content: IOpenideChatSubagentContent,
		private readonly _context: IOpenideChatContentPartContext,
		private readonly _hoverService: IHoverService,
	) {
		super();

		this._content = content;

		this.domNode = $(`div.openide-chat-part.openide-chat-tool-activity.${OPENIDE_CHAT_SUB_CARD_CLASS}`);

		// `div[role=button]` and not a `<button>` like the plain activity rows: this head CONTAINS
		// two controls of its own, and a button inside a button is invalid markup that browsers
		// silently restructure. The activity styling keys off the class, not the tag.
		this._head = append(this.domNode, $('div.openide-chat-part-head'));
		this._head.setAttribute('role', 'button');
		this._head.tabIndex = 0;

		this._statusIcon = append(this._head, $('span.openide-chat-sub-avatar'));
		this._register(setupChatTooltip(this._hoverService, this._statusIcon, () => statusText(this._content.status), { aria: false }));
		this._title = append(this._head, $('span.openide-chat-part-verb'));
		this._register(setupChatTooltip(this._hoverService, this._title, () => this._title.textContent ?? '', { aria: false }));
		this._model = append(this._head, $('span.openide-chat-sub-model'));
		this._count = append(this._head, $('span.openide-chat-sub-count'));
		append(this._head, $('span.openide-chat-part-spacer'));

		this._stop = append(this._head, $('button.openide-chat-sub-action')) as HTMLButtonElement;
		this._stop.type = 'button';
		this._register(setupChatTooltip(this._hoverService, this._stop, () => t('chat.part.subagentStop')));
		append(this._stop, $('span.codicon.codicon-debug-stop'));
		this._register(addDisposableListener(this._stop, 'click', event => {
			event.stopPropagation();
			this._requestAction('cancel');
		}));

		// The chevron is the expander now, so it owns `aria-expanded` — the head announces "open the
		// specialist", which is what activating it actually does.
		this._chevron = append(this._head, $('button.openide-chat-sub-chevron')) as HTMLButtonElement;
		this._chevron.type = 'button';
		this._chevron.setAttribute('aria-expanded', 'false');
		this._register(setupChatTooltip(this._hoverService, this._chevron, () => t('chat.part.subagentTail')));
		append(this._chevron, $('span.codicon.codicon-chevron-right'));
		this._register(addDisposableListener(this._chevron, 'click', event => {
			event.stopPropagation();
			this._toggle();
		}));

		this._status = append(this.domNode, $('div.openide-chat-sub-status'));
		this._body = append(this.domNode, $('div.openide-chat-part-body.openide-chat-sub-tail'));

		const open = () => this._requestAction('open');
		this._register(addDisposableListener(this._head, 'click', () => open()));
		// Enter/Space is not free on a div the way it is on a button.
		this._register(addDisposableListener(this._head, 'keydown', event => {
			const key = (event as KeyboardEvent).key;
			if (event.target === this._head && (key === 'Enter' || key === ' ')) {
				event.preventDefault();
				open();
			}
		}));

		this._render();
	}

	private _requestAction(action: 'open' | 'cancel'): void {
		_onDidRequestAction.fire({ runId: this._content.runId, action, sourceWindow: getWindow(this.domNode), parentSessionId: this._content.run?.parentConversationId });
	}

	/** A folded summary stores snapshots without scanning or painting its hidden history. */
	setActivityVisible(visible: boolean): void {
		this._activityVisible = visible;
		if (visible && this._activityDirty) {
			this._activityDirty = false;
			this._render();
			this._onDidChangeHeight.fire();
		}
	}

	private _toggle(): void {
		this._open = !this._open;
		this.domNode.classList.toggle('openide-chat-part-open', this._open);
		this._chevron.setAttribute('aria-expanded', String(this._open));
		this._renderTail();
		this._onDidChangeHeight.fire();
	}

	private _render(): void {
		const content = this._content;
		const running = content.status === 'running';

		const task = content.run ?? { task: content.prompt ?? content.title };
		const kind = subagentAvatarKind(task);
		if (this._avatarKind !== kind) { this._avatarKind = kind; this._statusIcon.replaceChildren(createSubagentAvatar(task)); }

		const title = subagentTaskTitle(content.run?.task ?? content.prompt ?? content.title, content.title) || t('chat.part.subagentDefault');
		this._title.textContent = title;

		const badge = subagentModelBadge(content.model, content.parentModel);
		this._model.textContent = badge;
		this._model.classList.toggle('hidden', !badge);

		this._count.textContent = countLabel(content.status, content.run?.metrics.toolCalls ?? subagentToolCount(content.timeline));

		this._head.setAttribute('aria-label', `${t('chat.part.subagentOpenAria', title)} · ${statusText(content.status)}`);
		this._stop.classList.toggle('hidden', !running);

		// No chevron when there is nothing under it: an expander that opens onto an empty box is a
		// promise the row cannot keep. Same rule the edit card measures for.
		const hasTail = content.timeline.length > 0 || !!content.run?.result?.summary;
		this._chevron.classList.toggle('hidden', !hasTail);
		if (!hasTail && this._open) { this._toggle(); }

		this._renderStatusLine(running);
		this._renderTail();

		this.domNode.classList.toggle('openide-chat-part-error', content.status === 'failed');
		this.domNode.classList.toggle('openide-chat-part-cancelled', content.status === 'cancelled');
	}

	/**
	 * The live line under the row.
	 *
	 * The shimmer belongs to THIS line and never to the title: painting it on the title left an
	 * animating heading on a finished run, and the shimmer needs a text span of its own anyway —
	 * on a flex container it sweeps the box instead of the letters.
	 */
	private _renderStatusLine(running: boolean): void {
		const latest = this._content.timeline.at(-1);
		const toolActive = latest && (latest.type === 'toolStart' || latest.type === 'fileChange' || latest.type === 'terminal');
		const last = running && toolActive ? lastSubagentToolStart(this._content.timeline) : undefined;
		const text = last?.toolName ? subagentStatusText(last.toolName, last.argumentsJson) : '';
		this._status.textContent = text;
		this._status.classList.toggle('hidden', !text);
		setOpenideChatShimmer(this._status, !!text);
	}

	private _renderTail(): void {
		if (!this._open) { return; }
		const timeline = this._content.timeline;
		if (timeline.length < this._renderedCount || (this._renderedCount && this._firstSequence !== timeline[0]?.sequence)) {
			this._body.replaceChildren(); this._tailStore.clear(); this._toolRows.clear(); this._timelineRows.clear(); this._thinkingParts.clear(); this._renderedCount = 0; this._summary = undefined;
		}
		// Only the last existing block can grow. Prior rows and their disclosure state stay intact.
		for (let index = Math.max(0, this._renderedCount - 1); index < timeline.length; index++) {
			const event = timeline[index];
			const existing = this._timelineRows.get(event.sequence);
			if (event.type === 'reasoning') {
				const content = { kind: 'thinking' as const, text: event.message ?? '', isComplete: this._content.status !== 'running' || index < timeline.length - 1 };
				const previous = this._thinkingParts.get(event.sequence);
				if (previous) { previous.tryUpdate(content, this._context.element); }
				else {
					const part = this._tailStore.add(new OpenideChatThinkingPart(content, this._context));
					this._tailStore.add(part.onDidChangeHeight(() => this._onDidChangeHeight.fire()));
					this._thinkingParts.set(event.sequence, part); this._timelineRows.set(event.sequence, part.domNode); this._body.append(part.domNode);
				}
			} else if (existing) { updateSubagentTimelineRow(existing, event); }
			else {
				const row = appendSubagentTimelineEvent(this._body, this._toolRows, event, this._hoverService, this._tailStore);
				if (row) { this._timelineRows.set(event.sequence, row.node); }
			}
		}
		this._renderedCount = timeline.length;
		this._firstSequence = timeline[0]?.sequence;
		const summary = this._content.run?.result?.summary;
		if (summary && summary !== timeline.at(-1)?.message) {
			this._summary ??= $('div.openide-chat-sub-text.openide-chat-sub-result');
			if (this._summary.textContent !== summary) { this._summary.textContent = summary; }
			this._body.append(this._summary);
		} else { this._summary?.remove(); }
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'subagent')) {
			return false;
		}
		return other.runId === this._content.runId
			&& other.status === this._content.status
			&& other.title === this._content.title
			&& other.prompt === this._content.prompt
			&& other.run?.task === this._content.run?.task
			&& other.run?.profile === this._content.run?.profile
			&& other.run?.routingDecision?.profile === this._content.run?.routingDecision?.profile
			&& other.model === this._content.model
			&& other.parentModel === this._content.parentModel
			&& other.timeline === this._content.timeline
			&& other.run?.result?.summary === this._content.run?.result?.summary;
	}

	/** Same run, newer snapshot. Another `runId` is another specialist and gets its own row. */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'subagent') || other.runId !== this._content.runId) {
			return false;
		}
		this._content = other;
		if (!this._activityVisible) { this._activityDirty = true; return true; }
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
