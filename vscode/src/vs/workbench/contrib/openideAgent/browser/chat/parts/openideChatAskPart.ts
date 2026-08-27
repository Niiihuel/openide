/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { IOpenideChatAskContent, IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatAsk.css';

/**
 * `ask_user`. Blocking, like the approval card: the service holds a Promise per question, so a
 * missing part leaves the run parked with nothing on screen explaining why.
 *
 * One question at a time — the content carries up to five and `answers` says how many are already
 * settled, so the stepper position is derived, never stored here. That matters because the part is
 * recreated whenever the list recycles its rows.
 */
export class OpenideChatAskPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _step: HTMLElement;
	private readonly _question: HTMLElement;
	private readonly _options: HTMLElement;
	private _content: IOpenideChatAskContent;

	constructor(
		content: IOpenideChatAskContent,
		_context: IOpenideChatContentPartContext,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super();
		this._content = content;
		this.domNode = $('.openide-chat-ask');

		const head = append(this.domNode, $('.openide-chat-ask-head'));
		append(head, $('span.codicon.codicon-question'));
		this._step = append(head, $('span.openide-chat-ask-step'));

		this._question = append(this.domNode, $('.openide-chat-ask-question'));
		this._options = append(this.domNode, $('.openide-chat-ask-options'));

		this._render();
	}

	private get _index(): number {
		return this._content.answers?.length ?? 0;
	}

	private _render(): void {
		const questions = this._content.questions;
		const index = this._index;
		const current = questions[index];
		const answered = this._content.isComplete || !current;

		this.domNode.classList.toggle('answered', answered);
		this._step.textContent = questions.length > 1
			? localize('openide.chat.ask.step', "Pregunta {0} de {1}", Math.min(index + 1, questions.length), questions.length)
			: localize('openide.chat.ask.single', "Pregunta");

		if (answered) {
			this._question.textContent = localize('openide.chat.ask.done', "Respondido");
			this._options.textContent = '';
			return;
		}

		this._question.textContent = current.question;
		this._options.textContent = '';
		// `IAskQuestion.options` is a plain string[] (common/openideAgentTypes.ts:271): the label IS
		// the answer, so there is no description to render alongside it.
		for (const option of current.options ?? []) {
			const button = append(this._options, $('button.openide-chat-ask-option')) as HTMLButtonElement;
			button.type = 'button';
			const label = append(button, $('span.openide-chat-ask-option-label'));
			label.textContent = option;
			this._register(this._onPick(button, option));
		}

		if (this._content.allowFreeText !== false) {
			// Free text is the escape hatch the webview always offers: a question whose options do
			// not cover the real answer must not corner the user into picking a wrong one.
			const free = append(this._options, this._options.ownerDocument.createElement('input'));
			free.className = 'openide-chat-ask-free';
			free.type = 'text';
			free.placeholder = localize('openide.chat.ask.free', "Otra respuesta…");
			const onKey = (event: KeyboardEvent) => {
				if (event.key !== 'Enter' || !free.value.trim()) { return; }
				event.preventDefault();
				this._answer(free.value.trim());
			};
			free.addEventListener('keydown', onKey);
			this._register({ dispose: () => free.removeEventListener('keydown', onKey) });
		}
	}

	private _onPick(button: HTMLButtonElement, answer: string) {
		const listener = () => this._answer(answer);
		button.addEventListener('click', listener);
		return { dispose: () => button.removeEventListener('click', listener) };
	}

	/** The service advances the stepper: it answers the pending question and, if more remain,
	 *  emits fresh content. The part never guesses what comes next. */
	private _answer(answer: string): void {
		if (this._content.isComplete) { return; }
		this._agentService.resolveAsk(this._content.requestId, answer);
	}

	hasSameContent(other: IOpenideChatContent): boolean {
		if (other.kind !== 'ask') { return false; }
		const next = other as IOpenideChatAskContent;
		if (next.requestId !== this._content.requestId) { return false; }
		this._content = next;
		this._render();
		return true;
	}
}
