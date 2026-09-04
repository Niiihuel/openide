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
	t('contrib.icon.planExecModel')
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
			title: { value: t('contrib.cmd.ide.registerMcp'), original: 'OpenIDE: Register OpenIDE tools in a CLI' },
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
			t('chatSurface.language.migrate', pack.label),
			[{
				label: t('chatSurface.language.migrateYes'),
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
					label: t('contrib.opener.preview'),
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
			title: { value: t('contrib.cmd.markdown.validate'), original: 'OpenIDE: Validate active Markdown' },
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
			notificationService.warn(t('contrib.msg.markdown.notMarkdown'));
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
			? t('contrib.msg.markdown.summary', errors, warnings)
			: t('contrib.msg.markdown.clean');
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
const openideChatIcon = registerIcon('openide-chat', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-chat']) }, t('contrib.icon.chat'));
const openideCliChangesIcon = registerIcon('openide-cli-changes', Codicon.gitPullRequestGoToChanges, t('contrib.icon.cliChanges'));
registerIcon('openide-agent-tree', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-agent-tree']) }, t('contrib.icon.agentTree'));
registerIcon('openide-mode-agent', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-agent']) }, t('contrib.icon.modeAgent'));
registerIcon('openide-mode-plan', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-plan']) }, t('contrib.icon.modePlan'));
registerIcon('openide-mode-ask', { fontCharacter: String.fromCodePoint(openideProductIconCodepoints['openide-mode-ask']) }, t('contrib.icon.modeAsk'));

const openideChatContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: OPENIDE_CHAT_CONTAINER_ID,
	title: { value: t('chatSurface.container.chat'), original: 'OpenIDE Chat' },
	icon: openideChatIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OPENIDE_CHAT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: OPENIDE_CHAT_CONTAINER_ID,
	order: 0,
	hideIfEmpty: false,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

const openideChatViewDescriptor: IViewDescriptor = {
	id: OPENIDE_CHAT_VIEW_ID,
	name: { value: t('chatSurface.container.chat'), original: 'OpenIDE Chat' },
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
	EditorPaneDescriptor.create(OpenideProjectMapEditor, OpenideProjectMapEditor.ID, t('chatSurface.editor.projectMap')),
	[new SyncDescriptor(OpenideMemoryInput)]
);

// Comando: abrir el Project Map.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.memory.open',
			title: { value: t('chatSurface.cmd.memoryOpen'), original: 'OpenIDE: Open Project Map' },
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
	constructor() { super({ id: 'openide.memory.rebuild', title: { value: t('chatSurface.cmd.memoryRebuild'), original: 'OpenIDE: Rebuild Codebase Memory' }, category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(ICodebaseMemoryService).rebuildFull(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.memory.clear', title: { value: t('chatSurface.cmd.memoryClear'), original: 'OpenIDE: Clear Codebase Memory' }, category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(ICodebaseMemoryService).clear(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.memory.status', title: { value: t('chatSurface.cmd.memoryStatus'), original: 'OpenIDE: Codebase Memory Status' }, category: Categories.View, f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { const version = await accessor.get(ICodebaseMemoryService).getVersion(); accessor.get(INotificationService).info(version ? `Project Map: ${version.nodeCount} nodos, ${version.edgeCount} relaciones, versión ${version.version}.` : 'Project Map: índice aún no construido.'); }
});

// OpenIDE entry point for the native browser. It keeps the localhost validation for the tools and
// delegates navigation, DevTools, inspector, captures and persistence to the Code OSS BrowserView.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.browser.open',
			title: { value: t('contrib.cmd.browser.open'), original: 'OpenIDE: Localhost preview' },
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
			title: { value: t('contrib.cmd.agent.pickElement'), original: 'OpenIDE: Pick an element from the app (Pick & Polish)' },
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
				prompt: t('contrib.msg.pick.prompt'),
				value: 'http://localhost:3000',
				ignoreFocusLost: true,
			});
			if (!typed) {
				return;
			}
			url = normalizeLocalUrl(typed, extraHosts);
			if (!url) {
				notificationService.warn(t('contrib.msg.pick.invalid'));
				return;
			}
		}
		try {
			const picked = await agentService.pickElement(url);
			if (picked) {
				notificationService.info(t('contrib.msg.pick.done'));
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
			title: { value: t('contrib.cmd.agent.undoAccountFailover'), original: 'AI Agent: Go back to the previous account' },
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
			title: { value: t('contrib.cmd.agent.openProviders'), original: 'AI Agent: Connect a provider…' },
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
	EditorPaneDescriptor.create(OpenideSkillInstallerEditor, OpenideSkillInstallerEditor.ID, t('contrib.editor.skillInstaller')),
	[new SyncDescriptor(OpenideSkillInstallerInput)]
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.openExtensions',
			title: { value: t('contrib.cmd.agent.openExtensions'), original: 'AI Agent: Skills' },
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
	EditorPaneDescriptor.create(OpenideDiagramEditor, OpenideDiagramEditor.ID, t('contrib.editor.diagram')),
	[new SyncDescriptor(OpenideDiagramInput)]
);
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.diagram.fullscreen',
			title: { value: t('contrib.cmd.diagram.fullscreen'), original: 'OpenIDE: Diagram fullscreen' },
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
			title: { value: t('contrib.cmd.agent.openSettings'), original: 'AI Agent: Settings' },
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
registerReviewAction('openide.review.undoBlock', t('contrib.review.undoBlock'), 'undoBlock', KeyMod.CtrlCmd | KeyCode.KeyN);
registerReviewAction('openide.review.keepBlock', t('contrib.review.keepBlock'), 'keepBlock', KeyMod.CtrlCmd | KeyCode.KeyY);
registerReviewAction('openide.review.keepFile', t('contrib.review.keepFile'), 'keepFile', KeyMod.CtrlCmd | KeyCode.Enter);
registerReviewAction('openide.review.undoFile', t('contrib.review.undoFile'), 'undoFile');
registerReviewAction('openide.review.nextBlock', t('contrib.review.nextBlock'), 'nextBlock', KeyMod.Alt | KeyCode.F5);
registerReviewAction('openide.review.prevBlock', t('contrib.review.prevBlock'), 'prevBlock', KeyMod.Alt | KeyMod.Shift | KeyCode.F5);

// ---- PLAN MODE: native editor buttons over plans (.openide/plans/*.md) ----
// They appear in the editor title only with a plan open (regex over resourcePath).
const PLAN_GLOB = '**/.openide/plans/*.md';

// Editor de plan PROPIO (webview: markdown lindo + toolbar Modelo/Build + tareas interactivas).
// Replaces the native markdown preview. Registered as DEFAULT for .openide/plans/*.md
// through the resolver (opening the file from the explorer uses it too); "Open as text" in the
// editor toolbar forces the native text editor (override DEFAULT_EDITOR_ASSOCIATION).
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenidePlanEditor, OpenidePlanEditor.ID, t('chatSurface.editor.plan')),
	[new SyncDescriptor(OpenidePlanInput)]
);
class OpenidePlanEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		const reg: IDisposable = editorResolverService.registerEditor(
			PLAN_GLOB,
			{ id: OpenidePlanInput.EDITOR_ID, label: t('contrib.editor.planLabel'), priority: RegisteredEditorPriority.exclusive },
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
	EditorPaneDescriptor.create(OpenideSubagentEditor, OpenideSubagentEditor.ID, t('chatSurface.editor.subagent')),
	[new SyncDescriptor(OpenideSubagentInput)]
);
class OpenideSubagentEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService resolver: IEditorResolverService) {
		for (const glob of ['**/.openide/agents/*.md', '**/.cursor/agents/*.md']) {
			resolver.registerEditor(glob, { id: OpenideSubagentInput.EDITOR_ID, label: t('contrib.editor.subagentLabel'), priority: RegisteredEditorPriority.default }, { singlePerResource: true }, { createEditorInput: ({ resource }) => ({ editor: new OpenideSubagentInput(resource) }) });
		}
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(OpenideSubagentEditorResolverContribution, LifecyclePhase.Restored);
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.subagent.create', title: { value: t('chatSurface.cmd.subagentCreate'), original: 'OpenIDE: Create Subagent' }, f1: true }); }
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
	constructor() { super({ id: 'openide.subagent.openEditor', title: { value: t('chatSurface.cmd.subagentOpenEditor'), original: 'OpenIDE: Open Subagent Editor' }, f1: true }); }
	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> { const editors = accessor.get(IEditorService); const resource = resourceArg instanceof URI ? resourceArg : editors.activeEditor?.resource; if (resource) { await editors.openEditor({ resource, options: { override: OpenideSubagentInput.EDITOR_ID, pinned: true } }); } }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.subagent.openText', title: { value: t('chatSurface.cmd.subagentOpenText'), original: 'OpenIDE: Open Subagent as Text' }, f1: true }); }
	async run(accessor: ServicesAccessor, resourceArg?: URI): Promise<void> { const editors = accessor.get(IEditorService); const resource = resourceArg instanceof URI ? resourceArg : editors.activeEditor?.resource; if (resource) { await editors.openEditor({ resource, options: { override: 'default', pinned: true } }); } }
});

// Canvas: editor visual default para el artefacto real .openide/canvases/*.canvas.tsx.
const CANVAS_GLOB = '**/.openide/canvases/*.canvas.tsx';
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideCanvasInput.ID, OpenideCanvasInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideCanvasEditor, OpenideCanvasEditor.ID, t('chatSurface.editor.canvas')),
	[new SyncDescriptor(OpenideCanvasInput)]
);
class OpenideCanvasEditorResolverContribution implements IWorkbenchContribution {
	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		const reg = editorResolverService.registerEditor(
			CANVAS_GLOB,
			{ id: OpenideCanvasInput.EDITOR_ID, label: t('contrib.editor.canvasLabel'), priority: RegisteredEditorPriority.default },
			{ singlePerResource: true, canSupportResource: resource => /\.openide[\/\\]canvases[\/\\][^\/\\]+\.canvas\.tsx$/.test(resource.path) },
			{ createEditorInput: ({ resource }) => ({ editor: new OpenideCanvasInput(resource) }) }
		);
		void reg;
	}
}
PlatformRegistry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(OpenideCanvasEditorResolverContribution, LifecyclePhase.Restored);

registerAction2(class extends Action2 {
	constructor() { super({ id: 'openide.canvas.open', title: { value: t('contrib.cmd.canvas.open'), original: 'Canvas: Open' }, f1: false }); }
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
			title: { value: t('contrib.cmd.plan.open'), original: 'Plan: Open in the plan editor' },
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
			title: { value: t('contrib.cmd.plan.execModel'), original: 'Plan: Execution model' },
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
			notificationService.info(t('contrib.msg.plan.execModel.none'));
			return;
		}
		const picked = await quickInput.pick(items, { placeHolder: t('contrib.msg.plan.execModel.ph') });
		if (!picked) {
			return;
		}
		try {
			await agent.setPlanExecutionModel(resource, picked.model);
			notificationService.info(t('contrib.msg.plan.execModel.done', picked.model));
		} catch (e) {
			notificationService.error(t('contrib.msg.plan.execModel.err', e instanceof Error ? e.message : String(e)));
		}
	}
});

// Plan: Build — aprueba el plan (frontmatter → aprobado, cambia el modelo si corresponde) y
// the chat launches the execution run as a normal turn (onDidRequestPlanBuild).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.plan.build',
			title: { value: t('contrib.cmd.plan.build'), original: 'Plan: Build (run the plan)' },
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
			notificationService.error(t('contrib.msg.plan.build.err', e instanceof Error ? e.message : String(e)));
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
			title: { value: t('contrib.cmd.agent.showContext'), original: 'OpenIDE Agent: Context usage' },
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
			title: { value: t('contrib.cmd.agent.showUsage'), original: 'OpenIDE Agent: Account usage' },
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
	constructor() { super({ id: 'openide.agent.injectPrompt', title: { value: t('contrib.cmd.agent.injectPrompt'), original: 'OpenIDE Agent: Write a prompt into the chat' }, f1: false }); }
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
	constructor() { super({ id: 'openide.agent.injectCanvasChoice', title: { value: t('contrib.cmd.agent.injectCanvasChoice'), original: 'OpenIDE Agent: Use the Canvas choice' }, f1: false }); }
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
	constructor() { super({ id: 'openide.agent.injectCanvasPrompt', title: { value: t('contrib.cmd.agent.injectCanvasPrompt'), original: 'OpenIDE Agent: Run the Canvas prompt' }, f1: false }); }
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
			title: { value: t('contrib.cmd.agent.addSelectionToChat'), original: 'OpenIDE Agent: Add the selection to the chat' },
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
			title: { value: t('contrib.cmd.agent.newChat'), original: 'OpenIDE Agent: New chat' },
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
			title: { value: t('contrib.cmd.agent.forkChat'), original: 'OpenIDE Agent: Fork the conversation' },
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
	title: t('contrib.config.title'),
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
			description: t('chatSurface.language.deprecatedDesc'),
			deprecationMessage: t('chatSurface.language.deprecatedMessage'),
		},
		[OPENIDE_IDE_SERVER_SETTING]: { type: 'boolean', default: true, description: t('contrib.config.ideServer.enabled') },
		'openide.subagents.enabled': { type: 'boolean', default: true, description: t('contrib.config.subagents.enabled') },
		'openide.subagents.routing.enabled': { type: 'boolean', default: false, description: t('contrib.config.subagents.routing.enabled') },
		'openide.subagents.routing.preset': { type: 'string', enum: ['manual', 'quality', 'balanced', 'savings'], default: 'balanced', description: t('contrib.config.subagents.routing.preset') },
		'openide.subagents.routing.maxAttempts': { type: 'number', default: 3, minimum: 1, maximum: 10, description: t('contrib.config.subagents.routing.maxAttempts') },
		'openide.subagents.routing.policy': {
			type: 'object', default: { version: 1, preset: 'balanced', maxAttempts: 3, fallbackEnabled: true, profiles: {} },
			description: t('contrib.config.subagents.routing.policy'),
			properties: {
				version: { type: 'number', enum: [1] },
				preset: { type: 'string', enum: ['manual', 'quality', 'balanced', 'savings'] },
				maxAttempts: { type: 'number', minimum: 1, maximum: 10 },
				fallbackEnabled: { type: 'boolean' },
				profiles: { type: 'object', additionalProperties: { type: 'object' } },
			},
		},
		'openide.subagents.maxParallelRuns': { type: 'number', default: 4, minimum: 1, maximum: 16, description: t('contrib.config.subagents.parallel') },
		'openide.subagents.maxDepth': { type: 'number', default: 2, minimum: 0, maximum: 8, description: t('contrib.config.subagents.depth') },
		'openide.subagents.defaultTimeoutMinutes': { type: 'number', default: 15, minimum: 1, maximum: 240, description: t('contrib.config.subagents.timeout') },
		'openide.subagents.defaultModel': { type: 'string', default: 'default', description: t('contrib.config.subagents.model') },
		'openide.subagents.defaultBackground': { type: 'boolean', default: false, description: t('contrib.config.subagents.background') },
		'openide.subagents.allowWritable': { type: 'boolean', default: false, description: t('contrib.config.subagents.writable') },
		'openide.subagents.useWorktrees': { type: 'boolean', default: true, description: t('contrib.config.subagents.worktrees') },
		'openide.subagents.showDetailedToolCalls': { type: 'boolean', default: true, description: t('contrib.config.subagents.details') },
		'openide.subagents.preserveCompletedRuns': { type: 'boolean', default: true, description: t('contrib.config.subagents.preserve') },
		'openide.subagents.globalDirectory': { type: 'string', default: '', description: t('contrib.config.subagents.globalDir') },
		// NOTE: the ACTIVE provider/model are no longer settings — they live in IStorageService and
		// are configured from the "AI Providers" page (openide.agent.openProviders) or the chat's
		// native model picker. Only power-user settings remain here.
		'openide.agent.customProviders': {
			type: 'array',
			default: [],
			order: 3,
			markdownDescription: t('contrib.config.custom.desc'),
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
			markdownDescription: t('contrib.config.fallback.desc'),
		},
		'openide.agent.fallbackChain': {
			type: 'array',
			default: [],
			order: 5,
			markdownDescription: t('contrib.config.fallbackChain.desc'),
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
				t('contrib.config.accountFailover.off'),
				t('contrib.config.accountFailover.auto'),
				t('contrib.config.accountFailover.ask'),
			],
			default: 'off',
			order: 6,
			description: t('contrib.config.accountFailover.desc'),
		},
		'openide.memory.enabled': { type: 'boolean', default: true, order: 20, description: t('contrib.config.memory.enabled') },
		'openide.memory.indexOnOpen': { type: 'boolean', default: true, order: 21, description: t('contrib.config.memory.indexOnOpen') },
		'openide.memory.incrementalIndexing': { type: 'boolean', default: true, order: 22, description: t('contrib.config.memory.incremental') },
		'openide.memory.persistIndex': { type: 'boolean', default: true, markdownDescription: t('contrib.config.memory.persist'), order: 23 },
		'openide.memory.maxContextTokens': { type: 'number', default: 3000, minimum: 500, maximum: 12000, order: 24, description: t('contrib.config.memory.maxContext') },
		'openide.memory.maxRetrievedNodes': { type: 'number', default: 24, minimum: 3, maximum: 100, order: 25, description: t('contrib.config.memory.maxNodes') },
		'openide.memory.maxTraversalDepth': { type: 'number', default: 3, minimum: 1, maximum: 6, order: 26, description: t('contrib.config.memory.maxDepth') },
		'openide.memory.visualization.defaultMode': { type: 'string', enum: ['architecture', 'graph', 'dependencies', 'impact', 'matrix'], default: 'architecture', order: 27, description: t('contrib.config.memory.defaultMode') },
		'openide.memory.visualization.maxVisibleNodes': { type: 'number', default: 300, minimum: 50, maximum: 2000, order: 28, description: t('contrib.config.memory.maxVisible') },
		'openide.memory.visualization.maxRelationDepth': { type: 'number', default: 2, minimum: 1, maximum: 5, order: 29, description: t('contrib.config.memory.maxRelationDepth') },
		'openide.memory.visualization.showHeuristicEdges': { type: 'boolean', default: true, order: 30, description: t('contrib.config.memory.heuristicEdges') },
		[CODEBASE_NOTES_ENABLED_SETTING]: { type: 'boolean', default: true, order: 31, markdownDescription: t('contrib.config.memory.notes.enabled') },
		[CODEBASE_NOTES_LINKING_SETTING]: {
			type: 'string', enum: ['explicit', 'identifiers', 'off'], default: 'explicit', order: 32,
			enumDescriptions: [
				t('contrib.config.memory.notes.linking.explicit'),
				t('contrib.config.memory.notes.linking.identifiers'),
				t('contrib.config.memory.notes.linking.off'),
			],
			markdownDescription: t('contrib.config.memory.notes.linking'),
		},
		[CODEBASE_NOTES_MAX_CHARS_SETTING]: { type: 'number', default: 3000, minimum: 500, maximum: 100000, order: 32.5, markdownDescription: t('contrib.config.memory.notes.maxChars') },
		'openide.memory.exclude': { type: 'array', default: [], order: 33, items: { type: 'string' }, markdownDescription: t('contrib.config.memory.exclude') },
		'openide.memory.include': { type: 'array', default: [], order: 34, items: { type: 'string' }, markdownDescription: t('contrib.config.memory.include') },
		'openide.memory.indexTests': { type: 'boolean', default: true, order: 35, markdownDescription: t('contrib.config.memory.indexTests') },
		'openide.memory.enableRegexFallback': { type: 'boolean', default: true, order: 36, markdownDescription: t('contrib.config.memory.regex') },
		'openide.memory.showHeuristicRelations': { type: 'boolean', default: true, order: 37, markdownDescription: t('contrib.config.memory.showHeuristic') },
		'openide.agent.contextTokens': {
			type: 'number',
			default: 0,
			order: 10,
			description: t('contrib.config.contextTokens.desc'),
		},
		'openide.agent.maxOutputTokens': {
			type: 'number',
			default: 0,
			order: 11,
			description: t('contrib.config.maxOutputTokens.desc'),
		},
		'openide.agent.maxAgentIterations': {
			type: 'number',
			default: 200,
			minimum: 25,
			maximum: 500,
			order: 11.25,
			description: t('contrib.config.maxAgentIterations.desc'),
		},
		'openide.agent.voiceModel': {
			type: 'string',
			default: '',
			order: 11.5,
			description: t('contrib.config.voiceModel.desc'),
		},
		'openide.agent.voiceMode': {
			type: 'string',
			enum: ['toggle', 'holdToTalk'],
			enumDescriptions: [
				t('contrib.config.voiceMode.toggle'),
				t('contrib.config.voiceMode.holdToTalk'),
			],
			default: 'toggle',
			order: 11.51,
			description: t('contrib.config.voiceMode.desc'),
		},
		'openide.agent.autoCompact': {
			type: 'boolean',
			default: true,
			order: 12,
			description: t('contrib.config.autoCompact.desc'),
		},
		'openide.agent.compactionThreshold': {
			type: 'number',
			default: 0.6,
			minimum: 0.4,
			maximum: 0.9,
			order: 13,
			description: t('contrib.config.compactionThreshold.desc'),
		},
		'openide.agent.compactionTailRatio': {
			type: 'number',
			default: 0.2,
			minimum: 0.1,
			maximum: 0.4,
			order: 14,
			description: t('contrib.config.compactionTailRatio.desc'),
		},
		'openide.agent.compactionModel': {
			type: 'string',
			default: '',
			order: 14.5,
			description: t('contrib.config.compactionModel.desc'),
		},
		'openide.agent.streamStaleTimeoutSeconds': {
			type: 'number',
			default: 180,
			minimum: 0,
			maximum: 1800,
			order: 15,
			description: t('contrib.config.streamStaleTimeout.desc'),
		},
		'openide.agent.toolAllowlist': {
			type: 'array',
			default: [],
			included: false,
			order: 20,
			items: { type: 'string' },
			markdownDescription: t('contrib.config.toolAllowlist.desc'),
		},
		'openide.agent.browserAllowedHosts': {
			type: 'array',
			default: [],
			included: false,
			order: 21,
			items: { type: 'string' },
			markdownDescription: t('contrib.config.browserHosts.desc'),
		},
		'openide.agent.usage.enabled': {
			type: 'boolean',
			default: true,
			order: 21.05,
			markdownDescription: t('contrib.config.usage.enabled'),
		},
		'openide.agent.usage.cliAccounts': {
			type: 'boolean',
			default: true,
			order: 21.055,
			markdownDescription: t('contrib.config.usage.cliAccounts'),
		},
		'openide.agent.usage.pollMinutes': {
			type: 'number',
			default: 15,
			minimum: 0,
			maximum: 120,
			order: 21.06,
			markdownDescription: t('contrib.config.usage.pollMinutes'),
		},
		'openide.agent.web.enabled': { type: 'boolean', default: true, order: 21.1, markdownDescription: t('contrib.config.web.enabled') },
		'openide.agent.web.searchEndpoint': { type: 'string', default: '', order: 21.2, markdownDescription: t('contrib.config.web.searchEndpoint') },
		'openide.agent.web.allowedHosts': { type: 'array', default: [], order: 21.3, items: { type: 'string' }, markdownDescription: t('contrib.config.web.allowedHosts') },
		'openide.agent.web.blockedHosts': { type: 'array', default: [], order: 21.4, items: { type: 'string' }, markdownDescription: t('contrib.config.web.blockedHosts') },
		'openide.agent.web.allowHttp': { type: 'boolean', default: false, order: 21.5, markdownDescription: t('contrib.config.web.allowHttp') },
		'openide.agent.web.timeoutSeconds': { type: 'number', default: 15, minimum: 1, maximum: 60, order: 21.6, description: t('contrib.config.web.timeout') },
		'openide.agent.web.maxResponseBytes': { type: 'number', default: 2000000, minimum: 64000, maximum: 10000000, order: 21.7, description: t('contrib.config.web.maxBytes') },
		'openide.agent.web.maxExtractedChars': { type: 'number', default: 60000, minimum: 1000, maximum: 200000, order: 21.8, description: t('contrib.config.web.maxChars') },
		'openide.agent.browserTools.enabled': {
			type: 'boolean',
			default: true,
			order: 21.9,
			markdownDescription: t('contrib.config.browserTools.enabled.desc'),
		},
		'openide.agent.browserTools.actionTimeoutMs': {
			type: 'number',
			default: 5000,
			minimum: 500,
			maximum: 60000,
			order: 21.91,
			description: t('contrib.config.browserTools.actionTimeoutMs.desc'),
		},
		'openide.agent.browserTools.navigationTimeoutMs': {
			type: 'number',
			default: 10000,
			minimum: 1000,
			maximum: 120000,
			order: 21.92,
			description: t('contrib.config.browserTools.navigationTimeoutMs.desc'),
		},
		'openide.agent.browserTools.maxDomReadChars': {
			type: 'number',
			default: 50000,
			minimum: 1000,
			maximum: 500000,
			order: 21.93,
			description: t('contrib.config.browserTools.maxDomReadChars.desc'),
		},
		'openide.agent.browserTools.screenshotQuality': {
			type: 'number',
			default: 80,
			minimum: 1,
			maximum: 100,
			order: 21.94,
			description: t('contrib.config.browserTools.screenshotQuality.desc'),
		},
		'openide.agent.browserTools.showCursor': {
			type: 'boolean',
			default: true,
			order: 21.95,
			markdownDescription: t('contrib.config.browserTools.showCursor.desc'),
		},
		'openide.agent.browserTools.recordFps': {
			type: 'number',
			default: 12,
			minimum: 2,
			maximum: 30,
			order: 21.96,
			description: t('contrib.config.browserTools.recordFps.desc'),
		},
		'openide.agent.browserTools.recordMaxSeconds': {
			type: 'number',
			default: 90,
			minimum: 5,
			maximum: 300,
			order: 21.97,
			description: t('contrib.config.browserTools.recordMaxSeconds.desc'),
		},
		'openide.agent.browserTools.recordFramesToModel': {
			type: 'number',
			default: 6,
			minimum: 0,
			maximum: 12,
			order: 21.98,
			markdownDescription: t('contrib.config.browserTools.recordFramesToModel.desc'),
		},
		'openide.agent.suggestMode.autoAcceptSeconds': {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 120,
			order: 21.85,
			markdownDescription: t('contrib.config.suggestMode.autoAcceptSeconds.desc'),
		},
		'openide.agent.browserTools.keystrokeDelayMs': {
			type: 'number',
			default: 70,
			minimum: 0,
			maximum: 300,
			order: 21.96,
			markdownDescription: t('contrib.config.browserTools.keystrokeDelayMs.desc'),
		},
		'openide.agent.browserTools.maxKeystrokes': {
			type: 'number',
			default: 80,
			minimum: 0,
			maximum: 2000,
			order: 21.97,
			description: t('contrib.config.browserTools.maxKeystrokes.desc'),
		},
		'openide.agent.browserTools.settleMs': {
			type: 'number',
			default: 140,
			minimum: 0,
			maximum: 2000,
			order: 21.98,
			markdownDescription: t('contrib.config.browserTools.settleMs.desc'),
		},
		'openide.agent.mcp.enabled': {
			type: 'boolean',
			default: true,
			order: 22,
			markdownDescription: t('contrib.config.mcp.desc'),
		},
		'openide.agent.hooks.enabled': {
			type: 'boolean',
			default: true,
			order: 23,
			markdownDescription: t('contrib.config.hooks.desc'),
		},
		'openide.agent.notifications.enabled': {
			type: 'boolean',
			default: true,
			order: 23.1,
			description: t('contrib.config.notifications.enabled.desc'),
		},
		'openide.agent.notifications.onTaskComplete': {
			type: 'boolean',
			default: true,
			order: 23.11,
			description: t('contrib.config.notifications.onTaskComplete.desc'),
		},
		'openide.agent.notifications.suppressWhenFocused': {
			type: 'boolean',
			default: true,
			order: 23.12,
			description: t('contrib.config.notifications.suppressWhenFocused.desc'),
		},
		'openide.agent.notifications.sound': {
			type: 'boolean',
			default: true,
			order: 23.13,
			markdownDescription: t('contrib.config.notifications.sound.desc'),
		},
		'openide.agent.googleCloudProject': {
			type: 'string',
			default: '',
			order: 23.5,
			markdownDescription: t('contrib.config.googleCloudProject.desc'),
		},
		'openide.chat.fontSize': {
			type: 'number',
			default: 13,
			minimum: 11,
			maximum: 18,
			order: 25.1,
			description: t('contrib.config.chat.fontSize.desc'),
		},
		'openide.chat.density': {
			type: 'string',
			enum: ['comfortable', 'compact'],
			default: 'comfortable',
			order: 25.11,
			enumDescriptions: [
				t('contrib.config.chat.density.comfortable'),
				t('contrib.config.chat.density.compact'),
			],
			description: t('contrib.config.chat.density.desc'),
		},
		'openide.chat.thinking.defaultOpen': {
			type: 'boolean',
			default: false,
			order: 25.12,
			description: t('contrib.config.chat.thinking.defaultOpen.desc'),
		},
		'openide.chat.tools.defaultExpanded': {
			type: 'boolean',
			default: false,
			order: 25.13,
			description: t('contrib.config.chat.tools.defaultExpanded.desc'),
		},
		'openide.chat.workingIndicator': {
			type: 'boolean',
			default: true,
			order: 25.14,
			description: t('contrib.config.chat.workingIndicator.desc'),
		},
		'openide.chat.userMessage.clampLines': {
			type: 'number',
			default: 3,
			minimum: 0,
			maximum: 12,
			order: 25.15,
			description: t('contrib.config.chat.userMessage.clampLines.desc'),
		},
		'openide.chat.autoScroll': {
			type: 'string',
			enum: ['whenAtBottom', 'always'],
			default: 'whenAtBottom',
			order: 25.16,
			enumDescriptions: [
				t('contrib.config.chat.autoScroll.whenAtBottom'),
				t('contrib.config.chat.autoScroll.always'),
			],
			description: t('contrib.config.chat.autoScroll.desc'),
		},
		'openide.chat.queue.enabled': {
			type: 'boolean',
			default: true,
			order: 25.17,
			description: t('contrib.config.chat.queue.enabled.desc'),
		},
		'openide.agent.disabledSkills': {
			type: 'array',
			default: [],
			order: 24,
			items: { type: 'string' },
			markdownDescription: t('contrib.config.disabledSkills.desc'),
		},
	},
});

// Command: reload the MCP servers (re-reads the mcp.json files, disconnects and reconnects everything).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.reloadMcp',
			title: { value: t('contrib.cmd.agent.reloadMcp'), original: 'AI Agent: Reload MCP servers' },
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		try {
			notificationService.info(t('chatSurface.mcp.reloadDone', await agent.reloadMcpServers()));
		} catch (e) {
			notificationService.error(t('contrib.msg.reloadMcp.err', e instanceof Error ? e.message : String(e)));
		}
	}
});

// Command: choose the active provider from the catalog.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.selectProvider',
			title: { value: t('contrib.cmd.agent.selectProvider'), original: 'OpenIDE Agent: Select provider' },
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
		const picked = await quickInput.pick(items, { placeHolder: t('contrib.msg.selectProvider.ph') });
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
			title: { value: t('contrib.cmd.agent.signIn'), original: 'OpenIDE Agent: Sign in (OAuth)' },
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
			notificationService.info(t('contrib.msg.signIn.none'));
			return;
		}
		const picked = await quickInput.pick(items, { placeHolder: t('contrib.msg.signIn.pick') });
		if (!picked) {
			return;
		}
		try {
			const ok = await agent.signIn(picked.id);
			notificationService.info(ok
				? t('contrib.msg.signIn.ok', picked.label)
				: t('contrib.msg.signIn.cancel'));
		} catch (e) {
			notificationService.error(t('contrib.msg.signIn.err', e instanceof Error ? e.message : String(e)));
		}
	}
});

// Command: configure a provider's API key (stored in SecretStorage).
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.setApiKey',
			title: { value: t('contrib.cmd.agent.setApiKey'), original: 'OpenIDE Agent: Set API key' },
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
		const picked = await quickInput.pick(items, { placeHolder: t('contrib.msg.setApiKey.pick') });
		if (!picked) {
			return;
		}
		const key = await quickInput.input({
			prompt: t('contrib.msg.setApiKey.prompt', picked.label),
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
			title: { value: t('contrib.cmd.agent.run'), original: 'OpenIDE Agent: Ask (console)' },
			category: Categories.Help,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const outputService = accessor.get(IOutputService);

		const prompt = await quickInput.input({
			prompt: t('contrib.msg.run.prompt'),
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
			title: { value: t('contrib.cmd.agent.copyDiagramsMcpConfig'), original: 'OpenIDE Agent: Copy the diagrams MCP configuration' },
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
		notifications.info(t('contrib.msg.mcpCopied'));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.agent.notifications.test',
			title: { value: t('contrib.cmd.agent.notifications.test'), original: 'AI Agent: Send a test notification' },
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
			title: { value: t('contrib.cmd.agent.runQuickCommand'), original: 'AI Agent: Run a quick command…' },
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
			notifications.info(t('contrib.msg.runQuickCommand.empty'));
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
			title: { value: t('contrib.cmd.quickEdit'), original: 'OpenIDE Agent: Quick edit the selection' },
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
			title: { value: t('contrib.cmd.quickEdit.close'), original: 'OpenIDE Agent: Close the quick edit' },
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
			title: { value: t('contrib.cmd.autocomplete.toggle'), original: 'OpenIDE Agent: Toggle AI autocomplete' },
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
	title: t('contrib.config.editorTitle'),
	type: 'object',
	properties: {
		[OPENIDE_AUTOCOMPLETE_ENABLED]: {
			type: 'boolean',
			default: true,
			description: t('contrib.config.autocomplete.enabled'),
		},
		[OPENIDE_AUTOCOMPLETE_MODEL]: {
			type: 'string',
			default: '',
			markdownDescription: t('contrib.config.autocomplete.model'),
		},
		[OPENIDE_AUTOCOMPLETE_DEBOUNCE]: {
			type: 'number',
			default: 350,
			minimum: 0,
			maximum: 5000,
			description: t('contrib.config.autocomplete.debounce'),
		},
		[OPENIDE_AUTOCOMPLETE_MULTILINE]: {
			type: 'string',
			enum: ['auto', 'always', 'never'],
			default: 'auto',
			enumDescriptions: [
				t('contrib.config.autocomplete.multiline.auto'),
				t('contrib.config.autocomplete.multiline.always'),
				t('contrib.config.autocomplete.multiline.never'),
			],
			description: t('contrib.config.autocomplete.multiline'),
		},
		[OPENIDE_AUTOCOMPLETE_MAX_TOKENS]: {
			type: 'number',
			default: 256,
			minimum: 16,
			maximum: 2048,
			description: t('contrib.config.autocomplete.maxTokens'),
		},
		[OPENIDE_AUTOCOMPLETE_DISABLE_IN]: {
			type: 'array',
			default: [],
			items: { type: 'string' },
			markdownDescription: t('contrib.config.autocomplete.disableIn'),
		},
		[OPENIDE_QUICK_EDIT_MODEL]: {
			type: 'string',
			default: '',
			markdownDescription: t('contrib.config.quickEdit.model'),
		},
		[OPENIDE_SELECTION_HINT_SETTING]: {
			type: 'boolean',
			default: true,
			description: t('contrib.config.editor.selectionHint'),
		},
		[OPENIDE_SELECTION_TO_CLI_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: t('contrib.config.chat.selectionToCli'),
		},
	},
});
