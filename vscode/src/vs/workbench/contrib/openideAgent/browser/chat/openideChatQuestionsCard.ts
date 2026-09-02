/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatAskContent } from '../../common/chat/openideChatContent.js';
import { OPENIDE_CHAT_ASK_SKIPPED } from '../../common/chat/openideChatReducerTools.js';
import { IChatImage } from '../../common/openideAgentTypes.js';
import { t } from '../../common/openideStrings.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { ATTACH_LIMIT, readChatImage } from './openideChatComposerAttachments.js';
import './media/openideChatQuestions.css';

/** What the user is composing for one question; nothing is spent until Continue on the last one. */
interface IQuestionDraft {
	/** Option labels currently picked. One entry at most unless the question allows several. */
	readonly picks: Set<string>;
	/** The "Other…" field of this question. */
	other: string;
}

/**
 * The `ask_user` card, docked onto the composer.
 *
 * The webview (and the first native port) drew this as a transcript row, which put the thing the
 * run is waiting for several screens above the place the user is already looking at — the prompt
 * box. Cursor docks it right on top of the composer and that is what this is: the widget mounts it
 * in `composer.questionsHost` whenever the visible conversation has a pending ask, and the
 * transcript keeps only a shimmer line while this card is open (openideChatAskPart.ts).
 *
 * It talks to the service directly, like the approval card: `resolveAsk` settles the deferred the
 * run is parked on, and the tool result then closes the transcript's copy through the reducer.
 */
export class OpenideChatQuestionsCard extends Disposable {

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	readonly domNode: HTMLElement;

	private readonly _head: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _nav: HTMLElement;
	private readonly _answered: HTMLElement;
	private readonly _collapseButton: HTMLButtonElement;
	private readonly _body: HTMLElement;
	private readonly _renderStore = this._register(new DisposableStore());

	private _content: IOpenideChatAskContent | undefined;
	private _drafts: IQuestionDraft[] = [];
	private _images: IChatImage[] = [];
	private _index = 0;
	private _collapsed = false;
	/** True from Continue/Skip on: the service echo (reducer settle) is a model turn away. */
	private _sent = false;

	constructor(
		host: HTMLElement,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super();
		this.domNode = append(host, $('.openide-chat-questions.hidden'));

		this._head = append(this.domNode, $('.openide-chat-questions-head'));
		append(this._head, $('span.codicon.codicon-question'));
		this._title = append(this._head, $('span.openide-chat-questions-title'));
		this._title.textContent = t('chat.ask.title');
		this._nav = append(this._head, $('span.openide-chat-questions-nav'));
		this._answered = append(this._head, $('span.openide-chat-questions-answered'));
		this._collapseButton = append(this._head, $('button.openide-chat-questions-collapse', { type: 'button' })) as HTMLButtonElement;
		append(this._collapseButton, $('span.codicon.codicon-chevron-down'));
		this._register(addDisposableListener(this._collapseButton, 'click', event => {
			event.stopPropagation();
			this._setCollapsed(!this._collapsed);
		}));
		// The whole header is the reopen handle while collapsed: a 20px chevron is a small target
		// for something the run is waiting on.
		this._register(addDisposableListener(this._head, 'click', () => {
			if (this._collapsed) { this._setCollapsed(false); }
		}));

		// grid-rows animation: the reveal row goes 1fr → 0fr and the inner box clips, which animates
		// to/from auto-height without measuring anything.
		const reveal = append(this.domNode, $('.openide-chat-questions-reveal'));
		this._body = append(reveal, $('.openide-chat-questions-body'));
		this._register(addDisposableListener(reveal, 'transitionend', () => this._onDidChangeHeight.fire()));

		this._register(addDisposableListener(this.domNode, 'keydown', event => {
			const keyboardEvent = event as KeyboardEvent;
			const key = keyboardEvent.key;
			if (key === 'Escape') {
				event.preventDefault();
				this._skip();
				return;
			}
			if (key === 'Enter') {
				event.preventDefault();
				this._continue();
				return;
			}
			// The chips name the shortcut: a bare digit picks that row. Never while writing in
			// "Other…" — a typed 1 there is text, not a choice.
			if ((keyboardEvent.target as HTMLElement)?.tagName === 'INPUT') { return; }
			const digit = Number(key);
			if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
				const question = this._questions[this._index];
				const label = question?.options?.[digit - 1];
				if (label) {
					event.preventDefault();
					this._pick(question.allowMultiple === true, label);
				}
			}
		}));
	}

	/**
	 * Shows the card for a pending ask, or refreshes it. A different `requestId` is a NEW batch:
	 * drafts belong to the questions they were written for.
	 */
	show(content: IOpenideChatAskContent): void {
		if (this._content?.requestId !== content.requestId) {
			this._drafts = content.questions.map(() => ({ picks: new Set<string>(), other: '' }));
			this._images = [];
			this._index = 0;
			this._sent = false;
			this._collapsed = false;
			this.domNode.classList.remove('collapsed');
		}
		this._content = content;
		if (this._sent) { return; }
		const wasHidden = this.domNode.classList.contains('hidden');
		this.domNode.classList.remove('hidden');
		this._render();
		if (wasHidden) { this._onDidChangeHeight.fire(); }
	}

	hide(): void {
		if (this.domNode.classList.contains('hidden')) { return; }
		this.domNode.classList.add('hidden');
		this._content = undefined;
		this._onDidChangeHeight.fire();
	}

	private get _questions() { return this._content?.questions ?? []; }

	private _setCollapsed(collapsed: boolean): void {
		if (this._collapsed === collapsed) { return; }
		this._collapsed = collapsed;
		this.domNode.classList.toggle('collapsed', collapsed);
		this._render();
		// Once when the transition starts (the list can begin making room) and once more on
		// `transitionend` with the settled height.
		this._onDidChangeHeight.fire();
	}

	private _answeredCount(): number {
		return this._drafts.filter(draft => draft.picks.size > 0 || draft.other.trim()).length;
	}

	private _render(): void {
		// One store for head and body: cleared here, BEFORE either renders, so the head's nav
		// listeners are not disposed by the body render that follows them.
		this._renderStore.clear();
		this._renderHead();
		this._renderBody();
	}

	private _renderHead(): void {
		const total = this._questions.length;
		clearNode(this._nav);
		if (!this._collapsed && total > 1) {
			const prev = append(this._nav, $('button.openide-chat-questions-navbtn', { type: 'button' })) as HTMLButtonElement;
			append(prev, $('span.codicon.codicon-chevron-up'));
			prev.setAttribute('aria-label', t('chat.ask.prevQuestion'));
			prev.disabled = this._index === 0;
			this._renderStore.add(addDisposableListener(prev, 'click', event => {
				event.stopPropagation();
				this._goTo(this._index - 1);
			}));
			append(this._nav, $('span.openide-chat-questions-step', undefined, t('chat.ask.stepOf', String(this._index + 1), String(total))));
			const next = append(this._nav, $('button.openide-chat-questions-navbtn', { type: 'button' })) as HTMLButtonElement;
			append(next, $('span.codicon.codicon-chevron-down'));
			next.setAttribute('aria-label', t('chat.ask.nextQuestion'));
			next.disabled = this._index >= total - 1;
			this._renderStore.add(addDisposableListener(next, 'click', event => {
				event.stopPropagation();
				this._goTo(this._index + 1);
			}));
		}
		this._answered.textContent = this._collapsed ? t('chat.ask.answeredOf', String(this._answeredCount()), String(total)) : '';
		this._collapseButton.setAttribute('aria-label', this._collapsed ? t('chat.ask.expand') : t('chat.ask.collapse'));
	}

	private _goTo(index: number): void {
		this._index = Math.min(Math.max(index, 0), Math.max(this._questions.length - 1, 0));
		this._render();
		this._onDidChangeHeight.fire();
	}

	private _renderBody(): void {
		clearNode(this._body);
		const question = this._questions[this._index];
		const draft = this._drafts[this._index];
		if (!question || !draft) { return; }

		const heading = append(this._body, $('.openide-chat-questions-q'));
		append(heading, $('span.openide-chat-questions-qnum', undefined, `${this._index + 1}.`));
		const text = append(heading, $('span.openide-chat-questions-qtext', undefined, question.question));
		if (question.allowMultiple) {
			append(text, $('span.openide-chat-questions-multihint', undefined, ` — ${t('chat.ask.multiHint')}`));
		}

		const options = append(this._body, $('.openide-chat-questions-options'));
		const labels = question.options ?? [];
		// Digits, not letters (the user's explicit choice; the Bootstrap icon theme maps no
		// numbered glyphs, so the chip draws the digit itself). They double as shortcuts: 1..9
		// pick the row, handled in the card's keydown.
		labels.forEach((label, index) => {
			const row = append(options, $('button.openide-chat-questions-option', { type: 'button' })) as HTMLButtonElement;
			row.classList.toggle('chosen', draft.picks.has(label));
			append(row, $('span.openide-chat-questions-chip', undefined, String(index + 1)));
			append(row, $('span.openide-chat-questions-option-label', undefined, label));
			this._renderStore.add(addDisposableListener(row, 'click', () => this._pick(question.allowMultiple === true, label)));
		});

		// "Other…": the option you fill in yourself. Always offered — the options are the model's
		// guess at the shape of the answer, and a guess must never be the only way out.
		const other = append(options, $('.openide-chat-questions-option.openide-chat-questions-other'));
		append(other, $('span.openide-chat-questions-chip', undefined, String(labels.length + 1)));
		const input = append(other, other.ownerDocument.createElement('input'));
		input.className = 'openide-chat-questions-other-input';
		input.type = 'text';
		input.placeholder = t('chat.ask.other');
		input.value = draft.other;
		this._renderStore.add(addDisposableListener(other, 'click', () => input.focus()));
		this._renderStore.add(addDisposableListener(input, 'input', () => {
			draft.other = input.value;
			other.classList.toggle('chosen', !!input.value.trim());
		}));
		// Enter inside the field bubbles to the card handler (Continue); images ride the same paste
		// path as the composer's.
		this._renderStore.add(addDisposableListener(input, 'paste', event => {
			if (this._addFromClipboard((event as ClipboardEvent).clipboardData)) {
				event.preventDefault();
			}
		}));
		other.classList.toggle('chosen', !!draft.other.trim());

		this._renderChips();

		const actions = append(this._body, $('.openide-chat-questions-actions'));
		const skip = append(actions, $('button.openide-chat-questions-skip', { type: 'button' })) as HTMLButtonElement;
		append(skip, $('span', undefined, t('chat.ask.skip')));
		append(skip, $('span.openide-chat-questions-kbd', undefined, 'Esc'));
		this._renderStore.add(addDisposableListener(skip, 'click', () => this._skip()));

		const submit = append(actions, $('button.openide-chat-questions-continue', { type: 'button' })) as HTMLButtonElement;
		append(submit, $('span', undefined, t('chat.ask.continue')));
		append(submit, $('span.openide-chat-questions-kbd', undefined, '↵'));
		this._renderStore.add(addDisposableListener(submit, 'click', () => this._continue()));
	}

	private _pick(allowMultiple: boolean, label: string): void {
		const draft = this._drafts[this._index];
		if (!draft) { return; }
		if (allowMultiple) {
			draft.picks.has(label) ? draft.picks.delete(label) : draft.picks.add(label);
		} else {
			const wasPicked = draft.picks.has(label);
			draft.picks.clear();
			if (!wasPicked) { draft.picks.add(label); }
		}
		this._render();
	}

	/** Advances to the first unanswered question after this one, or submits from the last. */
	private _continue(): void {
		if (this._index < this._questions.length - 1) {
			this._goTo(this._index + 1);
			return;
		}
		this._submit();
	}

	private _answerOf(index: number): string {
		const question = this._questions[index];
		const draft = this._drafts[index];
		if (!question || !draft) { return OPENIDE_CHAT_ASK_SKIPPED; }
		// Picked labels in the order the question offered them, so a multi answer is stable no
		// matter the click order; whatever was typed under "Other…" travels with them.
		const picked = (question.options ?? []).filter(label => draft.picks.has(label));
		const other = draft.other.trim();
		const parts = other ? [...picked, other] : picked;
		return parts.length ? parts.join(', ') : OPENIDE_CHAT_ASK_SKIPPED;
	}

	/**
	 * Hands the whole batch over as the single blob the protocol knows: the answer itself for one
	 * question, `P: …\nR: …` blocks for several — the same shape `parseOpenideChatAskAnswers`
	 * reads back on both the live settle and the transcript restore.
	 */
	private _submit(): void {
		const content = this._content;
		if (!content || this._sent) { return; }
		const questions = content.questions;
		const answers = questions.map((_question, index) => this._answerOf(index));
		const blob = questions.length <= 1
			? answers[0]
			: questions.map((question, index) => `P: ${question.question}\nR: ${answers[index]}`).join('\n\n');
		const images = this._images;
		this._sent = true;
		this._images = [];
		this._agentService.resolveAsk(content.requestId, blob, images.length ? images : undefined);
		// Optimistic: the reducer's settle is a microtask away, but the card must not sit there
		// showing a question the run already has the answer to.
		this.hide();
	}

	private _skip(): void {
		const content = this._content;
		if (!content || this._sent) { return; }
		const questions = content.questions;
		const blob = questions.length <= 1
			? OPENIDE_CHAT_ASK_SKIPPED
			: questions.map(question => `P: ${question.question}\nR: ${OPENIDE_CHAT_ASK_SKIPPED}`).join('\n\n');
		this._sent = true;
		this._agentService.resolveAsk(content.requestId, blob);
		this.hide();
	}

	/** Returns true when the clipboard carried at least one image, so the caller can swallow it. */
	private _addFromClipboard(data: DataTransfer | null): boolean {
		const files = Array.from(data?.items ?? [])
			.filter(item => item.kind === 'file' && item.type.startsWith('image/'))
			.map(item => item.getAsFile())
			.filter((file): file is File => !!file);
		if (!files.length) { return false; }
		void (async () => {
			for (const file of files) {
				if (this._images.length >= ATTACH_LIMIT) { break; }
				const image = await readChatImage(file);
				if (image) { this._images.push(image); }
			}
			this._renderChips();
			this._onDidChangeHeight.fire();
		})();
		return true;
	}

	private _renderChips(): void {
		const existing = this._body.querySelector('.openide-chat-questions-chips');
		existing?.remove();
		if (!this._images.length) { return; }
		const strip = $('.openide-chat-questions-chips');
		const actions = this._body.querySelector('.openide-chat-questions-actions');
		this._body.insertBefore(strip, actions);
		this._images.forEach((_image, index) => {
			const chip = append(strip, $('span.openide-chat-reference-chip'));
			append(chip, $('span.codicon.codicon-file-media'));
			append(chip, $('span.openide-chat-chip-name', undefined, `image-${index + 1}`));
			const remove = append(chip, $('button.openide-chat-chip-remove', { type: 'button' })) as HTMLButtonElement;
			append(remove, $('span.codicon.codicon-close'));
			this._renderStore.add(addDisposableListener(remove, 'click', event => {
				event.stopPropagation();
				this._images.splice(index, 1);
				this._renderChips();
				this._onDidChangeHeight.fire();
			}));
		});
	}
}
