/*---------------------------------------------------------------------------------------------
 *  OpenIDE — contribución del motor agéntico: servicio, config (catálogo + custom providers),
 *  y comandos para elegir provider, configurar API key y probar el agente (Output channel).
 *  La UI del chat en el dock derecho vendrá después; esto es el backend / pilar.
 *--------------------------------------------------------------------------------------------*/

import './media/openideChat.css';
import { FileAccess } from '../../../../base/common/network.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
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
import { IOpenideAgentService } from './openideAgentService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CTX_OPENIDE_REVIEW_ACTIVE, ReviewAction } from './openideEditReview.js';
import { OpenideChatViewPane } from './openideChatView.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { OpenideDiagramEditor } from './openideDiagramEditor.js';
import { OpenideDiagramInput } from './openideDiagramInput.js';
import { OpenidePlanEditor } from './openidePlanEditor.js';
import { OpenidePlanInput } from './openidePlanInput.js';
import { OpenideCanvasEditor } from './openideCanvasEditor.js';
import { OpenideCanvasInput, OpenideCanvasInputSerializer } from './openideCanvasInput.js';
import { IOpenideCanvasService, OpenideCanvasService } from './openideCanvasService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { SettingsEditor2 } from '../../preferences/browser/settingsEditor2.js';
import { OpenideSettingsEditor } from '../../openideSettings/browser/openideSettingsEditor.js';
import { OpenideMemoryEditor } from './openideMemoryEditor.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { normalizeLocalUrl } from '../common/openideLocalUrl.js';
import { OpenideMemoryInput, OpenideMemoryInputSerializer } from './openideMemoryInput.js';
import { OpenideProvidersEditor } from './openideProvidersEditor.js';
import { OpenideProvidersInput, OpenideProvidersInputSerializer } from './openideProvidersInput.js';
import { OpenideAgentExtensionsEditor } from './openideAgentExtensionsEditor.js';
import { OpenideAgentExtensionsInput, OpenideAgentExtensionsInputSerializer } from './openideAgentExtensionsInput.js';
import { OpenideSkillInstallerEditor } from './openideSkillInstallerEditor.js';
import { OpenideSkillInstallerInput } from './openideSkillInstallerInput.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import './openideMemoryService.js';
import './openideUsageService.js';
import { ICodebaseMemoryService, CodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideCodebaseGraphService, OpenideCodebaseGraphService } from './openideCodebaseGraphService.js';
import { IOpenideCodebaseQueryService, OpenideCodebaseQueryService } from './openideCodebaseQueryService.js';
import { IOpenideCodebaseContextService, OpenideCodebaseContextService } from './openideCodebaseContextService.js';
import './openideCodebaseMemoryContribution.js';
import './openideCodebaseLanguageServerBridge.js';
import { Registry as PlatformRegistry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IExternalUriOpenerService, IExternalOpenerProvider, IExternalUriOpener } from '../../externalUriOpener/common/externalUriOpenerService.js';
import { ExternalUriOpenerPriority } from '../../../../editor/common/languages.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ISubagentDefinitionService, SubagentDefinitionService } from './openideSubagentDefinitionService.js';
import { ISubagentRegistryService, SubagentRegistryService } from './openideSubagentRegistryService.js';
import { ISubagentRunStorageService, SubagentRunStorageService } from './openideSubagentRunStorageService.js';
import { ISubagentRunService, SubagentRunService } from './openideSubagentRunService.js';
import { ISubagentPermissionService, SubagentPermissionService } from './openideSubagentPermissionService.js';
import { ISubagentExecutionService, SubagentExecutionService } from './openideSubagentExecutionService.js';
import { ISubagentOrchestrationService, SubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { ISubagentWorkspaceService, SubagentWorkspaceService } from './openideSubagentWorkspaceService.js';
import { ISubagentRoutingService, SubagentRoutingService } from './openideSubagentRoutingService.js';
import { OpenideSubagentEditor } from './openideSubagentEditor.js';
import { OpenideSubagentInput } from './openideSubagentInput.js';

const CHANNEL_ID = 'openideAgent';
const planExecutionModelIcon = registerIcon(
	'openide-plan-execution-model',
	{ fontCharacter: '\uf101' },
	localize('openide.plan.executionModelIcon', 'Icono del modelo que ejecutará el plan.')
);

registerSingleton(IOpenideCanvasService, OpenideCanvasService, InstantiationType.Delayed);
registerSingleton(ICodebaseMemoryService, CodebaseMemoryService, InstantiationType.Delayed);
registerSingleton(IOpenideCodebaseGraphService, OpenideCodebaseGraphService, InstantiationType.Delayed);
registerSingleton(IOpenideCodebaseQueryService, OpenideCodebaseQueryService, InstantiationType.Delayed);
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

/** Ctrl+click en una URL localhost del terminal (o cualquier link local) ofrece abrirla en la
 *  VISTA PREVIA del IDE, además del navegador externo. Al registrar un opener con prioridad
 *  'Option', VS Code muestra el picker nativo (IDE vs externo) cuando ambos pueden abrirla. */
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
						// 'Option' NO pisa al navegador: agrega la opción → aparece el picker nativo.
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

// Vista del chat en el dock derecho (auxiliary bar). isDefault → reemplaza el toggle del secondary sidebar.
const OPENIDE_CHAT_CONTAINER_ID = 'workbench.view.openideChat';
const OPENIDE_CHAT_VIEW_ID = 'workbench.view.openideChat.view';
// Iconos de producto: los glifos viven en la fuente OpenIDE (f200/f201), no como SVG
// incrustado. Así tema, actividad y webview comparten la misma semántica y métrica.
const openideChatIcon = registerIcon('openide-chat', { fontCharacter: '\uf200' }, localize('openide.chat.icon', "Icono del chat global de OpenIDE"));
registerIcon('openide-agent-tree', { fontCharacter: '\uf201' }, localize('openide.agentTree.icon', "Icono del árbol de agentes de OpenIDE"));
registerIcon('openide-mode-agent', { fontCharacter: '\uf202' }, localize('openide.mode.agent.icon', "Icono del modo Agent de OpenIDE"));
registerIcon('openide-mode-plan', { fontCharacter: '\uf203' }, localize('openide.mode.plan.icon', "Icono del modo Plan de OpenIDE"));
registerIcon('openide-mode-ask', { fontCharacter: '\uf204' }, localize('openide.mode.ask.icon', "Icono del modo Ask de OpenIDE"));

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

// Memoria del codebase: editor Codebase Architecture 2D jerárquico. El modo 3D legacy queda
// detrás de openide.memory.visualization.legacyGraphEnabled, pero no es la experiencia principal.
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideMemoryInput.ID, OpenideMemoryInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideMemoryEditor, OpenideMemoryEditor.ID, localize('openide.memory.editorName', "Memoria del codebase")),
	[new SyncDescriptor(OpenideMemoryInput)]
);

// Comando: abrir la galaxia de memoria del codebase.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'openide.memory.open',
			title: localize2('openide.memory.open', 'OpenIDE: Open Codebase Architecture'),
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
	async run(accessor: ServicesAccessor): Promise<void> { const version = await accessor.get(ICodebaseMemoryService).getVersion(); accessor.get(INotificationService).info(version ? `Codebase Architecture: ${version.nodeCount} nodos, ${version.edgeCount} relaciones, versión ${version.version}.` : 'Codebase Architecture: índice aún no construido.'); }
});

// Entrada OpenIDE del navegador nativo. Conserva la validación localhost para las tools y
// delega navegación, DevTools, inspector, capturas y persistencia al BrowserView de Code OSS.
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
		// el accessor solo vale sincrónicamente: resolver TODO antes del primer await
		const browserViewService = accessor.get(IBrowserViewWorkbenchService);
		const extraHosts = accessor.get(IConfigurationService).getValue<string[]>('openide.agent.browserAllowedHosts');
		let url = typeof urlArg === 'string' ? normalizeLocalUrl(urlArg, extraHosts) : undefined;
		// Sin URL, enfoca la preview única del workspace. Si todavía no existe, abre su empty
		// state nativo: la navegación llegará desde el puerto frontend levantado por el agente.
		// Nunca vuelve a sugerir localhost:3000 ni reemplaza una preview ya navegada.
		await browserViewService.openPreview(url);
	}
});

// Pick & Polish: picker visual sobre la app local (ventana con overlay estilo Figma/Cursor).
// El elemento clickeado (selector + HTML + estilos + screenshot) se adjunta al composer del chat.
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
		// el accessor solo vale sincrónicamente: resolver TODO antes del primer await
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

// Página "Proveedores de IA" (visual con límites independientes del modelo desktop): vista Cuentas (OAuth inline,
// nada de QuickPicks que se cierran al perder foco) + vista API keys con guardado inline.
// Es la UI principal de conexión — el Settings queda para ajustes finos.
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideProvidersInput.ID, OpenideProvidersInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideProvidersEditor, OpenideProvidersEditor.ID, localize('openide.providers.editorName', "Proveedores de IA")),
	[new SyncDescriptor(OpenideProvidersInput)]
);

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
		if (pane instanceof SettingsEditor2 || pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory('openideAgent/providers');
		}
	}
});

// Página "Extensiones del Agente" (skills / MCP / hooks / comandos): administración visual
// de la extensibilidad del agente en un único editor dedicado.
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(OpenideAgentExtensionsInput.ID, OpenideAgentExtensionsInputSerializer);
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OpenideAgentExtensionsEditor, OpenideAgentExtensionsEditor.ID, localize('openide.agentExtensions.editorName', "Extensiones del Agente")),
	[new SyncDescriptor(OpenideAgentExtensionsInput)]
);

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
		if (pane instanceof SettingsEditor2 || pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory('openideAgent/skills');
		}
	}
});

// Visor de diagramas a pantalla completa (MODAL nativo + zoom). Lo abre el chat con el
// SVG/HTML ya renderizado — reemplaza al modal casero del webview (confinado al panel).
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

	async run(accessor: ServicesAccessor, html?: string, title?: string): Promise<void> {
		if (typeof html !== 'string' || !html) {
			return;
		}
		const editorService = accessor.get(IEditorService);
		// MODAL nativo (el mismo del Settings) — el overlay editor recorta contra el modal
		// y overlayLayoutElement eleva el z-index por encima de la capa modal.
		await editorService.openEditor(new OpenideDiagramInput(html, typeof title === 'string' && title ? title : 'Diagrama'), undefined, MODAL_GROUP);
	}
});

// Comando: abrir los ajustes finos del agente en el Settings nativo (sección "Agente IA").
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
			subagents: 'openideAgent/subagents',
			advanced: 'openideAgent/advanced',
			chatRoot: 'chat',
			features: 'features',
			application: 'application',
			security: 'security',
			extensionsRoot: 'features/extensions',
		};
		const category = typeof section === 'string' ? categoryBySection[section] : 'commonlyUsed';
		const pane = await preferencesService.openSettings({
			jsonEditor: false,
			// Limpiamos búsquedas anteriores. La categoría se selecciona en el árbol real para
			// conservar "Todos los ajustes" y el resto del rail siempre disponibles.
			query: '',
		});
		if (pane instanceof SettingsEditor2 || pane instanceof OpenideSettingsEditor) {
			await pane.showSettingsCategory(category);
		}
	}
});

// ---- Review inline de ediciones del agente (integrado): keybindings por bloque/archivo.
// Solo activos con una sesión de review en el editor enfocado (CTX_OPENIDE_REVIEW_ACTIVE) —
// fuera del review, Ctrl+N / Ctrl+Y / Ctrl+Enter conservan su significado normal (p.ej. Ctrl+Y redo).
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

// ---- MODO PLAN: botones nativos del editor sobre los planes (.openide/plans/*.md) ----
// Aparecen en el título del editor solo con un plan abierto (regex sobre resourcePath).
const PLAN_GLOB = '**/.openide/plans/*.md';

// Editor de plan PROPIO (webview: markdown lindo + toolbar Modelo/Build + tareas interactivas).
// Reemplaza el preview nativo de markdown. Se registra como DEFAULT para los .openide/plans/*.md
// vía el resolver (abrir el archivo desde el explorer también lo usa); "Abrir como texto" en la
// toolbar del editor fuerza el editor de texto nativo (override DEFAULT_EDITOR_ASSOCIATION).
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

// Comando: abrir un plan en el editor propio (lo invoca plan_save y la card del chat). Fuerza
// ESTE editor por override sobre el resolver default.
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

// Plan: elegir el modelo de EJECUCIÓN (frontmatter execModel). Acepta un URI opcional como
// arg — el chat lo invoca vía executeCommand desde la card del plan (mismo QuickPick).
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
		// el accessor solo vale sincrónicamente: resolver TODO antes del primer await
		const editorService = accessor.get(IEditorService);
		const quickInput = accessor.get(IQuickInputService);
		const agent = accessor.get(IOpenideAgentService);
		const notificationService = accessor.get(INotificationService);
		const resource = resourceArg instanceof URI ? resourceArg : editorService.activeEditor?.resource;
		if (!resource) {
			return;
		}
		// modelos de todos los proveedores CONECTADOS (mismo criterio que el popover del chat)
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
// el chat lanza el run de ejecución como turno normal (onDidRequestPlanBuild).
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

// Comando: abrir el panel de desglose de contexto del chat. Lo dispara el indicador
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

// Puente interno Canvas → composer. La elección queda visible/editable y el usuario confirma Enviar.
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

// Comando: nuevo chat (limpia la conversación). Aparece como acción del título del panel del chat.
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

// Comando: fork de la conversación activa — rama independiente que hereda TODO el estado
// conversacional (estilo /fork de Claude Code). Sin merge: las ramas divergen.
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

// Configuración avanzada del agente. No modifica el TOC interno de Settings: las superficies
// visuales propias administran proveedores/extensiones y estas claves quedan disponibles para
// búsqueda o settings.json. Credenciales: SecretStorage, nunca settings.json.
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
// OpenIDE usa el breadcrumb contextual para planes/modelos; el Command Center superior duplica
// esa navegación y roba altura. Sigue siendo una preferencia sobreescribible por el usuario.
configurationRegistry.registerDefaultConfigurations([{ overrides: { 'window.commandCenter': false }, source: 'OpenIDE' }]);
configurationRegistry.registerConfiguration({
	id: 'openideAgent',
	order: 100,
	title: localize('openide.agent.title', "Agente IA"),
	type: 'object',
	properties: {
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
		// NOTA: el proveedor/modelo ACTIVOS ya no son settings — viven en IStorageService y se
		// configuran desde la página "Proveedores de IA" (openide.agent.openProviders) o el
		// picker nativo de modelos del chat. Acá quedan solo los ajustes de power-user.
		'openide.agent.customProviders': {
			type: 'array',
			default: [],
			order: 3,
			markdownDescription: localize('openide.agent.custom.desc', "Conectá cuentas, claves y modelos desde [Proveedores de IA](command:openide.agent.openProviders) — esta opción es solo para power-users. Proveedores custom: cualquier endpoint OpenAI-compatible (ej: un Ollama remoto, un proxy corporativo). Cada entrada: `{ id, label, protocol, baseUrl, defaultModel }`."),
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Identificador único' },
					label: { type: 'string', description: 'Nombre visible' },
					protocol: { type: 'string', enum: ['openai', 'anthropic'], default: 'openai' },
					baseUrl: { type: 'string', description: 'Base URL del endpoint (ej: http://localhost:11434/v1)' },
					defaultModel: { type: 'string' },
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
		'openide.memory.enabled': { type: 'boolean', default: true, order: 20, description: localize('openide.memory.enabled', 'Habilita la memoria del codebase.') },
		'openide.memory.indexOnOpen': { type: 'boolean', default: true, order: 21, description: localize('openide.memory.indexOnOpen', 'Valida y actualiza la memoria al abrir el workspace.') },
		'openide.memory.incrementalIndexing': { type: 'boolean', default: true, order: 22, description: localize('openide.memory.incremental', 'Actualiza sólo archivos modificados mediante watcher.') },
		'openide.memory.persistIndex': { type: 'boolean', default: true, order: 23, description: localize('openide.memory.persist', 'Persiste el índice por workspace.') },
		'openide.memory.maxContextTokens': { type: 'number', default: 12000, minimum: 1000, maximum: 100000, order: 24, description: localize('openide.memory.maxContext', 'Presupuesto de contexto recuperado automáticamente.') },
		'openide.memory.maxRetrievedNodes': { type: 'number', default: 50, minimum: 5, maximum: 500, order: 25, description: localize('openide.memory.maxNodes', 'Máximo de nodos recuperados para el agente.') },
		'openide.memory.maxTraversalDepth': { type: 'number', default: 2, minimum: 1, maximum: 8, order: 26, description: localize('openide.memory.maxDepth', 'Profundidad máxima de traversal.') },
		'openide.memory.visualization.defaultMode': { type: 'string', enum: ['architecture', 'dependencies', 'impact', 'matrix'], default: 'architecture', order: 27, description: localize('openide.memory.defaultMode', 'Modo inicial del editor Codebase Architecture.') },
		'openide.memory.visualization.maxVisibleNodes': { type: 'number', default: 300, minimum: 50, maximum: 2000, order: 28, description: localize('openide.memory.maxVisible', 'Máximo de elementos visibles en la arquitectura.') },
		'openide.memory.visualization.maxRelationDepth': { type: 'number', default: 2, minimum: 1, maximum: 5, order: 29, description: localize('openide.memory.maxRelationDepth', 'Profundidad máxima de relaciones visibles.') },
		'openide.memory.visualization.showHeuristicEdges': { type: 'boolean', default: true, order: 30, description: localize('openide.memory.heuristicEdges', 'Muestra relaciones heurísticas con estilo discontinuo.') },
		'openide.memory.visualization.semanticZoom': { type: 'boolean', default: true, order: 31, description: localize('openide.memory.semanticZoom', 'Usa zoom semántico por niveles de arquitectura.') },
		'openide.memory.visualization.legacyGraphEnabled': { type: 'boolean', default: false, order: 32, description: localize('openide.memory.legacyGraph', 'Mantiene disponible el grafo 3D legacy.') },
		'openide.memory.exclude': { type: 'array', default: [], order: 33, items: { type: 'string' }, description: localize('openide.memory.exclude', 'Patrones adicionales excluidos del índice.') },
		'openide.memory.include': { type: 'array', default: [], order: 34, items: { type: 'string' }, description: localize('openide.memory.include', 'Patrones adicionales incluidos en el índice.') },
		'openide.memory.indexTests': { type: 'boolean', default: true, order: 35, description: localize('openide.memory.indexTests', 'Incluye archivos de tests.') },
		'openide.memory.enableRegexFallback': { type: 'boolean', default: true, order: 36, description: localize('openide.memory.regex', 'Usa regex como fallback de baja confianza.') },
		'openide.memory.showHeuristicRelations': { type: 'boolean', default: true, order: 37, description: localize('openide.memory.showHeuristic', 'Expone relaciones heurísticas en la UI.') },
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
			default: 120,
			minimum: 25,
			maximum: 500,
			order: 11.25,
			description: localize('openide.agent.maxAgentIterations.desc', "Máximo de ciclos modelo → herramientas por ejecución. El valor alto permite tareas largas; las llamadas repetidas siguen protegidas por separado."),
		},
		'openide.agent.voiceModel': {
			type: 'string',
			default: '',
			order: 11.5,
			description: localize('openide.agent.voiceModel.desc', "Modelo para el dictado por voz del chat, formato \"provider/modelo\" (ej: gemini/gemini-3.5-flash). Vacío = automático: el primer proveedor multimodal conectado (Gemini, OpenAI, Qwen)."),
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
			markdownDescription: localize('openide.agent.usage.enabled', "Muestra barras de usage/rate-limit OAuth en la página de Proveedores (Anthropic OAuth). Apagalo si no querés consultar billing."),
		},
		'openide.agent.usage.pollMinutes': {
			type: 'number',
			default: 0,
			minimum: 0,
			maximum: 120,
			order: 21.06,
			markdownDescription: localize('openide.agent.usage.pollMinutes', "Polling opcional de usage en minutos (0 = desactivado, sólo refresh manual). Desactivado por defecto por privacy/billing."),
		},
		'openide.agent.web.enabled': { type: 'boolean', default: true, order: 21.1, markdownDescription: localize('openide.agent.web.enabled', "Habilita `web_search` y `web_fetch` para investigar web pública sin usar la preview localhost.") },
		'openide.agent.web.searchEndpoint': { type: 'string', default: '', order: 21.2, markdownDescription: localize('openide.agent.web.searchEndpoint', "Endpoint HTTPS JSON de búsqueda. Recibe `q` y `limit`; debe devolver `results`/`items` con `title`, `url` y `snippet`.") },
		'openide.agent.web.allowedHosts': { type: 'array', default: [], order: 21.3, items: { type: 'string' }, markdownDescription: localize('openide.agent.web.allowedHosts', "Allowlist opcional de hosts públicos para exploración web. Vacía permite cualquier host público no bloqueado.") },
		'openide.agent.web.blockedHosts': { type: 'array', default: [], order: 21.4, items: { type: 'string' }, markdownDescription: localize('openide.agent.web.blockedHosts', "Hosts públicos bloqueados para exploración web.") },
		'openide.agent.web.allowHttp': { type: 'boolean', default: false, order: 21.5, markdownDescription: localize('openide.agent.web.allowHttp', "Permite HTTP público sin TLS. Nunca habilita localhost, LAN ni direcciones privadas.") },
		'openide.agent.web.timeoutSeconds': { type: 'number', default: 15, minimum: 1, maximum: 60, order: 21.6, description: localize('openide.agent.web.timeout', "Timeout total por request web.") },
		'openide.agent.web.maxResponseBytes': { type: 'number', default: 2000000, minimum: 64000, maximum: 10000000, order: 21.7, description: localize('openide.agent.web.maxBytes', "Máximo de bytes descargados por fuente web.") },
		'openide.agent.web.maxExtractedChars': { type: 'number', default: 60000, minimum: 1000, maximum: 200000, order: 21.8, description: localize('openide.agent.web.maxChars', "Máximo de caracteres extraídos y enviados al modelo por fuente.") },
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
		'openide.agent.googleCloudProject': {
			type: 'string',
			default: '',
			order: 23.5,
			markdownDescription: localize('openide.agent.googleCloudProject.desc', "Proyecto GCP para Antigravity / Code Assist OAuth. Las cuentas personales suelen no necesitarlo (el proyecto administrado se resuelve solo al conectar). Cuentas Workspace o con licencia empresarial: poné acá el id de un proyecto con la API **Gemini for Google Cloud** habilitada."),
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

// Comando: recargar los servers MCP (re-lee los mcp.json, desconecta y reconecta todo).
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

// Comando: elegir el provider activo desde el catálogo.
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

// Comando: iniciar sesión OAuth en un proveedor del catálogo que lo soporte.
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

// Comando: configurar la API key de un provider (guardada en SecretStorage).
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

// Comando: probar el agente desde un Output channel (validación del backend).
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

// Comando: copiar la configuración MCP del motor de diagramas al portapapeles, para pegarla
// en el .mcp.json (u otro registro MCP) de chats de extensiones como Claude Code. El motor
// (openideDiagramEngine) es el mismo backend que usa el chat propio — única fuente de verdad.
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
