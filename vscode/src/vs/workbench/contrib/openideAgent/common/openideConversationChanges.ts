/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMessageChangeSet } from './openideAgentTypes.js';

export interface IConversationFileChange {
	readonly id: string;
	readonly uri: string;
	readonly before: string;
	readonly after: string;
	readonly deleted: boolean;
}

/** Join only contiguous receipts. A different before-state means another writer intervened;
 * keep separate comparisons so its edits cannot be attributed to this conversation. */
export function collectConversationChanges(sets: readonly IMessageChangeSet[]): readonly IConversationFileChange[] {
	const segments: { id: string; uri: string; before: string; after: string; deleted: boolean; existed: boolean; renamed: boolean }[] = [];
	const latest = new Map<string, typeof segments[number]>();
	for (const set of [...sets].sort((a, b) => a.timestamp - b.timestamp)) {
		if (set.state === 'unavailable') { continue; }
		for (const file of set.files) {
			const before = file.beforeContent ?? (file.operation === 'create' ? '' : undefined);
			const after = file.afterContent ?? (file.operation === 'delete' ? '' : undefined);
			if (before === undefined || after === undefined) { continue; }
			const previous = latest.get(file.uri);
			if (previous && previous.after === before && file.operation !== 'rename') {
				previous.after = after; previous.deleted = file.operation === 'delete';
			} else {
				const segment = { id: `${set.messageId}:${segments.length}`, uri: file.uri, before, after, deleted: file.operation === 'delete', existed: file.operation !== 'create', renamed: file.operation === 'rename' };
				segments.push(segment); latest.set(file.uri, segment);
			}
		}
	}
	return segments.filter(file => file.before !== file.after || file.existed === file.deleted || file.renamed);
}
