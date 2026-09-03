/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { IOpenideChatAccountChoiceContent, IOpenideChatContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatConfirmation.css';

/** What the card sends back when the user would rather stop than spend another subscription. */
export const OPENIDE_ACCOUNT_CHOICE_STOP = 'stop';

/**
 * "Your account ran out. Continue on which one?"
 *
 * Deliberately the approval card's grammar and stylesheet, not a family of its own: the run is
 * parked waiting for a person to authorise something, which is exactly what an approval is. A
 * second visual language for the same moment would only make the user learn it twice.
 *
 * The card does NOT disappear once answered. Which subscription paid for a turn is a fact worth
 * being able to scroll back to, and the answered state is the only place it is written down.
 */
export class OpenideChatAccountChoicePart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;
	private readonly _actions: HTMLElement;
	private _content: IOpenideChatAccountChoiceContent;
	private _decided = false;

	constructor(
		content: IOpenideChatAccountChoiceContent,
		_context: IOpenideChatContentPartContext,
		private readonly _agentService: IOpenideAgentService,
	) {
		super();
		this._content = content;

		this.domNode = $('.openide-chat-approval.openide-chat-account-choice');
		const head = append(this.domNode, $('.openide-chat-approval-head'));
		append(head, $('span.codicon.codicon-account'));
		append(head, $('span.openide-chat-approval-title', undefined, t('chat.accountChoice.title')));
		// Actions live INSIDE the body, as in the approval card: the body is what carries the divider
		// from the head, and hanging them off the root instead puts the buttons above that line.
		const body = append(this.domNode, $('.openide-chat-approval-body'));
		append(body, $('.openide-chat-approval-description', undefined, t('chat.accountChoice.body', content.spentLabel)));
		this._actions = append(body, $('.openide-chat-approval-actions'));
		this._renderActions();
		this._renderDecision();
	}

	private _renderActions(): void {
		this._actions.textContent = '';
		const choice = (label: string, icon: string, decision: string, extraClass: string) => {
			const button = append(this._actions, $(`button.openide-chat-abtn${extraClass}`)) as HTMLButtonElement;
			button.type = 'button';
			append(button, $(`span.codicon.codicon-${icon}`));
			append(button, $('span', undefined, label));
			button.addEventListener('click', () => this._answer(decision));
		};
		for (const candidate of this._content.candidates) {
			// A metered account says so on the button. Finding out afterwards that the run was billed
			// per token is the one outcome this whole question exists to prevent.
			const label = candidate.paid ? t('chat.accountChoice.paid', candidate.label) : candidate.label;
			choice(label, 'account', candidate.accountId, this._content.candidates.length === 1 ? '.primary' : '');
		}
		choice(t('chat.accountChoice.stop'), 'close', OPENIDE_ACCOUNT_CHOICE_STOP, '.deny');
	}

	private _answer(decision: string): void {
		if (this._decided) { return; }
		this._decided = true;
		this._agentService.resolveAccountChoice(this._content.requestId, decision);
		this._content = { ...this._content, decision };
		this._renderDecision();
	}

	/** Answered cards stay on screen, inert — the same contract the approval card keeps. */
	private _renderDecision(): void {
		const decided = !!this._content.decision;
		this._decided = this._decided || decided;
		this.domNode.classList.toggle('decided', decided);
		for (const button of this._actions.querySelectorAll('button')) {
			button.disabled = decided;
			button.classList.toggle('chosen', decided && button.textContent?.includes(this._labelOf(this._content.decision!)) === true);
		}
	}

	private _labelOf(decision: string): string {
		if (decision === OPENIDE_ACCOUNT_CHOICE_STOP) { return t('chat.accountChoice.stop'); }
		return this._content.candidates.find(candidate => candidate.accountId === decision)?.label ?? decision;
	}

	hasSameContent(other: IOpenideChatContent, _following: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'accountChoice')
			&& other.requestId === this._content.requestId
			&& other.decision === this._content.decision;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'accountChoice') || other.requestId !== this._content.requestId) {
			return false;
		}
		this._content = other;
		this._renderDecision();
		this._onDidChangeHeight.fire();
		return true;
	}
}
