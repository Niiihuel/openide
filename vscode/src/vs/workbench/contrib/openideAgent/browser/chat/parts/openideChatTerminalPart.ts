/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow, scheduleAtNextAnimationFrame } from '../../../../../../base/browser/dom.js';
import { MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IOpenideChatContent, IOpenideChatTerminalContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { OpenideFold } from '../../openideFold.js';
import { OpenideChatTerminalMenu } from './openideChatTerminalMenu.js';
import '../media/openideChatTerminal.css';

/**
 * The embedded terminal of `run_command`: the webview's `addTermCard` / `feedTermCard` /
 * `finishTermCard`, rebuilt as a content part.
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
 * The header is ONE line, always: terminal glyph, a short title, and the executables the command
 * chains ("cd, bun"). The full command lives in the body as `$ command` and in the title's hover;
 * putting it in the header made a four-line strip out of every `cd … && … && …`, which is what
 * the redesign removes. The whole header is the collapse toggle — no chevron.
 *
 * Not ported from the webview: nothing. Background commands never reach this part — the reducer
 * routes them to 'silent' (openideChatReducerTools.ts:105-108) exactly like `addTermCard` bails out
 * for them, because their single canonical surface is the background terminal tray.
 */
export class OpenideChatTerminalPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _card: HTMLElement;
	private readonly _head: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _summary: HTMLElement;
	private readonly _exit: HTMLElement;
	private readonly _out: HTMLElement;
	private readonly _fold: OpenideFold;
	private readonly _input: HTMLInputElement;
	private readonly _menu: OpenideChatTerminalMenu;
	/** Output lines currently in the DOM, so a delta only touches the lines that changed. */
	private readonly _lines: HTMLElement[] = [];
	private _content: IOpenideChatTerminalContent;
	private _open = true;

	/** The pending pin of the output to its last line; at most one per frame. */
	private readonly _pinToBottom = this._register(new MutableDisposable());

	constructor(
		content: IOpenideChatTerminalContent,
		_context: IOpenideChatContentPartContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextViewService contextViewService: IContextViewService,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this._content = content;

		this.domNode = $('div.openide-chat-term-card');
		this._card = this.domNode;

		// A div with the button role, not a <button>: the ⋯ trigger lives inside the strip so the
		// whole row stays one hit target, and a button nested in a button is invalid HTML whose
		// focus and click delivery Chromium only approximates.
		this._head = append(this.domNode, $('div.openide-chat-term-head', { role: 'button', tabindex: '0' }));
		const glyph = append(this._head, $('span.openide-chat-term-glyph'));
		append(glyph, $('span.codicon.codicon-terminal'));
		this._title = append(this._head, $('span.openide-chat-term-title'));
		// The header shows a short title and the chained executables; the hover is where the FULL
		// command reads, so the accessible name stays the visible text.
		this._register(setupChatTooltip(hoverService, this._title, () => this._content.command, { aria: false }));
		this._summary = append(this._head, $('span.openide-chat-term-summary'));
		append(this._head, $('span.openide-chat-term-spacer'));
		this._exit = append(this._head, $('span.openide-chat-term-exit'));
		const spin = append(this._head, $('span.openide-chat-term-spin'));
		append(spin, $('span.codicon.codicon-loading.codicon-modifier-spin'));
		const dots = append(this._head, $<HTMLButtonElement>('button.openide-chat-term-dots', { type: 'button' }));
		this._register(setupChatTooltip(hoverService, dots, () => t('chat.part.commandOptions')));
		append(dots, $('span.codicon.codicon-ellipsis'));

		const body = append(this.domNode, $('div.openide-chat-term-body'));
		// The output folds the way an edit's diff does (openideFold.ts): the first lines at rest,
		// the fade at the bottom, the chevron on hover. While folded the output is read from its
		// start, like a diff; open, it follows its tail the way a terminal does.
		const fold = append(body, $('div.openide-chat-term-fold'));
		this._out = append(fold, $('div.openide-chat-term-out'));
		this._fold = this._register(new OpenideFold(fold, hoverService, { measure: () => this._out.scrollHeight }));
		this._register(this._fold.onDidChangeHeight(() => this._onDidChangeHeight.fire()));

		// `$ command` is the first line of the scroll box and never part of `output`, so the streamed
		// lines can be diffed against the content by index without an off-by-one everywhere.
		const commandLine = append(this._out, $('div.openide-chat-term-line.openide-chat-term-line-cmd'));
		append(commandLine, $('span.openide-chat-term-dollar')).textContent = '$';
		append(commandLine, $('span.openide-chat-term-cmd')).textContent = content.command;

		const inputRow = append(body, $('div.openide-chat-term-in'));
		append(inputRow, $('span.openide-chat-term-caret')).textContent = '>';
		this._input = append(inputRow, $<HTMLInputElement>('input.openide-chat-term-input', {
			type: 'text', placeholder: 'Escribir en la terminal…', spellcheck: false,
		}));

		this._menu = this._register(instantiationService.createInstance(
			OpenideChatTerminalMenu, contextViewService, () => this._content.command,
		));

		this._register(addDisposableListener(this._head, 'click', event => {
			// Without this guard opening the menu would also collapse the card underneath it.
			if (dots.contains(event.target as Node)) {
				return;
			}
			this._setOpen(!this._open);
		}));
		this._register(addDisposableListener(this._head, 'keydown', event => {
			if (event.target !== this._head || (event.key !== 'Enter' && event.key !== ' ')) {
				return;
			}
			// Stopped as well as prevented: the list is a tree, and a bubbling Enter would activate
			// the focused row instead of toggling the card.
			event.preventDefault();
			event.stopPropagation();
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
		const failed = content.exitCode !== undefined && content.exitCode !== 0;

		this._title.textContent = terminalCardTitle(content.command, content.description);
		this._summary.textContent = summarizeCommandExecutables(content.command);
		// "exit 1" and not the bare number: a lone digit at the end of a header reads as a count.
		this._exit.textContent = failed ? `exit ${content.exitCode}` : '';

		this._card.classList.toggle('openide-chat-term-running', running);
		this._card.classList.toggle('openide-chat-term-awaiting', awaiting);
		this._card.classList.toggle('openide-chat-term-error', failed);
		this._setOpenClass();
		this._renderOutput();
	}

	/**
	 * Applies the open state to the DOM without reporting a height. Kept separate from `_setOpen`
	 * because `_render` also needs it and already fires its own height change.
	 */
	private _setOpenClass(): void {
		this._card.classList.toggle('openide-chat-term-open', this._open);
		this._head.setAttribute('aria-expanded', this._open ? 'true' : 'false');
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
		// Next frame, not now: reading `scrollHeight` right after the writes above forces a layout
		// per chunk of output. See the same pin in `openideChatThinkingPart.ts`.
		this._fold.measure();
		this._pinToBottom.value = scheduleAtNextAnimationFrame(getWindow(this._out), () => {
			this._pinToBottom.value = undefined;
			// Folded, the box shows the first lines under a fade, so scrolling it to the tail would
			// hide the only lines it shows; the tail is followed once the reader opened it.
			if (this._fold.isOpen) {
				this._out.scrollTop = this._out.scrollHeight;
			}
		});
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

/**
 * The header's title: the tool's own description when the content carries one, otherwise the
 * first executable of the command. The reducer does not forward `description` yet
 * (openideChatReducerTools.ts `startTerminal` keeps only `command`), so today this is always the
 * executable; the parameter is here so wiring it up is a one-line change on the caller.
 */
export function terminalCardTitle(command: string, description?: string): string {
	const trimmed = description?.trim();
	if (trimmed) {
		return trimmed;
	}
	return commandExecutables(command)[0] ?? command.trim();
}

/**
 * "cd, bun" for `cd x && FOO=1 bun -e '…; …' && bun run e2e 2>&1`: the executable of every
 * command the line chains, without duplicates, in order.
 *
 * Splits on the shell's list operators (`&&`, `||`, `;`, `|`, newline) but NOT inside quotes —
 * the `;` in a `bun -e '…; …'` script is part of the argument, and splitting on it would surface
 * `console.log(...)` as a command. Leading `VAR=value` assignments and the usual wrappers
 * (`sudo`, `env`, `time`, `nohup`) are skipped so the real program is what the header names, and
 * a path is reduced to its basename: `./node_modules/.bin/tsc` is `tsc` to the reader.
 */
export function summarizeCommandExecutables(command: string): string {
	return commandExecutables(command).join(', ');
}

/** Prefixes that name HOW a program runs rather than WHICH program; skipped when picking the executable. */
const COMMAND_WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'do', 'then', 'else']);
/** Closers of a compound command: a segment that is only `done` or `fi` runs nothing. */
const COMMAND_CLOSERS = new Set(['done', 'fi', 'esac', '}', ')']);

function commandExecutables(command: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const segment of splitShellList(command)) {
		const executable = firstExecutable(segment);
		if (executable && !seen.has(executable)) {
			seen.add(executable);
			result.push(executable);
		}
	}
	return result;
}

/** Splits at unquoted `&&`, `||`, `;`, `|` and newlines. `>&`/`2>&1` never split: only a doubled `&` does. */
function splitShellList(command: string): string[] {
	const segments: string[] = [];
	let current = '';
	let quote: '\'' | '"' | undefined;
	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		if (quote) {
			current += char;
			// A backslash only escapes inside double quotes; single quotes take everything literally.
			if (quote === '"' && char === '\\' && i + 1 < command.length) {
				current += command[++i];
			} else if (char === quote) {
				quote = undefined;
			}
			continue;
		}
		if (char === '\\' && i + 1 < command.length) {
			current += char + command[++i];
			continue;
		}
		if (char === '\'' || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		const pair = command.slice(i, i + 2);
		if (pair === '&&' || pair === '||') {
			segments.push(current);
			current = '';
			i++;
			continue;
		}
		if (char === ';' || char === '|' || char === '\n') {
			segments.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	segments.push(current);
	return segments;
}

/** The program a single simple command runs, or `undefined` when the segment holds no command. */
function firstExecutable(segment: string): string | undefined {
	// Subshell and group openers are not commands; `( cd x && make )` runs `cd` and `make`.
	const words = segment.replace(/^[\s({]+/, '').split(/\s+/).filter(Boolean);
	for (const word of words) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
			continue;
		}
		if (COMMAND_WRAPPERS.has(word)) {
			continue;
		}
		if (COMMAND_CLOSERS.has(word)) {
			return undefined;
		}
		// `sudo -E make`: a bare flag between the wrapper and the program belongs to the wrapper. A
		// flag WITH a value (`sudo -u root make`) names the value instead; per-wrapper option tables
		// are not worth their weight for a header summary.
		if (word.startsWith('-')) {
			continue;
		}
		const unquoted = word.replace(/^["']|["']$/g, '');
		const slash = unquoted.lastIndexOf('/');
		return (slash >= 0 && slash < unquoted.length - 1 ? unquoted.slice(slash + 1) : unquoted) || undefined;
	}
	return undefined;
}
