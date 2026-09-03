/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — ONE way to turn "before" and "after" into the compact diff the product shows.
 *
 *  Two surfaces paint an agent's change inline: the edit card in the transcript and the Agent
 *  Changes view in the sidebar. They used to have two answers to "what is the diff": the card got
 *  these functions, module-private inside the agent service, and the sidebar had none at all and
 *  sent the reader to a side-by-side editor tab. Whatever computes the lines has to be the same
 *  thing on both, or the two views disagree about a change they are both describing — so it
 *  lives here, in common, where a browser service and a sidebar view can both reach it and a
 *  test can run it without a DOM.
 *--------------------------------------------------------------------------------------------*/

import { linesDiffComputers } from '../../../../editor/common/diff/linesDiffComputers.js';
import { IPersistedFileDiff } from './openideAgentTypes.js';

/** One row of the compact diff: its kind and its text. `gap` is the hole between two hunks. */
export type OpenideDiffLine = NonNullable<IPersistedFileDiff['diffLines']>[number];

const DIFF_OPTIONS = { ignoreTrimWhitespace: false, maxComputationTimeMs: 3000, computeMoves: false } as const;

/** Width cap per row: the preview is read in a card, not an editor, and a minified line is noise. */
const MAX_COLUMNS = 240;

/**
 * Lines of a text for diffing. The EMPTY text has zero of them, which `split` disagrees with:
 * `''.split(/\n/)` is `['']`, one empty line, and the whole "a new file removed a line" family of
 * bugs comes from taking that literally.
 */
export function textLines(text: string): string[] {
	return text ? text.split(/\r\n|\r|\n/) : [];
}

/**
 * Counts added/removed lines between two texts.
 *
 * A file that DID NOT EXIST (or was empty) removes nothing, and one emptied out adds nothing.
 * Both are special-cased before the diff runs, exactly as upstream's own patch builder does for a
 * created file (`chatRepoInfo.ts`: `changeType === 'added'` emits `@@ -0,0 +N @@` and never calls
 * the computer). It is not an optimisation, it is the only correct answer: the computer's own
 * empty-side branch (`defaultLinesDiffComputer.ts`) maps `['']` to a real original range, so
 * creating a 21-line file reported `+21 −1` and the review painted a deleted-line band above line
 * 1 of a brand new file. Git says `+21 −0`, and so does this now.
 */
export function countDiff(oldStr: string, newStr: string): { added: number; removed: number } {
	if (!oldStr || !newStr) {
		return { added: newStr ? textLines(newStr).length : 0, removed: oldStr ? textLines(oldStr).length : 0 };
	}
	const result = linesDiffComputers.getDefault().computeDiff(textLines(oldStr), textLines(newStr), DIFF_OPTIONS);
	let added = 0;
	let removed = 0;
	for (const change of result.changes) {
		added += change.modified.length;
		removed += change.original.length;
	}
	return { added, removed };
}

/**
 * COMPACT unified diff of one change: hunks with 2 context lines, a `gap` between hunks, and caps
 * on rows and width. It is what the edit card persists and what the sidebar computes on demand.
 */
export function buildDiffPreview(oldStr: string, newStr: string, maxLines = 120): OpenideDiffLine[] {
	const cap = (line: string) => line.length > MAX_COLUMNS ? line.slice(0, MAX_COLUMNS) + '…' : line;
	// Same rule as `countDiff`: one side empty is a pure creation or a pure wipe, and running the
	// computer over a phantom empty line is what put a lone `-` at the top of every new file's card.
	if (!oldStr || !newStr) {
		const side = newStr ? 'add' as const : 'del' as const;
		const all = textLines(newStr || oldStr);
		const rows = all.slice(0, maxLines).map(line => ({ t: side, x: cap(line) }));
		return all.length > maxLines ? [...rows, { t: 'gap' as const, x: '⋯' }] : rows;
	}
	const o = textLines(oldStr);
	const n = textLines(newStr);
	const changes = linesDiffComputers.getDefault().computeDiff(o, n, DIFF_OPTIONS).changes;
	const out: OpenideDiffLine[] = [];
	let lastShown = 0; // last line (new side) already emitted
	for (const c of changes) {
		if (out.length >= maxLines) {
			out.push({ t: 'gap', x: '⋯' });
			break;
		}
		const ctxFrom = Math.max(Math.max(1, c.modified.startLineNumber - 2), lastShown + 1);
		if (lastShown && ctxFrom > lastShown + 1) {
			out.push({ t: 'gap', x: '⋯' });
		}
		for (let l = ctxFrom; l < c.modified.startLineNumber; l++) {
			out.push({ t: 'ctx', x: cap(n[l - 1] ?? '') });
		}
		for (let l = c.original.startLineNumber; l < c.original.endLineNumberExclusive; l++) {
			out.push({ t: 'del', x: cap(o[l - 1] ?? '') });
		}
		for (let l = c.modified.startLineNumber; l < c.modified.endLineNumberExclusive; l++) {
			out.push({ t: 'add', x: cap(n[l - 1] ?? '') });
		}
		lastShown = Math.max(lastShown, c.modified.endLineNumberExclusive - 1, c.modified.startLineNumber - 1);
	}
	return out.slice(0, maxLines);
}
