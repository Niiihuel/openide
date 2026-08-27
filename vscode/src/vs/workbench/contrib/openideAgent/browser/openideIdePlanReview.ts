/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — human review of a plan an EXTERNAL agent wrote, and the way its answer gets back.
 *
 *  This is the piece that makes "the IDE tells the CLI something" possible at all. The IDE
 *  cannot speak to a CLI whenever it likes: over the HTTP door there is no server→client push,
 *  and the WebSocket door is off while Anthropic's extension owns it. So the signal travels the
 *  only way it can — as the RETURN VALUE of a tool the agent itself called. The agent calls
 *  `openide_plan_save`, the call parks here, a human reads and edits the plan in the real plan
 *  editor, and the decision is what finally answers the call. Measured against a live Claude
 *  Code 2.1.245: a parked call was still waiting after 269s on default settings, and the config
 *  we write raises the ceiling explicitly rather than trusting that.
 *
 *  What comes back is the plan AS IT STANDS ON DISK, not the one the model sent. If the user
 *  reorders the steps and the agent carries on with its own version, the editing was theatre.
 *
 *  Rejection is the default in every ambiguous case — the file vanishes, the window closes, the
 *  server stops. An approval must be something a person actually did.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { t } from '../common/openideStrings.js';

export const IOpenideIdePlanReview = createDecorator<OpenideIdePlanReview>('openideIdePlanReview');

/** Commands both review surfaces dispatch, so a decision can only ever be taken once. */
export const OPENIDE_IDE_PLAN_APPROVE = 'openide.ide.plan.approve';
export const OPENIDE_IDE_PLAN_REJECT = 'openide.ide.plan.reject';

export interface IIdePlanDecision {
	readonly approved: boolean;
	/** The plan as it stands on disk when the decision was taken. */
	readonly markdown: string;
	/** Why it ended, for the message the agent reads. */
	readonly reason: 'approved' | 'rejected' | 'gone';
}

/** Workspace-relative path of a plan, e.g. `.openide/plans/x.md`. */
type PlanPath = string;

interface IPendingReview {
	settle(decision: IIdePlanDecision): void;
	readonly store: DisposableStore;
}

export class OpenideIdePlanReview extends Disposable {

	declare readonly _serviceBrand: undefined;

	private readonly pending = new Map<PlanPath, IPendingReview>();

	private readonly _onDidChangePending = this._register(new Emitter<readonly PlanPath[]>());
	/** The plans currently waiting on a human, so a UI can show them. */
	readonly onDidChangePending: Event<readonly PlanPath[]> = this._onDidChangePending.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register({
			dispose: () => {
				// Shutdown is not approval. Everything still waiting is refused, and the agent is
				// told so, rather than being left holding a call nobody will ever answer.
				for (const path of [...this.pending.keys()]) {
					this.settle(path, { approved: false, markdown: '', reason: 'gone' });
				}
			},
		});
	}

	get pendingPlans(): readonly PlanPath[] {
		return [...this.pending.keys()];
	}

	/** Whether this plan is parked on a human right now. */
	isPending(resource: URI): boolean {
		const path = this.relativePath(resource);
		return !!path && this.pending.has(path);
	}

	/** Workspace-relative path of a plan resource, for surfaces that only carry a URI. */
	relativePath(resource: URI): PlanPath | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		const base = folder.uri.toString().replace(/\/+$/, '') + '/';
		const value = resource.toString();
		return value.startsWith(base) ? decodeURIComponent(value.slice(base.length)) : undefined;
	}

	private resolvePlan(path: PlanPath): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? URI.joinPath(folder.uri, path) : undefined;
	}

	/**
	 * Parks until a human decides on `path`.
	 *
	 * The same plan being reviewed twice settles the older call as rejected instead of leaving
	 * two agents waiting on one answer — whoever asked first is no longer the one on screen.
	 */
	awaitDecision(path: PlanPath, title: string): Promise<IIdePlanDecision> {
		this.settle(path, { approved: false, markdown: '', reason: 'gone' });
		return new Promise<IIdePlanDecision>(resolve => {
			const store = new DisposableStore();
			this.pending.set(path, { settle: decision => resolve(decision), store });

			const handle = this.notificationService.prompt(
				Severity.Info,
				t('ide.planReview', title),
				[
					{ label: t('ide.planReview.approve'), run: () => void this.approve(path) },
					{ label: t('ide.planReview.reject'), run: () => this.reject(path) },
				],
				// Sticky: a plan review that scrolls away silently is a CLI parked forever with no
				// visible reason. It stays until somebody answers it.
				{ sticky: true, onCancel: () => this.reject(path) },
			);
			// INotificationHandle closes, it does not dispose: `close()` is what takes the toast off
			// screen once the decision has been made elsewhere (the command palette, a rejection
			// from teardown).
			store.add(toDisposable(() => handle.close()));

			const resource = this.resolvePlan(path);
			if (resource) {
				// The file disappearing is a decision too, and it is not approval.
				store.add(this.fileService.watch(resource));
				store.add(this.fileService.onDidFilesChange(event => {
					if (event.contains(resource) && !this.fileService.hasProvider(resource)) {
						this.reject(path);
					}
				}));
			}
			this._onDidChangePending.fire(this.pendingPlans);
		});
	}

	/** Approves: reads the plan back from disk so the user's edits are what the agent receives. */
	async approve(path: PlanPath): Promise<void> {
		if (!this.pending.has(path)) {
			return;
		}
		let markdown = '';
		const resource = this.resolvePlan(path);
		if (resource) {
			try {
				markdown = (await this.fileService.readFile(resource)).value.toString();
			} catch (error) {
				// Approving a plan we cannot read would send the agent the model's own version and
				// call it "what the user approved". Refuse instead of lying about it.
				this.logService.warn('[openide-ide] could not read the approved plan', error);
				this.settle(path, { approved: false, markdown: '', reason: 'gone' });
				return;
			}
		}
		this.settle(path, { approved: true, markdown, reason: 'approved' });
	}

	reject(path: PlanPath): void {
		this.settle(path, { approved: false, markdown: '', reason: 'rejected' });
	}

	private settle(path: PlanPath, decision: IIdePlanDecision): void {
		const entry = this.pending.get(path);
		if (!entry) {
			return;
		}
		this.pending.delete(path);
		entry.store.dispose();
		entry.settle(decision);
		this._onDidChangePending.fire(this.pendingPlans);
	}
}

/** The workspace-relative plan path inside `plan_save`'s answer, or undefined. */
export function planPathFromSaveResult(result: string): string | undefined {
	// plan_save answers `OK: plan guardado en .openide/plans/<slug>.md`. Matching the path rather
	// than the sentence keeps this working if the wording is ever translated.
	const match = /(\.openide\/plans\/[^\s]+\.md)/.exec(result);
	return match?.[1];
}

/** What the agent reads when its plan comes back. */
export function planDecisionMessage(decision: IIdePlanDecision): string {
	switch (decision.reason) {
		case 'approved':
			return `PLAN_APPROVED\n\nEl usuario aprobó el plan. Este es el plan tal como quedó DESPUÉS de sus ediciones — ejecutá este, no el que enviaste:\n\n${decision.markdown}`;
		case 'rejected':
			return 'PLAN_REJECTED\n\nEl usuario descartó el plan. No lo ejecutes: preguntale qué cambiar antes de proponer otro.';
		case 'gone':
			return 'PLAN_REVIEW_UNAVAILABLE\n\nLa revisión terminó sin respuesta (se cerró el IDE o desapareció el archivo). Tratalo como NO aprobado.';
	}
}
