/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — reading the DRAFT of a plan while the model is still writing it.
 *
 *  The arguments of `plan_save` arrive streamed as incomplete JSON: the provider keeps
 *  acumulando trozos (`input_json_delta` en Anthropic, `response.function_call_arguments.delta`
 *  in Codex/Responses) and only at the end is there parseable JSON. `JSON.parse` on that always
 *  throws, so showing the plan as it is written requires reading the value of a key from a JSON
 *  that has not closed yet.
 *
 *  This is a deliberately narrow reader: it is NOT a JSON parser. It only knows how to find a
 *  top-level key whose value is a string and decode it as far as it got. Any other shape
 *  returns undefined instead of guessing.
 *--------------------------------------------------------------------------------------------*/

export interface IPlanDraft {
	/** Partial (or complete) title exactly as it arrived. '' when the key has not shown up yet. */
	readonly title: string;
	/**
	 * true when the title has closed its quotes. This matters: the file name comes from the title,
	 * and with a half-written one ("Price Analys") the editor would open on a uri that is not the
	 * one eventually written. Until it closes, there is no draft.
	 */
	readonly titleComplete: boolean;
	/** Markdown received so far. '' when the key has not shown up yet. */
	readonly markdown: string;
	/** true when the `markdown` value has closed its quotes: what is there is all there is. */
	readonly markdownComplete: boolean;
}

/**
 * Locates the start of a top-level key's string value and returns the index of the first
 * character INSIDE the quotes, or -1.
 *
 * It searches for the key with its quotes (`"markdown"`) so it does not latch onto the bare
 * word inside the plan text — which will contain it, because the plan talks about the plan.
 */
function findValueStart(json: string, key: string): number {
	const needle = `"${key}"`;
	let from = 0;
	for (;;) {
		const at = json.indexOf(needle, from);
		if (at < 0) {
			return -1;
		}
		// It only counts as a key if what follows (skipping spaces) is ':' and then a quote.
		// Otherwise it is an occurrence inside another string and we keep looking.
		let i = at + needle.length;
		while (i < json.length && (json[i] === ' ' || json[i] === '\t' || json[i] === '\n' || json[i] === '\r')) { i++; }
		if (json[i] === ':') {
			i++;
			while (i < json.length && (json[i] === ' ' || json[i] === '\t' || json[i] === '\n' || json[i] === '\r')) { i++; }
			if (json[i] === '"') {
				// And it has to be OUTSIDE any string: we count unescaped quotes before it.
				if (!isInsideString(json, at)) {
					return i + 1;
				}
			}
		}
		from = at + needle.length;
	}
}

/** true when the index falls inside a JSON string (counts unescaped quotes from the start). */
function isInsideString(json: string, index: number): boolean {
	let inside = false;
	for (let i = 0; i < index; i++) {
		const ch = json[i];
		if (ch === '\\') { i++; continue; }
		if (ch === '"') { inside = !inside; }
	}
	return inside;
}

/**
 * Decodes the contents of a JSON string from `start` up to the closing quote or to wherever the
 * stream got. An escape cut off at the end (a lone `\`, a half `\u00e`) is discarded: calling
 * again with more text will complete it.
 */
function decodeStringFrom(json: string, start: number): { value: string; complete: boolean } {
	let out = '';
	let i = start;
	while (i < json.length) {
		const ch = json[i];
		if (ch === '"') {
			return { value: out, complete: true };
		}
		if (ch === '\\') {
			const next = json[i + 1];
			if (next === undefined) {
				break; // escape cortado: lo dejamos afuera hasta que llegue el resto
			}
			switch (next) {
				case 'n': out += '\n'; i += 2; break;
				case 't': out += '\t'; i += 2; break;
				case 'r': out += '\r'; i += 2; break;
				case 'b': out += '\b'; i += 2; break;
				case 'f': out += '\f'; i += 2; break;
				case '"': out += '"'; i += 2; break;
				case '\\': out += '\\'; i += 2; break;
				case '/': out += '/'; i += 2; break;
				case 'u': {
					const hex = json.slice(i + 2, i + 6);
					if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
						return { value: out, complete: false }; // \uXXXX a medias
					}
					out += String.fromCharCode(parseInt(hex, 16));
					i += 6;
					break;
				}
				default:
					// An escape JSON does not define: passed through as-is instead of losing the character.
					out += next; i += 2; break;
			}
			continue;
		}
		out += ch;
		i++;
	}
	return { value: out, complete: false };
}

/** Reads whatever it can from the (possibly incomplete) JSON of `plan_save` arguments. */
export function readPlanDraft(partialJson: string): IPlanDraft {
	if (!partialJson) {
		return { title: '', titleComplete: false, markdown: '', markdownComplete: false };
	}
	const titleStart = findValueStart(partialJson, 'title');
	const markdownStart = findValueStart(partialJson, 'markdown');
	const title = titleStart >= 0 ? decodeStringFrom(partialJson, titleStart) : undefined;
	const markdown = markdownStart >= 0 ? decodeStringFrom(partialJson, markdownStart) : undefined;
	return {
		title: title ? title.value : '',
		titleComplete: title ? title.complete : false,
		markdown: markdown ? markdown.value : '',
		markdownComplete: markdown ? markdown.complete : false,
	};
}

/**
 * Kebab slug of the title, without accents. IDENTICAL to the one savePlan uses to name the
 * file: the draft must point at the SAME uri that ends up being written, or the editor opened
 * with the skeleton would not be the one later filled in.
 */
export function planSlug(title: string): string {
	return title.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'plan';
}
