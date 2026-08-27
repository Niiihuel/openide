/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../base/common/uri.js';
import { TokenizationRegistry } from '../../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IReducedTokenizationSupport } from '../../../../../../editor/common/languages/textToHtmlTokenizer.js';
import { LineTokens } from '../../../../../../editor/common/tokens/lineTokens.js';
import { IPersistedFileDiff } from '../../../common/openideAgentTypes.js';

/**
 * The inline diff preview of an edit card, transcribed from the webview's `.ediff`
 * (openideChatHtml.ts:3141-3150) and Cursor's edit block: one row per diff line, a sign gutter,
 * added/removed tints, and the code painted with the SAME tokenizer the editor uses for that file
 * type — never a second highlighter. `mtkN` classes are emitted unprefixed by the theme
 * (tokenization.ts `generateTokensCSSForColorMap`), so the rows pick up the editor palette as-is.
 *
 * Tokenization is per line and restarts at every `gap`: a preview is a set of hunks, not the file,
 * and carrying state across a hole in it would colour the first line of the next hunk with the
 * end of a comment that was never there. Rows are appended synchronously in plain text and
 * re-painted in place once the grammar resolves, so the card never waits on a language load.
 */

export type OpenideChatDiffLine = NonNullable<IPersistedFileDiff['diffLines']>[number];

export function appendOpenideChatEditDiff(parent: HTMLElement, path: string, lines: readonly OpenideChatDiffLine[], created: boolean, languageService: ILanguageService, token: CancellationToken, onDidPaint?: () => void): HTMLElement {
	const root = append(parent, $('div.openide-chat-ediff'));
	const codes: { readonly node: HTMLElement; readonly text: string; readonly line: OpenideChatDiffLine }[] = [];
	for (const line of lines) {
		// A created file diffs against one empty line; showing that "− " as a removal is a lie.
		if (created && line.t === 'del' && !line.x.trim()) {
			continue;
		}
		const row = append(root, $(`div.openide-chat-ediff-line.openide-chat-ediff-${line.t}`));
		const sign = append(row, $('span.openide-chat-ediff-sign'));
		// U+2212 for the same reason as the stats column: it is as wide as the plus sign.
		sign.textContent = line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' ';
		const text = line.x || ' ';
		const code = append(row, $('span.openide-chat-ediff-code'));
		code.textContent = text;
		codes.push({ node: code, text, line });
	}

	if (codes.length) {
		void resolveLanguageId(path, languageService, token)
			.then(languageId => languageId ? paintWhenReady(languageId, codes, languageService, token) : undefined)
			.then(() => onDidPaint?.());
	}
	return root;
}

/**
 * Right after a restore the extension host has not registered its languages yet and the guess
 * for `foo.ts` is `unknown`. The language service says when its registry changes; re-guessing
 * then is what turns a restored transcript's diffs from plain text into highlighted code.
 */
function resolveLanguageId(path: string, languageService: ILanguageService, token: CancellationToken): Promise<string | undefined> {
	const uri = URI.file(`/${path}`);
	const guess = (): string | undefined => {
		const id = languageService.guessLanguageIdByFilepathOrFirstLine(uri);
		return id && id !== 'unknown' && id !== 'plaintext' ? id : undefined;
	};
	const first = guess();
	if (first) {
		return Promise.resolve(first);
	}
	return new Promise(resolve => {
		const listener = languageService.onDidChange(() => {
			const next = guess();
			if (next || token.isCancellationRequested) {
				listener.dispose();
				cancel.dispose();
				resolve(next);
			}
		});
		const cancel = token.onCancellationRequested(() => {
			listener.dispose();
			cancel.dispose();
			resolve(undefined);
		});
	});
}

/**
 * Grammars are registered lazily: right after a reload the TypeScript factory is not in the
 * registry yet and `getOrCreate` resolves to null. Asking for the language's rich features is
 * what makes the TextMate extension register it; the registry's change event says when it did.
 */
async function paintWhenReady(languageId: string, codes: readonly { readonly node: HTMLElement; readonly text: string; readonly line: OpenideChatDiffLine }[], languageService: ILanguageService, token: CancellationToken): Promise<void> {
	languageService.requestRichLanguageFeatures(languageId);
	let support = await TokenizationRegistry.getOrCreate(languageId);
	if (!support && !token.isCancellationRequested) {
		support = await new Promise(resolve => {
			const listener = TokenizationRegistry.onDidChange(event => {
				if (event.changedLanguages.includes(languageId) || token.isCancellationRequested) {
					listener.dispose();
					cancel.dispose();
					resolve(TokenizationRegistry.getOrCreate(languageId));
				}
			});
			const cancel = token.onCancellationRequested(() => {
				listener.dispose();
				cancel.dispose();
				resolve(null);
			});
		});
	}
	if (support && !token.isCancellationRequested) {
		paint(codes, support, languageService);
	}
}

function paint(codes: readonly { readonly node: HTMLElement; readonly text: string; readonly line: OpenideChatDiffLine }[], support: IReducedTokenizationSupport, languageService: ILanguageService): void {
	let state = support.getInitialState();
	for (const { node, text, line } of codes) {
		if (line.t === 'gap') {
			state = support.getInitialState();
			continue;
		}
		let result;
		try {
			result = support.tokenizeEncoded(text, true, state);
		} catch {
			return; // a grammar that throws leaves the plain text; the diff is still readable
		}
		LineTokens.convertToEndOffset(result.tokens, text.length);
		const viewLineTokens = new LineTokens(result.tokens, text, languageService.languageIdCodec).inflate();
		const spans: HTMLElement[] = [];
		let start = 0;
		for (let j = 0, count = viewLineTokens.getCount(); j < count; j++) {
			const end = viewLineTokens.getEndOffset(j);
			const span = $('span');
			span.className = viewLineTokens.getClassName(j);
			span.textContent = text.substring(start, end);
			spans.push(span);
			start = end;
		}
		node.replaceChildren(...spans);
		state = result.endState;
	}
}
