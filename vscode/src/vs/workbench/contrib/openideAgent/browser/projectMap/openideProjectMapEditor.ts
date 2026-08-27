/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Project Map: a NATIVE EditorPane (no webview). It is the codebase's memory seen as
 *  a graph: the same nodes, edges and communities the agent's tools use, painted on a canvas
 *  (openideProjectMapCanvas.ts) with workbench DOM panels on top — search and breadcrumbs,
 *  modules (one colour, one community; click to isolate), a node inspector showing its real
 *  relations, and the minimap. It used to live in a webview with a layered layout that stacked
 *  files into rows; the layout is now communities + forces (`layoutGraph`), deterministic and
 *  computed in the host.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, getWindow } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILayoutNode, layoutGraph } from '../../../../../code/common/openideCodebaseGraphLayout.js';
import { ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../../../../../code/common/openideCodebaseMemoryTypes.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { FileKind } from '../../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { createFileIconThemableTreeContainerScope } from '../../../files/browser/views/explorerView.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { IArchitectureItem, IGraphRelations, IGraphView, IOpenideCodebaseGraphService } from '../openideCodebaseGraphService.js';
import { ICodebaseMemoryService } from '../openideCodebaseMemoryService.js';
import { OpenideMemoryInput } from '../openideMemoryInput.js';
import { applyOpenideSurfaceCss } from '../openideSurfaceStyle.js';
import { IProjectMapNode, OpenideProjectMapCanvas, projectMapColorFor } from './openideProjectMapCanvas.js';
import { OpenideProjectMapCard, projectMapIcon } from './openideProjectMapCard.js';
import { isOpenideStringKey, OpenideStringKey, t } from '../../common/openideStrings.js';
import './media/openideProjectMap.css';

/**
 * The verb each edge reads as. It used to be a Spanish-only literal map in this file, which put an
 * English IDE's Project Map half in Spanish; the dictionary carries both languages.
 */
function relationLabel(type: ICodebaseMemoryEdge['type']): string {
	const key = `projectMap.rel.${type}` as OpenideStringKey;
	return isOpenideStringKey(key) ? t(key) : type.toLowerCase();
}

const MODULES_COLLAPSED_KEY = 'openide.projectMap.modulesCollapsed';
const SCOPE_COLLAPSED_KEY = 'openide.projectMap.scopeCollapsed';
const INSPECTOR_COLLAPSED_KEY = 'openide.projectMap.inspectorCollapsed';

const icon = projectMapIcon;

export class OpenideProjectMapEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideMemory';

	private root!: HTMLElement;
	private canvasHost!: HTMLElement;
	private map!: OpenideProjectMapCanvas;
	private search!: HTMLInputElement;
	private searchClear!: HTMLButtonElement;
	private results!: HTMLElement;
	private resultsScroll!: DomScrollableElement;
	private crumbs!: HTMLElement;
	private status!: HTMLElement;
	private statusIcon!: HTMLElement;
	private modulesList!: HTMLElement;
	private modulesScroll!: DomScrollableElement;
	private modulesCount!: HTMLElement;
	private inspector!: HTMLElement;
	private inspIcon!: HTMLElement;
	private inspTitle!: HTMLElement;
	private inspPath!: HTMLElement;
	private inspModule!: HTMLElement;
	private inspRelations!: HTMLElement;
	private inspScroll!: DomScrollableElement;
	private inspAgent!: HTMLElement;
	private empty!: HTMLElement;

	private currentPath = '';
	private hidden = new Set<string>();
	private graphSerial = 0;
	private searchSerial = 0;
	private relationsSerial = 0;
	private readonly askCts = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly hovers = this._register(new DisposableStore());
	/** The "Path copied" flash; replacing it cancels the pending revert of the previous click. */
	private readonly copyFeedback = this._register(new MutableDisposable());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IOpenideCodebaseGraphService private readonly graphService: IOpenideCodebaseGraphService,
		@ICodebaseMemoryService private readonly memoryService: ICodebaseMemoryService,
		@IEditorService private readonly editorService: IEditorService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		super(OpenideProjectMapEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.memoryService.onProgress(progress => {
			if (progress.phase === 'idle' || progress.phase === 'cancelled') { return; }
			const phase = progress.phase === 'walking'
				? t('projectMap.walking', progress.processed, progress.total)
				: t('projectMap.indexing', progress.processed, progress.total);
			this.setStatus(`${phase}${progress.current ? ' · ' + progress.current : ''}`, true);
		}));
		this._register(this.memoryService.onDidChange(() => void this.loadGraph()));
		this._register(themeService.onDidColorThemeChange(() => this.applyThemeColors()));
	}

	private maxVisibleNodes(): number {
		const value = Number(this.configurationService.getValue('openide.memory.visualization.maxVisibleNodes'));
		return Number.isFinite(value) && value > 0 ? value : 300;
	}

	private maxRelationDepth(): number {
		const value = Number(this.configurationService.getValue('openide.memory.visualization.maxRelationDepth'));
		return Number.isFinite(value) && value > 0 ? value : 2;
	}

	protected createEditor(parent: HTMLElement): void {
		applyOpenideSurfaceCss();
		this.root = append(parent, $('.openide-pmap'));
		// Opts into the user's file icon theme, the way the Explorer does: without this scope
		// `getIconClasses` resolves to nothing and the inspector's file icon is a blank box.
		this._register(createFileIconThemableTreeContainerScope(this.root, this.themeService));
		this.canvasHost = append(this.root, $('.openide-pmap-stage'));

		// ---- top-left: search is the head of its card, scope + status are its body.
		// The field stays visible when the card is collapsed because it is the point of the panel;
		// what folds away is the breadcrumb and the index status, which is the chrome that was
		// taking a third of the pane's top-left corner while saying "Loading the map…".
		const topLeft = append(this.root, $('.openide-pmap-panel.top.left'));
		const searchCard = this._register(new OpenideProjectMapCard(topLeft, {
			className: 'openide-pmap-search',
			storageKey: SCOPE_COLLAPSED_KEY,
			collapseTitle: t('projectMap.scope.collapse'),
			expandTitle: t('projectMap.scope.expand'),
		}, this.storageService));
		const searchWrap = searchCard.head;
		searchWrap.classList.add('openide-pmap-search-wrap');
		searchWrap.insertBefore(icon(Codicon.search), searchWrap.firstChild);
		this.search = searchCard.addHeadAction($('input.openide-pmap-search-input', { type: 'search', placeholder: t('projectMap.search.placeholder'), spellcheck: 'false', 'aria-label': t('projectMap.search.aria') }) as HTMLInputElement);
		this.searchClear = searchCard.addHeadAction($('button.openide-pmap-iconbtn.hidden', { type: 'button', title: t('projectMap.search.clear') }) as HTMLButtonElement);
		append(this.searchClear, icon(Codicon.close));
		this._register(addDisposableListener(this.search, 'input', () => this.onSearchInput()));
		this._register(addDisposableListener(this.search, 'keydown', event => { if (event.key === 'Escape') { this.clearSearch(); } }));
		this._register(addDisposableListener(this.searchClear, 'click', () => this.clearSearch()));
		// Results live OUTSIDE the collapsible body: typing has to answer even on a folded card.
		this.results = $('.openide-pmap-results');
		this.resultsScroll = this._register(new DomScrollableElement(this.results, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false, verticalScrollbarSize: 8 }));
		this.resultsScroll.getDomNode().classList.add('openide-pmap-results-scroll', 'hidden');
		searchCard.card.appendChild(this.resultsScroll.getDomNode());
		this.crumbs = append(searchCard.body, $('.openide-pmap-crumbs'));
		const statusRow = append(searchCard.body, $('.openide-pmap-status'));
		this.statusIcon = append(statusRow, icon(Codicon.check));
		this.status = append(statusRow, $('span.openide-pmap-status-text', undefined, t('projectMap.loading')));
		const refresh = append(statusRow, $('button.openide-pmap-iconbtn', { type: 'button', title: t('projectMap.rebuild') })) as HTMLButtonElement;
		append(refresh, icon(Codicon.refresh));
		this._register(addDisposableListener(refresh, 'click', () => void this.rebuild()));

		// ---- top-right: modules
		const topRight = append(this.root, $('.openide-pmap-panel.top.right'));
		const modulesCard = this._register(new OpenideProjectMapCard(topRight, {
			className: 'openide-pmap-modules',
			icon: Codicon.layers,
			title: t('projectMap.modules'),
			storageKey: MODULES_COLLAPSED_KEY,
			collapseTitle: t('projectMap.modules.collapse'),
			expandTitle: t('projectMap.modules.expand'),
		}, this.storageService));
		this.modulesCount = modulesCard.addHeadAction($('span.openide-pmap-count'));
		const all = modulesCard.addHeadAction($('button.openide-pmap-link', { type: 'button', title: t('projectMap.modules.showAll') }, t('projectMap.modules.all')) as HTMLButtonElement);
		this._register(addDisposableListener(all, 'click', () => { this.hidden.clear(); this.applyHidden(); }));
		this.modulesList = $('.openide-pmap-modules-list');
		this.modulesScroll = this._register(new DomScrollableElement(this.modulesList, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(modulesCard.body, this.modulesScroll.getDomNode());
		// Folding one card changes how much height the OTHER one may use (the 26vh rule below), so a
		// toggle has to re-measure both scrollers, not just the one that moved.
		this._register(modulesCard.onDidToggle(() => this.rescanScrollers()));

		// ---- inspector (below modules)
		const inspectorCard = this._register(new OpenideProjectMapCard(topRight, {
			className: 'openide-pmap-inspector',
			storageKey: INSPECTOR_COLLAPSED_KEY,
			collapseTitle: t('projectMap.inspector.collapse'),
			expandTitle: t('projectMap.inspector.expand'),
		}, this.storageService));
		this.inspector = inspectorCard.card;
		this.inspector.classList.add('hidden');
		// The head carries the file's own icon from the user's icon theme, not a generic glyph: the
		// node is a file, and every other list of files in the IDE marks it that way.
		this.inspIcon = inspectorCard.head.appendChild($('span.openide-pmap-insp-icon'));
		inspectorCard.head.insertBefore(this.inspIcon, inspectorCard.head.firstChild);
		this.inspTitle = inspectorCard.head.insertBefore($('span.openide-pmap-insp-title'), inspectorCard.headActions);
		const inspClose = inspectorCard.addHeadAction($('button.openide-pmap-iconbtn', { type: 'button', title: t('projectMap.inspector.close') }) as HTMLButtonElement);
		append(inspClose, icon(Codicon.close));
		this._register(addDisposableListener(inspClose, 'click', () => this.map.select(undefined)));
		const inspBody = $('.openide-pmap-insp-body');
		this.inspPath = append(inspBody, $('.openide-pmap-insp-path'));
		this.inspModule = append(inspBody, $('.openide-pmap-insp-module'));
		const actions = append(inspBody, $('.openide-pmap-insp-actions'));
		const open = append(actions, $('button.openide-pmap-btn.primary', { type: 'button' }, t('projectMap.open'))) as HTMLButtonElement;
		const copy = append(actions, $('button.openide-pmap-btn', { type: 'button' }, t('projectMap.copyPath'))) as HTMLButtonElement;
		const ask = append(actions, $('button.openide-pmap-btn', { type: 'button' }, t('projectMap.ask'))) as HTMLButtonElement;
		this._register(addDisposableListener(open, 'click', () => void this.openSelected()));
		this._register(addDisposableListener(copy, 'click', () => this.copyPath(copy)));
		this._register(addDisposableListener(ask, 'click', () => this.askAgent()));
		this.inspAgent = append(inspBody, $('.openide-pmap-insp-agent.hidden'));
		this.inspRelations = append(inspBody, $('.openide-pmap-insp-relations'));
		this.inspScroll = this._register(new DomScrollableElement(inspBody, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(inspectorCard.body, this.inspScroll.getDomNode());
		this._register(inspectorCard.onDidToggle(() => this.rescanScrollers()));

		// ---- abajo-derecha: minimapa + zoom
		const bottomRight = append(this.root, $('.openide-pmap-panel.bottom.right'));
		const minimap = append(bottomRight, $('.openide-pmap-card.openide-pmap-minimap'));
		const zoom = append(bottomRight, $('.openide-pmap-card.openide-pmap-zoom'));
		const zoomIn = append(zoom, $('button.openide-pmap-iconbtn', { type: 'button', title: t('projectMap.zoomIn') })) as HTMLButtonElement;
		append(zoomIn, icon(Codicon.add));
		const zoomOut = append(zoom, $('button.openide-pmap-iconbtn', { type: 'button', title: t('projectMap.zoomOut') })) as HTMLButtonElement;
		append(zoomOut, icon(Codicon.dash));
		const fit = append(zoom, $('button.openide-pmap-iconbtn', { type: 'button', title: t('projectMap.fit') })) as HTMLButtonElement;
		append(fit, icon(Codicon.screenFull));
		// Escape anywhere over the map drops the selection, so the inspector can be dismissed without
		// aiming at its close button.
		this._register(addDisposableListener(this.root, 'keydown', event => {
			if (event.key === 'Escape' && event.target !== this.search && this.map.selected) {
				this.map.select(undefined);
			}
		}));

		this.empty = append(this.root, $('.openide-pmap-empty.hidden'));

		this.map = this._register(new OpenideProjectMapCanvas(this.canvasHost, minimap));
		this._register(addDisposableListener(zoomIn, 'click', () => this.map.zoomBy(1.35)));
		this._register(addDisposableListener(zoomOut, 'click', () => this.map.zoomBy(1 / 1.35)));
		this._register(addDisposableListener(fit, 'click', () => this.map.fit()));
		this._register(this.map.onDidSelect(node => void this.renderInspector(node)));
		this.applyThemeColors();
	}

	override async setInput(input: OpenideMemoryInput, options: undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }
		await this.loadGraph();
	}

	override layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
		this.map.layout(dimension.width, dimension.height);
		this.rescanScrollers();
	}

	/**
	 * Re-measures every card's scroller. A DomScrollableElement only learns its viewport shrank when
	 * it is told, and these cards resize each other: opening a node halves the modules list, folding
	 * one gives the height back. Without this the slider keeps the size it had and the rows past the
	 * clip are unreachable.
	 */
	private rescanScrollers(): void {
		this.modulesScroll.scanDomNode();
		this.inspScroll.scanDomNode();
		this.resultsScroll.scanDomNode();
	}

	override focus(): void {
		super.focus();
		this.search.focus();
	}

	// ---- datos

	private setStatus(text: string, busy: boolean, error = false): void {
		this.status.textContent = text;
		this.statusIcon.className = ThemeIcon.asClassName(busy ? ThemeIcon.modify(Codicon.loading, 'spin') : error ? Codicon.warning : Codicon.check);
		this.status.parentElement?.classList.toggle('busy', busy);
		this.status.parentElement?.classList.toggle('error', error);
	}

	private async loadGraph(): Promise<void> {
		const serial = ++this.graphSerial;
		this.setStatus(t('projectMap.loading'), true);
		try {
			const [view, scope] = await Promise.all([
				this.graphService.getGraphView(this.currentPath, this.maxVisibleNodes()),
				this.graphService.getArchitecture(this.currentPath, 1).catch(() => undefined),
			]);
			if (serial !== this.graphSerial) { return; }
			// Logical world sized in proportion to the graph: 300 nodes need more canvas than 40 for
			// the clusters not to overlap; the "fit" zoom brings it back into the pane.
			const side = Math.max(900, Math.round(Math.sqrt(view.nodes.length) * 95));
			const world = { width: side * 1.35, height: side };
			const layout: ILayoutNode[] = layoutGraph(view.nodes, world.width, world.height, view.edges).nodes;
			this.map.setGraph(view, layout, world);
			this.renderModules(view);
			this.renderCrumbs(scope?.breadcrumbs ?? []);
			this.empty.classList.toggle('hidden', view.nodes.length > 0);
			if (!view.nodes.length) {
				clearNode(this.empty);
				append(this.empty, icon(Codicon.map));
				append(this.empty, $('p', undefined, t('projectMap.empty')));
				const build = append(this.empty, $('button.openide-pmap-btn.primary', { type: 'button' }, t('projectMap.build'))) as HTMLButtonElement;
				this._register(addDisposableListener(build, 'click', () => void this.rebuild()));
			}
			const truncated = view.truncated ? t('projectMap.status.truncated', view.truncated) : '';
			this.setStatus(`${t('projectMap.status.counts', view.nodes.length, view.edges.length, view.modules.length)}${truncated}`, false);
		} catch (error) {
			if (serial !== this.graphSerial) { return; }
			this.setStatus(error instanceof Error ? error.message : String(error), false, true);
		}
	}

	private async rebuild(): Promise<void> {
		this.setStatus(t('projectMap.rebuilding'), true);
		try {
			await this.memoryService.rebuildFull();
			await this.loadGraph();
		} catch (error) {
			this.setStatus(error instanceof Error ? error.message : String(error), false, true);
		}
	}

	private applyThemeColors(): void {
		const style = getWindow(this.root).getComputedStyle(this.root);
		const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
		this.map.setColors({
			bg: read('--vscode-editor-background', '#1e1e1e'),
			fg: read('--vscode-editor-foreground', read('--vscode-foreground', '#cccccc')),
			muted: read('--vscode-descriptionForeground', '#8b8b8b'),
			dot: 'rgba(128, 128, 128, 0.16)',
		});
	}

	// ---- modules

	private renderModules(view: IGraphView): void {
		clearNode(this.modulesList);
		this.modulesCount.textContent = String(view.modules.length);
		view.modules.forEach((module, index) => {
			const row = append(this.modulesList, $('button.openide-pmap-module', { type: 'button', title: t('projectMap.module.tip', module.label, module.count) })) as HTMLButtonElement;
			row.dataset.module = module.label;
			const swatch = append(row, $('span.openide-pmap-swatch'));
			swatch.style.background = projectMapColorFor(index);
			append(row, $('span.openide-pmap-module-name', undefined, module.label));
			append(row, $('span.openide-pmap-module-count', undefined, String(module.count)));
			this._register(addDisposableListener(row, 'click', event => {
				// Click: isolate (hides the rest). With Ctrl/Cmd: toggle just this module.
				if (event.ctrlKey || event.metaKey) {
					if (this.hidden.has(module.label)) { this.hidden.delete(module.label); } else { this.hidden.add(module.label); }
				} else if (this.hidden.size === view.modules.length - 1 && !this.hidden.has(module.label)) {
					this.hidden.clear();
				} else {
					this.hidden = new Set(view.modules.map(other => other.label).filter(label => label !== module.label));
				}
				this.applyHidden();
			}));
		});
		this.applyHidden();
	}

	private applyHidden(): void {
		this.map.setHiddenModules(this.hidden);
		for (const row of Array.from(this.modulesList.children) as HTMLElement[]) {
			row.classList.toggle('hidden-module', this.hidden.has(row.dataset.module ?? ''));
		}
		this.modulesScroll.scanDomNode();
	}

	private renderCrumbs(items: readonly IArchitectureItem[]): void {
		clearNode(this.crumbs);
		const root = append(this.crumbs, $('button.openide-pmap-crumb', { type: 'button' }, t('projectMap.root'))) as HTMLButtonElement;
		this._register(addDisposableListener(root, 'click', () => { this.currentPath = ''; void this.loadGraph(); }));
		for (const item of items) {
			append(this.crumbs, icon(Codicon.chevronRight));
			const crumb = append(this.crumbs, $('button.openide-pmap-crumb', { type: 'button' }, item.name)) as HTMLButtonElement;
			this._register(addDisposableListener(crumb, 'click', () => { this.currentPath = item.path ?? ''; void this.loadGraph(); }));
		}
	}

	// ---- search

	private clearSearch(): void {
		this.search.value = '';
		this.onSearchInput();
	}

	private onSearchInput(): void {
		const query = this.search.value.trim();
		this.searchClear.classList.toggle('hidden', !query);
		const serial = ++this.searchSerial;
		if (!query) {
			this.resultsScroll.getDomNode().classList.add('hidden');
			clearNode(this.results);
			this.map.setHighlight(undefined);
			return;
		}
		// First what is already on screen (instant), then the full index.
		const local = this.map.nodes.filter(node => node.name.toLowerCase().includes(query.toLowerCase()) || node.path.toLowerCase().includes(query.toLowerCase()));
		this.map.setHighlight(local.map(node => node.id));
		void this.graphService.search(query, 30).then(hits => {
			if (serial !== this.searchSerial) { return; }
			this.renderResults(hits, local);
		}).catch(() => { if (serial === this.searchSerial) { this.renderResults([], local); } });
	}

	private renderResults(hits: readonly ICodebaseMemoryNode[], local: readonly IProjectMapNode[]): void {
		clearNode(this.results);
		this.resultsScroll.getDomNode().classList.remove('hidden');
		const seen = new Set<string>();
		const rows: { name: string; detail: string; kind: ThemeIcon; run: () => void }[] = [];
		for (const node of local.slice(0, 8)) {
			seen.add(node.id);
			rows.push({ name: node.name, detail: node.path, kind: Codicon.symbolFile, run: () => this.map.focusNode(node.id) });
		}
		for (const hit of hits) {
			if (seen.has(hit.id) || rows.length >= 14) { continue; }
			seen.add(hit.id);
			const onMap = this.map.getNode(hit.id);
			rows.push({
				name: hit.name,
				detail: this.relPath(hit.uri) + (hit.range ? `:${hit.range.startLine}` : ''),
				kind: hit.kind === 'file' ? Codicon.symbolFile : hit.kind === 'module' || hit.kind === 'folder' ? Codicon.layers : Codicon.symbolMethod,
				run: () => onMap ? this.map.focusNode(hit.id) : void this.openUri(hit.uri, hit.range?.startLine),
			});
		}
		if (!rows.length) {
			append(this.results, $('.openide-pmap-result-empty', undefined, t('projectMap.noResults')));
			this.resultsScroll.scanDomNode();
			return;
		}
		for (const row of rows) {
			const button = append(this.results, $('button.openide-pmap-result', { type: 'button' })) as HTMLButtonElement;
			append(button, icon(row.kind));
			append(button, $('span.openide-pmap-result-name', undefined, row.name));
			append(button, $('span.openide-pmap-result-detail', undefined, row.detail));
			this._register(addDisposableListener(button, 'click', () => row.run()));
		}
		this.resultsScroll.scanDomNode();
	}

	// ---- inspector

	private async renderInspector(node: IProjectMapNode | undefined): Promise<void> {
		this.hovers.clear();
		this.askCts.value = undefined;
		this.inspAgent.classList.add('hidden');
		clearNode(this.inspAgent);
		if (!node) {
			this.inspector.classList.add('hidden');
			// Closing it hands its height back to the modules list.
			this.rescanScrollers();
			return;
		}
		this.inspector.classList.remove('hidden');
		this.inspTitle.textContent = node.name;
		this.inspTitle.title = node.path;
		// The file's own icon, from whatever icon theme the user runs — same call the Explorer and
		// the Agent Changes list make, so a node reads as the file it is.
		this.inspIcon.className = 'openide-pmap-insp-icon';
		const resource = node.uri.includes('://') ? URI.parse(node.uri) : this.resolveWorkspacePath(node.path);
		if (resource) {
			this.inspIcon.classList.add(...getIconClasses(this.modelService, this.languageService, resource, FileKind.FILE));
		}
		this.inspPath.textContent = node.path;
		clearNode(this.inspModule);
		const swatch = append(this.inspModule, $('span.openide-pmap-swatch'));
		swatch.style.background = node.color;
		append(this.inspModule, $('span', undefined, node.community));
		const degree = node.degree === 1 ? t('projectMap.connections.one') : t('projectMap.connections', node.degree);
		append(this.inspModule, $('span.openide-pmap-count', undefined, node.godRank ? `${degree} · ${t('projectMap.godRank', node.godRank)}` : degree));
		clearNode(this.inspRelations);
		append(this.inspRelations, $('.openide-pmap-insp-section', undefined, t('projectMap.relationsLoading')));
		// The card just appeared, which took height away from the modules list above it.
		this.rescanScrollers();

		const serial = ++this.relationsSerial;
		try {
			const groups = await this.graphService.getRelations([node.id], this.maxRelationDepth(), 100, 'both');
			if (serial !== this.relationsSerial) { return; }
			this.renderRelations(node, groups);
		} catch (error) {
			if (serial !== this.relationsSerial) { return; }
			clearNode(this.inspRelations);
			append(this.inspRelations, $('.openide-pmap-insp-section.error', undefined, error instanceof Error ? error.message : String(error)));
		}
		this.inspScroll.scanDomNode();
	}

	private renderRelations(node: IProjectMapNode, groups: readonly IGraphRelations[]): void {
		clearNode(this.inspRelations);
		const outgoing: { edge: ICodebaseMemoryEdge; node: ICodebaseMemoryNode }[] = [];
		const incoming: { edge: ICodebaseMemoryEdge; node: ICodebaseMemoryNode }[] = [];
		const seen = new Set<string>();
		let defined = 0;
		for (const group of groups) {
			for (const relation of group.relations) {
				const key = `${relation.edge.source}→${relation.edge.target}:${relation.edge.type}`;
				if (seen.has(key)) { continue; }
				seen.add(key);
				// What a file CONTAINS is not a relation to another file: it is summarised in one
				// line. Without this filter a hundred of its own symbols buried the real imports.
				if (relation.edge.type === 'CONTAINS' || relation.edge.type === 'DEFINES') { defined++; continue; }
				(relation.edge.source === group.target.id ? outgoing : incoming).push(relation);
			}
		}
		const total = outgoing.length + incoming.length;
		append(this.inspRelations, $('.openide-pmap-insp-section', undefined, t('projectMap.relations', total)));
		if (defined) {
			append(this.inspRelations, $('.openide-pmap-insp-subsection', undefined, (defined === 1 ? t('projectMap.defines.one') : t('projectMap.defines.many', defined))));
		}
		if (!total) {
			append(this.inspRelations, $('.openide-pmap-result-empty', undefined, t('projectMap.noRelations')));
			return;
		}
		const renderGroup = (title: string, arrow: ThemeIcon, items: readonly { edge: ICodebaseMemoryEdge; node: ICodebaseMemoryNode }[]) => {
			if (!items.length) { return; }
			append(this.inspRelations, $('.openide-pmap-insp-subsection', undefined, `${title} · ${items.length}`));
			for (const { edge, node: other } of items.slice(0, 60)) {
				const row = append(this.inspRelations, $('button.openide-pmap-relation', { type: 'button' })) as HTMLButtonElement;
				append(row, icon(arrow));
				append(row, $('span.openide-pmap-relation-name', undefined, other.name || this.relPath(other.uri)));
				append(row, $('span.openide-pmap-relation-kind', undefined, relationLabel(edge.type)));
				this.hovers.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), row, `${this.relPath(other.uri)}${other.range ? ':' + other.range.startLine : ''} · ${other.kind}`));
				this._register(addDisposableListener(row, 'click', () => {
					if (this.map.getNode(other.id)) { this.map.focusNode(other.id); } else { void this.openUri(other.uri, other.range?.startLine); }
				}));
			}
		};
		renderGroup(t('projectMap.outgoing'), Codicon.arrowRight, outgoing);
		renderGroup(t('projectMap.incoming'), Codicon.arrowLeft, incoming);
	}

	/**
	 * Copying is silent by nature, so the button says it did: the label flips for a moment. Without
	 * it the only way to know the click landed is to paste somewhere.
	 */
	private copyPath(button: HTMLButtonElement): void {
		const node = this.map.selected;
		if (!node) { return; }
		void this.clipboardService.writeText(node.path);
		button.textContent = t('projectMap.copied');
		button.classList.add('done');
		const handle = setTimeout(() => {
			button.textContent = t('projectMap.copyPath');
			button.classList.remove('done');
		}, 1400);
		this.copyFeedback.value = toDisposable(() => clearTimeout(handle));
	}

	private askAgent(): void {
		const node = this.map.selected;
		if (!node) { return; }
		const prompt = t('projectMap.analyzePrompt', node.name, node.path);
		const cts = new CancellationTokenSource();
		this.askCts.value = cts;
		clearNode(this.inspAgent);
		this.inspAgent.classList.remove('hidden');
		const head = append(this.inspAgent, $('.openide-pmap-insp-subsection'));
		append(head, icon(ThemeIcon.modify(Codicon.loading, 'spin')));
		append(head, $('span', undefined, t('projectMap.analyzing')));
		const body = append(this.inspAgent, $('.openide-pmap-insp-agent-text'));
		void this.agentService.runAgent(prompt, event => {
			if (cts.token.isCancellationRequested) { return; }
			if (event.type === 'text') { body.textContent += event.delta; this.inspScroll.scanDomNode(); }
		}, cts.token).then(() => {
			if (cts.token.isCancellationRequested) { return; }
			clearNode(head);
			append(head, icon(Codicon.sparkle));
			append(head, $('span', undefined, t('projectMap.analysis')));
		}).catch(error => {
			if (cts.token.isCancellationRequested) { return; }
			clearNode(head);
			append(head, icon(Codicon.warning));
			append(head, $('span', undefined, error instanceof Error ? error.message : String(error)));
		}).finally(() => { if (this.askCts.value === cts) { this.askCts.value = undefined; } this.inspScroll.scanDomNode(); });
	}

	private async openSelected(): Promise<void> {
		const node = this.map.selected;
		if (node) { await this.openUri(node.uri); }
	}

	private async openUri(uri: string, line?: number): Promise<void> {
		const resource = uri.includes('://') ? URI.parse(uri) : this.resolveWorkspacePath(uri);
		if (!resource) { return; }
		await this.editorService.openEditor({ resource, options: { selection: { startLineNumber: line && line > 0 ? line : 1, startColumn: 1 } } });
	}

	private resolveWorkspacePath(path: string): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder && path ? URI.joinPath(folder.uri, path) : undefined;
	}

	private relPath(uri: string): string {
		try {
			const parsed = URI.parse(uri);
			for (const folder of this.contextService.getWorkspace().folders) {
				const base = folder.uri.path.endsWith('/') ? folder.uri.path : folder.uri.path + '/';
				if (parsed.path.startsWith(base)) { return parsed.path.slice(base.length); }
			}
			return parsed.path;
		} catch {
			return uri;
		}
	}
}
