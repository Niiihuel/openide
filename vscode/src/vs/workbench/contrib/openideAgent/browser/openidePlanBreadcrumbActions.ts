/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/browser/ui/contextview/contextview.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { OpenideChatModelPicker } from './chat/openideChatModelPicker.js';
import { createThinkingGlyph, reasoningControlVisible, reasoningEffortChipLabel } from './chat/openideChatReasoning.js';
import { appendKbd, PRIMARY_ENTER_HINT } from './chat/openideChatKbd.js';
import { createMenuContent, createMenuRow, OpenideComposerPopover } from './chat/openideComposerMenu.js';
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
	/** The chevron's menu on the Build split: the alternatives to the default run. */
	private readonly _morePopover = this._register(new OpenideComposerPopover(this._contextViewService));

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
	/** The execution model's reasoning level, the same chip the composer wears. */
	private _modelEffort: HTMLElement | undefined;
	private _modelEffortLabel: HTMLElement | undefined;
	private _run: HTMLElement | undefined;

	private _render(): void {
		this._renderStore.clear();
		clearNode(this.domNode);
		this._picker.value = undefined;
		this._modelButton = this._modelIcon = this._modelLabel = this._run = undefined;
		this._modelEffort = this._modelEffortLabel = undefined;
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
		button.title = t('chatSurface.plan.modelPicker');
		const icon = append(button, document.createElement('span'));
		icon.className = 'openide-composer-provider-icon';
		const label = append(button, $('span.openide-composer-trigger-label'));
		// The level belongs to the model, so wherever a model is chosen the level goes with it: the
		// same span, the same class and the same source as the composer's chip, and one
		// `onDidChange` repaints both — an effort edited from the chat's picker shows here without
		// this surface knowing anything happened.
		const effort = append(button, $('span.openide-composer-model-effort'));
		effort.hidden = true;
		effort.appendChild(createThinkingGlyph(document));
		const effortLabel = append(effort, document.createElement('span'));
		append(button, $('span.codicon.codicon-chevron-down.openide-composer-chevron'));
		this._modelButton = button; this._modelIcon = icon; this._modelLabel = label;
		this._modelEffort = effort; this._modelEffortLabel = effortLabel;

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
					this._notificationService.error(t('chatSurface.plan.modelSaveError', error instanceof Error ? error.message : String(error)));
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
		const effort = this._modelEffort, effortLabel = this._modelEffortLabel;
		if (!resource || !icon || !label || !button || !effort || !effortLabel) {
			return;
		}
		void this._agentService.getPlanExecutionTarget(resource).then(target => {
			if (this._resource !== resource || !button.isConnected) { return; }
			const providerId = target.providerId || this._agentService.getActiveProviderId();
			const entry = this._agentService.findProvider(providerId);
			const described = target.model ? this._agentService.describeModel(providerId, target.model) : undefined;
			label.textContent = described?.name || target.model || t('chatSurface.plan.modelUnset');
			button.classList.toggle('unset', !target.model);
			applyProviderIcon(icon, providerId, entry?.label ?? '');
			icon.classList.add('openide-composer-provider-icon');
			icon.hidden = !providerId;
			const reasoning = target.model ? this._agentService.getModelReasoning(providerId, target.model) : undefined;
			const graded = reasoningControlVisible(!!providerId, reasoning);
			effort.hidden = !graded;
			effortLabel.textContent = graded ? reasoningEffortChipLabel(this._agentService.getReasoningEffort(providerId, target.model)) : '';
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
		// The SAME split pill the chat's plan card shows (`.oi-split`, openideSurfaceCss.ts): "Build
		// Ctrl+⏎" and a chevron holding the alternatives, as Cursor draws it in the plan's toolbar.
		const split = append(host, $('span.oi-split.openide-plan-run-split'));
		const button = append(split, $('button.oi-split-main.openide-plan-run-btn', { type: 'button' })) as HTMLButtonElement;
		const icon = append(button, document.createElement('span'));
		const text = append(button, $('span.oreview-btn-label'));

		if (running) {
			// The SAME control the chat's plan card shows while a build runs, down to the ring
			// spinner: one running plan, one look, wherever you happen to be reading it. `primary`
			// is the amber fill the card uses; the ring is `.openide-chat-plan-spinner`, not the
			// codicon spinner, because the codicon one is a glyph the icon theme can remap and the
			// two surfaces then drift apart.
			//
			// No stop button here, by explicit decision: the run is the CHAT's, and stopping it is
			// offered where it is owned. A second, quieter stop in the plan's own toolbar is the
			// kind of control that gets pressed by accident while reading.
			split.classList.add('running');
			button.disabled = true;
			icon.className = 'openide-chat-plan-spinner';
			text.textContent = t('chatSurface.plan.running');
			text.classList.add('openide-chat-shimmer');
			button.title = t('plan.runningTitle');
			return;
		}

		const justCompleted = completed && this._completedShownAt > 0 && Date.now() - this._completedShownAt < COMPLETED_HOLD_MS;
		if (justCompleted) {
			split.classList.add('completed');
			button.disabled = true;
			icon.className = 'codicon codicon-check';
			text.textContent = t('chatSurface.plan.completed');
			button.title = t('plan.completedTitle');
			this._completedTimer = setTimeout(() => { this._completedTimer = undefined; this._paint(); }, COMPLETED_HOLD_MS - (Date.now() - this._completedShownAt));
			return;
		}

		// No play glyph: the word and the shortcut are the button, as on the chat's card. A plan
		// that already ran says so on the button itself.
		icon.remove();
		// Always "Build", as Cursor: a plan that already ran says so in the tooltip and in the menu,
		// not by growing the button to "Ejecutar de nuevo" in a bar that has no room for it.
		text.textContent = t('chat.plan.build');
		appendKbd(button, PRIMARY_ENTER_HINT);
		button.title = completed
			? t('plan.runAgainTitle')
			: t('chatSurface.plan.build');
		this._renderStore.add(addDisposableListener(button, 'click', () => this._launch(resource, completed)));

		const more = append(split, $('button.oi-split-more', { type: 'button' })) as HTMLButtonElement;
		append(more, $('span.codicon.codicon-chevron-down'));
		more.title = t('chat.plan.moreActions');
		this._renderStore.add(addDisposableListener(more, 'click', () => this._morePopover.toggle(split, {
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.RIGHT,
			render: (container, store) => {
				const content = createMenuContent(container.ownerDocument);
				container.appendChild(content);
				const build = createMenuRow(container.ownerDocument, {
					icon: 'play', label: completed ? t('chatSurface.plan.runAgain') : t('chat.plan.build'),
					keybinding: PRIMARY_ENTER_HINT, active: true,
				});
				store.add(addDisposableListener(build, 'click', () => { this._morePopover.close(); this._launch(resource, completed); }));
				content.appendChild(build);
				const chat = createMenuRow(container.ownerDocument, { icon: 'comment-discussion', label: t('chatSurface.plan.openChat') });
				store.add(addDisposableListener(chat, 'click', () => { this._morePopover.close(); void this._commandService.executeCommand('workbench.view.openideChat.view.focus'); }));
				content.appendChild(chat);
			},
		})));
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
