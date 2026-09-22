/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { basename, extUriBiasedIgnorePathCase, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IResourceMultiDiffEditorInput } from '../../../common/editor.js';
import { ISCMResource, ISCMService } from '../../scm/common/scm.js';
import { IOpenideTurnFile } from '../common/openideCliTurnChanges.js';
import { t } from '../common/openideStrings.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IAgentWindowChangeStats, sumAgentWindowChangeStats } from './openideAgentWindowChangeStats.js';
import { OpenideAgentWindowActivity } from './openideAgentWindowActivity.js';
import { createContextRow, createContextSection } from './openideAgentWindowContextControls.js';
import { OpenideAgentWindowEnvironment, resolveAgentWindowEnvironment } from './openideAgentWindowEnvironment.js';
import { IOpenideReviewDiffService } from './openideReviewDiffService.js';
import { countDiff } from '../common/openideDiffPreview.js';
import { IOpenideReviewFile } from './openideChangesEditor.js';
import { OpenideAgentWindowGit } from './openideAgentWindowGit.js';
import { IOpenideCliChangesService, OpenideCliChangesService } from './openideCliChangesService.js';
import { OpenideAgentWindowContextTabs } from './openideAgentWindowContextTabs.js';

interface IAgentWindowContextActions {
	readonly review: (sessionId: string, files: readonly IOpenideReviewFile[], open: boolean) => void;
	readonly openSubagents?: () => void;
	readonly openTerminal: (instanceId?: number) => void;
	readonly createTerminal: (cwd: URI) => void | Promise<void>;
	readonly openFiles: (resource?: URI) => void;
	readonly openProject: () => void;
	readonly addSource?: () => void;
	readonly openResource: (resource: URI) => void;
	readonly openChanges: (path?: string, resource?: ISCMResource) => void;
	readonly openComparison: (input: IResourceMultiDiffEditorInput) => Promise<void>;
	readonly openBrowser?: (url: string) => void;
	readonly openCliChanges: (sessionId: string, file: IOpenideTurnFile) => void;
}

interface ContextChange extends IOpenideReviewFile {
	readonly path: string;
	readonly label: string;
	added?: number;
	removed?: number;
	binary?: boolean;
	readonly open: () => void;
}

/** Coordinates native context sections around the selected conversation. */
export class OpenideAgentWindowContext extends Disposable {
	private	readonly repositoryStore = this._register(new DisposableStore());
	private	readonly changesSummary: HTMLButtonElement;
	private entries: ContextChange[] = [];
	private entriesSessionId: string | undefined;
	private receipts: ReturnType<OpenideChatWidget['sessionStore']['changesOf']> | undefined;
	private statsRequest: CancellationTokenSource | undefined;
	private readonly statsCache = new Map<string, IAgentWindowChangeStats>();
	private readonly statsResources = new Set<string>();
	private readonly panels: OpenideAgentWindowContextTabs;
	private readonly changeProvenance: HTMLElement;
	private readonly changeList: HTMLElement;
	private readonly changeRows = this._register(new DisposableMap<string, { element: HTMLElement; label: HTMLElement; stats: HTMLElement; dispose(): void }>());
	private readonly changesTotals: HTMLElement;
	private sessionId: string | undefined;
	private	readonly branch: HTMLButtonElement;
	private	readonly commit: HTMLButtonElement;
	private	readonly compare: HTMLButtonElement;
	private	readonly environment: OpenideAgentWindowEnvironment;

	private readonly changesRefresh = this._register(new RunOnceScheduler(() => {
		this.statsCache.clear(); this.renderChanges();
	}, 100));

	constructor(
		parent: HTMLElement,
		private	readonly source: OpenideChatWidget,
		private	readonly actions: IAgentWindowContextActions,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ISCMService private	readonly scmService: ISCMService,
		@IWorkspaceContextService private	readonly workspaceService: IWorkspaceContextService,
		@IHoverService private	readonly hoverService: IHoverService,
		@IOpenideCliChangesService private	readonly cliChanges: OpenideCliChangesService,
		@IInstantiationService instantiation: IInstantiationService,
		@ITextModelService _textModels: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IOpenideReviewDiffService private readonly diffs: IOpenideReviewDiffService,
	) {
		super();
		this.panels = this._register(new OpenideAgentWindowContextTabs(parent));
		const contextPanel = this.panels.panel('context');
		const changesPanel = this.panels.panel('changes');
		const environment = createContextSection(contextPanel, t('agentWindow.environment'), this._store, hoverService);
		this.environment = this._register(instantiation.createInstance(OpenideAgentWindowEnvironment, environment,
			() => source.sessionStore.metaOf(source.sessionStore.activeSessionId()),
			{ openFiles: actions.openFiles, openTerminal: actions.createTerminal, openProject: actions.openProject }));
		const git = this._register(instantiation.createInstance(OpenideAgentWindowGit, parent,
			{ getRepository: () => this.selectedRepository(), openComparison: actions.openComparison }));
		this.branch = this.row(environment, t('agentWindow.branch'), 'git-branch', () => { void git.showBranches(); });
		append(this.branch, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
		const changes = append(changesPanel, $('.openide-agent-window-changes'));
		const heading = append(changes, $('.openide-agent-window-changes-heading'));
		this.changesSummary = this.row(heading, t('openide.changes'), 'diff', () => this.openReview());
		this.changesSummary.classList.add('openide-agent-window-review-summary');
		this.changesTotals = append(this.changesSummary, $('span.openide-agent-window-row-meta.openide-agent-window-changes-totals'));
		this.changeProvenance = append(changes, $('.openide-conversation-changes-provenance'));
		this.changeList = append(changes, $('.openide-conversation-changes-files.show-file-icons'));

		this.commit = this.row(environment, t('agentWindow.commit'), 'git-commit', () => git.showCommit());
		this.compare = this.row(environment, t('agentWindow.compare'), 'git-compare', () => { void git.showCompare(); });
		this._register(instantiation.createInstance(OpenideAgentWindowActivity, contextPanel, source, {
			openTerminal: actions.openTerminal, addSource: actions.addSource, openResource: actions.openResource, openBrowser: actions.openBrowser, openSubagents: actions.openSubagents,
			processesParent: this.panels.panel('terminals')
		}));
		const refresh = this._register(new RunOnceScheduler(() => this.refresh(), 100));
		this._register(source.sessionStore.onDidChange(() => refresh.schedule()));
		this._register(source.onDidChangeNavigation(() => refresh.schedule()));
		this._register(this.cliChanges.onDidChange(id => { if (id === this.source.sessionStore.activeSessionId()) { this.changesRefresh.schedule(); } }));
		this._register(agentService.onDidChangeFileDiff(() => this.changesRefresh.schedule()));
		const modelListeners = this._register(new DisposableMap<ITextModel, DisposableStore>());
		const watchModel = (model: ITextModel) => {
			const listeners = new DisposableStore();
			listeners.add(model.onDidChangeContent(() => { if (this.statsResources.has(extUriBiasedIgnorePathCase.getComparisonKey(model.uri))) { this.changesRefresh.schedule(); } }));
			listeners.add(model.onWillDispose(() => modelListeners.deleteAndDispose(model)));
			modelListeners.set(model, listeners);
		};
		for (const model of modelService.getModels()) { watchModel(model); }
		this._register(modelService.onModelAdded(watchModel));
		this._register(scmService.onDidAddRepository(() => this.refresh()));
		this._register(scmService.onDidRemoveRepository(() => this.refresh()));
		this._register(workspaceService.onDidChangeWorkspaceFolders(() => this.refresh()));
		this.refresh();
	}

	private row(parent: HTMLElement, label: string, icon: string, action: () => void): HTMLButtonElement {
		return createContextRow(parent, label, icon, action, this._store, this.hoverService);
	}

	private selectedRepository() {
		return resolveAgentWindowEnvironment(this.source.sessionStore.metaOf(this.source.sessionStore.activeSessionId()),
			this.workspaceService.getWorkspace().folders, [...this.scmService.repositories]).repository;
	}

	private openReview(): void {
		// The selected session can change before a debounced repaint. Always open the owner
		// of the files actually displayed, including for a reused row of the same workspace file.
		if (this.entriesSessionId) { this.actions.review(this.entriesSessionId, this.entries, true); }
	}

	private refresh(): void {
		this.changesRefresh.cancel();
		const id = this.source.sessionStore.activeSessionId();
		this.panels.setSession(id);
		if (this.sessionId !== id) {
			this.sessionId = id;
			this.statsCache.clear();
		}
		this.environment.refresh();
		this.repositoryStore.clear();
		const repository = this.selectedRepository();
		for (const row of [this.branch, this.commit, this.compare]) { row.hidden = !repository || repository.provider.providerId !== 'git'; }
		if (repository) {
			this.repositoryStore.add(autorun(reader => {
				const label = repository.provider.historyProvider.read(reader)?.historyItemRef.read(reader)?.name ?? repository.provider.label;
				this.branch.querySelector('.openide-agent-window-row-label')!.textContent = label;
				this.branch.setAttribute('aria-label', label);
			}));
			this.repositoryStore.add(repository.provider.onDidChangeResources(() => this.changesRefresh.schedule()));
			this.repositoryStore.add(repository.provider.onDidChangeResourceGroups(() => this.changesRefresh.schedule()));
		}
		this.renderChanges();
	}

	private renderChanges(): void {
		this.statsRequest?.dispose(true);
		const request = this.statsRequest = new CancellationTokenSource();
		const selectedId = this.source.sessionStore.activeSessionId();
		this.entriesSessionId = selectedId;
		const selected = this.source.sessionStore.metaOf(selectedId);
		this.changeProvenance.textContent = t(selected?.kind === 'cli' ? 'conversationWorkspace.observed' : 'conversationWorkspace.recorded');
		this.statsResources.clear();
		const pending: (() => Promise<void>)[] = [];
		if (selected?.kind === 'cli') {
			const tracked = this.cliChanges.sessions().find(entry => entry.sessionId === selected.id);
			this.entries = (tracked?.files ?? []).map(file => {
				const entry: ContextChange = { resource: joinPath(URI.file(tracked?.cwd ?? selected.cwd ?? ''), file.path), deleted: file.status === 'deleted', baseline: async () => { const baseline = this.cliChanges.baselineOf(selected.id, file.path); if (!baseline) { throw new Error('Baseline unavailable'); } return baseline.content; }, path: file.path, label: file.path.split(/[\\/]/).pop() || file.path, open: () => this.actions.openCliChanges(selected.id, file) };
				const key = `cli:${selected.id}:${file.path}`;
				const cached = this.statsCache.get(key);
				if (cached) { Object.assign(entry, cached); }
				else { pending.push(async () => { const stats = await this.cliChanges.preview(selected.id, file); if (!request.token.isCancellationRequested && stats) { entry.added = stats.added; entry.removed = stats.removed; this.statsCache.set(key, { added: stats.added, removed: stats.removed }); } }); }
				return entry;
			});
		} else {
			const root = selected?.cwd ? URI.file(selected.cwd) : this.selectedRepository()?.provider.rootUri ?? this.workspaceService.getWorkspace().folders[0]?.uri;
			const receipts = this.source.sessionStore.changesOf(selectedId);
			if (receipts !== this.receipts) { this.receipts = receipts; this.statsCache.clear(); }
			const resolve = (path: string) => path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) ? URI.file(path) : /^[a-zA-Z][\w+.-]*:/.test(path) ? URI.parse(path) : root ? joinPath(root, path) : URI.file(path);
			const pendingFiles = new Map((selectedId ? this.agentService.pendingFileDiffs(selectedId) : []).map(file => [extUriBiasedIgnorePathCase.getComparisonKey(resolve(file.path)), file]));
			this.entries = receipts.map(file => {
				const original = resolve(file.uri);
				const pendingFile = pendingFiles.get(extUriBiasedIgnorePathCase.getComparisonKey(original));
				// Keep current, exclusively owned edits editable. Historical/shared-file receipts
				// compare immutable states, so subsequent edits in another chat never leak in.
				const live = pendingFile && this.agentService.reviewBaseline(pendingFile.path) === file.before;
				const resource = live ? original : URI.from({ scheme: 'inmemory', path: original.path, query: JSON.stringify(['openide-chat-review', selectedId, file.id]) });
				const entry: ContextChange = { resource, modifiedContent: live ? undefined : file.after, pendingPath: live ? pendingFile.path : undefined, deleted: file.deleted, baseline: async () => file.before,
					path: file.uri.includes('://') ? original.fsPath : file.uri, label: basename(original),
					open: () => this.actions.openResource(original) };
				const cached = this.statsCache.get(file.id);
				if (cached) { Object.assign(entry, cached); }
				else { pending.push(async () => {
					// Worker-backed diff; at most four comparisons run concurrently.
					const model = this.modelService.createModel(file.after, null);
					const diff = this.diffs.acquire(model, file.before);
					try {
						const result = await diff.object.compute(request.token);
						if (result && !request.token.isCancellationRequested) {
							const stats = countDiff(file.before, file.after, result.changes);
							Object.assign(entry, stats); this.statsCache.set(file.id, stats);
						}
					} finally { diff.dispose(); model.dispose(); }
				}); }
				return entry;
			});
		}
		const dirty: (() => Promise<void>)[] = [];
		// Dirty buffers take precedence over disk/SCM counts for both harness and CLI conversations.
		for (const entry of this.entries) {
			if (entry.modifiedContent !== undefined) { continue; }
			this.statsResources.add(extUriBiasedIgnorePathCase.getComparisonKey(entry.resource));
			const model = this.modelService.getModel?.(entry.resource);
			if (model && !entry.deleted) {
				dirty.push(async () => {
					const baseline = await entry.baseline();
					if (request.token.isCancellationRequested || model.isDisposed()) { return; }
					const diff = this.diffs.acquire(model, baseline);
					try {
						const result = await diff.object.compute(request.token);
						if (result && !request.token.isCancellationRequested && !model.isDisposed() && model.getVersionId() === result.version) {
							Object.assign(entry, countDiff(baseline, model.getValue(), result.changes));
						}
					} finally { diff.dispose(); }
				});
			}
		}
		this.changesSummary.setAttribute('aria-busy', String(pending.length > 0));
		// Bound resolver pressure for large repositories; stale sessions never repaint the new list.
		const work = async () => {
			while (pending.length && !request.token.isCancellationRequested) {
				try { await pending.shift()!(); } catch { /* Unavailable/binary comparisons retain unknown counts. */ }
			}
		};
		void Promise.all(Array.from({ length: Math.min(4, pending.length) }, work)).then(async () => {
			// Do not materialize a baseline model for every dirty file at once.
			const refreshDirty = async () => {
				while (dirty.length && !request.token.isCancellationRequested) { await dirty.shift()!().catch(() => {}); }
			};
			await Promise.all(Array.from({ length: Math.min(4, dirty.length) }, refreshDirty));
			if (request.token.isCancellationRequested || this.statsRequest !== request || selectedId !== this.source.sessionStore.activeSessionId()) { return; }
			this.changesSummary.setAttribute('aria-busy', 'false');
			this.actions.review(selectedId ?? '', this.entries, false);
			this.renderTotals();
		});
		const label = t('openide.changes');
		this.changesSummary.querySelector('.openide-agent-window-row-label')!.textContent = label;
		this.changesSummary.setAttribute('aria-label', label);
		this.changesSummary.disabled = !this.entries.length;
		this.actions.review(selectedId ?? '', this.entries, false);
		this.renderTotals();
	}

	private renderTotals(): void {
		const current = new Set(this.entries.map(entry => entry.resource.toString()));
		for (const [key] of this.changeRows) { if (!current.has(key)) { this.changeRows.deleteAndDispose(key); } }
		let anchor = this.changeList.firstChild;
		for (const file of this.entries) {
			const key = file.resource.toString();
			let entry = this.changeRows.get(key);
			if (!entry) {
				const store = new DisposableStore();
				const row = createContextRow(this.changeList, file.label, 'file', () => this.openReview(), store, this.hoverService);
				const icon = row.querySelector<HTMLElement>('.codicon-file')!;
				icon.className = `openide-agent-window-change-icon ${getIconClasses(this.modelService, this.languageService, URI.file('/' + file.label), FileKind.FILE).join(' ')}`;
				const stats = append(row, $('span.openide-agent-window-row-meta'));
				entry = { element: row, label: row.querySelector<HTMLElement>('.openide-agent-window-row-label')!, stats, dispose: () => { store.dispose(); row.remove(); } };
				this.changeRows.set(key, entry);
			}
			entry.label.textContent = file.label;
			entry.element.setAttribute('aria-label', file.path);
			clearNode(entry.stats);
			if (file.added !== undefined) { append(entry.stats, $('span.openide-agent-window-changes-added', undefined, `+${file.added}`)); }
			if (file.removed !== undefined) { append(entry.stats, $('span.openide-agent-window-changes-removed', undefined, `−${file.removed}`)); }
			if (entry.element !== anchor) { this.changeList.insertBefore(entry.element, anchor); }
			anchor = entry.element.nextSibling;
		}
		this.changeProvenance.hidden = !this.entries.length;
		clearNode(this.changesTotals);
		const stats = sumAgentWindowChangeStats(this.entries);
		if (!this.entries.length || !stats) { return; }
		append(this.changesTotals, $('span.openide-agent-window-changes-added', undefined, `+${stats.added}`));
		append(this.changesTotals, $('span.openide-agent-window-changes-removed', undefined, `−${stats.removed}`));
		this.changesSummary.setAttribute('aria-label', `${t('agentWindow.changesCount', this.entries.length)}, +${stats.added}, −${stats.removed}`);
	}

	override dispose(): void { this.statsRequest?.dispose(true); super.dispose(); }

}
