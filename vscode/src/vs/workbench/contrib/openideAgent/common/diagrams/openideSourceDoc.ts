/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the header comment of a file, read as the explanation of the box that stands for it.
 *
 *  A map says a module exists and what it touches; it cannot say what it is FOR. That sentence is
 *  already written, at the top of the file the module is made of, by whoever wrote the code. This
 *  reads it back so the drawing explains itself with the project's own words instead of a label
 *  somebody has to invent and then keep in step.
 *
 *  The one rule that makes it work in practice: a LICENSE banner is not a description. Nearly every
 *  file in a real repository opens with one, and taking the first comment blindly would caption
 *  every node in this codebase "Copyright (c) OpenIDE. All rights reserved." So license-looking
 *  blocks are skipped and the next one is taken — which in this tree is exactly the block that
 *  explains the file.
 *
 *  PURE: text in, sentence out. No fs, no DOM, no language service.
 *--------------------------------------------------------------------------------------------*/

/** Only the head of the file is read: a description that starts on line 400 is not a header. */
const HEAD_CHARS = 8000;
/** Long enough for a real summary, short enough to sit in a panel beside the picture. */
const MAX_LENGTH = 320;

const LICENSE = /copyright|licensed under|license\b|spdx-license|all rights reserved/i;
/** The rules of a banner comment: `-----`, `=====`, `*****`, and the box drawing around them. */
const SEPARATOR = /^[-=*_#/\s]*$/;

interface IBlock {
	readonly lines: string[];
	/** Where the scanner continues after this block. */
	readonly next: number;
}

/** Reads ONE comment block starting at `index`, or undefined when there is no comment there. */
function readBlock(lines: readonly string[], index: number): IBlock | undefined {
	const first = lines[index]?.trim();
	if (!first) {
		return undefined;
	}
	if (first.startsWith('/*')) {
		const body: string[] = [];
		for (let i = index; i < lines.length; i++) {
			const line = lines[i];
			body.push(line);
			if (line.includes('*/')) {
				return { lines: body, next: i + 1 };
			}
		}
		// An unterminated block: everything that was read is still the header.
		return { lines: body, next: lines.length };
	}
	// A run of single-line comments is ONE block: that is how a header is written without `/* */`.
	const marker = first.startsWith('//') ? '//' : first.startsWith('#') && !first.startsWith('#!') ? '#' : undefined;
	if (!marker) {
		return undefined;
	}
	const body: string[] = [];
	let i = index;
	for (; i < lines.length && lines[i].trim().startsWith(marker); i++) {
		body.push(lines[i]);
	}
	return { lines: body, next: i };
}

/** Strips the comment markers and the banner rules, leaving the prose. */
function clean(block: readonly string[]): string[] {
	return block
		.map(line => line
			.replace(/^\s*\/\*+/, '')
			.replace(/\*+\/\s*$/, '')
			.replace(/^\s*\*+/, '')
			.replace(/^\s*\/\//, '')
			.replace(/^\s*#/, '')
			.trim())
		.filter(line => !SEPARATOR.test(line) || line === '');
}

/**
 * The file's own description, or undefined when it has none.
 *
 * What comes back is the FIRST paragraph of the first non-license header comment: the summary
 * sentence, not the whole essay that may follow it under it.
 */
export function leadingDocComment(text: string): string | undefined {
	const head = String(text ?? '').slice(0, HEAD_CHARS);
	const lines = head.split(/\r?\n/);
	let index = 0;
	if (lines[0]?.startsWith('#!')) {
		index = 1;
	}
	// At most a handful of blocks: license, maybe a lint pragma, then the real one.
	for (let attempt = 0; attempt < 4; attempt++) {
		while (index < lines.length && !lines[index].trim()) {
			index++;
		}
		const block = readBlock(lines, index);
		if (!block) {
			return undefined;
		}
		index = block.next;
		const body = clean(block.lines);
		const prose = body.join('\n').trim();
		if (!prose || LICENSE.test(prose)) {
			continue;
		}
		// The first paragraph only. A header that opens with "Name — one line" and then explains
		// itself for thirty lines has said the useful part first.
		const paragraph = prose.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
		if (!paragraph) {
			continue;
		}
		return paragraph.length > MAX_LENGTH ? `${paragraph.slice(0, MAX_LENGTH - 1).trimEnd()}…` : paragraph;
	}
	return undefined;
}
