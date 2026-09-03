/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from '../openideStrings.js';
import { IOpenideChatContent, IOpenideChatExploreEntry } from './openideChatContent.js';
import { splitOpenOpenideChatDiagram } from './openideChatDiagramSplit.js';
import { basenameForChat, compactExploreDetail, getOpenideToolMeta, toolDetailFor } from './openideChatToolMeta.js';

/**
 * What the ONE live line of a running turn says.
 *
 * A step in flight is not a row in the transcript: it is a line that replaces the previous step in
 * place, the way Cursor's status does. The transcript used to grow a row per step WHILE it ran —
 * a collapsible "Exploring" block with its own chevron plus a row per tool call — so a turn read
 * as a tree of things happening at once instead of as one thing happening now. Settled steps still
 * land in the transcript (that is the record of what the agent touched); only the in-flight one is
 * hoisted out of it and into this line.
 *
 * Pure and in `common/` because it is the wording, not the animation: the swap and the shimmer are
 * `browser/chat/openideChatStatusLine.ts`, and this file is what a test can assert on.
 */

/** Every kind that owns a LIVE surface of its own, so the status line steps aside for it. */
function ownsItsOwnMotion(content: IOpenideChatContent): boolean {
	switch (content.kind) {
		// Live reasoning is already moving text; a second animated line under it is one motion too
		// many, and the reasoning card's own summary already shimmers.
		case 'thinking':
			return true;
		// Parked on the user: a status saying the agent is working would be a lie while it waits.
		case 'ask':
		case 'confirmation':
		case 'accountChoice':
		case 'modeSuggestion':
			return true;
		default:
			return false;
	}
}

/** "Read openideChatWidget.ts" — the same sentence the settled row shows, in the present tense. */
export function openideChatToolStepLabel(name: string, argumentsJson: string | undefined): string {
	const meta = getOpenideToolMeta(name);
	// The basename and not the full path: the line is a single row that has to survive a 280px dock,
	// and the directory is the half an ellipsis would eat anyway.
	const detail = compactExploreDetail(meta, toolDetailFor(meta, argumentsJson));
	return detail ? `${meta.verb} ${detail}` : meta.verb;
}

export function openideChatExploreStepLabel(entry: IOpenideChatExploreEntry): string {
	const meta = getOpenideToolMeta(entry.tool);
	return entry.target ? `${meta.verb} ${entry.target}` : meta.verb;
}

export interface IOpenideChatLiveStatus {
	readonly text: string;
	/**
	 * True for the GENERIC wait ("Planning next moves"), false for a real step ("Read a.ts").
	 *
	 * The distinction is not cosmetic and it is the whole reason this is not a plain string. The
	 * gap between one call settling and the next one starting is usually a few hundred
	 * milliseconds, so a line that switched to the generic wait the instant a step finished spent
	 * most of the turn saying "Planning next moves" and flashed the real steps past unread. The
	 * status line therefore HOLDS the last step and only admits the generic wait once the pause is
	 * long enough to be a real one — see `openideChatStatusLine.ts`.
	 */
	readonly idle: boolean;
}

function step(text: string): IOpenideChatLiveStatus {
	return { text, idle: false };
}

/** The agent is between steps: true of every branch that has no step of its own to name. */
function waiting(): IOpenideChatLiveStatus {
	return { text: t('chat.working.next'), idle: true };
}

/**
 * The live line's state, or `undefined` when nothing should be shown.
 *
 * Only the TAIL of the content is consulted: anything before it already produced its outcome and
 * is on screen as a settled row. `isComplete` is the turn's, not the content's — a finished turn
 * has no live line at all.
 */
export function openideChatLiveStatusLabel(content: readonly IOpenideChatContent[], isComplete: boolean): IOpenideChatLiveStatus | undefined {
	if (isComplete) {
		return undefined;
	}
	const last = content[content.length - 1];
	// Before the first event of the turn there is nothing else on screen to explain the wait.
	if (!last) {
		return { text: t('chat.working.thinking'), idle: true };
	}
	if (ownsItsOwnMotion(last)) {
		return undefined;
	}
	switch (last.kind) {
		case 'markdown':
			// Prose speaks for itself — EXCEPT while a diagram fence is open. Then the text on screen
			// has stopped growing and what is streaming is the diagram's source, which is deliberately
			// not shown (a half-written graph parses to a different, wrong picture on every delta).
			// Nothing would be moving at all, so the live line says what is being drawn until the
			// fence closes and the picture takes its place.
			// `syntax` is empty while the fence's own info line is still arriving: the text is held
			// back (there is no content in an unterminated opener) but nothing is claimed, because
			// a fence that has not said what it is may not be a diagram at all.
			return splitOpenOpenideChatDiagram(last.value.value)?.syntax ? step(t('diagram.streaming')) : undefined;
		case 'tool':
			return last.state === 'running'
				? step(openideChatToolStepLabel(last.name, last.argumentsJson))
				: waiting();
		case 'explore': {
			// The newest running read, so parallel reads read as the latest step rather than as the
			// oldest one lingering.
			for (let i = last.entries.length - 1; i >= 0; i--) {
				if (last.entries[i].state === 'running') {
					return step(openideChatExploreStepLabel(last.entries[i]));
				}
			}
			return waiting();
		}
		case 'terminal':
			// A live terminal is a surface with its own output scrolling; only a finished one leaves
			// the line free to say what comes next.
			return last.state === 'exited' ? waiting() : undefined;
		case 'subagent':
			// A running specialist gets the line, rather than the line stepping aside for it. The
			// row underneath says WHO is working and how much it has done; what it never said is
			// that the turn is still going, so a delegation that takes a minute looked like the
			// answer had simply stopped. `total` is the size of the delegation the row belongs to,
			// so a fan-out reads as one sentence instead of the name of whichever specialist
			// happens to be last.
			return last.status === 'running'
				? step(last.total > 1
					? t('chat.working.delegatingMany', String(last.total))
					: t('chat.working.delegating', last.title))
				: waiting();
		case 'progress':
			// The fallback row for an event nobody wrote a part for. A shimmering one is a STEP —
			// it is the same sentence the status line exists to say, so it says it there and the
			// row stands down (`OpenideChatProgressPart`); a settled one is a note and stays put.
			return last.shimmer !== false ? step(last.text) : waiting();
		case 'edit':
			// The card shimmers its filename until the diff lands, so it is already speaking.
			return last.diff.diffLines
				? waiting()
				: step(`${getOpenideToolMeta('edit_file').verb} ${basenameForChat(last.diff.path)}`);
		default:
			return waiting();
	}
}

/**
 * Whether the part at `index` is the step currently IN FLIGHT, and therefore the one the status
 * line is speaking for.
 *
 * The renderer, not the part, answers this: a part learns that something came after it only from
 * `hasSameContent`, and that is a pure query which must not be the thing that moves the row.
 */
export function isOpenideChatLiveTail(content: readonly IOpenideChatContent[], index: number, isComplete: boolean): boolean {
	return !isComplete && index === content.length - 1;
}
