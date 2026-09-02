/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { IRenderedMarkdown } from '../../../../../../base/browser/markdownRenderer.js';
import { MutableDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatDecisionContent, IOpenideChatNoticeContent } from '../../../common/chat/openideChatContent.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { OpenideChatMarkdownRenderer } from '../openideChatMarkdown.js';
import '../media/openideChatNotice.css';

/**
 * Advisories, provider retries and failures: the webview's `.flatrow.notice` / `.flatrow.err`
 * (the removed chat webview, `renderNotice`/`renderRetry`/`addErrorMsg`).
 *
 * Without this part the reducer's `notice` content rendered nothing at all, which is strictly worse
 * than the generic line it replaced: a rate limit or an `info` from the engine simply vanished and
 * the turn looked like it had stalled for no reason.
 */

/**
 * Title, ONLY when it says something the icon cannot.
 *
 * It used to always be there, in uppercase, so a provider failure was announced by the word ERROR
 * over a message that already read as one. Upstream's error widget
 * (`chat/browser/widget/chatContentParts/chatErrorContentPart.ts`) has no title at all: an icon and
 * the text. What survives here are the two cases that carry real information — a retry in flight,
 * and a turn that ran out of cycles rather than failing.
 */
function noticeTitle(content: IOpenideChatNoticeContent): string | undefined {
	if (content.retry) { return t('chat.notice.retryTitle'); }
	if (content.action === 'continue') { return t('chat.notice.incompleteTitle'); }
	return undefined;
}

function noticeIcon(content: IOpenideChatNoticeContent): string {
	if (content.action === 'continue') { return 'debug-continue'; }
	if (content.severity === 'error') { return 'error'; }
	return content.severity === 'info' ? 'info' : 'warning';
}

/**
 * The message as markdown, so a URL in it is a link the user can click.
 *
 * Two adjustments before handing it over. A notice is written as PLAIN text, where a single newline
 * is a line break — markdown eats those, which glued "what failed" and "what to do about it" into
 * one paragraph — so newlines become markdown's own hard break. And bare URLs are wrapped as
 * explicit links rather than trusting the renderer's linkifier to be on: the whole point of the
 * rate-limit hint is that the reader can reach the page it names.
 */
export function noticeMarkdown(message: string): string {
	return message
		.replace(/(^|[\s(])(https?:\/\/[^\s<>()\[\]"']+)/g, (_all, prefix: string, url: string) => `${prefix}[${url}](${url})`)
		.replace(/\n/g, '  \n');
}

const _onDidRequestContinue = new Emitter<void>();
/**
 * "Continuar" on a `continue` notice: the turn ran out of cycles and the user wants it to go on.
 * Same seam as the mode suggestion's acceptance — the part cannot reach the composer, so the widget
 * listens here and sends the same continue prompt the webview typed.
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
	private readonly _rendered = this._register(new MutableDisposable<IRenderedMarkdown>());
	private _content: IOpenideChatNoticeContent;

	constructor(
		content: IOpenideChatNoticeContent,
		_context: IOpenideChatContentPartContext,
		private readonly _renderer: OpenideChatMarkdownRenderer,
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
			} else if (this._content.action === 'account-back') {
				void this._commandService.executeCommand('openide.agent.undoAccountFailover');
				// One use only: the account is back, and offering it again would switch away from it.
				this._action.classList.add('hidden');
			}
		}));
		this._render();
	}

	private _render(): void {
		const content = this._content;
		this._icon.className = `codicon codicon-${noticeIcon(content)}`;
		const title = noticeTitle(content);
		this._title.textContent = title ?? '';
		this._title.classList.toggle('hidden', !title);
		// Disposed before rendering, not after: the previous result's link listeners hang off this
		// very node (same reason as the markdown part).
		this._rendered.clear();
		this._rendered.value = this._renderer.render(
			new MarkdownString(noticeMarkdown(content.message)),
			{ asyncRenderCallback: () => this._onDidChangeHeight.fire() },
			this._message,
		);
		// The card itself stays neutral in every severity; only the icon is coloured. A red plate
		// behind a red border behind red text made a busy provider look like a broken IDE, and it
		// is not how upstream draws the same thing.
		this.domNode.classList.toggle('openide-chat-notice-error', content.severity === 'error');
		this.domNode.classList.toggle('openide-chat-notice-info', content.severity === 'info' || content.action === 'continue');
		this._renderAction();
		this._renderCountdown();
	}

	/** The one-click fix: connect a provider, keep the turn going, or undo an account switch. */
	private _renderAction(): void {
		const action = this._content.action;
		this._action.classList.toggle('hidden', !action);
		if (!action) {
			return;
		}
		const glyph = action === 'connect' ? 'plug' : action === 'account-back' ? 'discard' : 'debug-continue';
		const label = action === 'connect' ? t('chat.notice.connect')
			: action === 'account-back' ? t('chat.part.accountBack')
				: t('chat.notice.continue');
		this._action.replaceChildren();
		append(this._action, $(`span.codicon.codicon-${glyph}`));
		append(this._action, $('span', undefined, label));
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
				this._count.textContent = t('chat.notice.retryIn', left);
				left--;
				return;
			}
			this._count.textContent = t('chat.notice.retrying');
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

/** Same wording as the webview's `permissionToolLabel`. */
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

	constructor(
		content: IOpenideChatDecisionContent,
		_context: IOpenideChatContentPartContext,
		hoverService: IHoverService,
	) {
		super();
		this._content = content;
		this.domNode = $('.openide-chat-decision-line');
		this._label = append(this.domNode, $('span.openide-chat-decision-label'));
		// One elided line: the hover repeats it in full, so it is not a second accessible name.
		this._register(setupChatTooltip(hoverService, this._label, () => this._label.textContent ?? '', { aria: false }));
		this._render();
	}

	private _render(): void {
		this._label.textContent = `Rechazado · ${permissionToolLabel(this._content.tool)}`;
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
