/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, reset } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IBackgroundTerminalEvent } from '../../../common/openideAgentTypes.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { createChatTray, IOpenideChatTray } from '../openideChatTray.js';
import { setupChatTooltip } from '../openideChatHover.js';
import '../media/openideChatTerminals.css';

/**
 * The background terminals of the turn: the webview's `terms-tray`
 * on workbench DOM.
 *
 * A sibling of `OpenideChatFilesTray` in every structural respect — same dock surface, same
 * head/toggle/body grammar — and deliberately NOT merged with it. What they show has opposite
 * lifetimes: a changed file is a decision waiting for the user and survives reloads, while a
 * background terminal is a live process that only exists while it runs. Sharing a class would mean
 * one component whose rows mean two different things.
 *
 * `run_command` with `background: true` routes to `silent` in the reducer precisely because this
 * tray is its surface: there is no transcript card for a dev server, the tray IS the card. Without
 * this component that call rendered nothing anywhere, which is why a `npm run dev` in the native
 * chat looked like a tool that did nothing.
 */
export class OpenideChatTerminalsTray extends Disposable {

	readonly domNode: HTMLElement;
	private readonly _tray: IOpenideChatTray;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	/** The tray sits between transcript and composer, so appearing and going changes the layout. */
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _count: HTMLElement;
	private readonly _body: HTMLElement;

	private readonly _rows = new Map<string, { row: HTMLElement; label: HTMLElement; store: DisposableStore }>();
	private _expanded = false;

	constructor(
		parent: HTMLElement,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._tray = this._register(createChatTray(parent, 'terms', 'terminal'));
		this.domNode = this._tray.domNode;
		const { toggle } = this._tray;
		this._count = this._tray.label;
		this._register(addDisposableListener(toggle, 'click', () => this._toggle()));

		this._body = this._tray.body;
		this._register(this._tray.onDidChangeExpanded(expanded => {
			if (this._expanded === expanded) {
				return;
			}
			this._expanded = expanded;
			this._onDidChangeHeight.fire();
		}));
		this._tray.setExpanded(this._expanded);

		this._register(this._agentService.onDidChangeBackgroundTerminal(event => this.update(event)));
	}

	get isEmpty(): boolean {
		return this._rows.size === 0;
	}

	/**
	 * A terminal that exited leaves the tray, and only a `running` one may create a row.
	 *
	 * There is no restore path on purpose. `pendingFileDiffs()` can rebuild the files tray after a
	 * reload because a snapshot is on disk; a background terminal only exists as an entry in the
	 * tool registry's in-memory map, which a reload empties. Inventing rows for terminals nobody
	 * can reveal or kill any more would be worse than starting empty.
	 */
	update(event: IBackgroundTerminalEvent): void {
		if (event.status === 'exited') {
			this._removeRow(event.id);
			this._syncVisibility();
			return;
		}
		let entry = this._rows.get(event.id);
		if (!entry) {
			const store = new DisposableStore();
			const row = $('div.openide-chat-terms-row');
			append(row, $('span.codicon.codicon-terminal'));
			// Monospace and shimmering: it is a command, and it is running.
			const label = append(row, $<HTMLButtonElement>('button.openide-chat-terms-label', { type: 'button' }));
			// The row store, not `this`: a terminal that exits takes its row with it. The text node
			// already carries the command, so the hover only un-elides it.
			store.add(setupChatTooltip(this._hoverService, label, () => label.textContent ?? '', { aria: false }));
			// Reveal without stealing focus, which is what `followBackgroundTerminal` is for: the
			// user clicked a row in the chat, so the chat is where they are still typing.
			store.add(addDisposableListener(row, 'click', () => this._reveal(event.id)));

			const stop = append(row, $<HTMLButtonElement>('button.openide-chat-terms-stop.oi-dock-action', { type: 'button' }));
			// Named after the command it kills: the tray can hold several rows, and a column of
			// buttons all called "Stop" cannot be told apart from the keyboard.
			store.add(setupChatTooltip(this._hoverService, stop, () => t('chat.part.terminalStopOf', label.textContent ?? '')));
			append(stop, $('span.codicon.codicon-close'));
			store.add(addDisposableListener(stop, 'click', (mouse: MouseEvent) => {
				// Without this the click also reveals the terminal that is being killed.
				mouse.stopPropagation();
				this._agentService.killBackgroundTerminal(event.id);
			}));

			append(this._body, row);
			entry = { row, label, store };
			this._rows.set(event.id, entry);
		}
		entry.label.textContent = event.command;
		entry.label.setAttribute('aria-label', event.command);
		this._syncVisibility();
	}

	private _reveal(id: string): void {
		// A terminal that already exited resolves to nothing; the row is on its way out anyway.
		this._agentService.revealBackgroundTerminal(id).catch(() => undefined);
	}

	private _toggle(): void {
		this._expanded = !this._expanded;
		this._tray.setExpanded(this._expanded);
		this._onDidChangeHeight.fire();
	}

	private _removeRow(id: string): void {
		const entry = this._rows.get(id);
		if (!entry) {
			return;
		}
		entry.row.remove();
		entry.store.dispose();
		this._rows.delete(id);
	}

	private _syncVisibility(): void {
		const empty = this.isEmpty;
		this.domNode.classList.toggle('hidden', empty);
		reset(this._count, empty ? '' : `${this._rows.size} ${this._rows.size === 1 ? 'Background Terminal' : 'Background Terminals'}`);
		this._onDidChangeHeight.fire();
	}

	override dispose(): void {
		for (const { store } of this._rows.values()) {
			store.dispose();
		}
		this._rows.clear();
		clearNode(this._body);
		super.dispose();
	}
}
