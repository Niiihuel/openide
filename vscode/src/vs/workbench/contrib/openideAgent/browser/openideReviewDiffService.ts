/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Limiter, raceCancellation } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, IReference } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { LineRange } from '../../../../editor/common/core/ranges/lineRange.js';
import { DetailedLineRangeMapping } from '../../../../editor/common/diff/rangeMapping.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { buildDiffPreview, countDiff, OpenideDiffLine } from '../common/openideDiffPreview.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IOpenideReviewDiffResult {
	readonly version: number;
	readonly changes: readonly DetailedLineRangeMapping[];
}

export interface IOpenideReviewDiff {
	/** Undefined means cancelled, superseded or incomplete; it never means an empty diff. */
	compute(token: CancellationToken): Promise<IOpenideReviewDiffResult | undefined>;
}

export interface IOpenideDiffSummary {
	readonly added: number;
	readonly removed: number;
	readonly lines: OpenideDiffLine[];
}

export const IOpenideReviewDiffService = createDecorator<IOpenideReviewDiffService>('openideReviewDiffService');
export interface IOpenideReviewDiffService {
	readonly _serviceBrand: undefined;
	acquire(modified: ITextModel, baseline: string): IReference<IOpenideReviewDiff>;
	summarize(before: string, after: string, token: CancellationToken, maxLines?: number): Promise<IOpenideDiffSummary | undefined>;
}

interface DiffEntry {
	readonly store: DisposableStore;
	readonly original: ITextModel | undefined;
	readonly lifetime: CancellationTokenSource;
	references: number;
	cached?: IOpenideReviewDiffResult;
	pending?: { version: number; result: Promise<IOpenideReviewDiffResult | undefined> };
}

/** Shared computation for both review surfaces. Models stay synchronized by Monaco's worker. */
export class OpenideReviewDiffService extends Disposable implements IOpenideReviewDiffService {
	declare readonly _serviceBrand: undefined;
	private readonly entries = new Map<ITextModel, Map<string, DiffEntry>>();
	// Bound the backlog sent to the shared worker. Superseded jobs are dropped before dispatch.
	private readonly queue = this._register(new Limiter<IOpenideReviewDiffResult | undefined>(1));
	private readonly summaries = this._register(new Limiter<IOpenideDiffSummary | undefined>(2));
	private readonly lifetime = this._register(new CancellationTokenSource());
	private sequence = 0;

	constructor(
		@IEditorWorkerService private readonly worker: IEditorWorkerService,
		@IModelService private readonly models: IModelService,
	) { super(); }

	acquire(modified: ITextModel, baseline: string): IReference<IOpenideReviewDiff> {
		if (this._store.isDisposed || modified.isDisposed()) { return { object: { compute: async () => undefined }, dispose: () => {} }; }
		let versions = this.entries.get(modified);
		if (!versions) { versions = new Map(); this.entries.set(modified, versions); }
		let entry = versions.get(baseline);
		if (!entry) {
			const store = new DisposableStore();
			const lifetime = new CancellationTokenSource(this.lifetime.token);
			store.add({ dispose: () => lifetime.dispose(true) });
			entry = { store, lifetime, references: 0, original: baseline ? store.add(this.models.createModel(baseline, null,
				URI.from({ scheme: 'inmemory', path: `/openide-review-baseline/${++this.sequence}` }))) : undefined };
			versions.set(baseline, entry);
			const owned = entry;
			store.add(modified.onWillDispose(() => this.release(modified, baseline, owned)));
		}
		entry.references++;
		const current = entry;
		let disposed = false;
		return {
			object: { compute: token => disposed ? Promise.resolve(undefined) : this.compute(modified, current, token) },
			dispose: () => {
				if (disposed) { return; }
				disposed = true;
				if (--current.references === 0) { this.release(modified, baseline, current); }
			},
		};
	}

	/** Snapshot summaries use the same worker, with at most two temporary model pairs alive. */
	summarize(before: string, after: string, token: CancellationToken, maxLines = 0): Promise<IOpenideDiffSummary | undefined> {
		if (token.isCancellationRequested || this._store.isDisposed) { return Promise.resolve(undefined); }
		return raceCancellation(raceCancellation(this.summaries.queue(async () => {
			if (token.isCancellationRequested || this._store.isDisposed) { return undefined; }
			if (!before || !after || before === after) {
				return { ...countDiff(before, after, []), lines: maxLines ? buildDiffPreview(before, after, maxLines, []) : [] };
			}
			const store = new DisposableStore();
			try {
				const modified = store.add(this.models.createModel(after, null,
					URI.from({ scheme: 'inmemory', path: `/openide-review-snapshot/${++this.sequence}` })));
				const diff = store.add(this.acquire(modified, before));
				const result = await diff.object.compute(token);
				if (!result || token.isCancellationRequested) { return undefined; }
				return { ...countDiff(before, after, result.changes), lines: maxLines ? buildDiffPreview(before, after, maxLines, result.changes) : [] };
			} finally { store.dispose(); }
		}), this.lifetime.token), token);
	}

	private release(model: ITextModel, baseline: string, entry: DiffEntry): void {
		const versions = this.entries.get(model);
		if (versions?.get(baseline) === entry) {
			versions.delete(baseline);
			if (!versions.size) { this.entries.delete(model); }
		}
		entry.cached = undefined;
		entry.store.dispose();
	}

	private async compute(modified: ITextModel, entry: DiffEntry, token: CancellationToken): Promise<IOpenideReviewDiffResult | undefined> {
		if (token.isCancellationRequested || entry.store.isDisposed || modified.isDisposed()) { return undefined; }
		const version = modified.getVersionId();
		if (entry.cached?.version === version) { return entry.cached; }
		if (entry.pending?.version !== version) {
			const valid = () => !entry.store.isDisposed && !modified.isDisposed() && modified.getVersionId() === version;
			const result = this.queue.queue(async () => {
				if (!valid()) { return undefined; }
				let changes: readonly DetailedLineRangeMapping[];
				if (!entry.original) {
					// A creation has no original lines, not a phantom deleted empty line.
					changes = modified.getValueLength() === 0 ? [] : [new DetailedLineRangeMapping(new LineRange(1, 1), new LineRange(1, modified.getLineCount() + 1), undefined)];
				} else {
					const diff = await this.worker.computeDiff(entry.original.uri, modified.uri,
						{ ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false }, 'advanced');
					if (!diff || diff.quitEarly) { return undefined; }
					changes = diff.changes;
				}
				if (!valid()) { return undefined; }
				return entry.cached = { version, changes };
			});
			entry.pending = { version, result };
			// Clear failures too, so a later explicit refresh can retry without retaining a rejection.
			void result.then(() => { if (entry.pending?.result === result) { entry.pending = undefined; } },
				() => { if (entry.pending?.result === result) { entry.pending = undefined; } });
		}
		const result = await raceCancellation(raceCancellation(entry.pending.result, entry.lifetime.token), token);
		return !token.isCancellationRequested && !entry.store.isDisposed && !modified.isDisposed() && result?.version === modified.getVersionId() ? result : undefined;
	}

	override dispose(): void {
		this.lifetime.cancel();
		for (const versions of this.entries.values()) { for (const entry of versions.values()) { entry.store.dispose(); } }
		this.entries.clear();
		super.dispose();
	}
}

registerSingleton(IOpenideReviewDiffService, OpenideReviewDiffService, InstantiationType.Delayed);
