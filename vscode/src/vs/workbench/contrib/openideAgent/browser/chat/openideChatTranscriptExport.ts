/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from '../../common/openideAgentTypes.js';

/**
 * "Copy transcript" of the kebab menu, as markdown.
 *
 * Extracted out of `openideChatView.exportTranscript` rather than reimplemented in the native
 * header: both renderers export the SAME conversation from the SAME store, so a second copy would
 * be a second wording of the user's own history.
 *
 * Returns `undefined` for a conversation with nothing to export, which is what tells the caller to
 * say so instead of putting an empty string on the clipboard.
 */
export function openideChatTranscriptToMarkdown(messages: readonly IChatMessage[]): string | undefined {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role === 'user' && message.content) {
			parts.push('## Usuario\n\n' + (message.displayText || message.content));
		} else if (message.role === 'assistant') {
			let block = message.content ? message.content : '';
			if (message.toolCalls?.length) {
				block += (block ? '\n\n' : '') + message.toolCalls.map(call => `> herramienta: ${call.name}`).join('\n');
			}
			if (block) {
				parts.push('## Asistente\n\n' + block);
			}
		}
	}
	if (!parts.length) {
		return undefined;
	}
	return parts.join('\n\n---\n\n') + '\n';
}

export const OPENIDE_CHAT_TRANSCRIPT_EMPTY = 'No hay conversación para exportar.';
export const OPENIDE_CHAT_TRANSCRIPT_COPIED = 'Transcript copiado al portapapeles.';
