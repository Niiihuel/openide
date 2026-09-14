/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../common/openideStrings.js';
import { IOpenideGoalSnapshotService } from './openideGoalSnapshot.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenideGoal, IOpenideGoalUpdate } from '../../../../platform/openideAgentHost/common/openideGoal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { parseOpenideGoalDocument } from '../common/openideGoalDocument.js';
import { contentHash } from '../common/openideMessageChanges.js';
import { IFileEditEvent } from '../common/openideAgentTypes.js';

export const IOpenideGoalService = createDecorator<IOpenideGoalService>('openideGoalService');
interface IGoalCheckResult { readonly output: string; readonly exitCode?: number; readonly timedOut?: boolean; readonly awaitingInput?: boolean }
export interface IOpenideGoalDriver {
	/** Live host-owned work that must finish before the goal can be certified. */
	pendingWork?(): string | undefined;
	run(runId: string, context: string, token: CancellationToken): Promise<{ error?: string; report: string; stop?: boolean }>;
	check(runId: string, command: string, token: CancellationToken): Promise<IGoalCheckResult | undefined>;
}
export interface IOpenideGoalService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<{ sessionId: string; goal: IOpenideGoal | undefined }>;
	get(sessionId: string): Promise<IOpenideGoal | undefined>;
	create(sessionId: string, objective: string, criteria: readonly string[], planPath?: string, maxTurns?: number): Promise<IOpenideGoal>;
	pause(sessionId: string): Promise<void>;
	resume(sessionId: string): Promise<void>;
	cancel(sessionId: string): Promise<void>;
	confirmCriterion(sessionId: string, criterionId: string): Promise<void>;
	openDocument(sessionId: string, kind: 'goal' | 'report'): Promise<void>;
	openChanges(sessionId: string): Promise<void>;
	execute(sessionId: string, token: CancellationToken, driver: IOpenideGoalDriver): Promise<void>;
	report(sessionId: string, text: string): Promise<string>;
	context(sessionId: string): Promise<string>;
	externalGoals(goalId?: string): Promise<readonly IOpenideGoal[]>;
	externalReport(goalId: string, text: string): Promise<string>;
	recordChange(sessionId: string, event: IFileEditEvent): Promise<void>;
}
type GoalAction = IOpenideGoalUpdate extends infer T ? T extends IOpenideGoalUpdate ? Omit<T, 'goalId' | 'expectedVersion'> : never : never;
interface IGoalChange { path: string; before: string; after: string; existed: boolean; deleted: boolean; uncertain: boolean }

/** Host-owned state drives both the native harness and the persistent, editable documents. */
export class OpenideGoalService extends Disposable implements IOpenideGoalService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<{ sessionId: string; goal: IOpenideGoal | undefined }>());
	readonly onDidChange = this.changed.event;
	private readonly known = new Map<string, IOpenideGoal>();
	private readonly running = new Map<string, CancellationTokenSource>();
	private readonly pendingWork = new Map<string, () => string | undefined>();
	private readonly queues = new Map<string, Promise<unknown>>();
	private workspaceVersion = 0;
	private workspaceGeneration = 0;
	private readonly dirty = new Set<string>();
	constructor(
		@IOpenideNativeServices private readonly native: IOpenideNativeServices,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IFileService private readonly files: IFileService,
		@IEditorService private readonly editors: IEditorService,
		@IWorkbenchEnvironmentService private readonly environment: IWorkbenchEnvironmentService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@IWorkingCopyService private readonly workingCopies: IWorkingCopyService,
		@IOpenideGoalSnapshotService private readonly snapshots: IOpenideGoalSnapshotService,
	) {
		super();
		this._register(Event.any(workingCopies.onDidChangeContent, workingCopies.onDidChangeDirty)(copy => {
			if (!this.isVerificationInput(copy.resource)) { return; }
			this.workspaceVersion++;
			for (const [sessionId, goal] of this.known) { if (!['completed', 'cancelled'].includes(goal.status)) { this.dirty.add(sessionId); } }
		}));
		// Consume the existing workspace watcher; do not start another recursive filesystem scan.
		this._register(files.onDidFilesChange(event => {
			if (!event.rawAdded.concat(event.rawUpdated, event.rawDeleted).some(resource => this.workspace.getWorkspaceFolder(resource) && !/\/(?:\.git|node_modules|\.build|out|dist)\//.test(resource.path) && !/\/\.openide\/(?:goals|memory|memory-indexes|codegraph)\//.test(resource.path))) { return; }
			this.workspaceVersion++;
			for (const [sessionId, goal] of this.known) { if (goal.status !== 'completed' && goal.status !== 'cancelled') { this.dirty.add(sessionId); } }
		}));
		this._register(workspace.onDidChangeWorkspaceFolders(() => { this.workspaceGeneration++; for (const cts of this.running.values()) { cts.cancel(); } this.known.clear(); this.dirty.clear(); this.workspaceVersion++; }));
	}

	private serial<T>(sessionId: string, work: (epoch: number) => Promise<T>): Promise<T> {
		const epoch = this.workspaceGeneration;
		const previous = this.queues.get(sessionId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(async () => { this.assertWorkspace(epoch); const result = await work(epoch); this.assertWorkspace(epoch); return result; });
		this.queues.set(sessionId, next);
		return next.finally(() => { if (this.queues.get(sessionId) === next) { this.queues.delete(sessionId); } });
	}
	private assertWorkspace(epoch: number): void { if (epoch !== this.workspaceGeneration || this._store.isDisposed) { throw new Error('Goal workspace changed; stale operation stopped.'); } }
	private root(): URI { const root = this.workspace.getWorkspace().folders[0]?.uri; if (!root || root.scheme !== 'file') { throw new Error(t('goal.local')); } return root; }
	private document(goal: IOpenideGoal, kind: 'goal' | 'report'): URI { return URI.joinPath(this.root(), '.openide', 'goals', goal.id, kind === 'goal' ? 'GOAL.md' : 'REPORT.md'); }
	private privateRoot(goal: IOpenideGoal): URI { return URI.joinPath(this.environment.workspaceStorageHome, this.workspace.getWorkspace().id, 'openide-goals', goal.id); }
	private isVerificationInput(resource: URI): boolean {
		return !!this.workspace.getWorkspaceFolder(resource) && !/\/(?:\.git|node_modules|\.build|out|dist)\//.test(resource.path) && !/\/\.openide\/(?:memory|memory-indexes|codegraph)\//.test(resource.path) && !/\/\.openide\/goals\/[^/]+\/REPORT\.md$/.test(resource.path);
	}
	private hasUnsavedWork(): boolean { return this.workingCopies.dirtyWorkingCopies.some(copy => this.isVerificationInput(copy.resource)); }
	private contract(goal: IOpenideGoal): string {
		return `---\nschema_version: 1\nid: ${goal.id}\nrevision: ${goal.revision}\nplan_ref: ${JSON.stringify(goal.planPath ?? '')}\n---\n\n# Goal\n\n${goal.objective}\n\n## Acceptance criteria\n\n${goal.criteria.map(c => `- ${c.id}: ${c.text}${c.command ? `\n  Command: ${c.command}` : ''}`).join('\n')}\n`;
	}
	private async publish(goal: IOpenideGoal, create = false, epoch = this.workspaceGeneration): Promise<IOpenideGoal> {
		this.assertWorkspace(epoch);
		const contractPath = this.document(goal, 'goal');
		const reportPath = this.document(goal, 'report');
		await this.native.host.validateWorkspacePath({ path: contractPath.fsPath, roots: [this.root().fsPath], mutation: true });
		await this.native.host.validateWorkspacePath({ path: reportPath.fsPath, roots: [this.root().fsPath], mutation: true });
		this.assertWorkspace(epoch);
		await this.files.createFolder(URI.joinPath(contractPath, '..'));
		this.assertWorkspace(epoch);
		if (create || !await this.files.exists(contractPath)) { this.assertWorkspace(epoch); await this.files.writeFile(contractPath, VSBuffer.fromString(this.contract(goal))); }
		const changeIndex = URI.joinPath(this.privateRoot(goal), 'changes.json');
		let changes: IGoalChange[] = [];
		if (await this.files.exists(changeIndex)) { changes = JSON.parse((await this.files.readFile(changeIndex)).value.toString()) as IGoalChange[]; }
		const changeLinks = changes.map(change => `- [${change.path.replace(/[\[\]\n\r]/g, '_')}](../../../${change.path.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16))).join('/')})${change.uncertain ? ' — attribution uncertain' : ' — captured native edit'}`).join('\n');
		const currentEvidenceIds = new Set(goal.criteria.filter(criterion => criterion.verified).flatMap(criterion => criterion.evidenceIds));
		const report = `# Goal report\n\n${goal.objective}\n\nStatus: ${goal.status}\nReason: ${goal.reason}\nContract revision: ${goal.revision}\nTurns: ${goal.turns}/${goal.maxTurns}\n\n## Criteria\n\n${goal.criteria.map(c => `- [${c.verified ? 'x' : ' '}] ${c.id}: ${c.text}`).join('\n')}\n\n## Evidence\n\n${goal.evidence.filter(e => currentEvidenceIds.has(e.id)).map(e => `- ${e.id} · ${e.criterionId} · ${e.source} · run ${e.runId}\n  ${e.summary}`).join('\n')}\n\n## Historical evidence\n\n${goal.evidence.filter(e => !currentEvidenceIds.has(e.id)).map(e => `- ${e.id} · ${e.criterionId} · revision ${e.revision} · turn ${e.turn} (not current)\n  ${e.summary}`).join('\n')}\n\n## Activity\n\n${goal.reports.map(r => `### ${new Date(r.time).toISOString()}\n\n${r.text}`).join('\n\n')}\n\n## File changes\n\n${changeLinks || 'No native edits captured.'}\n\nFile changes are available through the Goal Changes action. Only captured native edits have operation attribution. CLI workspace changes remain observations.\n`;
		this.assertWorkspace(epoch);
		await this.files.writeFile(reportPath, VSBuffer.fromString(report));
		this.assertWorkspace(epoch); this.known.set(goal.sessionId, goal);
		this.changed.fire({ sessionId: goal.sessionId, goal });
		return goal;
	}
	async get(sessionId: string): Promise<IOpenideGoal | undefined> {
		if (!this.native.available) { return undefined; }
		return this.serial(sessionId, async epoch => {
			let goal = await this.native.host.goalGet(sessionId);
			if (goal) { goal = await this.invalidatePending(goal); }
			this.assertWorkspace(epoch);
			if (goal) { this.known.set(sessionId, goal); } this.changed.fire({ sessionId, goal }); return goal;
		});
	}
	async create(sessionId: string, objective: string, criteria: readonly string[], planPath?: string, maxTurns = 20): Promise<IOpenideGoal> {
		this.root();
		return this.serial(sessionId, async epoch => this.publish(await this.native.host.goalCreate({ sessionId, objective, criteria: criteria.map(value => { const split = value.indexOf(' :: '); return split < 0 ? value : { text: value.slice(0, split), command: value.slice(split + 4) }; }), planPath, maxTurns }), true, epoch));
	}
	/** Call within the session queue so a completion cannot pass pending workspace invalidation. */
	private async invalidatePending(goal: IOpenideGoal): Promise<IOpenideGoal> {
		if (this.dirty.delete(goal.sessionId) && goal.criteria.some(c => c.verified) && !['completed', 'cancelled'].includes(goal.status)) {
			return this.native.host.goalUpdate(goal.sessionId, { action: 'invalidate', reason: 'Workspace changed; verify criteria again.', goalId: goal.id, expectedVersion: goal.version });
		}
		return goal;
	}
	private async update(sessionId: string, action: GoalAction): Promise<IOpenideGoal> {
		return this.serial(sessionId, async epoch => {
			let goal = await this.native.host.goalGet(sessionId); if (!goal) { throw new Error('No goal in this conversation'); }
			if (action.action === 'complete') {
				const contractMatches = await this.contractMatches(goal);
				goal = await this.invalidatePending(goal);
				if (this.hasUnsavedWork() || !contractMatches || !goal.criteria.every(c => c.verified)) {
					action = { action: 'block', reason: this.hasUnsavedWork() ? 'Save or revert unsaved workspace files before verifying the goal.' : contractMatches ? 'Workspace changed after verification. Verify the current state before completing.' : 'GOAL.md changed. Review the accepted criteria before completing.' };
				}
				const pending = this.pendingWork.get(sessionId)?.();
				if (pending) { action = { action: 'block', reason: pending }; }
			}
			return this.publish(await this.native.host.goalUpdate(sessionId, { ...action, goalId: goal.id, expectedVersion: goal.version }), false, epoch);
		});
	}
	async pause(sessionId: string): Promise<void> { try { await this.update(sessionId, { action: 'pause' }); } finally { this.running.get(sessionId)?.cancel(); } }

	async resume(sessionId: string): Promise<void> {
		const epoch = this.workspaceGeneration;
		let goal = await this.get(sessionId);
		if (!goal) { return; }
		if (this.hasUnsavedWork()) { throw new Error('Save or revert unsaved workspace files before resuming the goal.'); }
		let maxTurns: number | undefined;
		if (goal.turns >= goal.maxTurns) {
			const used = goal.turns;
			if (used >= 1000) { throw new Error('This goal reached the maximum total of 1000 turns. Review the remaining work before creating another goal.'); }
			const value = await this.quickInput.input({
				prompt: t('goal.extendLimit', used),
				value: String(Math.min(1000, used + 10)),
				validateInput: async value => Number.isInteger(Number(value)) && Number(value) > used && Number(value) <= 1000 ? undefined : t('goal.invalidLimit', used),
			});
			if (value === undefined) { return; }
			maxTurns = Number(value);
			if (!Number.isInteger(maxTurns) || maxTurns <= used || maxTurns > 1000) { throw new Error('Invalid goal turn limit'); }
		}
		if (goal && !await this.contractMatches(goal)) {
			const content = (await this.files.readFile(this.document(goal, 'goal'))).value.toString();
			const proposed = parseOpenideGoalDocument(content, goal);
			const accepted = await this.quickInput.pick([
				{ label: t('goal.acceptRevision'), accept: true, description: proposed.objective },
				{ label: t('goal.keepRevision'), accept: false },
			], { placeHolder: t('goal.reviewRevision') });
			if (!accepted?.accept) { return; }
			if ((await this.files.readFile(this.document(goal, 'goal'))).value.toString() !== content) { throw new Error('Goal document changed during review. Review the new revision.'); }
			if (goal.status !== 'paused') { goal = await this.update(sessionId, { action: 'pause' }); }
			goal = await this.update(sessionId, { action: 'revise', ...proposed });
			await this.publish(goal, true, epoch);
		}
		await this.update(sessionId, { action: 'resume', maxTurns });
	}
	async cancel(sessionId: string): Promise<void> { try { await this.update(sessionId, { action: 'cancel' }); } finally { this.running.get(sessionId)?.cancel(); } }
	async report(sessionId: string, text: string): Promise<string> { await this.update(sessionId, { action: 'report', text: text.slice(0, 16000) }); return 'Goal report saved. Reporting does not verify criteria or complete the goal.'; }
	/** MCP credentials identify a window, not an individual CLI conversation. Reports remain unverified. */
	async externalGoals(goalId?: string): Promise<readonly IOpenideGoal[]> {
		const sessions = [...this.known.values()].filter(goal => !goalId || goal.id === goalId).map(goal => goal.sessionId);
		const goals = await Promise.all(sessions.map(session => this.get(session)));
		return goals.filter((goal): goal is IOpenideGoal => !!goal && (!goalId || goal.id === goalId));
	}
	async externalReport(goalId: string, text: string): Promise<string> {
		const goal = [...this.known.values()].find(goal => goal.id === goalId);
		if (!goal) { throw new Error('Goal is not loaded in this OpenIDE window. Open its conversation and use goal_get first.'); }
		return this.serial(goal.sessionId, async epoch => {
			const latest = await this.native.host.goalGet(goal.sessionId);
			if (!latest || latest.id !== goalId) { throw new Error('Goal changed; read goal_get again before reporting.'); }
			await this.publish(await this.native.host.goalUpdate(goal.sessionId, { goalId, expectedVersion: latest.version, action: 'report', text: `[External CLI report; caller-declared, not verification]\n${text.slice(0, 15500)}` }), false, epoch);
			return 'External report saved. This does not verify criteria, establish edit attribution or complete the goal.';
		});
	}
	async context(sessionId: string): Promise<string> {
		const goal = await this.get(sessionId); if (!goal) { return ''; }
		return `OPENIDE GOAL ${goal.id}, revision ${goal.revision}, status ${goal.status}, turns ${goal.turns}/${goal.maxTurns}.\nObjective: ${goal.objective}\nAcceptance criteria: ${goal.criteria.map(c => `${c.id} [${c.verified ? 'verified' : 'pending'}]: ${c.text}${c.command ? ` (host check: ${c.command})` : ' (requires user verification)'}`).join('\n')}\nRecent progress and host check results:\n${goal.reports.slice(-3).map(report => report.text).join('\n').slice(-8000)}\nThe host owns continuation and verification. Do not activate another provider /goal loop. Use goal_report for concise progress and evidence references. Do not edit GOAL.md or weaken checks to claim completion. Save reusable, verified lessons through the existing memory tools with goal/evidence references.\n`;
	}
	private async contractMatches(goal: IOpenideGoal): Promise<boolean> { try { return (await this.files.readFile(this.document(goal, 'goal'))).value.toString() === this.contract(goal); } catch { return false; } }
	async confirmCriterion(sessionId: string, criterionId: string): Promise<void> {
		const pending = this.pendingWork.get(sessionId)?.(); if (pending) { throw new Error(pending); }
		if (this.hasUnsavedWork()) { throw new Error('Save or revert unsaved workspace files before confirming a criterion.'); }
		if (this.running.has(sessionId)) { throw new Error(t('goal.pauseReview')); }
		await this.serial(sessionId, async epoch => {
			const goal = await this.native.host.goalGet(sessionId); if (!goal || !await this.contractMatches(goal)) { throw new Error('Goal contract unavailable or changed'); }
			const criterion = goal.criteria.find(c => c.id === criterionId); if (!criterion || criterion.command) { throw new Error('This criterion requires its configured command verification'); }
			await this.publish(await this.native.host.goalVerify(sessionId, { goalId: goal.id, expectedVersion: goal.version, criterionId, source: 'user', runId: goal.runIds.at(-1) ?? 'manual', workspaceVersion: this.workspaceVersion, summary: 'The user explicitly confirmed this criterion in the Goal review.' }), false, epoch);
		});
		const goal = await this.get(sessionId);
		if (goal?.criteria.every(c => c.verified)) { await this.report(sessionId, 'All criteria have current verification. Goal review completed.'); await this.update(sessionId, { action: 'complete' }); }
	}
	async openDocument(sessionId: string, kind: 'goal' | 'report'): Promise<void> { const epoch = this.workspaceGeneration; const goal = await this.get(sessionId); if (goal) { await this.publish(goal, false, epoch); await this.editors.openEditor({ resource: this.document(goal, kind) }); } }

	async execute(sessionId: string, token: CancellationToken, driver: IOpenideGoalDriver): Promise<void> {
		let goal = await this.get(sessionId);
		if (!goal || goal.status !== 'active') { await driver.run(generateUuid(), '', token); return; }
		if (this.running.has(sessionId)) { throw new Error('The goal already has an active executor'); }
		if (driver.pendingWork) { this.pendingWork.set(sessionId, () => driver.pendingWork!()); } else { this.pendingWork.delete(sessionId); }
		const source = new CancellationTokenSource(token); this.running.set(sessionId, source);
		let unchanged = 0; let lastReport = '';
		try {
			while (goal.status === 'active' && !source.token.isCancellationRequested) {
				if (!await this.contractMatches(goal)) { await this.update(sessionId, { action: 'block', reason: 'GOAL.md changed. Review the accepted criteria before continuing.' }); break; }
				const runId = generateUuid();
				goal = await this.update(sessionId, { action: 'startTurn', runId });
				if (goal.status !== 'active') { break; }
				const result = await driver.run(runId, await this.context(sessionId), source.token);
				goal = (await this.get(sessionId))!;
				if (goal.status !== 'active' || source.token.isCancellationRequested) { break; }
				await this.report(sessionId, result.report || 'The turn ended without a progress report.');
				if (result.error || result.stop) { await this.update(sessionId, { action: 'block', reason: result.error || 'The turn requires user input or plan review.' }); break; }
				if (this.hasUnsavedWork()) { await this.update(sessionId, { action: 'block', reason: 'Save or revert unsaved workspace files before verifying the goal.' }); break; }
				if (!await this.contractMatches(goal)) { await this.update(sessionId, { action: 'block', reason: 'GOAL.md changed during execution. Review the accepted criteria before verification.' }); break; }
				for (const criterion of goal.criteria) {
					if (!criterion.command) { continue; }
					const version = this.workspaceVersion;
					const check = await driver.check(runId, criterion.command, source.token);
					goal = (await this.get(sessionId))!;
					if (goal.status !== 'active' || source.token.isCancellationRequested) { break; }
					await this.report(sessionId, `${criterion.id}: ${criterion.command}\nExit: ${check?.exitCode ?? 'unconfirmed'}\n${check?.output.slice(-6000) ?? 'No command receipt'}`);
					if (check?.exitCode === 0 && !check.timedOut && !check.awaitingInput && version === this.workspaceVersion) {
						await this.serial(sessionId, async epoch => {
							const latest = await this.native.host.goalGet(sessionId);
							if (!latest || latest.status !== 'active' || source.token.isCancellationRequested || this.hasUnsavedWork() || !await this.contractMatches(latest) || version !== this.workspaceVersion) { return; }
							await this.publish(await this.native.host.goalVerify(sessionId, { goalId: latest.id, expectedVersion: latest.version, criterionId: criterion.id, source: 'verifier', runId, command: criterion.command, workspaceVersion: version, summary: `Configured command exited 0: ${criterion.command}\n${check.output.slice(-6000)}` }), false, epoch);
						});
					}
				}
				goal = (await this.get(sessionId))!;
				if (goal.status !== 'active' || source.token.isCancellationRequested) { break; }
				const pending = driver.pendingWork?.(); if (pending) { await this.update(sessionId, { action: 'block', reason: pending }); break; }
				if (goal.criteria.every(c => c.verified)) { await this.report(sessionId, 'All acceptance criteria have current evidence; no further goal turn is required.'); await this.update(sessionId, { action: 'complete' }); break; }
				if (goal.criteria.every(c => c.verified || !c.command)) { await this.update(sessionId, { action: 'block', reason: 'Automatic checks passed. Review the remaining manual criteria.' }); break; }
				unchanged = result.report === lastReport ? unchanged + 1 : 0; lastReport = result.report;
				if (unchanged >= 2) { await this.update(sessionId, { action: 'block', reason: 'Repeated turns without new progress. Review the failing checks.' }); break; }
			}
			goal = (await this.get(sessionId))!;
			if (source.token.isCancellationRequested && goal?.status === 'active') { await this.update(sessionId, { action: 'pause' }); }
		} catch (error) {
			const current = await this.get(sessionId).catch(() => undefined);
			if (current?.status === 'active') { await this.update(sessionId, { action: 'fail', reason: error instanceof Error ? error.message : String(error) }).catch(() => undefined); }
			throw error;
		} finally { this.running.delete(sessionId); source.dispose(); }
	}

	async recordChange(sessionId: string, event: IFileEditEvent): Promise<void> {
		const goal = this.known.get(sessionId); if (!goal || goal.status !== 'active' || !this.running.has(sessionId) || event.path.startsWith('.openide/goals/')) { return; }
		await this.serial(sessionId, async epoch => {
			const directory = this.privateRoot(goal); await this.files.createFolder(directory);
			const index = URI.joinPath(directory, 'changes.json');
			const limitsPath = URI.joinPath(directory, 'capture-limits.json');
			let changes: IGoalChange[] = [];
			if (await this.files.exists(index)) { changes = JSON.parse((await this.files.readFile(index)).value.toString()) as IGoalChange[]; }
			const limits: { omittedEdits: number; files: { path: string; reason: string }[]; truncated: boolean } = await this.files.exists(limitsPath) ? JSON.parse((await this.files.readFile(limitsPath)).value.toString()) : { omittedEdits: 0, files: [], truncated: false };
			const before = event.beforeContent ?? ''; const after = event.afterContent ?? '';
			let entry = changes.find(c => c.path === event.path);
			const omission = VSBuffer.fromString(before).byteLength + VSBuffer.fromString(after).byteLength > 2 * 1024 * 1024 ? 'Edit exceeds the snapshot size limit' : !entry && changes.length >= 500 ? 'Goal reached the 500-file snapshot limit' : undefined;
			if (omission) {
				limits.omittedEdits++;
				if (!limits.files.some(item => item.path === event.path)) {
					if (limits.files.length < 50) { limits.files.push({ path: event.path, reason: omission }); } else { limits.truncated = true; }
				}
				await this.files.writeFile(limitsPath, VSBuffer.fromString(JSON.stringify(limits)));
				if (entry) { entry.uncertain = true; await this.files.writeFile(index, VSBuffer.fromString(JSON.stringify(changes))); }
				const notice = 'Goal change capture is incomplete because a snapshot limit was reached. Some edits were omitted; snapshots marked uncertain may be stale. Changes are previews and cannot restore omitted edits.';
				const latest = await this.native.host.goalGet(sessionId);
				if (latest && !['completed', 'cancelled'].includes(latest.status) && !latest.reports.some(report => report.text === notice)) {
					await this.publish(await this.native.host.goalUpdate(sessionId, { action: 'report', text: notice, goalId: latest.id, expectedVersion: latest.version }), false, epoch);
				}
				return;
			}
			if (!entry) {
				const key = contentHash(event.path);
				entry = { path: event.path, before: `${key}.before.txt`, after: `${key}.after.txt`, existed: event.beforeContent !== undefined, deleted: false, uncertain: !!event.originalPath || limits.truncated || limits.files.some(item => item.path === event.path) };
				changes.push(entry); await this.files.writeFile(URI.joinPath(directory, entry.before), VSBuffer.fromString(before));
			} else if ((await this.files.readFile(URI.joinPath(directory, entry.after))).value.toString() !== before) { entry.uncertain = true; }
			entry.deleted = event.afterContent === undefined;
			await this.files.writeFile(URI.joinPath(directory, entry.after), VSBuffer.fromString(after));
			await this.files.writeFile(index, VSBuffer.fromString(JSON.stringify(changes)));
		});
	}

	async openChanges(sessionId: string): Promise<void> {
		const goal = await this.get(sessionId); if (!goal) { return; }
		const directory = this.privateRoot(goal); const index = URI.joinPath(directory, 'changes.json');
		if (!await this.files.exists(index)) { await this.openDocument(sessionId, 'report'); return; }
		const changes = JSON.parse((await this.files.readFile(index)).value.toString()) as IGoalChange[];
		const pick = await this.quickInput.pick(changes.map(change => ({ label: change.path, description: change.uncertain ? t('goal.observed') : t('goal.nativeChange'), change })), { placeHolder: t('goal.chooseChange') });
		if (pick) {
			// Validate names through the provider before reading private captures from the index.
			this.snapshots.resource(goal.id, pick.change.before, pick.change.path, '');
			this.snapshots.resource(goal.id, pick.change.after, pick.change.path, '');
			const [before, after] = await Promise.all([
				this.files.readFile(URI.joinPath(directory, pick.change.before), { limits: { size: 2 * 1024 * 1024 } }),
				this.files.readFile(URI.joinPath(directory, pick.change.after), { limits: { size: 2 * 1024 * 1024 } }),
			]);
			await this.editors.openEditor({
				original: { resource: this.snapshots.resource(goal.id, pick.change.before, pick.change.path, before.value.toString()) },
				modified: { resource: this.snapshots.resource(goal.id, pick.change.after, pick.change.path, after.value.toString()) },
				label: `${pick.change.path} · Goal`,
			});
		}
	}
	override dispose(): void { for (const cts of this.running.values()) { cts.cancel(); cts.dispose(); } this.running.clear(); this.pendingWork.clear(); super.dispose(); }
}
registerSingleton(IOpenideGoalService, OpenideGoalService, InstantiationType.Delayed);
