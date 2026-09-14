/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { ISCMResource, ISCMResourceGroup } from '../../scm/common/scm.js';
import { IOpenideReviewDiffService } from './openideReviewDiffService.js';

export interface IAgentWindowChangeStats { readonly added: number; readonly removed: number; readonly binary?: boolean }
export interface IAgentWindowSCMComparison {
	readonly resource: ISCMResource;
	readonly original: URI | undefined;
	readonly modified: URI | undefined;
}

/** Count each path once. Staged and working changes compose into HEAD → working tree. */
export function collectAgentWindowSCMComparisons(groups: readonly ISCMResourceGroup[]): IAgentWindowSCMComparison[] {
	const files = new Map<string, { staged?: ISCMResource; working?: ISCMResource; other?: ISCMResource }>();
	for (const group of groups) {
		for (const resource of group.resources) {
			const key = extUriBiasedIgnorePathCase.getComparisonKey(resource.sourceUri);
			const entry = files.get(key) ?? {};
			if (group.id === 'index') { entry.staged = resource; }
			else if (group.id === 'workingTree' || group.id === 'untracked') { entry.working = resource; }
			else { entry.other ??= resource; }
			files.set(key, entry);
		}
	}
	return [...files.values()].map(({ staged, working, other }) => {
		const resource = working ?? staged ?? other!;
		return { resource, original: (staged ?? resource).multiDiffEditorOriginalUri, modified: resource.multiDiffEditorModifiedUri };
	});
}

/** Resolver handles Git virtual content, dirty models and text/binary detection just like Monaco. */
export async function resolveAgentWindowChangeStats(comparison: Pick<IAgentWindowSCMComparison, 'original' | 'modified'>, models: ITextModelService, token: CancellationToken, diffs: IOpenideReviewDiffService): Promise<IAgentWindowChangeStats | undefined> {
	if (token.isCancellationRequested || (!comparison.original && !comparison.modified)) { return undefined; }
	const read = async (uri: URI | undefined): Promise<string | undefined> => {
		if (!uri) { return ''; }
		if (token.isCancellationRequested) { return undefined; }
		const reference = await models.createModelReference(uri);
		try { return token.isCancellationRequested ? undefined : reference.object.textEditorModel.getValue(); }
		finally { reference.dispose(); }
	};
	const [before, after] = await Promise.allSettled([read(comparison.original), read(comparison.modified)]);
	if (token.isCancellationRequested) { return undefined; }
	// Binary resources have no line delta. Keep them in the file count without hiding text totals.
	// Waiting for both sides also releases all model references when either side is non-text.
	if ([before, after].some(result => result.status === 'rejected' && TextFileOperationError.isTextFileOperationError(result.reason) && result.reason.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY)) {
		return { added: 0, removed: 0, binary: true };
	}
	if (before.status !== 'fulfilled' || after.status !== 'fulfilled' || before.value === undefined || after.value === undefined) { return undefined; }
	const result = await diffs.summarize(before.value, after.value, token);
	return result && !token.isCancellationRequested ? { added: result.added, removed: result.removed } : undefined;
}

export function sumAgentWindowChangeStats(entries: readonly { readonly added?: number; readonly removed?: number }[]): IAgentWindowChangeStats | undefined {
	if (entries.some(entry => entry.added === undefined || entry.removed === undefined)) { return undefined; }
	return entries.reduce<IAgentWindowChangeStats>((total, entry) => ({ added: total.added + entry.added!, removed: total.removed + entry.removed! }), { added: 0, removed: 0 });
}
