/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getTotalHeight, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { IObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { COMPACT_COMMAND, IOpenideChatSuggestSources } from '../../common/chat/openideChatSlashCommands.js';
import { AgentMode, IChatCapabilityMention, IChatImage } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { OpenideChatComposerAttachments } from './openideChatComposerAttachments.js';
import { composerPayload, extractComposerLinks, IComposerReference, OpenideChatComposerChips, REFERENCE_LIMIT } from './openideChatComposerChips.js';
import { IComposerSnippet, SNIPPET_LIMIT } from '../../common/chat/openideChatSnippet.js';
import { t } from '../../common/openideStrings.js';
import { OpenideChatComposerControls, VoiceMode } from './openideChatComposerControls.js';
import { IOpenideChatModelRoute } from './openideChatController.js';
import { OpenideChatComposerFooter } from './openideChatComposerFooter.js';
import { IOpenideChatCapabilityCounts, IOpenideChatContextUsage } from '../../common/chat/openideChatContextBreakdown.js';
import { IOpenidePickAttachment } from '../../common/openidePickContext.js';
import { OpenideChatComposerPick } from './openideChatComposerPick.js';
import { IComposerQueueEntry, OpenideChatComposerQueue, queueFullMessage } from './openideChatComposerQueue.js';
import { OPENIDE_CHAT_QUEUE_ENABLED_KEY } from '../../common/chat/openideChatConfig.js';

/** What the composer says instead of queueing when `openide.chat.queue.enabled` is off. */
const queueDisabledMessage = () => t('chat.queue.disabled');
import { OpenideChatComposerSuggest } from './openideChatComposerSuggest.js';
import { OpenideChatComposerVoice } from './openideChatComposerVoice.js';
import './media/openideChatComposer.css';

/** Ceiling of the auto-growing textarea. Past it the field scrolls instead of eating the transcript. */
const PROMPT_MAX_HEIGHT = 180;

/** How long the prompt's scrollbar stays up after the last scroll, before fading back out. */
const PROMPT_SCROLLBAR_LINGER = 800;

export interface IOpenideComposerSubmit {
	/**
	 * Raw text for the host: `/command` first when one was picked, then what was typed, then the
	 * pasted links one per line (`composerPayload`, the removed chat webview). Expansion of the
	 * command and resolution of the references belong to the controller.
	 */
	readonly text: string;
	/** What the bubble shows when it differs from `text` (chip labels + typed text). */
	readonly displayText?: string;
	/** The text exactly as typed, so a rejected turn can be put back without the payload's rewriting.
	 *  Always set on emit; optional so a caller restoring from a persisted turn can pass `text` alone. */
	readonly inputText?: string;
	readonly images: readonly IChatImage[];
	/** Workspace-relative paths picked from the `@` menu. */
	readonly references: readonly string[];
	/** Same references with their icon classes, so `restore` can redraw the chips. Always set on emit. */
	readonly referenceChips?: readonly IComposerReference[];
	readonly capabilities: readonly IChatCapabilityMention[];
	/** Pasted links, already re-expanded into `text`. Always set on emit. */
	readonly links?: readonly string[];
	/** Pick & Polish selection riding along with this turn, if the user made one. */
	readonly pick?: IOpenidePickAttachment;
	/** Editor selections sent to the chat. Always set on emit. */
	readonly snippets?: readonly IComposerSnippet[];
	readonly mode: AgentMode;
	/** Snapshot of the picker at the moment Send was pressed, not at the moment the run starts. */
	readonly providerId: string;
	readonly modelId: string;
}

/**
 * The composer of the native chat: an input card with the prompt and the full control row.
 *
 * A raw `<textarea>` and not an `InputBox`/`CodeEditorWidget`: the card owns the padding, the
 * border and the focus ring, and the input box brings all three of its own. The `@`/`/` menus are
 * a popover over the caret's token (`OpenideChatComposerSuggest`), which is what the webview did
 * too, so the editor would only add a surface to fight.
 */
export class OpenideChatComposer extends Disposable {

	private readonly _onDidSubmit = this._register(new Emitter<IOpenideComposerSubmit>());
	/** Carries the raw text: expansion of `/commands` and mentions belongs to the controller. */
	readonly onDidSubmit: Event<IOpenideComposerSubmit> = this._onDidSubmit.event;

	private readonly _onDidRequestStop = this._register(new Emitter<void>());
	readonly onDidRequestStop: Event<void> = this._onDidRequestStop.event;

	private readonly _onDidRequestCompact = this._register(new Emitter<void>());
	/** A bare `/compact`: a local action on the history, never a turn (the removed chat webview). */
	readonly onDidRequestCompact: Event<void> = this._onDidRequestCompact.event;

	private readonly _onDidReject = this._register(new Emitter<string>());
	/** Something the composer refused to do and the user has to hear about (a full queue). */
	readonly onDidReject: Event<string> = this._onDidReject.event;

	private readonly _onDidFailVoice = this._register(new Emitter<string>());
	/** Dictation errors: the composer has no strip of its own, and the widget already owns one. */
	readonly onDidFailVoice: Event<string> = this._onDidFailVoice.event;

	private readonly _height: ISettableObservable<number>;
	/**
	 * Read with an `autorun` by the widget instead of being pushed as an event, so the widget can
	 * re-layout only the list. Calling the full `layout()` back from here re-enters the composer's
	 * own layout and loops.
	 */
	/** Where trays that stack under the input card mount. Inside the composer on purpose — see
	 *  the note where it is created. */
	get trayHost(): HTMLElement { return this._trayHost; }
	/** Slot for the ask_user questions card, INSIDE the block above the trays: one silhouette with
	 *  the prompt, outlined and beam-swept by the block itself. */
	get questionsHost(): HTMLElement { return this._questionsHost; }
	/** Left slot of the footer row, for the session-type picker (harness / terminal agents). */
	get footerHost(): HTMLElement { return this._footer.footerHost; }

	/** Feeds the context ring and the Session Info popover. */
	/** The status bar's context command opens the same popover the ring does. */
	toggleSessionInfo(): void { this._footer.toggleSessionInfo(); }

	/** Where the turn in flight actually landed, when that is not the model on the chip. */
	setModelRoute(route: IOpenideChatModelRoute | undefined): void {
		this._controls.setModelRoute(route);
	}

	setUsage(usage: IOpenideChatContextUsage, capabilities: IOpenideChatCapabilityCounts): void {
		this._footer.setUsage(usage, capabilities);
	}


	get height(): IObservable<number> { return this._height; }

	private readonly _dock: HTMLElement;
	private readonly _card: HTMLElement;
	private readonly _block: HTMLElement;
	private readonly _questionsHost: HTMLElement;
	private readonly _footer: OpenideChatComposerFooter;
	private readonly _trayHost: HTMLElement;
	private readonly _prompt: HTMLTextAreaElement;
	/** Fades the prompt's scrollbar back out once scrolling settles. */
	private readonly _scrollIdle: RunOnceScheduler;
	private readonly _attachments: OpenideChatComposerAttachments;
	private readonly _chips: OpenideChatComposerChips;
	private readonly _pick: OpenideChatComposerPick;
	private readonly _voice: OpenideChatComposerVoice;
	private readonly _controls: OpenideChatComposerControls;
	private readonly _suggest: OpenideChatComposerSuggest;
	private readonly _queue: OpenideChatComposerQueue;
	private _busy = false;
	private _dragDepth = 0;

	get domNode(): HTMLElement { return this._dock; }

	get value(): string { return this._prompt.value; }
	set value(text: string) {
		this._prompt.value = text;
		this._autosize();
		this._syncContent();
	}

	constructor(
		parent: HTMLElement,
		sources: IOpenideChatSuggestSources,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService contextViewService: IContextViewService,
		@ICommandService commandService: ICommandService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHoverService hoverService: IHoverService,
		@IFileService fileService: IFileService,
	) {
		super();
		this._height = observableValue<number>('openideChatComposerHeight', 0);

		this._dock = append(parent, $('.openide-chat-dock'));
		const composer = append(this._dock, $('.openide-chat-composer'));
		// Host for the trays that stack UNDER the card (changed files today). It lives inside the
		// composer, like the webview's #filesStack, and not as a sibling
		// of the dock: the dock is z-index 100 and paints its fade gradient over anything below it,
		// so a tray mounted outside was rendered dimmed under that gradient.
		// One block for the trays (changed files, todos, terminals, queue) and the prompt card: the
		// working beam runs around THIS, so everything stacked on the composer reads as a single
		// outlined control while a turn is in flight (upstream draws it on `.chat-input-container`).
		this._block = append(composer, $('.openide-chat-block'));
		// The working beam, as two REAL elements rather than the block's own pseudo-elements.
		// Each is a ring-masked window holding a square that carries a STATIC conic gradient and
		// spins with `transform`, because a transform is composited and a gradient is not: the
		// previous version animated a registered custom property (`--openide-chat-anim-angle`)
		// that the conic gradient read, which forces the browser to re-rasterise the whole block
		// every frame for as long as a turn runs. Measured on this build with the composer busy:
		// ~21% of a core then, ~5% now, against ~1% with the beam off. Pseudo-elements cannot
		// hold the spinning square, which is the only reason these are in the DOM.
		for (const layer of ['comet', 'halo'] as const) {
			append(append(this._block, $(`.openide-chat-beam.${layer}`)), $('i'));
		}
		// INSIDE the block, above the trays: the questions card is one more segment of the block's
		// single silhouette, so the block's outline — and the working beam that animates over it —
		// wrap the card and the prompt as one control (the user's explicit call).
		this._questionsHost = append(this._block, $('.openide-chat-questions-host'));
		this._trayHost = append(this._block, $('.openide-chat-tray-host'));
		this._card = append(this._block, $('.openide-chat-input-card'));
		// Upstream's secondary toolbar: outside the card, under it.
		this._footer = this._register(new OpenideChatComposerFooter(composer, agentService, contextViewService, hoverService, () => this._onDidRequestCompact.fire()));

		// Above the attachments, which is the webview's order: the pick
		// is what the next message is ABOUT, the images are what it carries.
		const pickStrip = append(this._card, $('.openide-chat-pick-strip'));
		// References, capabilities and links above the attachments (the removed chat webview).
		const chipHost = append(this._card, $('.openide-chat-chip-host'));
		const attachStrip = append(this._card, $('.openide-chat-attach-strip'));
		this._prompt = append(this._card, this._card.ownerDocument.createElement('textarea'));
		this._prompt.className = 'openide-chat-prompt';
		this._scrollIdle = this._register(new RunOnceScheduler(() => this._prompt.classList.remove('scrolling'), PROMPT_SCROLLBAR_LINGER));
		this._register(addDisposableListener(this._prompt, 'scroll', () => this._armScrollIndicator()));
		this._prompt.rows = 1;
		this._prompt.placeholder = localize('openide.chat.composer.placeholder', "Plan, Build, / for skills, @ for context");
		this._prompt.setAttribute('aria-label', localize('openide.chat.composer.aria', "OpenIDE chat message"));
		const row = append(this._card, $('.openide-chat-input-row'));

		this._attachments = this._register(new OpenideChatComposerAttachments(attachStrip, this._card, hoverService, fileService, () => {
			this._syncContent();
			this._measure();
		}));
		this._chips = this._register(new OpenideChatComposerChips(chipHost, hoverService, () => {
			this._syncContent();
			this._measure();
		}, () => this._prompt.focus()));
		this._suggest = this._register(new OpenideChatComposerSuggest(this._prompt, this._card, sources, contextViewService, hoverService, {
			acceptFile: suggestion => {
				if (!this._chips.addReference({ path: suggestion.path, iconClasses: suggestion.iconClasses })) {
					this._onDidReject.fire(t('chat.references.full', REFERENCE_LIMIT));
				}
				this._autosize();
				this._syncContent();
			},
			acceptSlash: suggestion => {
				if (suggestion.kind === 'skill' || suggestion.kind === 'command' || suggestion.kind === 'mcp' || suggestion.kind === 'tool') {
					this._chips.addCapability({ kind: suggestion.kind, name: suggestion.name });
				}
				this._autosize();
				this._syncContent();
			},
		}));
		// Under the card, with the other trays: the queue is what the user decided to say next.
		this._queue = this._register(new OpenideChatComposerQueue(this._trayHost, storageService, hoverService));
		this._register(this._queue.onDidChangeHeight(() => this._measure()));
		this._register(this._queue.onDidRequestEdit(({ entry }) => this._editQueued(entry)));
		this._register(this._queue.onDidRequestSendNow(({ entry }) => {
			// "Send now" while a run is in flight cancels it first (the removed chat webview).
			if (this._busy) { this._onDidRequestStop.fire(); }
			this._dispatch(entry);
		}));
		this._pick = this._register(new OpenideChatComposerPick(
			pickStrip,
			agentService,
			hoverService,
			() => this._measure(),
			// The webview focuses the prompt on every pick: the user is coming back from their app
			// with something to say about the element they just clicked.
			() => this._prompt.focus(),
		));
		this._voice = this._register(new OpenideChatComposerVoice(
			agentService,
			getWindow(parent),
			state => this._controls.applyVoiceState(state),
			text => this._appendTranscription(text),
			message => this._reportVoiceFailure(message),
		));
		this._controls = this._register(new OpenideChatComposerControls(row, agentService, contextViewService, commandService, hoverService, this._voice, {
			send: () => this._submit(),
			stop: () => this._onDidRequestStop.fire(),
			attach: () => this._attachments.pick(),
		}));

		this._register(addDisposableListener(this._prompt, 'input', () => {
			this._autosize();
			this._syncContent();
			this._suggest.update();
		}));
		// The suggest menus splice the token out of the textarea programmatically, which fires no
		// `input`; they raise this instead so the card re-measures.
		this._register(addDisposableListener(this._prompt, 'suggest-splice', () => {
			this._autosize();
			this._syncContent();
		}));
		this._register(addDisposableListener(this._prompt, 'keydown', event => this._onKeyDown(event)));
		this._register(addDisposableListener(this._prompt, 'paste', event => {
			// Swallowed only when the clipboard actually carried an image, so pasting text still
			// behaves like a normal paste.
			if (this._attachments.addFromDataTransfer(event.clipboardData)) { event.preventDefault(); return; }
			// A pasted URL becomes a chip, not text (the removed chat webview). Text that merely
			// contains a URL among prose stays a normal paste.
			const pasted = event.clipboardData?.getData('text/plain') ?? '';
			if (pasted.trim() && this._isBareLinks(pasted)) {
				const parsed = extractComposerLinks(pasted);
				if (parsed.links.length) {
					event.preventDefault();
					this._chips.addLinks(parsed.links);
					const rest = parsed.text.trim();
					if (rest) { this._insertAtCaret(rest); }
				}
			}
		}));
		// Drag & drop of images onto the card (the removed chat webview): same limits as the paste.
		this._register(addDisposableListener(this._card, 'dragenter', event => {
			if (!this._hasFiles(event.dataTransfer)) { return; }
			event.preventDefault();
			this._dragDepth++;
			this._card.classList.add('dragover');
		}));
		this._register(addDisposableListener(this._card, 'dragover', event => {
			if (!this._hasFiles(event.dataTransfer)) { return; }
			event.preventDefault();
			if (event.dataTransfer) { event.dataTransfer.dropEffect = 'copy'; }
		}));
		this._register(addDisposableListener(this._card, 'dragleave', () => {
			this._dragDepth = Math.max(0, this._dragDepth - 1);
			if (!this._dragDepth) { this._card.classList.remove('dragover'); }
		}));
		this._register(addDisposableListener(this._card, 'drop', event => {
			this._dragDepth = 0;
			this._card.classList.remove('dragover');
			if (!this._hasFiles(event.dataTransfer)) { return; }
			event.preventDefault();
			this._attachments.addFromDataTransfer(event.dataTransfer);
			this._prompt.focus();
		}));
		// Ctrl/Cmd+Shift+Backspace aborts the run (the removed chat webview). On the card rather than
		// the window: a global listener would fire from any editor while the chat is merely open.
		this._register(addDisposableListener(this._dock, 'keydown', event => {
			const standard = new StandardKeyboardEvent(event);
			if (this._busy && standard.keyCode === KeyCode.Backspace && standard.shiftKey && (standard.ctrlKey || standard.metaKey)) {
				standard.preventDefault();
				this._onDidRequestStop.fire();
			}
		}));
		this._applyVoiceMode();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openide.agent.voiceMode')) { this._applyVoiceMode(); }
		}));
		// The card, not the textarea, carries the focus ring: it is the whole control the user sees.
		this._register(addDisposableListener(this._prompt, 'focus', () => this._card.classList.add('focused')));
		this._register(addDisposableListener(this._prompt, 'blur', () => this._card.classList.remove('focused')));

		this._autosize();
		this._measure();
	}

	/**
	 * Enter sends, Shift+Enter opens a line. The textarea would otherwise swallow both, and the
	 * modifier split is the one keyboard convention every chat surface in the IDE already uses.
	 */
	private _onKeyDown(event: KeyboardEvent): void {
		// With an autocomplete open the keyboard navigates the menu, never sends (the removed chat webview).
		if (this._suggest.handleKeyDown(event)) {
			return;
		}
		const standard = new StandardKeyboardEvent(event);
		if (standard.keyCode === KeyCode.Escape) {
			this._suggest.close();
			this._controls.closeMenus();
			return;
		}
		if (standard.keyCode !== KeyCode.Enter || standard.shiftKey || standard.altKey || standard.metaKey || standard.ctrlKey) {
			return;
		}
		standard.preventDefault();
		standard.stopPropagation();
		this._submit();
	}

	/** Sends what the composer holds, as if the user pressed Enter (canvas prompts use this). */
	submit(): void {
		this._submit();
	}

	/** `send` (the removed chat webview): the same press sends, queues or stops, depending on state. */
	private _submit(): void {
		this._suggest.close();
		this._harvestLinks();
		const inputText = this._prompt.value.trim();
		const images = [...this._attachments.images];
		const references = [...this._chips.references];
		const capabilities = [...this._chips.capabilities];
		const links = [...this._chips.links];
		const snippets = [...this._chips.snippets];
		const empty = !inputText && !images.length && !references.length && !capabilities.length && !links.length && !snippets.length;
		if (this._busy) {
			// Content while a run is in flight is QUEUED; an empty press is a stop.
			if (empty) {
				this._onDidRequestStop.fire();
				return;
			}
			// `openide.chat.queue.enabled: false`: nothing is silently parked — the text stays in the
			// composer and the notice says why, so the user chooses between waiting and stopping.
			if (this.configurationService.getValue(OPENIDE_CHAT_QUEUE_ENABLED_KEY) === false) {
				this._onDidReject.fire(queueDisabledMessage());
				return;
			}
			const entry: IComposerQueueEntry = {
				inputText, images, references, capabilities, links, snippets,
				mode: this._controls.mode,
				providerId: this.agentService.getActiveProviderId(),
				modelId: this.agentService.getModel(),
			};
			if (!this._queue.push(entry)) {
				this._onDidReject.fire(queueFullMessage());
				return;
			}
			this._clearInput();
			return;
		}
		if (empty) {
			// A pick alone is not a message. The chip stays: the element the user pointed at is still
			// what they are about to write about, and dropping it here would silently discard it.
			return;
		}
		// A bare `/compact` is a local action on the history, not a turn (the removed chat webview).
		// With anything else attached it travels as a turn and the controller compacts first.
		if (inputText.toLowerCase() === `/${COMPACT_COMMAND.slug}` && !images.length && !references.length && !links.length && !snippets.length
			&& !capabilities.some(capability => capability.name !== COMPACT_COMMAND.slug)) {
			this._clearInput();
			this._onDidRequestCompact.fire();
			return;
		}
		const entry: IComposerQueueEntry = {
			inputText, images, references, capabilities, links, snippets,
			mode: this._controls.mode,
			providerId: this.agentService.getActiveProviderId(),
			modelId: this.agentService.getModel(),
		};
		// Cleared optimistically and handed back by the caller when the turn is rejected, so the
		// common path never makes the user watch their message sit there.
		this._clearInput();
		this._dispatch(entry);
	}

	/** Hands a turn over. The pick is taken here so a queued entry also carries it when it fires. */
	private _dispatch(entry: IComposerQueueEntry): void {
		const payload = composerPayload(entry.inputText, entry.capabilities, entry.links);
		const pick = this._pick.take();
		const snippets = entry.snippets ?? [];
		const displayText = payload.displayText;
		// Snapshot BEFORE the turn is handed over: it belongs to the target the user saw when they
		// pressed Send, even if the picker moves while the run is being assembled.
		this._onDidSubmit.fire({
			text: payload.text,
			displayText: displayText && displayText !== payload.text ? displayText : undefined,
			inputText: entry.inputText,
			images: entry.images,
			references: entry.references.map(reference => reference.path),
			referenceChips: entry.references,
			capabilities: entry.capabilities,
			links: entry.links,
			pick,
			snippets,
			mode: entry.mode,
			providerId: entry.providerId,
			modelId: entry.modelId,
		});
	}

	/** Edit from the queue tray: the entry comes back whole (the removed chat webview). */
	private _editQueued(entry: IComposerQueueEntry): void {
		this._controls.setMode(entry.mode);
		this.value = entry.inputText;
		this._attachments.restore(entry.images);
		this._chips.restore(entry.references, entry.capabilities, entry.links, entry.snippets ?? []);
		this._syncContent();
		this._measure();
		this._prompt.focus();
	}

	private _clearInput(): void {
		this._prompt.value = '';
		this._attachments.clear();
		this._chips.clear();
		this._autosize();
		this._syncContent();
	}

	/**
	 * Puts a rejected turn back exactly as it was handed over.
	 *
	 * `value` alone was not enough once the composer started clearing more than the text: a turn the
	 * controller refuses (a rollback holding the barrier) used to come back as bare text, with the
	 * user's images and their Pick & Polish selection gone for good.
	 */
	restore(submit: IOpenideComposerSubmit): void {
		this.value = submit.inputText ?? submit.text;
		this._attachments.restore(submit.images);
		this._chips.restore(
			submit.referenceChips ?? submit.references.map(path => ({ path })),
			submit.capabilities,
			submit.links ?? [],
			submit.snippets ?? [],
		);
		this._pick.restore(submit.pick);
		this._syncContent();
		this._measure();
	}

	/**
	 * The conversation the queue belongs to. Called by the widget on restore and on every switch;
	 * the queue of the conversation being left stays persisted for when it comes back.
	 */
	setConversation(id: string | undefined): void {
		this._queue.setConversation(id);
	}

	/** Pending messages of the visible conversation. */
	get queueLength(): number {
		return this._queue.length;
	}

	/** URLs left in the text at send time become chips too (`harvestPromptLinks`, the removed chat webview). */
	private _harvestLinks(): void {
		const parsed = extractComposerLinks(this._prompt.value);
		if (!parsed.links.length) { return; }
		this._prompt.value = parsed.text.trim();
		this._chips.addLinks(parsed.links);
		this._autosize();
	}

	/** True when the pasted text is nothing but URLs and whitespace. */
	private _isBareLinks(text: string): boolean {
		const parsed = extractComposerLinks(text);
		return parsed.links.length > 0 && !parsed.text.trim();
	}

	private _insertAtCaret(text: string): void {
		const start = this._prompt.selectionStart ?? this._prompt.value.length;
		const end = this._prompt.selectionEnd ?? start;
		const value = this._prompt.value;
		this._prompt.value = value.slice(0, start) + text + value.slice(end);
		const caret = start + text.length;
		this._prompt.setSelectionRange(caret, caret);
		this._autosize();
		this._syncContent();
	}

	private _hasFiles(data: DataTransfer | null): boolean {
		return !!data && Array.from(data.types ?? []).includes('Files');
	}

	private _applyVoiceMode(): void {
		const mode: VoiceMode = this.configurationService.getValue('openide.agent.voiceMode') === 'holdToTalk' ? 'holdToTalk' : 'toggle';
		this._controls.setVoiceMode(mode);
	}

	/** Dictation appends to whatever is already typed instead of replacing it. */
	private _appendTranscription(text: string): void {
		const clean = text.trim();
		if (!clean) {
			return;
		}
		const current = this._prompt.value;
		this._prompt.value = current && !current.endsWith(' ') ? `${current} ${clean}` : `${current}${clean}`;
		this._autosize();
		this._syncContent();
		this._prompt.focus();
	}

	private _reportVoiceFailure(message: string): void {
		// Reported and not swallowed: a microphone that silently does nothing reads as a broken
		// button, and the reason (no permission, provider without dictation) is actionable.
		this._onDidFailVoice.fire(message);
	}

	/** Flips the single slot between send and stop; two buttons would leave a dead one on screen. */
	setBusy(busy: boolean): void {
		if (this._busy === busy) {
			return;
		}
		this._busy = busy;
		this._controls.setBusy(busy);
		// The working border beam (upstream's `.chat-input-container.working`): the whole card says
		// a turn is in flight, not just the stop button.
		this._block.classList.toggle('working', busy);
		if (!busy) {
			this._drainQueue();
		}
	}

	/** `drainQueue` (the removed chat webview): the run ended, the next pending message goes out. */
	private _drainQueue(): void {
		if (this._busy) { return; }
		const entry = this._queue.shift();
		if (entry) {
			this._dispatch(entry);
		}
	}

	setMode(mode: AgentMode): void {
		this._controls.setMode(mode);
	}

	private _syncContent(): void {
		// The strips report through this callback from inside their constructors, before the
		// control row exists; the row reads the state itself once it is built.
		const controls = this._controls as OpenideChatComposerControls | undefined;
		if (!controls) { return; }
		controls.setHasContent(!!this._prompt.value.trim() || !this._attachments.isEmpty || !this._chips.isEmpty);
	}

	/**
	 * Keeps `.scrolling` on for a beat after each scroll, so the skinned thumb (openideChatComposer
	 * .css) is visible while the wheel or the caret is moving the field and fades out again once it
	 * settles — hover alone would leave a keyboard-driven scroll with no scrollbar at all.
	 */
	private _armScrollIndicator(): void {
		this._prompt.classList.add('scrolling');
		this._scrollIdle.schedule();
	}

	private _autosize(): void {
		// Reset first: without it the field only ever grows, because `scrollHeight` of an element
		// that is already tall enough never shrinks back.
		this._prompt.style.height = 'auto';
		const contentHeight = this._prompt.scrollHeight;
		// A host may cap the field lower through CSS (`max-height` on the prompt): the inline editor
		// of a request keeps the edit short and fades the overflow instead of growing into the
		// transcript. The stylesheet decides the ceiling; this only honours it.
		const cssMax = parseFloat(getComputedStyle(this._prompt).maxHeight);
		const maxHeight = Number.isFinite(cssMax) && cssMax > 0 ? Math.min(PROMPT_MAX_HEIGHT, cssMax) : PROMPT_MAX_HEIGHT;
		this._prompt.style.height = `${Math.min(maxHeight, contentHeight)}px`;
		// The scrollbar exists only once the field hit its ceiling; below it the box always fits
		// its content and `overflow: auto` would flash the OS scrollbar on rounding artifacts.
		this._prompt.classList.toggle('scrollable', contentHeight > maxHeight);
		this._measure();
	}

	focus(): void {
		this._prompt.focus();
	}

	/**
	 * An editor selection sent to the chat (Continue's "Add to Chat"): one more chip above the
	 * prompt, never text in it. The limit is said out loud, like a full `@` strip.
	 */
	addSnippet(snippet: IComposerSnippet): boolean {
		if (!this._chips.addSnippet(snippet)) {
			this._onDidReject.fire(t('chat.snippet.limit', String(SNIPPET_LIMIT)));
			return false;
		}
		this._syncContent();
		this._measure();
		return true;
	}

	hasFocus(): boolean {
		return this._prompt.ownerDocument.activeElement === this._prompt;
	}

	/**
	 * Re-measures after a width change: the wrapped height of the text depends on the dock's width,
	 * and a narrower dock would otherwise keep the old height.
	 */
	/** Upstream `ChatInputPart#_updateWorkingProgressAnimationDuration`: sub-linear in width, so the comet's travel speed stays roughly constant. */
	private _lastAnimDurationS: number | undefined;
	private _updateWorkingAnimationDuration(width: number): void {
		const raw = 0.55 + 0.075 * Math.sqrt(Math.max(50, width));
		const duration = Math.min(2.5, Math.max(1.4, raw));
		if (this._lastAnimDurationS !== undefined && Math.abs(this._lastAnimDurationS - duration) < 0.05) {
			return;
		}
		this._lastAnimDurationS = duration;
		this._block.style.setProperty('--openide-chat-anim-duration', `${duration.toFixed(2)}s`);
	}

	layout(_width: number): void {
		this._updateWorkingAnimationDuration(this._block.clientWidth || _width);
		this._autosize();
	}

	/**
	 * Re-measures after something MOUNTED INSIDE the dock changed height — the trays that stack
	 * under the input card.
	 *
	 * Public because those trays are owned by the widget, not by the composer, and yet they live in
	 * `trayHost`, which is inside the dock this measures. Before this existed the widget compensated
	 * by subtracting the files tray's height in its own layout, on top of a `composer.height` that
	 * already contained it: the tray was counted twice from the first keystroke after it appeared
	 * (the keystroke is what re-ran `_autosize` and refreshed the stale observable), which left a
	 * tray-sized gap under the transcript. One measurement of one box is the fix.
	 */
	remeasure(): void {
		this._measure();
	}

	private _measure(): void {
		const height = getTotalHeight(this._dock);
		if (height > 0) {
			this._height.set(height, undefined);
		}
	}
}
