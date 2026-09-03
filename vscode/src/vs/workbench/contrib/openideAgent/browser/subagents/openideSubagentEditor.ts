/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — native editor for `.openide/agents/*.md` subagent definitions.
 *
 *  Anatomy borrowed from how upstream treats agent/prompt files (chat/common/promptSyntax):
 *  the file is frontmatter + Markdown body, the body is edited in a REAL code editor
 *  (`CodeEditorWidget`, markdown), the frontmatter attributes (`name`, `description`, `model`,
 *  `tools`, …) get a native header with the same pickers the workbench uses — the chat's model
 *  picker and a tools picker shaped like `chatToolPicker` — and validation is shown as marker
 *  rows with upstream's severities (`promptValidator`). The Markdown file stays the source of
 *  truth (`ISubagentDefinitionService`); this pane never invents a second format. Replaces the
 *  webview editor.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { AnchorAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { DEFAULT_EDITOR_ASSOCIATION, IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../../codeEditor/browser/simpleEditorOptions.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { OpenideSectionRenderer } from '../../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { t } from '../../common/openideStrings.js';
import { SubagentTaskProfile } from '../../common/openideSubagentRouting.js';
import { ISubagentDefinition, ISubagentDefinitionDiagnostic } from '../../common/openideSubagentTypes.js';
import { OpenideChatModelPicker } from '../chat/openideChatModelPicker.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { applyProviderIcon } from '../openideProviderIcons.js';
import { ISubagentDefinitionService } from '../openideSubagentDefinitionService.js';
import { OpenideSubagentInput } from '../openideSubagentInput.js';
import { ISubagentOrchestrationService } from '../openideSubagentOrchestrationService.js';
import { applyOpenideSurfaceCss } from '../openideSurfaceStyle.js';
import { showOpenideSubagentToolsPicker } from './openideSubagentToolsPicker.js';
import '../../../openideSettings/browser/media/openideSettings.css';
import '../media/openideChat.css';

type SubagentDraft = Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>;

const PROFILES: readonly { value: '' | SubagentTaskProfile; key: Parameters<typeof t>[0] }[] = [
	{ value: '', key: 'subagent.profile.auto' },
	{ value: 'planning', key: 'subagent.profile.planning' },
	{ value: 'debug', key: 'subagent.profile.debug' },
	{ value: 'implementation', key: 'subagent.profile.implementation' },
	{ value: 'review', key: 'subagent.profile.review' },
	{ value: 'simple-fix', key: 'subagent.profile.simpleFix' },
	{ value: 'research', key: 'subagent.profile.research' },
	{ value: 'general', key: 'subagent.profile.general' },
];

/** `model: default` in the file — the router picks. */
const DEFAULT_MODEL = 'default';
const HEADER_MAX_HEIGHT = 0.5; // share of the pane the header may take before the body wins

export class OpenideSubagentEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideSubagent';

	private root!: HTMLElement;
	private header!: HTMLElement;
	private headerScroll!: DomScrollableElement;
	private headerHost!: HTMLElement;
	private bodyHost!: HTMLElement;
	private editor!: CodeEditorWidget;
	private readonly model = this._register(new MutableDisposable<{ dispose(): void; model: ITextModel }>());
	private readonly renderStore = this._register(new DisposableStore());
	private readonly picker = this._register(new MutableDisposable<OpenideChatModelPicker>());

	private draft: SubagentDraft = { name: '', model: DEFAULT_MODEL, profile: undefined, description: '', readonly: true, isBackground: false, tools: [], systemPrompt: '' };
	private diagnostics: readonly ISubagentDefinitionDiagnostic[] = [];
	private dirty = false;
	private dimension: Dimension | undefined;
	private modelLabel: HTMLElement | undefined;
	private modelIcon: HTMLElement | undefined;
	private toolsHost: HTMLElement | undefined;
	private saveButton: Button | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IEditorService private readonly editorService: IEditorService,
		@ISubagentDefinitionService private readonly definitions: ISubagentDefinitionService,
		@ISubagentOrchestrationService private readonly orchestration: ISubagentOrchestrationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(OpenideSubagentEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		applyOpenideSurfaceCss();
		this.root = append(parent, $('.openide-subagent-editor.openide-settings'));
		// The header scrolls with the workbench scrollbar, never the browser's.
		this.headerHost = append(this.root, $('.openide-subagent-header-host'));
		this.header = $('.openide-subagent-header');
		this.headerScroll = this._register(new DomScrollableElement(this.header, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(this.headerHost, this.headerScroll.getDomNode());
		const body = append(this.root, $('.openide-subagent-body'));
		const bodyHead = append(body, $('.openide-subagent-body-head'));
		append(bodyHead, $('span.openide-subagent-body-title', undefined, t('subagent.section.prompt')));
		append(bodyHead, $('span.openide-subagent-body-desc', undefined, t('subagent.section.prompt.desc')));
		this.bodyHost = append(body, $('.openide-subagent-body-editor'));

		// The body is a real editor: markdown, wrapped, no gutter — the same widget the chat input
		// and the prompt files use, so completions, hovers and keybindings are the workbench's.
		const options = getSimpleEditorOptions(this.configurationService);
		options.wordWrap = 'on';
		options.lineNumbers = 'off';
		options.glyphMargin = false;
		options.folding = false;
		options.lineDecorationsWidth = 8;
		options.renderLineHighlight = 'none';
		options.scrollBeyondLastLine = false;
		options.padding = { top: 10, bottom: 10 };
		options.fontFamily = this.configurationService.getValue<string>('editor.fontFamily');
		this.editor = this._register(this.instantiationService.createInstance(CodeEditorWidget, this.bodyHost, options, getSimpleCodeEditorWidgetOptions()));
		this._register(this.editor.onDidChangeModelContent(() => { this.dirty = true; this.paintDirty(); }));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) { return; }
		await this.load();
	}

	override clearInput(): void {
		this.renderStore.clear();
		clearNode(this.header);
		this.editor.setModel(null);
		this.model.clear();
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
		this.headerHost.style.maxHeight = `${Math.floor(dimension.height * HEADER_MAX_HEIGHT)}px`;
		this.layoutBody();
	}

	private layoutBody(): void {
		if (!this.dimension) { return; }
		const max = Math.floor(this.dimension.height * HEADER_MAX_HEIGHT);
		const headerHeight = Math.min(max, this.header.scrollHeight);
		this.headerScroll.getDomNode().style.height = `${headerHeight}px`;
		this.headerScroll.scanDomNode();
		const height = Math.max(120, this.dimension.height - headerHeight - (this.bodyHost.previousElementSibling?.clientHeight ?? 0) - 1);
		this.bodyHost.style.height = `${height}px`;
		this.editor.layout({ width: this.dimension.width, height });
	}

	override focus(): void {
		super.focus();
		this.editor.focus();
	}

	private get subagentInput(): OpenideSubagentInput | undefined {
		return this.input instanceof OpenideSubagentInput ? this.input : undefined;
	}

	// ---- loading

	private async load(): Promise<void> {
		const input = this.subagentInput;
		if (!input) { return; }
		try {
			const parsed = await this.definitions.read(input.resource, 'workspace');
			this.diagnostics = parsed.diagnostics;
			const definition = parsed.definition;
			if (definition) {
				this.draft = { name: definition.name, model: definition.model || DEFAULT_MODEL, profile: definition.profile, description: definition.description, readonly: definition.readonly, isBackground: definition.isBackground, tools: [...definition.tools], systemPrompt: definition.systemPrompt };
			}
		} catch (error) {
			this.diagnostics = [{ severity: 'error', message: error instanceof Error ? error.message : String(error), startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }];
		}
		this.dirty = false;
		this.setBody(input.resource, this.draft.systemPrompt);
		this.renderHeader();
	}

	private setBody(resource: URI, text: string): void {
		// An in-memory model on a derived uri: the real file is written by the definition service on
		// save, so the editor must not be attached to the file's own model (that would make the
		// text editor and this pane fight over one buffer).
		const uri = resource.with({ scheme: 'openide-subagent', path: resource.path + '.body.md' });
		const model = this.modelService.getModel(uri) ?? this.modelService.createModel(text, this.languageService.createById('markdown'), uri);
		if (model.getValue() !== text) { model.setValue(text); }
		this.model.value = { model, dispose: () => model.dispose() };
		this.editor.setModel(model);
		this.editor.updateOptions({ readOnly: false });
		this.layoutBody();
	}

	// ---- header

	private renderHeader(): void {
		const input = this.subagentInput;
		this.renderStore.clear();
		clearNode(this.header);
		this.saveButton = undefined;
		if (!input) { return; }
		const ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);

		// Title row: file name + actions (what upstream puts in the editor title toolbar for
		// prompt files: run, open, plus our save).
		const head = append(this.header, $('.openide-subagent-editor-head'));
		const copy = append(head, $('.openide-subagent-editor-copy'));
		append(copy, $('h1.openide-settings-page-title', undefined, this.draft.name || input.getName()));
		append(copy, $('p.openide-settings-page-desc', undefined, t('subagent.editor.intro')));
		const actions = append(head, $('.openide-subagent-editor-actions'));
		this.workbenchButton(actions, t('subagent.action.openRaw'), true, () => this.openRaw());
		this.workbenchButton(actions, t('subagent.action.run'), true, () => this.run());
		this.saveButton = this.workbenchButton(actions, t('subagent.action.save'), false, () => void this.save());
		this.paintDirty();

		if (this.diagnostics.length) { this.renderDiagnostics(this.header); }

		const grid = append(this.header, $('.openide-subagent-grid'));

		// Column 1: identity — `name`, `description`, `profile`.
		const identity = ui.section(grid, { title: t('subagent.section.identity'), description: t('subagent.section.identity.desc') });
		ui.input(identity, { label: t('subagent.field.name'), description: t('subagent.field.name.desc'), value: this.draft.name, placeholder: 'reviewer', mono: true, change: value => this.patch({ name: value.trim() }) });
		ui.input(identity, { label: t('subagent.field.description'), description: t('subagent.field.description.desc'), value: this.draft.description, change: value => this.patch({ description: value }) });
		ui.select(identity, { label: t('subagent.field.profile'), options: PROFILES.map(p => ({ value: p.value, label: t(p.key) })), value: this.draft.profile ?? '', change: value => this.patch({ profile: (value || undefined) as SubagentTaskProfile | undefined }) });

		// Column 2: `model` (the chat's picker), `tools` (the tools picker), flags.
		const runtime = ui.section(grid, { title: t('subagent.section.model'), description: t('subagent.section.model.desc') });
		const modelRow = append(runtime, $('.openide-settings-row'));
		const modelCopy = append(modelRow, $('.openide-settings-copy'));
		append(modelCopy, $('.openide-settings-setting-title', undefined, t('subagent.field.model')));
		append(modelCopy, $('.openide-settings-description', undefined, t('subagent.field.model.desc')));
		const modelValue = append(modelRow, $('.openide-settings-value.openide-subagent-model-value'));
		const chip = append(modelValue, $('button.openide-composer-trigger.openide-composer-model.openide-subagent-model-chip', { type: 'button' })) as HTMLButtonElement;
		chip.title = t('subagent.field.model.pick');
		this.modelIcon = append(chip, $('span.openide-composer-provider-icon'));
		this.modelLabel = append(chip, $('span.openide-composer-trigger-label'));
		append(chip, $('span.codicon.codicon-chevron-down.openide-composer-chevron'));
		const picker = new OpenideChatModelPicker(this.agentService, this.contextViewService, this.commandService, () => this.paintModel(), {
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.LEFT,
			width: 340,
			resolveActive: async () => this.modelTarget(),
			choose: async (group, m) => this.patch({ model: `${group.id}/${m.id}` }),
		});
		this.picker.value = picker;
		this.renderStore.add(addDisposableListener(chip, 'click', () => picker.toggle(chip)));
		ui.iconButton(modelValue, { label: t('subagent.field.model.reset'), icon: 'discard', enabled: this.draft.model !== DEFAULT_MODEL, run: () => { this.patch({ model: DEFAULT_MODEL }); this.renderHeader(); } });
		this.paintModel();

		const toolsRow = append(runtime, $('.openide-settings-row.openide-subagent-tools-row'));
		const toolsCopy = append(toolsRow, $('.openide-settings-copy'));
		append(toolsCopy, $('.openide-settings-setting-title', undefined, t('subagent.field.tools')));
		append(toolsCopy, $('.openide-settings-description', undefined, t('subagent.field.tools.desc')));
		const toolsValue = append(toolsRow, $('.openide-settings-value'));
		ui.button(toolsValue, { label: t('subagent.field.tools.configure'), icon: 'tools', run: () => void this.pickTools() });
		this.toolsHost = append(runtime, $('.openide-subagent-tools'));
		this.paintTools();

		ui.row(runtime, { name: t('subagent.field.readonly'), description: t('subagent.field.readonly.desc'), toggle: { checked: this.draft.readonly, change: on => this.patch({ readonly: on }) } });
		ui.row(runtime, { name: t('subagent.field.background'), description: t('subagent.field.background.desc'), toggle: { checked: this.draft.isBackground, change: on => this.patch({ isBackground: on }) } });

		this.layoutBody();
	}

	/** Marker rows with upstream's semantics: severity icon, message, `[Ln, Col]`, click reveals the line in the raw file. */
	private renderDiagnostics(parent: HTMLElement): void {
		const list = append(parent, $('.openide-subagent-markers'));
		for (const diagnostic of this.diagnostics) {
			const row = append(list, $(`button.openide-subagent-marker.${diagnostic.severity}`, { type: 'button' })) as HTMLButtonElement;
			append(row, $(`span.${ThemeIcon.asClassName(diagnostic.severity === 'error' ? Codicon.error : Codicon.warning).replace(/ /g, '.')}`));
			append(row, $('span.openide-subagent-marker-text', undefined, diagnostic.message));
			append(row, $('span.openide-subagent-marker-pos', undefined, `[Ln ${diagnostic.startLine}, Col ${diagnostic.startColumn}]`));
			row.title = t('subagent.diagnostics.reveal');
			this.renderStore.add(addDisposableListener(row, 'click', () => this.openRaw(diagnostic.startLine, diagnostic.startColumn)));
		}
	}

	private workbenchButton(parent: HTMLElement, label: string, secondary: boolean, run: () => void): Button {
		const button = this.renderStore.add(new Button(parent, { ...defaultButtonStyles, secondary, title: label }));
		button.label = label;
		this.renderStore.add(button.onDidClick(run));
		return button;
	}

	private paintDirty(): void {
		if (this.saveButton) { this.saveButton.enabled = this.dirty; }
	}

	private async modelTarget(): Promise<{ providerId: string; modelId: string }> {
		if (this.draft.model === DEFAULT_MODEL) { return { providerId: this.agentService.getActiveProviderId(), modelId: '' }; }
		const slash = this.draft.model.indexOf('/');
		return slash > 0
			? { providerId: this.draft.model.slice(0, slash), modelId: this.draft.model.slice(slash + 1) }
			: { providerId: this.agentService.getActiveProviderId(), modelId: this.draft.model };
	}

	private paintModel(): void {
		const icon = this.modelIcon, label = this.modelLabel;
		if (!icon || !label) { return; }
		if (this.draft.model === DEFAULT_MODEL) {
			label.textContent = t('subagent.field.model.default');
			icon.hidden = true;
			return;
		}
		const slash = this.draft.model.indexOf('/');
		const providerId = slash > 0 ? this.draft.model.slice(0, slash) : this.agentService.getActiveProviderId();
		const modelId = slash > 0 ? this.draft.model.slice(slash + 1) : this.draft.model;
		label.textContent = this.agentService.describeModel(providerId, modelId)?.name || modelId;
		applyProviderIcon(icon, providerId, this.agentService.findProvider(providerId)?.label ?? '');
		icon.classList.add('openide-composer-provider-icon');
		icon.hidden = !providerId;
	}

	private paintTools(): void {
		const host = this.toolsHost;
		if (!host) { return; }
		clearNode(host);
		if (!this.draft.tools.length) {
			append(host, $('span.openide-subagent-tools-empty', undefined, t('subagent.field.tools.empty')));
			return;
		}
		for (const tool of this.draft.tools) {
			const chip = append(host, $('span.openide-subagent-tool-chip'));
			append(chip, $('span.openide-subagent-tool-name', undefined, tool));
			const remove = append(chip, $('button.openide-subagent-tool-remove', { type: 'button', title: t('subagent.field.tools.remove', tool) })) as HTMLButtonElement;
			append(remove, $('span.codicon.codicon-close'));
			this.renderStore.add(addDisposableListener(remove, 'click', () => { this.patch({ tools: this.draft.tools.filter(item => item !== tool) }); this.paintTools(); this.layoutBody(); }));
		}
	}

	private async pickTools(): Promise<void> {
		const picked = await showOpenideSubagentToolsPicker(this.quickInputService, this.agentService, this.draft.tools);
		if (!picked) { return; }
		this.patch({ tools: picked });
		this.paintTools();
		this.layoutBody();
	}

	// ---- actions

	private patch(change: Partial<SubagentDraft>): void {
		this.draft = { ...this.draft, ...change };
		this.dirty = true;
		this.paintDirty();
		if ('model' in change) { this.paintModel(); }
	}

	private currentDefinition(): SubagentDraft {
		return { ...this.draft, systemPrompt: this.editor.getModel()?.getValue() ?? this.draft.systemPrompt };
	}

	private async save(): Promise<void> {
		const input = this.subagentInput;
		if (!input) { return; }
		try {
			await this.definitions.write(input.resource, this.currentDefinition());
			await this.load();
		} catch (error) {
			this.notificationService.error(t('subagent.save.error', error instanceof Error ? error.message : String(error)));
		}
	}

	private openRaw(line?: number, column?: number): void {
		const input = this.subagentInput;
		if (!input) { return; }
		void this.editorService.openEditor({ resource: input.resource, options: { override: DEFAULT_EDITOR_ASSOCIATION.id, pinned: true, selection: line ? { startLineNumber: line, startColumn: column ?? 1 } : undefined } });
	}

	private run(): void {
		const input = this.subagentInput;
		if (!input) { return; }
		const launch = async () => {
			const parsed = await this.definitions.read(input.resource, 'workspace');
			if (!parsed.definition) { throw new Error(parsed.diagnostics.map(d => d.message).join(' ')); }
			await this.orchestration.delegate({ agent: parsed.definition.name, task: t('subagent.run.task', parsed.definition.name), parentConversationId: 'manual', parentMessageId: generateUuid(), background: this.draft.isBackground });
		};
		(this.dirty ? this.save().then(launch) : launch()).catch(error => this.notificationService.error(t('subagent.run.error', error instanceof Error ? error.message : String(error))));
	}
}
