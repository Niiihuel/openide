/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — a code snippet attached to a message: the editor selection sent to the chat.
 *
 *  Continue's `RangeInFileWithContents` (core/index.d.ts) and its serialisation
 *  (processEditorContent.ts): the selection travels as a fenced block that names the language,
 *  the file and the 1-based line range, so the model can quote it back by location. Here it is
 *  one more attachment of the composer, next to `@` references and images, rather than text
 *  pasted into the prompt: it shows as a chip the user can remove, and it is serialised into the
 *  turn's `context` where every other attachment goes.
 *--------------------------------------------------------------------------------------------*/

export interface IComposerSnippet {
	/** Workspace-relative when the file is inside a folder of the workspace, else the full path. */
	readonly path: string;
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
	readonly text: string;
	/** The editor's language id, used as the fence's info string. */
	readonly languageId?: string;
	/** File icon theme classes, for the chip. */
	readonly iconClasses?: string;
	/** The file's URI as a string, for the surfaces that need the absolute file (a hosted CLI). */
	readonly uri?: string;
}

/** Snippets per message. A handful is a question; a dozen is a file, and `@` exists for that. */
export const SNIPPET_LIMIT = 6;
/** Characters per snippet. Above this the selection is a file, not a fragment. */
export const SNIPPET_MAX_CHARS = 20000;

function basename(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? path : path.slice(slash + 1);
}

/** `archivo.ts (12-40)` — Continue's context-item name, which is also how the fence is titled. */
export function snippetLabel(snippet: IComposerSnippet): string {
	return `${basename(snippet.path)} (${snippetRange(snippet)})`;
}

export function snippetRange(snippet: IComposerSnippet): string {
	return snippet.startLine === snippet.endLine ? String(snippet.startLine) : `${snippet.startLine}-${snippet.endLine}`;
}

export function sameSnippet(a: IComposerSnippet, b: IComposerSnippet): boolean {
	return a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;
}

/** A fence the snippet cannot close by accident: one backtick longer than its longest run. */
function fenceFor(text: string): string {
	let longest = 0;
	for (const run of text.match(/`{3,}/g) ?? []) {
		longest = Math.max(longest, run.length);
	}
	return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The snippets as the model reads them: a header saying where they come from, then one fenced
 * block per snippet titled with language, path and lines. Same vehicle and same voice as the
 * `@` references (`buildFileReferenceContext`), so the two never read as different kinds of thing.
 */
export function buildSnippetContext(snippets: readonly IComposerSnippet[]): string | undefined {
	if (!snippets.length) {
		return undefined;
	}
	const blocks = snippets.map(snippet => {
		const fence = fenceFor(snippet.text);
		const info = [snippet.languageId ?? '', `${snippet.path} (${snippetRange(snippet)})`].filter(Boolean).join(' ');
		return `${fence}${info}\n${snippet.text}\n${fence}`;
	});
	return `[Fragmentos que el usuario seleccionó en el editor — contenido al momento del mensaje]\n\n${blocks.join('\n\n')}`;
}
