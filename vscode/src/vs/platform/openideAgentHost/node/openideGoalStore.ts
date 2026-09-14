/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { IOpenideGoal, IOpenideGoalCreate, IOpenideGoalUpdate, IOpenideGoalVerification, OpenideGoalStatus } from '../common/openideGoal.js';
import { openideJournalSnapshot } from '../common/openideRunJournal.js';
import { OpenideRunJournalStore } from './openideRunJournalStore.js';

const ledger = 'openide-goals-v1';
const terminal = new Set<OpenideGoalStatus>(['completed', 'cancelled']);
const statuses = new Set<OpenideGoalStatus>(['active', 'paused', 'blocked', 'interrupted', 'limit_reached', 'failed', 'completed', 'cancelled']);

function text(value: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim() || value.length > maximum) { throw new Error('Invalid OpenIDE goal text'); }
	return value.trim();
}
function budget(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > 1000) { throw new Error('OpenIDE goal requires a turn limit from 1 to 1000'); }
	return value;
}
function criteria(values: IOpenideGoalCreate['criteria']): IOpenideGoal['criteria'] {
	if (!Array.isArray(values) || !values.length || values.length > 50) { throw new Error('OpenIDE goal requires 1 to 50 acceptance criteria'); }
	return values.map((value, index) => ({ id: `C${index + 1}`, text: text(typeof value === 'string' ? value : value.text, 4000), ...(typeof value === 'object' && value.command !== undefined ? { command: text(value.command, 8000) } : {}), verified: false, evidenceIds: [] }));
}
function validate(goal: IOpenideGoal): void {
	if (!goal || typeof goal !== 'object' || !statuses.has(goal.status) || !Number.isInteger(goal.version) || goal.version < 1 || !Number.isInteger(goal.revision) || goal.revision < 1 || !Number.isInteger(goal.turns) || goal.turns < 0 || goal.turns > goal.maxTurns || !Number.isFinite(goal.createdAt) || !Number.isFinite(goal.updatedAt) || typeof goal.reason !== 'string' || !Array.isArray(goal.criteria) || !Array.isArray(goal.reports) || !Array.isArray(goal.evidence) || !Array.isArray(goal.runIds)) { throw new Error('OpenIDE goal state is corrupt'); }
	text(goal.id, 256); text(goal.sessionId, 256); text(goal.objective, 16000); budget(goal.maxTurns); criteria(goal.criteria);
	if (goal.planPath !== undefined) { text(goal.planPath, 4096); }
	const evidenceIds = new Set<string>();
	for (const item of goal.evidence) {
		text(item.id, 256); text(item.summary, 8000); text(item.runId, 256);
		if ((item.workspaceVersion !== undefined && (!Number.isInteger(item.workspaceVersion) || item.workspaceVersion < 0)) || (item.command !== undefined && (typeof item.command !== 'string' || item.command.length > 8000)) || evidenceIds.has(item.id) || !goal.criteria.some(criterion => criterion.id === item.criterionId) || !['user', 'verifier'].includes(item.source) || !Number.isInteger(item.revision) || item.revision < 1 || item.revision > goal.revision || !Number.isInteger(item.turn) || item.turn < 0 || item.turn > goal.turns) { throw new Error('OpenIDE goal evidence is corrupt'); }
		evidenceIds.add(item.id);
	}
	for (const [index, item] of goal.criteria.entries()) {
		if (item.id !== `C${index + 1}` || typeof item.verified !== 'boolean' || !Array.isArray(item.evidenceIds) || item.evidenceIds.some((id: string) => !goal.evidence.some(evidence => evidence.id === id && evidence.criterionId === item.id && evidence.revision === goal.revision && evidence.turn === goal.turns)) || item.verified !== (item.evidenceIds.length > 0)) { throw new Error('OpenIDE goal criterion is corrupt'); }
	}
	for (const item of goal.reports) { text(item.id, 256); text(item.text, 16000); if (!Number.isFinite(item.time) || !Number.isInteger(item.revision) || item.revision < 1 || item.revision > goal.revision || !Number.isInteger(item.turn) || item.turn < 0 || item.turn > goal.turns) { throw new Error('OpenIDE goal report is corrupt'); } }
	for (const runId of goal.runIds) { text(runId, 256); }
	if (goal.runIds.length !== goal.turns || new Set(goal.runIds).size !== goal.runIds.length || (goal.status === 'completed' && (!goal.criteria.every(item => item.verified) || !goal.reports.some(report => report.revision === goal.revision && report.turn === goal.turns)))) { throw new Error('OpenIDE goal completion state is corrupt'); }
}

/** Single-host durable goal ledger. The host authenticates ownership and verifier inputs. */
export class OpenideGoalStore {
	private static readonly chains = new Map<string, Promise<unknown>>();
	private readonly directory: string;
	private readonly journal: OpenideRunJournalStore;

	constructor(directory: string) {
		this.directory = resolve(directory);
		this.journal = new OpenideRunJournalStore(this.directory);
	}

	private async serialize<T>(operation: () => Promise<T>): Promise<T> {
		const previous = OpenideGoalStore.chains.get(this.directory) ?? Promise.resolve();
		const active = previous.catch(() => undefined).then(operation);
		OpenideGoalStore.chains.set(this.directory, active);
		try { return await active; } finally { if (OpenideGoalStore.chains.get(this.directory) === active) { OpenideGoalStore.chains.delete(this.directory); } }
	}

	private async read(): Promise<Map<string, IOpenideGoal>> {
		const goals = new Map<string, IOpenideGoal>();
		for (const { event } of await this.journal.read(ledger)) {
			if (event.kind !== 'memory/checkpoint' || event.payload['schema'] !== 'openide-goal-v1') { throw new Error('OpenIDE goal journal is corrupt'); }
			const goal = event.payload['goal'] as unknown as IOpenideGoal;
			validate(goal);
			const previous = goals.get(goal.id);
			if (goal.version !== (previous?.version ?? 0) + 1 || event.runId !== goal.id || (previous && (previous.sessionId !== goal.sessionId || previous.createdAt !== goal.createdAt))) { throw new Error('OpenIDE goal journal version is corrupt'); }
			goals.delete(goal.id); goals.set(goal.id, goal);
		}
		return goals;
	}

	private async save(goal: IOpenideGoal): Promise<IOpenideGoal> {
		validate(goal);
		await this.journal.append(ledger, { kind: 'memory/checkpoint', runId: goal.id, payload: { schema: 'openide-goal-v1', goal: openideJournalSnapshot(goal) } });
		return goal;
	}

	private async current(sessionId: string): Promise<IOpenideGoal | undefined> {
		text(sessionId, 256);
		return [...(await this.read()).values()].reverse().find(goal => goal.sessionId === sessionId);
	}

	create(request: IOpenideGoalCreate): Promise<IOpenideGoal> {
		const input = structuredClone(request);
		return this.serialize(async () => {
			const current = await this.current(input.sessionId);
			if (current && !terminal.has(current.status)) { throw new Error('This session already has an unfinished OpenIDE goal'); }
			const now = Date.now();
			return this.save({ id: randomUUID(), sessionId: input.sessionId, objective: text(input.objective, 16000), revision: 1, version: 1, status: 'active', reason: '', createdAt: now, updatedAt: now, turns: 0, maxTurns: budget(input.maxTurns ?? 20), criteria: criteria(input.criteria), reports: [], evidence: [], runIds: [], ...(input.planPath ? { planPath: text(input.planPath, 4096) } : {}) });
		});
	}

	get(sessionId: string): Promise<IOpenideGoal | undefined> { return this.serialize(() => this.current(sessionId)); }
	list(): Promise<IOpenideGoal[]> { return this.serialize(async () => [...(await this.read()).values()]); }

	private async checked(sessionId: string, goalId: string, expectedVersion: number): Promise<IOpenideGoal> {
		const goal = await this.current(sessionId);
		if (!goal || goal.id !== goalId || goal.version !== expectedVersion) { throw new Error('OpenIDE goal changed; refresh before retrying'); }
		if (terminal.has(goal.status)) { throw new Error('OpenIDE goal is already finished'); }
		return goal;
	}

	update(sessionId: string, request: IOpenideGoalUpdate): Promise<IOpenideGoal> {
		const input = structuredClone(request);
		return this.serialize(async () => {
			const goal = await this.checked(sessionId, input.goalId, input.expectedVersion);
			let next = { ...goal, version: goal.version + 1, updatedAt: Date.now() };
			switch (input.action) {
				case 'pause': next = { ...next, status: 'paused', reason: 'Paused by user' }; break;
				case 'cancel': next = { ...next, status: 'cancelled', reason: 'Cancelled by user' }; break;
				case 'resume': {
					if (goal.status === 'active') { throw new Error('OpenIDE goal is already active'); }
					const maxTurns = budget(input.maxTurns ?? goal.maxTurns);
					if (maxTurns <= goal.turns) { throw new Error('Increase the goal turn limit before resuming'); }
					next = { ...next, status: 'active', reason: '', maxTurns }; break;
				}
				case 'invalidate': next = { ...next, reason: text(input.reason, 4000), criteria: goal.criteria.map(item => ({ ...item, verified: false, evidenceIds: [] })) }; break;
				case 'block': case 'fail': next = { ...next, status: input.action === 'block' ? 'blocked' : 'failed', reason: text(input.reason, 4000) }; break;
				case 'startTurn': {
					if (goal.status !== 'active') { throw new Error('Only an active OpenIDE goal can start a turn'); }
					const runId = text(input.runId, 256);
					if (goal.runIds.includes(runId)) { throw new Error('OpenIDE goal turn was already started'); }
					if (goal.turns >= goal.maxTurns) { next = { ...next, status: 'limit_reached', reason: 'Goal turn limit reached' }; break; }
					next = { ...next, turns: goal.turns + 1, runIds: [...goal.runIds, runId], criteria: goal.criteria.map(item => ({ ...item, verified: false, evidenceIds: [] })) }; break;
				}
				case 'report':
					if (goal.reports.length >= 2000) { throw new Error('OpenIDE goal report limit reached'); }
					next = { ...next, reports: [...goal.reports, { id: randomUUID(), time: Date.now(), text: text(input.text, 16000), revision: goal.revision, turn: goal.turns }] }; break;
				case 'revise':
					if (goal.status === 'active') { throw new Error('Pause the goal before changing its contract'); }
					next = { ...next, objective: text(input.objective, 16000), criteria: criteria(input.criteria), evidence: [], revision: goal.revision + 1 }; break;
				case 'complete':
					if (!goal.criteria.every(item => item.verified) || !goal.reports.some(report => report.revision === goal.revision && report.turn === goal.turns)) { throw new Error('OpenIDE goal requires verified criteria and a report before completion'); }
					next = { ...next, status: 'completed', reason: 'All acceptance criteria verified' }; break;
				default: throw new Error('Unknown OpenIDE goal action');
			}
			return this.save(next);
		});
	}

	/** Call only after validating real evidence, or an explicit user confirmation, outside the model tool channel. */
	verify(sessionId: string, request: IOpenideGoalVerification): Promise<IOpenideGoal> {
		const input = structuredClone(request);
		return this.serialize(async () => {
			const goal = await this.checked(sessionId, input.goalId, input.expectedVersion);
			if (!goal.criteria.some(item => item.id === input.criterionId) || !['user', 'verifier'].includes(input.source)) { throw new Error('Invalid OpenIDE goal verification'); }
			if (input.source === 'verifier' && input.runId !== goal.runIds.at(-1)) { throw new Error('OpenIDE goal verification must belong to the current turn'); }
			if (input.source === 'verifier' && (!input.command || input.command !== goal.criteria.find(item => item.id === input.criterionId)?.command)) { throw new Error('OpenIDE goal verifier must use the acceptance criterion command'); }
			if (goal.evidence.length >= 2000) { throw new Error('OpenIDE goal evidence limit reached'); }
			const evidence = { id: randomUUID(), criterionId: input.criterionId, summary: text(input.summary, 8000), runId: text(input.runId, 256), source: input.source, revision: goal.revision, turn: goal.turns, ...(input.workspaceVersion !== undefined ? { workspaceVersion: input.workspaceVersion } : {}), ...(input.command !== undefined ? { command: text(input.command, 8000) } : {}) };
			return this.save({ ...goal, version: goal.version + 1, updatedAt: Date.now(), evidence: [...goal.evidence, evidence], criteria: goal.criteria.map(item => item.id === input.criterionId ? { ...item, verified: true, evidenceIds: [...item.evidenceIds, evidence.id] } : item) });
		});
	}

	/** The previous owner must be stopped. Recovery records uncertainty and never replays work. */
	recover(sessionId: string): Promise<IOpenideGoal | undefined> {
		return this.serialize(async () => {
			const goal = await this.current(sessionId);
			if (!goal || terminal.has(goal.status) || (goal.status !== 'active' && !goal.criteria.some(item => item.verified))) { return goal; }
			const reason = goal.status === 'active' ? 'Previous host stopped; inspect outstanding operations before resuming' : 'The workspace may have changed while OpenIDE was closed. Verify the current state again before completing this goal.';
			return this.save({ ...goal, version: goal.version + 1, updatedAt: Date.now(), status: goal.status === 'active' ? 'interrupted' : goal.status, reason, criteria: goal.criteria.map(item => ({ ...item, verified: false, evidenceIds: [] })) });
		});
	}
}
