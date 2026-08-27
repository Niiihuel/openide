/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IOpenideChatContent, IOpenideChatTerminalContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setOpenideChatShimmer } from './openideChatActivityRow.js';
import { OpenideChatTerminalMenu } from './openideChatTerminalMenu.js';
import '../media/openideChatTerminal.css';

/**
 * The embedded terminal of `run_command`: the webview's `addTermCard` / `feedTermCard` /
 * `finishTermCard` (openideChatHtml.ts:2899-3070), rebuilt as a content part.
 *
 * Three things make it more than a pretty log:
 *  - it STREAMS. `terminalData` produces a new content object per chunk, so the part absorbs the
 *    update line by line through `tryUpdate` instead of rebuilding the card and losing the caret.
 *  - it takes STDIN. While the process is alive the input line writes straight into the agent's
 *    pty, which is the only way to answer a `y/N` prompt without killing the run.
 *  - it has the `awaiting-input` state, where the tool ALREADY returned but the process is still
 *    blocked on a prompt. That state keeps the card open and the input line visible; treating it
 *    as "exited" is what used to strand the run with no visible way to unblock it.
 *
 * Not ported from the webview: nothing. Background commands never reach this part — the reducer
 * routes them to 'silent' (openideChatReducerTools.ts:105-108) exactly like `addTermCard` bails out
 * for them, because their single canonical surface is the background terminal tray.
 */
export class OpenideChatTerminalPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _card: HTMLElement;
	private readonly _glyph: HTMLElement;
	private readonly _status: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _out: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _menu: OpenideChatTerminalMenu;
	/** Output lines currently in the DOM, so a delta only touches the lines that changed. */
	private readonly _lines: HTMLElement[] = [];
	private _content: IOpenideChatTerminalContent;
	private _open = true;

	constructor(
		content: IOpenideChatTerminalContent,
		_context: IOpenideChatContentPartContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextViewService contextViewService: IContextViewService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
	) {
		super();
		this._content = content;

		this.domNode = $('div.openide-chat-term-card');
		this._card = this.domNode;

		const head = append(this.domNode, $<HTMLButtonElement>('button.openide-chat-term-head', { type: 'button' }));
		this._status = append(head, $('span.openide-chat-term-status'));
		append(this._status, $('span.codicon.codicon-error'));
		this._glyph = append(head, $('span.openide-chat-term-glyph'));
		this._title = append(head, $('span.openide-chat-term-title'));
		append(head, $('span.openide-chat-term-spacer'));
		const dots = append(head, $<HTMLButtonElement>('button.openide-chat-term-dots', { type: 'button', title: 'Command options' }));
		append(dots, $('span.codicon.codicon-ellipsis'));

		const body = append(this.domNode, $('div.openide-chat-term-body'));
		this._out = append(body, $('div.openide-chat-term-out'));

		// `$ command` is the first line of the scroll box and never part of `output`, so the streamed
		// lines can be diffed against the content by index without an off-by-one everywhere.
		const commandLine = append(this._out, $('div.openide-chat-term-line.openide-chat-term-line-cmd'));
		append(commandLine, $('span.openide-chat-term-dollar')).textContent = '$';
		append(commandLine, $('span')).textContent = content.command;

		const inputRow = append(body, $('div.openide-chat-term-in'));
		append(inputRow, $('span.openide-chat-term-caret')).textContent = '>';
		this._input = append(inputRow, $<HTMLInputElement>('input.openide-chat-term-input', {
			type: 'text', placeholder: 'Escribir en la terminal…', spellcheck: false,
		}));

		this._menu = this._register(instantiationService.createInstance(
			OpenideChatTerminalMenu, contextViewService, () => this._content.command,
		));

		this._register(addDisposableListener(head, 'click', event => {
			// The ⋯ button lives inside the head so the whole strip stays one hit target; without this
			// guard opening the menu would also collapse the card underneath it.
			if (dots.contains(event.target as Node)) {
				return;
			}
			this._setOpen(!this._open);
		}));
		this._register(addDisposableListener(dots, 'click', event => {
			event.stopPropagation();
			this._menu.toggle(dots, dots);
		}));
		this._register(addDisposableListener(this._input, 'keydown', event => {
			if (event.key !== 'Enter') {
				return;
			}
			// Stopped as well as prevented: the list is a tree, and a bubbling Enter would activate
			// the focused row instead of submitting the line.
			event.preventDefault();
			event.stopPropagation();
			this._submitInput();
		}));
		// A click on the input must not reach the head's toggle, which would collapse the body the
		// user is about to type into.
		this._register(addDisposableListener(this._input, 'click', event => event.stopPropagation()));

		this._render();
	}

	private _submitInput(): void {
		const value = this._input.value;
		if (!value) {
			return;
		}
		this._input.value = '';
		// Same cap the webview host enforces before forwarding (openideChatView.ts:1003): a pasted
		// file into a pty is never a deliberate keystroke.
		this._agentService.writeToolTerminal(value.slice(0, 2000));
	}

	private _setOpen(open: boolean): void {
		this._open = open;
		this._setOpenClass();
		// Toggling hides or reveals the whole body, which the list measured before the click: without
		// this the collapsed card keeps the tall row and leaves a gap under it.
		this._onDidChangeHeight.fire();
	}

	private _render(): void {
		const content = this._content;
		const running = content.state === 'running';
		const awaiting = content.state === 'awaiting-input';

		this._title.textContent = content.command;
		this._title.title = content.command;
		// The shimmer is the card's only progress indicator; it has to stop the moment the process
		// stops, including in `awaiting-input` where the command is blocked rather than working.
		setOpenideChatShimmer(this._title, running);

		this._card.classList.toggle('openide-chat-term-running', running);
		this._card.classList.toggle('openide-chat-term-awaiting', awaiting);
		this._card.classList.toggle('openide-chat-term-error', content.exitCode !== undefined && content.exitCode !== 0);
		this._setOpenClass();
		this._renderOutput();
	}

	/**
	 * Applies the open state to the DOM without reporting a height.
	 *
	 * Collapsed, the glyph becomes the terminal icon: the chevron is the only thing that still says
	 * "there is a body here" once the body is hidden. Kept separate from `_setOpen` because `_render`
	 * also needs it and already fires its own height change.
	 */
	private _setOpenClass(): void {
		this._card.classList.toggle('openide-chat-term-open', this._open);
		clearNode(this._glyph);
		append(this._glyph, $(`span.codicon.codicon-${this._open ? 'chevron-down' : 'terminal'}`));
	}

	/**
	 * Reconciles the output lines.
	 *
	 * A running build emits a chunk every few milliseconds and the reducer hands back the WHOLE
	 * accumulated output each time, so rewriting the box would re-create up to 400 nodes per frame
	 * and reset the scroll position mid-read. Only the lines whose text actually differs are
	 * touched, which in practice is the last one.
	 */
	private _renderOutput(): void {
		const lines = this._content.output ? this._content.output.split('\n') : [];
		for (let i = 0; i < lines.length; i++) {
			const existing = this._lines[i];
			if (existing) {
				if (existing.textContent !== lines[i]) {
					existing.textContent = lines[i];
				}
				continue;
			}
			const line = append(this._out, $('div.openide-chat-term-line'));
			line.textContent = lines[i];
			this._lines[i] = line;
		}
		// The reducer trims to MAX_TERMINAL_LINES, so the array can shrink from the front and the
		// tail nodes have to go.
		for (let i = lines.length; i < this._lines.length; i++) {
			this._lines[i].remove();
		}
		this._lines.length = lines.length;
		this._out.scrollTop = this._out.scrollHeight;
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'terminal')) {
			return false;
		}
		return other.callId === this._content.callId
			&& other.command === this._content.command
			&& other.state === this._content.state
			&& other.output === this._content.output
			&& other.exitCode === this._content.exitCode;
	}

	/**
	 * Absorbs every update of the SAME command.
	 *
	 * This is the part that most depends on `tryUpdate` existing: a `npm install` produces hundreds
	 * of content objects, and recreating the card on each one would blank the stdin field the user is
	 * typing into and drop the ⋯ menu while it is open. A different `callId` is a different command
	 * and must get its own card.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'terminal') || other.callId !== this._content.callId) {
			return false;
		}
		this._content = other;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
