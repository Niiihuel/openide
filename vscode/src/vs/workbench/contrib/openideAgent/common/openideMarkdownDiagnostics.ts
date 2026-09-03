/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Small, dependency-free Markdown checks used by the OpenIDE command palette.
 *
 * This is intentionally not a Markdown parser. The editor and preview already have the real
 * parser; this module only reports the mistakes that are cheap to spot without changing the
 * document or making filesystem/network requests. Keeping it pure makes the command predictable
 * and gives the `.md` smoke fixture a useful regression target.
 */

export type OpenideMarkdownDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface IOpenideMarkdownDiagnostic {
	readonly severity: OpenideMarkdownDiagnosticSeverity;
	readonly line: number;
	readonly column: number;
	readonly message: string;
}

export interface IOpenideMarkdownStats {
	readonly headings: number;
	readonly links: number;
	readonly images: number;
	readonly tasks: number;
	readonly completedTasks: number;
	readonly codeBlocks: number;
}

export interface IOpenideMarkdownReport {
	readonly diagnostics: readonly IOpenideMarkdownDiagnostic[];
	readonly stats: IOpenideMarkdownStats;
}

interface IOpenFence {
	readonly character: '`' | '~';
	readonly length: number;
	readonly line: number;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|[ \t]*)$/;
const TASK_RE = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](?:\s+|$)/;
const LINK_RE = /(!?)\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
const UNSAFE_LINK_SCHEME_RE = /^(?:javascript|vbscript|data):/i;

function diagnostic(
	severity: OpenideMarkdownDiagnosticSeverity,
	line: number,
	message: string,
	column = 1,
): IOpenideMarkdownDiagnostic {
	return { severity, line, column, message };
}

/**
 * Runs conservative checks over Markdown source.
 *
 * Lines are one-based because the result is shown next to an editor and can be copied directly
 * into a search/go-to-line action. Fenced content is skipped for all other checks, so examples of
 * Markdown in a code block do not produce false positives.
 */
export function validateOpenideMarkdown(markdown: string): IOpenideMarkdownReport {
	const diagnostics: IOpenideMarkdownDiagnostic[] = [];
	const lines = markdown.split(/\r\n|\r|\n/);
	let openFence: IOpenFence | undefined;
	let previousHeadingLevel: number | undefined;
	let headings = 0;
	let links = 0;
	let images = 0;
	let tasks = 0;
	let completedTasks = 0;
	let codeBlocks = 0;

	for (let index = 0; index < lines.length; index++) {
		const lineNumber = index + 1;
		const line = lines[index];
		const fence = line.match(FENCE_RE);

		if (openFence) {
			if (fence
				&& fence[1][0] === openFence.character
				&& fence[1].length >= openFence.length
				&& !fence[2].trim()) {
				openFence = undefined;
			}
			continue;
		}

		if (fence) {
			openFence = { character: fence[1][0] as '`' | '~', length: fence[1].length, line: lineNumber };
			codeBlocks++;
			continue;
		}

		const heading = line.match(HEADING_RE);
		if (heading) {
			const level = heading[1].length;
			headings++;
			if (previousHeadingLevel !== undefined && level > previousHeadingLevel + 1) {
				diagnostics.push(diagnostic('warning', lineNumber, `El encabezado salta de H${previousHeadingLevel} a H${level}.`));
			}
			previousHeadingLevel = level;
		}

		const task = line.match(TASK_RE);
		if (task) {
			tasks++;
			if (task[1].toLowerCase() === 'x') {
				completedTasks++;
			}
		}

		LINK_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = LINK_RE.exec(line))) {
			const destination = match[2] ?? match[3] ?? '';
			links++;
			if (match[1]) {
				images++;
			}
			const trimmedDestination = destination.trim();
			if (UNSAFE_LINK_SCHEME_RE.test(trimmedDestination)) {
				const scheme = trimmedDestination.match(/^[a-z][a-z0-9+.-]*:/i)?.[0] ?? trimmedDestination;
				diagnostics.push(diagnostic('error', lineNumber, `El enlace usa un esquema no seguro: ${scheme}`, match.index + 1));
			}
		}
	}

	if (openFence) {
		diagnostics.push(diagnostic('error', openFence.line, 'El bloque de código no está cerrado.'));
	}

	return {
		diagnostics,
		stats: { headings, links, images, tasks, completedTasks, codeBlocks },
	};
}
