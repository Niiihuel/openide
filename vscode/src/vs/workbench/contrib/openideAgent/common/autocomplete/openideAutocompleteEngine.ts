/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the autocomplete engine: what goes to the model and what comes back.
 *
 *  Ported from Continue's tab autocomplete (core/autocomplete): prefix/suffix around the caret,
 *  pruned to a budget; a fill-in-the-middle prompt; the answer cleaned of the things models do
 *  around a completion (fences, echoing the line, running past the suffix, repeating). One
 *  difference decides the shape of everything: every provider this IDE talks to is a CHAT
 *  endpoint — there is no `/completions` and no native FIM — so the prompt is Continue's
 *  "hole filler" (the template it uses for GPT and Claude), never a model-specific FIM token
 *  set. Pure functions, no DOM, no services: the whole thing is testable from a string.
 *--------------------------------------------------------------------------------------------*/

export type OpenideAutocompleteMultiline = 'auto' | 'always' | 'never';

export interface IOpenideAutocompleteInput {
	/** Workspace-relative path, for the prompt and for the language hint. */
	readonly path: string;
	readonly languageId: string;
	/** Everything before the caret, unpruned. */
	readonly prefix: string;
	/** Everything after the caret, unpruned. */
	readonly suffix: string;
	readonly multiline: OpenideAutocompleteMultiline;
}

/** Continue's `maxPromptTokens: 1024` at ~4 chars per token, split 3:1 like its prefix/suffix percentages. */
export const PREFIX_BUDGET_CHARS = 3000;
export const SUFFIX_BUDGET_CHARS = 1000;
/** Tokens the model may spend on one completion: a few lines, never a file. */
export const COMPLETION_MAX_TOKENS = 256;

export const HOLE = '{{FILL_HERE}}';

/** The last `budget` characters, cut at a line start so the model never sees half a line. */
export function pruneFromTop(text: string, budget = PREFIX_BUDGET_CHARS): string {
	if (text.length <= budget) {
		return text;
	}
	const cut = text.length - budget;
	if (text[cut - 1] === '\n') {
		return text.slice(cut);
	}
	const lineStart = text.indexOf('\n', cut);
	return lineStart < 0 ? text.slice(cut) : text.slice(lineStart + 1);
}

/** The first `budget` characters, cut at a line end. */
export function pruneFromBottom(text: string, budget = SUFFIX_BUDGET_CHARS): string {
	if (text.length <= budget) {
		return text;
	}
	const lineEnd = text.lastIndexOf('\n', budget);
	return lineEnd < 0 ? text.slice(0, budget) : text.slice(0, lineEnd);
}

/** The comment leader for the languages where a comment line must stay one line. */
const LINE_COMMENT: Readonly<Record<string, string>> = {
	typescript: '//', typescriptreact: '//', javascript: '//', javascriptreact: '//', java: '//', c: '//', cpp: '//', csharp: '//',
	go: '//', rust: '//', swift: '//', kotlin: '//', scala: '//', dart: '//', php: '//',
	python: '#', ruby: '#', shellscript: '#', yaml: '#', perl: '#', r: '#', toml: '#', makefile: '#', dockerfile: '#',
	lua: '--', sql: '--', haskell: '--',
};

/**
 * Whether the completion may span lines. Continue's `shouldCompleteMultiline`, with the check
 * it left commented in — mid-line is single-line here: a completion with code already to the
 * right of the caret that spans lines has to guess where that code goes, and guesses wrong.
 */
export function shouldCompleteMultiline(input: IOpenideAutocompleteInput): boolean {
	if (input.multiline === 'always') {
		return true;
	}
	if (input.multiline === 'never') {
		return false;
	}
	const currentLine = input.prefix.slice(input.prefix.lastIndexOf('\n') + 1);
	const restOfLine = input.suffix.slice(0, input.suffix.indexOf('\n') < 0 ? input.suffix.length : input.suffix.indexOf('\n'));
	if (restOfLine.trim()) {
		return false;
	}
	const leader = LINE_COMMENT[input.languageId];
	if (leader && currentLine.trimStart().startsWith(leader)) {
		return false;
	}
	if (input.languageId === 'markdown' && /^\s*([-*]\s|\d+\.\s|>\s|```|#{1,6}\s)/.test(currentLine)) {
		return false;
	}
	return true;
}

export interface IOpenideAutocompletePrompt {
	readonly system: string;
	readonly prompt: string;
	readonly prefix: string;
	readonly suffix: string;
	readonly multiline: boolean;
}

/**
 * Continue's hole-filler template, compacted: the file with a hole in it, two examples so the
 * model returns the hole's contents and nothing else, and the answer fenced in
 * `<COMPLETION>` so it can be cut out whatever prose surrounds it.
 */
export function buildAutocompletePrompt(input: IOpenideAutocompleteInput): IOpenideAutocompletePrompt {
	const prefix = pruneFromTop(input.prefix);
	const suffix = pruneFromBottom(input.suffix);
	const multiline = shouldCompleteMultiline(input);
	const system = [
		'You are a code completion engine inside an editor. You will be given a file with a hole marked',
		`${HOLE}. Reply with the code that belongs exactly at the hole, wrapped in <COMPLETION></COMPLETION>,`,
		'and nothing else: no explanation, no markdown fence, no repetition of the code before or after the hole.',
		multiline
			? 'Complete the current statement or block; stop where the code after the hole continues naturally.'
			: 'Complete only the rest of the current line.',
	].join(' ');
	const prompt = [
		`## EXAMPLE QUERY:`,
		'',
		`<QUERY>`,
		`function sum(a, b) {`,
		`  return ${HOLE}`,
		`}`,
		`</QUERY>`,
		'',
		`## CORRECT COMPLETION:`,
		'',
		`<COMPLETION>a + b;</COMPLETION>`,
		'',
		`## EXAMPLE QUERY:`,
		'',
		`<QUERY>`,
		`def is_even(n):`,
		`    ${HOLE}`,
		'',
		`print(is_even(4))`,
		`</QUERY>`,
		'',
		`## CORRECT COMPLETION:`,
		'',
		`<COMPLETION>return n % 2 == 0</COMPLETION>`,
		'',
		`## QUERY (file: ${input.path}, language: ${input.languageId}):`,
		'',
		`<QUERY>`,
		`${prefix}${HOLE}${suffix}`,
		`</QUERY>`,
		'',
		`## CORRECT COMPLETION:`,
		'',
	].join('\n');
	return { system, prompt, prefix, suffix, multiline };
}

/** Cuts the answer out of whatever the model wrapped around it. */
export function extractCompletion(raw: string): string {
	let text = raw;
	const open = text.indexOf('<COMPLETION>');
	if (open >= 0) {
		text = text.slice(open + '<COMPLETION>'.length);
		const close = text.indexOf('</COMPLETION>');
		if (close >= 0) {
			text = text.slice(0, close);
		}
	}
	// A fenced block despite the instructions: keep its contents.
	const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
	if (fence) {
		text = fence[1];
	}
	return text.replace(/\r\n/g, '\n');
}

/**
 * Continue's postprocessing and stream filters, applied to the finished text:
 *  - the model repeating the line it was asked to continue, or the code after the hole;
 *  - a multi-line answer that runs into a second block (stop at the first blank line);
 *  - a single-line answer that grew lines anyway;
 *  - an answer that is only whitespace, or that rewrites the line above.
 * Returns undefined when there is nothing worth showing.
 */
export function postprocessCompletion(raw: string, prompt: IOpenideAutocompletePrompt): string | undefined {
	let completion = extractCompletion(raw);
	const prefixLine = prompt.prefix.slice(prompt.prefix.lastIndexOf('\n') + 1);
	// Echo of the current line: the model "completed" by restating what is already typed.
	if (prefixLine.trim() && completion.startsWith(prefixLine)) {
		completion = completion.slice(prefixLine.length);
	} else if (prefixLine.trim() && completion.trimStart().startsWith(prefixLine.trimStart()) && completion.trimStart() !== prefixLine.trimStart()) {
		completion = completion.trimStart().slice(prefixLine.trimStart().length);
	}
	// Continue's `stopAtStartOf(suffix)`: the model kept going into the code after the hole. The
	// first non-blank line after the hole is the boundary; a completion line that IS that line
	// (a lone `}`, the next statement) ends the completion, and a completion that starts with
	// it said nothing new.
	const suffixHead = prompt.suffix.split('\n').map(line => line.trim()).find(Boolean);
	if (suffixHead) {
		const lines = completion.split('\n');
		const at = lines.findIndex((line, index) => line.trim() === suffixHead || (index > 0 && suffixHead.length >= 4 && line.includes(suffixHead)));
		if (at === 0) {
			return undefined;
		}
		if (at > 0) {
			completion = lines.slice(0, at).join('\n');
		}
	}
	if (!prompt.multiline) {
		completion = completion.split('\n')[0];
	} else {
		// `noDoubleNewLine`: one block. The first blank line after some content ends it.
		const lines = completion.split('\n');
		const kept: string[] = [];
		for (const line of lines) {
			if (!line.trim() && kept.some(k => k.trim())) {
				break;
			}
			kept.push(line);
		}
		completion = kept.join('\n');
	}
	completion = completion.replace(/\s+$/, '');
	if (!completion.trim()) {
		return undefined;
	}
	// `rewritesLineAbove`: the answer is the previous line again.
	const lineAbove = prompt.prefix.split('\n').slice(-2, -1)[0]?.trim();
	if (lineAbove && completion.trim() === lineAbove) {
		return undefined;
	}
	// Continue's `isExtremeRepetition`, the cheap half: the same line three times is a loop.
	const distinct = new Set(completion.split('\n').map(line => line.trim()).filter(Boolean));
	if (completion.split('\n').length >= 3 && distinct.size === 1) {
		return undefined;
	}
	return completion;
}

/**
 * A completion cached under a shorter prefix still applies while the user types what it
 * predicted: the remainder is what is left to show. Continue's LRU cache lookup.
 */
export function reuseCompletion(cachedPrefix: string, cachedCompletion: string, prefix: string): string | undefined {
	if (!prefix.startsWith(cachedPrefix)) {
		return undefined;
	}
	const typed = prefix.slice(cachedPrefix.length);
	if (!cachedCompletion.startsWith(typed) || typed.length === cachedCompletion.length) {
		return undefined;
	}
	return cachedCompletion.slice(typed.length);
}
