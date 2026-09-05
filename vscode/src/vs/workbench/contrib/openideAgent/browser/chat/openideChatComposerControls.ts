/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { AgentMode } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { applyProviderIcon } from '../openideProviderIcons.js';
import { createThinkingGlyph, reasoningControlVisible, reasoningEffortChipLabel } from './openideChatReasoning.js';
import { OpenideChatModePicker, agentModeEntry } from './openideChatModePicker.js';
import { OpenideChatModelPicker } from './openideChatModelPicker.js';
import { IOpenideChatModelRoute } from './openideChatController.js';
import { describeCooldown } from '../../common/openideModelHealth.js';
import { OpenideChatComposerVoice, VoiceState } from './openideChatComposerVoice.js';
import { IOpenideChatTooltip, setupChatTooltip } from './openideChatHover.js';
import { createCodicon } from './openideComposerMenu.js';
import { createArrowUpIcon, createPaperclipIcon } from './openideChatIcons.js';
import { t } from '../../common/openideStrings.js';

export type VoiceMode = 'toggle' | 'holdToTalk';

export interface IComposerActions {
	readonly send: () => void;
	readonly stop: () => void;
	readonly attach: () => void;
}

function createTrigger(parent: HTMLElement, className: string, shrink = false): { anchor: HTMLElement; button: HTMLButtonElement; label: HTMLElement } {
	const document = parent.ownerDocument;
	const anchor = append(parent, document.createElement('span'));
	anchor.className = `openide-composer-anchor${shrink ? ' openide-composer-anchor-shrink' : ''}`;
	const button = append(anchor, document.createElement('button'));
	button.type = 'button';
	button.className = `openide-composer-trigger ${className}`;
	const label = document.createElement('span');
	label.className = 'openide-composer-trigger-label';
	return { anchor, button, label };
}

/**
 * A control-row icon. It carries no `title=`: the tip is the workbench hover, and it reads the
 * button's accessible name when shown, so repainting a label only rewrites `aria-label`.
 */
function createUtilButton(hoverService: IHoverService, parent: HTMLElement, className: string, icon: string, tooltip: () => string): { readonly button: HTMLButtonElement; readonly tooltip: IOpenideChatTooltip } {
	const button = append(parent, parent.ownerDocument.createElement('button'));
	button.type = 'button';
	button.className = `openide-composer-util ${className}`;
	button.appendChild(createCodicon(parent.ownerDocument, icon));
	return { button, tooltip: setupChatTooltip(hoverService, button, tooltip) };
}

/**
 * The composer's control row: mode, model, reasoning effort, follow, attach, dictation and send.
 *
 * It owns the three popovers and the painting of their triggers, and nothing about the text. The
 * split exists because the row is the part that has to answer to the SERVICE (connected provider,
 * published reasoning levels, dictation capability) while the composer above it only answers to
 * what the user typed.
 */
export class OpenideChatComposerControls extends Disposable {

	private readonly _modePicker: OpenideChatModePicker;
	private readonly _modelPicker: OpenideChatModelPicker;
	/** Set while a turn of the VISIBLE conversation runs somewhere other than the chosen model. */
	private _modelRoute: IOpenideChatModelRoute | undefined;
	/** See `_warmModelCatalog`. */
	private _catalogWarmed = false;

	private readonly _modeButton: HTMLButtonElement;
	private readonly _modeIcon: HTMLElement;
	private readonly _modeLabel: HTMLElement;
	private readonly _modelButton: HTMLButtonElement;
	private readonly _modelIcon: HTMLElement;
	private readonly _modelLabel: HTMLElement;
	/** The active model's reasoning level, worn by the model chip. Hidden when it has none. */
	private readonly _modelEffort: HTMLElement;
	private readonly _modelEffortLabel: HTMLElement;
	private readonly _followButton: HTMLButtonElement;
	private readonly _micButton: HTMLButtonElement;
	private readonly _voiceStatus: HTMLElement;
	private readonly _sendButton: HTMLButtonElement;
	/**
	 * The tips whose text depends on state, kept so a repaint can re-read them. The hover itself
	 * always resolves late; these only exist to keep the accessible name on the same string.
	 */
	private readonly _modeTooltip: IOpenideChatTooltip;
	private readonly _followTooltip: IOpenideChatTooltip;
	private readonly _micTooltip: IOpenideChatTooltip;
	private readonly _sendTooltip: IOpenideChatTooltip;

	private _busy = false;
	private _hasContent = false;
	private _voiceMode: VoiceMode = 'toggle';
	private _voiceState: VoiceState = 'idle';
	private _holding = false;
	/** Guards the async parts of a repaint against a newer one that started meanwhile. */
	private _refreshGeneration = 0;

	get mode(): AgentMode { return this._modePicker.mode; }

	constructor(
		row: HTMLElement,
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		private readonly commandService: ICommandService,
		hoverService: IHoverService,
		private readonly voice: OpenideChatComposerVoice,
		private readonly actions: IComposerActions,
	) {
		super();
		const document = row.ownerDocument;

		this._modePicker = this._register(new OpenideChatModePicker(agentService, contextViewService, () => this._paintMode()));
		this._modelPicker = this._register(new OpenideChatModelPicker(agentService, contextViewService, commandService, () => this.refresh()));

		const mode = createTrigger(row, 'openide-composer-mode');
		this._modeButton = mode.button;
		this._modeIcon = append(mode.button, createCodicon(document, 'openide-mode-agent', 'codicon-filled'));
		this._modeLabel = append(mode.button, mode.label);
		mode.button.appendChild(createCodicon(document, 'chevron-down', 'openide-composer-chevron'));
		this._modeTooltip = this._register(setupChatTooltip(hoverService, this._modeButton, () => t('chat.tip.mode', agentModeEntry(this._modePicker.mode).label)));
		this._register(addDisposableListener(mode.button, 'click', () => this._modePicker.toggle(mode.button)));

		const model = createTrigger(row, 'openide-composer-model', true);
		this._modelButton = model.button;
		this._modelButton.classList.add('unset');
		this._register(setupChatTooltip(hoverService, this._modelButton, () => this._modelRouteTooltip() ?? t('chat.tip.model')));
		this._modelIcon = append(model.button, document.createElement('span'));
		this._modelIcon.className = 'openide-composer-provider-icon';
		this._modelIcon.hidden = true;
		this._modelLabel = append(model.button, model.label);
		this._modelLabel.textContent = t('chatSurface.model.unset');
		// The level rides on the model chip instead of on a control of its own. The effort belongs
		// to a model now (`getReasoningEffort(providerId, model)`) and is edited on that model's row
		// in the picker, so a second trigger here would have been a second way into one setting —
		// and one more thing for a narrow dock to push off its own edge.
		this._modelEffort = append(model.button, document.createElement('span'));
		this._modelEffort.className = 'openide-composer-model-effort';
		this._modelEffort.hidden = true;
		this._modelEffort.appendChild(createThinkingGlyph(document));
		this._modelEffortLabel = append(this._modelEffort, document.createElement('span'));
		model.button.appendChild(createCodicon(document, 'chevron-down', 'openide-composer-chevron'));
		this._register(addDisposableListener(model.button, 'click', () => this._modelPicker.toggle(model.button)));

		const spacer = append(row, document.createElement('span'));
		spacer.className = 'openide-composer-spacer';

		// "Zen mode", not the sentence this used to carry: it is a toggle the user reaches for
		// constantly, and a tip that takes a second to read is a tip that gets in the way.
		const follow = createUtilButton(hoverService, row, 'openide-composer-follow', 'target', () => t(this.agentService.isPlanFollowEnabled() ? 'chat.tip.zenOff' : 'chat.tip.zen'));
		this._followButton = follow.button;
		this._followTooltip = this._register(follow.tooltip);
		this._register(addDisposableListener(this._followButton, 'click', () => {
			this.agentService.setPlanFollowEnabled(!this.agentService.isPlanFollowEnabled());
			this._paintFollow();
		}));
		this._register(this.agentService.onDidChangePlanFollow(() => this._paintFollow()));

		const attach = createUtilButton(hoverService, row, 'openide-composer-attach', 'attach', () => t('chat.tip.attach'));
		// Cursor's paperclip, not the codicon: the glyph is the one thing on this row the user
		// compares with the other editor side by side.
		attach.button.replaceChildren(createPaperclipIcon(document));
		this._register(attach.tooltip);
		this._register(addDisposableListener(attach.button, 'click', () => this.actions.attach()));

		const mic = createUtilButton(hoverService, row, 'openide-composer-mic', 'mic-filled', () => this._voiceLabel());
		this._micButton = mic.button;
		this._micTooltip = this._register(mic.tooltip);
		this._voiceStatus = document.createElement('div');
		this._voiceStatus.className = 'openide-composer-voice-status';
		this._voiceStatus.setAttribute('role', 'status');
		this._voiceStatus.setAttribute('aria-live', 'polite');
		this._voiceStatus.hidden = true;
		row.before(this._voiceStatus);
		// Toggle vs hold-to-talk (the removed chat webview): the click only counts in toggle mode,
		// and the pointer pair only in hold mode, so a setting change mid-session never double-fires.
		this._register(addDisposableListener(this._micButton, 'click', (event: MouseEvent) => {
			// Dictation off: `toggle()` returns in silence, which is how this button spent its life
			// looking broken. The reason is already in the tooltip; the click is the way to fix it.
			if (!this.voice.capability.available) {
				void this.commandService.executeCommand('openide.agent.openVoiceSettings');
				return;
			}
			if (this._voiceMode === 'toggle' || event.detail === 0) { this.voice.toggle(); }
		}));
		this._register(addDisposableListener(this._micButton, 'pointerdown', (event: PointerEvent) => {
			if (event.button !== 0 || this._voiceMode !== 'holdToTalk' || !this.voice.capability.available) { return; }
			event.preventDefault();
			this._holding = this.voice.beginHold();
		}));
		const release = () => {
			if (!this._holding) { return; }
			this._holding = false;
			this.voice.endHold();
		};
		this._register(addDisposableListener(this._micButton, 'pointerup', release));
		this._register(addDisposableListener(this._micButton, 'pointerleave', release));
		this._register(addDisposableListener(this._micButton, 'pointercancel', release));
		this._register(addDisposableListener(this._micButton, 'blur', release));
		this._register(addDisposableListener(this._micButton, 'keydown', (event: KeyboardEvent) => {
			if (this._voiceMode !== 'holdToTalk' || !this.voice.capability.available || (event.key !== ' ' && event.key !== 'Enter')) { return; }
			event.preventDefault();
			if (!event.repeat) { this._holding = this.voice.beginHold(); }
		}));
		this._register(addDisposableListener(this._micButton, 'keyup', (event: KeyboardEvent) => {
			if (this._voiceMode !== 'holdToTalk' || (event.key !== ' ' && event.key !== 'Enter')) { return; }
			event.preventDefault();
			release();
		}));

		this._sendButton = append(row, document.createElement('button'));
		this._sendButton.type = 'button';
		this._sendButton.className = 'openide-composer-send';
		this._sendTooltip = this._register(setupChatTooltip(hoverService, this._sendButton, () => t(this._busy ? 'chat.tip.stop' : 'chat.tip.send')));
		this._sendButton.appendChild(createArrowUpIcon(document));
		this._register(addDisposableListener(this._sendButton, 'click', () => {
			if (this._busy) { this.actions.stop(); } else { this.actions.send(); }
		}));

		// Model, connectivity and reasoning all change from OUTSIDE the chat (settings, sign-in),
		// and the row is the only place that shows them.
		this._register(this.agentService.onDidChange(() => this.refresh()));

		this._paintMode();
		this._paintFollow();
		this._updateSlot();
		this.refresh();
	}

	setBusy(busy: boolean): void {
		if (this._busy === busy) {
			return;
		}
		this._busy = busy;
		this._paintSend();
		this._updateSlot();
	}

	/** Text, attachments or capabilities: anything that makes the turn sendable. */
	setHasContent(hasContent: boolean): void {
		if (this._hasContent === hasContent) {
			return;
		}
		this._hasContent = hasContent;
		this._updateSlot();
	}

	setMode(mode: AgentMode): void {
		this._modePicker.setMode(mode);
	}

	/** `openide.agent.voiceMode`: how the microphone button is operated. */
	setVoiceMode(mode: VoiceMode): void {
		if (this._voiceMode === mode) { return; }
		if (this._holding) { this._holding = false; this.voice.endHold(); }
		this._voiceMode = mode;
		this._micTooltip.update();
	}

	closeMenus(): void {
		this._modePicker.close();
		this._modelPicker.close();
	}

	/** Repaints the mic from the recorder's own state machine. */
	applyVoiceState(state: VoiceState): void {
		this._voiceState = state;
		this._micButton.classList.toggle('rec', state === 'recording');
		this._micButton.classList.toggle('busy', state === 'busy' || state === 'starting');
		this._micButton.disabled = state === 'busy';
		this._micButton.setAttribute('aria-busy', String(state === 'busy' || state === 'starting'));
		this._micButton.setAttribute('aria-pressed', String(state === 'recording'));
		this._micButton.replaceChildren(createCodicon(this._micButton.ownerDocument,
			state === 'recording' ? 'primitive-square' : state === 'busy' || state === 'starting' ? 'loading' : 'mic-filled'));
		this._micButton.firstElementChild?.classList.toggle('codicon-modifier-spin', state === 'busy' || state === 'starting');
		this._voiceStatus.hidden = state === 'idle';
		this._voiceStatus.classList.toggle('recording', state === 'recording');
		this._voiceStatus.textContent = state === 'recording' ? t('chatSurface.voice.listening') : this._voiceLabel();
		this._micTooltip.update();
		this._updateSlot();
	}

	/** What the microphone is doing right now, in the language the IDE is in right now. */
	/**
	 * What the microphone says about itself.
	 *
	 * While it is doing something the state is the whole answer. At rest it also names the model
	 * that will hear -- the dictation model is chosen in Settings and can differ from the model
	 * answering in the chat, so a tooltip that only said "Dictate" left the user with no way to
	 * know which of the two was about to be billed. When dictation is off it says WHY, and the
	 * click (see the handler above) goes to the page that fixes it.
	 */
	private _voiceLabel(): string {
		if (this._voiceState === 'recording') { return this._voiceMode === 'holdToTalk' ? t('chat.voice.release') : t('chat.voice.stop'); }
		if (this._voiceState === 'busy') { return t('chat.voice.transcribing'); }
		if (this._voiceState === 'starting') { return t('chat.voice.preparing'); }
		const base = this._voiceMode === 'holdToTalk' ? t('chat.voice.hold') : t('chat.voice.dictate');
		const capability = this.voice.capability;
		if (!capability.available) {
			return `${capability.reason ?? t('chatSurface.voice.unsupported')} — ${t('chatSurface.voice.configure')}`;
		}
		return capability.providerLabel && capability.model
			? t('chatSurface.voice.usingModel', base, capability.providerLabel, capability.model)
			: base;
	}

	/**
	 * The turn in flight is not running on the model the chip names.
	 *
	 * The chip keeps saying what the user chose — the choice did not change, and it comes back on
	 * its own when the cooldown expires — with the model actually answering after an arrow. Upstream
	 * draws the same distinction in state rather than pixels (`IIntendedModelSelection`); here it
	 * has to be visible, because a chip that names a model which is not answering is a lie the user
	 * acts on.
	 */
	setModelRoute(route: IOpenideChatModelRoute | undefined): void {
		if (this._modelRoute?.model === route?.model && this._modelRoute?.reason === route?.reason) {
			return;
		}
		this._modelRoute = route;
		this.refresh();
	}

	refresh(): void {
		void this._refreshAsync();
		this._warmModelCatalog();
	}

	/**
	 * The model registry is loaded lazily, and until it answers, `getModelReasoning` says "unknown"
	 * — which `reasoningControlVisible` reads as "no reasoning control". The row paints once when
	 * the dock mounts, so on a cold registry the thinking chip simply never appeared: the only way
	 * to get it was to OPEN the model picker, because `getConnectedModelGroups` awaits the registry
	 * and the pick repaints the row afterwards. That is the bug — the chip depended on having gone
	 * shopping for a model. Warm it once and repaint with the answer.
	 *
	 * One-shot: `_refreshAsync` is what calls `refresh`'s siblings, so without the flag the repaint
	 * would warm again and recurse.
	 */
	private _warmModelCatalog(): void {
		if (this._catalogWarmed) {
			return;
		}
		this._catalogWarmed = true;
		void this.agentService.ensureModelCatalog().then(() => {
			if (!this._store.isDisposed) {
				void this._refreshAsync();
			}
		}, () => { /* no registry (cold cache, no network): the row keeps its fallbacks */ });
	}

	private async _refreshAsync(): Promise<void> {
		const generation = ++this._refreshGeneration;
		const providerId = this.agentService.getActiveProviderId();
		const entry = this.agentService.findProvider(providerId);
		const model = this.agentService.getModel() || entry?.defaultModel || '';
		let connected = false;
		try {
			connected = await this.agentService.isConnected(providerId);
		} catch {
			connected = false;
		}
		await this.voice.refreshCapability();
		if (generation !== this._refreshGeneration) {
			return; // a newer repaint already owns the row
		}
		// The composer shows the same friendly name as the picker, never the raw id.
		const described = model ? this.agentService.describeModel(providerId, model) : undefined;
		const chosen = connected
			? (described?.name || model || entry?.label || t('chatSurface.model.fallback'))
			: t('chatSurface.model.unset');
		const route = this._modelRoute;
		const running = route ? (this.agentService.describeModel(route.providerId, route.model)?.name || route.model) : undefined;
		this._modelLabel.textContent = running ? `${chosen} → ${running}` : chosen;
		this._modelButton.classList.toggle('rerouted', !!running);
		this._modelButton.classList.toggle('unset', !connected);
		this._modelIcon.hidden = !connected;
		applyProviderIcon(this._modelIcon, providerId, entry?.label ?? '');
		this._modelIcon.classList.add('openide-composer-provider-icon');

		// Spelled out whenever the model reasons at all, its own default included: this is the only
		// place the level is VISIBLE without opening a menu, and "nothing shown" was indistinguishable
		// from "this model does not think". The picker's rows are the opposite case — twenty rows
		// each saying "Model default" is noise — so they stay silent until a level is chosen.
		const reasoning = this.agentService.getModelReasoning(providerId, model);
		const hasEffort = reasoningControlVisible(connected, reasoning);
		this._modelEffort.hidden = !hasEffort;
		this._modelEffortLabel.textContent = hasEffort ? reasoningEffortChipLabel(this.agentService.getReasoningEffort(providerId, model)) : '';
		// The mic tooltip names the dictation model, which `refreshCapability` may have just changed.
		this._micTooltip.update();
		this._updateSlot();
	}

	/** Why the chip shows two models: which one is out, and until when. */
	private _modelRouteTooltip(): string | undefined {
		const route = this._modelRoute;
		if (!route) {
			return undefined;
		}
		const intended = this.agentService.describeModel(route.intendedProviderId, route.intendedModel)?.name || route.intendedModel;
		return route.reason === 'cooldown' && route.until
			? t('chat.tip.modelCooldown', intended, describeCooldown(route.until, Date.now()))
			: t('chat.tip.modelFailover', intended);
	}

	private _paintMode(): void {
		const entry = agentModeEntry(this._modePicker.mode);
		// `codicon-filled` is the product's own weight for these glyphs; the class list is rebuilt
		// wholesale because the previous mode's glyph class has to go with it.
		this._modeIcon.className = `codicon codicon-filled codicon-${entry.icon}`;
		this._modeLabel.textContent = entry.label;
		this._modeTooltip.update();
	}

	private _paintFollow(): void {
		const enabled = this.agentService.isPlanFollowEnabled();
		this._followButton.classList.toggle('active', enabled);
		this._followButton.setAttribute('aria-pressed', String(enabled));
		this._followTooltip.update();
	}

	private _paintSend(): void {
		const document = this._sendButton.ownerDocument;
		clearNode(this._sendButton);
		this._sendButton.classList.toggle('running', this._busy);
		if (this._busy) {
			const square = append(this._sendButton, document.createElement('span'));
			square.className = 'openide-stop-square';
		} else {
			this._sendButton.appendChild(createArrowUpIcon(document));
		}
		this._sendTooltip.update();
	}

	/** Share one action slot: microphone when empty, Send for a draft, Stop during a run. */
	private _updateSlot(): void {
		const voiceState = this.voice.state;
		let showSend = this._busy || this._hasContent;
		if (voiceState !== 'idle') {
			showSend = false;
		}
		this._sendButton.hidden = !showSend;
		this._sendButton.disabled = !this._busy && !this._hasContent;
		this._micButton.hidden = showSend;
		this._micButton.classList.toggle('unavailable', !this.voice.capability.available && voiceState === 'idle');
	}
}
