/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pure per-message change-set engine. Touches neither the filesystem nor Git.
 *--------------------------------------------------------------------------------------------*/

import { LcsDiff } from '../../../../base/common/diff/diff.js';
import { StringSHA1 } from '../../../../base/common/hash.js';
import { FileChangeOperation, IFileChange, ITextPatch, ITextPatchHunk } from './openideAgentTypes.js';

const PATCH_CONTEXT_LINES = 3;

class LineSequence {
	constructor(private readonly lines: readonly string[]) { }
	getElements(): string[] { return [...this.lines]; }
	getStrictElement(index: number): string { return this.lines[index]; }
}

interface ITextParts {
	readonly lines: string[];
	readonly eol: '\n' | '\r\n';
	readonly endsWithEol: boolean;
}

function splitText(content: string): ITextParts {
	const eol = content.includes('\r\n') ? '\r\n' : '\n';
	const endsWithEol = content.endsWith('\n');
	const lines = content.length ? content.split(/\r?\n/) : [];
	if (endsWithEol) { lines.pop(); }
	return { lines, eol, endsWithEol };
}

function joinText(lines: readonly string[], eol: '\n' | '\r\n', endsWithEol: boolean): string {
	return lines.join(eol) + (endsWithEol ? eol : '');
}

/** SHA-1 is used as a deterministic content identifier, not as a security primitive. */
export function contentHash(content: string): string {
	const sha = new StringSHA1();
	sha.update(content);
	return sha.digest();
}

export function createTextPatch(beforeContent: string, afterContent: string): ITextPatch {
	const before = splitText(beforeContent);
	const after = splitText(afterContent);
	const changes = new LcsDiff(new LineSequence(before.lines), new LineSequence(after.lines)).ComputeDiff(false).changes;
	const hunks: ITextPatchHunk[] = changes.map(change => ({
		expectedStart: change.originalStart,
		contextBefore: before.lines.slice(Math.max(0, change.originalStart - PATCH_CONTEXT_LINES), change.originalStart),
		beforeLines: before.lines.slice(change.originalStart, change.originalStart + change.originalLength),
		afterLines: after.lines.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength),
		contextAfter: before.lines.slice(change.originalStart + change.originalLength, change.originalStart + change.originalLength + PATCH_CONTEXT_LINES),
	}));
	// EOF newline-only changes are not represented by line LCS; retain them as a sentinel hunk.
	if (before.endsWithEol !== after.endsWithEol) {
		// The contextAfter sentinel marks this hunk as belonging strictly to EOF.
		hunks.push({ expectedStart: before.lines.length, contextBefore: before.lines.slice(-PATCH_CONTEXT_LINES), beforeLines: [], afterLines: [], contextAfter: ['\0OPENIDE_EOF\0'] });
	}
	return {
		eol: after.eol,
		sourceEol: before.eol,
		targetEol: after.eol,
		sourceEndsWithEol: before.endsWithEol,
		targetEndsWithEol: after.endsWithEol,
		changesEol: before.eol !== after.eol,
		changesFinalNewline: before.endsWithEol !== after.endsWithEol,
		hunks,
	};
}

function equalAt(lines: readonly string[], index: number, needle: readonly string[]): boolean {
	if (index < 0 || index + needle.length > lines.length) { return false; }
	return needle.every((line, offset) => lines[index + offset] === line);
}

function matchesHunk(lines: readonly string[], start: number, hunk: ITextPatchHunk): boolean {
	if (hunk.contextAfter.length === 1 && hunk.contextAfter[0] === '\0OPENIDE_EOF\0') {
		return start === lines.length && equalAt(lines, start - hunk.contextBefore.length, hunk.contextBefore);
	}
	if (!equalAt(lines, start, hunk.beforeLines)) { return false; }
	const beforeMatches = hunk.contextBefore.length > 0 && equalAt(lines, start - hunk.contextBefore.length, hunk.contextBefore);
	const afterMatches = hunk.contextAfter.length > 0 && equalAt(lines, start + hunk.beforeLines.length, hunk.contextAfter);
	// One intact anchor is enough to tolerate a later non-overlapping edit on the other side;
	// with no matching anchor at all, historical identity is not safe.
	return beforeMatches || afterMatches || (hunk.contextBefore.length === 0 && hunk.contextAfter.length === 0);
}

function candidateStarts(lines: readonly string[], hunk: ITextPatchHunk): number[] {
	const contentHits: number[] = [];
	for (let i = 0; i <= lines.length - hunk.beforeLines.length; i++) {
		if (hunk.contextAfter[0] === '\0OPENIDE_EOF\0' || equalAt(lines, i, hunk.beforeLines)) { contentHits.push(i); }
	}
	// Content alone does not identify the historical occurrence. Requiring the context anchors
	// avoids modifying a semantically unrelated block that appeared later.
	return contentHits.filter(start => matchesHunk(lines, start, hunk));
}

export interface IApplyPatchResult {
	readonly content?: string;
	readonly conflict?: string;
}

/** Applies hunks onto a diverged version. Each hunk must be locatable exactly once; on absence
 *  or ambiguity it returns no content, guaranteeing zero destructive writes. */
export function applyTextPatch(currentContent: string, patch: ITextPatch, expectedResultContent?: string): IApplyPatchResult {
	if (currentContent.includes('\r\n') && /(^|[^\r])\n/.test(currentContent)) {
		return { conflict: 'El archivo tiene finales de línea mixtos; no se reescribirá de forma global.' };
	}
	const current = splitText(currentContent);
	if (patch.changesEol && patch.sourceEol && current.eol !== patch.sourceEol) {
		return { conflict: 'El estilo de finales de línea cambió después del mensaje.' };
	}
	if (patch.hunks.length === 0 && !patch.changesEol && !patch.changesFinalNewline) {
		return { content: currentContent };
	}
	const edits: Array<{ start: number; hunk: ITextPatchHunk }> = [];
	for (const hunk of patch.hunks) {
		let hits = candidateStarts(current.lines, hunk);
		// Do not pick by offset when there are repeats: a later change can shift lines and turn
		// that heuristic into a destructive edit on the wrong occurrence.
		if (hits.length !== 1) {
			return { conflict: hits.length ? 'El parche coincide en más de una ubicación.' : 'El contenido cambiado por el mensaje ya no está presente con contexto suficiente.' };
		}
		edits.push({ start: hits[0], hunk });
	}
	const sorted = edits.sort((a, b) => b.start - a.start);
	for (let i = 1; i < sorted.length; i++) {
		const previous = sorted[i - 1];
		const currentEdit = sorted[i];
		if (currentEdit.start + currentEdit.hunk.beforeLines.length > previous.start) {
			return { conflict: 'Los hunks inversos se superponen en la versión actual.' };
		}
	}
	const output = [...current.lines];
	for (const edit of sorted) {
		output.splice(edit.start, edit.hunk.beforeLines.length, ...edit.hunk.afterLines);
	}
	const expectedEndsWithEol = patch.changesFinalNewline
		? (patch.targetEndsWithEol ?? (expectedResultContent === undefined ? current.endsWithEol : splitText(expectedResultContent).endsWithEol))
		: current.endsWithEol;
	const outputEol = patch.changesEol ? (patch.targetEol ?? patch.eol) : current.eol;
	return { content: joinText(output, outputEol, expectedEndsWithEol) };
}

export function createFileChange(uri: string, operation: FileChangeOperation, beforeContent?: string, afterContent?: string, originalUri?: string): IFileChange {
	const before = beforeContent ?? '';
	const after = afterContent ?? '';
	return {
		uri,
		operation,
		originalUri,
		beforeContent,
		afterContent,
		beforeHash: operation === 'create' ? undefined : contentHash(before),
		afterHash: operation === 'delete' ? undefined : contentHash(after),
		forwardPatch: operation === 'modify' || operation === 'rename' ? createTextPatch(before, after) : undefined,
		reversePatch: operation === 'modify' || operation === 'rename' ? createTextPatch(after, before) : undefined,
	};
}

/** Consolidates the first before and the last after for the same path within a message. */
export function consolidateFileChange(previous: IFileChange | undefined, next: IFileChange): IFileChange | undefined {
	if (!previous) {
		if (next.operation === 'modify' && next.beforeContent === next.afterContent) { return undefined; }
		return next;
	}
	const originalUri = previous.originalUri ?? (previous.operation === 'rename' ? previous.originalUri : next.originalUri);
	const uri = next.uri;
	const beforeContent = previous.beforeContent;
	const afterContent = next.afterContent;
	const startedAbsent = previous.operation === 'create';
	const endedAbsent = next.operation === 'delete';
	if (startedAbsent && endedAbsent) { return undefined; }
	if (!startedAbsent && !endedAbsent && beforeContent === afterContent && (originalUri === undefined || originalUri === uri)) { return undefined; }
	let operation: FileChangeOperation;
	if (startedAbsent) { operation = 'create'; }
	else if (endedAbsent) {
		// rename A→B followed by delete B has the net effect of delete A.
		return createFileChange(originalUri ?? uri, 'delete', beforeContent, undefined);
	}
	else if (originalUri && originalUri !== uri) { operation = 'rename'; }
	else { operation = 'modify'; }
	return createFileChange(uri, operation, beforeContent, afterContent, originalUri);
}
