/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { Action } from '../../../../base/common/actions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { t } from '../common/openideStrings.js';
import { OpenideAgentWindowFiles } from './openideAgentWindowFiles.js';

/** A Files tab uses the same editor group, tab strip and modal as other workspace tools. */
export class OpenideFilesInput extends EditorInput {
	static readonly ID = 'workbench.input.openideFiles';
	constructor(readonly directory?: URI) { super(); }
	override get typeId(): string { return OpenideFilesInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'openide-files', path: '/files', query: this.directory?.toString() }); }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly; }
	override getName(): string { return t('agentWindow.filesTitle'); }
	override getDescription(): string | undefined { return this.directory?.fsPath; }
	override getIcon() { return Codicon.files; }
	override matches(other: EditorInput): boolean {
		return other instanceof OpenideFilesInput && other.directory?.toString() === this.directory?.toString();
	}
}

/** Reuses the virtualized file tree; native EditorPane layout owns all resizing. */
export class OpenideFilesEditor extends EditorPane {
	static readonly ID = 'workbench.editor.openideFiles';
	private files!: OpenideAgentWindowFiles;
	private toolbar!: HTMLElement;
	private directoryLabel!: HTMLElement;
	private dimension: Dimension | undefined;
	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
	) { super(OpenideFilesEditor.ID, group, telemetryService, themeService, storageService); }

	protected createEditor(parent: HTMLElement): void {
		const root = append(parent, $('.openide-files-editor'));
		this.toolbar = append(root, $('.openide-files-editor-toolbar'));
		this.directoryLabel = append(this.toolbar, $('.openide-files-editor-directory'));
		const actions = this._register(this.instantiationService.createInstance(WorkbenchToolBar, this.toolbar, { ariaLabel: t('agentWindow.filesTitle') }));
		const content = append(root, $('.openide-files-editor-content'));
		this.files = this._register(this.instantiationService.createInstance(OpenideAgentWindowFiles, content, {
			label: t('agentWindow.filesTitle'),
			openFile: async (resource: URI) => { await this.editorService.openEditor({ resource, options: { pinned: true } }, this.group); },
		}));
		actions.setActions([
			this._register(new Action('openide.files.refresh', t('agentWindow.refresh'), 'codicon codicon-refresh', true, () => this.files.refresh())),
			this._register(new Action('openide.files.collapse', t('agentWindow.collapse'), 'codicon codicon-collapse-all', true, () => this.files.collapseAll())),
		]);
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof OpenideFilesInput) || token.isCancellationRequested) { return; }
		this.directoryLabel.textContent = input.directory?.fsPath ?? t('agentWindow.workspace');
		await this.files.showDirectory(input.directory);
		if (!token.isCancellationRequested && this.input === input && this.dimension) { this.layout(this.dimension); }
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.files.layout(Math.max(0, dimension.height - this.toolbar.offsetHeight), dimension.width);
	}
	override focus(): void { super.focus(); this.files.focus(); }
}
