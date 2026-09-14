/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { conversationSubagents } from './openideSubagentPresentation.js';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { setupChatTooltip } from './chat/openideChatHover.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatMessage } from '../common/openideAgentTypes.js';
import { isTerminalSubagentStatus } from '../common/openideSubagentTypes.js';
import { t } from '../common/openideStrings.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { createContextRow, createContextSection } from './openideAgentWindowContextControls.js';
import { ISubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { createSubagentAvatar, subagentAvatarKind } from './openideSubagentAvatar.js';
import './chat/media/openideAgentWindowActivity.css';
import './chat/media/openideSubagents.css';

export interface IAgentWindowActivityActions {
	readonly openSubagents?: () => void;
	readonly openTerminal: (instanceId?: number) => void;
	readonly addSource?: () => void;
	readonly openResource: (resource: URI) => void;
	readonly openBrowser?: (url: string) => void;
}

export interface IAgentConversationSource {
	readonly resource: URI;
	readonly label: string;
	readonly image?: string;
}

/** Sources are explicit user context, never URLs found in tool output or hidden prompts. */
export function agentConversationSources(messages: readonly IChatMessage[], root?: URI): IAgentConversationSource[] {
	const sources = new Map<string, IAgentConversationSource>();
	let imageIndex = 0;
	for (const message of messages) {
		if (message.role !== 'user' || message.hidden) { continue; }
		for (const match of (message.displayText ?? message.content).matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
			const resource = URI.parse(match[0].replace(/[.,;!?]+$/, ''));
			if (resource.authority) { sources.set(resource.toString(), { resource, label: resource.authority + resource.path }); }
		}
		for (const snippet of message.snippets ?? []) {
			const resource = snippet.uri ? URI.parse(snippet.uri) : snippet.path.startsWith('/') ? URI.file(snippet.path) : root ? URI.joinPath(root, snippet.path) : undefined;
			if (resource) { sources.set(resource.toString(), { resource, label: basename(resource) }); }
		}
		for (const image of message.images ?? []) {
			imageIndex++;
			if (!image.assetUri) { continue; }
			const resource = URI.parse(image.assetUri);
			sources.set(resource.toString(), { resource, label: t('agentWindow.imageSource', imageIndex), image: FileAccess.uriToBrowserUri(resource).toString(true) });
		}
	}
	return [...sources.values()];
}

interface IActivitySection {
	readonly body: HTMLElement;
	readonly count: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly rows: DisposableStore;
	expanded: boolean;
	all: boolean;
	signature?: string;
}

/** Conversation activity uses the existing run, terminal and attachment owners. */
export class OpenideAgentWindowActivity extends Disposable {
	private readonly subagents: IActivitySection;
	private readonly processes: IActivitySection;
	private readonly sources: IActivitySection;
	private readonly terminalListeners = this._register(new DisposableStore());
	private disposed = false;
	private subagentSummary: HTMLButtonElement | undefined;
	private subagentSummaryIcons: HTMLElement | undefined;
	private subagentSummaryLabel: HTMLElement | undefined;
	private subagentSummaryKey = '';
	private subagentsEmpty: HTMLElement | undefined;

	constructor(
		parent: HTMLElement,
		private readonly source: OpenideChatWidget,
		private readonly actions: IAgentWindowActivityActions,
		@ISubagentOrchestrationService private readonly orchestration: ISubagentOrchestrationService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();
		// Recover ownership for mirrors saved before parentSessionId was persisted.
		for (const session of source.sessionStore.listAll()) {
			if (session.subagentRunId) { continue; }
			for (const run of this.orchestration.getRunsForParent(session.id)) {
				const child = source.sessionStore.sessionOfSubagentRun(run.runId);
				if (child) { source.sessionStore.linkSubagentParent(child, session.id, run.task, run.definitionName); }
			}
		}
		this.subagents = this.section(parent, t('agentWindow.subagents'), 'subagents');
		this.processes = this.section(parent, t('agentWindow.processes'), 'processes', () => actions.openTerminal());
		this.sources = this.section(parent, t('agentWindow.sources'), 'sources', actions.addSource);
		const refresh = this._register(new RunOnceScheduler(() => this.refresh(), 75));
		const schedule = () => { if (!refresh.isScheduled()) { refresh.schedule(); } };
		const subagentsRefresh = this._register(new RunOnceScheduler(() => this.renderSubagents(), 75));
		this._register(source.sessionStore.onDidChange(schedule));
		this._register(source.onDidChangeNavigation(schedule));
		this._register(this.orchestration.onDidChangeRun(() => { if (!subagentsRefresh.isScheduled()) { subagentsRefresh.schedule(); } }));
		this._register(this.terminalService.onDidChangeInstances(() => this.bindTerminals()));
		this.bindTerminals();
		this.refresh();
	}

	private section(parent: HTMLElement, label: string, kind: string, add?: () => void): IActivitySection {
		const body = createContextSection(parent, label, this._store, this.hoverService, add, t(kind === 'processes' ? 'agentWindow.terminalNew' : 'chat.tip.attach'));
		body.parentElement!.classList.add('openide-context-activity');
		body.parentElement!.dataset.activity = kind;
		const heading = body.previousElementSibling as HTMLElement;
		const count = append(heading, $('span.openide-context-activity-count'));
		const toggle = append(heading, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action.openide-context-activity-toggle', { type: 'button', 'aria-label': label, 'aria-expanded': 'true' }));
		append(toggle, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));

		heading.append(...Array.from(heading.querySelectorAll('.openide-agent-window-section-add')));
		const section: IActivitySection = { body, count, toggle, rows: this._register(new DisposableStore()), expanded: true, all: false };
		this._register(addDisposableListener(toggle, 'click', () => {
			section.expanded = !section.expanded; body.hidden = !section.expanded;
			toggle.setAttribute('aria-expanded', String(section.expanded));
		}));
		return section;
	}

	refresh(): void {
		if (this.disposed) { return; }
		this.renderSubagents(); this.renderProcesses(); this.renderSources();
	}

	private begin(section: IActivitySection, signature: unknown, count: number): boolean {
		const key = JSON.stringify([signature, section.all]);
		if (section.signature === key) { return false; }
		section.signature = key; section.rows.clear(); clearNode(section.body);
		section.count.textContent = count ? String(count) : '';
		return true;
	}

	private row(parent: HTMLElement, label: string, icon: string, action: () => void, store: DisposableStore): HTMLButtonElement {
		return createContextRow(parent, label, icon, action, store, this.hoverService);
	}

	private action(parent: HTMLElement, label: string, icon: string, run: () => void, store: DisposableStore): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button', 'aria-label': label }));
		append(button, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
		store.add(setupChatTooltip(this.hoverService, button, () => label));
		store.add(addDisposableListener(button, 'click', run));
		return button;
	}

	private more(section: IActivitySection, count: number, refresh: () => void): void {
		if (count <= 3) { return; }
		const more = append(section.body, $<HTMLButtonElement>('button.oi-btn.ghost.openide-context-activity-more', { type: 'button' }, t(section.all ? 'sessions.showLess' : 'sessions.showMore')));
		section.rows.add(addDisposableListener(more, 'click', () => { section.all = !section.all; refresh(); section.body.querySelector<HTMLButtonElement>('.openide-context-activity-more')?.focus(); }));
	}

	private empty(section: IActivitySection, label: string): void { append(section.body, $('.openide-agent-window-empty', undefined, label)); }

	private renderSubagents(): void {
		const conversation = this.source.sessionStore.activeSessionId();
		const runs = conversation ? conversationSubagents(this.source.sessionStore, conversation, this.orchestration.getRunsForParent(conversation)) : [];
		for (const run of runs) {
			const session = this.source.controller.subagentSessionOf(run.runId);
			if (session && conversation) { this.source.sessionStore.linkSubagentParent(session, conversation, run.task, run.definitionName); }
		}
		if (!this.subagentSummary) {
			this.subagentSummary = this.row(this.subagents.body, '', 'hubot', () => this.actions.openSubagents?.(), this.subagents.rows);
			this.subagentSummary.classList.add('openide-subagents-summary');
			this.subagentSummaryIcons = $('span.openide-subagents-summary-icons', { 'aria-hidden': 'true' });
			this.subagentSummary.firstElementChild!.replaceWith(this.subagentSummaryIcons);
			this.subagentSummaryLabel = this.subagentSummary.querySelector<HTMLElement>('.openide-agent-window-row-label')!;
			this.subagentsEmpty = append(this.subagents.body, $('.openide-agent-window-empty', undefined, t('agentWindow.noSubagents')));
		}
		const running = runs.filter(run => !isTerminalSubagentStatus(run.status)).length;
		const text = [running ? t('agentWindow.runningCount', running) : '', runs.length > running ? t('agentWindow.doneCount', runs.length - running) : ''].filter(Boolean).join(' · ');
		if (this.subagentSummaryLabel!.textContent !== text) { this.subagentSummaryLabel!.textContent = text; }
		const label = `${t('agentWindow.subagents')}: ${text}`;
		if (this.subagentSummary.getAttribute('aria-label') !== label) { this.subagentSummary.setAttribute('aria-label', label); }
		this.subagentSummary.hidden = !runs.length; this.subagentsEmpty!.hidden = !!runs.length;
		// Show the workers represented by the live count before older finished runs.
		const visible = [...runs.filter(run => !isTerminalSubagentStatus(run.status)), ...runs.filter(run => isTerminalSubagentStatus(run.status))].slice(0, 4);
		const key = visible.map(run => `${run.runId}:${subagentAvatarKind(run)}`).join(',');
		if (key !== this.subagentSummaryKey) {
			this.subagentSummaryKey = key;
			this.subagentSummaryIcons!.replaceChildren(...visible.map(run => createSubagentAvatar(run)));
		}
	}

	private bindTerminals(): void {
		this.terminalListeners.clear();
		for (const instance of this.terminalService.instances) { this.terminalListeners.add(instance.onTitleChanged(() => this.renderProcesses())); }
		this.renderProcesses();
	}

	private renderProcesses(): void {
		const instances = this.terminalService.instances.filter(instance => !instance.isDisposed && !instance.shellLaunchConfig.hideFromUser);
		if (!this.begin(this.processes, instances.map(instance => [instance.instanceId, instance.title]), instances.length)) { return; }
		if (!instances.length) { this.empty(this.processes, t('agentWindow.noProcesses')); }
		for (const instance of this.processes.all ? instances : instances.slice(0, 3)) {
			const entry = append(this.processes.body, $('.openide-context-activity-entry'));
			entry.dataset.terminalId = String(instance.instanceId);
			this.row(entry, instance.title || t('agentWindow.terminal'), 'terminal', () => this.actions.openTerminal(instance.instanceId), this.processes.rows);
			const actions = append(entry, $('.openide-context-activity-actions'));
			this.action(actions, t('chat.part.terminalStopOf', instance.title), 'trash', () => void this.terminalService.safeDisposeTerminal(instance).catch(onUnexpectedError), this.processes.rows);
		}
		this.more(this.processes, instances.length, () => this.renderProcesses());
	}

	private renderSources(): void {
		const conversation = this.source.sessionStore.activeSessionId();
		const session = this.source.sessionStore.metaOf(conversation);
		const root = session?.cwd ? URI.file(session.cwd) : this.workspaceService.getWorkspace().folders[0]?.uri;
		const sources = agentConversationSources(this.source.sessionStore.messagesOf(conversation), root);
		if (!this.begin(this.sources, [conversation, sources], sources.length)) { return; }
		if (!sources.length) { this.empty(this.sources, t('agentWindow.noSources')); }
		for (const source of this.sources.all ? sources : sources.slice(0, 3)) {
			const row = this.row(this.sources.body, source.label, source.image ? 'file-media' : source.resource.scheme === 'http' || source.resource.scheme === 'https' ? 'globe' : 'file', () => {
				if ((source.resource.scheme === 'http' || source.resource.scheme === 'https') && this.actions.openBrowser) { this.actions.openBrowser(source.resource.toString()); }
				else { this.actions.openResource(source.resource); }
			}, this.sources.rows);
			row.setAttribute('aria-label', source.resource.fsPath || source.resource.toString());
			if (source.image) { row.firstElementChild!.replaceWith($('img.openide-agent-window-source-thumb', { alt: '', src: source.image })); }
		}
		this.more(this.sources, sources.length, () => this.renderSources());
	}

	override dispose(): void { this.disposed = true; super.dispose(); }
}
