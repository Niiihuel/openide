/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Project Map work memory. It records which graph entities were injected into the
 *  model on each turn and, once that turn's outcome is known (rollback, revert, keep, or simply
 *  that the user kept conversing), credits signal to those entities.
 *
 *  Persiste en IStorageService (WORKSPACE/MACHINE), NO en `.openide/`: son datos derivados y
 *  regenerable, and writing into the workspace would trigger the watcher of the very index these
 *  lecciones anotan.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ICodebaseMemoryNode } from '../../../../code/common/openideCodebaseMemoryTypes.js';
import { applySignal, classify, ILearningEntry, learningKey, LearningState, pruneExpired } from '../../../../code/common/openideCodebaseLearning.js';

export const IOpenideProjectMapLearningService = createDecorator<IOpenideProjectMapLearningService>('openideProjectMapLearningService');

/** Weights per signal type. The implicit positive is deliberately worth little: it is the
 *  massive case (the user simply carries on), and unweighted it would drown the explicit signals. */
export const LEARNING_WEIGHTS = {
	rollback: -1,
	revert: -0.6,
	runError: -0.3,
	survived: 0.4,
	keep: 1,
} as const;

export type LearningSignal = keyof typeof LEARNING_WEIGHTS;

export interface ILearningStats {
	readonly tracked: number;
	readonly preferred: number;
	readonly tentative: number;
	readonly contested: number;
}

export interface IOpenideProjectMapLearningService {
	readonly _serviceBrand: undefined;
	/** Records the nodes that made it into a turn's prompt (post-truncation). */
	recordContext(messageId: string, nodes: readonly ICodebaseMemoryNode[]): void;
	/** Credits a signal to the nodes of those turns. */
	recordOutcome(messageIds: readonly string[], signal: LearningSignal): void;
	/** A node's state, synchronously (to avoid one await per node while assembling the context). */
	getState(uri: string, qualifiedNameOrName: string): LearningState | undefined;
	/** True si ese turno tuvo contexto registrado (para saber si vale acreditarle algo). */
	hasContext(messageId: string): boolean;
	stats(): ILearningStats;
	clear(): void;
}

const STORAGE_KEY = 'openide.memory.learning.v1';
/** Ceiling of persisted entries; with decay-based pruning it is rarely reached. */
const MAX_ENTRIES = 4000;
/** Turns with context remembered in memory (the outcome arrives shortly after). */
const MAX_TRACKED_TURNS = 200;

export class OpenideProjectMapLearningService extends Disposable implements IOpenideProjectMapLearningService {
	declare readonly _serviceBrand: undefined;

	private entries = new Map<string, ILearningEntry>();
	/** messageId → node keys injected in that turn. In memory only: a turn's outcome arrives
	 *  within the same session, so it need not survive a restart. */
	private readonly contextByMessage = new Map<string, string[]>();

	constructor(@IStorageService private readonly storageService: IStorageService) {
		super();
		this.load();
	}

	private now(): number { return Date.now(); }

	private load(): void {
		try {
			const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
			if (!raw) { return; }
			const parsed = JSON.parse(raw) as Record<string, ILearningEntry>;
			const loaded = new Map<string, ILearningEntry>();
			for (const [key, entry] of Object.entries(parsed ?? {})) {
				if (entry && typeof entry.pos === 'number' && typeof entry.neg === 'number' && typeof entry.lastAt === 'number') {
					loaded.set(key, entry);
				}
			}
			// Pruning on load keeps the blob bounded by itself, with no separate maintenance logic.
			this.entries = pruneExpired(loaded, this.now());
		} catch {
			this.entries = new Map();
		}
	}

	private save(): void {
		const now = this.now();
		let entries = pruneExpired(this.entries, now);
		if (entries.size > MAX_ENTRIES) {
			// Keep the most recent ones: they carry the most weight after decay.
			const sorted = [...entries.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, MAX_ENTRIES);
			entries = new Map(sorted);
		}
		this.entries = entries;
		this.storageService.store(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	recordContext(messageId: string, nodes: readonly ICodebaseMemoryNode[]): void {
		if (!messageId || !nodes.length) { return; }
		const keys = [...new Set(nodes.map(node => learningKey(node.uri, node.qualifiedName ?? node.name)))];
		this.contextByMessage.set(messageId, keys);
		if (this.contextByMessage.size > MAX_TRACKED_TURNS) {
			const oldest = this.contextByMessage.keys().next();
			if (!oldest.done) { this.contextByMessage.delete(oldest.value); }
		}
	}

	hasContext(messageId: string): boolean { return this.contextByMessage.has(messageId); }

	recordOutcome(messageIds: readonly string[], signal: LearningSignal): void {
		const weight = LEARNING_WEIGHTS[signal];
		const now = this.now();
		let touched = false;
		for (const messageId of messageIds) {
			const keys = this.contextByMessage.get(messageId);
			if (!keys?.length) { continue; }
			for (const key of keys) {
				this.entries.set(key, applySignal(this.entries.get(key), weight, now));
				touched = true;
			}
			// A turn credits once: if the user rolls back something already credited by
			// "survived", that turn must not add again.
			this.contextByMessage.delete(messageId);
		}
		if (touched) { this.save(); }
	}

	getState(uri: string, qualifiedNameOrName: string): LearningState | undefined {
		const entry = this.entries.get(learningKey(uri, qualifiedNameOrName));
		return entry ? classify(entry, this.now()) : undefined;
	}

	stats(): ILearningStats {
		const now = this.now();
		let preferred = 0, tentative = 0, contested = 0;
		for (const entry of this.entries.values()) {
			const state = classify(entry, now);
			if (state === 'preferred') { preferred++; }
			else if (state === 'tentative') { tentative++; }
			else if (state === 'contested') { contested++; }
		}
		return { tracked: this.entries.size, preferred, tentative, contested };
	}

	clear(): void {
		this.entries = new Map();
		this.contextByMessage.clear();
		this.storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
	}
}
