/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the project's ARCHITECTURE MAP: the second visual of the same truth the Project Map
 *  draws as nodes. Same index, one level up: a module per box, an aggregated dependency per arrow.
 *
 *  DERIVED, never stored. There is no file behind this editor and there must not be one: the index
 *  already knows which modules exist and what they import, and a saved copy would start lying the
 *  moment somebody moves a folder. Archify makes an agent author that JSON and then verifies it
 *  against a pinned commit precisely BECAUSE it refuses to be a code indexer
 *  (docs/research-repo-evidence-passport-2026-07-23.md: "do not widen Archify into a code
 *  indexer"). We already have the indexer, so we generate what it makes people write.
 *
 *  STRUCTURE: the Project Map's. Canvas edge to edge, floating cards over it, no toolbar row.
 *
 *  READING: click a box and the panel becomes a NAVIGATION STACK — module, then a file of it, then
 *  a symbol of that file, each pushed with a back button carrying the previous title. That is what
 *  keeps the canvas clean while the detail stays concrete: the drawing answers "what is there", the
 *  stack answers "what is this and what touches it", and going back is one click instead of a lost
 *  train of thought.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileKind } from '../../../../../platform/files/common/files.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createFileIconThemableTreeContainerScope } from '../../../files/browser/views/explorerView.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICodebaseMemoryNode } from '../../../../../code/common/openideCodebaseMemoryTypes.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EntityRelationBucket, entityIconId, groupEntityRelations } from '../../common/diagrams/openideEntityRelations.js';
import { INodeMapSpec } from '../../common/diagrams/openideNodeMaps.js';
import { parseDiagramSource } from '../../common/diagrams/openideDiagramEngine.js';
import { leadingDocComment } from '../../common/diagrams/openideSourceDoc.js';
import { t } from '../../common/openideStrings.js';
import { IGraphView, IOpenideCodebaseGraphService } from '../openideCodebaseGraphService.js';
import { OpenideProjectMapCard, projectMapIcon } from '../projectMap/openideProjectMapCard.js';
import { buildProjectArchMapSource } from './openideArchMapFromProject.js';
import { INodeMapFocus, nodeMapColorFor, nodeMapKindLabel, renderNodeMapSvg } from './openideNodeMapDiagram.js';
import { liftTitlesToHover, OpenideDiagramStage } from './openideDiagramStage.js';
import { OpenideProjectViewSwitcher } from './openideMapSwitcher.js';
import './media/openideDiagrams.css';
import '../projectMap/media/openideProjectMap.css';

/** How much of the index the projection is allowed to look at. */
const MAX_NODES = 300;

/** The section title for each bucket of the index's relations. */
const BUCKET_LABEL: Record<EntityRelationBucket, string> = {
	defines: 'archmap.detail.defines',
	imports: 'archmap.detail.imports',
	importedBy: 'archmap.detail.importedBy',
	calls: 'archmap.detail.calls',
	usedBy: 'archmap.detail.usedBy',
	related: 'archmap.detail.related',
};

/**
 * One screen of the stack. A `module` is a box of the drawing; an `entity` is anything the index
 * knows — a file, a symbol — which is why the drill-down keeps working all the way down without a
 * new level type for every depth.
 */
type ILevel =
	| { readonly kind: 'module'; readonly id: string; readonly title: string }
	| { readonly kind: 'entity'; readonly id: string; readonly title: string };

export class OpenideArchMapEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideArchMap';

	private root!: HTMLElement;
	private stage!: OpenideDiagramStage;
	private switcher!: OpenideProjectViewSwitcher;
	private identityCount!: HTMLElement;
	private moduleList!: HTMLElement;
	private moduleScroll!: DomScrollableElement;
	private detail!: OpenideProjectMapCard;
	private detailBack!: HTMLButtonElement;
	private detailTitle!: HTMLElement;
	private detailBody!: HTMLElement;
	private detailScroll!: DomScrollableElement;

	/** Listeners that belong to the CURRENT picture; they die with the next derivation. */
	private readonly pictureDisposables = this._register(new DisposableStore());
	/** Listeners of the level on screen; a push replaces them. */
	private readonly levelDisposables = this._register(new DisposableStore());

	private view: IGraphView | undefined;
	private spec: INodeMapSpec | undefined;
	private mapFocus: INodeMapFocus | undefined;
	private stack: ILevel[] = [];
	/** Guards a slow read landing after the panel moved on. */
	private token = 0;
	private derivation = 0;
	/** Header comments, read once per picture and never written anywhere. */
	private readonly docs = new Map<string, string | undefined>();

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storage: IStorageService,
		@IHoverService private readonly hoverService: IHoverService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IOpenideCodebaseGraphService private readonly graphService: IOpenideCodebaseGraphService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		super(OpenideArchMapEditor.ID, group, telemetryService, themeService, storage);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-map-editor'));
		// Opts into the user's file icon theme, the way the Explorer and the Project Map do: without
		// this scope `getIconClasses` resolves to nothing and every file row shows a blank box.
		this._register(createFileIconThemableTreeContainerScope(this.root, this.themeService));
		this.stage = this._register(new OpenideDiagramStage(this.root, this.hoverService, { toolbar: false }));
		const host = this.stage.panelHost;
		host.classList.add('openide-map-stage');

		// ---- top left: which view this is, the way to the other one, and its modules
		//
		// It is a card of the family, so it FOLDS like the rest — chevron at the far right, where
		// every other card in the workbench keeps it. The view switcher is the TITLE: a title with a
		// chevron after it reads as a picker everywhere. Giving the switcher its own glyph at the
		// right was the mistake — two chevrons in one head, one folding and one opening a menu, is a
		// coin toss for whoever clicks.
		const topLeft = append(host, $('.openide-pmap-panel.top.left'));
		const identity = this._register(new OpenideProjectMapCard(topLeft, {
			className: 'openide-map-id',
			icon: Codicon.circuitBoard,
			storageKey: 'openide.archmap.modules.collapsed',
		}, this.storage));
		const card = identity.card;
		const switcher = identity.head.insertBefore($('button.openide-map-switch', { type: 'button' }) as HTMLButtonElement, identity.headActions);
		append(switcher, $('span.openide-map-switch-label', undefined, t('archmap.project.title')));
		append(switcher, projectMapIcon(Codicon.chevronDown)).classList.add('openide-map-switch-chevron');
		this.identityCount = identity.addHeadAction($('span.openide-pmap-count'));
		identity.addHeadAction(this.action(Codicon.refresh, t('archmap.refresh'), () => void this.derive()));
		this._register(identity.onDidToggle(() => this.rescan()));
		// Every scrolling surface in the IDE is a DomScrollableElement; a native overflow would put a
		// Chromium scrollbar — arrows, opaque track — in the middle of the workbench's own language.
		this.moduleList = $('.openide-map-list');
		this.moduleScroll = this._register(new DomScrollableElement(this.moduleList, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		this.moduleScroll.getDomNode().classList.add('openide-map-list-scroll');
		append(identity.body, this.moduleScroll.getDomNode());

		this.switcher = this._register(new OpenideProjectViewSwitcher(this.contextViewService, this.commandService));
		// Anchored to the whole CARD, not to the trigger: from the trigger the popover opened 4px
		// below it and landed ON TOP of the module list, leaving a sliver of the list showing between
		// two borders — one box wearing a doubled edge. Hanging off the card it starts below the
		// card's own bottom border, covers nothing, and matches its width.
		switcher.title = t('archmap.switcher.open');
		switcher.setAttribute('aria-label', t('archmap.switcher.open'));
		// Stops its own click: the head around it folds the card, and one gesture must do one thing.
		this._register(addDisposableListener(switcher, 'click', event => {
			event.stopPropagation();
			this.switcher.toggle(card, switcher);
		}));

		// ---- top right: the navigation stack
		const topRight = append(host, $('.openide-pmap-panel.top.right'));
		// Collapsible and REMEMBERED: the panel is tall, it sits over the drawing, and somebody who
		// folded it wants it folded — including for the next node they click and the next session.
		this.detail = this._register(new OpenideProjectMapCard(topRight, {
			className: 'openide-map-inspector',
			storageKey: 'openide.archmap.detail.collapsed',
		}, this.storage));
		this.detailBack = this.detail.head.insertBefore(
			$('button.openide-map-back', { type: 'button' }) as HTMLButtonElement,
			this.detail.headActions,
		);
		append(this.detailBack, projectMapIcon(Codicon.chevronLeft));
		append(this.detailBack, $('span.openide-map-back-label'));
		this._register(addDisposableListener(this.detailBack, 'click', event => {
			event.stopPropagation();
			this.pop();
		}));
		this.detailTitle = this.detail.head.insertBefore($('span.openide-pmap-card-title.openide-pmap-insp-title'), this.detail.headActions);
		this.detail.addHeadAction(this.action(Codicon.close, t('map.inspector.close'), () => this.reset(undefined)));
		this.detailBody = $('.openide-map-insp-body');
		this.detailScroll = this._register(new DomScrollableElement(this.detailBody, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(this.detail.body, this.detailScroll.getDomNode());
		// Folding the card changes the viewport its scroller measured; it only learns by being told.
		this._register(this.detail.onDidToggle(() => this.rescan()));
		this.detail.card.classList.add('hidden');

		// ---- bottom right: zoom, the Project Map's own stack
		const bottomRight = append(host, $('.openide-pmap-panel.bottom.right'));
		const zoom = append(bottomRight, $('.openide-pmap-card.openide-pmap-zoom'));
		append(zoom, this.action(Codicon.add, t('map.zoomIn'), () => this.stage.zoomBy(1.35)));
		append(zoom, this.action(Codicon.dash, t('map.zoomOut'), () => this.stage.zoomBy(1 / 1.35)));
		append(zoom, this.action(Codicon.screenFull, t('map.fit'), () => this.stage.fit()));
	}

	private action(icon: ThemeIcon, title: string, run: () => void): HTMLButtonElement {
		const button = $('button.openide-pmap-iconbtn', { type: 'button', title }) as HTMLButtonElement;
		append(button, projectMapIcon(icon));
		this._register(addDisposableListener(button, 'click', event => {
			// The card head is itself a trigger; a control inside it must not also fire it.
			event.stopPropagation();
			run();
		}));
		return button;
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.derive();
	}

	override clearInput(): void {
		this.derivation++;
		this.clearPicture();
		super.clearInput();
	}

	private clearPicture(): void {
		this.pictureDisposables.clear();
		this.levelDisposables.clear();
		this.docs.clear();
		this.view = undefined;
		this.spec = undefined;
		this.mapFocus = undefined;
		this.stack = [];
		this.stage.clear();
		clearNode(this.moduleList);
		this.detail.card.classList.add('hidden');
	}

	// ---- deriving the picture from the index

	private async derive(): Promise<void> {
		const derivation = ++this.derivation;
		const view = await this.graphService.getGraphView('', MAX_NODES);
		if (derivation !== this.derivation) {
			return;
		}
		this.clearPicture();
		const source = buildProjectArchMapSource(view, t('archmap.project.title'));
		if (!source) {
			this.showEmpty();
			return;
		}
		const result = parseDiagramSource(source);
		if (!result || result.family !== 'nodemap') {
			this.showEmpty();
			return;
		}
		this.view = view;
		this.spec = result.spec;

		const render = renderNodeMapSvg(this.root.ownerDocument, result.spec, result.layout);
		liftTitlesToHover(render.svg);
		// Inside the same `.openide-diagram` box the chat uses, so the --oid tokens and the focus
		// rules resolve exactly as they do in a transcript.
		const box = $('.openide-diagram');
		append(append(box, $('.openide-diagram-scroll')), render.svg);
		this.stage.setContent(box);
		this.mapFocus = render.focus;
		// A click on the drawing starts a NEW trail; the stack is a way of reading one box deeply,
		// not a history of everything that was ever clicked.
		render.focus.onDidSelect(id => this.reset(id ? { kind: 'module', id, title: this.moduleTitle(id) } : undefined));

		this.identityCount.textContent = `${result.spec.nodes.length} · ${result.spec.edges.length}`;
		this.identityCount.title = t('map.counts.nodes', result.spec.nodes.length, result.spec.edges.length);
		this.renderModuleList(result.spec);
	}

	/**
	 * Nothing to draw yet. The index is built in the background and on a cold workspace it simply
	 * has not run, so this is a normal state with the next step in it — not an error.
	 */
	private showEmpty(): void {
		this.identityCount.textContent = '';
		const panel = $('.openide-map-problems');
		append(panel, $('.openide-map-problems-title', undefined, t('archmap.empty.title')));
		append(panel, $('.openide-map-problems-hint', undefined, t('archmap.empty.hint')));
		const button = append(panel, $('button.openide-map-empty-action', { type: 'button' }, t('archmap.empty.action')));
		this.pictureDisposables.add(addDisposableListener(button, 'click', () => {
			void this.commandService.executeCommand('openide.memory.rebuild');
		}));
		this.stage.setOverlay(panel);
	}

	private moduleTitle(id: string): string {
		return this.spec?.nodes.find(node => node.id === id)?.label ?? id;
	}

	private renderModuleList(spec: INodeMapSpec): void {
		clearNode(this.moduleList);
		for (const node of spec.nodes) {
			const row = append(this.moduleList, $('button.openide-pmap-result.openide-map-row', { type: 'button' }));
			const dot = append(row, $('span.openide-map-dot'));
			dot.style.background = nodeMapColorFor(spec.type, node.kind);
			append(row, $('span.openide-pmap-result-name', undefined, node.label));
			append(row, $('span.openide-pmap-result-detail', undefined, node.sublabel ?? nodeMapKindLabel(spec.type, node.kind)));
			this.pictureDisposables.add(addDisposableListener(row, 'click', () => {
				this.mapFocus?.select(node.id);
				this.reset({ kind: 'module', id: node.id, title: node.label });
			}));
		}
		this.moduleScroll.scanDomNode();
	}

	/**
	 * Re-measures the scrollers. A DomScrollableElement only learns its viewport changed when it is
	 * told, and these panels resize with the pane and with each other: without this the slider keeps
	 * the size it had and the rows past the clip are unreachable.
	 */
	private rescan(): void {
		this.moduleScroll.scanDomNode();
		this.detailScroll.scanDomNode();
	}

	// ---- the navigation stack

	/** Starts a new trail (or closes the panel). Selecting elsewhere is not "going back". */
	private reset(level: ILevel | undefined): void {
		this.stack = level ? [level] : [];
		this.renderTop();
	}

	private push(level: ILevel): void {
		this.stack.push(level);
		this.renderTop();
	}

	private pop(): void {
		if (this.stack.length < 2) {
			return;
		}
		this.stack.pop();
		const top = this.stack[this.stack.length - 1];
		// Coming back to a module re-pins it, so the drawing and the panel never disagree.
		if (top.kind === 'module') {
			this.mapFocus?.select(top.id);
		}
		this.renderTop();
	}

	private renderTop(): void {
		this.levelDisposables.clear();
		const top = this.stack[this.stack.length - 1];
		if (!top) {
			this.detail.card.classList.add('hidden');
			this.mapFocus?.select(undefined);
			return;
		}
		this.detail.card.classList.remove('hidden');
		// Deliberately NOT re-expanded: forcing it open on every render undid the fold on the very
		// next click. Collapsed, the head still names what is selected, which is the point of a head.
		this.detailTitle.textContent = top.title;
		// Apple's rule: the back button carries the PREVIOUS title, so you know where it goes before
		// you press it. With nothing behind, there is no button.
		const previous = this.stack[this.stack.length - 2];
		this.detailBack.classList.toggle('hidden', !previous);
		if (previous) {
			this.detailBack.querySelector('.openide-map-back-label')!.textContent = previous.title;
			this.detailBack.title = t('archmap.detail.back', previous.title);
		}
		clearNode(this.detailBody);
		this.token++;
		if (top.kind === 'module') {
			this.renderModuleLevel(top.id);
		} else {
			void this.renderEntityLevel(top.id, this.token);
		}
		this.detailScroll.scanDomNode();
	}

	private renderModuleLevel(id: string): void {
		const spec = this.spec;
		const node = spec?.nodes.find(n => n.id === id);
		if (!spec || !node) {
			return;
		}
		const meta = append(this.detailBody, $('.openide-map-insp-meta'));
		const chip = append(meta, $('span.openide-map-kind', undefined, nodeMapKindLabel(spec.type, node.kind)));
		chip.style.setProperty('--openide-map-kind-color', nodeMapColorFor(spec.type, node.kind));
		if (node.sublabel) {
			append(meta, $('span.openide-map-insp-sub', undefined, node.sublabel));
		}

		// The explanation, in the project's own words: the header comment of the module's most
		// connected file. Read lazily and never stored — baked in, it would go stale the moment
		// somebody edits the comment it came from.
		if (node.sources?.length) {
			this.renderDoc(node.sources[0], this.token);
			this.renderSources(node.sources);
		}

		const outgoing = spec.edges.filter(edge => edge.from === id);
		const incoming = spec.edges.filter(edge => edge.to === id);
		this.relationSection(t('map.inspector.outgoing'), outgoing.map(edge => ({ id: edge.to, label: edge.label })), spec);
		this.relationSection(t('map.inspector.incoming'), incoming.map(edge => ({ id: edge.from, label: edge.label })), spec);
		if (!outgoing.length && !incoming.length) {
			append(this.detailBody, $('.openide-pmap-result-empty', undefined, t('map.inspector.alone')));
		}
	}

	private relationSection(title: string, relations: readonly { id: string; label?: string }[], spec: INodeMapSpec): void {
		if (!relations.length) {
			return;
		}
		append(this.detailBody, $('.openide-map-insp-section', undefined, title));
		for (const relation of relations) {
			const target = spec.nodes.find(n => n.id === relation.id);
			const row = append(this.detailBody, $('button.openide-pmap-relation.openide-map-row', { type: 'button' }));
			const dot = append(row, $('span.openide-map-dot'));
			dot.style.background = nodeMapColorFor(spec.type, target?.kind ?? '');
			append(row, $('span.openide-pmap-relation-name', undefined, target?.label ?? relation.id));
			if (relation.label) {
				append(row, $('span.openide-pmap-relation-kind', undefined, relation.label));
			}
			this.levelDisposables.add(addDisposableListener(row, 'click', () => {
				this.mapFocus?.select(relation.id);
				this.push({ kind: 'module', id: relation.id, title: target?.label ?? relation.id });
			}));
		}
	}

	/**
	 * The files a module is made of — Archify's evidence passport, filled from the index instead of
	 * authored. A row goes DEEPER when the index knows the file (its imports, what it defines) and
	 * opens it in the editor when it does not.
	 */
	private renderSources(sources: readonly string[]): void {
		const root = this.contextService.getWorkspace().folders[0];
		if (!root) {
			return;
		}
		append(this.detailBody, $('.openide-map-insp-section', undefined, t('map.inspector.sources')));
		for (const path of sources) {
			const resource = joinPath(root.uri, ...path.split('/'));
			const indexed = this.view?.nodes.find(node => node.path === path);
			const row = append(this.detailBody, $('button.openide-pmap-result.openide-map-row', { type: 'button', title: path }));
			this.fileIcon(row, resource);
			append(row, $('span.openide-pmap-result-name', undefined, basename(resource)));
			append(row, $('span.openide-pmap-result-detail', undefined, basename(dirname(resource))));
			this.levelDisposables.add(addDisposableListener(row, 'click', () => {
				if (indexed) {
					this.push({ kind: 'entity', id: indexed.id, title: indexed.name });
				} else {
					void this.editorService.openEditor({ resource, options: { pinned: true } });
				}
			}));
		}
	}

	/**
	 * A file or a symbol, read straight out of the index: what it is, what it defines, what it pulls
	 * in and who pulls it in — every row another level down. This is where the map stops being a
	 * picture of the project and becomes a way through it.
	 */
	private async renderEntityLevel(id: string, token: number): Promise<void> {
		const [entity] = await this.graphService.getNodes([id]);
		const [relations] = await this.graphService.getRelations([id], 1, 120, 'both');
		if (token !== this.token || !entity) {
			return;
		}
		const resource = URI.parse(entity.uri);
		const meta = append(this.detailBody, $('.openide-map-insp-meta'));
		append(meta, $('span.openide-map-kind', undefined, entity.kind));
		const open = append(meta, $('button.openide-pmap-link', { type: 'button' }, t('map.inspector.openFile')));
		this.levelDisposables.add(addDisposableListener(open, 'click', () => {
			void this.editorService.openEditor({
				resource,
				options: {
					pinned: true,
					selection: entity.range ? { startLineNumber: entity.range.startLine, startColumn: entity.range.startColumn } : undefined,
				},
			});
		}));

		// The index's own documentation when it has some (notes, language server); otherwise the
		// file's header comment, which is what a person actually wrote to explain it.
		if (entity.documentation) {
			append(this.detailBody, $('.openide-map-insp-doc', undefined, entity.documentation));
		} else if (entity.kind === 'file') {
			this.renderDocFor(resource, token);
		}

		for (const group of groupEntityRelations(id, relations?.relations ?? [])) {
			append(this.detailBody, $('.openide-map-insp-section', undefined, t(BUCKET_LABEL[group.bucket] as Parameters<typeof t>[0])));
			for (const node of group.nodes) {
				this.entityRow(node);
			}
		}
		this.detailScroll.scanDomNode();
	}

	private entityRow(node: ICodebaseMemoryNode): void {
		const row = append(this.detailBody, $('button.openide-pmap-relation.openide-map-row', { type: 'button', title: node.uri }));
		if (node.kind === 'file') {
			this.fileIcon(row, URI.parse(node.uri));
		} else {
			const icon = append(row, $('span.openide-map-file-icon'));
			icon.classList.add('codicon', `codicon-${entityIconId(node.kind)}`);
		}
		append(row, $('span.openide-pmap-relation-name', undefined, node.name));
		// The kind only when the glyph does not already say it: a column repeating "file" on every
		// row of a list of files is noise wearing the clothes of information.
		if (node.kind !== 'file') {
			append(row, $('span.openide-pmap-relation-kind', undefined, node.kind));
		}
		this.levelDisposables.add(addDisposableListener(row, 'click', () => this.push({ kind: 'entity', id: node.id, title: node.name })));
	}

	/**
	 * The row's icon from the user's FILE ICON THEME, the way the Explorer and the Project Map draw
	 * theirs: a `.ts` looks like a `.ts`. A generic page glyph on every row says nothing that the
	 * name does not already say.
	 */
	private fileIcon(row: HTMLElement, resource: URI): void {
		const icon = append(row, $('span.openide-map-file-icon'));
		icon.classList.add(...getIconClasses(this.modelService, this.languageService, resource, FileKind.FILE));
	}

	// ---- the header comment

	private renderDoc(path: string, token: number): void {
		const root = this.contextService.getWorkspace().folders[0];
		if (root) {
			this.renderDocFor(joinPath(root.uri, ...path.split('/')), token);
		}
	}

	private renderDocFor(resource: URI, token: number): void {
		const host = append(this.detailBody, $('.openide-map-insp-doc'));
		host.classList.add('hidden');
		void this.describe(resource).then(text => {
			if (!text || token !== this.token) {
				return;
			}
			host.textContent = text;
			host.classList.remove('hidden');
			this.detailScroll.scanDomNode();
		});
	}

	/** Read once and remembered for as long as this picture stands. */
	private async describe(resource: URI): Promise<string | undefined> {
		const key = resource.toString();
		if (this.docs.has(key)) {
			return this.docs.get(key);
		}
		let doc: string | undefined;
		try {
			doc = leadingDocComment((await this.fileService.readFile(resource)).value.toString());
		} catch {
			// A file that is gone is not an error worth showing: the map still draws.
			doc = undefined;
		}
		this.docs.set(key, doc);
		return doc;
	}

	override layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
		this.stage.layout(dimension);
		this.rescan();
	}

	override focus(): void {
		super.focus();
		this.stage.focus();
	}
}
