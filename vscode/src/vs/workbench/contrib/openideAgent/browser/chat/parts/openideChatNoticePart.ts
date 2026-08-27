/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IOpenideChatContent, IOpenideChatDecisionContent, IOpenideChatNoticeContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatNotice.css';

/**
 * Advisories, provider retries and failures: the webview's `.flatrow.notice` / `.flatrow.err`
 * (openideChatHtml.ts:528-550, `renderNotice`/`renderRetry`/`addErrorMsg`).
 *
 * Without this part the reducer's `notice` content rendered nothing at all, which is strictly worse
 * than the generic line it replaced: a rate limit or an `info` from the engine simply vanished and
 * the turn looked like it had stalled for no reason.
 */

/** Title strip of the box. Uppercased by CSS; transcribed from the webview's three renderers. */
function noticeTitle(content: IOpenideChatNoticeContent): string {
	if (content.retry) { return 'Advertencia del proveedor'; }
	if (content.action === 'continue') { return 'Turno incompleto'; }
	return content.severity === 'error' ? 'Error' : 'Advertencia';
}

function noticeIcon(content: IOpenideChatNoticeContent): string {
	if (content.action === 'continue') { return 'debug-continue'; }
	return content.severity === 'error' ? 'error' : 'warning';
}

const _onDidRequestContinue = new Emitter<void>();
/**
 * "Continuar" on a `continue` notice: the turn ran out of cycles and the user wants it to go on.
 * Same seam as the mode suggestion's acceptance — the part cannot reach the composer, so the widget
 * listens here and sends the same continue prompt the webview typed (openideChatHtml.ts:3489).
 */
export const onDidRequestOpenideChatContinue: Event<void> = _onDidRequestContinue.event;

/** What "Continuar" sends. Verbatim from the webview. */
export const OPENIDE_CHAT_CONTINUE_PROMPT = 'continuá';

export class OpenideChatNoticePart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _icon: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _message: HTMLElement;
	private readonly _count: HTMLElement;
	private readonly _action: HTMLButtonElement;
	private _content: IOpenideChatNoticeContent;

	constructor(
		content: IOpenideChatNoticeContent,
		_context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
		this._content = content;
		this.domNode = $('.openide-chat-notice-row');
		this._icon = append(this.domNode, $('span.codicon'));
		const body = append(this.domNode, $('.openide-chat-notice-body'));
		this._title = append(body, $('.openide-chat-notice-title'));
		this._message = append(body, $('.openide-chat-notice-msg'));
		this._count = append(body, $('.openide-chat-notice-count'));
		this._action = append(body, $('button.openide-chat-notice-action.hidden')) as HTMLButtonElement;
		this._action.type = 'button';
		this._register(addDisposableListener(this._action, 'click', event => {
			event.stopPropagation();
			if (this._content.action === 'connect') {
				void this._commandService.executeCommand('openide.agent.openProviders');
			} else if (this._content.action === 'continue') {
				_onDidRequestContinue.fire();
			}
		}));
		this._render();
	}

	private _render(): void {
		const content = this._content;
		this._icon.className = `codicon codicon-${noticeIcon(content)}`;
		this._title.textContent = noticeTitle(content);
		this._message.textContent = content.message;
		// An error is a bordered red box, everything else a bordered yellow one. `continue` is
		// deliberately NOT red: the turn ran out of cycles, the task is still alive.
		this.domNode.classList.toggle('openide-chat-notice-error', content.severity === 'error');
		this._renderAction();
		this._renderCountdown();
	}

	/** The one-click fix: connect a provider, or keep the interrupted turn going. */
	private _renderAction(): void {
		const action = this._content.action;
		this._action.classList.toggle('hidden', !action);
		if (!action) {
			return;
		}
		this._action.replaceChildren();
		append(this._action, $(`span.codicon.codicon-${action === 'connect' ? 'plug' : 'debug-continue'}`));
		append(this._action, $('span', undefined, action === 'connect' ? 'Conectar proveedor…' : 'Continuar'));
	}

	/**
	 * The retry countdown ticks.
	 *
	 * A frozen "en 12s…" reads as a hung UI, which is exactly what the row is trying to deny — it
	 * exists to say the provider pushed back and the run is still coming. The interval is registered
	 * as a disposable so a row scrolled out of the virtualized list stops counting.
	 */
	private _renderCountdown(): void {
		this.clearLateDisposables();
		const retry = this._content.retry;
		this._count.classList.toggle('hidden', !retry);
		if (!retry) {
			this._count.textContent = '';
			return;
		}
		let left = Math.max(1, Math.round((retry.delayMs || 1000) / 1000));
		const tick = (): void => {
			if (left > 0) {
				this._count.textContent = `en ${left}s…`;
				left--;
				return;
			}
			this._count.textContent = 'reintentando…';
		};
		tick();
		const handle = setInterval(tick, 1000);
		this.addDisposable(toDisposable(() => clearInterval(handle)));
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (other.kind !== 'notice') {
			return false;
		}
		return other.message === this._content.message
			&& other.severity === this._content.severity
			&& other.action === this._content.action
			&& other.retry?.attempt === this._content.retry?.attempt
			&& other.retry?.kind === this._content.retry?.kind;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (other.kind !== 'notice') {
			return false;
		}
		this._content = other;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}

/** Same wording as the webview's `permissionToolLabel` (openideChatHtml.ts:4603-4606). */
const PERMISSION_TOOL_LABELS: Readonly<Record<string, string>> = {
	run_command: 'Run command',
	edit_file: 'Edit file',
	write_file: 'Write file',
	delete_file: 'Delete file',
	terminal_send: 'Terminal send',
};

function permissionToolLabel(name: string): string {
	return PERMISSION_TOOL_LABELS[name] ?? String(name ?? '').replace(/_/g, ' ');
}

/**
 * A denied permission, as the flat line the webview draws — no card, no TOOL badge.
 *
 * Grants never reach this part: the reducer drops them, because the tool card that follows is
 * already the canonical record of what ran (commit 4146dda).
 */
export class OpenideChatDecisionPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _label: HTMLElement;
	private _content: IOpenideChatDecisionContent;

	constructor(content: IOpenideChatDecisionContent, _context: IOpenideChatContentPartContext) {
		super();
		this._content = content;
		this.domNode = $('.openide-chat-decision-line');
		this._label = append(this.domNode, $('span.openide-chat-decision-label'));
		this._render();
	}

	private _render(): void {
		this._label.textContent = `Rechazado · ${permissionToolLabel(this._content.tool)}`;
		this._label.title = this._label.textContent;
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return other.kind === 'decision' && other.tool === this._content.tool && other.decision === this._content.decision;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (other.kind !== 'decision') {
			return false;
		}
		this._content = other;
		this._render();
		return true;
	}
}
