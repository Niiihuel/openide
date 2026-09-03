/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — persistencia acotada de ejecuciones de subagentes por workspace.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { cloneSubagentRun, isTerminalSubagentStatus, ISubagentRun } from '../common/openideSubagentTypes.js';

const STORAGE_KEY = 'openide.subagents.runs.v2';
const LEGACY_STORAGE_KEY = 'openide.subagents.runs.v1';
const MAX_RUNS = 300;
const MAX_CHARS = 8_000_000;

export const ISubagentRunStorageService = createDecorator<ISubagentRunStorageService>('openideSubagentRunStorageService');

export interface ISubagentRunStorageService {
	readonly _serviceBrand: undefined;
	list(): readonly ISubagentRun[];
	get(runId: string): ISubagentRun | undefined;
	save(run: ISubagentRun): void;
	remove(runId: string): void;
}

export class SubagentRunStorageService implements ISubagentRunStorageService {
	declare readonly _serviceBrand: undefined;
	private readonly runs = new Map<string, ISubagentRun>();

	constructor(@IStorageService private readonly storageService: IStorageService) { this.load(); }

	private load(): void {
		const currentRaw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		const legacyRaw = this.storageService.get(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE);
		let raw = currentRaw;
		let migrated = false;
		if (raw) { try { const candidate = JSON.parse(raw); if (!candidate || !Array.isArray(candidate.runs)) { throw new Error('invalid v2'); } } catch { raw = legacyRaw; migrated = !!raw; } }
		else { raw = legacyRaw; migrated = !!raw; }
		if (!raw) { return; }
		try {
			const parsed = JSON.parse(raw);
			if (currentRaw && legacyRaw && raw === currentRaw) { this.storageService.remove(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE); }
			for (const candidate of Array.isArray(parsed?.runs) ? parsed.runs : []) {
				try {
					if (!candidate || typeof candidate.runId !== 'string' || typeof candidate.parentMessageId !== 'string') { continue; }
					const legacyMetrics = candidate.metrics ?? {};
					const normalized: ISubagentRun = {
						...candidate,
						metrics: {
							inputTokens: Number(legacyMetrics.inputTokens) || 0, outputTokens: Number(legacyMetrics.outputTokens) || 0,
							toolCalls: Number(legacyMetrics.toolCalls) || 0, filesRead: Number(legacyMetrics.filesRead) || 0,
							filesModified: Number(legacyMetrics.filesModified) || 0, searches: Number(legacyMetrics.searches) || 0,
							errors: Number(legacyMetrics.errors) || 0, cancellations: Number(legacyMetrics.cancellations) || 0,
							routingAttempts: Number(legacyMetrics.routingAttempts) || 0, fallbacks: Number(legacyMetrics.fallbacks) || 0,
							...(Number.isFinite(legacyMetrics.timeToFirstEventMs) ? { timeToFirstEventMs: Math.max(0, Number(legacyMetrics.timeToFirstEventMs)) } : {}),
						},
						routingAttempts: Array.isArray(candidate.routingAttempts) ? candidate.routingAttempts.slice(-20) : [],
						timeline: Array.isArray(candidate.timeline) ? candidate.timeline : [], childRunIds: Array.isArray(candidate.childRunIds) ? candidate.childRunIds : [],
						deliveryState: candidate.deliveryState === 'delivered' ? 'delivered' : 'pending', generation: Number(candidate.generation) || 1,
						attemptCount: Math.max(0, Number(candidate.attemptCount) || 0), activeLease: undefined,
					};
					const run = isTerminalSubagentStatus(normalized.status) ? normalized : { ...normalized, status: 'interrupted' as const, completedAt: Date.now(), error: 'La ventana se reinició durante la ejecución.' };
					migrated ||= run !== normalized; this.runs.set(run.runId, cloneSubagentRun(run));
				} catch { /* candidato corrupto aislado */ }
			}
			if (migrated) { queueMicrotask(() => this.persist()); }
		} catch { /* storage corrupto: fail-safe vacío */ }
	}

	private persist(): void {
		let runs = [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
		while (runs.length && JSON.stringify({ runs }).length > MAX_CHARS) { runs = runs.slice(0, -1); }
		this.storageService.store(STORAGE_KEY, JSON.stringify({ runs }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		// The current write is already confirmed by IStorageService: do not let a stale v1
		// resurface if the new value gets corrupted in the future.
		this.storageService.remove(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE);
	}

	list(): readonly ISubagentRun[] { return Object.freeze([...this.runs.values()].map(cloneSubagentRun).sort((a, b) => b.createdAt - a.createdAt)); }
	get(runId: string): ISubagentRun | undefined { const run = this.runs.get(runId); return run ? cloneSubagentRun(run) : undefined; }
	save(run: ISubagentRun): void { this.runs.set(run.runId, cloneSubagentRun(run)); this.persist(); }
	remove(runId: string): void { this.runs.delete(runId); this.persist(); }
}
