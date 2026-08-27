/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { URI } from '../../../../../base/common/uri.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { createOpenideChatRequestItem, IOpenideChatItem } from '../../common/chat/openideChatItem.js';
import { applyAgentEvent } from '../../common/chat/openideChatReducer.js';
import {
	beginOpenideChatHiddenTurn, beginOpenideChatTurn, closeOpenideChatTurn, createOpenideChatReducerState,
	IOpenideChatReducerState, IOpenideChatSessionEffect, openOpenideChatReply,
} from '../../common/chat/openideChatReducerState.js';
import { applyOpenideChatSurfaceEvent, IOpenideChatSurfaceEvent } from '../../common/chat/openideChatSurface.js';
import { buildOpenideChatTranscript } from '../../common/chat/openideChatTranscript.js';
import { AgentLoopEvent, AgentMode, IChatCapabilityMention, IChatImage, IChatMessage } from '../../common/openideAgentTypes.js';
import { IOpenidePickAttachment } from '../../common/openidePickContext.js';
import { rewindForSilentModeTransition } from '../../common/openideModeTransition.js';
import { buildPlanFollowUpPrompt, normalizePlanFollowUpDisposition, PlanFollowUpDisposition } from '../../common/openidePlanFollowUp.js';
import { COMPACT_COMMAND, NATIVE_WORKFLOW_COMMANDS } from '../../common/chat/openideChatSlashCommands.js';
import { OpenideAgentCommands } from '../openideAgentCommands.js';
import { IOpenideProjectMapLearningService } from '../openideProjectMapLearningService.js';
import { ISubagentOrchestrationService } from '../openideSubagentOrchestrationService.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { IChatSessionUsage, OpenideChatSessions } from '../openideChatSessions.js';
import { hydrateOpenideChatImages, persistOpenideChatImages } from './openideChatImageHydration.js';
import { OpenideChatRollbackBarrier } from './openideChatRollbackBarrier.js';
import { IOpenideChatRollbackOutcome, runOpenideChatRollback } from './openideChatRollbackOperation.js';
import { OpenideChatSessionEffects } from './openideChatSessionEffects.js';

/** Re-exported: the widget consumes the outcome through the controller, not through the operation. */
export type { IOpenideChatRollbackOutcome };

/**
 * What the composer hands over. `text` is RAW: a leading `/command` is resolved and expanded here,
 * exactly where the webview host did it (openideChatView.ts `prepareAndSend`), so the history
 * stores `{displayText, modelText}` — the UI shows what was typed, the model sees the expansion.
 */
export interface IOpenideChatSendRequest {
	readonly text: string;
	readonly displayText?: string;
	/** In-memory attachments; persisted to workspace storage before the turn is saved. */
	readonly images?: readonly IChatImage[];
	/** Workspace-relative paths picked from the `@` menu; attached as context, never as text. */
	readonly references?: readonly string[];
	/** A request typed while Plan was working: integrate into the plan or replace it. */
	readonly planFollowUp?: PlanFollowUpDisposition;
	/** Pick & Polish selection: extra context plus, usually, a screenshot of the element. */
	readonly pick?: IOpenidePickAttachment;
	readonly capabilities?: readonly IChatCapabilityMention[];
	readonly mode?: AgentMode;
	readonly providerId?: string;
	readonly modelId?: string;
}

export interface IOpenideChatNotice {
	readonly severity: 'info' | 'warning' | 'error';
	readonly message: string;
}

/**
 * Effects that outlive the run that produced them.
 *
 * A superseded run's rows are dropped, but its change set describes files that are already written
 * to disk and is the only thing a rollback can undo them with. The webview host makes exactly the
 * same exception, and for the same reason (openideChatView.ts:1443-1447).
 */
function isStorageEffect(effect: IOpenideChatSessionEffect): boolean {
	return effect.type === 'saveChangeSet';
}

/** The composer stays enabled while a rollback runs, so the rejection has to be explained. */
const ROLLBACK_IN_PROGRESS = 'Esperá a que termine el rollback antes de enviar otro mensaje.';
/** Compaction replaces the run's operational history; doing it under a live run would race it. */
const COMPACT_BUSY = 'Esperá a que termine la ejecución actual antes de compactar.';
/** Approving a plan launches a full run; two of them would fight over the same working tree. */
const PLAN_BUILD_BUSY = 'Esperá a que termine la ejecución actual antes de aprobar otro plan.';
/**
 * What the hidden turn asks for. Verbatim from the webview host (openideChatView.ts:689-691): it
 * names the plan's own conventions — the "## Tareas" section, `update_todos`, ticking the checkbox
 * of each finished task — so the plan editor's progress bar keeps advancing while the run works.
 */
function planBuildPrompt(path: string): string {
	return `Ejecutá el plan aprobado en ${path}. Leé el archivo, seguí las tareas de "## Tareas" EN ORDEN, usá update_todos para reflejar el progreso, y al completar cada tarea tildá su checkbox en el .md (edit_file: "- [ ]" → "- [x]").`;
}

/**
 * Bridge between `IOpenideAgentService` and the native widget: it sends turns, feeds every
 * `AgentLoopEvent` to the reducer and owns the item list. No `postMessage` anywhere.
 *
 * The translation itself is NOT here: `common/chat/openideChatReducer.ts` is pure and testable, and
 * this file is what remains once that is taken out — the run's lifecycle, the rollback barrier and
 * dispatching the effects the reducer declares but refuses to perform.
 */
export class OpenideChatController extends Disposable {

	private readonly _onDidChangeItems = this._register(new Emitter<void>());
	/** Fires after every mutation of the list; the widget re-runs `setChildren`. */
	readonly onDidChangeItems: Event<void> = this._onDidChangeItems.event;

	private readonly _onDidChangeBusy = this._register(new Emitter<boolean>());
	readonly onDidChangeBusy: Event<boolean> = this._onDidChangeBusy.event;

	private readonly _onDidPublishNotice = this._register(new Emitter<IOpenideChatNotice>());
	readonly onDidPublishNotice: Event<IOpenideChatNotice> = this._onDidPublishNotice.event;

	private readonly _onDidFinishRun = this._register(new Emitter<{ readonly hadError: boolean }>());
	/**
	 * Fires once per REAL run settling (not compaction, not a manual abort, not a mode handoff):
	 * the "task finished" toast and the accessibility signal hang off it, and both must fire exactly
	 * once per busy→idle transition even though `done` and the run promise settle back to back.
	 */
	readonly onDidFinishRun: Event<{ readonly hadError: boolean }> = this._onDidFinishRun.event;

	private readonly _onDidResumeInMode = this._register(new Emitter<AgentMode>());
	/** A mode suggestion was accepted and the request is re-running in that mode: the composer's selector follows. */
	readonly onDidResumeInMode: Event<AgentMode> = this._onDidResumeInMode.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<void>());
	/** The session store changed outside the run stream (a subagent delivered its result): the header repaints. */
	readonly onDidChangeSessions: Event<void> = this._onDidChangeSessions.event;

	private readonly _barrier = new OpenideChatRollbackBarrier();
	private readonly _effects: OpenideChatSessionEffects;
	/** Items plus the reducer's cursors. Replaced whole on every event: the state is immutable. */
	private _state: IOpenideChatReducerState = createOpenideChatReducerState();
	/** True while a run owns the open reply. Guards the image hydration against a live stream. */
	private _streaming = false;
	private _runCts: CancellationTokenSource | undefined;
	/** Rollback awaits it after cancelling, so a late tool cannot write over restored files. */
	private _runPromise: Promise<void> | undefined;
	private _activeId: string | undefined;
	private _busy = false;
	/**
	 * The plan whose Build is in flight. Held so the run's outcome can be reported back to the plan
	 * editor, which parks its own button on `finishPlanBuild` / `failPlanBuild`.
	 */
	private _planBuild: { readonly resource: URI; readonly owner: string } | undefined;
	/** The run in flight is a compaction, not a model turn: no "task finished" when it settles. */
	private _compacting = false;
	/** The run ended with `done{reason:'mode-switch'}`: ownership transfers to `resumeInMode`, nothing settles. */
	private _modeHandoff = false;
	/** `/commands` of the workspace (commands/*.md, project + global), created lazily. */
	private _commands: OpenideAgentCommands | undefined;

	constructor(
		private readonly sessions: OpenideChatSessions,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IOpenideProjectMapLearningService private readonly learningService: IOpenideProjectMapLearningService,
		@ISubagentOrchestrationService private readonly subagentOrchestration: ISubagentOrchestrationService,
	) {
		super();
		this._effects = this._register(instantiationService.createInstance(OpenideChatSessionEffects, sessions));

		// A persistent subagent run that finishes while nobody is looking still has to land in its
		// parent conversation, or its result is lost the moment the orchestration forgets it. Same
		// delivery the webview host performed (openideChatView.ts:603-614).
		this._register(this.subagentOrchestration.onDidChangeRun(event => {
			if (event.type === 'timeline') { return; }
			if ((event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') && event.run.deliveryState === 'pending') {
				this.deliverSubagentRun(event.run);
			}
		}));

		// Rows that do not come from the run's event stream. The plan and canvas stores report on
		// their own schedule — a draft streams while `plan_save`'s arguments are still being parsed —
		// so they are folded through `applyOpenideChatSurfaceEvent` instead of the loop's reducer.
		this._register(this.agentService.onDidChangePlanDraft(draft => this.applySurface({
			type: 'planDraft', path: draft.path, title: draft.title, done: draft.done,
		})));
		this._register(this.agentService.onDidCreatePlan(plan => this.applySurface({
			type: 'planCard', path: plan.path, title: plan.title, markdown: plan.markdown, external: plan.external,
		})));
		this._register(this.agentService.onDidChangeCanvas(canvas => this.applySurface({
			type: 'canvasCard', path: canvas.path, title: canvas.title, created: canvas.created,
		})));
		this._register(this.agentService.onDidRequestPlanBuild(request => this.buildPlan(request)));
		this._register(this.agentService.onDidRequestPlanBuildCancel(resource => {
			if (this._planBuild?.resource.toString() === resource.toString()) { this.abort(); }
		}));
	}

	get items(): readonly IOpenideChatItem[] {
		return this._state.items;
	}

	/** The workspace's Markdown `/commands`. Shared with the composer's `/` menu through the widget. */
	get commands(): OpenideAgentCommands {
		if (!this._commands) {
			this._commands = this._register(new OpenideAgentCommands(this.fileService, this.contextService, this.environmentService));
		}
		return this._commands;
	}

	private deliverSubagentRun(run: { readonly runId: string; readonly parentConversationId: string; readonly status: string; readonly result?: { readonly summary?: string }; readonly error?: string }): void {
		const sessionMessages = this.sessions.messagesOf(run.parentConversationId);
		if (!sessionMessages.some(message => message.subagentRunId === run.runId)) {
			sessionMessages.push({ role: 'assistant', content: run.result?.summary || run.error || `Subagente ${run.status}.`, subagentRunId: run.runId });
			this.sessions.save(run.parentConversationId, sessionMessages, run.status === 'failed');
			if (run.parentConversationId === this._activeId && !this._streaming) {
				this.rebuildItems(sessionMessages);
			}
			this._onDidChangeSessions.fire();
		}
		this.subagentOrchestration.markDelivered(run.runId);
	}

	get isBusy(): boolean {
		return this._busy;
	}

	get activeConversationId(): string | undefined {
		return this._activeId;
	}

	/** The mirror conversation a specialist run streams into, if this controller started one. */
	subagentSessionOf(runId: string): string | undefined {
		return this._effects.mirrorSessionOf(runId);
	}

	/** Context counters of the visible conversation, for the "Uso de contexto" panel. */
	get usage(): IChatSessionUsage {
		return this._effects.usageOf(this._activeId);
	}

	get onDidChangeUsage(): Event<IChatSessionUsage> {
		return this._effects.onDidChangeUsage;
	}

	/**
	 * Loads a conversation's persisted transcript.
	 *
	 * Synchronous on purpose: the rows must be on screen before the first `await`, otherwise opening
	 * a conversation flashes an empty transcript — which is the symptom users reported as "sometimes
	 * nothing shows up and I have to start a new chat". Attachments are the only part that needs the
	 * disk, so they are hydrated afterwards and the list is rebuilt once they land.
	 */
	restore(conversationId?: string): void {
		const id = conversationId ?? this.sessions.ensureActive();
		this._activeId = id;
		this._effects.setVisibleConversation(id);
		const messages = this.sessions.messagesOf(id);
		this.rebuildItems(messages);
		void this.hydrateImages(id, messages);
	}

	private async hydrateImages(conversationId: string, messages: readonly IChatMessage[]): Promise<void> {
		if (!await hydrateOpenideChatImages(this.fileService, messages)) {
			return;
		}
		// Reading the assets is slow enough for the user to have switched tabs or started typing.
		// Rebuilding then would paint another conversation's thread, or wipe a reply mid-stream.
		if (this._activeId !== conversationId || this._streaming) {
			return;
		}
		this.rebuildItems(messages);
	}

	/**
	 * Admits a turn and launches the run. Returns false when the turn was rejected (empty, or a
	 * rollback holding the barrier) so the composer can keep the user's text.
	 */
	async send(request: IOpenideChatSendRequest): Promise<boolean> {
		if (this._barrier.isActive) {
			this.publishNotice('info', ROLLBACK_IN_PROGRESS);
			return false;
		}
		return this._barrier.withSendPreparation(() => this.prepareAndRun(request));
	}

	/**
	 * Folds a plan/canvas row into the transcript.
	 *
	 * It does NOT check whether a run is in flight. The events arrive both inside a turn (the usual
	 * case: `plan_save` is a tool call) and outside one (the canvas editor saving, a plan written by
	 * a command), and `commitOpenideChatDraft` creates the reply lazily — so the row lands in the
	 * open reply when there is one and opens its own when there is not.
	 */
	private applySurface(event: IOpenideChatSurfaceEvent): void {
		const step = applyOpenideChatSurfaceEvent(this._state, event);
		const changed = step.items !== this._state.items;
		// The state is taken either way — a commit that changed nothing still carries the cursor
		// forward — but the list is only told when the ITEMS actually moved. `step.state` is a fresh
		// object on every commit, so comparing states would repaint on every no-op: a plan draft
		// reports `done` for plans that never opened a card, and each one would rebuild the tree.
		this._state = step.state;
		if (changed) {
			this._onDidChangeItems.fire();
		}
	}

	/**
	 * Plan approved — from the card in the transcript or from the button in the plan editor.
	 *
	 * The approval is a SILENT operational transition, which is the whole design of this path: no
	 * "Run plan…" bubble is invented, the turn that carries the instruction is hidden, and the run
	 * shows up in the transcript as an ordinary reply. What the user sees is the card they clicked
	 * turning into "Building", which the card does on its own.
	 */
	private buildPlan(request: { readonly path: string; readonly resource: URI; readonly owner: string; readonly providerId: string; readonly model: string }): void {
		if (this._busy || this._planBuild || this._barrier.isActive) {
			// The editor's button is parked on this promise; leaving it spinning forever would be
			// worse than the notification.
			this.agentService.failPlanBuild(request.resource, request.owner);
			this.notificationService.warn(PLAN_BUILD_BUSY);
			return;
		}
		this._planBuild = { resource: request.resource, owner: request.owner };

		const conversationId = this.sessions.ensureActive();
		this._activeId = conversationId;
		this._effects.setVisibleConversation(conversationId);
		const messages = this.sessions.messagesOf(conversationId);
		const messageId = generateUuid();
		messages.push({
			role: 'user', hidden: true, messageId,
			providerId: request.providerId, modelId: request.model,
			content: planBuildPrompt(request.path),
		});
		this.sessions.save(conversationId, messages, false);

		// No request row: the turn is hidden. The reducer still needs a turn armed, or the reply
		// would be appended to the previous one and the two runs would share a caret.
		this.finishStream({ isCanceled: true });
		this._state = openOpenideChatReply(beginOpenideChatHiddenTurn(this._state, messageId));
		this._streaming = true;
		this._onDidChangeItems.fire();

		this.launchRun(conversationId, messages, messageId, 'agent', request.providerId, request.model);
	}

	/**
	 * Reports the run's outcome to the plan editor, whose Build button is waiting on it.
	 *
	 * Idempotent through `_planBuild` being cleared: `launchRun` settles on both edges (the promise
	 * and the failure handler) and only the first may resolve the editor's pending state.
	 */
	private settlePlanBuild(failed: boolean): void {
		const planBuild = this._planBuild;
		if (!planBuild) {
			return;
		}
		this._planBuild = undefined;
		if (failed) {
			this.agentService.failPlanBuild(planBuild.resource, planBuild.owner);
			return;
		}
		this.agentService.finishPlanBuild(planBuild.resource, planBuild.owner);
	}

	/** Cancels the visible run. The reply stays in the transcript marked as cancelled. */
	abort(): void {
		const run = this._runCts;
		this._runCts = undefined;
		run?.cancel();
		this.finishStream({ isCanceled: true });
		// A cancelled build is a failed one as far as the plan editor is concerned: its button has to
		// come back, and `launchRun`'s handlers bail out on the superseded CTS so they will not.
		this.settlePlanBuild(true);
		this._compacting = false;
		this._modeHandoff = false;
		this.setBusy(false);
	}

	/**
	 * Reverts exclusively the transaction of this exact messageId and truncates the transcript.
	 * Serialized through the barrier: file mutation is one global transaction.
	 */
	rollbackToUserMessage(messageId: string, restoreComposer = false): Promise<IOpenideChatRollbackOutcome> {
		return this._barrier.runExclusive(
			() => this.doRollback(messageId, restoreComposer),
			error => ({ committed: false, removedMessageIds: [], warning: `No se pudo completar el rollback: ${error instanceof Error ? error.message : String(error)}` }),
		);
	}

	private async prepareAndRun(request: IOpenideChatSendRequest): Promise<boolean> {
		// Synchronous snapshot, BEFORE the first await: the turn belongs to the target the user saw
		// when pressing Send, even if the picker moves while the turn is being assembled.
		const providerOverride = request.providerId || this.agentService.getActiveProviderId();
		const modelOverride = request.modelId || this.agentService.getModel();
		const images = request.images ? [...request.images] : [];
		const capabilities = request.capabilities ? [...request.capabilities] : [];
		const references = (request.references ?? []).map(r => r.trim()).filter((r, i, all) => r && all.indexOf(r) === i).slice(0, 8);
		const text = request.text;
		if (!text.trim() && !images.length && !references.length && !capabilities.length && !request.pick) {
			return false;
		}
		// A composer /command: resolved and expanded HERE, BEFORE assembling the messages.
		let displayText = request.displayText?.trim() ? request.displayText : undefined;
		let sendText = text;
		let nativeMode: AgentMode | undefined;
		const selectedCommand = capabilities.find(capability => capability.kind === 'command');
		const leadingNonCommand = capabilities.some(capability => capability.kind !== 'command' && text.trimStart().startsWith(`/${capability.name}`));
		const slash = this.commands.resolve(text);
		const nativeCommand = slash ? NATIVE_WORKFLOW_COMMANDS.find(command => command.slug === slash.slug) : undefined;
		if (slash && nativeCommand && (selectedCommand?.name === slash.slug || !leadingNonCommand)) {
			displayText = displayText || `/${slash.slug}${slash.args ? ` ${slash.args}` : ''}`;
			sendText = `${nativeCommand.instruction}${slash.args ? `\n\n${slash.args}` : ''}`;
			nativeMode = nativeCommand.mode;
		} else if (slash && slash.slug === COMPACT_COMMAND.slug && (selectedCommand?.name === COMPACT_COMMAND.slug || !leadingNonCommand)) {
			// `/compact` with a message: compact first, then send the message as a normal turn. The
			// bare `/compact` never reaches here — the composer routes it to `compact()` directly.
			const rest = (slash.args ?? '').trim();
			if (!rest) {
				void this.compact();
				return true; // consumed: the composer must not hand the text back
			}
			if (this._busy) {
				this.publishNotice('info', COMPACT_BUSY);
				return false;
			}
			await this.compact();
			displayText = displayText || text;
			sendText = rest;
		} else if (slash && (selectedCommand?.name === slash.slug || !leadingNonCommand)) {
			let expanded: { displayText: string; modelText: string } | undefined;
			try {
				expanded = await this.commands.expand(slash.slug, slash.args);
			} catch {
				expanded = undefined;
			}
			if (!expanded) {
				// Nonexistent command: warn WITHOUT spending a turn, and hand the text back.
				const near = await this.commands.closest(slash.slug).catch(() => undefined);
				this.publishNotice('info', `Comando desconocido: /${slash.slug}${near ? ` (¿quisiste decir /${near}?)` : ''}.`);
				return false;
			}
			displayText = displayText || expanded.displayText;
			sendText = expanded.modelText || expanded.displayText;
		}
		// A request arriving while Plan is working is not durable memory: the host turns the
		// user's explicit decision into a portable textual contract.
		const planFollowUp = normalizePlanFollowUpDisposition(request.planFollowUp);
		if (planFollowUp) {
			displayText = displayText || text;
			sendText = buildPlanFollowUpPrompt(sendText, planFollowUp);
			nativeMode = 'plan';
		}
		const mode: AgentMode = nativeMode ?? request.mode ?? 'agent';
		const conversationId = this.sessions.ensureActive();
		this._activeId = conversationId;
		this._effects.setVisibleConversation(conversationId);
		const messages = this.sessions.messagesOf(conversationId);
		await hydrateOpenideChatImages(this.fileService, messages);
		const messageId = generateUuid();
		let context: string | undefined;
		try {
			context = await this.agentService.buildMentionContext(sendText);
		} catch {
			context = undefined; // an unresolvable mention never holds the turn back
		}
		if (references.length) {
			try {
				const attached = await this.agentService.buildFileReferenceContext(references);
				if (attached) { context = context ? `${context}\n\n${attached}` : attached; }
			} catch { /* a file deleted between picking and sending does not block the turn */ }
		}
		for (const selected of capabilities) {
			if (selected.kind === 'command') { continue; }
			try {
				const built = await this.agentService.buildComposerCapabilityContext(selected.kind, selected.name);
				if (built) { context = context ? `${context}\n\n${built}` : built; }
			} catch { /* registry/skill changed: the user's text still travels */ }
		}
		// userPromptSubmit hooks (fail-open): what the user's scripts inject travels in
		// `message.context` — the same vehicle as an @mention — NEVER in the system prompt.
		try {
			const injected = await this.agentService.hookUserPromptSubmit(sendText, conversationId);
			if (injected) { context = context ? `${context}\n\n${injected}` : injected; }
		} catch { /* a broken hook never stops the message */ }
		// Pick & Polish: the element the user pointed at in their running app. Its prose joins the
		// turn's `context` and its screenshot rides along as one more attachment.
		if (request.pick) {
			context = (context ?? '') + request.pick.context;
			if (request.pick.image) {
				images.push(request.pick.image);
			}
		}
		const durableImages = await persistOpenideChatImages(this.fileService, this.chatImageFolder(conversationId), messageId, images);
		// The user keeps conversing without having reverted the previous turn: a WEAK positive
		// signal. Accepting edits is silent, so counting only explicit clicks would skew negative.
		this.creditPreviousTurnSurvived(messages);
		const turn: IChatMessage = {
			role: 'user', content: sendText, messageId, providerId: providerOverride, modelId: modelOverride,
			executionMode: mode, images: durableImages.length ? durableImages : undefined, context,
			displayText, capabilities: capabilities.length ? capabilities : undefined,
		};
		messages.push(turn);
		this.sessions.save(conversationId, messages, false);
		this.appendItems(messageId, { ...request, text: sendText, displayText: displayText ?? (sendText !== text ? text : undefined), images: durableImages, capabilities }, mode, providerOverride, modelOverride);
		// The run is launched synchronously from here so the preparation window stays open until
		// `_runPromise` exists — that is exactly what a queued rollback waits for.
		this.launchRun(conversationId, messages, messageId, mode, providerOverride, modelOverride);
		return true;
	}

	private chatImageFolder(sessionId: string): URI {
		return joinPath(this.environmentService.workspaceStorageHome, this.contextService.getWorkspace().id, 'openideChatImages', sessionId);
	}

	/** Credits the implicit positive to the immediately previous user turn with recorded context. */
	private creditPreviousTurnSurvived(messages: readonly IChatMessage[]): void {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role !== 'user' || !message.messageId) { continue; }
			if (this.learningService.hasContext(message.messageId)) { this.learningService.recordOutcome([message.messageId], 'survived'); }
			return;
		}
	}

	/**
	 * `/compact`: a local, explicit action. It adds no user turn and runs no tools; it uses the same
	 * runtime/model as automatic compaction and persists the synthetic summary in the session. The
	 * compaction card lands in the transcript through the ordinary reducer, on a hidden turn.
	 * Resolves even when compaction fails: `/compact <message>` must still send its message.
	 */
	async compact(): Promise<void> {
		if (this._busy) {
			this.publishNotice('info', COMPACT_BUSY);
			return;
		}
		const conversationId = this.sessions.ensureActive();
		this._activeId = conversationId;
		this._effects.setVisibleConversation(conversationId);
		const messages = this.sessions.messagesOf(conversationId);
		this._runCts?.cancel();
		const runCts = new CancellationTokenSource();
		this._runCts = runCts;
		this._compacting = true;
		this.setBusy(true);
		this.finishStream({ isCanceled: true });
		this._state = openOpenideChatReply(beginOpenideChatHiddenTurn(this._state, generateUuid()));
		this._streaming = true;
		const runPromise = this.agentService.compactConversation(messages, event => this.handleRunEvent(runCts, conversationId, messages, event), runCts.token);
		this._runPromise = runPromise;
		try {
			await runPromise;
			if (this._runCts !== runCts) { return; }
			this.sessions.save(conversationId, messages, false);
			this.finishStream({});
		} catch (error) {
			if (this._runCts !== runCts) { return; }
			this.finishStream({ errorMessage: error instanceof Error ? error.message : String(error) });
		} finally {
			if (this._runCts === runCts) {
				this._runCts = undefined;
				this._compacting = false;
				this.setBusy(false);
			}
			if (this._runPromise === runPromise) { this._runPromise = undefined; }
		}
	}

	/**
	 * A mode suggestion was accepted: resumes the last request in the other mode WITHOUT a second
	 * visible user message. A mode change is execution metadata, not transcript content.
	 *
	 * The triage loop already added assistant(suggest_mode)+tool(accepted) and ended its run with
	 * `done{reason:'mode-switch'}`, which the reducer's filter turned into the `modeHandoff` effect
	 * so the turn stayed open and busy never dropped. Rewinding those messages leaves the original
	 * request as the last turn, exactly like a native mode change.
	 */
	resumeInMode(mode: AgentMode | 'fork', refinedPrompt: string | undefined): void {
		const conversationId = this._activeId;
		if (!conversationId) { return; }
		if (mode === 'fork') {
			// The card offered a branch: the widget owns forking; here the run simply ends.
			this.finishStream({});
			this.setBusy(false);
			return;
		}
		const messages = this.sessions.messagesOf(conversationId);
		const user = rewindForSilentModeTransition(messages, mode);
		if (!user) { return; }
		this.sessions.save(conversationId, messages, false);
		this._onDidResumeInMode.fire(mode);
		const providerOverride = user.providerId || this.agentService.getActiveProviderId();
		const modelOverride = user.modelId || this.agentService.getModel();
		this.launchRun(conversationId, messages, user.messageId ?? generateUuid(), mode, providerOverride, modelOverride, refinedPrompt?.trim() || undefined);
	}

	private appendItems(messageId: string, request: IOpenideChatSendRequest, mode: AgentMode, providerId: string, modelId: string): void {
		// A second turn admitted while one is streaming takes over the run (launchRun cancels the
		// previous CTS). Closing the old reply here is what stops it from keeping a caret forever:
		// its dataId would never gain the `_done` suffix once no event can reach it again.
		this.finishStream({ isCanceled: true });
		this._state = openOpenideChatReply(beginOpenideChatTurn(this._state, createOpenideChatRequestItem({
			id: messageId, messageId, text: request.text, displayText: request.displayText,
			images: request.images, capabilities: request.capabilities, mode, providerId, modelId,
		})));
		// The reply row opens EMPTY right away: it is what carries the "Pensando…" shimmer during
		// the silence before the first event, and the reducer withdraws it if the turn settles with
		// nothing to show.
		this._streaming = true;
		this._onDidChangeItems.fire();
	}

	private launchRun(conversationId: string, messages: IChatMessage[], messageId: string, mode: AgentMode, providerOverride: string, modelOverride: string, modeInstruction?: string): void {
		this._runCts?.cancel();
		const runCts = new CancellationTokenSource();
		this._runCts = runCts;
		this._modeHandoff = false;
		this.setBusy(true);
		const runPromise = this.agentService.runMessages(
			messages,
			event => this.handleRunEvent(runCts, conversationId, messages, event),
			runCts.token,
			{ mode, messageId, providerOverride, modelOverride, modeInstruction },
		);
		this._runPromise = runPromise;
		void runPromise.then(() => {
			if (this._runCts !== runCts || this._modeHandoff) { return; }
			this.sessions.save(conversationId, messages, false);
			this.finishStream({});
			this.settlePlanBuild(false);
			this.finishRun(false);
		}, error => {
			if (this._runCts !== runCts || this._modeHandoff) { return; }
			this.finishStream({ errorMessage: error instanceof Error ? error.message : String(error) });
			this.settlePlanBuild(true);
			this.finishRun(true);
		}).finally(() => {
			if (this._runPromise === runPromise) { this._runPromise = undefined; }
		});
	}

	/**
	 * The single entry point for everything the engine reports.
	 *
	 * The three filters the webview host applied by hand before posting (`openideChatView.ts:1436`)
	 * now live in `filterAgentEvent`, so this method does not inspect the event at all: it reduces
	 * it, performs the effects that came back and repaints.
	 */
	private handleRunEvent(runCts: CancellationTokenSource, conversationId: string, messages: IChatMessage[], event: AgentLoopEvent): void {
		// The change-set is host-only metadata and the rollback's source of truth. It is applied even
		// for a cancelled run, because the files it describes were already written to disk.
		const step = applyAgentEvent(this._state, event);
		if (this._runCts !== runCts) {
			// A late callback from a superseded run must not touch the live transcript, but its
			// storage effects still have to land: those describe work that really happened.
			this._effects.apply({ conversationId, messages }, step.sessionEffects.filter(isStorageEffect));
			return;
		}
		this._state = step.state;
		this._effects.apply({ conversationId, messages }, step.sessionEffects);
		this.applyRunLifecycle(conversationId, messages, step.sessionEffects);
		if (!step.dropped) {
			this._onDidChangeItems.fire();
		}
	}

	/**
	 * `runComplete` / `runFailed` are the only effects the runner refuses: closing the turn and
	 * clearing the busy state are transcript decisions, and `finishStream` is what stamps them.
	 */
	private applyRunLifecycle(conversationId: string, messages: IChatMessage[], effects: readonly IOpenideChatSessionEffect[]): void {
		for (const effect of effects) {
			if (effect.type === 'modeHandoff') {
				// The triage run is over but the request is not: `resumeInMode` takes over as soon as
				// the suggestion card reports the acceptance. Busy stays up and the turn stays open.
				this._modeHandoff = true;
				this.sessions.save(conversationId, messages, false);
				continue;
			}
			if (effect.type !== 'runComplete' && effect.type !== 'runFailed') {
				continue;
			}
			const failed = effect.type === 'runFailed';
			this.sessions.save(conversationId, messages, failed);
			// The reducer already closed the reply and, for a real failure, wrote the message into it.
			// Re-stamping it here would only bump the version, so the stream is just released.
			this._streaming = false;
			this.finishRun(failed);
		}
	}

	/** Idempotent: `done` and the run promise both settle, and only the first one may close the row. */
	private finishStream(update: { readonly isCanceled?: boolean; readonly errorMessage?: string }): void {
		const next = closeOpenideChatTurn(this._state, update);
		this._streaming = false;
		if (next === this._state) {
			return; // nothing was open: the reducer's own `done` already settled the turn
		}
		this._state = next;
		this._onDidChangeItems.fire();
	}

	/** Single closing point of a REAL run: clears busy and reports "task finished" once. */
	private finishRun(hadError: boolean): void {
		const wasBusy = this._busy;
		const wasCompacting = this._compacting;
		this.setBusy(false);
		if (wasBusy && !wasCompacting) {
			this._onDidFinishRun.fire({ hadError });
		}
	}

	private setBusy(busy: boolean): void {
		if (this._busy === busy) { return; }
		this._busy = busy;
		this._onDidChangeBusy.fire(busy);
	}

	private publishNotice(severity: IOpenideChatNotice['severity'], message: string): void {
		this._onDidPublishNotice.fire({ severity, message });
	}

	private async doRollback(messageId: string, restoreComposer: boolean): Promise<IOpenideChatRollbackOutcome> {
		const conversationId = this._activeId ?? this.sessions.ensureActive();
		const outcome = await runOpenideChatRollback({
			sessions: this.sessions, agentService: this.agentService, conversationId, messageId, restoreComposer,
			drainRun: () => this.drainRun(),
		});
		if (!outcome.committed) {
			return outcome;
		}
		this.setBusy(false);
		this.rebuildItems(this.sessions.messagesOf(conversationId));
		return outcome;
	}

	/** Cancels the run in flight and waits it out: no tool may keep writing during a rollback. */
	private async drainRun(): Promise<void> {
		const runToStop = this._runPromise;
		this._runCts?.cancel();
		this._runCts = undefined;
		if (runToStop) {
			try { await runToStop; } catch { /* the run's own failure is not the rollback's problem */ }
		}
	}

	/**
	 * Repaints the whole transcript from storage and re-arms the reducer on top of it.
	 *
	 * The rebuilt items become the reducer's initial state rather than a detached array, so a run
	 * that starts right after a restore appends to the same list instead of forking a second one.
	 */
	private rebuildItems(messages: readonly IChatMessage[]): void {
		this._state = createOpenideChatReducerState(buildOpenideChatTranscript(messages));
		this._streaming = false;
		this._onDidChangeItems.fire();
	}

	override dispose(): void {
		this._runCts?.cancel();
		this._runCts = undefined;
		super.dispose();
	}
}
