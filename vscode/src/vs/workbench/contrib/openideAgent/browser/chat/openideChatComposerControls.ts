/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { AgentMode } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { applyProviderIcon } from '../openideProviderIcons.js';
import { createThinkingGlyph, OpenideChatEffortPicker, reasoningControlVisible, reasoningEffortLabel } from './openideChatEffortPicker.js';
import { OpenideChatModePicker, agentModeEntry } from './openideChatModePicker.js';
import { OpenideChatModelPicker } from './openideChatModelPicker.js';
import { OpenideChatComposerVoice, VoiceState } from './openideChatComposerVoice.js';
import { createCodicon } from './openideComposerMenu.js';
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

function createUtilButton(parent: HTMLElement, className: string, icon: string, tooltip: string): HTMLButtonElement {
	const button = append(parent, parent.ownerDocument.createElement('button'));
	button.type = 'button';
	button.className = `openide-composer-util ${className}`;
	button.title = tooltip;
	button.setAttribute('aria-label', tooltip);
	button.appendChild(createCodicon(parent.ownerDocument, icon));
	return button;
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
	private readonly _effortPicker: OpenideChatEffortPicker;

	private readonly _modeButton: HTMLButtonElement;
	private readonly _modeIcon: HTMLElement;
	private readonly _modeLabel: HTMLElement;
	private readonly _modelButton: HTMLButtonElement;
	private readonly _modelIcon: HTMLElement;
	private readonly _modelLabel: HTMLElement;
	private readonly _effortAnchor: HTMLElement;
	private readonly _effortButton: HTMLButtonElement;
	private readonly _effortLabel: HTMLElement;
	private readonly _followButton: HTMLButtonElement;
	private readonly _micButton: HTMLButtonElement;
	private readonly _sendButton: HTMLButtonElement;

	private _busy = false;
	private _hasContent = false;
	private _voiceMode: VoiceMode = 'toggle';
	private _holding = false;
	/** Guards the async parts of a repaint against a newer one that started meanwhile. */
	private _refreshGeneration = 0;

	get mode(): AgentMode { return this._modePicker.mode; }

	constructor(
		row: HTMLElement,
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		commandService: ICommandService,
		private readonly voice: OpenideChatComposerVoice,
		private readonly actions: IComposerActions,
	) {
		super();
		const document = row.ownerDocument;

		this._modePicker = this._register(new OpenideChatModePicker(agentService, contextViewService, () => this._paintMode()));
		this._modelPicker = this._register(new OpenideChatModelPicker(agentService, contextViewService, commandService, () => this.refresh()));
		this._effortPicker = this._register(new OpenideChatEffortPicker(agentService, contextViewService, () => this.refresh()));

		const mode = createTrigger(row, 'openide-composer-mode');
		this._modeButton = mode.button;
		this._modeIcon = append(mode.button, createCodicon(document, 'openide-mode-agent', 'codicon-filled'));
		this._modeLabel = append(mode.button, mode.label);
		mode.button.appendChild(createCodicon(document, 'chevron-down', 'openide-composer-chevron'));
		this._register(addDisposableListener(mode.button, 'click', () => this._modePicker.toggle(mode.button)));

		const model = createTrigger(row, 'openide-composer-model', true);
		this._modelButton = model.button;
		this._modelButton.classList.add('unset');
		this._modelButton.title = localize('openide.chat.model.tip', "Modelo / proveedor");
		this._modelIcon = append(model.button, document.createElement('span'));
		this._modelIcon.className = 'openide-composer-provider-icon';
		this._modelIcon.hidden = true;
		this._modelLabel = append(model.button, model.label);
		this._modelLabel.textContent = localize('openide.chat.model.unset', "Seleccionar modelo");
		model.button.appendChild(createCodicon(document, 'chevron-down', 'openide-composer-chevron'));
		this._register(addDisposableListener(model.button, 'click', () => this._modelPicker.toggle(model.button)));

		const effort = createTrigger(row, 'openide-composer-effort');
		this._effortAnchor = effort.anchor;
		this._effortAnchor.hidden = true;
		this._effortButton = effort.button;
		this._effortButton.appendChild(createThinkingGlyph(document));
		this._effortLabel = append(effort.button, effort.label);
		this._register(addDisposableListener(effort.button, 'click', () => this._effortPicker.toggle(effort.button)));

		const spacer = append(row, document.createElement('span'));
		spacer.className = 'openide-composer-spacer';

		this._followButton = createUtilButton(row, 'openide-composer-follow', 'target', localize('openide.chat.follow', "Seguir al agente"));
		this._register(addDisposableListener(this._followButton, 'click', () => {
			this.agentService.setPlanFollowEnabled(!this.agentService.isPlanFollowEnabled());
			this._paintFollow();
		}));
		this._register(this.agentService.onDidChangePlanFollow(() => this._paintFollow()));

		const attach = createUtilButton(row, 'openide-composer-attach', 'attach', localize('openide.chat.attach', "Adjuntar imagen (o pegala con Ctrl+V)"));
		this._register(addDisposableListener(attach, 'click', () => this.actions.attach()));

		this._micButton = createUtilButton(row, 'openide-composer-mic', 'mic-filled', localize('openide.chat.voice.action', "Dictado por voz"));
		// Toggle vs hold-to-talk (openideChatHtml.ts:6017-6036): the click only counts in toggle mode,
		// and the pointer pair only in hold mode, so a setting change mid-session never double-fires.
		this._register(addDisposableListener(this._micButton, 'click', () => {
			if (this._voiceMode === 'toggle') { this.voice.toggle(); }
		}));
		this._register(addDisposableListener(this._micButton, 'pointerdown', (event: PointerEvent) => {
			if (this._voiceMode !== 'holdToTalk') { return; }
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

		this._sendButton = append(row, document.createElement('button'));
		this._sendButton.type = 'button';
		this._sendButton.className = 'openide-composer-send';
		this._sendButton.title = localize('openide.chat.send', "Send (Enter)");
		this._sendButton.appendChild(createCodicon(document, 'arrow-up'));
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
		this._paintMicTooltip(this.voice.state);
	}

	closeMenus(): void {
		this._modePicker.close();
		this._modelPicker.close();
		this._effortPicker.close();
	}

	/** Repaints the mic from the recorder's own state machine. */
	applyVoiceState(state: VoiceState): void {
		this._micButton.classList.toggle('rec', state === 'recording');
		this._micButton.classList.toggle('busy', state === 'busy' || state === 'starting');
		this._paintMicTooltip(state);
		this._updateSlot();
	}

	private _paintMicTooltip(state: VoiceState): void {
		const label = state === 'recording' ? (this._voiceMode === 'holdToTalk' ? t('chat.voice.release') : localize('openide.chat.voice.stop', "Parar y transcribir"))
			: state === 'busy' ? localize('openide.chat.voice.transcribing', "Transcribiendo…")
				: state === 'starting' ? t('chat.voice.preparing')
					: this._voiceMode === 'holdToTalk' ? t('chat.voice.hold')
						: localize('openide.chat.voice.action', "Dictado por voz");
		this._micButton.title = label;
		this._micButton.setAttribute('aria-label', label);
	}

	refresh(): void {
		void this._refreshAsync();
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
		this._modelLabel.textContent = connected
			? (described?.name || model || entry?.label || localize('openide.chat.model.fallback', "Modelo"))
			: localize('openide.chat.model.unset', "Seleccionar modelo");
		this._modelButton.classList.toggle('unset', !connected);
		this._modelIcon.hidden = !connected;
		applyProviderIcon(this._modelIcon, providerId, entry?.label ?? '');
		this._modelIcon.classList.add('openide-composer-provider-icon');

		const reasoning = this.agentService.getModelReasoning(providerId, model);
		this._effortPicker.setPublishedReasoning(reasoning);
		this._effortAnchor.hidden = !reasoningControlVisible(connected, reasoning);
		if (!this._effortAnchor.hidden) {
			const effort = this.agentService.getReasoningEffort() || '';
			this._effortLabel.textContent = reasoningEffortLabel(effort);
			this._effortButton.classList.toggle('unset', !effort);
			this._effortButton.title = `${localize('openide.chat.effort.section', "Razonamiento")} · ${this._effortPicker.options.length} ${localize('openide.chat.effort.levels', "niveles disponibles")}`;
		}
		this._updateSlot();
	}

	private _paintMode(): void {
		const entry = agentModeEntry(this._modePicker.mode);
		// `codicon-filled` is the product's own weight for these glyphs; the class list is rebuilt
		// wholesale because the previous mode's glyph class has to go with it.
		this._modeIcon.className = `codicon codicon-filled codicon-${entry.icon}`;
		this._modeLabel.textContent = entry.label;
		this._modeButton.title = `${entry.label} mode`;
	}

	private _paintFollow(): void {
		const enabled = this.agentService.isPlanFollowEnabled();
		this._followButton.classList.toggle('active', enabled);
		this._followButton.setAttribute('aria-pressed', String(enabled));
		const label = enabled
			? localize('openide.chat.follow.off', "Dejar de seguir al agente")
			: localize('openide.chat.follow.on', "Seguir al agente — muestra archivos, ediciones, terminal y browser mientras trabaja");
		this._followButton.title = label;
		this._followButton.setAttribute('aria-label', label);
	}

	private _paintSend(): void {
		const document = this._sendButton.ownerDocument;
		clearNode(this._sendButton);
		this._sendButton.classList.toggle('running', this._busy);
		if (this._busy) {
			const square = append(this._sendButton, document.createElement('span'));
			square.className = 'openide-stop-square';
			this._sendButton.title = localize('openide.chat.stop', "Stop");
		} else {
			this._sendButton.appendChild(createCodicon(document, 'arrow-up'));
			this._sendButton.title = localize('openide.chat.send', "Send (Enter)");
		}
	}

	/**
	 * ONE slot on the right: an empty composer offers dictation, a composer with something to say
	 * offers send, and a live run offers stop. While the microphone is busy it keeps the slot, or
	 * the control the user is talking into would vanish mid-sentence.
	 */
	private _updateSlot(): void {
		const voiceState = this.voice.state;
		let showSend = this._busy || this._hasContent;
		if (voiceState !== 'idle') {
			showSend = false;
		}
		this._sendButton.hidden = !showSend;
		this._sendButton.disabled = !this._busy && !this._hasContent;
		this._micButton.hidden = showSend || (!this.voice.capability.available && voiceState === 'idle');
	}
}
