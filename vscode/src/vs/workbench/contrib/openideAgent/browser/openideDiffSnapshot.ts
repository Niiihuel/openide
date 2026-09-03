/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — content provider for the LEFT side (baseline) of the agent's diff.
 *  It stores the first content seen for each file in the session; Monaco's diff compares
 *  ese snapshot (scheme `openide-diff`, read-only) contra el archivo actual en disco.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export const OPENIDE_DIFF_SCHEME = 'openide-diff';
const OPENIDE_DIFF_STORAGE_KEY = 'openide.agent.diffSnapshots.v1';
const MAX_PERSISTED_BASELINE_CHARS = 8_000_000;

interface IPersistedDiffSnapshots {
	version: 1;
	entries: Array<{ path: string; content: string; existed: boolean; added: number; removed: number }>;
}

export class OpenideDiffSnapshotProvider implements ITextModelContentProvider {

	/** path (relative or absolute, exactly as the tool uses it) → baseline (content + whether it existed). */
	private readonly baselines = new Map<string, { content: string; existed: boolean }>();
	/** Subset of baselines whose current content still differs. Keeping it apart from the map stops
	 *  the file stepper from counting snapshots that were captured but are already resolved/unchanged. */
	private readonly pending = new Set<string>();
	private readonly counts = new Map<string, { added: number; removed: number }>();

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		this.restore();
	}

	private restore(): void {
		const raw = this.storageService.get(OPENIDE_DIFF_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}
		try {
			const data = JSON.parse(raw) as Partial<IPersistedDiffSnapshots>;
			if (data.version !== 1 || !Array.isArray(data.entries)) {
				return;
			}
			let total = 0;
			for (const entry of data.entries) {
				if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string' || typeof entry.existed !== 'boolean') {
					continue;
				}
				total += entry.content.length;
				if (total > MAX_PERSISTED_BASELINE_CHARS) {
					break;
				}
				this.baselines.set(entry.path, { content: entry.content, existed: entry.existed });
				this.pending.add(entry.path);
				this.counts.set(entry.path, {
					added: Math.max(0, Number(entry.added) || 0),
					removed: Math.max(0, Number(entry.removed) || 0),
				});
			}
		} catch {
			// If the state is corrupt, openReview keeps the safe fallback against git.
		}
	}

	private persist(): void {
		let total = 0;
		const entries: IPersistedDiffSnapshots['entries'] = [];
		for (const path of this.baselines.keys()) {
			if (!this.pending.has(path)) {
				continue;
			}
			const snapshot = this.baselines.get(path)!;
			total += snapshot.content.length;
			if (total > MAX_PERSISTED_BASELINE_CHARS) {
				break;
			}
			const count = this.counts.get(path) ?? { added: 0, removed: 0 };
			entries.push({ path, ...snapshot, ...count });
		}
		const data: IPersistedDiffSnapshots = { version: 1, entries };
		this.storageService.store(OPENIDE_DIFF_STORAGE_KEY, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	/** Stores the baseline the FIRST time a path is seen (diff accumulated against that point). */
	setBaselineOnce(path: string, content: string, existed: boolean = true): void {
		if (!this.baselines.has(path)) {
			this.baselines.set(path, { content, existed });
		}
	}

	getBaseline(path: string): string | undefined {
		return this.baselines.get(path)?.content;
	}

	getSnapshot(path: string): { content: string; existed: boolean } | undefined {
		return this.baselines.get(path);
	}

	/** Paths with changes pending review (in order of first edit). */
	pendingPaths(): string[] {
		return [...this.baselines.keys()].filter(path => this.pending.has(path));
	}

	pendingDiffs(): Array<{ path: string; added: number; removed: number }> {
		return this.pendingPaths().map(path => ({ path, ...(this.counts.get(path) ?? { added: 0, removed: 0 }) }));
	}

	/** Updates the live diff signal. The session recomputes it against the model and the agent loop
	 *  marks it immediately after each write/edit, even when the editor is closed. */
	markPending(path: string, value: boolean, added = 0, removed = 0): boolean {
		const before = this.pending.has(path);
		if (value && this.baselines.has(path)) {
			this.pending.add(path);
			this.counts.set(path, { added: Math.max(0, added), removed: Math.max(0, removed) });
		} else {
			this.pending.delete(path);
			this.counts.delete(path);
		}
		this.persist();
		return before !== this.pending.has(path);
	}

	/** Replaces the baseline (per-block keep: the kept block is folded into the baseline and stops
	 *  counting as a diff). It syncs the `openide-diff` model when it is alive (diff open). */
	overwriteBaseline(path: string, content: string): void {
		const prev = this.baselines.get(path);
		this.baselines.set(path, { content, existed: prev?.existed ?? true });
		this.modelService.getModel(this.uriFor(path))?.setValue(content);
		this.persist();
	}

	/** Forgets the baseline (keep/revert from the UI): the next edit starts a fresh diff. */
	clearBaseline(path: string): void {
		this.baselines.delete(path);
		this.pending.delete(path);
		this.counts.delete(path);
		this.persist();
	}

	/** Keep All is a single durable transition: it clears every path in memory, persists once and
	 *  lets the caller await the flush before restarting/closing the workbench. */
	async clearBaselines(paths: readonly string[]): Promise<void> {
		for (const path of new Set(paths)) {
			this.baselines.delete(path);
			this.pending.delete(path);
			this.counts.delete(path);
		}
		this.persist();
		await this.storageService.flush();
	}

	uriFor(path: string): URI {
		return URI.from({ scheme: OPENIDE_DIFF_SCHEME, path: '/' + encodeURIComponent(path) });
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this.modelService.getModel(resource);
		if (existing) {
			return existing;
		}
		const path = decodeURIComponent(resource.path.replace(/^\//, ''));
		const content = this.baselines.get(path)?.content ?? '';
		const languageSelection = this.languageService.createByFilepathOrFirstLine(URI.file(path));
		return this.modelService.createModel(content, languageSelection, resource);
	}
}
