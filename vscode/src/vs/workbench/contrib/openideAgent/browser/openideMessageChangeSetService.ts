/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — lifecycle and safe rollback of change sets isolated by messageId.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { consolidateFileChange, createFileChange } from '../common/openideMessageChanges.js';
import { FileChangeOperation, IFileChange, IFileEditEvent, IMessageChangeSet, IMessageRollbackResult } from '../common/openideAgentTypes.js';
import { IOpenideRestoreSafety, OpenideRestoreEngine } from './openideRestoreEngine.js';

interface IOpenBuilder {
	readonly messageId: string;
	readonly timestamp: number;
	readonly files: Map<string, IFileChange>;
}

export class OpenideMessageChangeSetService {
	private readonly builders = new Map<string, IOpenBuilder>();
	private readonly finalized = new Map<string, IMessageChangeSet>();
	private readonly restore: OpenideRestoreEngine;

	constructor(
		fileService: IFileService,
		contextService: IWorkspaceContextService,
		safety: IOpenideRestoreSafety = {},
	) { this.restore = new OpenideRestoreEngine(fileService, contextService, safety); }

	begin(messageId: string): void {
		if (!this.builders.has(messageId)) {
			this.builders.set(messageId, { messageId, timestamp: Date.now(), files: new Map() });
		}
	}

	hasOpen(messageId: string): boolean { return this.builders.has(messageId); }

	snapshot(messageId: string): IMessageChangeSet | undefined {
		const builder = this.builders.get(messageId);
		return builder ? { messageId, timestamp: builder.timestamp, state: 'open', files: [...builder.files.values()].map(structuredCloneFileChange) } : undefined;
	}

	record(messageId: string, event: IFileEditEvent): void {
		const builder = this.builders.get(messageId);
		if (!builder) { return; }
		const next = createFileChange(event.path, event.operation, event.beforeContent, event.afterContent, event.originalPath);
		if (event.operation === 'rename' && event.originalPath) {
			const sourcePrevious = builder.files.get(event.originalPath);
			const destinationPrevious = builder.files.get(event.path);
			builder.files.delete(event.originalPath);
			builder.files.delete(event.path);
			// If the destination had previous history (e.g. delete B; rename A→B), keep it as
			// a second independent operation. On rollback the rename is undone first and
			// then the original destination is restored, without mixing A/B contents.
			if (destinationPrevious) { builder.files.set(`\0destination:${event.path}`, destinationPrevious); }
			const consolidated = consolidateFileChange(sourcePrevious, next);
			if (consolidated) { builder.files.set(event.path, consolidated); }
			return;
		}
		const previous = builder.files.get(event.path);
		builder.files.delete(event.path);
		const consolidated = consolidateFileChange(previous, next);
		if (consolidated) { builder.files.set(consolidated.uri, consolidated); }
	}

	finalize(messageId: string, cancelled = false): IMessageChangeSet {
		const builder = this.builders.get(messageId);
		if (!builder) {
			return this.finalized.get(messageId) ?? { messageId, timestamp: Date.now(), state: cancelled ? 'cancelled' : 'finalized', files: [] };
		}
		this.builders.delete(messageId);
		const set: IMessageChangeSet = {
			messageId,
			timestamp: builder.timestamp,
			state: cancelled ? 'cancelled' : 'finalized',
			files: [...builder.files.values()].map(file => structuredCloneFileChange(file)),
		};
		this.finalized.set(messageId, set);
		// Idempotency only during the same emission tick; the durable session is the real owner.
		queueMicrotask(() => this.finalized.delete(messageId));
		return set;
	}

	rollback(changeSet: IMessageChangeSet, includeNonConflicting = false): Promise<IMessageRollbackResult> {
		return this.restore.rollback(changeSet, includeNonConflicting);
	}
}

function structuredCloneFileChange(file: IFileChange): IFileChange {
	return JSON.parse(JSON.stringify(file)) as IFileChange;
}

export function fileEditEvent(path: string, operation: FileChangeOperation, beforeContent?: string, afterContent?: string, originalPath?: string): IFileEditEvent {
	return { path, operation, beforeContent, afterContent, originalPath };
}
