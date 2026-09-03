/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/path.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IChatCapabilityMention } from '../../common/openideAgentTypes.js';
import { t } from '../../common/openideStrings.js';
import { IComposerSnippet, sameSnippet, SNIPPET_LIMIT } from '../../common/chat/openideChatSnippet.js';
import { appendSnippetCard } from './openideChatSnippetCard.js';
import { setupChatTooltip } from './openideChatHover.js';
import { createCodicon } from './openideComposerMenu.js';

/** Eight is the webview host's ceiling (`openideChatView.ts` `references.length >= 8`). */
export const REFERENCE_LIMIT = 8;

/** Codicon per capability kind, transcribed from `capabilityIcon` (the removed chat webview). */
export function capabilityIcon(kind: IChatCapabilityMention['kind'] | 'mcp' | 'tool'): string {
	return kind === 'skill' ? 'sparkle' : kind === 'command' ? 'terminal' : kind === 'mcp' ? 'plug' : 'tools';
}

/**
 * Strips the `/name` prefixes of the selected capabilities from the typed text
 * (`capabilityText`, the removed chat webview): the chips already say it.
 */
export function capabilityText(text: string, capabilities: readonly IChatCapabilityMention[]): string {
	let body = String(text || '').trimStart();
	for (const capability of capabilities) {
		const prefix = `/${capability.name}`;
		if (body === prefix) { body = ''; }
		else if (body.startsWith(`${prefix} `)) { body = body.slice(prefix.length).trimStart(); }
	}
	return body;
}

/** `normalizeComposerLink` (the removed chat webview). */
export function normalizeComposerLink(raw: string): { url: string; suffix: string } | undefined {
	let candidate = String(raw || '').trim();
	let suffix = '';
	const trailing = candidate.match(/[),.;!?]+$/);
	if (trailing) { suffix = trailing[0]; candidate = candidate.slice(0, -suffix.length); }
	if (/^www\./i.test(candidate)) { candidate = `https://${candidate}`; }
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
		return { url: parsed.href, suffix };
	} catch {
		return undefined;
	}
}

/**
 * Pulls the URLs out of a text and returns what is left (`extractComposerLinks`,
 * the removed chat webview). A URL inside markup (`xmlns="…"`, `href="…"`) is NOT an attached link:
 * it stays, so pasting SVG or HTML does not leave empty attributes behind.
 */
export function extractComposerLinks(text: string): { text: string; links: string[] } {
	const links: string[] = [];
	let body = String(text || '').replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, (raw: string, offset: number, source: string) => {
		const before = String(source || '').slice(0, Number(offset) || 0);
		if (/[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*["']?$/.test(before)) { return raw; }
		const parsed = normalizeComposerLink(raw);
		if (!parsed) { return raw; }
		if (!links.includes(parsed.url)) { links.push(parsed.url); }
		return parsed.suffix;
	});
	body = body.replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n');
	return { text: body, links };
}

/** `linkLabel` (the removed chat webview): host plus path, never the scheme. */
export function linkLabel(url: string): string {
	try {
		const parsed = new URL(url);
		const tail = (parsed.pathname === '/' ? '' : parsed.pathname) + parsed.search + parsed.hash;
		return parsed.hostname + tail;
	} catch {
		return String(url || '').replace(/^https?:\/\//i, '');
	}
}

export interface IComposerPayload {
	/** What the host receives: `/command` first, then the typed text and the links. */
	readonly text: string;
	/** What the bubble shows: the chip labels and the typed text. */
	readonly displayText: string;
}

/**
 * `composerPayload` (the removed chat webview): assembles the text the host expands and the text
 * the bubble shows. The links are re-expanded into the model text, one per line.
 */
export function composerPayload(inputText: string, capabilities: readonly IChatCapabilityMention[], links: readonly string[]): IComposerPayload {
	const plain = String(inputText || '').trim();
	const labels = capabilities.map(capability => `/${capability.name}`).join(' ');
	const command = capabilities.find(capability => capability.kind === 'command');
	const linkText = links.join('\n');
	const content = [plain, linkText].filter(Boolean).join('\n');
	return {
		text: command ? `/${command.name}${content ? ` ${content}` : ''}` : (content || labels),
		displayText: [labels, plain].filter(Boolean).join(' '),
	};
}

export interface IComposerReference {
	readonly path: string;
	/** File icon theme classes, if the suggestion carried them. */
	readonly iconClasses?: string;
}

/**
 * The three chip strips above the prompt: file references (`@`), capabilities (`/`) and pasted
 * links. Transcribed from `renderFileReferences` (the removed chat webview), `renderCapabilityChips`
 * (:2598) and `renderLinkChips` (:2662).
 *
 * Holds the state the chips show, the way the attachments strip holds its images: the chips are
 * part of the message being composed, travel with it on Send and come back if it is rejected.
 */
export class OpenideChatComposerChips extends Disposable {

	private readonly _referenceStrip: HTMLElement;
	private readonly _capabilityStrip: HTMLElement;
	private readonly _linkStrip: HTMLElement;
	private readonly _chipStore = this._register(new DisposableStore());

	private _references: IComposerReference[] = [];
	private _capabilities: IChatCapabilityMention[] = [];
	private _links: string[] = [];
	/** Editor selections sent to the chat. They share the reference strip: both say "this file". */
	private _snippets: IComposerSnippet[] = [];

	get references(): readonly IComposerReference[] { return this._references; }
	get capabilities(): readonly IChatCapabilityMention[] { return this._capabilities; }
	get links(): readonly string[] { return this._links; }
	get snippets(): readonly IComposerSnippet[] { return this._snippets; }
	get isEmpty(): boolean { return !this._references.length && !this._capabilities.length && !this._links.length && !this._snippets.length; }

	constructor(
		host: HTMLElement,
		private readonly hoverService: IHoverService,
		private readonly onDidChange: () => void,
		private readonly focusPrompt: () => void,
	) {
		super();
		const document = host.ownerDocument;
		this._referenceStrip = append(host, document.createElement('div'));
		this._referenceStrip.className = 'openide-chat-reference-strip';
		this._capabilityStrip = append(host, document.createElement('div'));
		this._capabilityStrip.className = 'openide-chat-capability-strip';
		this._linkStrip = append(host, document.createElement('div'));
		this._linkStrip.className = 'openide-chat-link-strip';
		this._render();
	}

	/** Returns false when the limit is reached; the caller decides whether to say so. */
	addReference(reference: IComposerReference): boolean {
		if (this._references.some(candidate => candidate.path === reference.path)) { return true; }
		if (this._references.length >= REFERENCE_LIMIT) { return false; }
		this._references.push(reference);
		this._render();
		return true;
	}

	/** Same range twice is one chip; false when the limit is reached, and the caller says so. */
	addSnippet(snippet: IComposerSnippet): boolean {
		if (this._snippets.some(candidate => sameSnippet(candidate, snippet))) { return true; }
		if (this._snippets.length >= SNIPPET_LIMIT) { return false; }
		this._snippets.push(snippet);
		this._render();
		return true;
	}

	/** A command replaces the previous command: one per message (acceptSlash, the removed chat webview). */
	addCapability(capability: IChatCapabilityMention): void {
		if (capability.kind === 'command') {
			this._capabilities = this._capabilities.filter(candidate => candidate.kind !== 'command');
		}
		if (!this._capabilities.some(candidate => candidate.kind === capability.kind && candidate.name === capability.name)) {
			this._capabilities.push(capability);
		}
		this._render();
	}

	addLinks(links: readonly string[]): void {
		let changed = false;
		for (const url of links) {
			if (!this._links.includes(url)) { this._links.push(url); changed = true; }
		}
		if (changed) { this._render(); }
	}

	restore(references: readonly IComposerReference[], capabilities: readonly IChatCapabilityMention[], links: readonly string[], snippets: readonly IComposerSnippet[] = []): void {
		this._references = [...references];
		this._capabilities = [...capabilities];
		this._links = [...links];
		this._snippets = [...snippets];
		this._render();
	}

	clear(): void {
		if (this.isEmpty) { return; }
		this._references = [];
		this._capabilities = [];
		this._links = [];
		this._snippets = [];
		this._render();
	}

	private _render(): void {
		const document = this._referenceStrip.ownerDocument;
		this._chipStore.clear();
		clearNode(this._referenceStrip);
		clearNode(this._capabilityStrip);
		clearNode(this._linkStrip);
		this._referenceStrip.hidden = !this._references.length && !this._snippets.length;
		this._capabilityStrip.hidden = !this._capabilities.length;
		this._linkStrip.hidden = !this._links.length;

		for (const reference of this._references) {
			const chip = append(this._referenceStrip, document.createElement('span'));
			chip.className = 'openide-chat-reference-chip';
			this._chipStore.add(setupChatTooltip(this.hoverService, chip, () => reference.path, { aria: false }));
			const icon = append(chip, document.createElement('span'));
			icon.className = reference.iconClasses ? `openide-chat-file-icon ${reference.iconClasses}` : 'codicon codicon-file';
			const name = append(chip, document.createElement('span'));
			name.className = 'openide-chat-chip-name';
			name.textContent = basename(reference.path);
			this._removeButton(chip, () => t('chat.chip.removeReference'), () => {
				this._references = this._references.filter(candidate => candidate.path !== reference.path);
			});
		}

		for (const snippet of this._snippets) {
			// The same card the bubble will show once this is sent (openideChatSnippetCard.ts),
			// plus the remove button only the composer has. The range is what tells two cards of
			// one file apart, so it is part of the label, not the hover.
			const { card, head, title } = appendSnippetCard(this._referenceStrip, snippet);
			this._chipStore.add(setupChatTooltip(this.hoverService, card, () => title, { aria: false }));
			this._removeButton(head, () => t('chat.chip.removeSnippet'), () => {
				this._snippets = this._snippets.filter(candidate => !sameSnippet(candidate, snippet));
			});
		}

		for (const capability of this._capabilities) {
			// Copilot's slash pill: tinted text on `chat.slashCommandBackground`, no icon — the
			// leading `/` already says what it is (chatColors.ts:36-46).
			const chip = append(this._capabilityStrip, document.createElement('span'));
			chip.className = `openide-chat-capability-chip ${capability.kind}`;
			const name = append(chip, document.createElement('span'));
			name.className = 'openide-chat-chip-name';
			name.textContent = `/${capability.name}`;
			const kindLabel = capability.kind === 'mcp' ? 'MCP' : capability.kind.charAt(0).toUpperCase() + capability.kind.slice(1);
			this._chipStore.add(setupChatTooltip(this.hoverService, chip, () => `${kindLabel}: ${capability.name}`, { aria: false }));
			this._removeButton(chip, () => t('chat.chip.removeCapability'), () => {
				this._capabilities = this._capabilities.filter(candidate => candidate !== capability);
			});
		}

		for (const url of this._links) {
			const chip = append(this._linkStrip, document.createElement('span'));
			chip.className = 'openide-chat-link-chip';
			this._chipStore.add(setupChatTooltip(this.hoverService, chip, () => url, { aria: false }));
			chip.appendChild(createCodicon(document, 'link'));
			const label = append(chip, document.createElement('span'));
			label.className = 'openide-chat-chip-name';
			label.textContent = linkLabel(url);
			this._removeButton(chip, () => t('chat.chip.removeLink'), () => {
				this._links = this._links.filter(candidate => candidate !== url);
			});
		}
		this.onDidChange();
	}

	private _removeButton(chip: HTMLElement, title: () => string, remove: () => void): void {
		const document = chip.ownerDocument;
		const button = append(chip, document.createElement('button'));
		button.type = 'button';
		button.className = 'openide-chat-chip-remove';
		// Per repaint, so it dies with the chip it belongs to.
		this._chipStore.add(setupChatTooltip(this.hoverService, button, title));
		button.appendChild(createCodicon(document, 'close'));
		this._chipStore.add(addDisposableListener(button, 'click', event => {
			event.stopPropagation();
			remove();
			this._render();
			this.focusPrompt();
		}));
	}
}
