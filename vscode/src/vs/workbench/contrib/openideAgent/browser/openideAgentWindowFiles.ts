/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../common/openideStrings.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { OpenideEmptyState } from '../../../browser/openideEmptyState.js';
import { $, append } from '../../../../base/browser/dom.js';
import { IAsyncDataSource, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { Emitter } from '../../../../base/common/event.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { IExpression, parse } from '../../../../base/common/glob.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileKind, IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { createFileIconThemableTreeContainerScope } from '../../files/browser/views/explorerView.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspace, IWorkspaceContextService, toWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

interface WorkspaceFile {
	readonly resource: URI;
	readonly name: string;
	readonly isDirectory: boolean;
	readonly isRoot?: boolean;
}

/** Lazy file-service data source; watches only directories actually visited by the tree. */
export class OpenideWorkspaceFilesDataSource extends Disposable implements IAsyncDataSource<IWorkspace, WorkspaceFile> {
	private readonly watchers = this._register(new DisposableMap<string, DisposableStore>());
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) { super(); }

	hasChildren(element: IWorkspace | WorkspaceFile): boolean {
		return 'folders' in element ? element.folders.length > 0 : element.isDirectory;
	}

	async getChildren(element: IWorkspace | WorkspaceFile): Promise<WorkspaceFile[]> {
		if ('folders' in element) {
			return element.folders.map(folder => ({ resource: folder.uri, name: folder.name, isDirectory: true, isRoot: true }));
		}
		if (!element.isDirectory || this._store.isDisposed) { return []; }
		const key = element.resource.toString();
		if (!this.watchers.has(key)) {
			const store = new DisposableStore();
			this.watchers.set(key, store);
			const watcher = store.add(this.fileService.createWatcher(element.resource, { recursive: false, excludes: [] }));
			store.add(watcher.onDidChange(() => this.changed.fire()));
		}
		const stat = await this.fileService.resolve(element.resource);
		if (this._store.isDisposed) { return []; }
		const children = stat.children ?? [];
		const siblings = new Set(children.map(child => child.name));
		const excludes = parse(this.configurationService.getValue<IExpression>('files.exclude', { resource: element.resource }) ?? {});
		const root = this.workspaceService.getWorkspaceFolder(element.resource)?.uri ?? element.resource;
		return children.filter(child => !excludes(relativePath(root, child.resource) ?? child.name, child.name, name => siblings.has(name)))
			.map(child => ({ resource: child.resource, name: child.name, isDirectory: child.isDirectory }))
			.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || compareFileNames(a.name, b.name));
	}

	reset(): void { this.watchers.clearAndDisposeAll(); }
}

class WorkspaceFileRenderer implements ITreeRenderer<WorkspaceFile, FuzzyScore, IResourceLabel> {
	readonly templateId = 'openideWorkspaceFile';
	constructor(private readonly labels: ResourceLabels) { }
	renderTemplate(container: HTMLElement): IResourceLabel {
		return this.labels.create(container, { supportHighlights: true });
	}
	renderElement(node: ITreeNode<WorkspaceFile, FuzzyScore>, _index: number, label: IResourceLabel): void {
		const file = node.element;
		label.setResource({ resource: file.resource, name: file.name }, {
			fileKind: file.isRoot ? FileKind.ROOT_FOLDER : file.isDirectory ? FileKind.FOLDER : FileKind.FILE,
			fileDecorations: { colors: true, badges: true },
		});
	}
	disposeTemplate(label: IResourceLabel): void { label.dispose(); }
}

/** The workbench's virtualized tree, file labels and editor service in the agent island. */
export class OpenideAgentWindowFiles extends Disposable {
	readonly domNode: HTMLElement;
	private readonly tree: WorkbenchAsyncDataTree<IWorkspace, WorkspaceFile, FuzzyScore>;
	private readonly dataSource: OpenideWorkspaceFilesDataSource;
	private readonly refreshScheduler: RunOnceScheduler;
	private ready: Promise<void>;
	private directory: URI | undefined;
	private input: IWorkspace;
	private readonly empty: OpenideEmptyState;

	constructor(
		parent: HTMLElement,
		options: { label: string; focusEditor?: () => void; openFile?: (resource: URI) => Promise<void> },
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@ICommandService commands: ICommandService,
	) {
		super();
		this.input = workspaceService.getWorkspace();
		this.domNode = append(parent, $('.openide-agent-window-files-tree'));
		this._register(createFileIconThemableTreeContainerScope(this.domNode, themeService));
		this.dataSource = this._register(instantiationService.createInstance(OpenideWorkspaceFilesDataSource));
		const labels = this._register(instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		const renderer = new WorkspaceFileRenderer(labels);
		this.tree = this._register(instantiationService.createInstance(WorkbenchAsyncDataTree<IWorkspace, WorkspaceFile, FuzzyScore>,
			'OpenideAgentWindowFiles', this.domNode,
			{ getHeight: () => 24, getTemplateId: () => renderer.templateId }, [renderer], this.dataSource,
			{
				identityProvider: { getId: file => file.resource.toString() },
				accessibilityProvider: { getWidgetAriaLabel: () => options.label, getAriaLabel: file => file.name },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: file => file.name },
				multipleSelectionSupport: false,
				collapseByDefault: file => !file.isRoot,
				expandOnlyOnTwistieClick: false,
				horizontalScrolling: false,
			}));
		this.empty = this._register(instantiationService.createInstance(OpenideEmptyState, this.domNode, {
			title: t('openide.files.emptyTitle'),
			description: t('openide.files.emptyDescription'),
			actions: [{ label: t('openide.files.openFolder'), commandId: 'workbench.action.files.openFolder', run: () => commands.executeCommand<void>('workbench.action.files.openFolder') }],
		}));
		this.empty.domNode.hidden = this.input.folders.length > 0;
		this.refreshScheduler = this._register(new RunOnceScheduler(() => void this.refresh(), 100));
		this._register(this.dataSource.onDidChange(() => this.refreshScheduler.schedule()));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('files.exclude')) { this.refreshScheduler.schedule(); }
		}));
		this._register(workspaceService.onDidChangeWorkspaceFolders(() => {
			void this.showDirectory(this.directory, true);
		}));
		this._register(this.tree.onDidOpen(event => {
			if (event.element && !event.element.isDirectory) {
				if (options.openFile) { void options.openFile(event.element.resource).catch(error => this.report(error)); }
				else { void editorService.openEditor({ resource: event.element.resource, options: event.editorOptions }).then(() => options.focusEditor?.(), error => this.report(error)); }
			}
		}));
		this.ready = this.tree.setInput(this.input).catch(error => this.report(error));
	}

	/** Browse a conversation's actual directory without changing the shared IDE workspace. */
	async showDirectory(resource?: URI, force = false): Promise<void> {
		if (this._store.isDisposed) { return; }
		if (!force && this.directory?.toString() === resource?.toString()) { await this.ready; return; }
		this.directory = resource;
		this.input = resource ? { id: resource.toString(), folders: [toWorkspaceFolder(resource)] } : this.workspaceService.getWorkspace();
		this.empty.domNode.hidden = this.input.folders.length > 0;
		this.dataSource.reset();
		this.ready = this.tree.setInput(this.input).catch(error => this.report(error));
		await this.ready;
	}

	layout(height = this.domNode.parentElement?.clientHeight ?? 0, width = this.domNode.parentElement?.clientWidth ?? 0): void {
		this.tree.layout(Math.max(0, height), Math.max(0, width));
	}
	collapseAll(): void { this.tree.collapseAll(); }
	focus(): void { if (!this._store.isDisposed) { this.tree.domFocus(); } }
	async refresh(): Promise<void> {
		await this.ready;
		if (this._store.isDisposed) { return; }
		try { await this.tree.updateChildren(this.input); }
		catch (error) { this.report(error); }
	}
	private report(error: unknown): void {
		if (!this._store.isDisposed) { this.notificationService.error(error instanceof Error ? error : String(error)); }
	}
}
