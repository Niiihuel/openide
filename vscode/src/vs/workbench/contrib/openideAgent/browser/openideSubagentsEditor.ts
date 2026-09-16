/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { URI } from '../../../../base/common/uri.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { t } from '../common/openideStrings.js';
import { isTerminalSubagentStatus } from '../common/openideSubagentTypes.js';
import { subagentTaskTitle } from '../common/openideSubagentTitle.js';
import { OpenideAgentConversationEditor, OpenideAgentConversationInput } from './openideAgentConversationEditor.js';
import { createSubagentAvatar, subagentAvatarKind } from './openideSubagentAvatar.js';
import { ISubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { isOpenideChatTextClipped, setupChatTooltip } from './chat/openideChatHover.js';
import { appendSubagentTimelineEvent, lastSubagentTimelineRows } from './chat/parts/openideChatSubagentTimeline.js';
import { relativeTimeLabel } from './chat/openideChatSessionsPane.js';
import './chat/media/openideSubagents.css';
import { conversationSubagents, SubagentPresentation } from './openideSubagentPresentation.js';

/** A single tab for a conversation's workers. Selection never changes the main chat. */
export class OpenideSubagentsInput extends EditorInput {
	static readonly ID = 'openide.agent.subagents';
	override get typeId(): string { return OpenideSubagentsInput.ID; }
	override readonly resource: URI;
	private readonly selectionChanged = this._register(new Emitter<void>());
	readonly onDidSelect = this.selectionChanged.event;
	selectedRunId: string | undefined;
	constructor(readonly parentSessionId: string, readonly source: OpenideChatWidget) {
		super(); this.resource = URI.from({ scheme: 'openide-subagents', path: `/${parentSessionId}` });
	}
	select(runId: string | undefined): void { if (runId !== this.selectedRunId) { this.selectedRunId = runId; this.selectionChanged.fire(); } }
	override getName(): string { return t('agentWindow.subagents'); }
	override getIcon() { return Codicon.hubot; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof OpenideSubagentsInput && other.parentSessionId === this.parentSessionId && other.source === this.source; }
}

interface RunRow { avatarKind: string; row: HTMLElement; open: HTMLButtonElement; title: HTMLElement; state: HTMLElement; time: HTMLElement; stop: HTMLButtonElement; store: DisposableStore }

export class OpenideSubagentsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.openideSubagents';
	private root!: HTMLElement;
	private overview!: HTMLElement;
	private scroll!: DomScrollableElement;
	private activeHeading!: HTMLElement;
	private doneHeading!: HTMLElement;
	private activeRows!: HTMLElement;
	private doneRows!: HTMLElement;
	private emptyActive!: HTMLElement;
	private emptyDone!: HTMLElement;
	private detail!: HTMLElement;
	private detailTitle!: HTMLElement;
	private detailIcon!: HTMLElement;
	private workToggle!: HTMLButtonElement;
	private workLabel!: HTMLElement;
	private stopDetail!: HTMLButtonElement;
	private fallback!: HTMLElement;
	private transcript!: OpenideAgentConversationEditor;
	private transcriptHost!: HTMLElement;
	private transcriptLoad: CancellationTokenSource | undefined;
	private readonly transcriptInput = this._register(new MutableDisposable<OpenideAgentConversationInput>());
	private readonly subscriptions = this._register(new DisposableStore());
	private readonly fallbackRows = this._register(new DisposableStore());
	private readonly rows = new Map<string, RunRow>();
	private overviewKey = '';
	private detailRunId: string | undefined;
	private fallbackKey = '';
	private fullHistory = false;
	private paneVisible = false;
	private dimension = new Dimension(0, 0);
	private readonly refreshScheduler = this._register(new RunOnceScheduler(() => this.refresh(), 100));
	private readonly clockScheduler = this._register(new RunOnceScheduler(() => { if (this.selectedInput()?.selectedRunId) { this.updateDuration(); } else if (this.paneVisible) { this.refresh(); } }, 1000));
	constructor(group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@ISubagentOrchestrationService private readonly orchestration: ISubagentOrchestrationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IHoverService private readonly hover: IHoverService,
	) { super(OpenideSubagentsEditor.ID, group, telemetry, theme, storage); }

	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-subagents-editor.openide-chat-native'));
		this.overview = $('.openide-subagents-overview');
		this.activeHeading = append(this.overview, $('h2'));
		this.activeRows = append(this.overview, $('.openide-subagents-rows'));
		this.emptyActive = append(this.overview, $('.openide-agent-window-empty', undefined, t('agentWindow.noActiveSubagents')));
		this.doneHeading = append(this.overview, $('h2'));
		this.doneRows = append(this.overview, $('.openide-subagents-rows'));
		this.emptyDone = append(this.overview, $('.openide-agent-window-empty', undefined, t('agentWindow.noCompletedSubagents')));
		this.scroll = this._register(new DomScrollableElement(this.overview, { horizontal: ScrollbarVisibility.Hidden, vertical: ScrollbarVisibility.Auto }));
		this.root.appendChild(this.scroll.getDomNode());
		this.detail = append(this.root, $('.openide-subagents-detail'));
		const header = append(this.detail, $('.openide-subagents-detail-header'));
		this.iconButton(header, t('agentWindow.backToSubagents'), 'arrow-left', () => this.selectedInput()?.select(undefined), this._store).classList.add('openide-subagents-back');
		this.detailIcon = append(header, $('span.openide-subagents-detail-icon'));
		this.detailTitle = append(header, $('span.openide-subagents-detail-title'));
		this.stopDetail = this.iconButton(header, t('chat.part.subagentStop'), 'primitive-square', () => { const id = this.selectedInput()?.selectedRunId; if (id) { this.agentService.cancelSubagent(id); } }, this._store);
		this.workToggle = append(this.detail, $<HTMLButtonElement>('button.openide-subagents-work', { type: 'button', 'aria-expanded': 'false' }));
		this.workLabel = append(this.workToggle, $('span'));
		append(this.workToggle, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
		this._register(addDisposableListener(this.workToggle, 'click', () => {
			this.fullHistory = !this.fullHistory;
			this.transcriptInput.value?.setSummaryOnly(!this.fullHistory);
			this.workToggle.setAttribute('aria-expanded', String(this.fullHistory));
			this.refresh();
		}));
		this.fallback = append(this.detail, $('.openide-subagents-fallback'));
		this.transcriptHost = append(this.detail, $('.openide-subagents-transcript'));
		this.transcript = this._register(this.instantiation.createInstance(OpenideAgentConversationEditor, this.group));
		this.transcript.create(this.transcriptHost);
	}

	private selectedInput(): OpenideSubagentsInput | undefined { return this.input instanceof OpenideSubagentsInput ? this.input : undefined; }
	private iconButton(parent: HTMLElement, title: string, icon: string, action: () => void, store: DisposableStore): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button', 'aria-label': title }));
		append(button, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
		store.add(addDisposableListener(button, 'click', action)); store.add(setupChatTooltip(this.hover, button, () => title)); return button;
	}
	override async setInput(input: OpenideSubagentsInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token); if (token.isCancellationRequested) { return; }
		this.subscriptions.clear();
		const schedule = () => { if (this.paneVisible && !this.refreshScheduler.isScheduled()) { this.refreshScheduler.schedule(); } };
		this.subscriptions.add(input.onDidSelect(() => this.refresh()));
		// The child transcript owns streaming; metadata changes also discover in-loop specialists.
		this.subscriptions.add(input.source.sessionStore.onDidChange(schedule));
		this.subscriptions.add(this.orchestration.onDidChangeRun(schedule));
		this.refresh();
	}
	private refresh(): void {
		const input = this.selectedInput(); if (!input) { return; }
		const runs = conversationSubagents(input.source.sessionStore, input.parentSessionId, this.orchestration.getRunsForParent(input.parentSessionId));
		const selected = runs.find(run => run.runId === input.selectedRunId);
		const transcriptWasHidden = this.transcriptHost.hidden;
		const selectionChanged = this.detail.hidden === !!selected || (selected && this.detailRunId !== selected.runId);
		this.detail.hidden = !selected; this.scroll.getDomNode().hidden = !!selected;
		if (selected) { this.showDetail(input, selected); }
		else { this.transcript.setVisible(false); this.renderRows(runs); if (this.paneVisible && !this.clockScheduler.isScheduled()) { this.clockScheduler.schedule(60_000); } }
		if (selectionChanged || transcriptWasHidden !== this.transcriptHost.hidden) { this.layout(this.dimension); }
	}
	private renderRows(runs: readonly SubagentPresentation[]): void {
		const key = JSON.stringify(runs.map(run => [run.runId, subagentTaskTitle(run.task, run.definitionName), run.status, run.completedAt ?? run.createdAt, subagentAvatarKind(run)])) + Math.floor(Date.now() / 60_000);
		if (key === this.overviewKey) { return; }
		this.overviewKey = key;
		const active = runs.filter(run => !isTerminalSubagentStatus(run.status));
		const done = runs.filter(run => isTerminalSubagentStatus(run.status));
		this.activeHeading.textContent = `${t('agentWindow.subagentsActive')} · ${active.length}`;
		this.doneHeading.textContent = `${t('agentWindow.subagentsDone')} · ${done.length}`;
		this.emptyActive.hidden = active.length > 0; this.emptyDone.hidden = done.length > 0;
		for (const [id, row] of this.rows) { if (!runs.some(run => run.runId === id)) { row.store.dispose(); row.row.remove(); this.rows.delete(id); } }
		for (const [host, entries] of [[this.activeRows, active], [this.doneRows, done]] as const) {
			let anchor = host.firstChild;
			for (const run of [...entries].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))) {
				let row = this.rows.get(run.runId);
				if (!row) {
					const store = new DisposableStore();
					const element = $('.openide-subagents-row'); element.dataset.runId = run.runId;
					const open = append(element, $<HTMLButtonElement>('button.openide-subagents-open', { type: 'button' }));
					open.appendChild(createSubagentAvatar(run));
					const title = append(open, $('span.openide-subagents-row-title'));
					const state = append(open, $('span.openide-subagents-row-state'));
					const time = append(open, $('time.openide-subagents-row-time'));
					store.add(addDisposableListener(open, 'click', () => this.selectedInput()?.select(run.runId)));
					store.add(setupChatTooltip(this.hover, open, () => isOpenideChatTextClipped(title) ? open.getAttribute('aria-label') ?? '' : '', { aria: false }));
					const stop = this.iconButton(element, t('chat.part.subagentStop'), 'primitive-square', () => this.agentService.cancelSubagent(run.runId), store);
					row = { avatarKind: subagentAvatarKind(run), row: element, open, title, state, time, stop, store }; this.rows.set(run.runId, row);
				}
				const kind = subagentAvatarKind(run);
				if (row.avatarKind !== kind) { row.open.firstElementChild!.replaceWith(createSubagentAvatar(run)); row.avatarKind = kind; }
				const title = subagentTaskTitle(run.task, run.definitionName);
				const finished = isTerminalSubagentStatus(run.status);
				const status = t(run.status === 'completed' ? 'chat.part.subagentDone' : run.status === 'failed' ? 'chat.part.subagentFailed' : finished ? 'chat.part.subagentCancelled' : 'chat.part.subagentRunning');
				if (row.title.textContent !== title) { row.title.textContent = title; }
				if (row.open.getAttribute('aria-label') !== `${title}: ${status}`) { row.open.setAttribute('aria-label', `${title}: ${status}`); }
				const indicator = finished ? (run.status === 'completed' ? '' : status) : t(run.status === 'queued' ? 'agentWindow.subagentQueued' : run.status === 'waiting' ? 'agentWindow.subagentWaiting' : 'agentWindow.subagentRunning');
				if (row.state.textContent !== indicator) { row.state.textContent = indicator; }
				const time = relativeTimeLabel(run.completedAt ?? run.createdAt, Date.now());
				if (row.time.textContent !== time) { row.time.textContent = time; }
				row.stop.hidden = finished;
				if (row.row !== anchor) { host.insertBefore(row.row, anchor); } anchor = row.row.nextSibling;
			}
		}
		this.scroll.scanDomNode();
	}
	private showDetail(input: OpenideSubagentsInput, run: SubagentPresentation): void {
		if (this.detailRunId !== run.runId) {
			this.detailRunId = run.runId; this.fullHistory = !isTerminalSubagentStatus(run.status);
			this.detailIcon.replaceChildren(createSubagentAvatar(run));
			this.transcript.setVisible(false); this.clearTranscript();
		}
		const title = subagentTaskTitle(run.task, run.definitionName);
		if (this.detailTitle.textContent !== title) { this.detailTitle.textContent = title; }
		const session = input.source.controller.subagentSessionOf(run.runId);
		if (session && this.transcriptInput.value?.sessionId !== session) {
			const transcript = new OpenideAgentConversationInput(session, input.source);
			transcript.setSummaryOnly(!this.fullHistory);
			this.transcriptInput.value = transcript;
			this.transcriptLoad?.dispose(true);
			this.transcriptLoad = new CancellationTokenSource();
			void this.transcript.setInput(transcript, undefined, { newInGroup: true }, this.transcriptLoad.token).catch(onUnexpectedError);
		}
		this.transcript.setVisible(this.paneVisible && !!session);
		this.fallback.hidden = !!session;
		this.transcriptHost.hidden = !session;
		if (!session) { this.renderFallback(run); }
		this.workToggle.setAttribute('aria-expanded', String(this.fullHistory));
		this.workToggle.disabled = !session && !(run.timeline?.length);
		this.stopDetail.hidden = isTerminalSubagentStatus(run.status);
		this.updateDuration();
	}
	private renderFallback(run: SubagentPresentation): void {
		const timeline = run.timeline ?? [];
		const last = timeline[timeline.length - 1];
		const key = JSON.stringify([
			run.runId, this.fullHistory, run.status, timeline.length, last?.sequence,
			run.progress, run.error, run.result?.summary,
		]);
		if (key === this.fallbackKey) { return; }
		this.fallbackKey = key;
		this.fallbackRows.clear();
		this.fallback.replaceChildren();

		const body = append(this.fallback, $('.openide-subagents-fallback-timeline'));
		const toolRows = new Map<string, HTMLElement>();
		const events = this.fullHistory ? timeline : lastSubagentTimelineRows(timeline, 4);
		const messages = new Set(events.map(event => event.message).filter((message): message is string => !!message));
		let painted = false;
		for (const event of events) {
			painted = !!appendSubagentTimelineEvent(body, toolRows, event, this.hover, this.fallbackRows) || painted;
		}

		const conclusion = run.error || run.result?.summary || (!painted ? run.progress : undefined);
		if (conclusion && !messages.has(conclusion)) {
			const result = append(body, $('.openide-subagents-fallback-result'));
			result.textContent = conclusion;
			result.classList.toggle('openide-subagents-fallback-error', !!run.error);
			painted = true;
		}
		if (!painted) {
			append(body, $('.openide-subagents-fallback-message', undefined, run.progress || t('agentWindow.subagentPreparing')));
		}
	}

	private updateDuration(): void {
		this.clockScheduler.cancel();
		const input = this.selectedInput(); const run = input?.selectedRunId ? conversationSubagents(input.source.sessionStore, input.parentSessionId, this.orchestration.getRunsForParent(input.parentSessionId)).find(run => run.runId === input.selectedRunId) : undefined;
		if (!run) { return; }
		if (run.startedAt === undefined && isTerminalSubagentStatus(run.status)) { this.workLabel.textContent = t('chat.part.subagentDone'); return; }
		const seconds = Math.max(0, Math.floor(((run.completedAt ?? Date.now()) - (run.startedAt ?? run.createdAt)) / 1000));
		const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
		const text = t(isTerminalSubagentStatus(run.status) ? 'agentWindow.subagentWorked' : 'agentWindow.subagentWorking', duration);
		if (this.workLabel.textContent !== text) { this.workLabel.textContent = text; }
		if (this.paneVisible && !isTerminalSubagentStatus(run.status)) { this.clockScheduler.schedule(); }
	}
	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (this.paneVisible === visible) { return; }
		this.paneVisible = visible;
		if (visible) { this.refreshScheduler.schedule(0); } else { this.refreshScheduler.cancel(); this.clockScheduler.cancel(); this.transcript?.setVisible(false); }
	}
	layout(dimension: Dimension): void {
		this.dimension = dimension; if (!this.root) { return; }
		this.root.style.height = `${dimension.height}px`;
		this.scroll.getDomNode().style.height = `${dimension.height}px`; this.scroll.scanDomNode();
		if (!this.detail.hidden) { this.transcript.layout(new Dimension(this.transcriptHost.clientWidth, this.transcriptHost.clientHeight)); }
	}
	private clearTranscript(): void { this.transcriptLoad?.dispose(true); this.transcriptLoad = undefined; this.transcript.clearInput(); this.transcriptInput.clear(); }
	override clearInput(): void { this.subscriptions.clear(); this.refreshScheduler.cancel(); this.clockScheduler.cancel(); this.clearTranscript(); this.fallbackRows.clear(); this.fallbackKey = ''; this.detailRunId = undefined; this.overviewKey = ''; super.clearInput(); }
	override dispose(): void { this.transcriptLoad?.dispose(true); for (const row of this.rows.values()) { row.store.dispose(); } this.rows.clear(); super.dispose(); }
}
