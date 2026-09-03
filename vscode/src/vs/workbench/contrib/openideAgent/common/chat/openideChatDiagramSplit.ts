/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatContent, IOpenideChatMarkdownContent } from './openideChatContent.js';
import {
	getOpenideChatContentAt, IOpenideChatDraft, OPENIDE_CHAT_NO_INDEX, pushOpenideChatContent,
	removeOpenideChatContentAt, setOpenideChatContentAt,
} from './openideChatReducerState.js';

/**
 * Pulling ```mermaid fences out of the prose and into their own rows.
 *
 * `IOpenideChatDiagramContent` and `OpenideChatDiagramPart` were both written and both wired into
 * the renderer, and nothing ever produced one: the reducer put every fence into the markdown block,
 * where the workbench's markdown renderer draws it as a code block. The picture was unreachable —
 * not missing, unreachable — and this module is the missing half.
 *
 * The languages are the webview's (`buildDiagramOrCodeHtml`, the removed chat webview). Every other
 * info string stays inside the markdown and keeps being a code block, which is why this splits the
 * text rather than replacing the renderer: `edit_file` snippets, shell transcripts and JSON are the
 * overwhelming majority of fences and none of them want a frame around them.
 */
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'flowchart', 'diagram']);

/**
 * A CLOSED fence. Streaming is exactly why the closing ``` is required: half a graph parses to a
 * different, wrong picture on nearly every delta, and re-laying out a graph is the most expensive
 * thing any content part does.
 *
 * The webview held a "Generando diagrama…" shimmer over the open fence for that same reason. Here
 * the open fence is held out of the prose by `splitOpenOpenideChatDiagram` and the turn's live line
 * says what is being drawn, so the reader never watches raw graph JSON scroll past.
 */
const FENCE = /```([^\n]*)\n([\s\S]*?)```/g;

/**
 * A fence that has been OPENED but whose info line has not finished arriving: the text ends in
 * ```` ```flowm ```` with no newline yet.
 *
 * This is the one-delta window that painted an EMPTY grey box under the answer. `marked` runs with
 * `fillInIncompleteTokens` while a turn streams, so it closes that dangling fence for us and hands
 * back a code block with nothing in it — and a provider that pauses on the chunk boundary before
 * the body (which is where they naturally pause, right before a long JSON) leaves that box on
 * screen for seconds. It reads as a broken widget, which is exactly what it was reported as.
 *
 * Holding the line back instead loses nothing: an unterminated fence opener HAS no content, so
 * there is nothing to show either way. Any language, not only the diagrams — the info string is
 * precisely what has not arrived yet, so there is nothing to branch on.
 */
const OPENING_FENCE = /```[^\n]*$/;

function isDiagramLanguage(info: string): boolean {
	return DIAGRAM_LANGUAGES.has(info.trim().toLowerCase());
}

/** A run of markdown, or one diagram. Ordered as they appeared in the text. */
export type OpenideChatMarkdownSegment =
	| { readonly kind: 'markdown'; readonly value: string }
	| { readonly kind: 'diagram'; readonly syntax: string; readonly source: string };

/**
 * Splits prose into markdown runs and diagrams.
 *
 * Pure and total: text with no diagram fence comes back as one markdown segment holding exactly the
 * input, so callers can use it unconditionally. Empty markdown runs are dropped — the blank line
 * around a fence is not a paragraph, and an empty markdown row still costs a row.
 */
export function splitOpenideChatDiagrams(text: string): readonly OpenideChatMarkdownSegment[] {
	const segments: OpenideChatMarkdownSegment[] = [];
	let cursor = 0;
	FENCE.lastIndex = 0;
	for (let match = FENCE.exec(text); match; match = FENCE.exec(text)) {
		if (!isDiagramLanguage(match[1])) {
			continue; // an ordinary code block: it belongs to the prose around it
		}
		const before = text.slice(cursor, match.index);
		if (before) {
			segments.push({ kind: 'markdown', value: before });
		}
		segments.push({ kind: 'diagram', syntax: match[1].trim().toLowerCase(), source: match[2] });
		cursor = match.index + match[0].length;
	}
	const rest = text.slice(cursor);
	if (rest || !segments.length) {
		segments.push({ kind: 'markdown', value: rest });
	}
	return segments;
}

/**
 * The trailing UNCLOSED diagram fence of a streaming message, if there is one.
 *
 * The closed-fence rule above still stands: nothing is extracted until the fence closes. This is
 * for the markdown part's PRESENTATION only — while the source streams the reader gets the prose
 * and the turn's live line, instead of watching raw JSON scroll by. The source keeps accumulating
 * in the markdown content untouched, which is why this returns the split point rather than
 * mutating anything.
 *
 * `syntax` is `''` when the fence's info line has not finished arriving: hold the text, claim
 * nothing. Any other value is a diagram language.
 */
export function splitOpenOpenideChatDiagram(text: string): { readonly prose: string; readonly syntax: string } | undefined {
	FENCE.lastIndex = 0;
	let tail = 0;
	for (let match = FENCE.exec(text); match; match = FENCE.exec(text)) {
		tail = match.index + match[0].length;
	}
	const rest = text.slice(tail);
	const open = /```([^\n]*)\n/.exec(rest);
	if (open) {
		return isDiagramLanguage(open[1])
			? { prose: text.slice(0, tail + open.index), syntax: open[1].trim().toLowerCase() }
			: undefined;
	}
	// The info line is still arriving. `syntax` is empty because the language is not knowable yet,
	// and callers must treat that as "hold the text back, claim nothing": the live line has no
	// business announcing a diagram over a fence that may turn out to be shell.
	const opening = OPENING_FENCE.exec(rest);
	return opening ? { prose: text.slice(0, tail + opening.index), syntax: '' } : undefined;
}

function toContent(segment: OpenideChatMarkdownSegment): IOpenideChatContent {
	return segment.kind === 'diagram'
		? { kind: 'diagram', syntax: segment.syntax, source: segment.source }
		: { kind: 'markdown', value: { value: segment.value } };
}

/**
 * Pushes a finished block of prose, diagrams and all. For restore, where the whole message is known
 * at once and no block stays open for the next delta.
 */
export function pushOpenideChatMarkdownBlock(draft: IOpenideChatDraft, text: string): void {
	for (const segment of splitOpenideChatDiagrams(text)) {
		if (segment.kind === 'markdown' && !segment.value) {
			continue;
		}
		pushOpenideChatContent(draft, toContent(segment));
	}
}

/**
 * Extracts the diagrams that have finished streaming out of the OPEN markdown block.
 *
 * Incremental by construction, and that is the whole trick: the open block only ever holds the text
 * that arrived after the last diagram was extracted, so re-running this on every delta cannot
 * re-emit a diagram already on screen. It is also why nothing here needs to remember what it has
 * seen — the content list is the memory.
 *
 * Leaves the trailing prose OPEN (`markdownIndex` pointing at it) so the next delta keeps appending
 * to the same paragraph instead of starting a new row per token.
 */
export function extractOpenideChatDiagrams(draft: IOpenideChatDraft): void {
	const open = getOpenideChatContentAt<IOpenideChatMarkdownContent>(draft, draft.markdownIndex, 'markdown');
	if (!open) {
		return;
	}
	const segments = splitOpenideChatDiagrams(open.value.value);
	if (!segments.some(segment => segment.kind === 'diagram')) {
		return;
	}

	// The open block is rewritten to whatever prose came FIRST, or removed when the fence opened the
	// message: keeping an empty paragraph above the picture would push it down by a row.
	const head = segments[0];
	const index = draft.markdownIndex;
	if (head.kind === 'markdown' && head.value) {
		setOpenideChatContentAt(draft, index, toContent(head));
	} else {
		// `removeOpenideChatContentAt` shifts every parked index, `markdownIndex` included, so this
		// closes the block as a side effect. Stated anyway: the loop below reads it.
		removeOpenideChatContentAt(draft, index);
		draft.markdownIndex = OPENIDE_CHAT_NO_INDEX;
	}

	// No empty markdown segment can reach here: the splitter drops them, so a message that ends on
	// the closing fence leaves `markdownIndex` closed and the next delta opens a fresh paragraph
	// under the picture.
	const rest = head.kind === 'markdown' ? segments.slice(1) : segments;
	for (const segment of rest) {
		const pushed = pushOpenideChatContent(draft, toContent(segment));
		draft.markdownIndex = segment.kind === 'markdown' ? pushed : OPENIDE_CHAT_NO_INDEX;
	}
}
