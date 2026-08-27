/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { IOpenideChatContent, IOpenideChatModeSuggestionContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { AgentMode } from '../../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatModeSuggestion.css';

export const OPENIDE_CHAT_SUGGEST_WRAP_CLASS = 'openide-chat-suggest-wrap';

/** Same hint the webview prints on the accept button (openideChatHtml.ts:3968). */
const ACCEPT_SHORTCUT = isMacintosh ? '⌘↩' : 'Ctrl+↩';

interface ISuggestMeta {
	readonly icon: string;
	readonly label: string;
	readonly verb: string;
}

/** `SUGGEST_META`, transcribed verbatim (openideChatHtml.ts:3936-3942). */
const SUGGEST_META: Readonly<Record<string, ISuggestMeta>> = {
	agent: { icon: 'openide-mode-agent', label: 'Agent', verb: 'Cambiar a modo Agent' },
	plan: { icon: 'openide-mode-plan', label: 'Plan', verb: 'Cambiar a modo Plan' },
	ask: { icon: 'openide-mode-ask', label: 'Ask', verb: 'Cambiar a modo Ask' },
	debug: { icon: 'debug', label: 'Debug', verb: 'Usar modo Debug' },
	fork: { icon: 'repo-forked', label: 'Fork', verb: 'Abrir una rama (fork)' },
};

export interface IOpenideChatModeSuggestionAccepted {
	readonly requestId: string;
	/** `'fork'` is not a mode: it asks for a diverging branch that inherits the context. */
	readonly mode: AgentMode | 'fork';
	/** The reformulated request the triage proposed, when it proposed one. */
	readonly prompt?: string;
}

const _onDidAcceptModeSuggestion = new Emitter<IOpenideChatModeSuggestionAccepted>();

/**
 * Fired when the user (or the countdown) accepts a suggestion.
 *
 * The seam exists because accepting is TWO things and a content part can only do one of them.
 * Unblocking the run is the part's own business and happens through `IOpenideAgentService`. Acting
 * on the answer — switching the composer's mode and re-running the request in it — is the host's:
 * the webview does it in `modeSuggestionResponse` (openideChatView.ts:813-824) via
 * `resumeSilentlyInMode`, which owns the message array. Parts get no callbacks from the renderer,
 * so this event is how the widget picks that half up. `requestId` identifies the suggestion, so a
 * second chat widget cannot act on another one's card.
 */
export const onDidAcceptOpenideChatModeSuggestion: Event<IOpenideChatModeSuggestionAccepted> = _onDidAcceptModeSuggestion.event;

/**
 * The mode suggestion card: complexity triage proposing plan/debug/fork.
 *
 * Transcribed from `renderSuggestMode` (openideChatHtml.ts:3944-3990) and `armSuggestAutoAccept`
 * (:3992-4030). It is a BLOCKING card: `suggest_mode` parks the run on a deferred promise
 * (openideAgentService.ts:3465-3471) and nothing moves until this part answers, which is why the
 * actions are removed rather than disabled once answered — a card that can be answered twice leaves
 * the second answer with nothing to resolve.
 */
export class OpenideChatModeSuggestionPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _icon: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _actions: HTMLElement;
	private readonly _actionStore = this._register(new DisposableStore());
	/** Cleared as soon as the user shows any sign of deciding for themselves. */
	private readonly _timerStore = this._register(new DisposableStore());

	private _content: IOpenideChatModeSuggestionContent;
	private _resolved = false;
	/**
	 * True once the countdown has been armed, and it never goes back to false.
	 *
	 * A re-render must not restart the clock: the actions are rebuilt whenever the content changes,
	 * and re-arming there would hand the user a fresh countdown every time the turn streamed another
	 * delta — either an auto-accept that never fires, or one that fires after it was cancelled.
	 */
	private _timerArmed = false;

	constructor(
		content: IOpenideChatModeSuggestionContent,
		_context: IOpenideChatContentPartContext,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super();

		this._content = content;

		this.domNode = $(`div.${OPENIDE_CHAT_SUGGEST_WRAP_CLASS}`);
		const card = append(this.domNode, $('div.openide-chat-suggest-card'));

		const head = append(card, $('div.openide-chat-suggest-head'));
		this._icon = append(head, $('span.codicon'));
		this._title = append(head, $('span.openide-chat-suggest-title'));
		const kicker = append(head, $('span.openide-chat-suggest-kicker'));
		kicker.textContent = 'Modo recomendado';

		this._body = append(card, $('div.openide-chat-suggest-body'));
		this._actions = append(card, $('div.openide-chat-suggest-actions'));

		// `accepted` is set on the content when a restored conversation already carries the answer;
		// re-offering a decision the user made in a previous session would resolve nothing.
		this._resolved = content.accepted !== undefined;
		this._render();
	}

	private _render(): void {
		const meta = SUGGEST_META[this._content.mode] ?? SUGGEST_META.agent;
		this._icon.className = `codicon codicon-${meta.icon}`;
		this._title.textContent = meta.label;
		this._title.title = meta.label;
		this._body.textContent = this._content.reason;
		this._renderActions(meta);
	}

	private _renderActions(meta: ISuggestMeta): void {
		clearNode(this._actions);
		this._actionStore.clear();
		this.domNode.classList.toggle('openide-chat-suggest-resolved', this._resolved);
		if (this._resolved) {
			this._actions.classList.add('hidden');
			return;
		}
		this._actions.classList.remove('hidden');

		const dismiss = append(this._actions, $('button.openide-chat-suggest-dismiss'));
		dismiss.setAttribute('type', 'button');
		// The webview names the CURRENT mode here ("Seguir en Agent"), reading it from the composer.
		// A content part has no composer, and naming the wrong mode is worse than naming none.
		dismiss.textContent = 'Seguir en el modo actual';
		this._actionStore.add(addDisposableListener(dismiss, 'click', () => this._resolve(false)));

		const accept = append(this._actions, $('button.openide-chat-suggest-accept'));
		accept.setAttribute('type', 'button');
		append(accept, $(`span.codicon.codicon-${meta.icon}`));
		append(accept, $('span')).textContent = meta.verb;
		append(accept, $('span.openide-chat-suggest-kbd')).textContent = ACCEPT_SHORTCUT;
		this._actionStore.add(addDisposableListener(accept, 'click', () => this._resolve(true)));

		this._armAutoAccept(accept);
	}

	/**
	 * The countdown that accepts on its own, drawn as a bar filling INSIDE the button it is about to
	 * press — the time left belongs where the consequence is.
	 *
	 * It cancels the moment the user shows signs of deciding (pointer over the card, focus into it)
	 * and never re-arms: something firing by itself exactly as you were about to reject it is worse
	 * than having no timer at all. The webview also cancels on the composer's keydown; a part cannot
	 * see the composer, so that trigger is not ported.
	 */
	private _armAutoAccept(accept: HTMLElement): void {
		const seconds = this._content.autoAcceptSeconds ?? 0;
		if (this._timerArmed || !(seconds > 0)) {
			return;
		}
		this._timerArmed = true;
		const bar = append(accept, $('span.openide-chat-suggest-timer'));
		const count = append(accept, $('span.openide-chat-suggest-count'));
		const endsAt = Date.now() + seconds * 1000;

		const handle = setInterval(() => {
			const left = endsAt - Date.now();
			if (left <= 0) {
				this._timerStore.clear();
				// The automatic firing takes EXACTLY the same path as the click, so the two cannot
				// drift apart.
				if (this.domNode.isConnected && !this._resolved) {
					accept.click();
				}
				return;
			}
			bar.style.width = `${100 - (left / (seconds * 1000)) * 100}%`;
			count.textContent = `${Math.ceil(left / 1000)}s`;
		}, 100);

		this._timerStore.add(toDisposable(() => {
			clearInterval(handle);
			bar.remove();
			count.remove();
		}));
		this._timerStore.add(addDisposableListener(this.domNode, 'pointerenter', () => this._timerStore.clear()));
		this._timerStore.add(addDisposableListener(this.domNode, 'focusin', () => this._timerStore.clear()));
	}

	private _resolve(accepted: boolean): void {
		if (this._resolved) {
			return;
		}
		this._resolved = true;
		this._timerStore.clear();
		this._agentService.resolveModeSuggestion(this._content.requestId, accepted);
		if (accepted) {
			_onDidAcceptModeSuggestion.fire({
				requestId: this._content.requestId,
				mode: this._content.mode,
				prompt: this._content.prompt,
			});
		}
		this._renderActions(SUGGEST_META[this._content.mode] ?? SUGGEST_META.agent);
		this._onDidChangeHeight.fire();
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'modeSuggestion')) {
			return false;
		}
		// `accepted` is compared too: a restore that lands the answered version of this suggestion
		// must retire the buttons, not keep offering a decision the run no longer waits for.
		return other.requestId === this._content.requestId
			&& other.mode === this._content.mode
			&& other.reason === this._content.reason
			&& (other.accepted !== undefined) === (this._content.accepted !== undefined);
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'modeSuggestion') || other.requestId !== this._content.requestId) {
			return false;
		}
		this._content = other;
		this._resolved = this._resolved || other.accepted !== undefined;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
