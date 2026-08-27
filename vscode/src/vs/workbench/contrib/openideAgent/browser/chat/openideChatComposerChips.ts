/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/path.js';
import { localize } from '../../../../../nls.js';
import { IChatCapabilityMention } from '../../common/openideAgentTypes.js';
import { createCodicon } from './openideComposerMenu.js';

/** Eight is the webview host's ceiling (`openideChatView.ts` `references.length >= 8`). */
export const REFERENCE_LIMIT = 8;

/** Codicon per capability kind, transcribed from `capabilityIcon` (openideChatHtml.ts:2574). */
export function capabilityIcon(kind: IChatCapabilityMention['kind'] | 'mcp' | 'tool'): string {
	return kind === 'skill' ? 'sparkle' : kind === 'command' ? 'terminal' : kind === 'mcp' ? 'plug' : 'tools';
}

/**
 * Strips the `/name` prefixes of the selected capabilities from the typed text
 * (`capabilityText`, openideChatHtml.ts:2577): the chips already say it.
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

/** `normalizeComposerLink` (openideChatHtml.ts:2608). */
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
 * openideChatHtml.ts:2621). A URL inside markup (`xmlns="…"`, `href="…"`) is NOT an attached link:
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

/** `linkLabel` (openideChatHtml.ts:2642): host plus path, never the scheme. */
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
 * `composerPayload` (openideChatHtml.ts:4061): assembles the text the host expands and the text
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
 * links. Transcribed from `renderFileReferences` (openideChatHtml.ts:5776), `renderCapabilityChips`
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

	get references(): readonly IComposerReference[] { return this._references; }
	get capabilities(): readonly IChatCapabilityMention[] { return this._capabilities; }
	get links(): readonly string[] { return this._links; }
	get isEmpty(): boolean { return !this._references.length && !this._capabilities.length && !this._links.length; }

	constructor(
		host: HTMLElement,
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

	/** A command replaces the previous command: one per message (acceptSlash, openideChatHtml.ts:5933). */
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

	restore(references: readonly IComposerReference[], capabilities: readonly IChatCapabilityMention[], links: readonly string[]): void {
		this._references = [...references];
		this._capabilities = [...capabilities];
		this._links = [...links];
		this._render();
	}

	clear(): void {
		if (this.isEmpty) { return; }
		this._references = [];
		this._capabilities = [];
		this._links = [];
		this._render();
	}

	private _render(): void {
		const document = this._referenceStrip.ownerDocument;
		this._chipStore.clear();
		clearNode(this._referenceStrip);
		clearNode(this._capabilityStrip);
		clearNode(this._linkStrip);
		this._referenceStrip.hidden = !this._references.length;
		this._capabilityStrip.hidden = !this._capabilities.length;
		this._linkStrip.hidden = !this._links.length;

		for (const reference of this._references) {
			const chip = append(this._referenceStrip, document.createElement('span'));
			chip.className = 'openide-chat-reference-chip';
			chip.title = reference.path;
			const icon = append(chip, document.createElement('span'));
			icon.className = reference.iconClasses ? `openide-chat-file-icon ${reference.iconClasses}` : 'codicon codicon-file';
			const name = append(chip, document.createElement('span'));
			name.className = 'openide-chat-chip-name';
			name.textContent = basename(reference.path);
			this._removeButton(chip, localize('openide.chat.reference.remove', "Quitar referencia"), () => {
				this._references = this._references.filter(candidate => candidate.path !== reference.path);
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
			chip.title = `${kindLabel}: ${capability.name}`;
			this._removeButton(chip, localize('openide.chat.capability.remove', "Quitar"), () => {
				this._capabilities = this._capabilities.filter(candidate => candidate !== capability);
			});
		}

		for (const url of this._links) {
			const chip = append(this._linkStrip, document.createElement('span'));
			chip.className = 'openide-chat-link-chip';
			chip.title = url;
			chip.appendChild(createCodicon(document, 'link'));
			const label = append(chip, document.createElement('span'));
			label.className = 'openide-chat-chip-name';
			label.textContent = linkLabel(url);
			this._removeButton(chip, localize('openide.chat.link.remove', "Quitar link"), () => {
				this._links = this._links.filter(candidate => candidate !== url);
			});
		}
		this.onDidChange();
	}

	private _removeButton(chip: HTMLElement, title: string, remove: () => void): void {
		const document = chip.ownerDocument;
		const button = append(chip, document.createElement('button'));
		button.type = 'button';
		button.className = 'openide-chat-chip-remove';
		button.title = title;
		button.setAttribute('aria-label', title);
		button.appendChild(createCodicon(document, 'close'));
		this._chipStore.add(addDisposableListener(button, 'click', event => {
			event.stopPropagation();
			remove();
			this._render();
			this.focusPrompt();
		}));
	}
}
