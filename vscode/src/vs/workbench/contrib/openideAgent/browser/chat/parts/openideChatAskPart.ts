/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IOpenideChatAskContent, IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatAsk.css';

/**
 * The transcript's record of an `ask_user` call. Display-only since the questions moved to the
 * card docked on the composer (openideChatQuestionsCard.ts): while the run is parked on the answer
 * the shared status line describes the wait. Once the tool result settles the content
 * (`isComplete`, via the reducer's live settle) it becomes the durable list of what was asked and
 * what was answered — the same shape a restored transcript rebuilds.
 */
export class OpenideChatAskPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatAskContent;

	constructor(
		content: IOpenideChatAskContent,
		_context: IOpenideChatContentPartContext,
	) {
		super();
		this._content = content;
		this.domNode = $('.openide-chat-ask');
		this._render();
	}

	private _render(): void {
		clearNode(this.domNode);
		this.domNode.classList.toggle('answered', this._content.isComplete);

		this.domNode.hidden = !this._content.isComplete;
		if (!this._content.isComplete) { return; }

		const head = append(this.domNode, $('.openide-chat-ask-head'));
		append(head, $('span.codicon.codicon-question'));
		append(head, $('span.openide-chat-ask-step', undefined, t('chat.ask.answered')));

		const settled = append(this.domNode, $('.openide-chat-ask-settled'));
		const answers = this._content.answers ?? [];
		this._content.questions.forEach((question, index) => {
			const row = append(settled, $('.openide-chat-ask-settled-row'));
			append(row, $('.openide-chat-ask-settled-question', undefined, question.question));
			append(row, $('.openide-chat-ask-settled-answer', undefined, answers[index] ?? ''));
		});
	}

	hasSameContent(other: IOpenideChatContent): boolean {
		if (other.kind !== 'ask') { return false; }
		const next = other as IOpenideChatAskContent;
		if (next.requestId !== this._content.requestId) { return false; }
		if (next !== this._content) {
			const settledNow = next.isComplete && !this._content.isComplete;
			this._content = next;
			this._render();
			// The hidden record becomes a settled list and needs a new height.
			if (settledNow) { this._onDidChangeHeight.fire(); }
		}
		return true;
	}
}
