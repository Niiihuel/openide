/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IOpenidePickAttachment, toOpenidePickAttachment } from '../../common/openidePickContext.js';
import { IOpenideAgentService } from '../openideAgentService.js';

/**
 * Pick & Polish in the composer: the chip for the element the user selected in their running app.
 *
 * The webview's `#pickChip` (openideChatHtml.ts:4208-4221) plus the `_pendingPick` slot the host
 * kept beside it (openideChatView.ts:131). Those were two halves of one thing in two files, and
 * splitting them is what made the chip a display of state it did not own: the host could clear the
 * pending pick and the chip only found out because a `postMessage` said so.
 *
 * Holding it in the composer is what makes it behave like the attachment it is. A pick is context
 * the user assembled for a message they have not written yet — the same category as a pasted
 * screenshot — so it belongs to the message being composed, is discarded with it and travels with
 * it on Send.
 */
export class OpenideChatComposerPick extends Disposable {

	private readonly _strip: HTMLElement;
	/** Cleared on every paint: the chip is thrown away and rebuilt, and its listeners with it. */
	private readonly _chipStore = this._register(new DisposableStore());
	private _pending: IOpenidePickAttachment | undefined;

	get pending(): IOpenidePickAttachment | undefined { return this._pending; }
	get isEmpty(): boolean { return this._pending === undefined; }

	/**
	 * Plain constructor, no `@IOpenideAgentService`: services have to be the TRAILING parameters of
	 * an injected class, and the callbacks have to come last for the composer to read naturally. The
	 * composer already holds the service, exactly as it does for the voice controller.
	 *
	 * Two callbacks and not one because the chip appearing and the chip going are only the same
	 * event for the layout. `onDidChange` re-measures the card, which BOTH need; `onDidPick` takes
	 * focus, which only arriving does — stealing focus when the user dismisses the chip would fight
	 * whatever they clicked next.
	 */
	constructor(
		strip: HTMLElement,
		agentService: IOpenideAgentService,
		private readonly _onDidChange: () => void,
		private readonly _onDidPick: () => void,
	) {
		super();
		this._strip = strip;
		this._strip.hidden = true;
		this._register(agentService.onDidPickElement(result => {
			// A second pick REPLACES the first: the picker is a pointer, and two elements pointed at
			// one after the other is a correction, not a selection of both.
			this._pending = toOpenidePickAttachment(result);
			this._render();
			this._onDidPick();
		}));
	}

	/**
	 * Hands the pick over and empties the slot, so the turn that carries it is the only one that
	 * does. Returns `undefined` when nothing is pending, which is the common case.
	 */
	take(): IOpenidePickAttachment | undefined {
		const pending = this._pending;
		this.clear();
		return pending;
	}

	/** Puts a taken pick back. The composer uses it when the turn was rejected. */
	restore(pick: IOpenidePickAttachment | undefined): void {
		if (!pick) {
			return;
		}
		this._pending = pick;
		this._render();
	}

	clear(): void {
		this._pending = undefined;
		this._render();
	}

	private _render(): void {
		this._chipStore.clear();
		clearNode(this._strip);
		if (!this._pending) {
			this._strip.hidden = true;
			// After the DOM changed, never before: the composer measures its own card here.
			this._onDidChange();
			return;
		}
		this._strip.hidden = false;

		append(this._strip, $('span.codicon.codicon-inspect'));
		const selector = append(this._strip, $('span.openide-chat-pick-selector'));
		selector.textContent = this._pending.selector;
		selector.title = 'Elemento seleccionado en la app (se adjunta al próximo mensaje)';

		const remove = append(this._strip, $<HTMLButtonElement>('button.openide-chat-pick-remove', { type: 'button', title: 'Quitar elemento' }));
		remove.setAttribute('aria-label', 'Quitar elemento seleccionado');
		append(remove, $('span.codicon.codicon-close'));
		this._chipStore.add(addDisposableListener(remove, 'click', () => this.clear()));
		this._onDidChange();
	}
}
