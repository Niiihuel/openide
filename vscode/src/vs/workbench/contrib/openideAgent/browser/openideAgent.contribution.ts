/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — agent engine contribution: service, config (catalog + custom providers),
 *  and commands to pick a provider, set an API key and test the agent (Output channel).
 *  The chat UI in the right dock comes later; this is the backend / foundation.
 *--------------------------------------------------------------------------------------------*/

import './media/openideChat.css';
import { FileAccess } from '../../../../base/common/network.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { OPENIDE_CLI_CATALOG } from '../common/openideAgentCliCatalog.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { OpenideQuickCommandsService } from './openideQuickCommandsService.js';
import { Extensions as OutputExtensions, IOutputChannelRegistry, IOutputService } from '../../../services/output/common/output.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IComposerSnippet, SNIPPET_MAX_CHARS } from '../common/chat/openideChatSnippet.js';
import './autocomplete/openideAutocomplete.js';
import { OPENIDE_AUTOCOMPLETE_DEBOUNCE, OPENIDE_AUTOCOMPLETE_DISABLE_IN, OPENIDE_AUTOCOMPLETE_ENABLED, OPENIDE_AUTOCOMPLETE_MAX_TOKENS, OPENIDE_AUTOCOMPLETE_MODEL, OPENIDE_AUTOCOMPLETE_MULTILINE, OPENIDE_AUTOCOMPLETE_TOGGLE_COMMAND } from './autocomplete/openideAutocomplete.js';
import { OPENIDE_QUICK_EDIT_COMMAND, OPENIDE_SELECTION_HINT_SETTING } from './editor/openideSelectionHint.js';
import { CTX_OPENIDE_QUICK_EDIT_VISIBLE, OPENIDE_QUICK_EDIT_CLOSE_COMMAND, OPENIDE_QUICK_EDIT_MODEL, OpenideQuickEdit } from './editor/openideQuickEdit.js';
import { OPENIDE_SELECTION_TO_CLI_KEY } from './chat/openideChatWidget.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CTX_OPENIDE_REVIEW_ACTIVE, ReviewAction } from './openideEditReview.js';
import { OpenideChatViewPane } from './openideChatView.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { OpenideDiagramEditor } from './diagrams/openideDiagramEditor.js';
import { OpenideDiagramInput, toOpenideDiagramPayload } from './openideDiagramInput.js';
import { OpenidePlanEditor } from './plan/openidePlanEditor.js';
import { OpenidePlanInput } from './openidePlanInput.js';
import { OpenideCanvasEditor } from './openideCanvasEditor.js';
import { OpenideCanvasInput, OpenideCanvasInputSerializer } from './openideCanvasInput.js';
import { IOpenideCanvasService, OpenideCanvasService } from './openideCanvasService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { OpenideSettingsEditor } from '../../openideSettings/browser/openideSettingsEditor.js';
import { OpenideProjectMapEditor } from './projectMap/openideProjectMapEditor.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { normalizeLocalUrl } from '../common/openideLocalUrl.js';
import { OpenideMemoryInput, OpenideMemoryInputSerializer } from './openideMemoryInput.js';
import { OpenideSkillInstallerEditor } from './openideSkillInstallerEditor.js';
import { OpenideSkillInstallerInput } from './openideSkillInstallerInput.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import './openideUsageService.js';
import { ICodebaseMemoryService, CodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideCodebaseGraphService, OpenideCodebaseGraphService } from './openideCodebaseGraphService.js';
import { IOpenideCodebaseQueryService, OpenideCodebaseQueryService } from './openideCodebaseQueryService.js';
import { IOpenideCodebaseContextService, OpenideCodebaseContextService } from './openideCodebaseContextService.js';
import { IOpenideProjectMapLearningService, OpenideProjectMapLearningService } from './openideProjectMapLearningService.js';
import './openideCodebaseMemoryContribution.js';
import './openideCodebaseLanguageServerBridge.js';
import { Registry as PlatformRegistry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IOpenideIdeServerService, OpenideIdeServerService, OPENIDE_IDE_SERVER_SETTING } from './openideIdeServerService.js';
import { IOpenideCliChangesService, OpenideCliChangesService } from './openideCliChangesService.js';
import { OpenideCliChangesView, OPENIDE_CLI_CHANGES_VIEW_ID } from './openideCliChangesView.js';
import { IOpenideIdePlanReview, OpenideIdePlanReview, OPENIDE_IDE_PLAN_APPROVE, OPENIDE_IDE_PLAN_REJECT, planDecisionMessage, planPathFromSaveResult } from './openideIdePlanReview.js';
import { externalToolName } from '../common/openideIdeExposure.js';
import { CODEBASE_NOTES_ENABLED_SETTING, CODEBASE_NOTES_LINKING_SETTING, CODEBASE_NOTES_MAX_CHARS_SETTING } from '../../../../code/common/openideCodebaseNotes.js';
import { text } from '../../../../platform/openideAgentHost/common/openideIdeServer.js';
import { IExternalUriOpenerService, IExternalOpenerProvider, IExternalUriOpener } from '../../externalUriOpener/common/externalUriOpenerService.js';
import { ExternalUriOpenerPriority } from '../../../../editor/common/languages.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDisposable, Disposable } from '../../../../base/common/lifecycle.js';
import { ISubagentDefinitionService, SubagentDefinitionService } from './openideSubagentDefinitionService.js';
import { ISubagentRegistryService, SubagentRegistryService } from './openideSubagentRegistryService.js';
import { ISubagentRunStorageService, SubagentRunStorageService } from './openideSubagentRunStorageService.js';
import { ISubagentRunService, SubagentRunService } from './openideSubagentRunService.js';
import { ISubagentPermissionService, SubagentPermissionService } from './openideSubagentPermissionService.js';
import { ISubagentExecutionService, SubagentExecutionService } from './openideSubagentExecutionService.js';
import { ISubagentOrchestrationService, SubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { ISubagentWorkspaceService, SubagentWorkspaceService } from './openideSubagentWorkspaceService.js';
import { ISubagentRoutingService, SubagentRoutingService } from './openideSubagentRoutingService.js';
import { OpenideSubagentEditor } from './subagents/openideSubagentEditor.js';
import { OpenideSubagentInput } from './openideSubagentInput.js';
import { openideProductIconCodepoints } from '../../../common/openideProductIcons.js';
import { language as platformLanguage } from '../../../../base/common/platform.js';
import { OPENIDE_LANGUAGE_SETTING, resolveOpenideLanguage, t } from '../common/openideStrings.js';
import { validateOpenideMarkdown } from '../common/openideMarkdownDiagnostics.js';
import { ILanguagePackItem, ILanguagePackService } from '../../../../platform/languagePacks/common/languagePacks.js';
import { ILocaleService } from '../../../services/localization/common/locale.js';

const CHANNEL_ID = 'openideAgent';
const MARKDOWN_CHANNEL_ID = 'openideMarkdown';
const planExecutionModelIcon = registerIcon(
	'openide-plan-execution-model',
	{ fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-plan-execution-model']) },
	localize('openide.plan.executionModelIcon', 'Icono del modelo que ejecutará el plan.')
);

registerSingleton(IOpenideCanvasService, OpenideCanvasService, InstantiationType.Delayed);
registerSingleton(ICodebaseMemoryService, CodebaseMemoryService, InstantiationType.Delayed);
registerSingleton(IOpenideCodebaseGraphService, OpenideCodebaseGraphService, InstantiationType.Delayed);
registerSingleton(IOpenideCodebaseQueryService, OpenideCodebaseQueryService, InstantiationType.Delayed);
registerSingleton(IOpenideProjectMapLearningService, OpenideProjectMapLearningService, InstantiationType.Delayed);
registerSingleton(IOpenideCodebaseContextService, OpenideCodebaseContextService, InstantiationType.Delayed);
registerSingleton(ISubagentDefinitionService, SubagentDefinitionService, InstantiationType.Delayed);
registerSingleton(ISubagentRegistryService, SubagentRegistryService, InstantiationType.Delayed);
registerSingleton(ISubagentRunStorageService, SubagentRunStorageService, InstantiationType.Delayed);
registerSingleton(ISubagentRunService, SubagentRunService, InstantiationType.Delayed);
registerSingleton(ISubagentPermissionService, SubagentPermissionService, InstantiationType.Delayed);
registerSingleton(ISubagentExecutionService, SubagentExecutionService, InstantiationType.Delayed);
registerSingleton(ISubagentOrchestrationService, SubagentOrchestrationService, InstantiationType.Delayed);
registerSingleton(ISubagentWorkspaceService, SubagentWorkspaceService, InstantiationType.Delayed);
registerSingleton(ISubagentRoutingService, SubagentRoutingService, InstantiationType.Delayed);
registerSingleton(IOpenideIdeServerService, OpenideIdeServerService, InstantiationType.Delayed);
registerSingleton(IOpenideIdePlanReview, OpenideIdePlanReview, InstantiationType.Delayed);
registerSingleton(IOpenideCliChangesService, OpenideCliChangesService, InstantiationType.Delayed);

/**
 * Opens OpenIDE's IDE server so an external CLI (Claude Code and anything speaking MCP) can
 * reach this window's editors, selection and diagnostics.
 *
 * Started at `Restored` and not earlier: the lockfile advertises the workspace folders a CLI
 * matches its cwd against, and before the workspace is restored that list is not yet true.
 * Publishing it early would let an agent adopt a window whose folders are about to change.
 */
class OpenideIdeServerContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IOpenideIdeServerService ideServer: OpenideIdeServerService,
		@IOpenideAgentService agentService: IOpenideAgentService,
		@IOpenideIdePlanReview planReview: OpenideIdePlanReview,
	) {
		super();
		// What OpenIDE has and the CLIs do not — today the browser surface. Registered before the
		// listen so the first `tools/list` already carries them; a tool that appears later still
		// arrives, through tools/list_changed.

		// One decision path, several surfaces: the review toast, the plan card in the transcript
		// and (later) the plan editor's own chrome all dispatch THESE, so two of them can never
		// answer the same parked call differently.
		this._register(CommandsRegistry.registerCommand(OPENIDE_IDE_PLAN_APPROVE, (_accessor, path?: unknown) => {
			if (typeof path === 'string') { void planReview.approve(path); }
		}));
		this._register(CommandsRegistry.registerCommand(OPENIDE_IDE_PLAN_REJECT, (_accessor, path?: unknown) => {
			if (typeof path === 'string') { planReview.reject(path); }
		}));
		const completions = new Map<string, (output: string) => Promise<string>>([
			[externalToolName('plan_save'), async output => {
				const path = planPathFromSaveResult(output);
				if (!path) {
					return output; // plan_save failed; there is nothing to review
				}
				const decision = await planReview.awaitDecision(path, path.split('/').pop() ?? path);
				return planDecisionMessage(decision);
			}],
		]);
		ideServer.bridgeAgentTools(
			agentService.externalTools(),
			(name, args, token) => agentService.invokeExternalTool(name, args, token),
			completions,
		);
		// A read of the shared memory, which has no native counterpart: OpenIDE's own loop gets it
		// injected in the system prompt, and an external agent gets nothing. Without a cheap read
		// it either duplicates entries or stops maintaining the file at all.
		ideServer.registerTools([{
			schema: {
				name: 'openide_memory_read',
				description: 'Devuelve la memoria compartida de este repo (.openide/MEMORY.md): convenciones, decisiones y gotchas que dejaron sesiones anteriores, tuyas o de otros agentes. Consultala al empezar, antes de reconstruir contexto leyendo archivos.',
				inputSchema: { type: 'object', properties: {} },
			},
			invoke: async () => text(await agentService.externalMemoryRead()),
		}]);
		void ideServer.start('OpenIDE');
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(OpenideIdeServerContribution, LifecyclePhase.Restored);

/**
 * Registers OpenIDE's tools in a CLI that has no per-session config hook — grok today.
 *
 * A one-time write into the CLI's own config, which only makes sense because the port and the
 * token are derived from the workspace and survive a restart. Runs the CLI's own `mcp add`
 * rather than editing its config file by hand: the format is theirs to change, and a file we
 * rewrote by pattern-matching is a file we will eventually corrupt.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.ide.registerMcp',
			title: localize2('openide.ide.registerMcp', 'OpenIDE: Registrar las herramientas de OpenIDE en un CLI'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ideServer = accessor.get(IOpenideIdeServerService);
		const agentService = accessor.get(IOpenideAgentService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const endpoint = ideServer.mcpEndpoint();
		if (!endpoint) {
			notificationService.warn(t('ide.register.noServer'));
			return;
		}
		const candidates = OPENIDE_CLI_CATALOG.filter(cli => cli.mcpRegisterArgs);
		const picked = await quickInputService.pick(
			candidates.map(cli => ({ label: cli.name, description: cli.binary, cli })),
			{ placeHolder: t('ide.register.pick') },
		);
		if (!picked) {
			return;
		}
		const executable = await agentService.resolveExecutable(picked.cli.binary);
		if (!executable) {
			notificationService.warn(t('ide.register.notFound', picked.cli.binary));
			return;
		}
		try {
			await ideServer.registerInCli(executable, picked.cli.mcpRegisterArgs!(endpoint));
			notificationService.info(t('ide.register.done', picked.cli.name));
		} catch (error) {
			notificationService.error(t('ide.register.failed', picked.cli.name, error instanceof Error ? error.message : String(error)));
		}
	}
});

/** Ctrl+click on a localhost URL in the terminal (or any local link) offers to open it in the
 *  IDE PREVIEW, in addition to the external browser. By registering an opener with 'Option'
 *  priority, VS Code shows the native picker (IDE vs external) when both can open it. */
/**
 * Retires `openide.language`, the fork's second language switch.
 *
 * `t()` now reads the IDE locale, the same one `localize()` uses, so the whole interface moves
 * together. A user who already set `openide.language` still expects to see that language, and the
 * locale is what decides it now — so the setting has to be carried over to the locale rather than
 * dropped on the floor. Offering that switch once is this contribution's only job.
 *
 * It does NOT rewrite the user's `settings.json`. Two reasons: `updateValue` from a startup
 * contribution was observed to never settle, and silently editing someone's settings file to tidy
 * up after ourselves is not our call. The setting is inert (nothing reads it) and the schema marks
 * it deprecated, so the editor shows it struck through with a pointer to Settings › Language. What
 * we do keep is a note that the offer was already made, in storage, so it is made exactly once.
 *
 * `inspect()`, NOT `getValue()`: only an EXPLICIT user value is a preference worth migrating.
 */
const LANGUAGE_MIGRATION_STORAGE_KEY = 'openide.language.migrationOffered';

class OpenideLanguageMigrationContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguagePackService private readonly languagePackService: ILanguagePackService,
		@ILocaleService private readonly localeService: ILocaleService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		void this.migrate();
	}

	private async migrate(): Promise<void> {
		if (this.storageService.getBoolean(LANGUAGE_MIGRATION_STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return;
		}
		const inspected = this.configurationService.inspect(OPENIDE_LANGUAGE_SETTING);
		const wanted = inspected.userValue ?? inspected.workspaceValue;
		if (wanted !== 'es' && wanted !== 'en') {
			return; // Never set by hand, or `auto` — which the locale now does by definition.
		}
		if (resolveOpenideLanguage(String(platformLanguage)) === wanted) {
			// The IDE already shows that language: there is nothing to carry over.
			this.remember();
			return;
		}
		// The two disagreed, which is the mixed interface this change exists to end. Offer the move
		// instead of performing it: switching the display language installs an extension and
		// reloads the window, and neither belongs in a silent startup task.
		const pack = await this.findLanguagePack(String(wanted));
		if (!pack) {
			// Offline, no gallery, or no pack for that language. Try again next start rather than
			// burn the one-time offer on a transient failure.
			return;
		}
		this.notificationService.prompt(
			Severity.Info,
			localize('openide.language.migrate', "OpenIDE now uses a single display language for the whole interface. Switch the IDE to {0}?", pack.label),
			[{
				label: localize('openide.language.migrate.yes', "Change display language"),
				run: () => void this.localeService.setLocale(pack),
			}],
			// Sticky: a one-time offer that ends in a window reload. The default Info toast hides
			// itself after a few seconds, and an offer the user blinks and misses never happens.
			{ sticky: true, onCancel: () => this.remember() },
		);
		this.remember();
	}

	private async findLanguagePack(language: string): Promise<ILanguagePackItem | undefined> {
		const matches = (packs: readonly ILanguagePackItem[]) => packs.find(pack => pack.id?.toLowerCase().startsWith(language));
		const installed = await this.languagePackService.getInstalledLanguages().catch(() => []);
		return matches(installed) ?? matches(await this.languagePackService.getAvailableLanguages().catch(() => []));
	}

	private remember(): void {
		this.storageService.store(LANGUAGE_MIGRATION_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(OpenideLanguageMigrationContribution, LifecyclePhase.Eventually);

class OpenideLocalPreviewOpenerContribution implements IWorkbenchContribution {
	constructor(
		@IExternalUriOpenerService externalUriOpenerService: IExternalUriOpenerService,
		@IBrowserViewWorkbenchService browserViewService: IBrowserViewWorkbenchService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const extraHosts = () => {
			const raw = configurationService.getValue<string[]>('openide.agent.browserAllowedHosts');
			return Array.isArray(raw) ? raw.map(String) : [];
		};
		const provider: IExternalOpenerProvider = {
			getOpeners(_targetUri: URI): AsyncIterable<IExternalUriOpener> {
				const opener: IExternalUriOpener = {
					id: 'openide.localPreview',
					label: localize('openide.preview.opener', "Abrir en la vista previa del IDE"),
					async canOpen(uri: URI, _token: CancellationToken): Promise<ExternalUriOpenerPriority> {
						const isLocal = (uri.scheme === 'http' || uri.scheme === 'https') && !!normalizeLocalUrl(uri.toString(true), extraHosts());
						// 'Option' does NOT override the browser: it adds the option → the native picker appears.
						return isLocal ? ExternalUriOpenerPriority.Option : ExternalUriOpenerPriority.None;
					},
					async openExternalUri(uri: URI, _ctx: { sourceUri: URI }, _token: CancellationToken): Promise<boolean> {
						const url = normalizeLocalUrl(uri.toString(true), extraHosts());
						if (!url) {
							return false;
						}
						await browserViewService.openPreview(url);
						return true;
					},
				};
				return (async function* () { yield opener; })();
			},
		};
		const reg: IDisposable = externalUriOpenerService.registerExternalOpenerProvider(provider);
		void reg; // vive por la vida del workbench
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(OpenideLocalPreviewOpenerContribution, LifecyclePhase.Restored);

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
	id: CHANNEL_ID,
	label: 'OpenIDE Agent',
	log: false,
});
Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels).registerChannel({
	id: MARKDOWN_CHANNEL_ID,
	label: 'OpenIDE Markdown',
	log: false,
});

// Markdown QA: a fast, read-only pass over the active document. It complements the native
// preview by reporting structural mistakes that are easy to miss when a document is large, while
// deliberately leaving rendering and filesystem validation to their existing owners.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.markdown.validate',
			title: localize2('openide.markdown.validate', 'OpenIDE: Validar Markdown activo'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const outputService = accessor.get(IOutputService);
		const activeTextEditor = editorService.activeTextEditorControl;
		const editor = isCodeEditor(activeTextEditor) ? activeTextEditor : undefined;
		const model = editor?.getModel();
		const resource = model?.uri ?? editorService.activeEditor?.resource;
		const isMarkdown = model?.getLanguageId() === 'markdown' || resource?.path.toLowerCase().endsWith('.md');

		if (!model || !resource || !isMarkdown) {
			notificationService.warn(localize('openide.markdown.validate.notMarkdown', 'Abrí un archivo Markdown para ejecutar esta validación.'));
			return;
		}

		const report = validateOpenideMarkdown(model.getValue());
		const errors = report.diagnostics.filter(item => item.severity === 'error').length;
		const warnings = report.diagnostics.filter(item => item.severity === 'warning').length;
		const fileName = resource.path.split('/').pop() || resource.path;
		const stats = report.stats;
		const lines = [
			`OpenIDE Markdown · ${fileName}`,
			'─'.repeat(Math.max(32, fileName.length + 21)),
			`Encabezados: ${stats.headings} · Enlaces: ${stats.links} · Imágenes: ${stats.images}`,
			`Tareas: ${stats.completedTasks}/${stats.tasks} completas · Bloques de código: ${stats.codeBlocks}`,
			'',
		];
		if (!report.diagnostics.length) {
			lines.push('✓ No se encontraron problemas estructurales.');
		} else {
			lines.push('Diagnósticos:');
			for (const item of report.diagnostics) {
				const marker = item.severity === 'error' ? '✕' : item.severity === 'warning' ? '⚠' : 'ℹ';
				lines.push(`${marker} ${item.line}:${item.column} ${item.message}`);
			}
		}

		outputService.getChannel(MARKDOWN_CHANNEL_ID)?.replace(lines.join('\n') + '\n');
		await outputService.showChannel(MARKDOWN_CHANNEL_ID, true);
		const summary = errors || warnings
			? localize('openide.markdown.validate.summary', 'Markdown: {0} errores y {1} advertencias.', errors, warnings)
			: localize('openide.markdown.validate.clean', 'Markdown válido: no se encontraron problemas estructurales.');
		if (errors) {
			notificationService.error(summary);
		} else if (warnings) {
			notificationService.warn(summary);
		} else {
			notificationService.info(summary);
		}
	}
});

// Chat view in the right dock (auxiliary bar). isDefault → replaces the secondary sidebar toggle.
const OPENIDE_CHAT_CONTAINER_ID = 'workbench.view.openideChat';
const OPENIDE_CHAT_VIEW_ID = 'workbench.view.openideChat.view';
// Product icons: the glyphs live in the OpenIDE font (f200/f201), not as embedded SVG.
// This way theme, activity bar and webview share the same semantics and metrics.
const openideChatIcon = registerIcon('openide-chat', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-chat']) }, localize('openide.chat.icon', "Icono del chat global de OpenIDE"));
const openideCliChangesIcon = registerIcon('openide-cli-changes', Codicon.gitPullRequestGoToChanges, localize('openide.cliChanges.icon', "Icono de Cambios del agente"));
registerIcon('openide-agent-tree', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-agent-tree']) }, localize('openide.agentTree.icon', "Icono del árbol de agentes de OpenIDE"));
registerIcon('openide-mode-agent', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-agent']) }, localize('openide.mode.agent.icon', "Icono del modo Agent de OpenIDE"));
registerIcon('openide-mode-plan', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-plan']) }, localize('openide.mode.plan.icon', "Icono del modo Plan de OpenIDE"));
registerIcon('openide-mode-ask', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-ask']) }, localize('openide.mode.ask.icon', "Icono del modo Ask de OpenIDE"));

const openideChatContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: OPENIDE_CHAT_CONTAINER_ID,
	title: localize2('openide.chat.container', "OpenIDE Chat"),
	icon: openideChatIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OPENIDE_CHAT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: OPENIDE_CHAT_CONTAINER_ID,
	order: 0,
	hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

const openideChatViewDescriptor: IViewDescriptor = {
	id: OPENIDE_CHAT_VIEW_ID,
	name: localize2('openide.chat.view', "OpenIDE Chat"),
	containerIcon: openideChatIcon,
	ctorDescriptor: new SyncDescriptor(OpenideChatViewPane),
	canToggleVisibility: false,
	canMoveView: true,
};
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([openideChatViewDescriptor], openideChatContainer);

/**
 * Agent Changes: what each hosted CLI touched, grouped by conversation turn.
 *
 * In the activity bar beside Source Control rather than inside the dock, because the question it
 * answers outlives the conversation that produced it — you come back to review a change after
 * the transcript has scrolled, and often after the agent has moved on to something else.
 *
 * `hideIfEmpty` so the icon does not sit there claiming a feature nobody is using: it appears
 * the first time a CLI session actually changes something.
 */
const openideCliChangesContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: OPENIDE_CLI_CHANGES_VIEW_ID,
	title: { value: t('cliChanges.title'), original: 'Agent Changes' },
	icon: openideCliChangesIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OPENIDE_CLI_CHANGES_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: OPENIDE_CLI_CHANGES_VIEW_ID,
	order: 4,
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: OPENIDE_CLI_CHANGES_VIEW_ID,
	name: { value: t('cliChanges.title'), original: 'Agent Changes' },
	containerIcon: openideCliChangesIcon,
	ctorDescriptor: new SyncDescriptor(OpenideCliChangesView),
	canToggleVisibility: false,
	canMoveView: true,
}], openideCliChangesContainer);

/**
 * The view's empty state, which is what it shows most of the time. It is the workbench's own
 * welcome view — the same component behind "You have not yet opened a folder" in the Explorer — so
 * the fork does not carry a second empty-state design that has to be kept in step with the IDE's.
 * Each line is a paragraph; a line that is only a link renders as the primary button.
 */
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViewWelcomeContent(OPENIDE_CLI_CHANGES_VIEW_ID, {
	content: `${t('cliChanges.empty')}\n${t('cliChanges.emptyHint')}\n[${t('cliChanges.emptyAction')}](command:openide.agent.newChat)`,
	when: 'default',
});

// Project Map: native graph editor (canvas + workbench panels) over the same index the agent tools use.
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideMemoryInput.ID, OpenideMemoryInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideProjectMapEditor, OpenideProjectMapEditor.ID, localize('openide.memory.editorName', "Project Map")),
	[new SyncDescriptor(OpenideMemoryInput)]
);

// Comando: abrir el Project Map.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.memory.open',
			title: localize2('openide.memory.open', 'OpenIDE: Open Project Map'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(OpenideMemoryInput));
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.memory.rebuild', title: localize2('openide.memory.rebuild', 'OpenIDE: Rebuild Codebase Memory'), category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(ICodebaseMemoryService).rebuildFull(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.memory.clear', title: localize2('openide.memory.clear', 'OpenIDE: Clear Codebase Memory'), category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(ICodebaseMemoryService).clear(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.memory.status', title: localize2('openide.memory.status', 'OpenIDE: Codebase Memory Status'), category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { const version = await accessor.get(ICodebaseMemoryService).getVersion(); accessor.get(INotificationService).info(version ? `Project Map: ${version.nodeCount} nodos, ${version.edgeCount} relaciones, versión ${version.version}.` : 'Project Map: índice aún no construido.'); }
});

// OpenIDE entry point for the native browser. It keeps the localhost validation for the tools and
// delegates navigation, DevTools, inspector, captures and persistence to the Code OSS BrowserView.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.browser.open',
			title: localize2('openide.browser.open', 'OpenIDE: Vista previa localhost'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, urlArg?: string): Promise<void> {
		// the accessor is only valid synchronously: resolve EVERYTHING before the first await
		const browserViewService = accessor.get(IBrowserViewWorkbenchService);
		const extraHosts = accessor.get(IConfigurationService).getValue<string[]>('openide.agent.browserAllowedHosts');
		let url = typeof urlArg === 'string' ? normalizeLocalUrl(urlArg, extraHosts) : undefined;
		// Without a URL, it focuses the workspace's single preview. If it does not exist yet, it opens
		// its native empty state: navigation will arrive from the frontend port the agent started.
		// It never suggests localhost:3000 again, nor replaces an already-navigated preview.
		await browserViewService.openPreview(url);
	}
});

// Pick & Polish: visual picker over the local app (a window with a selection overlay).
// The clicked element (selector + HTML + styles + screenshot) is attached to the chat composer.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.pickElement',
			title: localize2('openide.agent.pickElement', 'OpenIDE: Elegir elemento de la app (Pick & Polish)'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, urlArg?: string): Promise<void> {
		// the accessor is only valid synchronously: resolve EVERYTHING before the first await
		const editorService = accessor.get(IEditorService);
		const quickInput = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const agentService = accessor.get(IOpenideAgentService);
		const extraHosts = accessor.get(IConfigurationService).getValue<string[]>('openide.agent.browserAllowedHosts');
		// sin arg: usar la URL de la vista previa activa; sin preview: pedirla
		let url = typeof urlArg === 'string' ? normalizeLocalUrl(urlArg, extraHosts) : undefined;
		if (!url) {
			const active = editorService.activeEditor;
			if (active instanceof BrowserEditorInput && active.url) {
				url = normalizeLocalUrl(active.url, extraHosts);
			}
		}
		if (!url) {
			const typed = await quickInput.input({
				prompt: localize('openide.agent.pickPrompt', "URL de tu app local para elegir el elemento"),
				value: 'http://localhost:3000',
				ignoreFocusLost: true,
			});
			if (!typed) {
				return;
			}
			url = normalizeLocalUrl(typed, extraHosts);
			if (!url) {
				notificationService.warn(localize('openide.agent.pickInvalid', "URL no permitida: el picker es solo para apps locales."));
				return;
			}
		}
		try {
			const picked = await agentService.pickElement(url);
			if (picked) {
				notificationService.info(localize('openide.agent.pickDone', "Elemento adjuntado al chat: contale al agente qué querés cambiar."));
			}
		} catch (e) {
			notificationService.error(e instanceof Error ? e.message : String(e));
		}
	}
});

/**
 * Undo of an automatic account switch, behind the button the failover notice puts in the transcript.
 * Not on the palette: it only means anything right after a switch, and the notice is the only place
 * that knows one happened.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.undoAccountFailover',
			title: localize2('openide.agent.undoAccountFailover', 'Agente IA: Volver a la cuenta anterior'),
			category: Categories.Preferences,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IOpenideAgentService).undoAccountFailover();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.openProviders',
			title: localize2('openide.agent.openProviders', 'Agente IA: Conectar proveedor…'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const preferencesService = accessor.get(IPreferencesService);
		const pane = await preferencesService.openSettings({ jsonEditor: false, query: '' });
		if (pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory('openideAgent/providers');
		}
	}
});

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideSkillInstallerEditor, OpenideSkillInstallerEditor.ID, localize('openide.skillInstaller.editorName', "Instalar Skill")),
	[new SyncDescriptor(OpenideSkillInstallerInput)]
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.openExtensions',
			title: localize2('openide.agent.openExtensions', 'Agente IA: Skills'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const preferencesService = accessor.get(IPreferencesService);
		const pane = await preferencesService.openSettings({ jsonEditor: false, query: '' });
		if (pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory('openideAgent/skills');
		}
	}
});

// Full-screen diagram viewer (native MODAL + zoom). The chat opens it with the SVG/HTML
// already rendered — it replaces the webview's home-made modal (confined to the panel).
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideDiagramEditor, OpenideDiagramEditor.ID, localize('openide.diagram.editorName', "Diagrama")),
	[new SyncDescriptor(OpenideDiagramInput)]
);
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.diagram.fullscreen',
			title: localize2('openide.diagram.fullscreen', 'OpenIDE: Diagrama a pantalla completa'),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, content?: unknown, title?: string): Promise<void> {
		const payload = toOpenideDiagramPayload(content);
		if (!payload) {
			return;
		}
		const editorService = accessor.get(IEditorService);
		// Native MODAL (the same one Settings uses); the viewer is a plain EditorPane now.
		await editorService.openEditor(new OpenideDiagramInput(payload, typeof title === 'string' && title ? title : 'Diagrama'), undefined, MODAL_GROUP);
	}
});

// Command: open the agent's fine-grained settings in the native Settings ("AI Agent" section).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.openSettings',
			title: localize2('openide.agent.openSettings', 'Agente IA: Ajustes'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, section?: string): Promise<void> {
		const preferencesService = accessor.get(IPreferencesService);
		const categoryBySection: Record<string, string> = {
			home: 'commonlyUsed',
			commonlyUsed: 'commonlyUsed',
			editor: 'editor',
			workbench: 'workbench',
			window: 'window',
			chat: 'openideAgent/chat',
			context: 'openideAgent/context',
			commands: 'openideAgent/commands',
			subagents: 'openideAgent/subagents',
			browser: 'openideAgent/browser',
			advanced: 'openideAgent/advanced',
			features: 'features',
			application: 'application',
			security: 'security',
			extensionsRoot: 'features/extensions',
		};
		const category = typeof section === 'string' ? categoryBySection[section] : 'commonlyUsed';
		const pane = await preferencesService.openSettings({
			jsonEditor: false,
			// We clear previous searches. The category is selected in the real tree so that
			// "All settings" and the rest of the rail stay available at all times.
			query: '',
		});
		if (pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory(category);
		}
	}
});

// ---- Inline review of agent edits (integrated): per-block/per-file keybindings.
// Active only with a review session in the focused editor (CTX_OPENIDE_REVIEW_ACTIVE) —
// outside the review, Ctrl+N / Ctrl+Y / Ctrl+Enter keep their normal meaning (e.g. Ctrl+Y redo).
const REVIEW_WHEN = ContextKeyExpr.and(CTX_OPENIDE_REVIEW_ACTIVE, EditorContextKeys.editorTextFocus);
function registerReviewAction(id: string, title: string, action: ReviewAction, primary?: number): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id,
				title,
				category: Categories.View,
				f1: false,
				precondition: CTX_OPENIDE_REVIEW_ACTIVE,
				keybinding: primary ? { weight: KeybindingWeight.WorkbenchContrib + 10, when: REVIEW_WHEN, primary } : undefined,
			});
		}
		run(accessor: ServicesAccessor): void {
			accessor.get(IOpenideAgentService).reviewAction(action);
		}
	});
}
registerReviewAction('openide.review.undoBlock', localize('openide.review.undoBlockTitle', "Agente: Deshacer bloque del review"), 'undoBlock', KeyMod.CtrlCmd | KeyCode.KeyN);
registerReviewAction('openide.review.keepBlock', localize('openide.review.keepBlockTitle', "Agente: Conservar bloque del review"), 'keepBlock', KeyMod.CtrlCmd | KeyCode.KeyY);
registerReviewAction('openide.review.keepFile', localize('openide.review.keepFileTitle', "Agente: Conservar archivo del review"), 'keepFile', KeyMod.CtrlCmd | KeyCode.Enter);
registerReviewAction('openide.review.undoFile', localize('openide.review.undoFileTitle', "Agente: Deshacer archivo del review"), 'undoFile');
registerReviewAction('openide.review.nextBlock', localize('openide.review.nextBlockTitle', "Agente: Siguiente bloque del review"), 'nextBlock', KeyMod.Alt | KeyCode.F5);
registerReviewAction('openide.review.prevBlock', localize('openide.review.prevBlockTitle', "Agente: Bloque anterior del review"), 'prevBlock', KeyMod.Alt | KeyMod.Shift | KeyCode.F5);

// ---- PLAN MODE: native editor buttons over plans (.openide/plans/*.md) ----
// They appear in the editor title only with a plan open (regex over resourcePath).
const PLAN_GLOB = '**/.openide/plans/*.md';

// Editor de plan PROPIO (webview: markdown lindo + toolbar Modelo/Build + tareas interactivas).
// Replaces the native markdown preview. Registered as DEFAULT for .openide/plans/*.md
// through the resolver (opening the file from the explorer uses it too); "Open as text" in the
// editor toolbar forces the native text editor (override DEFAULT_EDITOR_ASSOCIATION).
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenidePlanEditor, OpenidePlanEditor.ID, localize('openide.plan.editorName', "Plan")),
	[new SyncDescriptor(OpenidePlanInput)]
);
class OpenidePlanEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		const reg: IDisposable = editorResolverService.registerEditor(
			PLAN_GLOB,
			{ id: OpenidePlanInput.EDITOR_ID, label: localize('openide.plan.editorLabel', "Plan de OpenIDE"), priority: RegisteredEditorPriority.exclusive },
			{ singlePerResource: true, canSupportResource: resource => /\.openide[\/\\]plans[\/\\][^\/\\]+\.md$/.test(resource.path) },
			{ createEditorInput: ({ resource }) => ({ editor: new OpenidePlanInput(resource) }) }
		);
		void reg; // vive por la vida del workbench
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(OpenidePlanEditorResolverContribution, LifecyclePhase.Restored);

// Subagentes: editor especializado para definiciones Markdown del workspace/importadas.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideSubagentEditor, OpenideSubagentEditor.ID, localize('openide.subagent.editorName', "Subagent")),
	[new SyncDescriptor(OpenideSubagentInput)]
);
class OpenideSubagentEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService resolver: IEditorResolverService) {
		for (const glob of ['**/.openide/agents/*.md', '**/.cursor/agents/*.md']) {
			resolver.registerEditor(glob, { id: OpenideSubagentInput.EDITOR_ID, label: localize('openide.subagent.editorLabel', "Subagent de OpenIDE"), priority: RegisteredEditorPriority.default }, { singlePerResource: true }, { createEditorInput: ({ resource }) => ({ editor: new OpenideSubagentInput(resource) }) });
		}
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(OpenideSubagentEditorResolverContribution, LifecyclePhase.Restored);
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.subagent.create', title: localize2('openide.subagent.create', 'OpenIDE: Create Subagent'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const quick = accessor.get(IQuickInputService); const files = accessor.get(IFileService); const editors = accessor.get(IEditorService);
		const name = (await quick.input({ title: 'Create Subagent', prompt: 'Nombre en kebab-case' }))?.trim(); if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) { return; }
		const description = (await quick.input({ prompt: 'Descripción y cuándo utilizarlo' }))?.trim(); if (!description) { return; }
		const folder = accessor.get(IWorkspaceContextService).getWorkspace().folders[0]; if (!folder) { return; }
		const root = joinPath(folder.uri, '.openide', 'agents'); await files.createFolder(root); const resource = joinPath(root, `${name}.md`);
		await files.createFile(resource, VSBuffer.fromString(`---\nname: ${name}\nmodel: default\ndescription: ${JSON.stringify(description)}\nreadonly: true\nis_background: false\ntools:\n  - read_file\n  - search_text\n  - find_files\n  - get_diagnostics\n---\n\nSos un subagente especializado en ${description}.\n`));
		await editors.openEditor({ resource, options: { override: OpenideSubagentInput.EDITOR_ID, pinned: true } });
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.subagent.openEditor', title: localize2('openide.subagent.openEditor', 'OpenIDE: Open Subagent Editor'), f1: true }); }
	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> { const editors = accessor.get(IEditorService); const resource = resourceArg instanceof URI ? resourceArg : editors.activeEditor?.resource; if (resource) { await editors.openEditor({ resource, options: { override: OpenideSubagentInput.EDITOR_ID, pinned: true } }); } }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.subagent.openText', title: localize2('openide.subagent.openText', 'OpenIDE: Open Subagent as Text'), f1: true }); }
	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> { const editors = accessor.get(IEditorService); const resource = resourceArg instanceof URI ? resourceArg : editors.activeEditor?.resource; if (resource) { await editors.openEditor({ resource, options: { override: 'default', pinned: true } }); } }
});

// Canvas: editor visual default para el artefacto real .openide/canvases/*.canvas.tsx.
const CANVAS_GLOB = '**/.openide/canvases/*.canvas.tsx';
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideCanvasInput.ID, OpenideCanvasInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideCanvasEditor, OpenideCanvasEditor.ID, localize('openide.canvas.editorName', "Canvas")),
	[new SyncDescriptor(OpenideCanvasInput)]
);
class OpenideCanvasEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		const reg = editorResolverService.registerEditor(
			CANVAS_GLOB,
			{ id: OpenideCanvasInput.EDITOR_ID, label: localize('openide.canvas.editorLabel', "Canvas de OpenIDE"), priority: RegisteredEditorPriority.default },
			{ singlePerResource: true, canSupportResource: resource => /\.openide[\/\\]canvases[\/\\][^\/\\]+\.canvas\.tsx$/.test(resource.path) },
			{ createEditorInput: ({ resource }) => ({ editor: new OpenideCanvasInput(resource) }) }
		);
		void reg;
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(OpenideCanvasEditorResolverContribution, LifecyclePhase.Restored);

registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.canvas.open', title: localize2('openide.canvas.open', 'Canvas: Abrir'), f1: false }); }
	async run(accessor: ServicesAccessor, resourceArg?: URI | string): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const canvasService = accessor.get(IOpenideCanvasService);
		const resource = resourceArg instanceof URI ? resourceArg : (typeof resourceArg === 'string' ? canvasService.resolve(resourceArg) : editorService.activeEditor?.resource);
		if (resource) { await editorService.openEditor({ resource, options: { override: OpenideCanvasInput.EDITOR_ID, pinned: true } }); }
	}
});

// Command: open a plan in our own editor (invoked by plan_save and the chat card). It forces
// THIS editor by overriding the default resolver.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.plan.open',
			title: localize2('openide.plan.open', 'Plan: Abrir en el editor de plan'),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const resource = resourceArg instanceof URI ? resourceArg : editorService.activeEditor?.resource;
		if (!resource) {
			return;
		}
		await editorService.openEditor({ resource, options: { override: OpenidePlanInput.EDITOR_ID, pinned: true } });
	}
});

// Plan: choose the EXECUTION model (frontmatter execModel). It accepts an optional URI as an
// arg — the chat invokes it via executeCommand from the plan card (same QuickPick).
registerAction2(class extends Action2 {
	constructor() {
			super({
			id: 'openide.plan.execModel',
			title: localize2('openide.plan.execModel', 'Plan: Modelo de ejecución'),
			icon: planExecutionModelIcon,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> {
		// the accessor is only valid synchronously: resolve EVERYTHING before the first await
		const editorService = accessor.get(IEditorService);
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		const resource = resourceArg instanceof URI ? resourceArg : editorService.activeEditor?.resource;
		if (!resource) {
			return;
		}
		// models from every CONNECTED provider (same criterion as the chat popover)
		const items: (IQuickPickItem & { model: string })[] = [];
		for (const p of agent.listProviders()) {
			try {
				if (!(await agent.isConnected(p.id))) {
					continue;
				}
			} catch {
				continue;
			}
			const models = await agent.resolveProviderModels(p);
			for (const model of models) {
				items.push({ label: model, description: p.label, model });
			}
		}
		if (!items.length) {
			notificationService.info(localize('openide.plan.execModel.none', "No hay proveedores de IA conectados — conectá uno en \"Proveedores de IA\"."));
			return;
		}
		const picked = await quickInput.pick(items, { placeHolder: localize('openide.plan.execModel.ph', "Modelo con el que se EJECUTA el plan") });
		if (!picked) {
			return;
		}
		try {
			await agent.setPlanExecutionModel(resource, picked.model);
			notificationService.info(localize('openide.plan.execModel.done', "Modelo de ejecución del plan: {0}.", picked.model));
		} catch (e) {
			notificationService.error(localize('openide.plan.execModel.err', "No se pudo actualizar el plan: {0}", e instanceof Error ? e.message : String(e)));
		}
	}
});

// Plan: Build — aprueba el plan (frontmatter → aprobado, cambia el modelo si corresponde) y
// the chat launches the execution run as a normal turn (onDidRequestPlanBuild).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.plan.build',
			title: localize2('openide.plan.build', 'Plan: Build (ejecutar el plan)'),
			icon: Codicon.play,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		const resource = accessor.get(IEditorService).activeEditor?.resource;
		if (!resource) {
			return;
		}
		try {
			await agent.buildPlan(resource);
		} catch (e) {
			notificationService.error(localize('openide.plan.build.err', "No se pudo ejecutar el plan: {0}", e instanceof Error ? e.message : String(e)));
		}
	}
});

/**
 * Ask the agent about something, in a conversation of its own.
 *
 * A COMMAND rather than a direct call because the caller is the Project Map — an EditorPane in
 * another folder — and the chat view's id lives here, next to its registration. Routing through
 * the command registry is how every other surface in the fork reaches the dock (the Project Map
 * itself is opened from the chat header the same way), and it keeps the two from importing each
 * other. Not in the palette: it is meaningless without its argument.
 */
// Kept in sync by hand with `ASK_IN_NEW_CHAT_COMMAND` in projectMap/openideProjectMapEditor.ts:
// this file imports that one to register its editor pane, so the id cannot be shared as a symbol.
CommandsRegistry.registerCommand('openide.agent.askInNewChat', async (accessor, prompt?: unknown) => {
	if (typeof prompt !== 'string' || !prompt.trim()) {
		return;
	}
	const viewsService = accessor.get(IViewsService);
	const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
	view?.askInNewChat(prompt);
});

// Command: open the chat's context breakdown panel. Triggered by the indicator
// ████░░░░░░ del status bar (footer nativo del agente).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.showContext',
			title: localize2('openide.agent.showContext', 'OpenIDE Agent: Uso de contexto'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.showContextPanel();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.showUsage',
			title: localize2('openide.agent.showUsage', 'OpenIDE Agent: Usage de cuentas'),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, false);
		view?.showUsagePopover();
	}
});

// Style editor → composer bridge. The request is filled in but NOT sent: carrying a style into the
// source edits files, so the user reads it and presses Send.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.agent.injectPrompt', title: localize2('openide.agent.injectPrompt', 'OpenIDE Agent: Escribir un prompt en el chat'), f1: false }); }
	async run(accessor: ServicesAccessor, text?: string): Promise<void> {
		const prompt = typeof text === 'string' ? text.trim() : '';
		if (!prompt) { return; }
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.injectPrompt(prompt);
	}
});

// Internal Canvas → composer bridge. The choice stays visible/editable and the user confirms Send.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.agent.injectCanvasChoice', title: localize2('openide.agent.injectCanvasChoice', 'OpenIDE Agent: Usar elección del Canvas'), f1: false }); }
	async run(accessor: ServicesAccessor, choice?: { choiceId?: string; label?: string; canvas?: string }): Promise<void> {
		const label = typeof choice?.label === 'string' ? choice.label.trim().slice(0, 1000) : '';
		if (!label) { return; }
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.injectCanvasChoice({ choiceId: String(choice?.choiceId ?? '').slice(0, 160), label, canvas: typeof choice?.canvas === 'string' ? choice.canvas : undefined });
	}
});

// Command: a canvas button that runs a prompt in the chat (PromptButton).
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.agent.injectCanvasPrompt', title: localize2('openide.agent.injectCanvasPrompt', 'OpenIDE Agent: Ejecutar prompt del Canvas'), f1: false }); }
	async run(accessor: ServicesAccessor, request?: { prompt?: string; send?: boolean; canvas?: string }): Promise<void> {
		const prompt = typeof request?.prompt === 'string' ? request.prompt.trim().slice(0, 4000) : '';
		if (!prompt) { return; }
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.injectCanvasPrompt({ prompt, send: request?.send !== false, canvas: typeof request?.canvas === 'string' ? request.canvas : undefined });
	}
});
// Command: the editor selection, into the chat (Continue's "Add to Chat", Ctrl+L). The snippet
// becomes a chip above the prompt — path, lines, text captured NOW — and the prompt takes focus,
// so the shortcut is "point at this and ask". With nothing selected it only brings the chat up.
// Ctrl+L is bound only while a selection exists: without one the editor keeps its own
// "expand line selection", which is what the key means there.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.addSelectionToChat',
			title: localize2('openide.agent.addSelectionToChat', 'OpenIDE Agent: Agregar la selección al chat'),
			category: Categories.Help,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 10,
				when: ContextKeyExpr.and(EditorContextKeys.editorTextFocus, EditorContextKeys.hasNonEmptySelection),
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
			},
			menu: [{ id: MenuId.EditorContext, group: '0_openide', order: 1, when: EditorContextKeys.hasNonEmptySelection }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const snippet = selectionSnippet(accessor);
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		if (view && snippet) {
			view.attachSnippet(snippet);
		}
	}
});

/**
 * The active editor's selection as a snippet, or undefined when there is none.
 *
 * Continue's `getRangeInFileWithContents`: a selection that starts after nothing but whitespace
 * is widened to the start of its line, and one that ends at column 1 of a line does not include
 * that line — what the user sees as "these lines", not the caret's exact offsets.
 */
function selectionSnippet(accessor: ServicesAccessor): IComposerSnippet | undefined {
	const editor = accessor.get(ICodeEditorService).getActiveCodeEditor();
	const model = editor?.getModel();
	const selection = editor?.getSelection();
	if (!editor || !model || !selection || selection.isEmpty()) {
		return undefined;
	}
	const startLine = selection.startLineNumber;
	let startColumn = selection.startColumn;
	let endLine = selection.endLineNumber;
	let endColumn = selection.endColumn;
	if (!model.getLineContent(startLine).slice(0, startColumn - 1).trim()) {
		startColumn = 1;
	}
	if (endColumn === 1 && endLine > startLine) {
		endLine -= 1;
		endColumn = model.getLineMaxColumn(endLine);
	}
	const text = model.getValueInRange({ startLineNumber: startLine, startColumn, endLineNumber: endLine, endColumn });
	if (!text.trim()) {
		return undefined;
	}
	const uri = model.uri;
	const folder = accessor.get(IWorkspaceContextService).getWorkspaceFolder(uri);
	const path = folder ? uri.path.slice(folder.uri.path.length).replace(/^\//, '') || uri.path : uri.scheme === 'file' ? uri.fsPath : uri.path;
	return {
		path,
		startLine,
		endLine,
		text: text.length > SNIPPET_MAX_CHARS ? text.slice(0, SNIPPET_MAX_CHARS) + '…' : text,
		languageId: model.getLanguageId(),
		iconClasses: getIconClasses(accessor.get(IModelService), accessor.get(ILanguageService), uri, FileKind.FILE).join(' '),
		uri: uri.toString(),
	};
}

// Command: new chat (clears the conversation). Appears as an action in the chat panel title.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.newChat',
			title: localize2('openide.agent.newChat', 'OpenIDE Agent: Nuevo chat'),
			category: Categories.Help,
			f1: true,
			icon: Codicon.add,
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', order: 1, when: ContextKeyExpr.equals('view', OPENIDE_CHAT_VIEW_ID) }],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.newChat();
	}
});

// Command: fork the active conversation — an independent branch inheriting ALL the
// conversational state (like /fork). No merge: the branches diverge.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.forkChat',
			title: localize2('openide.agent.forkChat', 'OpenIDE Agent: Fork de la conversación'),
			category: Categories.Help,
			f1: true,
			icon: Codicon.repoForked,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = await viewsService.openView<OpenideChatViewPane>(OPENIDE_CHAT_VIEW_ID, true);
		view?.forkChat();
	}
});

// Advanced agent configuration. It does not modify the internal Settings TOC: our own visual
// surfaces manage providers/extensions and these keys remain available for search or
// settings.json. Credentials: SecretStorage, never settings.json.
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
// OpenIDE uses the contextual breadcrumb for plans/models; the top Command Center duplicates
// that navigation and steals height. It remains a user-overridable preference.
configurationRegistry.registerDefaultConfigurations([{ overrides: { 'window.commandCenter': false }, source: 'OpenIDE' }]);
// One icon language across the whole IDE: the Tabler product icon theme (theme-defaults) re-skins
// every codicon surface — activity bar, trees, toolbars and the chat's own glyphs. A user pick in
// workbench.productIconTheme still wins: this is a DEFAULT, not a lock.
configurationRegistry.registerDefaultConfigurations([{ overrides: { 'workbench.productIconTheme': 'openide-bootstrap' }, source: 'OpenIDE' }]);
configurationRegistry.registerConfiguration({
	id: 'openideAgent',
	order: 100,
	title: localize('openide.agent.title', "Agente IA"),
	type: 'object',
	properties: {
		// Retired: the display language is now the only switch, and OpenIDE's own strings read it
		// too. No `default` on purpose — a default of `'es'` made every fresh install Spanish
		// regardless of the user's locale, which is the opposite of following the IDE.
		// `OpenideLanguageMigrationContribution` carries an existing value over to the locale and
		// then removes the setting.
		'openide.language': {
			type: 'string',
			enum: ['auto', 'es', 'en'],
			order: 0,
			description: localize('openide.language', "Deprecated. OpenIDE now renders its own screens in the display language, so Settings › Language moves the whole interface at once."),
			deprecationMessage: localize('openide.language.deprecated', "Use the display language instead (Settings › Language). OpenIDE follows it for its own screens."),
		},
		[OPENIDE_IDE_SERVER_SETTING]: { type: 'boolean', default: true, description: localize('openide.ideServer.enabled', "Permite que los CLI de agentes (Claude Code, Codex, Gemini, opencode) se conecten a este IDE y usen sus herramientas: editores abiertos, selección, diagnósticos y diff. El servidor escucha solo en 127.0.0.1 y exige un token.") },
		'openide.subagents.enabled': { type: 'boolean', default: true, description: localize('openide.subagents.enabled', "Habilita definiciones y ejecuciones de subagentes.") },
		'openide.subagents.routing.enabled': { type: 'boolean', default: false, description: localize('openide.subagents.routing.enabled', "Selecciona provider/model por perfil de tarea y aplica fallback seguro. Apagado conserva el comportamiento legacy.") },
		'openide.subagents.routing.preset': { type: 'string', enum: ['manual', 'quality', 'balanced', 'savings'], default: 'balanced', description: localize('openide.subagents.routing.preset', "Preset visual para calidad, costo y latencia.") },
		'openide.subagents.routing.maxAttempts': { type: 'number', default: 3, minimum: 1, maximum: 10, description: localize('openide.subagents.routing.maxAttempts', "Máximo de targets que puede intentar un subagente antes de fallar.") },
		'openide.subagents.routing.policy': {
			type: 'object', default: { version: 1, preset: 'balanced', maxAttempts: 3, fallbackEnabled: true, profiles: {} },
			description: localize('openide.subagents.routing.policy', "Policy versionada de routing por perfiles. Se recomienda editarla desde Settings > Agente IA > Subagentes."),
			properties: {
				version: { type: 'number', enum: [1] },
				preset: { type: 'string', enum: ['manual', 'quality', 'balanced', 'savings'] },
				maxAttempts: { type: 'number', minimum: 1, maximum: 10 },
				fallbackEnabled: { type: 'boolean' },
				profiles: { type: 'object', additionalProperties: { type: 'object' } },
			},
		},
		'openide.subagents.maxParallelRuns': { type: 'number', default: 4, minimum: 1, maximum: 16, description: localize('openide.subagents.parallel', "Máximo de subagentes ejecutándose en paralelo.") },
		'openide.subagents.maxDepth': { type: 'number', default: 2, minimum: 0, maximum: 8, description: localize('openide.subagents.depth', "Profundidad máxima de delegación anidada.") },
		'openide.subagents.defaultTimeoutMinutes': { type: 'number', default: 15, minimum: 1, maximum: 240, description: localize('openide.subagents.timeout', "Timeout individual por subagente.") },
		'openide.subagents.defaultModel': { type: 'string', default: 'default', description: localize('openide.subagents.model', "Modelo por defecto; default usa el activo.") },
		'openide.subagents.defaultBackground': { type: 'boolean', default: false, description: localize('openide.subagents.background', "Ejecuta nuevos subagentes manuales en segundo plano.") },
		'openide.subagents.allowWritable': { type: 'boolean', default: false, description: localize('openide.subagents.writable', "Permite subagentes con escritura.") },
		'openide.subagents.useWorktrees': { type: 'boolean', default: true, description: localize('openide.subagents.worktrees', "Aísla escritores en worktrees Git cuando están disponibles.") },
		'openide.subagents.showDetailedToolCalls': { type: 'boolean', default: true, description: localize('openide.subagents.details', "Muestra timeline y tool calls en las cards.") },
		'openide.subagents.preserveCompletedRuns': { type: 'boolean', default: true, description: localize('openide.subagents.preserve', "Conserva runs terminados al reiniciar.") },
		'openide.subagents.globalDirectory': { type: 'string', default: '', description: localize('openide.subagents.globalDir', "Directorio global alternativo de agentes.") },
		// NOTE: the ACTIVE provider/model are no longer settings — they live in IStorageService and
		// are configured from the "AI Providers" page (openide.agent.openProviders) or the chat's
		// native model picker. Only power-user settings remain here.
		'openide.agent.customProviders': {
			type: 'array',
			default: [],
			order: 3,
			markdownDescription: localize('openide.agent.custom.desc', "Conectá cuentas, claves y modelos desde [Proveedores de IA](command:openide.agent.openProviders) — esta opción es solo para power-users. Proveedores custom: cualquier endpoint OpenAI-compatible (ej: un Ollama remoto, un proxy corporativo). Cada entrada: `{ id, label, protocol, baseUrl, defaultModel }`; `voiceModel` anuncia un modelo compatible con `input_audio`."),
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Identificador único' },
					label: { type: 'string', description: 'Nombre visible' },
					protocol: { type: 'string', enum: ['openai', 'anthropic'], default: 'openai' },
					baseUrl: { type: 'string', description: 'Base URL del endpoint (ej: http://localhost:11434/v1)' },
					defaultModel: { type: 'string' },
					voiceModel: { type: 'string', description: 'Modelo de dictado compatible con input_audio (opcional)' },
				},
				required: ['id'],
			},
		},
		'openide.agent.fallbackProviders': {
			type: 'array',
			default: [],
			order: 4,
			items: { type: 'string' },
			markdownDescription: localize('openide.agent.fallback.desc', "Cadena de failover heredada por proveedor (ej: `[\"groq\", \"ollama\"]`). Se usa cuando `fallbackChain` está vacía."),
		},
		'openide.agent.fallbackChain': {
			type: 'array',
			default: [],
			order: 5,
			markdownDescription: localize('openide.agent.fallbackChain.desc', "Failover ordenado por proveedor y modelo. Cada paso acepta `{ \"providerId\": \"openrouter\", \"model\": \"openai/gpt-5.5\" }`. Solo se activa antes de emitir contenido."),
			items: {
				type: 'object',
				properties: {
					providerId: { type: 'string' },
					model: { type: 'string' },
				},
				required: ['providerId'],
			},
		},
		'openide.agent.accountFailover': {
			type: 'string',
			enum: ['off', 'auto', 'ask'],
			enumDescriptions: [
				localize('openide.agent.accountFailover.off', "Corta el turno y explica que la cuenta se quedó sin cuota."),
				localize('openide.agent.accountFailover.auto', "Sigue en otra cuenta con margen y avisa después. Pregunta igual si hay más de una candidata o si la otra cuenta es medida."),
				localize('openide.agent.accountFailover.ask', "Pregunta siempre a qué cuenta seguir."),
			],
			default: 'off',
			order: 6,
			description: localize('openide.agent.accountFailover.desc', "Qué hacer cuando la cuenta activa de un proveedor se queda sin cuota y hay otra conectada del mismo proveedor. Por defecto no hace nada: cambiar de cuenta gasta otra suscripción."),
		},
		'openide.memory.enabled': { type: 'boolean', default: true, order: 20, description: localize('openide.memory.enabled', 'Habilita la memoria del codebase.') },
		'openide.memory.indexOnOpen': { type: 'boolean', default: true, order: 21, description: localize('openide.memory.indexOnOpen', 'Valida y actualiza la memoria al abrir el workspace.') },
		'openide.memory.incrementalIndexing': { type: 'boolean', default: true, order: 22, description: localize('openide.memory.incremental', 'Actualiza sólo archivos modificados mediante watcher.') },
		'openide.memory.persistIndex': { type: 'boolean', default: true, markdownDescription: localize('openide.memory.persist', 'Guarda el índice en el almacenamiento del perfil de OpenIDE (nunca dentro del proyecto) para reutilizarlo entre sesiones. Al apagarlo se borra lo ya escrito y el índice vive sólo en memoria: cada ventana nueva lo reconstruye desde cero.'), order: 23 },
		'openide.memory.maxContextTokens': { type: 'number', default: 3000, minimum: 500, maximum: 12000, order: 24, description: localize('openide.memory.maxContext', 'Presupuesto máximo de Project Map recuperado automáticamente.') },
		'openide.memory.maxRetrievedNodes': { type: 'number', default: 24, minimum: 3, maximum: 100, order: 25, description: localize('openide.memory.maxNodes', 'Máximo de nodos relevantes recuperados para el agente.') },
		'openide.memory.maxTraversalDepth': { type: 'number', default: 3, minimum: 1, maximum: 6, order: 26, description: localize('openide.memory.maxDepth', 'Techo de profundidad para los recorridos del grafo (explore, impacto, callers). 1-2 = vecindad inmediata; 4+ sólo tiene sentido en consultas muy acotadas.') },
		'openide.memory.visualization.defaultMode': { type: 'string', enum: ['architecture', 'graph', 'dependencies', 'impact', 'matrix'], default: 'architecture', order: 27, description: localize('openide.memory.defaultMode', 'Modo inicial del editor Project Map.') },
		'openide.memory.visualization.maxVisibleNodes': { type: 'number', default: 300, minimum: 50, maximum: 2000, order: 28, description: localize('openide.memory.maxVisible', 'Máximo de elementos visibles en la arquitectura.') },
		'openide.memory.visualization.maxRelationDepth': { type: 'number', default: 2, minimum: 1, maximum: 5, order: 29, description: localize('openide.memory.maxRelationDepth', 'Profundidad máxima de relaciones visibles.') },
		'openide.memory.visualization.showHeuristicEdges': { type: 'boolean', default: true, order: 30, description: localize('openide.memory.heuristicEdges', 'Muestra relaciones heurísticas con estilo discontinuo.') },
		[CODEBASE_NOTES_ENABLED_SETTING]: { type: 'boolean', default: true, order: 31, markdownDescription: localize('openide.memory.notes.enabled', 'Indexa la memoria compartida (`.openide/MEMORY.md`) dentro del grafo: cada entrada pasa a ser un nodo que Project Map devuelve junto con el código del que habla. Apagarlo NO borra el archivo — sigue estando en el repo y se sigue inyectando al prompt del agente propio; solo deja de aparecer en las consultas al grafo.') },
		[CODEBASE_NOTES_LINKING_SETTING]: {
			type: 'string', enum: ['explicit', 'identifiers', 'off'], default: 'explicit', order: 32,
			enumDescriptions: [
				localize('openide.memory.notes.linking.explicit', 'Solo lo que marcaste con `backticks` o [[corchetes]]. Es lo más seguro: nunca conecta algo que no pediste.'),
				localize('openide.memory.notes.linking.identifiers', 'Además intenta con palabras sueltas que parezcan código (camelCase, PascalCase, snake_case). Sirve para notas viejas escritas sin marcar; a cambio, alguna relación puede salir mal.'),
				localize('openide.memory.notes.linking.off', 'No conecta notas con entidades. Las notas siguen en el grafo como hechos sueltos y las consultas las siguen devolviendo.'),
			],
			markdownDescription: localize('openide.memory.notes.linking', 'Cuánto se esfuerza OpenIDE en colgar una nota de la entidad de la que habla. En cualquier modo, una mención solo genera relación si resuelve a UN único nodo: lo ambiguo nunca conecta.'),
		},
		[CODEBASE_NOTES_MAX_CHARS_SETTING]: { type: 'number', default: 3000, minimum: 500, maximum: 100000, order: 32.5, markdownDescription: localize('openide.memory.notes.maxChars', 'Techo en caracteres de `.openide/MEMORY.md`. Al superarlo, la herramienta de memoria pide consolidar en vez de seguir creciendo. Estaba dimensionado para inyectar el archivo entero al prompt; ahora que las consultas al grafo recortan solas se puede subir, pero cada carácter sigue costando presupuesto en el prompt del agente propio.') },
		'openide.memory.exclude': { type: 'array', default: [], order: 33, items: { type: 'string' }, markdownDescription: localize('openide.memory.exclude', 'Patrones glob que el índice ignora, además de los excluidos por defecto (`node_modules`, `dist`, `.git`, …). Un patrón sin comodines ni extensión (`docs`) cubre también todo su subárbol. Cambiarlo dispara una reconstrucción.') },
		'openide.memory.include': { type: 'array', default: [], order: 34, items: { type: 'string' }, markdownDescription: localize('openide.memory.include', 'Si tiene patrones, SÓLO se indexa lo que matchee (útil para acotar un monorepo a `src`). Un patrón con extensión (`**/*.vue`) además amplía los tipos de archivo indexados. Vacío = indexar todo lo no excluido.') },
		'openide.memory.indexTests': { type: 'boolean', default: true, order: 35, markdownDescription: localize('openide.memory.indexTests', 'Indexa archivos de test (`*.test.ts`, `*_test.go`, `test_*.py`, …). Al apagarlo, la tool `memory_graph_related_tests` deja de encontrar tests y se pierde el grafo de "qué prueba a qué".') },
		'openide.memory.enableRegexFallback': { type: 'boolean', default: true, order: 36, markdownDescription: localize('openide.memory.regex', 'Extrae símbolos e imports por regex (confianza baja) cuando no hay evidencia del language server. Al apagarlo sólo quedan los símbolos verificados: se pierden las relaciones `IMPORTS`/`DEPENDS_ON`, y con ellas la matriz de módulos y `memory_graph_path`.') },
		'openide.memory.showHeuristicRelations': { type: 'boolean', default: true, order: 37, markdownDescription: localize('openide.memory.showHeuristic', 'Incluye las relaciones inferidas por heurística (regex/texto) en las respuestas que recibe el agente. Al apagarlo sólo viajan las verificadas por el language server: más precisas, pero muchas menos.') },
		'openide.agent.contextTokens': {
			type: 'number',
			default: 0,
			order: 10,
			description: localize('openide.agent.contextTokens.desc', "Límite de tokens del contexto. 0 = automático según el modelo activo (catálogo de modelos). El umbral de compactación se configura por separado."),
		},
		'openide.agent.maxOutputTokens': {
			type: 'number',
			default: 0,
			order: 11,
			description: localize('openide.agent.maxOutputTokens.desc', "Tope de tokens de salida por respuesta. 0 = automático según el modelo activo."),
		},
		'openide.agent.maxAgentIterations': {
			type: 'number',
			default: 200,
			minimum: 25,
			maximum: 500,
			order: 11.25,
			description: localize('openide.agent.maxAgentIterations.desc', "Máximo de ciclos modelo → herramientas por ejecución. El valor alto permite tareas largas; las llamadas repetidas siguen protegidas por separado."),
		},
		'openide.agent.voiceModel': {
			type: 'string',
			default: '',
			order: 11.5,
			description: localize('openide.agent.voiceModel.desc', "Modelo para el dictado por voz del chat, formato \"provider/modelo\" (ej: gemini/gemini-3.5-flash). Vacío = usa voz sólo cuando el proveedor activo declara un modelo de audio compatible."),
		},
		'openide.agent.voiceMode': {
			type: 'string',
			enum: ['toggle', 'holdToTalk'],
			enumDescriptions: [
				localize('openide.agent.voiceMode.toggle', "Un click arranca a grabar, otro click la corta."),
				localize('openide.agent.voiceMode.holdToTalk', "Mantené presionado el botón de micrófono para grabar; soltalo para transcribir."),
			],
			default: 'toggle',
			order: 11.51,
			description: localize('openide.agent.voiceMode.desc', "Modo de grabación del dictado por voz del chat."),
		},
		'openide.agent.autoCompact': {
			type: 'boolean',
			default: true,
			order: 12,
			description: localize('openide.agent.autoCompact.desc', "Compactar automáticamente el contexto (resumir la conversación vieja) cuando se acerca al límite del modelo."),
		},
		'openide.agent.compactionThreshold': {
			type: 'number',
			default: 0.6,
			minimum: 0.4,
			maximum: 0.9,
			order: 13,
			description: localize('openide.agent.compactionThreshold.desc', "Fracción de la ventana de contexto que activa la compactación automática."),
		},
		'openide.agent.compactionTailRatio': {
			type: 'number',
			default: 0.2,
			minimum: 0.1,
			maximum: 0.4,
			order: 14,
			description: localize('openide.agent.compactionTailRatio.desc', "Fracción del contexto reservada para conservar los mensajes recientes sin resumir."),
		},
		'openide.agent.compactionModel': {
			type: 'string',
			default: '',
			order: 14.5,
			description: localize('openide.agent.compactionModel.desc', "Modelo auxiliar para resumir contexto, en formato `provider/modelo` (por ejemplo `openrouter/google/gemini-2.5-flash`). Vacío usa el modelo activo."),
		},
		'openide.agent.streamStaleTimeoutSeconds': {
			type: 'number',
			default: 180,
			minimum: 0,
			maximum: 1800,
			order: 15,
			description: localize('openide.agent.streamStaleTimeout.desc', "Segundos sin eventos antes de reiniciar un stream bloqueado. 0 lo desactiva; los modelos de razonamiento conocidos aplican un piso más alto."),
		},
		'openide.agent.toolAllowlist': {
			type: 'array',
			default: [],
			included: false,
			order: 20,
			items: { type: 'string' },
			markdownDescription: localize('openide.agent.toolAllowlist.desc', "Acciones aprobadas con **Permitir siempre** (ej: `write:write_file`, `exec:git`). Vaciá la lista para volver a pedir aprobación."),
		},
		'openide.agent.browserAllowedHosts': {
			type: 'array',
			default: [],
			included: false,
			order: 21,
			items: { type: 'string' },
			markdownDescription: localize('openide.agent.browserHosts.desc', "Hosts EXTRA permitidos en la vista previa localhost (además de `localhost`, `127.0.0.1`, `*.localhost`). Ej: `192.168.1.50` para probar una app en otra máquina de tu red."),
		},
		'openide.agent.usage.enabled': {
			type: 'boolean',
			default: true,
			order: 21.05,
			markdownDescription: localize('openide.agent.usage.enabled', "Consulta el uso y los límites de las cuentas conectadas (Anthropic, ChatGPT/Codex, Antigravity, Grok, OpenRouter) y de las CLIs con sesión en esta máquina para el footer, el popover y la página de Proveedores. Apagalo si no querés que el IDE consulte billing."),
		},
		'openide.agent.usage.cliAccounts': {
			type: 'boolean',
			default: true,
			order: 21.055,
			markdownDescription: localize('openide.agent.usage.cliAccounts', "Suma al popover de Uso las suscripciones de las CLIs con sesión iniciada en esta máquina (Claude Code, Codex, Gemini CLI, Grok), leyendo el token de su propio almacén de credenciales (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.grok`). Nunca modifica ni renueva esas sesiones en disco."),
		},
		'openide.agent.usage.pollMinutes': {
			type: 'number',
			default: 15,
			minimum: 0,
			maximum: 120,
			order: 21.06,
			markdownDescription: localize('openide.agent.usage.pollMinutes', "Cadencia de fondo del refresco de uso, en minutos (mínimo 0.5). Además se refresca al terminar cada turno, al volver el foco a la ventana y cada minuto mientras el popover está abierto."),
		},
		'openide.agent.web.enabled': { type: 'boolean', default: true, order: 21.1, markdownDescription: localize('openide.agent.web.enabled', "Habilita `web_search` y `web_fetch` para investigar web pública sin usar la preview localhost.") },
		'openide.agent.web.searchEndpoint': { type: 'string', default: '', order: 21.2, markdownDescription: localize('openide.agent.web.searchEndpoint', "Endpoint HTTPS JSON de búsqueda. Recibe `q` y `limit`; debe devolver `results`/`items` con `title`, `url` y `snippet`.") },
		'openide.agent.web.allowedHosts': { type: 'array', default: [], order: 21.3, items: { type: 'string' }, markdownDescription: localize('openide.agent.web.allowedHosts', "Allowlist opcional de hosts públicos para exploración web. Vacía permite cualquier host público no bloqueado.") },
		'openide.agent.web.blockedHosts': { type: 'array', default: [], order: 21.4, items: { type: 'string' }, markdownDescription: localize('openide.agent.web.blockedHosts', "Hosts públicos bloqueados para exploración web.") },
		'openide.agent.web.allowHttp': { type: 'boolean', default: false, order: 21.5, markdownDescription: localize('openide.agent.web.allowHttp', "Permite HTTP público sin TLS. Nunca habilita localhost, LAN ni direcciones privadas.") },
		'openide.agent.web.timeoutSeconds': { type: 'number', default: 15, minimum: 1, maximum: 60, order: 21.6, description: localize('openide.agent.web.timeout', "Timeout total por request web.") },
		'openide.agent.web.maxResponseBytes': { type: 'number', default: 2000000, minimum: 64000, maximum: 10000000, order: 21.7, description: localize('openide.agent.web.maxBytes', "Máximo de bytes descargados por fuente web.") },
		'openide.agent.web.maxExtractedChars': { type: 'number', default: 60000, minimum: 1000, maximum: 200000, order: 21.8, description: localize('openide.agent.web.maxChars', "Máximo de caracteres extraídos y enviados al modelo por fuente.") },
		'openide.agent.browserTools.enabled': {
			type: 'boolean',
			default: true,
			order: 21.9,
			markdownDescription: localize('openide.agent.browserTools.enabled.desc', "Habilita las tools `browser_*` del agente (navegar, click, escribir, capturar, ejecutar Playwright) sobre la vista previa nativa. Distinto de `workbench.browser.enableChatTools`, que sólo gatea las tools nativas de Copilot Chat. Apagalo como kill-switch dedicado del agente."),
		},
		'openide.agent.browserTools.actionTimeoutMs': {
			type: 'number',
			default: 5000,
			minimum: 500,
			maximum: 60000,
			order: 21.91,
			description: localize('openide.agent.browserTools.actionTimeoutMs.desc', "Timeout en milisegundos para esperar un elemento visible antes de click/escribir/capturar/leer el DOM."),
		},
		'openide.agent.browserTools.navigationTimeoutMs': {
			type: 'number',
			default: 10000,
			minimum: 1000,
			maximum: 120000,
			order: 21.92,
			description: localize('openide.agent.browserTools.navigationTimeoutMs.desc', "Timeout en milisegundos para esperar que termine de cargar la página tras browser_navigate."),
		},
		'openide.agent.browserTools.maxDomReadChars': {
			type: 'number',
			default: 50000,
			minimum: 1000,
			maximum: 500000,
			order: 21.93,
			description: localize('openide.agent.browserTools.maxDomReadChars.desc', "Máximo de caracteres devueltos por browser_read_dom."),
		},
		'openide.agent.browserTools.screenshotQuality': {
			type: 'number',
			default: 80,
			minimum: 1,
			maximum: 100,
			order: 21.94,
			description: localize('openide.agent.browserTools.screenshotQuality.desc', "Calidad JPEG (1-100) de las capturas de browser_screenshot."),
		},
		'openide.agent.browserTools.showCursor': {
			type: 'boolean',
			default: true,
			order: 21.95,
			markdownDescription: localize('openide.agent.browserTools.showCursor.desc', "Dibuja un puntero del agente en la vista previa: se desliza hasta el elemento, lo recuadra y marca el click, para poder seguir lo que hace y que quede en los screenshots. Apagalo si preferís que las acciones sean instantáneas."),
		},
		'openide.agent.suggestMode.autoAcceptSeconds': {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 120,
			order: 21.85,
			markdownDescription: localize('openide.agent.suggestMode.autoAcceptSeconds.desc', "Segundos hasta que la tarjeta de modo recomendado se acepta sola, con una cuenta atrás visible sobre el botón. **0 (default) = sólo a mano.** El temporizador se cancela apenas mostrás que estás decidiendo: al pasar el mouse por la tarjeta, al enfocarla o al escribir en el chat."),
		},
		'openide.agent.browserTools.keystrokeDelayMs': {
			type: 'number',
			default: 70,
			minimum: 0,
			maximum: 300,
			order: 21.96,
			markdownDescription: localize('openide.agent.browserTools.keystrokeDelayMs.desc', "Milisegundos entre teclas cuando `browser_type` escribe tecla por tecla. Escribir así dispara los eventos de teclado reales, así que ejercita autocompletados, máscaras y validación al tipear que un volcado de una sola vez no toca. Más alto = se ve escribir de a una tecla y no se saltean las animaciones del campo. Requiere el puntero del agente activo."),
		},
		'openide.agent.browserTools.maxKeystrokes': {
			type: 'number',
			default: 80,
			minimum: 0,
			maximum: 2000,
			order: 21.97,
			description: localize('openide.agent.browserTools.maxKeystrokes.desc', "Largo máximo de texto que se escribe tecla por tecla; por encima de eso se completa de una vez. 0 desactiva la escritura tecla por tecla."),
		},
		'openide.agent.browserTools.settleMs': {
			type: 'number',
			default: 140,
			minimum: 0,
			maximum: 2000,
			order: 21.98,
			markdownDescription: localize('openide.agent.browserTools.settleMs.desc', "Pausa (ms) después de cada click o escritura para que las animaciones de la vista previa terminen antes del paso siguiente. **0 = sin pausa.** Subilo si el agente salta animaciones de la página; bajalo si lo encontrás lento."),
		},
		'openide.agent.mcp.enabled': {
			type: 'boolean',
			default: true,
			order: 22,
			markdownDescription: localize('openide.agent.mcp.desc', "Conectar los servers MCP configurados en `.openide/mcp.json` del proyecto y en el global del perfil: sus tools entran al agente como `mcp_<server>_<tool>` (con aprobación, salvo las de solo lectura). Apagalo como kill-switch global — desconecta todo al instante."),
		},
		'openide.agent.hooks.enabled': {
			type: 'boolean',
			default: true,
			order: 23,
			markdownDescription: localize('openide.agent.hooks.desc', "Ejecutar los hooks de shell configurados en `.openide/hooks.json` del proyecto y en el global del perfil: scripts del usuario que observan o bloquean el lifecycle del agente (`preToolUse`, `postToolUse`, `userPromptSubmit`, `sessionStart`, `stop`, `subagentStop`). Cada hook pide consentimiento la primera vez (y si el script cambió desde la aprobación). Apagalo como kill-switch global."),
		},
		'openide.agent.notifications.enabled': {
			type: 'boolean',
			default: true,
			order: 23.1,
			description: localize('openide.agent.notifications.enabled.desc', "Habilita las notificaciones del agente (sonido y aviso del sistema)."),
		},
		'openide.agent.notifications.onTaskComplete': {
			type: 'boolean',
			default: true,
			order: 23.11,
			description: localize('openide.agent.notifications.onTaskComplete.desc', "Avisar cuando el agente termina de responder un mensaje."),
		},
		'openide.agent.notifications.suppressWhenFocused': {
			type: 'boolean',
			default: true,
			order: 23.12,
			description: localize('openide.agent.notifications.suppressWhenFocused.desc', "No avisar si la ventana ya está enfocada."),
		},
		'openide.agent.notifications.sound': {
			type: 'boolean',
			default: true,
			order: 23.13,
			markdownDescription: localize('openide.agent.notifications.sound.desc', "Reproducir sonido al avisar, usando las [Señales de Accesibilidad](command:workbench.action.openSettings?%22accessibility.signals.taskCompleted%22) `Task Completed`/`Task Failed` (volumen y sonido configurables ahí)."),
		},
		'openide.agent.googleCloudProject': {
			type: 'string',
			default: '',
			order: 23.5,
			markdownDescription: localize('openide.agent.googleCloudProject.desc', "Proyecto GCP para Antigravity / Code Assist OAuth. Las cuentas personales suelen no necesitarlo (el proyecto administrado se resuelve solo al conectar). Cuentas Workspace o con licencia empresarial: poné acá el id de un proyecto con la API **Gemini for Google Cloud** habilitada."),
		},
		'openide.chat.fontSize': {
			type: 'number',
			default: 13,
			minimum: 11,
			maximum: 18,
			order: 25.1,
			description: localize('openide.chat.fontSize.desc', "Tamaño base (px) del texto del transcript del chat."),
		},
		'openide.chat.density': {
			type: 'string',
			enum: ['comfortable', 'compact'],
			default: 'comfortable',
			order: 25.11,
			enumDescriptions: [
				localize('openide.chat.density.comfortable', "Espaciado estándar entre mensajes y cards."),
				localize('openide.chat.density.compact', "Menos aire vertical: más conversación por pantalla."),
			],
			description: localize('openide.chat.density.desc', "Densidad visual del transcript del chat."),
		},
		'openide.chat.thinking.defaultOpen': {
			type: 'boolean',
			default: false,
			order: 25.12,
			description: localize('openide.chat.thinking.defaultOpen.desc', "Deja el razonamiento (Thinking) expandido al terminar cada turno, en vez de colapsarlo automáticamente."),
		},
		'openide.chat.tools.defaultExpanded': {
			type: 'boolean',
			default: false,
			order: 25.13,
			description: localize('openide.chat.tools.defaultExpanded.desc', "Muestra las cards de herramientas (resultados y grupos de exploración) expandidas por defecto."),
		},
		'openide.chat.workingIndicator': {
			type: 'boolean',
			default: true,
			order: 25.14,
			description: localize('openide.chat.workingIndicator.desc', "Muestra la línea con shimmer «Pensando…» / «Planeando los próximos pasos» mientras el agente trabaja sin emitir contenido."),
		},
		'openide.chat.userMessage.clampLines': {
			type: 'number',
			default: 3,
			minimum: 0,
			maximum: 12,
			order: 25.15,
			description: localize('openide.chat.userMessage.clampLines.desc', "Líneas visibles de tus mensajes antes de recortarlos con «ver más». 0 los muestra completos siempre."),
		},
		'openide.chat.autoScroll': {
			type: 'string',
			enum: ['whenAtBottom', 'always'],
			default: 'whenAtBottom',
			order: 25.16,
			enumDescriptions: [
				localize('openide.chat.autoScroll.whenAtBottom', "Sigue el streaming sólo si ya estás al final; scrollear hacia arriba lo pausa."),
				localize('openide.chat.autoScroll.always', "Además, al terminar cada turno vuelve a engancharse al final aunque hayas scrolleado."),
			],
			description: localize('openide.chat.autoScroll.desc', "Cuándo el transcript sigue automáticamente los mensajes nuevos."),
		},
		'openide.chat.queue.enabled': {
			type: 'boolean',
			default: true,
			order: 25.17,
			description: localize('openide.chat.queue.enabled.desc', "Encola los mensajes enviados mientras el agente trabaja y los despacha al terminar. Desactivado, el composer avisa y conserva el texto."),
		},
		'openide.agent.disabledSkills': {
			type: 'array',
			default: [],
			order: 24,
			items: { type: 'string' },
			markdownDescription: localize('openide.agent.disabledSkills.desc', "Skills DESHABILITADAS (lista de exclusión, por nombre): salen del índice del system prompt y `skill_view` las rechaza — sin borrar el directorio. Administralas con el Switch de [Extensiones del Agente](command:openide.agent.openExtensions)."),
		},
	},
});

// Command: reload the MCP servers (re-reads the mcp.json files, disconnects and reconnects everything).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.reloadMcp',
			title: localize2('openide.agent.reloadMcp', 'Agente IA: Recargar servers MCP'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		try {
			notificationService.info(localize('openide.agent.reloadMcp.done', "MCP: {0}", await agent.reloadMcpServers()));
		} catch (e) {
			notificationService.error(localize('openide.agent.reloadMcp.err', "Error recargando servers MCP: {0}", e instanceof Error ? e.message : String(e)));
		}
	}
});

// Command: choose the active provider from the catalog.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.selectProvider',
			title: localize2('openide.agent.selectProvider', 'OpenIDE Agent: Elegir proveedor'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const active = agent.getActiveProviderId();
		const items: (IQuickPickItem & { id: string })[] = agent.listProviders().map(p => ({
			id: p.id,
			label: p.label,
			description: `${p.protocol}${p.auth === 'oauth' ? ' · oauth' : ''}${p.id === active ? '  ✓ activo' : ''}`,
			detail: p.baseUrl,
		}));
		const picked = await quickInput.pick(items, { placeHolder: localize('openide.agent.selectProvider.ph', "Elegí el proveedor de IA") });
		if (picked) {
			await agent.setActiveProvider(picked.id);
		}
	}
});

// Command: start an OAuth login with a catalog provider that supports it.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.signIn',
			title: localize2('openide.agent.signIn', 'OpenIDE Agent: Iniciar sesión (OAuth)'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		const items: (IQuickPickItem & { id: string })[] = agent.listProviders()
			.filter(p => p.auth === 'oauth')
			.map(p => ({ id: p.id, label: p.label }));
		if (!items.length) {
			notificationService.info(localize('openide.agent.signIn.none', "No hay proveedores OAuth en el catálogo."));
			return;
		}
		const picked = await quickInput.pick(items, { placeHolder: localize('openide.agent.signIn.pick', "¿En qué proveedor iniciar sesión?") });
		if (!picked) {
			return;
		}
		try {
			const ok = await agent.signIn(picked.id);
			notificationService.info(ok
				? localize('openide.agent.signIn.ok', "Sesión iniciada en {0}.", picked.label)
				: localize('openide.agent.signIn.cancel', "Inicio de sesión cancelado."));
		} catch (e) {
			notificationService.error(localize('openide.agent.signIn.err', "Error de OAuth: {0}", e instanceof Error ? e.message : String(e)));
		}
	}
});

// Command: configure a provider's API key (stored in SecretStorage).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.setApiKey',
			title: localize2('openide.agent.setApiKey', 'OpenIDE Agent: Configurar API key'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const active = agent.getActiveProviderId();
		const items: (IQuickPickItem & { id: string })[] = agent.listProviders()
			.filter(p => p.auth === 'apiKey')
			.map(p => ({ id: p.id, label: p.label, description: p.id === active ? 'activo' : undefined }));
		const picked = await quickInput.pick(items, { placeHolder: localize('openide.agent.setApiKey.pick', "¿Para qué proveedor?") });
		if (!picked) {
			return;
		}
		const key = await quickInput.input({
			prompt: localize('openide.agent.setApiKey.prompt', "Pegá la API key para {0}", picked.label),
			password: true,
			ignoreFocusLost: true,
		});
		if (key) {
			await agent.setApiKey(picked.id, key.trim());
		}
	}
});

// Command: test the agent from an Output channel (backend validation).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.run',
			title: localize2('openide.agent.run', 'OpenIDE Agent: Preguntar (consola)'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const outputService = accessor.get(IOutputService);

		const prompt = await quickInput.input({
			prompt: localize('openide.agent.run.prompt', "Preguntale al agente de OpenIDE"),
			ignoreFocusLost: true,
		});
		if (!prompt) {
			return;
		}

		const channel = outputService.getChannel(CHANNEL_ID);
		await outputService.showChannel(CHANNEL_ID, true);
		channel?.append(`\n\n=========================\n> ${prompt}\n=========================\n\n`);

		await agent.runAgent(prompt, ev => {
			switch (ev.type) {
				case 'text': channel?.append(ev.delta); break;
				case 'toolStart': channel?.append(`\n\n[tool ▸ ${ev.name}] ${ev.argumentsJson}\n`); break;
				case 'toolResult': channel?.append(`[tool ◂ ${ev.name}${ev.isError ? ' ERROR' : ''}]\n${ev.result}\n\n`); break;
				case 'approval': channel?.append(`\n[approval ▸ ${ev.name}: ${ev.decision}]\n`); break;
				case 'info': channel?.append(`\n(${ev.message})\n`); break;
				case 'usage': channel?.append(`\n(tokens in:${ev.inputTokens ?? '?'} out:${ev.outputTokens ?? '?'})\n`); break;
				case 'done': channel?.append(`\n\n— fin${ev.reason ? ` (${ev.reason})` : ''} —\n`); break;
				case 'error': channel?.append(`\n\n[ERROR] ${ev.message}\n`); break;
			}
		});
	}
});

// Command: copy the diagram engine's MCP configuration to the clipboard, to paste it into
// the .mcp.json (or another MCP registry) of extension chats such as Claude Code. The engine
// (openideDiagramEngine) is the same backend our own chat uses — a single source of truth.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.copyDiagramsMcpConfig',
			title: localize2('openide.agent.copyDiagramsMcpConfig', 'OpenIDE Agent: Copiar configuración MCP de diagramas'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const clipboard = accessor.get(IClipboardService);
		const notifications = accessor.get(INotificationService);
		const serverPath = FileAccess.asFileUri('vs/workbench/contrib/openideAgent/node/openideDiagramsMcpServer.js').fsPath;
		const snippet = JSON.stringify({
			mcpServers: {
				'openide-diagrams': { command: 'node', args: [serverPath] },
			},
		}, null, 2);
		await clipboard.writeText(snippet);
		notifications.info(localize('openide.agent.mcpCopied', "Configuración MCP de diagramas copiada. Pegala en el .mcp.json de tu agente (Claude Code, etc.)."));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.notifications.test',
			title: localize2('openide.agent.notifications.test', 'Agente IA: Enviar notificación de prueba'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const hostService = accessor.get(IHostService);
		const accessibilitySignalService = accessor.get(IAccessibilitySignalService);
		if (accessor.get(IConfigurationService).getValue('openide.agent.notifications.sound') !== false) {
			void accessibilitySignalService.playSignal(AccessibilitySignal.taskCompleted);
		}
		await hostService.showToast({
			title: 'Agente IA: notificación de prueba',
			body: 'Así se va a ver el aviso cuando el agente termine una tarea.',
		}, CancellationToken.None);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.runQuickCommand',
			title: localize2('openide.agent.runQuickCommand', 'Agente IA: Ejecutar comando rápido…'),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileService = accessor.get(IFileService);
		const contextService = accessor.get(IWorkspaceContextService);
		const environmentService = accessor.get(IEnvironmentService);
		const quickInput = accessor.get(IQuickInputService);
		const terminalService = accessor.get(ITerminalService);
		const notifications = accessor.get(INotificationService);
		const service = new OpenideQuickCommandsService(fileService, contextService, environmentService);
		const commands = await service.listAll();
		if (!commands.length) {
			notifications.info(localize('openide.agent.runQuickCommand.empty', "No hay comandos rápidos guardados todavía. Agregá uno en Ajustes › Agente IA › Comandos rápidos de terminal."));
			return;
		}
		const picked = await quickInput.pick(commands.map(c => ({ label: c.label, description: c.scope === 'global' ? 'global' : 'proyecto', detail: c.command, command: c })), { placeHolder: 'Elegí un comando rápido para ejecutar' });
		if (!picked) {
			return;
		}
		let instance = terminalService.activeInstance;
		if (!instance) {
			instance = await terminalService.createTerminal();
		}
		await terminalService.setActiveInstance(instance);
		await terminalService.revealTerminal(instance);
		instance.sendText(picked.command.command, true);
	}
});

// ---- Editor: quick edit, selection hint, AI autocomplete ------------------------------------

// Command: rewrite the selection from one instruction (Continue's Edit, Cursor's Ctrl+K). The
// keybinding is guarded by a non-empty selection, so without one Ctrl+K stays the chord prefix
// the rest of the workbench knows it as.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPENIDE_QUICK_EDIT_COMMAND,
			title: localize2('openide.quickEdit', 'OpenIDE Agent: Edición rápida de la selección'),
			category: Categories.Help,
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			keybinding: {
				// Above the built-in extensions: Ctrl+K is the first key of dozens of chords, and
				// the resolver takes the heaviest matching binding — at workbench weight, a chord
				// registered by an extension still won and the key only armed the chord.
				weight: KeybindingWeight.ExternalExtension + 1,
				when: ContextKeyExpr.and(EditorContextKeys.editorTextFocus, EditorContextKeys.hasNonEmptySelection, EditorContextKeys.writable),
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
			},
			menu: [{ id: MenuId.EditorContext, group: '0_openide', order: 2, when: ContextKeyExpr.and(EditorContextKeys.hasNonEmptySelection, EditorContextKeys.writable) }],
		});
	}

	run(accessor: ServicesAccessor): void {
		const editor = accessor.get(ICodeEditorService).getActiveCodeEditor();
		if (editor) {
			OpenideQuickEdit.get(editor)?.start();
		}
	}
});

// Escape closes the quick edit input from wherever focus is; while a rewrite runs it cancels it.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPENIDE_QUICK_EDIT_CLOSE_COMMAND,
			title: localize2('openide.quickEdit.close', 'OpenIDE Agent: Cerrar la edición rápida'),
			f1: false,
			precondition: CTX_OPENIDE_QUICK_EDIT_VISIBLE,
			keybinding: { weight: KeybindingWeight.WorkbenchContrib + 20, when: CTX_OPENIDE_QUICK_EDIT_VISIBLE, primary: KeyCode.Escape },
		});
	}

	run(accessor: ServicesAccessor): void {
		for (const editor of accessor.get(ICodeEditorService).listCodeEditors()) {
			OpenideQuickEdit.get(editor)?.close();
		}
	}
});

// Command: the status bar's toggle for the AI autocomplete.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPENIDE_AUTOCOMPLETE_TOGGLE_COMMAND,
			title: localize2('openide.autocomplete.toggle', 'OpenIDE Agent: Activar o desactivar el autocompletado IA'),
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configuration = accessor.get(IConfigurationService);
		const enabled = configuration.getValue<boolean>(OPENIDE_AUTOCOMPLETE_ENABLED) !== false;
		await configuration.updateValue(OPENIDE_AUTOCOMPLETE_ENABLED, !enabled);
	}
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'openideEditor',
	order: 101,
	title: localize('openide.editor.title', "Editor con IA"),
	type: 'object',
	properties: {
		[OPENIDE_AUTOCOMPLETE_ENABLED]: {
			type: 'boolean',
			default: true,
			description: localize('openide.autocomplete.enabled', "Muestra sugerencias del modelo como texto fantasma mientras escribís. Tab acepta; Alt+\\ pide una a mano."),
		},
		[OPENIDE_AUTOCOMPLETE_MODEL]: {
			type: 'string',
			default: '',
			markdownDescription: localize('openide.autocomplete.model', "Proveedor y modelo para el autocompletado, como `proveedor/modelo` (por ejemplo `openai/gpt-4.1-mini` o `ollama/qwen2.5-coder:1.5b`). Vacío usa el proveedor y el modelo activos del chat. Un modelo chico y rápido acá es lo que hace que el autocompletado se sienta instantáneo."),
		},
		[OPENIDE_AUTOCOMPLETE_DEBOUNCE]: {
			type: 'number',
			default: 350,
			minimum: 0,
			maximum: 5000,
			description: localize('openide.autocomplete.debounce', "Milisegundos de pausa en la escritura antes de pedir una sugerencia."),
		},
		[OPENIDE_AUTOCOMPLETE_MULTILINE]: {
			type: 'string',
			enum: ['auto', 'always', 'never'],
			default: 'auto',
			enumDescriptions: [
				localize('openide.autocomplete.multiline.auto', "Varias líneas al final de una línea; una sola en medio de una línea o en un comentario."),
				localize('openide.autocomplete.multiline.always', "Siempre permite sugerencias de varias líneas."),
				localize('openide.autocomplete.multiline.never', "Sólo completa la línea actual."),
			],
			description: localize('openide.autocomplete.multiline', "Cuándo una sugerencia puede ocupar varias líneas."),
		},
		[OPENIDE_AUTOCOMPLETE_MAX_TOKENS]: {
			type: 'number',
			default: 256,
			minimum: 16,
			maximum: 2048,
			description: localize('openide.autocomplete.maxTokens', "Tokens máximos por sugerencia."),
		},
		[OPENIDE_AUTOCOMPLETE_DISABLE_IN]: {
			type: 'array',
			default: [],
			items: { type: 'string' },
			markdownDescription: localize('openide.autocomplete.disableIn', "Globs de archivos donde no se pide autocompletado (por ejemplo `**/*.md`, `**/secrets/**`)."),
		},
		[OPENIDE_QUICK_EDIT_MODEL]: {
			type: 'string',
			default: '',
			markdownDescription: localize('openide.quickEdit.model', "Proveedor y modelo de la edición rápida (Ctrl+K), como `proveedor/modelo`. Vacío usa el modelo activo del chat. También se elige desde el selector del propio cuadro de edición."),
		},
		[OPENIDE_SELECTION_HINT_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('openide.editor.selectionHint', "Muestra sobre una selección los botones Agregar al chat y Edición rápida."),
		},
		[OPENIDE_SELECTION_TO_CLI_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize('openide.chat.selectionToCli', "Con la pestaña de un CLI hospedado activa (Claude Code, Codex, opencode…), *Agregar al chat* pega el fragmento en el prompt de ese CLI. Desactivado, el fragmento va siempre a un chat local del arnés, abriendo uno nuevo si hace falta."),
		},
	},
});
