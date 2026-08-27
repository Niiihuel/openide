/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { IOpenideChatConfirmationContent, IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { ToolApprovalDecision } from '../../../common/openideAgentTypes.js';
import { toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatConfirmation.css';
import { t } from '../../../common/openideStrings.js';

/**
 * Tool approval. The agent is literally parked on a Promise until this resolves, so the part is
 * not decoration: with no card the run stalls forever and the transcript shows nothing at all.
 *
 * Transcribed from the webview's `.approval` block (openideChatHtml.ts:1040-1067) and its
 * `addChoice` wiring (:4584-4598).
 *
 * The decision strings are the SERVICE's, not ours, and getting them wrong is silent:
 * `resolveApproval` (openideAgentService.ts:1327-1333) accepts `once` | `session` | `always` and
 * maps ANYTHING else to `deny`. This card used to send `allow` for its primary button — a string
 * that is not in that set — so pressing "Permitir" told the agent the user had refused. Nothing
 * logged it; the tool simply did not run. The union below is the service's own type precisely so
 * the compiler refuses the next invented string.
 */
export class OpenideChatConfirmationPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _actions: HTMLElement;
	private readonly _status: HTMLElement;
	private _requestId: string;
	private _decided: boolean;

	constructor(
		content: IOpenideChatConfirmationContent,
		_context: IOpenideChatContentPartContext,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super();
		this._requestId = content.requestId;
		this._decided = !!content.decision;

		const kind = toolVisualKind(content.tool);
		this.domNode = $(`.openide-chat-approval.tool-kind-${kind.id}`);

		const head = append(this.domNode, $('.openide-chat-approval-head'));
		append(head, $(`span.codicon.codicon-${content.sensitive ? 'shield' : 'law'}`));
		const title = append(head, $('span.openide-chat-approval-title'));
		title.textContent = content.title;
		const badge = append(head, $('span.openide-chat-approval-kind'));
		badge.textContent = kind.label;

		const body = append(this.domNode, $('.openide-chat-approval-body'));
		if (content.detail) {
			const detail = append(body, $('.openide-chat-approval-description'));
			detail.textContent = content.detail;
		}
		if (content.command) {
			// Monospace and its own scroller: a long command must not widen the row, because the
			// list runs with supportDynamicHeights and cannot scroll sideways.
			const command = append(body, $('code.openide-chat-approval-cmd'));
			command.textContent = content.command;
		}

		this._actions = append(body, $('.openide-chat-approval-actions'));
		this._status = append(body, $('.openide-chat-approval-status'));

		this._renderActions(content);
		this._renderDecision(content.decision);
	}

	private _renderActions(content: IOpenideChatConfirmationContent): void {
		this._actions.textContent = '';
		const choice = (label: string, icon: string, decision: ToolApprovalDecision, extraClass: string) => {
			const button = append(this._actions, $(`button.openide-chat-abtn${extraClass}`)) as HTMLButtonElement;
			button.type = 'button';
			append(button, $(`span.codicon.codicon-${icon}`));
			const text = append(button, $('span'));
			text.textContent = label;
			this._register(this._onClick(button, decision));
		};

		choice(localize('openide.chat.approval.allow', "Permitir"), 'check', 'once', '.primary');
		// "This session" was missing entirely: without it the only way to stop being asked about a
		// command you are running in a loop was to allow it FOREVER, in the persisted allowlist.
		choice(t('chat.approval.session'), 'history', 'session', '');
		// A sensitive path never offers "always": the whole point of marking it sensitive is that
		// the answer must be given again next time.
		if (!content.sensitive) {
			choice(localize('openide.chat.approval.always', "Permitir siempre"), 'shield', 'always', '');
		}
		choice(localize('openide.chat.approval.deny', "Rechazar"), 'close', 'deny', '.deny');
	}

	private _onClick(button: HTMLButtonElement, decision: ToolApprovalDecision) {
		const listener = () => {
			if (this._decided) { return; }
			this._decided = true;
			this._agentService.resolveApproval(this._requestId, decision);
			this._renderDecision(decision);
		};
		button.addEventListener('click', listener);
		return { dispose: () => button.removeEventListener('click', listener) };
	}

	/** Answered cards stay on screen, disabled. Removing them would erase the record of what the
	 *  user authorised, which is the only place that decision is visible after the fact. */
	private _renderDecision(decision: IOpenideChatConfirmationContent['decision']): void {
		this.domNode.classList.toggle('decided', !!decision);
		for (const button of this._actions.querySelectorAll('button')) {
			(button as HTMLButtonElement).disabled = !!decision;
		}
		if (!decision) {
			this._status.textContent = '';
			return;
		}
		this._status.textContent = decision === 'deny'
			? localize('openide.chat.approval.denied', "Rechazado")
			: decision === 'always'
				? localize('openide.chat.approval.allowedAlways', "Permitido siempre")
				: decision === 'session'
					? t('chat.approval.allowedSession')
					: localize('openide.chat.approval.allowed', "Permitido");
	}

	hasSameContent(other: IOpenideChatContent): boolean {
		if (other.kind !== 'confirmation') { return false; }
		const next = other as IOpenideChatConfirmationContent;
		if (next.requestId !== this._requestId) { return false; }
		// Only the decision can change on an existing request, and it is applied in place so the
		// card does not blink out and back while the run continues.
		this._decided = !!next.decision;
		this._renderDecision(next.decision);
		return true;
	}
}
