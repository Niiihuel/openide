/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createOpenideElement } from '../openideDom.js';
import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { t } from '../../common/openideStrings.js';
import { VoiceState } from './openideChatComposerVoice.js';
import { setupChatTooltip } from './openideChatHover.js';
import { createArrowUpIcon, createStopIcon } from './openideChatIcons.js';
import { createCodicon } from './openideComposerMenu.js';

export interface IOpenideVoiceBarActions {
	readonly cancel: () => void;
	readonly stop: () => void;
	readonly send: () => void;
}

/** Capture controls render actual RMS samples, with no idle timer or fabricated waveform. */
export class OpenideChatVoiceBar extends Disposable {
	readonly domNode: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _stop: HTMLButtonElement;
	private readonly _send: HTMLButtonElement;
	private readonly _bars: HTMLElement[] = [];
	private readonly _levels = new Float32Array(128);
	private _state: VoiceState = 'idle';

	constructor(parent: HTMLElement, hoverService: IHoverService, actions: IOpenideVoiceBarActions) {
		super();
		const document = parent.ownerDocument;
		this.domNode = createOpenideElement(document, 'div');
		this.domNode.className = 'openide-composer-voice-bar';
		this.domNode.hidden = true;
		this.domNode.setAttribute('role', 'group');
		this.domNode.setAttribute('aria-label', t('chatSurface.voice.label'));
		const button = (className: string, label: string, action: () => void): HTMLButtonElement => {
			const node = createOpenideElement(document, 'button'); node.type = 'button';
			node.className = `openide-composer-voice-action openide-chat-round-action ${className}`;
			this._register(setupChatTooltip(hoverService, node, () => label));
			this._register(addDisposableListener(node, 'click', () => { if (!node.disabled) { action(); } }));
			this.domNode.appendChild(node);
			return node;
		};
		button('openide-composer-voice-cancel secondary', t('chatSurface.voice.cancel'), actions.cancel).appendChild(createCodicon(document, 'close'));
		const waveform = createOpenideElement(document, 'div'); waveform.className = 'openide-composer-voice-wave';
		waveform.setAttribute('aria-hidden', 'true');
		for (let i = 0; i < this._levels.length; i++) {
			const bar = createOpenideElement(document, 'span'); waveform.appendChild(bar); this._bars.push(bar);
		}
		this.domNode.appendChild(waveform);
		this._stop = button('openide-composer-voice-stop secondary', t('chatSurface.voice.review'), actions.stop);
		this._stop.appendChild(createStopIcon(document));
		this._send = button('openide-composer-voice-send', t('chatSurface.voice.send'), actions.send);
		this._send.appendChild(createArrowUpIcon(document));
		this._status = createOpenideElement(document, 'span'); this._status.className = 'openide-composer-voice-announcement';
		this._status.setAttribute('role', 'status'); this._status.setAttribute('aria-live', 'polite');
		this.domNode.insertBefore(this._status, this._stop);
		parent.appendChild(this.domNode);
		this._paintLevels();
	}

	setState(state: VoiceState): void {
		this._state = state;
		this.domNode.hidden = state === 'idle';
		this.domNode.classList.toggle('recording', state === 'recording');
		this.domNode.setAttribute('aria-busy', String(state === 'starting' || state === 'busy'));
		this._stop.disabled = this._send.disabled = state !== 'recording';
		this._status.textContent = state === 'idle' ? '' : t(state === 'starting' ? 'chat.voice.preparing' : state === 'busy' ? 'chat.voice.transcribing' : 'chatSurface.voice.listening');
		if (state !== 'recording') { this._levels.fill(0); this._paintLevels(); }
	}

	setLevel(level: number): void {
		if (this._state !== 'recording') { return; }
		this._levels.copyWithin(0, 1);
		this._levels[this._levels.length - 1] = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
		this._paintLevels();
	}

	private _paintLevels(): void {
		for (let i = 0; i < this._bars.length; i++) {
			const transform = `scaleY(${Math.max(.08, this._levels[i])})`;
			if (this._bars[i].style.transform !== transform) { this._bars[i].style.transform = transform; }
		}
	}
}
