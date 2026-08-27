/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/browser/ui/contextview/contextview.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { OpenideChatModelPicker } from './chat/openideChatModelPicker.js';
import { t } from '../common/openideStrings.js';
import { IOpenideCliChangesService, IOpenideSessionBaseline, OpenideCliChangesService } from './openideCliChangesService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IOpenideIdePlanReview, OpenideIdePlanReview, OPENIDE_IDE_PLAN_APPROVE, OPENIDE_IDE_PLAN_REJECT } from './openideIdePlanReview.js';
import { applyProviderIcon } from './openideProviderIcons.js';
import './media/openideChat.css';
import './chat/media/openideChatActivity.css';

/**
 * The plan's controls in the breadcrumb row: the EXECUTION model chip and the run button.
 *
 * Both are the chat's own pieces, not a second copy: the chip is the composer's model trigger
 * (provider mark · name · chevron) and opens the SAME popover the composer opens
 * (`OpenideChatModelPicker`, parameterised to tick and write the plan's model instead of the
 * chat's); the run button is a review button (`.openide-review-btn`, the Keep/Undo family) so
 * the two title bars that carry agent actions share one metric.
 *
 * The run button reads the harness, never a local flag: `isPlanBuildRunning` is what the chat
 * controller settles on `finishPlanBuild`/`failPlanBuild`, so a plan launched from here keeps
 * spinning while the user chats in the dock, and Stop asks that same run to abort.
 */
export class OpenidePlanBreadcrumbActions extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _renderStore = this._register(new DisposableStore());
	private readonly _picker = this._register(new MutableDisposable<OpenideChatModelPicker>());
	private _resource: URI | undefined;
	private _agentFile: { sessionId: string; path: string; baseline: IOpenideSessionBaseline } | undefined;
	private _agentFileResource: URI | undefined;
	/** Keeps "✓ Finalizado" on screen a moment before offering to run again. */
	private _completedShownAt = 0;
	private _completedTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		document: Document,
		@IOpenideAgentService private readonly _agentService: IOpenideAgentService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenideIdePlanReview private readonly _planReview: OpenideIdePlanReview,
		@IOpenideCliChangesService private readonly _cliChanges: OpenideCliChangesService,
	) {
		super();
		this.domNode = document.createElement('div');
		this.domNode.className = 'openide-plan-breadcrumb-actions';
		// The breadcrumb widget listens for clicks on its row to open the picker of a crumb; the
		// plan's own controls must not read as one.
		this._register(addDisposableListener(this.domNode, 'mousedown', event => event.stopPropagation()));
		this._register(addDisposableListener(this.domNode, 'click', event => event.stopPropagation()));
		this._register(this._agentService.onDidChangePlanBuild(event => {
			if (this._resource && event.resource.toString() === this._resource.toString()) {
				if (!event.busy && this._agentService.isPlanBuildCompleted(this._resource)) { this._completedShownAt = Date.now(); }
				this._paint();
			}
		}));
		this._register(this._agentService.onDidChange(() => this._paintModel()));
		// A decision taken elsewhere (the toast, the transcript card) has to clear this bar too.
		this._register(this._planReview.onDidChangePending(() => this._render()));
	}

	/** Shows the controls for a plan, or nothing when the editor is not a plan. */
	update(resource: URI | undefined): void {
		const isPlan = !!resource && /\.openide[\\/]plans[\\/][^\\/]+\.md$/i.test(resource.path);
		// A file some hosted CLI changed gets its own control in this row. The row already hosts
		// the agent's actions for plans, and a second bar somewhere else would make "undo what the
		// agent did" live in two places depending on which agent did it.
		this._agentFile = !isPlan && resource ? this._cliChanges.sessionsTouching(resource)[0] : undefined;
		this._agentFileResource = this._agentFile ? resource : undefined;
		this._resource = isPlan ? resource : undefined;
		this._completedShownAt = 0;
		this._picker.value?.close();
		this._render();
	}

	private _modelButton: HTMLButtonElement | undefined;
	private _modelIcon: HTMLElement | undefined;
	private _modelLabel: HTMLElement | undefined;
	private _run: HTMLElement | undefined;

	private _render(): void {
		this._renderStore.clear();
		clearNode(this.domNode);
		this._picker.value = undefined;
		this._modelButton = this._modelIcon = this._modelLabel = this._run = undefined;
		if (this._agentFile && this._agentFileResource) {
			this._renderAgentFile(this._agentFile, this._agentFileResource);
			return;
		}
		const resource = this._resource;
		if (!resource) {
			return;
		}
		const document = this.domNode.ownerDocument;
		if (this._planReview.isPending(resource)) {
			// No model chip: nothing here chooses who executes this plan, the CLI already did.
			this._run = append(this.domNode, $('span.openide-plan-run'));
			this._paint();
			return;
		}

		// ---- model chip: the composer's trigger, verbatim
		const button = append(this.domNode, $('button.openide-composer-trigger.openide-composer-model.openide-plan-model-chip', { type: 'button' })) as HTMLButtonElement;
		button.title = localize('openide.plan.modelPicker', "Modelo con el que se ejecuta el plan");
		const icon = append(button, document.createElement('span'));
		icon.className = 'openide-composer-provider-icon';
		const label = append(button, $('span.openide-composer-trigger-label'));
		append(button, $('span.codicon.codicon-chevron-down.openide-composer-chevron'));
		this._modelButton = button; this._modelIcon = icon; this._modelLabel = label;

		const picker = new OpenideChatModelPicker(this._agentService, this._contextViewService, this._commandService, () => this._paintModel(), {
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.RIGHT,
			width: 340,
			resolveActive: async () => {
				const target = await this._agentService.getPlanExecutionTarget(resource);
				return { providerId: target.providerId || this._agentService.getActiveProviderId(), modelId: target.model };
			},
			choose: async (group, model) => {
				try {
					await this._agentService.setPlanExecutionModel(resource, model.id, group.id);
				} catch (error) {
					this._notificationService.error(localize('openide.plan.modelSaveError', "No se pudo guardar el modelo del plan: {0}", error instanceof Error ? error.message : String(error)));
				}
			},
		});
		this._picker.value = picker;
		this._renderStore.add(addDisposableListener(button, 'click', () => picker.toggle(button)));

		// ---- run button
		this._run = append(this.domNode, $('span.openide-plan-run'));
		this._paintModel();
		this._paint();
	}

	private _paintModel(): void {
		const resource = this._resource;
		const icon = this._modelIcon, label = this._modelLabel, button = this._modelButton;
		if (!resource || !icon || !label || !button) {
			return;
		}
		void this._agentService.getPlanExecutionTarget(resource).then(target => {
			if (this._resource !== resource || !button.isConnected) { return; }
			const providerId = target.providerId || this._agentService.getActiveProviderId();
			const entry = this._agentService.findProvider(providerId);
			const described = target.model ? this._agentService.describeModel(providerId, target.model) : undefined;
			label.textContent = described?.name || target.model || localize('openide.plan.model.unset', "Elegir modelo");
			button.classList.toggle('unset', !target.model);
			applyProviderIcon(icon, providerId, entry?.label ?? '');
			icon.classList.add('openide-composer-provider-icon');
			icon.hidden = !providerId;
		}, () => { /* the picker reports the error; the label keeps its last good value */ });
	}

	private _paint(): void {
		const host = this._run, resource = this._resource;
		if (!host || !resource) {
			return;
		}
		clearNode(host);
		if (this._completedTimer) { clearTimeout(this._completedTimer); this._completedTimer = undefined; }
		const document = host.ownerDocument;

		// A plan an EXTERNAL agent wrote and is parked on. "Ejecutar plan" here would launch OUR
		// agent on somebody else's plan, and the model chip would pick a model that never runs.
		// What this bar owes the user instead is the decision the CLI is waiting for.
		if (this._planReview.isPending(resource)) {
			this._paintExternalReview(host, resource, document);
			return;
		}

		const running = this._agentService.isPlanBuildRunning(resource);
		const completed = this._agentService.isPlanBuildCompleted(resource);
		const button = append(host, $('button.openide-review-btn.openide-plan-run-btn', { type: 'button' })) as HTMLButtonElement;
		const icon = append(button, document.createElement('span'));
		const text = append(button, $('span.oreview-btn-label'));

		if (running) {
			// Cursor's running state: the label breathes, the run keeps going while the user chats.
			button.classList.add('running');
			button.disabled = true;
			icon.className = 'codicon codicon-loading codicon-modifier-spin';
			text.textContent = localize('openide.plan.running', "Ejecutando…");
			text.classList.add('openide-chat-shimmer');
			button.title = t('plan.runningTitle');
			const stop = append(host, $('button.openide-review-btn.openide-plan-stop-btn', { type: 'button' })) as HTMLButtonElement;
			append(stop, $('span.codicon.codicon-debug-stop'));
			stop.title = t('plan.stop');
			stop.setAttribute('aria-label', stop.title);
			this._renderStore.add(addDisposableListener(stop, 'click', () => this._agentService.cancelPlanBuild(resource)));
			return;
		}

		const justCompleted = completed && this._completedShownAt > 0 && Date.now() - this._completedShownAt < COMPLETED_HOLD_MS;
		if (justCompleted) {
			button.classList.add('primary', 'completed');
			button.disabled = true;
			icon.className = 'codicon codicon-check';
			text.textContent = localize('openide.plan.completed', "Finalizado");
			button.title = t('plan.completedTitle');
			this._completedTimer = setTimeout(() => { this._completedTimer = undefined; this._paint(); }, COMPLETED_HOLD_MS - (Date.now() - this._completedShownAt));
			return;
		}

		button.classList.add('primary');
		icon.className = 'codicon codicon-play';
		text.textContent = completed
			? localize('openide.plan.runAgain', "Ejecutar de nuevo")
			: localize('openide.plan.run', "Ejecutar plan");
		button.title = completed
			? t('plan.runAgainTitle')
			: localize('openide.plan.build', "Ejecutar el plan");
		this._renderStore.add(addDisposableListener(button, 'click', () => this._launch(resource, completed)));
	}

	/**
	 * The review bar for a plan an external agent is waiting on.
	 *
	 * Dispatches the SAME commands as the toast and the transcript card: three surfaces, one
	 * decision, so none of them can answer the parked call differently from the others.
	 */
	private _paintExternalReview(host: HTMLElement, resource: URI, document: Document): void {
		const path = this._planReview.relativePath(resource);
		if (!path) {
			return;
		}
		const waiting = append(host, $('span.openide-plan-external-waiting'));
		waiting.textContent = t('ide.planReview.waiting');
		waiting.title = t('ide.planReview.waitingTitle');

		const discard = append(host, $('button.openide-review-btn.openide-plan-stop-btn', { type: 'button' })) as HTMLButtonElement;
		append(discard, $('span.codicon.codicon-close'));
		append(discard, $('span.oreview-btn-label')).textContent = t('ide.planReview.reject');
		discard.title = t('ide.planReview.rejectTitle');
		this._renderStore.add(addDisposableListener(discard, 'click', () => void this._commandService.executeCommand(OPENIDE_IDE_PLAN_REJECT, path)));

		const approve = append(host, $('button.openide-review-btn.openide-plan-run-btn.primary', { type: 'button' })) as HTMLButtonElement;
		const icon = append(approve, document.createElement('span'));
		icon.className = 'codicon codicon-check';
		append(approve, $('span.oreview-btn-label')).textContent = t('ide.planReview.approve');
		approve.title = t('ide.planReview.approveTitle');
		this._renderStore.add(addDisposableListener(approve, 'click', () => void this._commandService.executeCommand(OPENIDE_IDE_PLAN_APPROVE, path)));
	}

	/**
	 * The bar for a file a hosted CLI changed: what it did, and one way to undo it.
	 *
	 * The undo restores the SESSION baseline, not HEAD, so it puts back what was there before that
	 * conversation started rather than throwing away work that predates it. When the baseline is
	 * inexact — the file was already dirty when the session began, so the best "before" we have is
	 * one write late — the button says so instead of pretending.
	 */
	private _renderAgentFile(hit: { sessionId: string; path: string; baseline: IOpenideSessionBaseline }, resource: URI): void {
		const host = append(this.domNode, $('span.openide-plan-run'));
		const label = append(host, $('span.openide-agent-file-label'));
		label.textContent = t('cliChanges.breadcrumb.changed');

		// Undo is offered whenever there is real content to restore. It is WITHHELD when the
		// baseline is empty for a file that already existed: restoring that deletes something the
		// session never created, while looking like the undo worked.
		if (hit.baseline.existed || hit.baseline.exact) {
			const undo = append(host, $('button.openide-review-btn.openide-plan-stop-btn', { type: 'button' })) as HTMLButtonElement;
			append(undo, $('span.codicon.codicon-discard'));
			append(undo, $('span.oreview-btn-label')).textContent = hit.baseline.exact
				? t('cliChanges.breadcrumb.undo')
				: t('cliChanges.breadcrumb.undoInexact');
			undo.title = hit.baseline.exact ? t('cliChanges.breadcrumb.undoTitle') : t('cliChanges.noBaseline');
			if (!hit.baseline.exact) {
				// Partial: it cannot undo the agent's first edit of this conversation, because the
				// restore point was taken after it.
				undo.classList.add('openide-agent-file-inexact');
			}
			this._renderStore.add(addDisposableListener(undo, 'click', async () => {
				undo.disabled = true;
				const ok = await this._cliChanges.rollback(hit.sessionId, hit.path);
				if (!ok) {
					undo.disabled = false;
					this._notificationService.warn(t('cliChanges.breadcrumb.undoFailed', hit.path));
				}
			}));
		} else {
			const note = append(host, $('span.openide-agent-file-label.openide-agent-file-inexact'));
			note.textContent = t('cliChanges.breadcrumb.noBaseline');
			note.title = t('cliChanges.noBaseline');
		}

		const diff = append(host, $('button.openide-review-btn', { type: 'button' })) as HTMLButtonElement;
		append(diff, $('span.codicon.codicon-diff-single'));
		append(diff, $('span.oreview-btn-label')).textContent = t('cliChanges.breadcrumb.diff');
		diff.title = t('cliChanges.breadcrumb.diffTitle');
		this._renderStore.add(addDisposableListener(diff, 'click', () => {
			void this._cliChanges.openDiff(hit.sessionId, { path: hit.path, status: hit.baseline.existed ? 'modified' : 'added' });
		}));
		void resource;
	}

	private _launch(resource: URI, again: boolean): void {
		if (this._agentService.isPlanBuildRunning(resource)) {
			return;
		}
		if (again) { this._agentService.invalidatePlanBuild(resource); }
		// The chat consumes the request and turns it into a normal turn. Focusing it first
		// guarantees the lazy listener exists before `buildPlan` fires the event.
		void this._commandService.executeCommand('workbench.view.openideChat.view.focus').then(
			() => this._agentService.buildPlan(resource),
			() => this._agentService.buildPlan(resource),
		).catch(error => this._notificationService.error(error instanceof Error ? error.message : String(error)));
	}

	override dispose(): void {
		if (this._completedTimer) { clearTimeout(this._completedTimer); }
		super.dispose();
	}
}

/** How long "✓ Finalizado" stays before the button offers to run again. */
const COMPLETED_HOLD_MS = 4000;
