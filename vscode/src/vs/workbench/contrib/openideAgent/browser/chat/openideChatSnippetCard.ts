/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { IComposerSnippet, snippetLabel, snippetRange } from '../../common/chat/openideChatSnippet.js';
import { t } from '../../common/openideStrings.js';

/** Lines of the snippet the card shows before folding the rest into a count. */
const SNIPPET_PREVIEW_LINES = 4;

/** The first lines of a snippet, de-indented so the card shows code and not a wall of tabs. */
export function snippetPreview(text: string): string {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const shown = lines.slice(0, SNIPPET_PREVIEW_LINES);
	const indents = shown.filter(line => line.trim()).map(line => line.match(/^[\t ]*/)![0].length);
	const indent = indents.length ? Math.min(...indents) : 0;
	const body = shown.map(line => line.slice(indent)).join('\n');
	return lines.length > SNIPPET_PREVIEW_LINES ? `${body}\n${t('chat.snippet.more', String(lines.length - SNIPPET_PREVIEW_LINES))}` : body;
}

/**
 * Cursor's code-block card: the file's icon and `name (start-end)` on a head row, the first
 * lines of the code under it. ONE builder for everywhere a snippet is shown — the composer's
 * strip while the message is being written, the request bubble once it was sent, the composer
 * again when a rejected turn comes back — so it looks the same in all three. The head row is
 * returned so the composer can add its remove button; the bubble adds nothing.
 */
export function appendSnippetCard(parent: HTMLElement, snippet: IComposerSnippet): { card: HTMLElement; head: HTMLElement; title: string } {
	const card = append(parent, $('.openide-chat-snippet-card'));
	const head = append(card, $('.openide-chat-snippet-head'));
	const icon = append(head, $('span'));
	icon.className = snippet.iconClasses ? `openide-chat-file-icon ${snippet.iconClasses}` : 'codicon codicon-code';
	append(head, $('span.openide-chat-chip-name', undefined, snippetLabel(snippet)));
	const code = append(card, $('pre.openide-chat-snippet-code'));
	code.textContent = snippetPreview(snippet.text);
	return { card, head, title: `${snippet.path}:${snippetRange(snippet)}` };
}
