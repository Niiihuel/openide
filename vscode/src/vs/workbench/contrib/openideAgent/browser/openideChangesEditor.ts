/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { t } from './../common/openideStrings.js';
import { $, addDisposableListener, append, clearNode, Dimension, getWindow } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableMap, DisposableStore, IReference } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ICodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorOptions as ICodeEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ICodeEditorViewState } from '../../../../editor/common/editorCommon.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ResourceLabels, DEFAULT_LABELS_CONTAINER } from '../../../browser/labels.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IOpenideReviewDiffService, IOpenideReviewDiffResult } from './openideReviewDiffService.js';
import { paintOpenideReviewChanges } from './openideEditReview.js';
import { openideButtonStyles, openideSearchBoxStyles } from './openideControlStyles.js';
import { OpenideEmptyState } from '../../../browser/openideEmptyState.js';
import { OpenideChangesNavigator } from './openideChangesNavigator.js';
import { setupChatTooltip } from './chat/openideChatHover.js';
import { IOpenideReviewComment, reviewDiffContext } from '../common/openideReviewComment.js';

export interface IOpenideReviewFile {
	readonly resource: URI;
	readonly path: string;
	readonly added?: number;
	readonly removed?: number;
	readonly deleted?: boolean;
	/** Exact pending snapshot key, only present for this conversation's live exclusive edit. */
	readonly pendingPath?: string;
	/** Immutable after-state for a conversation receipt; live CLI reviews omit it. */
	readonly modifiedContent?: string;
	/** Resolves the conversation's baseline, never another conversation's snapshot. */
	readonly baseline: () => Promise<string>;
	readonly open: () => void;
}

/** Model references belong to the input, so docking, collapsing and virtualizing never lose edits. */
export class OpenideChangesInput extends EditorInput {
	static readonly ID = 'openide.changes';
	override get typeId(): string { return OpenideChangesInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'openide-changes', path: `/${this.sessionId}` }); }
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeFiles = this.changed.event;
	private readonly statsChanged = this._register(new Emitter<void>());
	readonly onDidChangeStats = this.statsChanged.event;
	private readonly acceptanceChanged = this._register(new Emitter<void>());
	readonly onDidChangeAcceptance = this.acceptanceChanged.event;
	private acceptanceAvailable = false;
	private readonly references = new Map<string, Promise<IReference<IResolvedTextEditorModel>>>();
	private readonly baselines = new Map<string, Promise<string>>();
	private readonly owned = this._register(new DisposableStore());
	private dead = false;
	readonly expandedFiles = new Set<string>();
	readonly collapsedFolders = new Set<string>();
	readonly fullContextFiles = new Set<string>();
	filterText = '';
	readonly editorStates = new Map<string, ICodeEditorViewState>();
	stageComment: ((comment: IOpenideReviewComment) => boolean) | undefined;
	acceptChanges: { canAccept(): boolean; run(): Promise<void> } | undefined;
	constructor(readonly sessionId: string, public files: readonly IOpenideReviewFile[],
		@ITextModelService private readonly models: ITextModelService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IWorkingCopyEditorService workingCopies: IWorkingCopyEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languages: ILanguageService,
	) {
		super();
		this.files = files.map(file => ({ ...file }));
		// The review owns these dirty files. The native tracker must not open duplicate
		// file tabs behind it; normal file handlers still own recovery from disk backups.
		this._register(workingCopies.registerHandler({
			handles: () => false,
			isOpen: (copy, editor) => editor === this && this.references.has(copy.resource.toString()),
			createEditor: () => this,
		}));
		this._register(textFiles.files.onDidChangeDirty(model => { if (this.references.has(model.resource.toString())) { this._onDidChangeDirty.fire(); } }));
	}
	refreshAcceptance(): void {
		const available = !!this.acceptChanges?.canAccept();
		if (this.acceptanceAvailable !== available) { this.acceptanceAvailable = available; this.acceptanceChanged.fire(); }
	}
	override getName(): string { return t('openide.changes'); }
	override getIcon() { return Codicon.diff; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof OpenideChangesInput && other.sessionId === this.sessionId; }
	update(files: readonly IOpenideReviewFile[]): void {
		const changed = this.files.length !== files.length || this.files.some((file, index) => {
			const next = files[index];
			return file.resource.toString() !== next.resource.toString() || file.deleted !== next.deleted || file.modifiedContent !== next.modifiedContent || file.pendingPath !== next.pendingPath;
		});
		const statsChanged = this.files.map(f => `${f.added}:${f.removed}`).join() !== files.map(f => `${f.added}:${f.removed}`).join();
		for (const file of files) {
			if (file.modifiedContent !== undefined) {
				const model = this.modelService.getModel(file.resource);
				if (model && model.getValue() !== file.modifiedContent) { model.setValue(file.modifiedContent); }
			}
		}
		this.baselines.clear();
		this.files = files.map(file => ({ ...file }));
		const present = new Set(files.map(file => file.resource.toString()));
		for (const key of this.expandedFiles) { if (!present.has(key)) { this.expandedFiles.delete(key); this.fullContextFiles.delete(key); this.editorStates.delete(key); } }
		if (changed) { this.changed.fire(); } else if (statsChanged) { this.statsChanged.fire(); }
	}
	async resolveFile(file: IOpenideReviewFile): Promise<{ reference?: IReference<IResolvedTextEditorModel>; baseline: string }> {
		const key = file.resource.toString();
		let baseline = this.baselines.get(key);
		if (!baseline) { baseline = file.baseline().catch(error => { this.baselines.delete(key); throw error; }); this.baselines.set(key, baseline); }
		if (file.deleted) { return { baseline: await baseline }; }
		let reference = this.references.get(key);
		if (!reference) {
			if (file.modifiedContent !== undefined && !this.modelService.getModel(file.resource)) {
				this.modelService.createModel(file.modifiedContent, this.languages.createByFilepathOrFirstLine(file.resource), file.resource);
			}
			reference = this.models.createModelReference(file.resource).then(ref => {
				if (this.dead) { ref.dispose(); throw new Error('Review closed'); }
				this.owned.add(ref); return ref;
			}).catch(error => { this.references.delete(key); throw error; });
			this.references.set(key, reference);
		}
		const [ref, before] = await Promise.all([reference, baseline]);
		return { reference: ref, baseline: before };
	}
	async comparison(file: IOpenideReviewFile): Promise<{ original: URI; modified: URI }> {
		const { baseline } = await this.resolveFile(file);
		const snapshot = async (side: string, content: string) => {
			const resource = URI.from({ scheme: 'inmemory', path: file.resource.path, query: JSON.stringify([this.sessionId, file.resource.toString(), side]) });
			if (!this.modelService.getModel(resource)) {
				this.modelService.createModel(content, this.languages.createByFilepathOrFirstLine(file.resource), resource);
				// Resolver references keep snapshots alive when the comparison outlives Changes.
				this.owned.add(await this.models.createModelReference(resource));
			}
			return resource;
		};
		return { original: await snapshot('before', baseline), modified: file.deleted ? await snapshot('after', '') : file.resource };
	}
	override isDirty(): boolean { return [...this.references.keys()].some(key => this.textFiles.isDirty(URI.parse(key))); }
	override async save(): Promise<EditorInput | undefined> {
		for (const key of this.references.keys()) { const uri = URI.parse(key); if (this.textFiles.isDirty(uri) && !await this.textFiles.save(uri)) { return undefined; } }
		return this;
	}
	override async revert(): Promise<void> { for (const key of this.references.keys()) { if (this.textFiles.isDirty(URI.parse(key))) { await this.textFiles.revert(URI.parse(key)); } } }
	override dispose(): void { this.dead = true; super.dispose(); }
}

/** All changed files, using our inline review paint and full native editor contributions. */
interface IReviewRow {
	readonly element: HTMLElement;
	readonly deleted: boolean | undefined;
	update(file: IOpenideReviewFile): void;
	dispose(): void;
}

export class OpenideChangesEditor extends EditorPane {
	static readonly ID = 'workbench.editor.openideChanges';
	private root!: HTMLElement;
	private list!: HTMLElement;
	private scroll!: DomScrollableElement;
	private filter!: InputBox;
	private summary!: HTMLElement;
	private acceptButton!: Button;
	private accepting = false;
	private focused: ICodeEditor | undefined;
	private readonly content = this._register(new DisposableStore());
	private readonly rows = this._register(new DisposableMap<string, IReviewRow>());
	private readonly empty = this._register(new DisposableStore());
	private renderedInput: OpenideChangesInput | undefined;
	private labels: ResourceLabels | undefined;
	private readonly binding = this._register(new DisposableStore());
	private body!: HTMLElement;
	private navigator!: OpenideChangesNavigator;
	private navigationButton!: HTMLButtonElement;
	private showNavigation: boolean | undefined;
	private narrow = false;
	private dimension: Dimension | undefined;
	private readonly summaryStore = this._register(new DisposableStore());
	private readonly statsElements = new Map<string, { added: HTMLElement; removed: HTMLElement }>();
	private readonly revealFiles = new Map<string, () => void>();
	constructor(group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IHoverService private readonly hovers: IHoverService,
		@IEditorService private readonly editors: IEditorService,
		@IOpenideReviewDiffService private readonly diffs: IOpenideReviewDiffService,
	) { super(OpenideChangesEditor.ID, group, telemetry, theme, storage); }
	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-changes-editor.openide-chat-native.show-file-icons'));
		const toolbar = append(this.root, $('.openide-changes-toolbar'));
		this.summary = append(toolbar, $('.openide-changes-summary'));
		this.acceptButton = this._register(new Button(append(toolbar, $('.openide-changes-save')), { ...openideButtonStyles, secondary: true, small: true }));
		this.acceptButton.label = t('conversationWorkspace.acceptAll');
		this._register(setupChatTooltip(this.hovers, this.acceptButton.element, () => t('conversationWorkspace.acceptAllHint'), { aria: false }));
		this.acceptButton.enabled = false;
		this._register(this.acceptButton.onDidClick(async () => {
			if (!(this.input instanceof OpenideChangesInput) || this.accepting || !this.input.acceptChanges?.canAccept()) { return; }
			this.accepting = true; this.updateAcceptButton();
			try { await this.input.acceptChanges.run(); } catch (error) { this.showError(error); }
			finally { this.accepting = false; this.updateAcceptButton(); }
		}));
		this.filter = this._register(new InputBox(append(toolbar, $('.openide-changes-filter')), undefined, { placeholder: t('openide.review.filter'), ariaLabel: t('openide.review.filter'), inputBoxStyles: openideSearchBoxStyles }));
		const toolbarAction = (icon: string, label: string, run: () => void): HTMLButtonElement => {
			const button = append(toolbar, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button', 'aria-label': label }));
			append(button, $('span.codicon.codicon-' + icon, { 'aria-hidden': 'true' }));
			this._register(setupChatTooltip(this.hovers, button, () => label));
			this._register(addDisposableListener(button, 'click', run)); return button;
		};
		toolbarAction('collapse-all', t('openide.review.collapseAll'), () => {
			if (this.input instanceof OpenideChangesInput) { this.input.expandedFiles.clear(); this.render(); }
		});
		toolbarAction('expand-all', t('openide.review.expandAll'), () => {
			if (this.input instanceof OpenideChangesInput) { for (const file of this.matchingFiles(this.input)) { this.input.expandedFiles.add(file.resource.toString()); } this.render(); }
		});
		this.navigationButton = toolbarAction('folder', t('openide.review.navigation'), () => {
			this.showNavigation = !(this.showNavigation ?? !this.narrow); this.layoutNavigation();
		});
		const filterNode = this.filter.element.parentElement!;
		filterNode.classList.add('openide-changes-search');
		append(filterNode, $('span.codicon.codicon-search', { 'aria-hidden': 'true' }));
		const clear = append(filterNode, $('button.openide-chat-head-btn.oi-dock-action.openide-changes-clear', { type: 'button', 'aria-label': t('openide.review.clear') }));
		append(clear, $('span.codicon.codicon-close', { 'aria-hidden': 'true' })); clear.hidden = true;
		this._register(setupChatTooltip(this.hovers, clear, () => t('openide.review.clear')));
		this._register(addDisposableListener(clear, 'click', () => { this.filter.value = ''; this.filter.focus(); }));
		this._register(addDisposableListener(this.filter.inputElement, 'keydown', event => { if (event.key === 'Escape' && this.filter.value) { event.stopPropagation(); this.filter.value = ''; } }));
		this.body = append(this.root, $('.openide-changes-body'));
		this.list = $('.openide-changes-files');
		this.scroll = this._register(new DomScrollableElement(this.list, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false, verticalScrollbarSize: 10 }));
		const scrollNode = append(this.body, this.scroll.getDomNode()); scrollNode.classList.add('openide-changes-scroll');
		this.navigator = this._register(this.instantiation.createInstance(OpenideChangesNavigator, this.body, file => {
			if (this.narrow) { this.showNavigation = false; this.layoutNavigation(); }
			this.revealFiles.get(file.resource.toString())?.();
		}));
		const filterUpdate = this._register(new RunOnceScheduler(() => { this.render(); this.scroll.setScrollPosition({ scrollTop: 0 }); }, 100));
		this._register(this.filter.onDidChange(() => {
			clear.hidden = !this.filter.value;
			if (this.input instanceof OpenideChangesInput) { this.input.filterText = this.filter.value; }
			filterUpdate.schedule();
		}));
		const resize = new (getWindow(this.root).ResizeObserver)(() => this.navigator.layout());
		resize.observe(this.body); this._register({ dispose: () => resize.disconnect() });
	}
	override async setInput(input: OpenideChangesInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }
		this.binding.clear(); this.filter.value = input.filterText;
		this.binding.add(input.onDidChangeAcceptance(() => this.updateAcceptButton()));
		this.binding.add(input.onDidChangeDirty(() => this.updateAcceptButton()));
		this.updateAcceptButton();
		let filesChanged = false;
		const refresh = this.binding.add(new RunOnceScheduler(() => {
			if (filesChanged) { filesChanged = false; this.render(); }
			else { this.updateStats(input); }
		}, 50));
		this.binding.add(input.onDidChangeFiles(() => { filesChanged = true; refresh.schedule(); }));
		this.binding.add(input.onDidChangeStats(() => refresh.schedule()));
		this.render();
	}
	private updateStats(input: OpenideChangesInput): void {
		this.updateAcceptButton();
		this.renderSummary(input, this.matchingFiles(input)); this.navigator.updateStats(input.files);
		for (const file of input.files) {
			const stats = this.statsElements.get(file.resource.toString());
			if (stats) {
				const added = file.added === undefined ? '' : `+${file.added}`;
				const removed = file.removed === undefined ? '' : `−${file.removed}`;
				if (stats.added.textContent !== added) { stats.added.textContent = added; }
				if (stats.removed.textContent !== removed) { stats.removed.textContent = removed; }
			}
		}
	}
	private updateAcceptButton(): void { this.acceptButton.enabled = !this.accepting && this.input instanceof OpenideChangesInput && !!this.input.acceptChanges?.canAccept(); }
	private showError(error: unknown): void { this.summary.textContent = String(error); }
	private matchingFiles(input: OpenideChangesInput): readonly IOpenideReviewFile[] {
		const terms = this.filter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
		return input.files.filter(file => terms.every(term => file.path.replace(/\\/g, '/').toLocaleLowerCase().includes(term)));
	}
	private layoutNavigation(): void {
		const visible = this.showNavigation ?? !this.narrow;
		this.body.classList.toggle('show-navigation', visible); this.body.classList.toggle('narrow', this.narrow);
		if (this.navigationButton.getAttribute('aria-pressed') !== String(visible)) {
			this.navigationButton.setAttribute('aria-pressed', String(visible));
			this.navigationButton.querySelector('.codicon')!.className = `codicon codicon-${visible ? 'folder-opened' : 'folder'}`;
		}
		this.navigator.layout(); this.scroll.scanDomNode();
	}
	private renderSummary(input: OpenideChangesInput, files: readonly IOpenideReviewFile[]): void {
		this.summaryStore.clear();
		this.summary.textContent = this.filter.value.trim() ? t('openide.review.filtered', files.length, input.files.length) : t('openide.review.files', input.files.length);
		const counted = files.filter(file => file.added !== undefined && file.removed !== undefined);
		if (counted.length) {
			const totals = append(this.summary, $('.openide-agent-window-changes-totals'));
			if (counted.length < files.length) {
				totals.setAttribute('aria-label', t('openide.review.partialTotals', counted.length, files.length));
				this.summaryStore.add(setupChatTooltip(this.hovers, totals, () => totals.getAttribute('aria-label')!));
			}
			append(totals, $('span.openide-agent-window-changes-added', undefined, `+${counted.reduce((sum, file) => sum + file.added!, 0).toLocaleString()}`));
			append(totals, $('span.openide-agent-window-changes-removed', undefined, `−${counted.reduce((sum, file) => sum + file.removed!, 0).toLocaleString()}`));
			if (counted.length < files.length) { append(totals, $('span', undefined, t('openide.review.partial'))); }
		}
	}
	private render(): void {
		const input = this.input;
		if (!(input instanceof OpenideChangesInput)) { return; }
		if (this.renderedInput !== input) {
			this.rows.clearAndDisposeAll(); this.content.clear(); this.empty.clear(); clearNode(this.list);
			this.renderedInput = input;
			this.labels = this.content.add(this.instantiation.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		}
		const files = this.matchingFiles(input);
		const present = new Set(files.map(file => file.resource.toString()));
		for (const key of this.rows.keys()) { if (!present.has(key)) { this.rows.deleteAndDispose(key); } }
		this.empty.clear();
		this.navigator.setFiles(files, input.collapsedFolders, !!this.filter.value.trim());
		let previous: HTMLElement | undefined;
		for (const file of files) {
			const key = file.resource.toString();
			let row = this.rows.get(key);
			if (row && row.deleted !== file.deleted) { this.rows.deleteAndDispose(key); row = undefined; }
			if (!row) { row = this.createRow(input, file, this.labels!); this.rows.set(key, row); }
			row.update(file);
			const next = previous ? previous.nextSibling : this.list.firstChild;
			if (next !== row.element) { this.list.insertBefore(row.element, next); }
			previous = row.element;
		}
		this.updateStats(input);
		this.list.classList.toggle('is-empty', files.length === 0);
		if (!files.length) {
			const filtering = !!this.filter.value.trim();
			const empty = this.empty.add(this.instantiation.createInstance(OpenideEmptyState, this.list, {
				title: filtering ? t('openide.review.empty') : t('openide.review.noChanges'),
				description: filtering ? t('openide.review.emptyFilter') : t('openide.review.emptyDescription'),
				actions: filtering ? [{ label: t('openide.review.clear'), run: () => { this.filter.value = ''; this.filter.focus(); } }] : [],
			}));
			this.empty.add({ dispose: () => empty.domNode.remove() });
		}
		this.scroll.scanDomNode();
	}
	private createRow(input: OpenideChangesInput, file: IOpenideReviewFile, labels: ResourceLabels): IReviewRow {
		const win = getWindow(this.root);
		const key = file.resource.toString();
		const cardStore = new DisposableStore();
		const editorStore = cardStore.add(new DisposableStore());
		const card = $('section.openide-changes-file', { 'data-path': file.path });
		const heading = append(card, $('.openide-changes-file-heading'));
		const toggle = append(heading, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button', 'aria-label': t('openide.review.collapse', file.path), 'aria-expanded': String(input.expandedFiles.has(key)) }));
		append(toggle, $('span.codicon.codicon-chevron-down'));
		const toggleTooltip = cardStore.add(setupChatTooltip(this.hovers, toggle, () => t(input.expandedFiles.has(key) ? 'openide.review.collapse' : 'conversationWorkspace.expandFile', file.path)));
		const labelButton = append(heading, $('button.openide-changes-file-label', { type: 'button', 'aria-label': file.path }));
		const label = labels.create(labelButton);
		cardStore.add(label); label.setFile(file.resource, { hidePath: false });
		const stats = append(heading, $('.openide-agent-window-changes-totals'));
		const added = append(stats, $('span.openide-agent-window-changes-added', undefined, file.added === undefined ? '' : `+${file.added}`));
		const removed = append(stats, $('span.openide-agent-window-changes-removed', undefined, file.removed === undefined ? '' : `−${file.removed}`));
		this.statsElements.set(key, { added, removed });
		const full = append(heading, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button', 'aria-pressed': 'false' }));
		append(full, $('span.codicon.codicon-unfold'));
		const fullTooltip = cardStore.add(setupChatTooltip(this.hovers, full, () => t(input.fullContextFiles.has(key) ? 'conversationWorkspace.changesOnly' : 'openide.review.context')));
		const comparisonAction = (modal: boolean) => {
			const button = append(heading, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button' }));
			append(button, $(`span.codicon.codicon-${modal ? 'screen-full' : 'diff'}`, { 'aria-hidden': 'true' }));
			cardStore.add(setupChatTooltip(this.hovers, button, () => modal
				? t('openide.review.openComparisonModal')
				: t('openide.review.openComparison')));
			cardStore.add(addDisposableListener(button, 'click', () => {
				button.disabled = true;
				void (async () => {
					const { original, modified } = await input.comparison(file);
					if (cardStore.isDisposed) { return; }
					const pane = await this.editors.openEditor({
						original: { resource: original }, modified: { resource: modified },
						label: t('openide.review.beforeAfter', basename(file.resource)),
						options: { pinned: true, ...(modal ? { modal: { targetWindowId: win.vscodeWindowId, maximized: true } } : {}) },
					}, modal ? MODAL_GROUP : this.group);
					const control = pane?.getControl();
					if (isDiffEditor(control)) { control.updateOptions({ renderSideBySide: true, renderOverviewRuler: false }); }
				})().catch(onUnexpectedError).finally(() => { button.disabled = false; });
			}));
		};
		comparisonAction(false);
		comparisonAction(true);
		const open = append(heading, $('button.openide-chat-head-btn.oi-dock-action', { type: 'button' }));
		append(open, $('span.codicon.codicon-go-to-file'));
		cardStore.add(setupChatTooltip(this.hovers, open, () => t('openide.review.open')));
		cardStore.add(addDisposableListener(open, 'click', () => {
			if (file.deleted) { file.open(); }
			else { void this.editors.openEditor({ resource: file.resource, options: { pinned: true } }, this.group).catch(onUnexpectedError); }
		}));
		const host = append(card, $('.openide-changes-code'));
		host.style.height = '240px';
		let mounted = false, visible = false, expanded = input.expandedFiles.has(key), showAll = input.fullContextFiles.has(key), generation = 0;
		host.hidden = !expanded; card.classList.toggle('collapsed', !expanded); full.hidden = !expanded;
		full.setAttribute('aria-pressed', String(showAll));
		let editor: CodeEditorWidget | undefined;
		const stageFeedback = async (text: string): Promise<boolean> => {
			const { reference, baseline } = await input.resolveFile(file);
			const snapshot = reference?.object.textEditorModel.getValue() ?? '';
			const summary = await this.diffs.summarize(baseline, snapshot, CancellationToken.None, 120);
			if (cardStore.isDisposed) { return false; }
			const diffContext = summary ? reviewDiffContext(file.path, summary.lines, summary.added, summary.removed) : undefined;
			return input.stageComment?.({ path: file.path, text, diffContext }) ?? false;
		};
		const sendToChat = append(heading, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action', { type: 'button' }));
		append(sendToChat, $('span.codicon.codicon-mention', { 'aria-hidden': 'true' }));
		sendToChat.hidden = !input.stageComment;
		cardStore.add(setupChatTooltip(this.hovers, sendToChat, () => t('conversationWorkspace.sendToChat')));
		cardStore.add(addDisposableListener(sendToChat, 'click', () => {
			sendToChat.disabled = true;
			void stageFeedback(t('conversationWorkspace.reviewFilePrompt', file.path)).then(staged => {
				if (!staged && !cardStore.isDisposed) { this.showError(t('conversationWorkspace.fileUnavailable')); }
			}).catch(error => { if (!cardStore.isDisposed) { this.showError(error); } }).finally(() => { if (!cardStore.isDisposed) { sendToChat.disabled = false; } });
		}));
		let repaint: (() => void) | undefined;
		const unload = () => {
			generation++; mounted = false;
			if (editor) { const state = editor.saveViewState(); if (state) { input.editorStates.set(key, state); } }
			if (this.focused === editor) { this.focused = undefined; this._onDidChangeControl.fire(); }
			editorStore.clear(); editor = undefined; repaint = undefined; clearNode(host);
		};
		cardStore.add({ dispose: unload });
		const load = async () => {
			if (mounted || !expanded || !visible) { return; }
			mounted = true; const epoch = ++generation;
			try {
				const { reference, baseline } = await input.resolveFile(file);
				if (epoch !== generation || cardStore.isDisposed) { return; }
				if (!reference) {
					const deleted = append(host, $('pre.openide-review-deleted-zone', undefined, baseline));
					deleted.setAttribute('aria-label', t('openide.review.deleted', basename(file.resource))); return;
				}
				const options = (): ICodeEditorOptions => ({ ...this.configuration.getValue<ICodeEditorOptions>('editor'), readOnly: file.modifiedContent !== undefined, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: false, overviewRulerLanes: 0, scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, alwaysConsumeMouseWheel: false }, fixedOverflowWidgets: true });
				editor = editorStore.add(this.instantiation.createInstance(CodeEditorWidget, host, options(), {}));
				const live = editor;
				live.setModel(reference.object.textEditorModel);
				editorStore.add(this.configuration.onDidChangeConfiguration(e => { if (e.affectsConfiguration('editor')) { live.updateOptions(options()); } }));
				editorStore.add(live.onDidFocusEditorText(() => { this.focused = live; this._onDidChangeControl.fire(); }));
				const decorations = live.createDecorationsCollection(); let zones: string[] = [];
				const original = baseline ? baseline.split(/\r\n|\r|\n/) : [];
				const paint = (result: IOpenideReviewDiffResult) => {
					const model = reference.object.textEditorModel;
					const changes = result.changes;
					zones = paintOpenideReviewChanges(live, decorations, changes, original, zones).zoneIds;
					added.textContent = `+${changes.reduce((sum, change) => sum + change.modified.length, 0)}`;
					removed.textContent = `−${changes.reduce((sum, change) => sum + change.original.length, 0)}`;
					const hidden: Range[] = []; let start = 1;
					if (!showAll && changes.length) {
						for (const change of changes) { const end = Math.max(1, change.modified.startLineNumber - 3); if (end > start) { hidden.push(new Range(start, 1, end - 1, 1)); } start = Math.max(start, change.modified.endLineNumberExclusive + 3); }
						if (start < model.getLineCount()) { hidden.push(new Range(start, 1, model.getLineCount(), 1)); }
					}
					live.setHiddenAreas(hidden);
					const height = Math.max(64, Math.min(480, live.getContentHeight()));
					host.style.height = `${height}px`; live.layout({ width: host.clientWidth, height }); this.scroll.scanDomNode();
				};
				const diff = editorStore.add(this.diffs.acquire(reference.object.textEditorModel, baseline));
				let request = 0;
				let painted: IOpenideReviewDiffResult | undefined;
				repaint = () => {
					const model = reference.object.textEditorModel;
					if (painted?.version === model.getVersionId()) { paint(painted); return; }
					const current = ++request;
					void diff.object.compute(CancellationToken.None).then(result => {
						if (!result || current !== request || epoch !== generation || model.isDisposed() || model.getVersionId() !== result.version) { return; }
						painted = result; paint(result);
					}).catch(onUnexpectedError);
				};
				const schedule = editorStore.add(new RunOnceScheduler(() => repaint?.(), 180));
				editorStore.add(live.onDidChangeModelContent(() => schedule.schedule()));
				const resize = new win.ResizeObserver(() => live.layout({ width: host.clientWidth, height: host.clientHeight }));
				resize.observe(host); editorStore.add({ dispose: () => resize.disconnect() });
				repaint(); const state = input.editorStates.get(key); if (state) { live.restoreViewState(state); }
			} catch {
				if (epoch === generation && !cardStore.isDisposed) { append(host, $('.openide-agent-window-empty', undefined, t('openide.review.unavailable'))); }
			}
		};
		const setExpanded = (value: boolean, scan = true) => {
			if (expanded === value) { return; }
			expanded = value;
			if (value) { input.expandedFiles.add(key); } else { input.expandedFiles.delete(key); }
			host.hidden = !value; full.hidden = !value; card.classList.toggle('collapsed', !value);
			toggle.setAttribute('aria-expanded', String(value)); toggleTooltip.update(); if (scan) { this.scroll.scanDomNode(); }
			if (value) { void load(); } else { unload(); }
		};
		this.revealFiles.set(key, () => { setExpanded(true); this.scroll.setScrollPosition({ scrollTop: card.offsetTop }); });
		cardStore.add(addDisposableListener(toggle, 'click', () => setExpanded(!expanded)));
		cardStore.add(addDisposableListener(labelButton, 'click', () => setExpanded(!expanded)));
		cardStore.add(addDisposableListener(full, 'click', () => { showAll = !showAll; if (showAll) { input.fullContextFiles.add(key); } else { input.fullContextFiles.delete(key); } full.setAttribute('aria-pressed', String(showAll)); fullTooltip.update(); repaint?.(); }));
		const observer = new win.IntersectionObserver(entries => {
			visible = entries[0].isIntersecting;
			if (visible) { void load(); } else if (!editor?.hasTextFocus()) { unload(); }
		}, { root: this.list, rootMargin: '400px' });
		observer.observe(card); cardStore.add({ dispose: () => observer.disconnect() });
		return {
			element: card, deleted: file.deleted,
			update: next => {
				file = next;
				setExpanded(input.expandedFiles.has(key), false);
			},
			dispose: () => {
				cardStore.dispose(); card.remove();
				this.revealFiles.delete(key); this.statsElements.delete(key);
			},
		};
	}
	override getControl(): ICodeEditor | undefined { return this.focused; }
	override focus(): void { if (this.focused) { this.focused.focus(); } else { this.filter.focus(); } }
	override clearInput(): void { this.binding.clear(); this.rows.clearAndDisposeAll(); this.content.clear(); this.empty.clear(); this.renderedInput = undefined; this.focused = undefined; super.clearInput(); }
	layout(dimension: Dimension): void {
		if (this.dimension?.width === dimension.width && this.dimension.height === dimension.height) { return; }
		this.dimension = dimension;
		this.root.style.height = `${dimension.height}px`; this.root.style.width = `${dimension.width}px`;
		this.narrow = dimension.width < 620;
		this.layoutNavigation();
	}
}
