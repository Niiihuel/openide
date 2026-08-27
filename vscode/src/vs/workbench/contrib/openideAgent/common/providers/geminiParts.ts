/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — accumulation and sanitizing of Gemini `parts`.
 *
 *  In the Gemini proto, `Part` has a oneof named `data`: text, inlineData, functionCall,
 *  functionResponse, fileData, executableCode and codeExecutionResult are MUTUALLY EXCLUSIVE. A
 *  part with two of them makes the API reject the whole request with
 *  "oneof field 'data' is already set. Cannot set 'text'", naming a `contents` index that says
 *  nothing about the turn that produced it.
 *
 *  It happened when accumulating the SSE stream by merging on index (`{...prev, ...inc}`): each
 *  chunk carries its own parts, and part 0 of a text chunk is not the same part 0 of the chunk
 *  that later brings a functionCall. Besides invalidating the part, merging by index OVERWROTE
 *  the text instead of concatenating it: the stored turn kept only the last delta.
 *
 *  Since those parts are persisted in the session and resent on every turn, a single corruption
 *  left the conversation unusable. Hence two pieces: the accumulator, which no longer produces
 *  them, and the sanitizer, which repairs them on send and heals already-damaged sessions.
 *--------------------------------------------------------------------------------------------*/

export type GeminiPart = Record<string, unknown>;

/** Members of the `data` oneof. Order matters: it is the one used when splitting a corrupt part. */
const DATA_KEYS = [
	'text',
	'inlineData', 'inline_data',
	'functionCall', 'function_call',
	'functionResponse', 'function_response',
	'fileData', 'file_data',
	'executableCode', 'executable_code',
	'codeExecutionResult', 'code_execution_result',
] as const;

const FUNCTION_CALL_KEYS = new Set<string>(['functionCall', 'function_call']);

function dataKeysOf(part: GeminiPart): string[] {
	return DATA_KEYS.filter(key => part[key] !== undefined && part[key] !== null);
}

export function thoughtSignatureOf(part: GeminiPart | undefined): string | undefined {
	const signature = part?.['thoughtSignature'] ?? part?.['thought_signature'];
	return typeof signature === 'string' && signature ? signature : undefined;
}

function isPlainTextPart(part: GeminiPart): boolean {
	const keys = dataKeysOf(part);
	return keys.length === 1 && keys[0] === 'text';
}

function hasFunctionCall(part: GeminiPart): boolean {
	return dataKeysOf(part).some(key => FUNCTION_CALL_KEYS.has(key));
}

/**
 * Leaves each part with a SINGLE oneof member. A part with several is not discarded: it is
 * split into several valid parts preserving order, because dropping the text or the call would
 * silently lose context from the turn. `thoughtSignature` travels with the functionCall when
 * there is one — that is the part Gemini 3 requires it on.
 */
export function sanitizeGeminiParts(parts: readonly GeminiPart[]): GeminiPart[] {
	const out: GeminiPart[] = [];
	for (const part of parts) {
		const keys = dataKeysOf(part);
		if (keys.length <= 1) {
			out.push({ ...part });
			continue;
		}
		const metadata: GeminiPart = {};
		for (const [key, value] of Object.entries(part)) {
			if (!(DATA_KEYS as readonly string[]).includes(key) && key !== 'thoughtSignature' && key !== 'thought_signature') {
				metadata[key] = value;
			}
		}
		const signature = thoughtSignatureOf(part);
		const signatureOwner = keys.find(key => FUNCTION_CALL_KEYS.has(key)) ?? keys[0];
		for (const key of keys) {
			const split: GeminiPart = { ...metadata, [key]: part[key] };
			if (signature && key === signatureOwner) { split['thoughtSignature'] = signature; }
			out.push(split);
		}
	}
	return out;
}

/**
 * Accumulates the parts arriving over SSE. Text is concatenated onto the last open text part
 * (same `thought` flag); anything else opens a new part. It never mixes two oneof members in
 * the same part.
 */
export function appendGeminiParts(accumulated: readonly GeminiPart[], incoming: readonly GeminiPart[]): GeminiPart[] {
	const out = accumulated.map(part => ({ ...part }));
	for (const raw of sanitizeGeminiParts(incoming)) {
		const signature = thoughtSignatureOf(raw);
		if (isPlainTextPart(raw)) {
			const last = out[out.length - 1];
			// `thought` separates reasoning from visible text: concatenating across that boundary
			// would blend two things the model sent apart.
			if (last && isPlainTextPart(last) && (last['thought'] === true) === (raw['thought'] === true)) {
				last['text'] = String(last['text'] ?? '') + String(raw['text'] ?? '');
				if (signature) { last['thoughtSignature'] = signature; }
				continue;
			}
			out.push({ ...raw });
			continue;
		}
		// A functionCall may arrive in pieces: if the last part is a call still without a name, it
		// is completed instead of opening another.
		const last = out[out.length - 1];
		if (hasFunctionCall(raw) && last && hasFunctionCall(last)) {
			const previousCall = (last['functionCall'] ?? last['function_call']) as Record<string, unknown> | undefined;
			const incomingCall = (raw['functionCall'] ?? raw['function_call']) as Record<string, unknown> | undefined;
			const previousName = typeof previousCall?.['name'] === 'string' ? previousCall['name'] as string : '';
			if (!previousName) {
				last['functionCall'] = { ...previousCall, ...incomingCall };
				delete last['function_call'];
				if (signature) { last['thoughtSignature'] = signature; }
				continue;
			}
		}
		out.push({ ...raw });
	}
	return out;
}
