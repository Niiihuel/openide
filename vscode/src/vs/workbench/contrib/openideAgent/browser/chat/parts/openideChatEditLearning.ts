/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenideChatSessions } from '../../openideChatSessions.js';

/**
 * Which turns to credit (or blame) when the user accepts or reverts a file.
 *
 * Transcribed from `OpenideChatView#creditLearning` (openideChatView.ts:209-231), which is the
 * only place this mapping exists. Keeping the native tray silent would quietly degrade the
 * project map: accepting an edit is the strongest positive signal the product gets about whether
 * the entities shown to the model were the right ones, and it is emitted nowhere else.
 *
 * Lives next to the tray rather than inside it because the tray must not know about conversations:
 * it shows workspace-pending files, which outlive the conversation that produced them.
 */
export function creditOpenideChatFileOutcome(
	sessions: OpenideChatSessions,
	conversationId: string | undefined,
	paths: readonly string[],
): string[] {
	if (!paths.length || !conversationId) {
		return [];
	}
	const messages = sessions.messagesOf(conversationId);
	const wanted = new Set(paths.map(path => path.replace(/^\/+/, '')));
	const hits: string[] = [];
	// Back to front, and each path is claimed by the FIRST match found that way: the turn that most
	// recently touched a file is the one whose context decided how it ended up, so crediting every
	// turn that ever wrote it would reward stale retrieval for a later turn's success.
	for (let i = messages.length - 1; i >= 0 && wanted.size; i--) {
		const messageId = messages[i].messageId;
		if (!messageId) {
			continue;
		}
		const changeSet = sessions.changeSetOf(conversationId, messageId);
		if (!changeSet?.files.length) {
			continue;
		}
		if (changeSet.files.some(file => claims(file.uri, wanted))) {
			hits.push(messageId);
		}
	}
	return hits;
}

/**
 * Suffix match, not equality: the tray speaks workspace-relative paths and a change set stores
 * full URIs. Comparing them properly would need the workspace root, which is a service neither
 * side has here — and the suffix is unambiguous for the file names an agent actually writes.
 */
function claims(uri: string, wanted: Set<string>): boolean {
	const normalized = uri.replace(/^.*?:\/\//, '').replace(/^\/+/, '');
	for (const path of wanted) {
		if (normalized.endsWith(path) || uri.endsWith(path)) {
			wanted.delete(path);
			return true;
		}
	}
	return false;
}
