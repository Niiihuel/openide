/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IChatCapabilityMention, IChatImage } from '../../common/openideAgentTypes.js';

/**
 * The inner pieces of the user's bubble, kept out of the renderer so both files stay readable.
 *
 * Every geometry decision here is a transcription of the webview (browser/openideChatHtml.ts):
 * `appendCapabilityChip` at 2586-2598, `capabilityText` at 2577-2585, the image strip at 2705-2713
 * and the 78px clamp at 2761-2764. Nothing is re-designed — the webview is the visual contract.
 */

/**
 * Height in px past which the webview clamps the message to ~3 lines (openideChatHtml.ts:2762).
 * The clamp itself is 72px (`.msg-text.collapsed`); the trigger is deliberately a little higher so
 * a message that is exactly at the limit is not clamped for a couple of pixels.
 */
/** Height of one clamped line (px). 3 lines × 24 = the webview's original 72px window. */
const CLAMP_LINE_HEIGHT = 24;
/** Slack over the clamp height before the clamp actually engages, so a borderline message is not
 *  cut for a couple of pixels (same 6px allowance the fixed 78/72 pair encoded). */
const CLAMP_TRIGGER_SLACK = 6;

/** openideChatHtml.ts:2574-2576 — one codicon per capability kind. */
/** Human name of the kind, as used by the chip's tooltip in the webview. */
function capabilityKindLabel(kind: IChatCapabilityMention['kind']): string {
	return kind === 'mcp' ? 'MCP' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Drops the leading `/name` of each mention from the visible body (openideChatHtml.ts:2577-2585).
 *
 * Without this the chip and the text say the same thing twice: the mention is already rendered as
 * a chip above, so leaving `/review` at the head of the prose is a duplicate, not context.
 */
export function stripCapabilityPrefixes(text: string, capabilities: readonly IChatCapabilityMention[] | undefined): string {
	let body = String(text ?? '').trimStart();
	for (const capability of capabilities ?? []) {
		const prefix = `/${capability.name}`;
		if (body === prefix) {
			body = '';
		} else if (body.startsWith(`${prefix} `)) {
			body = body.slice(prefix.length).trimStart();
		}
	}
	return body;
}

/**
 * Rebuilds the mention chips. Read-only: the `capability-remove` button of the webview only exists
 * in the composer's strip, never inside a message that was already sent.
 */
export function renderCapabilityChips(host: HTMLElement, capabilities: readonly IChatCapabilityMention[] | undefined): void {
	clearNode(host);
	const mentions = capabilities ?? [];
	host.classList.toggle('hidden', mentions.length === 0);
	for (const capability of mentions) {
		// Copilot's slash pill: tinted text on `chat.slashCommandBackground`, no icon — the
		// leading `/` already says what it is (chatColors.ts:36-46).
		const chip = append(host, $(`span.openide-chat-capability-chip.openide-chat-capability-${capability.kind}`));
		chip.title = `${capabilityKindLabel(capability.kind)}: ${capability.name}`;
		const name = append(chip, $('span.openide-chat-capability-name'));
		name.textContent = `/${capability.name}`;
	}
}

/**
 * Rebuilds the attachment thumbnails.
 *
 * Images whose `data` is empty are skipped: `OpenideChatSessions` drops the base64 of anything it
 * could persist as an asset (openideChatSessions.ts:160), and only the webview view pane hydrates
 * it back. Painting an `<img>` with an empty `src` would show a broken-image glyph instead.
 */
export function renderImageStrip(host: HTMLElement, images: readonly IChatImage[] | undefined): void {
	clearNode(host);
	const renderable = (images ?? []).filter(image => !!image.data);
	host.classList.toggle('hidden', renderable.length === 0);
	for (const image of renderable) {
		const frame = append(host, $('div.openide-chat-request-image'));
		const element = append(frame, $('img')) as HTMLImageElement;
		element.src = `data:${image.mimeType};base64,${image.data}`;
	}
}

/**
 * Applies the webview's 3-line clamp and its click-to-expand.
 *
 * `scrollHeight` is read while the row is already attached — the list view inserts the row into
 * `rowsContainer` before calling `renderElement` (listView.ts:1005-1022) — but a detached probe
 * would report 0, and clamping on a 0 measurement would collapse every message. Hence the guard.
 */
export function applyTextClamp(text: HTMLElement, store: DisposableStore, onExpand: () => void, clampLines = 3): void {
	text.classList.remove('openide-chat-request-collapsed', 'openide-chat-request-faded');
	text.style.removeProperty('--openide-chat-clamp-height');
	// `openide.chat.userMessage.clampLines`: 0 disables the clamp — the full prompt always shows.
	if (clampLines <= 0) {
		return;
	}
	const clampHeight = clampLines * CLAMP_LINE_HEIGHT;
	if (!text.textContent || text.scrollHeight <= clampHeight + CLAMP_TRIGGER_SLACK) {
		return;
	}
	text.style.setProperty('--openide-chat-clamp-height', `${clampHeight}px`);
	text.classList.add('openide-chat-request-collapsed', 'openide-chat-request-faded');
	store.add(addDisposableListener(text, 'click', () => {
		if (!text.classList.contains('openide-chat-request-collapsed')) {
			return;
		}
		text.classList.remove('openide-chat-request-collapsed', 'openide-chat-request-faded');
		// The row just grew past the height the list measured for it; without this the extra lines
		// are painted outside the row's box and the next row overlaps them.
		onExpand();
	}));
}
