/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IOpenideChatFileSuggestion, IOpenideChatSlashSuggestion, IOpenideChatSuggestSources } from '../../common/chat/openideChatSlashCommands.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { setupChatTooltip } from './openideChatHover.js';
import { createCodicon, createMenuContent, OpenideComposerPopover } from './openideComposerMenu.js';

/** Same debounce as the webview's `updateMentionMenu` / `updateSlashMenu` (the removed chat webview, 5975). */
const QUERY_DEBOUNCE_MS = 120;

export interface ICaretToken {
	readonly q: string;
	/** Index of the trigger character (`@` or `/`). */
	readonly start: number;
	/** Caret position: the end of the token. */
	readonly end: number;
}

/** `mentionTokenAtCaret` (the removed chat webview): an `@` at the start or after whitespace. */
export function mentionTokenAt(value: string, caret: number): ICaretToken | undefined {
	const before = value.slice(0, caret);
	const m = before.match(/(^|\s)@([^\s@]*)$/);
	if (!m) { return undefined; }
	return { q: m[2], start: caret - m[2].length - 1, end: caret };
}

/**
 * `slashTokenAtCaret` (the removed chat webview): a `/` at the start or after any whitespace, so a
 * previous selection does not block the picker and skills can be chained.
 */
export function slashTokenAt(value: string, caret: number): ICaretToken | undefined {
	const before = value.slice(0, caret);
	const m = before.match(/(^|\s)\/([a-zA-Z0-9_.-]*)$/);
	if (!m) { return undefined; }
	return { q: m[2], start: caret - m[2].length - 1, end: caret };
}

/**
 * `compactSlashDescription` (the removed chat webview): the first sentence of a description, for
 * the second line of a row.
 *
 * The character cap sits far above what a dock-width row can show, on purpose. The description now
 * owns a whole line, so CSS decides where it ends and the text grows with the panel; cutting at 62
 * put an ellipsis in the middle of a line that still had room. The cap is only a guard against a
 * description that is really a paragraph.
 */
export function compactSlashDescription(value: string): string {
	let text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) { return ''; }
	const sentence = text.indexOf('. ');
	if (sentence > 18) { text = text.slice(0, sentence + 1); }
	const parenthesis = text.indexOf(' (');
	if (parenthesis > 24) { text = text.slice(0, parenthesis); }
	if (text.length <= 140) { return text; }
	const cut = text.slice(0, 137).lastIndexOf(' ');
	return text.slice(0, cut > 90 ? cut : 137).replace(/[,:;\s]+$/, '') + '…';
}

const SLASH_GROUPS: readonly { kind: IOpenideChatSlashSuggestion['kind']; label: string; icon: string }[] = [
	{ kind: 'skill', label: 'Skills', icon: 'sparkle' },
	{ kind: 'command', label: 'Commands', icon: 'terminal' },
	{ kind: 'mcp', label: 'MCP', icon: 'plug' },
	{ kind: 'tool', label: 'Tools', icon: 'tools' },
];

type Kind = 'mention' | 'slash';

export interface ISuggestHandlers {
	readonly acceptFile: (suggestion: IOpenideChatFileSuggestion) => void;
	readonly acceptSlash: (suggestion: IOpenideChatSlashSuggestion) => void;
}

/**
 * The `@` and `/` autocomplete of the composer: one popover above the card, two pipelines.
 *
 * Transcribed from the webview's mention menu and slash menu
 * (:5868-5980): token at the caret, 120 ms debounce, a generation guard so a slow answer to an
 * older query never paints over a newer one, keyboard navigation, and after accepting a command
 * with an argument hint the hint stays as a ghost row until the user types again.
 */
export class OpenideChatComposerSuggest extends Disposable {

	private readonly _popover: OpenideComposerPopover;
	private _kind: Kind | undefined;
	private _token: ICaretToken | undefined;
	private _files: readonly IOpenideChatFileSuggestion[] = [];
	private _slash: readonly IOpenideChatSlashSuggestion[] = [];
	private _selected = 0;
	private _generation = 0;
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _ghost: { slug: string; hint: string } | undefined;
	private _content: HTMLElement | undefined;

	/** Rows on screen and navigable by keyboard; false for the ghost hint. */
	get isOpen(): boolean {
		return !!this._kind && (this._kind === 'mention' ? this._files.length > 0 : this._slash.length > 0);
	}

	constructor(
		private readonly prompt: HTMLTextAreaElement,
		private readonly anchor: HTMLElement,
		private readonly sources: IOpenideChatSuggestSources,
		contextViewService: IContextViewService,
		private readonly hoverService: IHoverService,
		private readonly handlers: ISuggestHandlers,
	) {
		super();
		this._popover = this._register(new OpenideComposerPopover(contextViewService));
	}

	/** Called on every `input`: decides which menu (if any) the caret is in and queries it. */
	update(): void {
		// Typing anything retires the ghost hint (updateSlashMenu, the removed chat webview).
		if (this._ghost) {
			this._ghost = undefined;
			this._popover.close();
		}
		const value = this.prompt.value;
		const caret = this.prompt.selectionStart ?? value.length;
		const mention = mentionTokenAt(value, caret);
		const slash = mention ? undefined : slashTokenAt(value, caret);
		const token = mention ?? slash;
		if (!token) {
			this.close();
			return;
		}
		this._kind = mention ? 'mention' : 'slash';
		this._token = token;
		if (this._timer) { clearTimeout(this._timer); }
		const generation = ++this._generation;
		const kind = this._kind;
		this._timer = setTimeout(() => {
			this._timer = undefined;
			const query = kind === 'mention'
				? this.sources.queryFiles(token.q).then(items => { if (generation === this._generation) { this._files = items; this._selected = 0; this._render(); } })
				: this.sources.queryCommands(token.q).then(items => { if (generation === this._generation) { this._slash = items; this._selected = 0; this._render(); } });
			query.catch(() => { if (generation === this._generation) { this.close(); } });
		}, QUERY_DEBOUNCE_MS);
	}

	/**
	 * Keyboard while a menu is open: arrows navigate, Enter/Tab accept, Escape closes. Returns true
	 * when the event was consumed, so the composer does not also send the message.
	 */
	handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.isOpen) {
			return false;
		}
		const standard = new StandardKeyboardEvent(event);
		const count = this._kind === 'mention' ? this._files.length : this._slash.length;
		switch (standard.keyCode) {
			case KeyCode.DownArrow:
				standard.preventDefault();
				this._move(1, count);
				return true;
			case KeyCode.UpArrow:
				standard.preventDefault();
				this._move(-1, count);
				return true;
			case KeyCode.Enter:
			case KeyCode.Tab:
				standard.preventDefault();
				this._acceptSelected();
				return true;
			case KeyCode.Escape:
				standard.preventDefault();
				this.close();
				return true;
		}
		return false;
	}

	close(): void {
		this._generation++;
		if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
		this._kind = undefined;
		this._token = undefined;
		this._files = [];
		this._slash = [];
		this._ghost = undefined;
		this._popover.close();
		this._content = undefined;
	}

	private _move(delta: number, count: number): void {
		if (!count) { return; }
		this._selected = (this._selected + delta + count) % count;
		const rows = this._content?.querySelectorAll<HTMLElement>('[data-suggest-index]') ?? [];
		for (const row of Array.from(rows)) {
			const focused = Number(row.getAttribute('data-suggest-index')) === this._selected;
			row.classList.toggle('focus', focused);
			if (focused) { row.scrollIntoView?.({ block: 'nearest' }); }
		}
	}

	private _acceptSelected(): void {
		if (this._kind === 'mention') {
			const item = this._files[this._selected];
			if (item) { this._acceptFile(item); }
		} else if (this._kind === 'slash') {
			const item = this._slash[this._selected];
			if (item) { this._acceptSlash(item); }
		}
	}

	/** Removes the token from the text (`acceptMention`, the removed chat webview) and hands over the path. */
	private _acceptFile(item: IOpenideChatFileSuggestion): void {
		this._spliceToken();
		this.close();
		this.handlers.acceptFile(item);
		this.prompt.focus();
	}

	/** `acceptSlash` (the removed chat webview): the token goes, the chip comes, the hint ghosts. */
	private _acceptSlash(item: IOpenideChatSlashSuggestion): void {
		this._spliceToken();
		const hint = item.hint;
		this.close();
		this.handlers.acceptSlash(item);
		if (hint) {
			this._ghost = { slug: item.name, hint };
			this._renderGhost();
		}
		this.prompt.focus();
	}

	private _spliceToken(): void {
		const token = this._token;
		if (!token) { return; }
		const value = this.prompt.value;
		const caret = this.prompt.selectionStart ?? value.length;
		const end = Math.max(token.end, caret);
		this.prompt.value = value.slice(0, token.start) + value.slice(end);
		this.prompt.setSelectionRange(token.start, token.start);
		this.prompt.dispatchEvent(new Event('suggest-splice'));
	}

	private _render(): void {
		const count = this._kind === 'mention' ? this._files.length : this._slash.length;
		if (!count) {
			this._popover.close();
			this._content = undefined;
			return;
		}
		const paint = (container: HTMLElement) => {
			clearNode(container);
			container.classList.add('openide-chat-suggest');
			const content = append(container, createMenuContent(container.ownerDocument));
			this._content = content;
			if (this._kind === 'mention') { this._paintFiles(content); } else { this._paintSlash(content); }
			this._paintScrollShadow(container, content);
		};
		if (this._popover.isOpen && this._popover.container) {
			paint(this._popover.container);
			this._popover.layout();
			return;
		}
		this._popover.show(this.anchor, {
			className: 'openide-chat-suggest-menu',
			render: container => {
				this._pinWidth(container);
				paint(container);
			},
			onHide: () => { this._content = undefined; },
		});
	}

	/**
	 * The workbench's own answer to content scrolled out of view: `ScrollableElement`'s `useShadows`
	 * (scrollableElement.ts), an inset shadow at the top edge that appears once the list has moved.
	 *
	 * It replaces a sticky group heading, which pinned the label but left Chromium painting rows
	 * outside the panel's rounded clip.
	 */
	private _paintScrollShadow(container: HTMLElement, content: HTMLElement): void {
		const shadow = append(container, container.ownerDocument.createElement('div'));
		shadow.className = 'openide-chat-suggest-shadow';
		const sync = () => shadow.classList.toggle('visible', content.scrollTop > 0);
		this._register(addDisposableListener(content, 'scroll', sync));
		sync();
	}

	private _paintFiles(content: HTMLElement): void {
		const document = content.ownerDocument;
		this._files.forEach((item, index) => {
			const row = this._row(content, index);
			const slot = append(row, document.createElement('span'));
			slot.className = 'openide-menu-row-icon';
			const icon = append(slot, document.createElement('span'));
			icon.className = item.iconClasses ? `openide-chat-file-icon ${item.iconClasses}` : 'codicon codicon-file';
			// Copilot's picker shows the basename first and the folder dimmed after it, in the UI
			// font — a path in monospace reads as code, not as a file you are choosing.
			const slash = item.path.lastIndexOf('/');
			const label = append(row, document.createElement('span'));
			label.className = 'openide-chat-suggest-file';
			const name = append(label, document.createElement('span'));
			name.className = 'openide-chat-suggest-file-name';
			name.textContent = slash >= 0 ? item.path.slice(slash + 1) : item.path;
			if (slash > 0) {
				const dir = append(label, document.createElement('span'));
				dir.className = 'openide-chat-suggest-file-dir';
				dir.textContent = item.path.slice(0, slash);
			}
			this._register(setupChatTooltip(this.hoverService, row, () => item.path, {
				// LEFT: the dock is pinned to the window's edge, so there is never room on the other side.
					position: HoverPosition.LEFT,
				aria: false,
			}));
			this._register(addDisposableListener(row, 'click', () => this._acceptFile(item)));
		});
	}

	private _paintSlash(content: HTMLElement): void {
		const document = content.ownerDocument;
		for (const group of SLASH_GROUPS) {
			const entries = this._slash.map((item, index) => ({ item, index })).filter(entry => entry.item.kind === group.kind);
			if (!entries.length) { continue; }
			const section = append(content, document.createElement('div'));
			section.className = 'openide-chat-suggest-section';
			const title = append(section, document.createElement('div'));
			title.className = 'openide-menu-section';
			title.textContent = group.label;
			// Two lines per row: the name with its signature on the first, the description on the
			// second. Sharing one line meant name, signature and description all competed for the
			// dock's ~330px, so each of them ended in an ellipsis and none of them was legible --
			// what makes a command scannable is the break between what you type and what it does,
			// not how few pixels tall the row is.
			for (const { item, index } of entries) {
				const row = this._row(section, index);
				const slot = append(row, document.createElement('span'));
				slot.className = 'openide-menu-row-icon';
				slot.appendChild(createCodicon(document, group.icon));
				const text = append(row, document.createElement('span'));
				text.className = 'openide-chat-suggest-text';
				// Name and signature are separate spans so they give way in the right order: the
				// name never shrinks and the signature truncates before it. Sharing one span made
				// "/openide-canvas" collapse to "/openide-…" while its hint still had room.
				const title = append(text, document.createElement('span'));
				title.className = 'openide-chat-suggest-title';
				const name = append(title, document.createElement('span'));
				name.className = 'openide-chat-suggest-name';
				this._paintSlashLabel(name, `/${item.name}`);
				if (item.hint) {
					const hint = append(title, document.createElement('span'));
					hint.className = 'openide-chat-suggest-hint';
					// No leading space in the text: the title is a flex row, and a space at the
					// start of a flex item is collapsed away. The gap belongs to the layout.
					hint.textContent = item.hint;
				}
				// Only painted when there is something to warn about. An always-present empty span
				// still ate the row's gap, which pushed the signature into truncating early.
				if (item.risk === 'exec' || item.risk === 'write') {
					const risk = append(title, document.createElement('span'));
					risk.className = `openide-chat-suggest-risk ${item.risk}`;
					risk.textContent = item.risk;
				}
				const detail = append(text, document.createElement('span'));
				detail.className = 'openide-chat-suggest-desc';
				detail.textContent = compactSlashDescription(item.description);
				// The workbench hover, not `title=`: a bare title attribute draws the OPERATING
				// SYSTEM's tip -- another font, another delay, outside the window -- which is the
				// unstyled grey box that was covering the rows underneath it.
				this._register(setupChatTooltip(this.hoverService, row, () => item.description || `/${item.name}`, {
					position: HoverPosition.LEFT,
					aria: false,
				}));
				this._register(addDisposableListener(row, 'click', () => this._acceptSlash(item)));
			}
		}
	}

	/**
	 * Writes the label with the typed characters marked, as the suggest widget does with
	 * `.monaco-highlighted-label .highlight`: bold, in `editorSuggestWidget.highlightForeground`.
	 * It is the only feedback that says WHY a row is in the list at all.
	 */
	private _paintSlashLabel(label: HTMLElement, text: string): void {
		const query = (this._token?.q ?? '').toLowerCase();
		const at = query ? text.toLowerCase().indexOf(query) : -1;
		if (at < 0) {
			label.append(label.ownerDocument.createTextNode(text));
			return;
		}
		label.append(label.ownerDocument.createTextNode(text.slice(0, at)));
		const hit = append(label, label.ownerDocument.createElement('span'));
		hit.className = 'openide-chat-suggest-hit';
		hit.textContent = text.slice(at, at + query.length);
		label.append(label.ownerDocument.createTextNode(text.slice(at + query.length)));
	}

	private _row(parent: HTMLElement, index: number): HTMLButtonElement {
		const row = append(parent, parent.ownerDocument.createElement('button'));
		row.type = 'button';
		row.className = `openide-menu-row${index === this._selected ? ' focus' : ''}`;
		row.setAttribute('data-suggest-index', String(index));
		// Never steal the focus from the textarea: the caret is what the token is measured against.
		this._register(addDisposableListener(row, 'mousedown', event => event.preventDefault()));
		return row;
	}

	/**
	 * Pinned to the anchor's width like the history popover (openideChatMenuDom.ts:154): a menu
	 * wider than the panel floats over the editor, which the webview never did.
	 */
	private _pinWidth(container: HTMLElement): void {
		container.style.setProperty('--openide-menu-anchor-width', `${Math.max(0, Math.round(this.anchor.getBoundingClientRect().width))}px`);
		// The popover mounts in the workbench's context-view layer, outside `.openide-chat-native`,
		// so it opts in to the file icon theme itself — same per-surface class Copilot uses.
		container.classList.add('show-file-icons');
	}

	/** `renderSlashGhost` (the removed chat webview): the accepted command and its argument hint. */
	private _renderGhost(): void {
		const ghost = this._ghost;
		if (!ghost) { return; }
		this._popover.show(this.anchor, {
			className: 'openide-chat-suggest-menu',
			render: container => {
				this._pinWidth(container);
				container.classList.add('openide-chat-suggest');
				const content = append(container, createMenuContent(container.ownerDocument));
				const row = append(content, container.ownerDocument.createElement('div'));
				row.className = 'openide-menu-row openide-chat-suggest-ghost';
				const slot = append(row, container.ownerDocument.createElement('span'));
				slot.className = 'openide-menu-row-icon';
				slot.appendChild(createCodicon(container.ownerDocument, 'terminal'));
				// The ghost is one row of the same list, so it lays out like one: name left, hint
				// right, on a single line. It kept the stacked wrapper the entries used to have.
				const label = append(row, container.ownerDocument.createElement('span'));
				label.className = 'openide-menu-label';
				label.textContent = `/${ghost.slug}`;
				const hint = append(row, container.ownerDocument.createElement('span'));
				hint.className = 'openide-menu-detail';
				hint.textContent = ghost.hint;
				row.setAttribute('aria-label', localize('openide.chat.suggest.hint', "/{0} {1}", ghost.slug, ghost.hint));
			},
		});
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}
