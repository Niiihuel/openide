/*---------------------------------------------------------------------------------------------
 *  OpenIDE — ViewPane del chat (dock derecho / auxiliary bar). Hostea un webview OVERLAY
 *  (createWebviewOverlay + claim/release + setAnchorElement) — el mismo patrón que el
 *  WebviewViewPane nativo. Un webview INLINE (mountTo) se RECARGA en blanco cuando el ViewPane
 *  se reparenta (togglear un panel / la auxiliary bar) → desaparecía todo. El overlay vive en
 *  una capa persistente anclada al cuerpo de la vista y sobrevive esos reparents. La clave para
 *  que NO quede negro detrás del dock es el rootContainer correcto (el monaco-scrollable-element
 *  ancestro), que posiciona y clipea el overlay sobre el cuerpo real de la vista.
 *  Puentea los mensajes con el motor agéntico (IOpenideAgentService).
 *--------------------------------------------------------------------------------------------*/

import { findParentWithClass, getWindow } from '../../../../base/browser/dom.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileKind, IFileService } from '../../../../platform/files/common/files.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ThemeColor } from '../../../../base/common/themables.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { asWebviewUri } from '../../webview/common/webview.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { getOpenideChatHtml } from './openideChatHtml.js';
import { OpenideAgentCommands } from './openideAgentCommands.js';
import { IOpenideAgentService, setPlanFrontmatterValue } from './openideAgentService.js';
import { ISubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { IChatSessionUsage, OpenideChatSessions } from './openideChatSessions.js';
import { buildCodiconCss } from './openideWebviewCodicons.js';
import { AgentLoopEvent, AgentMode, IAgentLocation, IChatCapabilityMention, IChatMessage, isSlashVisibleCapability } from '../common/openideAgentTypes.js';
import { estimateConversationTokens } from '../common/openideTokens.js';

interface INativeWorkflowCommand {
	readonly slug: string;
	readonly description: string;
	readonly hint: string;
	readonly mode?: AgentMode;
	readonly instruction: string;
}

/** Comandos de workflow propios del IDE. Se resuelven antes que los comandos Markdown para
 *  que el flujo seguro no dependa de que cada workspace copie prompts de plantilla. */
const NATIVE_WORKFLOW_COMMANDS: readonly INativeWorkflowCommand[] = [
	{ slug: 'agent', description: 'Ejecuta la tarea en modo Agent', hint: '[tarea]', mode: 'agent', instruction: 'Implementá la siguiente tarea con el workflow seguro de OpenIDE:' },
	{ slug: 'plan', description: 'Crea un plan de implementación revisable', hint: '<tarea>', mode: 'plan', instruction: 'Prepará un plan completo para la siguiente tarea:' },
	{ slug: 'ask', description: 'Investiga y responde sin editar', hint: '<consulta>', mode: 'ask', instruction: 'Investigá y respondé la siguiente consulta sin editar archivos:' },
	{ slug: 'ultra', description: 'Implementa con investigación y revisión multi-agente', hint: '<tarea>', mode: 'ultra', instruction: 'Resolvé la siguiente tarea con orquestación Ultracode y revisión adversarial:' },
	{ slug: 'review', description: 'Revisa cambios con un subagente independiente', hint: '<archivos o foco>', instruction: 'Ejecutá review_changes sobre los archivos modificados relevantes. Si hay hallazgos bloqueantes, corregilos y repetí la revisión.' },
	{ slug: 'verify', description: 'Valida cambios antes de integrar', hint: '[foco]', instruction: 'Verificá los cambios: diagnósticos, pruebas pertinentes y git_preflight. No propongas commit si algo falla.' },
	{ slug: 'status', description: 'Muestra el estado y siguiente paso del workflow', hint: '', instruction: 'Ejecutá git_status y resumí el siguiente paso seguro del workflow.' },
	{ slug: 'commit', description: 'Prepara un commit atómico y seguro', hint: '<mensaje>', instruction: 'Prepará un commit atómico: identificá archivos explícitos, ejecutá review_changes, git_preflight y solo entonces proponé git_commit para aprobación. Nunca hagas push.' },
	{ slug: 'workflow', description: 'Explica o configura la política de revisión y commits', hint: '[preferencias]', instruction: 'Explicá o configurá el workflow nativo de OpenIDE usando workflow_configure si hay preferencias concretas.' },
];

export class OpenideChatViewPane extends ViewPane {

	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private _container: HTMLElement | undefined;
	private _rootContainer: HTMLElement | undefined;
	private _runCts: CancellationTokenSource | undefined;
	/** Promesa del run raíz. El rollback la espera después de cancelar para impedir que una tool
	 *  tardía vuelva a escribir sobre los archivos recién restaurados. */
	private _runPromise: Promise<void> | undefined;
	/** Rollback muta archivos del workspace: una sola transacción global, incluso entre sesiones. */
	private _rollbackQueue: Promise<void> = Promise.resolve();
	private _rollbackOperations = 0;
	private _rollbackActive = false;
	private _sendPreparations = 0;
	private readonly _sendPreparationWaiters = new Set<() => void>();
	private _webviewCreating = false;
	/** Store de conversaciones (tabs + historial), persistido. */
	private _sessions: OpenideChatSessions | undefined;
	/** /Comandos del composer (commands/*.md proyecto + global), creado lazy. */
	private _commands: OpenideAgentCommands | undefined;
	/** Id de la conversación activa; su array de mensajes es donde runMessages appendea. */
	private _activeId: string | undefined;
	private readonly _subagentSessions = new Map<string, { sessionId: string; messages: IChatMessage[]; running: boolean }>();
	private readonly _subagentIdBySession = new Map<string, string>();
	private _runOwnerId: string | undefined;
	private _planBuild: { resource: URI; owner: string; providerId: string; model: string } | undefined;
	/** Ancho del auxiliary bar antes de abrir la columna Agentes; se restaura al cerrarla. */
	private _auxiliaryBarWidthBeforeAgentLayout: number | undefined;
	/** Pick & Polish pendiente: se adjunta (contexto + screenshot) al próximo mensaje. */
	private _pendingPick: { selector: string; context: string; image?: { mimeType: string; data: string } } | undefined;

	// Estado del footer nativo (status bar): estado │ modelo │ ████░░░░░░ 45K/200K.
	// Vive acá (y no en el webview) — el usuario lo quiere junto a las notificaciones.
	private readonly _statusEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _ctxEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private _busy = false;
	private _statusModel = '';
	private _statusProvider = '';
	private _statusConnected = false;
	private _sessionPostGeneration = 0;
	private _ctx: IChatSessionUsage = { input: 0, output: 0, used: 0, limit: 0 };
	private static readonly FOLLOW_STORAGE_KEY = 'openide.agent.followChanges';
	private _followEnabled = false;
	private _followEpoch = 0;
	private _followQueue: Promise<void> = Promise.resolve();
	private _lastAgentLocation: IAgentLocation | undefined;
	private _lastBackgroundTerminalId: string | undefined;

	/** Cancela el run visible y lo invalida de inmediato. Los callbacks tardíos del run anterior
	 * se descartan comparando la identidad de este CTS antes de tocar el webview o el status. */
	private cancelCurrentRun(): void {
		const run = this._runCts;
		this._runCts = undefined;
		this._runOwnerId = undefined;
		if (this._planBuild) {
			this.agentService.failPlanBuild(this._planBuild.resource, this._planBuild.owner);
			this._planBuild = undefined;
		}
		run?.cancel();
	}

	private trackSubagentEvent(ev: AgentLoopEvent): AgentLoopEvent {
		if (ev.type === 'subagentStart') {
			const existing = this._subagentSessions.get(ev.id);
			if (existing) {
				return { ...ev, sessionId: existing.sessionId };
			}
			const messages: IChatMessage[] = [{ role: 'user', content: ev.prompt }];
			const sessionId = this.sessions().createBackground(ev.title, messages);
			this._subagentSessions.set(ev.id, { sessionId, messages, running: true });
			this._subagentIdBySession.set(sessionId, ev.id);
			return { ...ev, sessionId };
		}
		if (ev.type !== 'subagentEvent' && ev.type !== 'subagentDone') {
			return ev;
		}
		const tracked = this._subagentSessions.get(ev.id);
		if (!tracked) {
			return ev;
		}
		if (ev.type === 'subagentEvent') {
			const nested = ev.ev;
			if (nested.type === 'text') {
				const last = tracked.messages[tracked.messages.length - 1];
				if (last?.role === 'assistant' && !last.toolCalls?.length) {
					last.content += nested.delta;
				} else {
					tracked.messages.push({ role: 'assistant', content: nested.delta });
				}
			} else if (nested.type === 'toolStart') {
				tracked.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: nested.id, name: nested.name, argumentsJson: nested.argumentsJson }] });
			} else if (nested.type === 'toolResult') {
				tracked.messages.push({ role: 'tool', toolCallId: nested.id, content: nested.result });
			} else if (nested.type === 'info') {
				tracked.messages.push({ role: 'assistant', content: nested.message });
			}
		} else {
			tracked.running = false;
			if (ev.cancelled) {
				tracked.messages.push({ role: 'assistant', content: 'Subagente cancelado por el usuario.' });
			}
			// Tab transitoria: al terminar el run, cerramos su tab del strip. La sesión queda
			// accesible desde el panel de Agentes. Respetamos tabs abiertas manualmente por el
			// usuario (si _activeId === sessionId, el usuario la está mirando y no la cerramos).
			if (this._activeId !== tracked.sessionId) {
				this.sessions().closeBackgroundTab(tracked.sessionId);
			}
		}
		const shouldPersist = ev.type === 'subagentDone' || (ev.type === 'subagentEvent' && ev.ev.type !== 'text');
		if (shouldPersist) {
			this.sessions().save(tracked.sessionId, tracked.messages, ev.type === 'subagentDone' && !!ev.isError);
		}
		return ev;
	}

	// Tooltip NATIVO para los [data-tip] del webview: anchor invisible posicionado con el
	// rect que manda el iframe (mismas coords que el container) + IHoverService real.
	private readonly _hoverService: IHoverService;
	private _hoverAnchor: HTMLElement | undefined;
	private _activeHover: { dispose(): void } | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ISubagentOrchestrationService private readonly subagentOrchestration: ISubagentOrchestrationService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._hoverService = hoverService;
		this._followEnabled = storageService.getBoolean(OpenideChatViewPane.FOLLOW_STORAGE_KEY, StorageScope.WORKSPACE, false);
	}

	/** La columna Agentes pertenece al layout del workbench, no solo al webview. Al abrirla
	 *  ensancha el auxiliary bar para que éste desplace el editor, igual que Cursor. */
	private setAgentLayoutOpen(open: boolean): void {
		const current = this.layoutService.getSize(Parts.AUXILIARYBAR_PART);
		if (open) {
			if (this._auxiliaryBarWidthBeforeAgentLayout !== undefined) {
				return;
			}
			this._auxiliaryBarWidthBeforeAgentLayout = current.width;
			const windowWidth = this._container?.ownerDocument.defaultView?.innerWidth ?? current.width;
			// Conserva el ancho de chat que eligió el usuario y agrega sólo la columna Agentes.
			const targetWidth = Math.max(current.width, Math.min(windowWidth - 480, current.width + 340));
			this.layoutService.setSize(Parts.AUXILIARYBAR_PART, { width: targetWidth, height: current.height });
			return;
		}
		if (this._auxiliaryBarWidthBeforeAgentLayout !== undefined) {
			this.layoutService.setSize(Parts.AUXILIARYBAR_PART, { width: this._auxiliaryBarWidthBeforeAgentLayout, height: current.height });
			this._auxiliaryBarWidthBeforeAgentLayout = undefined;
		}
	}

	/** Serializa navegaciones y descarta destinos obsoletos. Así una lectura lenta no vuelve a
	 *  abrirse encima del archivo que el agente empezó a editar después. */
	private queueFollow(action: () => Promise<void>): void {
		if (!this._followEnabled) {
			return;
		}
		const epoch = ++this._followEpoch;
		this._followQueue = this._followQueue
			.then(async () => {
				if (this._followEnabled && epoch === this._followEpoch) {
					await action();
				}
			})
			.catch(() => { /* un archivo borrado o una terminal terminada no corta el seguimiento */ });
	}

	private followLocation(location: IAgentLocation): void {
		this._lastAgentLocation = location;
		this.queueFollow(() => this.agentService.followAgentLocation(location));
	}

	private setFollowEnabled(webview: IOverlayWebview, enabled: boolean): void {
		this._followEnabled = enabled;
		this._followEpoch++;
		this.storageService.store(OpenideChatViewPane.FOLLOW_STORAGE_KEY, enabled, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		webview.postMessage({ type: 'followState', enabled });
		if (!enabled) {
			return;
		}
		if (this._lastBackgroundTerminalId) {
			const id = this._lastBackgroundTerminalId;
			this.queueFollow(() => this.agentService.followBackgroundTerminal(id));
		} else if (this._lastAgentLocation) {
			this.followLocation(this._lastAgentLocation);
		}
	}

	/** Muestra el hover NATIVO del workbench sobre un rect del webview (bridge [data-tip]). */
	private showNativeTip(text: string, x: number, y: number, w: number, h: number, position?: 'left' | 'right' | 'below' | 'above'): void {
		if (!this._container || !text) {
			return;
		}
		if (!this._hoverAnchor) {
			this._hoverAnchor = document.createElement('div');
			this._hoverAnchor.style.position = 'absolute';
			this._hoverAnchor.style.pointerEvents = 'none';
			this._container.appendChild(this._hoverAnchor);
		}
		const a = this._hoverAnchor;
		a.style.left = `${Math.round(x)}px`;
		a.style.top = `${Math.round(y)}px`;
		a.style.width = `${Math.max(1, Math.round(w))}px`;
		a.style.height = `${Math.max(1, Math.round(h))}px`;
		this._activeHover?.dispose();
		const hoverPosition = position === 'left' ? HoverPosition.LEFT
			: position === 'right' ? HoverPosition.RIGHT
				: position === 'below' ? HoverPosition.BELOW
					: position === 'above' ? HoverPosition.ABOVE
						: undefined;
		this._activeHover = this._hoverService.showInstantHover({
			content: text,
			target: a,
			appearance: { compact: true, showPointer: true },
			position: hoverPosition === undefined ? undefined : { hoverPosition },
		}, false);
	}

	private hideNativeTip(): void {
		this._activeHover?.dispose();
		this._activeHover = undefined;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = container;
		this._rootContainer = undefined;
		container.style.position = 'relative';
		if (!this._webview.value && !this._webviewCreating) {
			this._webviewCreating = true;
			this.createWebview(container);
		} else {
			this.layoutWebview();
		}
	}

	/** claim/release del overlay según la visibilidad del cuerpo (togglear panel, colapsar la
	 *  vista, cambiar de auxiliary bar): el contenido persiste, solo se muestra/oculta. */
	private updateWebviewVisibility(): void {
		if (this.isBodyVisible()) {
			this._webview.value?.claim(this, getWindow(this._container), undefined);
			this.layoutWebview();
		} else {
			this._webview.value?.release(this);
		}
	}

	/** Ancla el overlay al cuerpo real de la vista (el scrollable-element ancestro lo clipea →
	 *  no queda negro por detrás del dock). Se re-llama en cada layout. */
	private layoutWebview(): void {
		const webview = this._webview.value;
		if (!this._container || !webview) {
			return;
		}
		if (!this._rootContainer || !this._rootContainer.isConnected) {
			this._rootContainer = findParentWithClass(this._container, 'monaco-scrollable-element') ?? undefined;
		}
		webview.setAnchorElement(this._container, this._rootContainer);
	}

	// ---- File icon theme dentro del webview: se re-inyecta el stylesheet del theme activo
	// (el mismo del árbol de archivos) con las url() reescritas a webview URIs, así el menú
	// de @menciones usa los MISMOS íconos y sigue al theme si cambia. ----

	/** Lee el stylesheet del file icon theme del DOM del workbench y reescribe recursos. */
	private readIconThemeCss(container: HTMLElement): { css: string; roots: URI[] } {
		const roots = new Map<string, URI>();
		let css = '';
		try {
			const style = getWindow(container).document.querySelector('style.contributedFileIconTheme');
			css = style?.textContent ?? '';
			if (css) {
				css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, _q: string, raw: string) => {
					try {
						// el stylesheet del theme llega con la URL escapada estilo CSS
						// (vscode-file\:\/\/vscode-app\/...) → des-escapar antes de parsear
						let uri = URI.parse(raw.replace(/\\(.)/g, '$1'));
						if (uri.scheme === 'vscode-file') {
							uri = FileAccess.uriToFileUri(uri);
						}
						if (uri.scheme !== 'file') {
							return whole;
						}
						const dir = uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/') + 1) });
						roots.set(dir.toString(), dir);
						return `url('${asWebviewUri(uri).toString(true)}')`;
					} catch {
						return whole;
					}
				});
			}
		} catch { /* sin theme css: las sugerencias caen al codicon genérico */ }
		return { css, roots: [...roots.values()] };
	}

	private postIconThemeCss(webview: IOverlayWebview, container: HTMLElement, updateRoots: boolean): void {
		const { css, roots } = this.readIconThemeCss(container);
		if (updateRoots && roots.length) {
			// cambiar localResourceRoots recarga el webview; el flujo ready→postRestore lo repuebla
			webview.contentOptions = { allowScripts: true, localResourceRoots: roots };
		}
		webview.postMessage({ type: 'iconThemeCss', css });
	}

	/** Colores de SYNTAX del theme de Monaco para los bloques de código del chat: resuelve los
	 *  tokenColors (textmate) del color theme activo a las clases .hl-* del webview — el mismo
	 *  hue que el editor, unicidad visual. Última regla que matchea gana (semántica textmate). */
	private postTokenColorsCss(webview: IOverlayWebview): void {
		const theme = this.workbenchThemeService.getColorTheme();
		const rules = (theme as { tokenColors?: readonly { scope?: string | string[]; settings?: { foreground?: string } }[] }).tokenColors ?? [];
		const resolve = (wanted: string[]): string | undefined => {
			let color: string | undefined;
			for (const rule of rules) {
				const fg = rule.settings?.foreground;
				if (!fg || !rule.scope) {
					continue;
				}
				const scopes = typeof rule.scope === 'string' ? rule.scope.split(',').map(s => s.trim()) : rule.scope;
				for (const rs of scopes) {
					for (const want of wanted) {
						if (want === rs || want.startsWith(rs + '.')) {
							color = fg;
						}
					}
				}
			}
			return color;
		};
		const parts: string[] = [];
		const emit = (cls: string, color: string | undefined, extra = '') => {
			if (color) {
				parts.push(`.${cls} { color: ${color}; opacity: 1; ${extra}}`);
			}
		};
		emit('hl-com', resolve(['comment']), 'font-style: italic; ');
		emit('hl-str', resolve(['string']));
		emit('hl-kw', resolve(['keyword', 'storage.type']), 'font-weight: 600; ');
		emit('hl-num', resolve(['constant.numeric']));
		emit('hl-fn', resolve(['entity.name.function', 'support.function']));
		webview.postMessage({ type: 'tokenColorsCss', css: parts.join('\n') });
	}

	private async createWebview(container: HTMLElement): Promise<void> {
		const codiconCss = await buildCodiconCss(this.fileService);
		const nonce = generateUuid().replace(/-/g, '');
		const iconTheme = this.readIconThemeCss(container);
		const webview = this.webviewService.createWebviewOverlay({
			origin: generateUuid(),
			providedViewType: 'openideChat',
			title: 'OpenIDE Chat',
			options: { purpose: WebviewContentPurpose.WebviewView, enableFindWidget: false, tryRestoreScrollPosition: false },
			contentOptions: { allowScripts: true, localResourceRoots: iconTheme.roots },
			extension: undefined,
		});
		this._webview.value = webview;
		webview.setHtml(getOpenideChatHtml(nonce, codiconCss));
		this._register(this.onDidChangeBodyVisibility(() => this.updateWebviewVisibility()));
		this.updateWebviewVisibility();
		this._register(this.workbenchThemeService.onDidFileIconThemeChange(() => this.postIconThemeCss(webview, container, true)));
		this._register(this.workbenchThemeService.onDidColorThemeChange(() => this.postTokenColorsCss(webview)));

		this._register(this.subagentOrchestration.onDidChangeRun(event => {
			if (event.type === 'timeline') { webview.postMessage({ type: 'subagentTimeline', runId: event.runId, event: event.event }); return; }
			webview.postMessage({ type: 'subagentRun', run: event.run });
			if ((event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') && event.run.deliveryState === 'pending') {
				const sessionMessages = this.sessions().messagesOf(event.run.parentConversationId);
				if (!sessionMessages.some(message => message.subagentRunId === event.run.runId)) {
					sessionMessages.push({ role: 'assistant', content: event.run.result?.summary || event.run.error || `Subagente ${event.run.status}.`, subagentRunId: event.run.runId });
					this.sessions().save(event.run.parentConversationId, sessionMessages, event.run.status === 'failed');
				}
				this.subagentOrchestration.markDelivered(event.run.runId);
			}
		}));

		this._register(this.agentService.onDidChange(() => {
			void this.postSession(webview);
			void this.postContextCapabilities(webview);
		}));

		// Pick & Polish: el elemento elegido en la app local queda pendiente acá (contexto +
		// screenshot) y se adjunta al PRÓXIMO mensaje; el webview solo muestra el chip.
		this._register(this.agentService.onDidPickElement(r => {
			const styles = r.styles ? `\nEstilos computados relevantes:\n${r.styles}` : '';
			this._pendingPick = {
				selector: r.selector,
				context: `\n\n[Pick & Polish — elemento seleccionado por el usuario en su app local]\nPágina: ${r.pageUrl}\nSelector: ${r.selector}\nHTML:\n${r.html}${styles}\nFlujo sugerido: aplicá el cambio EN VIVO primero (browser_navigate a la página, browser_set_style sobre el selector, browser_screenshot para validar el antes/después) y después llevalo al CÓDIGO FUENTE (ubicá el componente con search_text por clase/texto/testid y editá con edit_file).`,
				// el pick in-page no trae screenshot (rect relativo al iframe de la preview)
				image: r.screenshotBase64 ? { mimeType: 'image/jpeg', data: r.screenshotBase64 } : undefined,
			};
			webview.postMessage({ type: 'pickChip', selector: r.selector });
		}));

		// Terminales en segundo plano: el estado puede cambiar DESPUÉS del run, por eso va por su
		// propio evento (no por el onEvent del run).
		this._register(this.agentService.onDidChangeBackgroundTerminal(ev => {
			webview.postMessage({ type: 'backgroundTerminal', id: ev.id, command: ev.command, status: ev.status, exitCode: ev.exitCode });
			if (ev.status === 'running') {
				this._lastBackgroundTerminalId = ev.id;
				this.queueFollow(() => this.agentService.followBackgroundTerminal(ev.id));
			} else if (this._lastBackgroundTerminalId === ev.id) {
				this._lastBackgroundTerminalId = undefined;
			}
		}));

		// Deshacer/Conservar POR BLOQUE en el editor (review inline): los conteos de la bandeja
		// de archivos cambian fuera del run — added=removed=0 ⇒ archivo resuelto (fila afuera).
		this._register(this.agentService.onDidChangeFileDiff(ev => {
			webview.postMessage({
				type: 'fileDiff', path: ev.path, added: ev.added, removed: ev.removed,
				icon: getIconClasses(this.modelService, this.languageService, URI.file('/' + ev.path), FileKind.FILE).join(' '),
			});
		}));

		// MODO PLAN: plan_save guardó el documento → card de revisión/aprobación en el transcript.
		this._register(this.agentService.onDidCreatePlan(ev => {
			webview.postMessage({ type: 'planCard', path: ev.path, title: ev.title, markdown: ev.markdown });
		}));
		this._register(this.agentService.onDidChangeCanvas(ev => {
			webview.postMessage({ type: 'canvasCard', path: ev.path, title: ev.title, created: ev.created });
		}));
		// Plan aprobado (card del chat o botón del editor): el webview pasa a modo 'agent' y manda
		// el mensaje de ejecución por el MISMO camino que el composer (dispatchSend → 'send' →
		// handleSend) — el run aparece en el chat como un turno normal.
		this._register(this.agentService.onDidRequestPlanBuild(ev => {
			if (this._busy || this._planBuild) {
				this.agentService.failPlanBuild(ev.resource, ev.owner);
				this.notificationService.warn('Esperá a que termine la ejecución actual antes de aprobar otro plan.');
				return;
			}
			this._planBuild = { resource: ev.resource, owner: ev.owner, providerId: ev.providerId, model: ev.model };
			// Aprobar es una transición operativa silenciosa: resolver la card y ejecutar con un
			// mensaje hidden. El transcript no muestra un globo artificial “Ejecutar plan…”.
			webview.postMessage({ type: 'planBuildStart', path: ev.path });
			const sessionId = this.sessions().ensureActive();
			const messages = this.sessions().messagesOf(sessionId);
			const turn: IChatMessage = {
				role: 'user', hidden: true, messageId: generateUuid(), providerId: ev.providerId, modelId: ev.model,
				content: `Ejecutá el plan aprobado en ${ev.path}. Leé el archivo, seguí las tareas de "## Tareas" EN ORDEN, usá update_todos para reflejar el progreso, y al completar cada tarea tildá su checkbox en el .md (edit_file: "- [ ]" → "- [x]").`,
			};
			messages.push(turn); this.sessions().save(sessionId, messages, false);
			void this.runExistingTurn(webview, sessionId, messages, turn, 'agent');
		}));

		this._register(webview.onMessage(e => {
			const msg: any = e.message;
			if (!msg) {
				return;
			}
			switch (msg.type) {
				case 'ready': {
					const s = this.sessions();
					this._activeId = s.ensureActive();
					this.postTabs(webview);
					this.postRestore(webview);
					for (const diff of this.agentService.pendingFileDiffs()) {
						webview.postMessage({
							type: 'fileDiff', ...diff,
							icon: getIconClasses(this.modelService, this.languageService, URI.file('/' + diff.path), FileKind.FILE).join(' '),
						});
					}
					this.postSession(webview);
					void this.postContextCapabilities(webview);
					this.postIconThemeCss(webview, container, false);
					this.postTokenColorsCss(webview);
					if (this._pendingPick) {
						webview.postMessage({ type: 'pickChip', selector: this._pendingPick.selector });
					}
					webview.postMessage({ type: 'followState', enabled: this._followEnabled });
					for (const run of this.subagentOrchestration.getRunsForParent(this._activeId ?? '')) { webview.postMessage({ type: 'subagentRun', run }); }
					for (const run of this.subagentOrchestration.pendingDeliveries(this._activeId ?? '')) {
						const sessionMessages = this.sessions().messagesOf(run.parentConversationId);
						if (!sessionMessages.some(message => message.subagentRunId === run.runId)) { sessionMessages.push({ role: 'assistant', content: run.result?.summary || run.error || `Subagente ${run.status}.`, subagentRunId: run.runId }); this.sessions().save(run.parentConversationId, sessionMessages, run.status === 'failed'); }
						this.subagentOrchestration.markDelivered(run.runId);
					}
					break;
				}
				case 'toggleFollow': {
					const enabled = !this._followEnabled;
					this.setFollowEnabled(webview, enabled);
					this.agentService.setPlanFollowEnabled(enabled);
					break;
				}
				case 'agentLayoutState':
					this.setAgentLayoutOpen(msg.open === true);
					void webview.postMessage({ type: 'agentLayoutReady', open: msg.open === true });
					break;
				case 'pickRemove':
					this._pendingPick = undefined;
					break;
				case 'send':
					this.handleSend(webview, msg);
					break;
				case 'compact':
					this.handleCompact(webview);
					break;
				case 'fileQuery':
					// Autocomplete del @ del composer: búsqueda fuzzy de archivos del workspace.
					// icons = clases del file icon theme por item (getIconClasses solo mira el
					// basename/lenguaje, así que alcanza con un URI sintético del path relativo).
					this.agentService.searchWorkspaceFiles(String(msg.q ?? '')).then(
						items => webview.postMessage({
							type: 'fileSuggest', q: String(msg.q ?? ''), items,
							icons: items.map(p => getIconClasses(this.modelService, this.languageService, URI.file('/' + p), FileKind.FILE).join(' ')),
						}),
						() => webview.postMessage({ type: 'fileSuggest', q: String(msg.q ?? ''), items: [] }),
					);
					break;
				case 'commandQuery':
					// Picker `/`: workflows/comandos y skills explícitas. Las tools builtin/MCP quedan
					// disponibles sólo para selección autónoma del modelo, no como comandos del usuario.
					Promise.all([this.commands().scan(), this.agentService.listComposerCapabilities()]).then(
						([commands, capabilities]) => {
							const q = String(msg.q ?? '').toLowerCase();
							const matches = (name: string, description: string) => !q || name.toLowerCase().startsWith(q) || name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
							const commandItems = commands
								.filter(c => c.slug !== 'compact')
								.filter(c => !NATIVE_WORKFLOW_COMMANDS.some(native => native.slug === c.slug))
								.filter(c => matches(c.slug, c.description))
								.map(c => ({ kind: 'command', name: c.slug, description: c.description, hint: c.argumentHint }));
							const builtinItems = [
								...NATIVE_WORKFLOW_COMMANDS
									.filter(command => matches(command.slug, command.description))
									.map(command => ({ kind: 'command', name: command.slug, description: command.description, hint: command.hint })),
								...(matches('compact', 'Resume la conversación anterior y libera espacio de contexto sin iniciar un turno del modelo.')
									? [{ kind: 'command', name: 'compact', description: 'Resume la conversación anterior y libera espacio de contexto sin iniciar un turno del modelo.' }]
									: []),
							];
							const capabilityItems = capabilities
								.filter(c => isSlashVisibleCapability(c.kind))
								.filter(c => matches(c.name, c.description))
								.map(c => ({ kind: c.kind, name: c.name, description: c.description, risk: c.risk }));
							webview.postMessage({ type: 'commandSuggest', q: String(msg.q ?? ''), items: [...capabilityItems, ...builtinItems, ...commandItems] });
						},
						() => webview.postMessage({ type: 'commandSuggest', q: String(msg.q ?? ''), items: [] }),
					);
					break;
				case 'abort':
					{
						const subagentId = this._activeId ? this._subagentIdBySession.get(this._activeId) : undefined;
						if (subagentId) {
							this.agentService.cancelSubagent(subagentId);
							break;
						}
					}
					this.cancelCurrentRun();
					this._busy = false;
					this.updateStatusbar();
					break;
				case 'cancelSubagent':
					if (typeof msg.id === 'string') {
						this.agentService.cancelSubagent(msg.id);
					}
					break;
				case 'openSubagentChat':
					if (typeof msg.id === 'string') {
						this.sessions().activate(msg.id);
						this._activeId = msg.id;
						this.postRestore(webview);
						this.postTabs(webview);
						const subId = this._subagentIdBySession.get(msg.id);
						webview.postMessage({ type: 'runState', busy: subId ? !!this._subagentSessions.get(subId)?.running : false });
					}
					break;
				case 'askResponse':
					this.agentService.resolveAsk(String(msg.id), String(msg.answer ?? ''));
					break;
				case 'modeSuggestionResponse': {
					const accepted = !!msg.accepted;
					this.agentService.resolveModeSuggestion(String(msg.id), accepted);
					const targetMode = msg.mode === 'plan' || msg.mode === 'ultra' || msg.mode === 'agent' || msg.mode === 'ask' ? msg.mode : undefined;
					if (accepted && targetMode) {
						const owner = this._runOwnerId;
						const prompt = typeof msg.prompt === 'string' ? msg.prompt.trim() : '';
						const previousRun = this._runPromise;
						void (previousRun ?? Promise.resolve()).then(() => this.resumeSilentlyInMode(webview, owner, targetMode, prompt));
					}
					break;
				}
				case 'voiceStart':
					this.startVoice(webview);
					break;
				case 'voiceStop':
					this.stopVoice(webview);
					break;
				case 'approvalResponse':
					this.agentService.resolveApproval(String(msg.id), String(msg.decision ?? 'deny'));
					break;
				case 'openProviders':
					this.commandService.executeCommand('openide.agent.openProviders');
					break;
				case 'openMemoryGraph':
					this.commandService.executeCommand('openide.memory.open');
					break;
				case 'diagramFullscreen':
					// modal NATIVO con zoom (reemplaza el modal interno del webview)
					this.commandService.executeCommand('openide.diagram.fullscreen', String(msg.html ?? ''), 'Diagrama');
					break;
				case 'imageFullscreen': {
					// Reuse the workbench's Images Preview editor. Its modal shell can resize,
					// maximize, or move the preview into a regular editor tab.
					const source = typeof msg.src === 'string' ? msg.src : '';
					const match = /^data:([^;,]+);base64,(.+)$/s.exec(source);
					if (match) {
						this.commandService.executeCommand('workbench.action.chat.openImageInCarousel', {
							name: 'openide-image',
							mimeType: match[1],
							data: decodeBase64(match[2]).buffer,
							title: 'Imagen',
						});
					}
					break;
				}
				case 'openBrowser':
					this.commandService.executeCommand('openide.browser.open');
					break;
				case 'tip':
					// [data-tip] del webview → hover NATIVO del workbench (bridge).
					this.showNativeTip(
						String(msg.text ?? ''),
						Number(msg.x) || 0,
						Number(msg.y) || 0,
						Number(msg.w) || 0,
						Number(msg.h) || 0,
						msg.position === 'left' || msg.position === 'right' || msg.position === 'below' || msg.position === 'above' ? msg.position : undefined,
					);
					break;
				case 'tipHide':
					this.hideNativeTip();
					break;
				case 'selectProvider':
					if (typeof msg.id === 'string' && msg.id) {
						this.agentService.setActiveProvider(msg.id);
					}
					break;
				case 'selectModel':
					// '' = volver al modelo por defecto del proveedor.
					if (typeof msg.model === 'string') {
						this.agentService.setModel(msg.model);
					}
					break;
				case 'selectProviderModel':
					// Popover de modelos del webview: activa proveedor + modelo de una.
					if (typeof msg.id === 'string' && msg.id) {
						(async () => {
							await this.agentService.setActiveProvider(msg.id);
							await this.agentService.setModel(typeof msg.model === 'string' ? msg.model : '');
						})();
					}
					break;
				case 'setEffort':
					// Razonamiento global: max es un nivel lógico que cada adapter degrada al máximo
					// soportado por su provider/modelo (max, xhigh, high o budget manual).
					if (typeof msg.effort === 'string' && ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(msg.effort)) {
						this.agentService.setReasoningEffort(msg.effort);
					}
					break;
				case 'setPermission':
					// Política de permisos (popover del modo): ask · auto-edit · auto-all.
					if (typeof msg.mode === 'string') {
						this.agentService.setPermissionMode(msg.mode);
					}
					break;
				case 'newSession':
					this.cancelCurrentRun();
					this._activeId = this.sessions().create();
					this.postRestore(webview);
					this.postTabs(webview);
					break;
				case 'forkSession':
					// Fork (rama independiente que hereda todo el contexto). No cancela el run de
					// la sesión original: el fork es una tab nueva; la original sigue si corría.
					if (typeof msg.id === 'string') {
						const forkedId = this.sessions().fork(msg.id);
						if (forkedId) {
							this.cancelCurrentRun(); // la vista pasa a la rama nueva; el run viejo era de la otra
							this._activeId = forkedId;
							this.postRestore(webview);
							this.postTabs(webview);
						}
					}
					break;
				case 'switchSession':
					if (typeof msg.id === 'string' && msg.id !== this._activeId) {
						const returnsToRunningParent = msg.id === this._runOwnerId;
						const opensSubagent = this._subagentIdBySession.has(msg.id);
						if (!returnsToRunningParent && !opensSubagent && !this._subagentIdBySession.has(this._activeId ?? '')) {
							this.cancelCurrentRun();
						}
						this.sessions().activate(msg.id);
						this._activeId = msg.id;
						this.postRestore(webview);
						this.postTabs(webview);
						const subId = this._subagentIdBySession.get(msg.id);
						webview.postMessage({ type: 'runState', busy: subId ? !!this._subagentSessions.get(subId)?.running : (msg.id === this._runOwnerId && this._busy) });
					}
					break;
				case 'closeTab':
					if (typeof msg.id === 'string') { this.mutateSessions(webview, s => s.closeTab(msg.id)); }
					break;
				case 'archiveSession':
					if (typeof msg.id === 'string') { this.mutateSessions(webview, s => s.archive(msg.id)); }
					break;
				case 'unarchiveSession':
					if (typeof msg.id === 'string') { this.sessions().unarchive(msg.id); this.postTabs(webview); }
					break;
				case 'deleteSession':
					if (typeof msg.id === 'string') { this.mutateSessions(webview, s => s.delete(msg.id)); }
					break;
				case 'open':
					if (typeof msg.url === 'string') {
						this.openerService.open(URI.parse(msg.url));
					}
					break;
				case 'revealTerminal':
					if (typeof msg.id === 'string') {
						this.agentService.revealBackgroundTerminal(msg.id);
					}
					break;
				case 'killTerminal':
					if (typeof msg.id === 'string') {
						this.agentService.killBackgroundTerminal(msg.id);
					}
					break;
				case 'termWrite':
					// input del usuario en la terminal embebida del chat (línea → pty del agente)
					if (typeof msg.data === 'string' && msg.data.length <= 2000) {
						this.agentService.writeToolTerminal(msg.data);
					}
					break;
				case 'termToPanel':
					// Menú ⋯ de la term card: revelar la terminal del agente en el dock del IDE.
					void this.agentService.revealAgentTerminalToPanel();
					break;
				case 'openDiff':
					if (typeof msg.path === 'string') {
						this.agentService.openDiff(msg.path).catch(e => this.notificationService.error(e instanceof Error ? e.message : String(e)));
					}
					break;
				case 'keepFile':
					if (typeof msg.path === 'string') {
						this.agentService.keepEdit(msg.path).catch(e => this.notificationService.error(e instanceof Error ? e.message : String(e)));
					}
					break;
				case 'keepFiles':
					if (Array.isArray(msg.paths)) {
						this.agentService.keepEdits(msg.paths.filter((path: unknown): path is string => typeof path === 'string')).catch(e => this.notificationService.error(e instanceof Error ? e.message : String(e)));
					}
					break;
				case 'revertFile':
					if (typeof msg.path === 'string') {
						this.agentService.revertEdit(msg.path).catch(e => this.notificationService.error(e instanceof Error ? e.message : String(e)));
					}
					break;
				case 'rollback':
					if (typeof msg.messageId === 'string' && msg.messageId) {
						const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
						void this.rollbackToUserMessage(webview, msg.messageId, true, requestId).catch(error => {
							webview.postMessage({ type: 'rollbackRejected', requestId, message: `No se pudo volver al mensaje: ${error instanceof Error ? error.message : String(error)}` });
						});
					}
					break;
				case 'editAndResend':
					if (typeof msg.messageId === 'string' && msg.messageId && typeof msg.text === 'string') {
						void (async () => {
							if (await this.rollbackToUserMessage(webview, msg.messageId)) {
								// Provider/model/mode pertenecen a ESTE turno reenviado. No mutar la selección
								// global: el target viaja como metadata durable y evita carreras del picker.
								webview.postMessage({
									type: 'resendEdited',
									text: msg.text,
									images: this.sanitizeImages(msg.images),
									capabilities: this.sanitizeCapabilities(msg.capabilities),
									providerId: typeof msg.providerId === 'string' ? msg.providerId : undefined,
									model: typeof msg.model === 'string' ? msg.model : undefined,
									mode: msg.mode === 'plan' || msg.mode === 'ask' || msg.mode === 'ultra' ? msg.mode : 'agent',
								});
							}
						})().catch(error => {
							this.notificationService.error(`No se pudo editar y reenviar: ${error instanceof Error ? error.message : String(error)}`);
						});
					}
					break;
				case 'exportTranscript':
					this.exportTranscript();
					break;
				case 'parseDiagram':
					// El webview NO parsea: el motor de diagramas es backend (openideDiagramEngine).
					if (typeof msg.key === 'string' && typeof msg.source === 'string') {
						webview.postMessage({ type: 'diagramSpec', key: msg.key, result: this.agentService.parseDiagram(msg.source) });
					}
					break;
				case 'planBuild': {
					// Aprobar y ejecutar (card del plan): frontmatter → aprobado + run de ejecución.
					const uri = typeof msg.path === 'string' && msg.path ? this.resolvePlanUri(msg.path) : undefined;
					if (uri) {
						this.agentService.buildPlan(uri).catch(e => this.notificationService.error(e instanceof Error ? e.message : String(e)));
					}
					break;
				}
				case 'planReject':
					if (typeof msg.path === 'string' && msg.path) {
						this.rejectPlan(webview, msg.path);
					}
					break;
				case 'planOpen': {
					// abrir en el editor de plan PROPIO (openidePlanEditor), no en el editor de texto.
					const uri = typeof msg.path === 'string' && msg.path ? this.resolvePlanUri(msg.path) : undefined;
					if (uri) {
						this.commandService.executeCommand('openide.plan.open', uri);
					}
					break;
				}
				case 'canvasOpen': {
					if (typeof msg.path === 'string' && msg.path) { void this.commandService.executeCommand('openide.canvas.open', msg.path); }
					break;
				}
				case 'planPickExecModel': {
					// MISMO QuickPick que el botón del editor (la Action2 acepta el URI como arg).
					const uri = typeof msg.path === 'string' && msg.path ? this.resolvePlanUri(msg.path) : undefined;
					if (uri) {
						this.commandService.executeCommand('openide.plan.execModel', uri);
					}
					break;
				}
			}
		}));
	}

	/** Envío de un mensaje del composer: resuelve @menciones a contexto adjunto y corre el agente. */
	// ---- Dictado por voz: la captura vive en el HOST (el webview no tiene permiso de mic;
	// 'media' está permitido solo para la ventana core en app.ts). Graba con MediaRecorder,
	// convierte a WAV 16k mono PCM16 y lo transcribe el servicio (modelo multimodal). ----

	private _voice: { rec: MediaRecorder; stream: MediaStream; chunks: Blob[] } | undefined;

	private async startVoice(webview: IOverlayWebview): Promise<void> {
		if (this._voice) {
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
			const chunks: Blob[] = [];
			rec.ondataavailable = e => { if (e.data && e.data.size) { chunks.push(e.data); } };
			rec.start();
			this._voice = { rec, stream, chunks };
			webview.postMessage({ type: 'voiceState', status: 'recording' });
		} catch (e) {
			webview.postMessage({ type: 'voiceState', status: 'idle' });
			webview.postMessage({ type: 'info', message: `No se pudo acceder al micrófono: ${e instanceof Error ? e.message : String(e)}` });
		}
	}

	private async stopVoice(webview: IOverlayWebview): Promise<void> {
		const v = this._voice;
		if (!v) {
			return;
		}
		this._voice = undefined;
		webview.postMessage({ type: 'voiceState', status: 'busy' });
		try {
			await new Promise<void>(resolve => {
				v.rec.onstop = () => resolve();
				v.rec.stop();
			});
			v.stream.getTracks().forEach(t => t.stop());
			const blob = new Blob(v.chunks, { type: v.rec.mimeType || 'audio/webm' });
			if (!blob.size) {
				throw new Error('No se grabó audio.');
			}
			const wavB64 = await this.encodeWavBase64(blob);
			const text = await this.agentService.transcribeAudio(wavB64);
			webview.postMessage({ type: 'voiceText', text });
		} catch (e) {
			v.stream.getTracks().forEach(t => t.stop());
			webview.postMessage({ type: 'info', message: `Dictado: ${e instanceof Error ? e.message : String(e)}` });
		} finally {
			webview.postMessage({ type: 'voiceState', status: 'idle' });
		}
	}

	private async encodeWavBase64(blob: Blob): Promise<string> {
		const SAMPLE_RATE = 16000;
		const raw = await blob.arrayBuffer();
		const ctx = new AudioContext({ sampleRate: SAMPLE_RATE }); // decodeAudioData resamplea al rate del contexto
		let audio: AudioBuffer;
		try {
			audio = await ctx.decodeAudioData(raw);
		} finally {
			ctx.close().catch(() => { /* best effort */ });
		}
		const ch = audio.getChannelData(0); // mono: canal 0
		const pcm = new Int16Array(ch.length);
		for (let i = 0; i < ch.length; i++) {
			const s = Math.max(-1, Math.min(1, ch[i]));
			pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
		}
		const bytes = new Uint8Array(44 + pcm.byteLength);
		const dv = new DataView(bytes.buffer);
		const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) { bytes[off + i] = s.charCodeAt(i); } };
		writeStr(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); writeStr(8, 'WAVE');
		writeStr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
		dv.setUint32(24, SAMPLE_RATE, true); dv.setUint32(28, SAMPLE_RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
		writeStr(36, 'data'); dv.setUint32(40, pcm.byteLength, true);
		bytes.set(new Uint8Array(pcm.buffer), 44);
		// base64 por chunks (String.fromCharCode con spread revienta con arrays grandes)
		let bin = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
		}
		return btoa(bin);
	}

	private async handleSend(webview: IOverlayWebview, msg: any): Promise<void> {
		if (this._rollbackActive) { webview.postMessage({ type: 'info', message: 'Esperá a que termine el rollback antes de enviar otro mensaje.' }); webview.postMessage({ type: 'done' }); return; }
		this._sendPreparations++;
		try {
		await this.prepareAndSend(webview, msg);
		} finally {
			this._sendPreparations--;
			if (!this._sendPreparations) { for (const resolve of this._sendPreparationWaiters) { resolve(); } this._sendPreparationWaiters.clear(); }
		}
	}

	private async prepareAndSend(webview: IOverlayWebview, msg: any): Promise<void> {
		// Snapshot sincrónico, antes del primer await: este turno pertenece al target que el
		// usuario veía al pulsar Enviar aunque cambie el selector durante preparación/cola.
		let providerOverride = typeof msg.providerId === 'string' && msg.providerId ? msg.providerId : this.agentService.getActiveProviderId();
		let modelOverride = typeof msg.model === 'string' && msg.model ? msg.model : this.agentService.getModel();
		const images = this.sanitizeImages(msg.images);
		const text = String(msg.text ?? '');
		const capabilities = this.sanitizeCapabilities(msg.capabilities);
		// Compatibilidad con builds que enviaban una única capacidad en campos separados.
		const legacyKind = msg.capabilityKind === 'skill' || msg.capabilityKind === 'tool' || msg.capabilityKind === 'mcp' ? msg.capabilityKind : undefined;
		const legacyName = typeof msg.capabilityName === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(msg.capabilityName) ? msg.capabilityName : undefined;
		if (legacyKind && legacyName && !capabilities.some(capability => capability.kind === legacyKind && capability.name === legacyName)) {
			capabilities.push({ kind: legacyKind, name: legacyName });
		}
		const references: string[] = [];
		if (Array.isArray(msg.references)) {
			for (const raw of msg.references) {
				if (typeof raw !== 'string') { continue; }
				const value = raw.trim();
				if (value && !references.includes(value)) { references.push(value); }
				if (references.length >= 8) { break; }
			}
		}
		if (!text.trim() && !images.length && !references.length && !capabilities.length) {
			return;
		}
		// /comando del composer: se resuelve y expande ACÁ (host), ANTES de armar los messages.
		// El historial guarda {displayText, modelText}: la UI/títulos muestran lo tipeado, el
		// modelo ve el cuerpo expandido ($ARGUMENTS/$1..$9) — sin envenenar memoria ni títulos.
		// displayText puede venir del webview (ej. ejecución del plan: el chat muestra "Ejecutar
		// plan: X" mientras el modelo recibe la instrucción completa); un /comando lo sobreescribe.
		let displayText: string | undefined = typeof msg.displayText === 'string' && msg.displayText.trim() ? String(msg.displayText) : undefined;
		let sendText = text;
		let nativeMode: AgentMode | undefined;
		const selectedCommand = capabilities.find(capability => capability.kind === 'command');
		const leadingNonCommand = capabilities.some(capability => capability.kind !== 'command' && text.trimStart().startsWith(`/${capability.name}`));
		const slash = this.commands().resolve(text);
		const nativeCommand = slash ? NATIVE_WORKFLOW_COMMANDS.find(command => command.slug === slash.slug) : undefined;
		if (slash && nativeCommand && (selectedCommand?.name === slash.slug || !leadingNonCommand)) {
			displayText = displayText || `/${slash.slug}${slash.args ? ` ${slash.args}` : ''}`;
			sendText = `${nativeCommand.instruction}${slash.args ? `\n\n${slash.args}` : ''}`;
			nativeMode = nativeCommand.mode;
		} else if (slash && (selectedCommand?.name === slash.slug || !leadingNonCommand)) {
			let expanded;
			try {
				expanded = await this.commands().expand(slash.slug, slash.args);
			} catch {
				expanded = undefined;
			}
			if (!expanded) {
				// comando inexistente: aviso SIN gastar turno ('done' desarma el spinner del webview)
				const near = await this.commands().closest(slash.slug).catch(() => undefined);
				webview.postMessage({ type: 'info', message: `Comando desconocido: /${slash.slug}${near ? ` (¿quisiste decir /${near}?)` : ''}.` });
				webview.postMessage({ type: 'done' });
				return;
			}
			displayText = displayText || expanded.displayText;
			sendText = expanded.modelText || expanded.displayText;
		}
		const s = this.sessions();
		const id = s.ensureActive();
		this._activeId = id;
		const messages = s.messagesOf(id);
		let context: string | undefined;
		try {
			context = await this.agentService.buildMentionContext(sendText);
		} catch {
			context = undefined; // mención irresoluble: el texto viaja igual
		}
		if (references.length) {
			try {
				const attached = await this.agentService.buildFileReferenceContext(references);
				if (attached) { context = context ? `${context}\n\n${attached}` : attached; }
			} catch { /* un archivo borrado entre elegir y enviar no bloquea el turno */ }
		}
		for (const selectedCapability of capabilities) {
			if (selectedCapability.kind === 'command') { continue; }
			try {
				const selected = await this.agentService.buildComposerCapabilityContext(selectedCapability.kind, selectedCapability.name);
				if (selected) { context = context ? `${context}\n\n${selected}` : selected; }
			} catch { /* registry/skill cambió: el texto del usuario todavía viaja */ }
		}
		// Hooks userPromptSubmit (fail-open): el contexto que inyecten los scripts del usuario
		// viaja en message.context (mismo vehículo que las @menciones) — NUNCA al system prompt.
		try {
			const injected = await this.agentService.hookUserPromptSubmit(sendText, id);
			if (injected) {
				context = context ? `${context}\n\n${injected}` : injected;
			}
		} catch { /* fail-open: un hook roto jamás frena el mensaje */ }
		// Pick & Polish pendiente → contexto del elemento + screenshot como imagen adjunta.
		if (this._pendingPick) {
			context = (context ?? '') + this._pendingPick.context;
			if (this._pendingPick.image) {
				images.push(this._pendingPick.image);
			}
			this._pendingPick = undefined;
			webview.postMessage({ type: 'pickChip', selector: '' });
		}
		// providerOverride/modelOverride ya fueron capturados al admitir el turno. Nunca volver a
		// consultar el slot mutable de Build después de los awaits de preparación.
		const mode = nativeMode ?? (msg.mode === 'plan' || msg.mode === 'ask' || msg.mode === 'ultra' ? msg.mode : 'agent');
		const turnMessage: IChatMessage = { role: 'user', content: sendText, messageId: generateUuid(), providerId: providerOverride, modelId: modelOverride, executionMode: mode, images: images.length ? images : undefined, context, displayText, capabilities: capabilities.length ? capabilities : undefined };
		messages.push(turnMessage);
		s.save(id, messages, false);          // persiste + deriva título del primer mensaje
		this.postTabs(webview);                // refresca el título de la tab al toque
		const planBuild = this._planBuild;
		this.cancelCurrentRun();
		if (planBuild) { this._planBuild = planBuild; }
		const runCts = new CancellationTokenSource();
		this._runCts = runCts;
		this._runOwnerId = id;
		this._busy = true;
		this.updateStatusbar();
		const runPromise = this.agentService.runMessages(messages, ev => {
			let checkpointEvent: AgentLoopEvent = ev;
			while (checkpointEvent.type === 'subagentEvent') {
				checkpointEvent = checkpointEvent.ev;
			}
			if (checkpointEvent.type === 'fileCheckpoint') {
				return; // solo compatibilidad interna; sesiones nuevas no persisten checkpoints legacy
			}
			if (checkpointEvent.type === 'messageChangeSet') {
				s.saveChangeSet(id, checkpointEvent.changeSet);
				return; // metadata host-only: jamás cruza al webview
			}
			if (this._runCts !== runCts) {
				return;
			}
			const outgoing = this.trackSubagentEvent(ev);
			// Igual que Zed, solo la conversación raíz conduce la ubicación. Los subagentes
			// siguen informando su actividad en el chat, pero no hacen saltar el workspace.
			if (ev.type === 'agentLocation') {
				this.followLocation(ev.location);
			}
			if (outgoing.type === 'subagentStart') {
				this.postTabs(webview);
			}
			const parentVisible = this._activeId === id;
			if (parentVisible && outgoing.type === 'fileDiff') {
				webview.postMessage({
					...outgoing,
					icon: getIconClasses(this.modelService, this.languageService, URI.file('/' + outgoing.path), FileKind.FILE).join(' '),
				});
			} else if (parentVisible) {
				webview.postMessage(outgoing);
			} else if (outgoing.type === 'subagentEvent') {
				const tracked = this._subagentSessions.get(outgoing.id);
				if (tracked?.sessionId === this._activeId) {
					webview.postMessage(outgoing.ev);
				}
			} else if (outgoing.type === 'subagentDone') {
				const tracked = this._subagentSessions.get(outgoing.id);
				if (tracked?.sessionId === this._activeId) {
					this.postRestore(webview);
					webview.postMessage({ type: 'runState', busy: false });
				}
			}
			if (ev.type === 'usage') {
				if (typeof ev.inputTokens === 'number') { this._ctx.input = ev.inputTokens; }
				if (typeof ev.outputTokens === 'number') { this._ctx.output = ev.outputTokens; }
				if (typeof ev.contextUsed === 'number') { this._ctx.used = ev.contextUsed; }
				if (typeof ev.contextLimit === 'number' && ev.contextLimit > 0) { this._ctx.limit = ev.contextLimit; }
				if (ev.breakdown) { this._ctx.breakdown = ev.breakdown; }
				s.saveUsage(id, this._ctx);
				this.updateStatusbar();
			}
			if (ev.type === 'compaction' && ev.status === 'completed' && typeof ev.beforeTokens === 'number' && typeof ev.afterTokens === 'number') {
				this._ctx.used = Math.max(0, this._ctx.used - Math.max(0, ev.beforeTokens - ev.afterTokens));
				// compactIfNeeded reemplaza el historial operativo del run: persistirlo enseguida evita
				// que un cambio de provider parezca correcto en vivo y pierda el resumen tras recargar.
				s.save(id, messages, false);
				s.saveUsage(id, this._ctx);
				this.updateStatusbar();
				if (parentVisible) {
					webview.postMessage({ type: 'usage', inputTokens: this._ctx.input, outputTokens: this._ctx.output, contextUsed: this._ctx.used, contextLimit: this._ctx.limit, breakdown: this._ctx.breakdown });
				}
			}
			if (ev.type === 'done' || ev.type === 'error') {
				s.save(id, messages, ev.type === 'error');
				this.postTabs(webview);
				this._runCts = undefined;
				this._runOwnerId = undefined;
				this._busy = false;
				this.updateStatusbar();
			}
		}, runCts.token, { mode, messageId: turnMessage.messageId, providerOverride, modelOverride });
		this._runPromise = runPromise;
		void runPromise.then(() => {
			if (this._runCts !== runCts) {
				return;
			}
			if (this._planBuild) {
				this.agentService.finishPlanBuild(this._planBuild.resource, this._planBuild.owner);
				this._planBuild = undefined;
			}
			s.save(id, messages, false);
			this.postTabs(webview);
			this._runCts = undefined;
			this._runOwnerId = undefined;
			this._busy = false;
			this.updateStatusbar();
			if (this._activeId === id) {
				webview.postMessage({ type: 'runState', busy: false });
			}
		}).catch(error => {
			if (this._runCts !== runCts) {
				return;
			}
			if (this._planBuild) {
				this.agentService.failPlanBuild(this._planBuild.resource, this._planBuild.owner);
				this._planBuild = undefined;
			}
			this._runCts = undefined;
			this._runOwnerId = undefined;
			this._busy = false;
			this.updateStatusbar();
			webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}).finally(() => {
			if (this._runPromise === runPromise) {
				this._runPromise = undefined;
			}
		});
	}

	/** Reanuda el último pedido en otro modo sin crear un segundo mensaje user visible. El
	 *  cambio de modo es metadata de ejecución, no contenido del transcript. */
	private resumeSilentlyInMode(webview: IOverlayWebview, conversationId: string | undefined, mode: AgentMode, refinedPrompt: string): void {
		if (!conversationId || this._busy) { return; }
		const sessions = this.sessions();
		const messages = sessions.messagesOf(conversationId);
		const user = [...messages].reverse().find(message => message.role === 'user');
		if (!user) { return; }
		// El prompt refinado es una interpretación interna del modo. El mensaje user original
		// permanece byte-a-byte igual para transcript, títulos, restore y edición.
		const modeInstruction = refinedPrompt.trim() || undefined;
		// El run anterior termina en mode-switch sin respuesta útil. Conservar un solo turno user
		// y ejecutar nuevamente sobre ese mismo array hace que restore/refresh tampoco duplique.
		sessions.save(conversationId, messages, false);
		this._activeId = conversationId;
		webview.postMessage({ type: 'silentModeResume', mode });
		void this.runExistingTurn(webview, conversationId, messages, user, mode, modeInstruction);
	}

	/** Ejecuta un turno user ya persistido. Se usa para transiciones internas donde no debe
	 *  renderizarse otro globo. */
	private async runExistingTurn(webview: IOverlayWebview, id: string, messages: IChatMessage[], turnMessage: IChatMessage, mode: AgentMode, modeInstruction?: string): Promise<void> {
		const providerOverride = turnMessage.providerId || this.agentService.getActiveProviderId();
		const modelOverride = turnMessage.modelId || this.agentService.getModel();
		const planBuild = this._planBuild;
		this.cancelCurrentRun();
		if (planBuild) { this._planBuild = planBuild; }
		const runCts = new CancellationTokenSource();
		this._runCts = runCts; this._runOwnerId = id; this._busy = true; this.updateStatusbar();
		webview.postMessage({ type: 'runState', busy: true });
		const runPromise = this.agentService.runMessages(messages, ev => {
			if (this._runCts !== runCts) { return; }
			if (ev.type === 'messageChangeSet') { this.sessions().saveChangeSet(id, ev.changeSet); return; }
			if (ev.type === 'fileCheckpoint') { return; }
			webview.postMessage(this.trackSubagentEvent(ev));
			if (ev.type === 'done' || ev.type === 'error') { this.sessions().save(id, messages, ev.type === 'error'); }
		}, runCts.token, { mode, modeInstruction, messageId: turnMessage.messageId, providerOverride, modelOverride });
		this._runPromise = runPromise;
		try {
			await runPromise; this.sessions().save(id, messages, false);
			if (this._runCts === runCts && planBuild) { this.agentService.finishPlanBuild(planBuild.resource, planBuild.owner); this._planBuild = undefined; }
		}
		catch (error) {
			if (this._runCts === runCts) { if (planBuild) { this.agentService.failPlanBuild(planBuild.resource, planBuild.owner); this._planBuild = undefined; } webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
		}
		finally {
			if (this._runCts === runCts) { this._runCts = undefined; this._runOwnerId = undefined; this._busy = false; this.updateStatusbar(); webview.postMessage({ type: 'runState', busy: false }); }
			if (this._runPromise === runPromise) { this._runPromise = undefined; }
		}
	}

	/** /compact: acción local y explícita. No agrega un user turn ni ejecuta tools; usa el mismo
	 *  runtime/modelo de compactación automática y persiste el resumen sintético en la sesión. */
	private handleCompact(webview: IOverlayWebview): void {
		if (this._busy) {
			webview.postMessage({ type: 'info', message: 'Esperá a que termine la ejecución actual antes de compactar.' });
			webview.postMessage({ type: 'runState', busy: true });
			return;
		}
		const sessions = this.sessions();
		const id = sessions.ensureActive();
		this._activeId = id;
		const messages = sessions.messagesOf(id);
		this.cancelCurrentRun();
		const runCts = new CancellationTokenSource();
		this._runCts = runCts;
		this._runOwnerId = id;
		this._busy = true;
		this.updateStatusbar();

		void this.agentService.compactConversation(messages, ev => {
			if (this._runCts !== runCts) { return; }
			if (this._activeId === id) { webview.postMessage(ev); }
			if (ev.type === 'compaction' && ev.status === 'completed' && typeof ev.beforeTokens === 'number' && typeof ev.afterTokens === 'number') {
				this._ctx.used = Math.max(0, this._ctx.used - Math.max(0, ev.beforeTokens - ev.afterTokens));
				sessions.saveUsage(id, this._ctx);
				if (this._activeId === id) {
					webview.postMessage({ type: 'usage', inputTokens: this._ctx.input, outputTokens: this._ctx.output, contextUsed: this._ctx.used, contextLimit: this._ctx.limit, breakdown: this._ctx.breakdown });
				}
			}
			if (ev.type === 'done' || ev.type === 'error') {
				sessions.save(id, messages, ev.type === 'error');
				this.postTabs(webview);
			}
		}, runCts.token).then(() => {
			if (this._runCts !== runCts) { return; }
			sessions.save(id, messages, false);
			this._runCts = undefined;
			this._runOwnerId = undefined;
			this._busy = false;
			this.updateStatusbar();
			if (this._activeId === id) { webview.postMessage({ type: 'runState', busy: false }); }
		}).catch(error => {
			if (this._runCts !== runCts) { return; }
			this._runCts = undefined;
			this._runOwnerId = undefined;
			this._busy = false;
			this.updateStatusbar();
			webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		});
	}

	/** Valida las imágenes adjuntas que manda el webview (paste en el composer). */
	private sanitizeImages(raw: any): { mimeType: string; data: string }[] {
		if (!Array.isArray(raw)) {
			return [];
		}
		const out: { mimeType: string; data: string }[] = [];
		for (const img of raw.slice(0, 6)) {
			const mimeType = String(img?.mimeType ?? '');
			const data = String(img?.data ?? '');
			if (/^image\/(png|jpeg|gif|webp)$/.test(mimeType) && data.length && data.length < 8_000_000) {
				out.push({ mimeType, data });
			}
		}
		return out;
	}

	/** El webview sólo puede persistir capacidades conocidas y nombres de registry seguros. */
	private sanitizeCapabilities(raw: any): IChatCapabilityMention[] {
		if (!Array.isArray(raw)) {
			return [];
		}
		const out: IChatCapabilityMention[] = [];
		for (const item of raw) {
			const kind = item?.kind;
			const name = typeof item?.name === 'string' ? item.name.trim() : '';
			if ((kind !== 'skill' && kind !== 'tool' && kind !== 'mcp' && kind !== 'command') || !/^[a-zA-Z0-9_.-]{1,160}$/.test(name)) {
				continue;
			}
			if (!out.some(capability => capability.kind === kind && capability.name === name)) {
				out.push({ kind, name });
			}
			if (out.length >= 8) { break; }
		}
		return out;
	}

	/** Resuelve el path RELATIVO de un plan (.openide/plans/x.md) contra la raíz del workspace. */
	private resolvePlanUri(path: string): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, path) : undefined;
	}

	/** Rechaza un plan: frontmatter → `status: rechazado` y la card del webview queda resuelta. */
	private async rejectPlan(webview: IOverlayWebview, path: string): Promise<void> {
		const uri = this.resolvePlanUri(path);
		if (uri) {
			try {
				const content = (await this.fileService.readFile(uri)).value.toString();
				await this.fileService.writeFile(uri, VSBuffer.fromString(setPlanFrontmatterValue(content, 'status', 'rechazado')));
			} catch { /* plan borrado a mano: la card se resuelve igual */ }
		}
		webview.postMessage({ type: 'planResolved', path, status: 'rechazado' });
	}

	private sessions(): OpenideChatSessions {
		if (!this._sessions) {
			this._sessions = new OpenideChatSessions(this.storageService);
		}
		return this._sessions;
	}

	private commands(): OpenideAgentCommands {
		if (!this._commands) {
			this._commands = this._register(new OpenideAgentCommands(this.fileService, this.contextService, this.environmentService));
		}
		return this._commands;
	}

	/** Aplica una mutación que puede cambiar la sesión activa (cerrar/archivar/eliminar),
	 *  reactiva otra si hace falta y resincroniza el webview (restore + tabs). */
	private mutateSessions(webview: IOverlayWebview, fn: (s: OpenideChatSessions) => void): void {
		const s = this.sessions();
		const prev = s.activeSessionId();
		fn(s);
		const next = s.ensureActive();
		if (next !== prev) {
			this.cancelCurrentRun();
			this._activeId = next;
			this.postRestore(webview);
		}
		this.postTabs(webview);
	}

	/** Manda al webview la lista de tabs abiertas + el historial completo + la activa. */
	private postTabs(webview: IOverlayWebview): void {
		const s = this.sessions();
		webview.postMessage({ type: 'tabs', open: s.openTabs(), all: s.listAll(), activeId: s.activeSessionId() });
	}

	/** Reconstruye el thread del webview: texto user/assistant + tool calls con sus resultados
	 *  (los mensajes 'tool' viajan para que el webview resuelva las rows restauradas). */
	private postRestore(webview: IOverlayWebview): void {
		const sessions = this.sessions();
		const thread = sessions.messagesOf(this._activeId);
		const messages = thread
			.filter(message => !message.hidden)
			// los mensajes nacidos de un /comando se muestran como lo TIPEADO (displayText)
			.map(m => ({ role: m.role, content: (m.role === 'user' && m.displayText) ? m.displayText : m.content, messageId: m.messageId, toolCalls: m.toolCalls, toolCallId: m.toolCallId, fileDiff: m.fileDiff, images: m.images, capabilities: m.capabilities, providerId: m.providerId, modelId: m.modelId, executionMode: m.executionMode, compaction: m.compaction }));
		webview.postMessage({ type: 'restore', messages });
		// Cada conversación restaura su usage real. Sesiones guardadas por versiones anteriores
		// no tienen snapshot: en ese caso mostramos una estimación del thread, nunca un 0 falso.
		const restored = sessions.usageOf(this._activeId);
		const currentLimit = this.agentService.getContextLimit() || restored?.limit || this._ctx.limit;
		this._ctx = restored
			? { ...restored, limit: currentLimit }
			: { input: 0, output: 0, used: estimateConversationTokens(thread), limit: currentLimit };
		webview.postMessage({
			type: 'usage',
			inputTokens: this._ctx.input,
			outputTokens: this._ctx.output,
			contextUsed: this._ctx.used,
			contextLimit: this._ctx.limit,
			breakdown: this._ctx.breakdown,
		});
		this.updateStatusbar();
	}

	private async postContextCapabilities(webview: IOverlayWebview): Promise<void> {
		try {
			const capabilities = await this.agentService.listComposerCapabilities();
			webview.postMessage({
				type: 'contextCapabilities',
				tools: capabilities.filter(capability => capability.kind === 'tool').length,
				mcp: capabilities.filter(capability => capability.kind === 'mcp').length,
				skills: capabilities.filter(capability => capability.kind === 'skill').length,
			});
		} catch {
			webview.postMessage({ type: 'contextCapabilities', tools: 0, mcp: 0, skills: 0 });
		}
	}

	/** Abre/cierra el panel de desglose de contexto del webview (lo dispara el status bar). */
	showContextPanel(): void {
		const webview = this._webview.value;
		if (webview) {
			void this.postContextCapabilities(webview);
			webview.postMessage({ type: 'showCtx' });
		}
	}


	private static formatTokens(n: number): string {
		return n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n || 0);
	}

	/** Footer nativo con límites independientes del modelo: `estado │ modelo` + `████░░░░░░ 45K/200K` en el status bar,
	 *  con la barra coloreada por umbral (<50 ok · ≥50 warn · >80 bad · ≥95 crit). */
	private updateStatusbar(): void {
		const model = this._statusModel || this._statusProvider || '—';
		// Sin proveedor conectado → CTA honesto que abre la página de proveedores (nada de
		// mostrar un modelo default que no puede responder).
		const status: IStatusbarEntry = this._statusConnected || this._busy ? {
			name: 'OpenIDE Agent',
			text: this._busy ? '$(loading~spin) Trabajando…' : `$(hubot) ${model}`,
			ariaLabel: this._busy ? 'OpenIDE Agent: trabajando' : `OpenIDE Agent: ${model}`,
			tooltip: `OpenIDE Agent — ${this._statusProvider || 'sin proveedor'}${this._statusModel ? `\n${this._statusModel}` : ''}`,
			command: 'workbench.view.openideChat.view.focus',
		} : {
			name: 'OpenIDE Agent',
			text: '$(plug) Conectar proveedor de IA',
			ariaLabel: 'OpenIDE Agent: sin proveedor conectado',
			tooltip: 'No hay proveedor de IA conectado — abrí la página de proveedores para conectar una cuenta o API key.',
			command: 'openide.agent.openProviders',
		};
		if (this._statusEntry.value) {
			this._statusEntry.value.update(status);
		} else {
			this._statusEntry.value = this.statusbarService.addEntry(status, 'openide.agent.status', StatusbarAlignment.RIGHT, 101);
		}

		// Sin proveedor conectado NO hay barra de contexto: mostrar "0/1050K" de un modelo que
		// no puede responder es ruido. El límite se re-calcula al conectar/cambiar de modelo.
		if (!this._statusConnected && !this._busy) {
			this._ctxEntry.clear();
			return;
		}

		const total = this._ctx.used || (this._ctx.input + this._ctx.output);
		const limit = this._ctx.limit;
		const pct = limit ? Math.min(100, Math.round(total / limit * 100)) : 0;
		let bar = '';
		const filled = Math.round(pct / 10);
		for (let i = 0; i < 10; i++) {
			bar += i < filled ? '█' : '░';
		}
		const label = limit
			? `${OpenideChatViewPane.formatTokens(total)}/${OpenideChatViewPane.formatTokens(limit)}`
			: (total ? `${OpenideChatViewPane.formatTokens(total)} tok` : '');
		const color: ThemeColor = pct >= 95 ? { id: 'errorForeground' }
			: pct > 80 ? { id: 'editorError.foreground' }
				: pct >= 50 ? { id: 'editorWarning.foreground' }
					: { id: 'charts.green' };
		const ctx: IStatusbarEntry = {
			name: 'OpenIDE Agent: contexto',
			text: label ? `${bar} ${label}` : bar,
			ariaLabel: 'Uso de contexto del agente',
			tooltip: limit
				? `Contexto: ${total.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)`
				: 'Uso de contexto del agente',
			command: 'openide.agent.showContext',
			color,
		};
		if (this._ctxEntry.value) {
			this._ctxEntry.value.update(ctx);
		} else {
			this._ctxEntry.value = this.statusbarService.addEntry(ctx, 'openide.agent.context', StatusbarAlignment.RIGHT, 100.5);
		}
	}

	/** Revierte exclusivamente la transacción del messageId exacto. La truncación del transcript
	 *  ocurre recién después de un rollback limpio; un mensaje sin cambios es un no-op real. */
	private rollbackToUserMessage(webview: IOverlayWebview, messageId: string, restoreComposer = false, requestId = ''): Promise<boolean> {
		// Levantar la barrera sincrónicamente al aceptar la solicitud: ningún send nuevo pasa el guard.
		this._rollbackActive = true;
		const id = this.sessions().ensureActive();
		let result = false;
		const operationId = ++this._rollbackOperations;
		const operation = this._rollbackQueue.catch(() => undefined).then(async () => {
			try {
				if (this._sendPreparations) { await new Promise<void>(resolve => this._sendPreparationWaiters.add(resolve)); }
				result = await this.doRollbackToUserMessage(webview, id, messageId, restoreComposer, requestId);
			} catch (error) {
				if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message: `No se pudo completar el rollback: ${error instanceof Error ? error.message : String(error)}` }); }
				result = false;
			}
		});
		this._rollbackQueue = operation.then(() => undefined, () => undefined);
		return operation.then(() => result).finally(() => { if (operationId === this._rollbackOperations) { this._rollbackQueue = Promise.resolve(); this._rollbackActive = false; } });
	}

	private async doRollbackToUserMessage(webview: IOverlayWebview, id: string, messageId: string, restoreComposer = false, requestId = ''): Promise<boolean> {
		const s = this.sessions();
		const messages = s.messagesOf(id);
		const cut = messages.findIndex(message => message.role === 'user' && message.messageId === messageId);
		if (cut < 0) { if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message: 'El mensaje ya no existe en la conversación.' }); } return false; }
		const rolledBack = messages[cut];
		const runToStop = this._runPromise;
		this.cancelCurrentRun();
		if (runToStop) { try { await runToStop; } catch { /* barrera global: ningún tool sigue escribiendo durante rollback */ } }
		// Snapshot estable DESPUÉS de drenar el run. handleSend permanece bloqueado por
		// _rollbackActive hasta que archivos y transcript confirmen juntos.
		const transcriptRevision = messages.map(message => message.messageId ?? `${message.role}:${message.toolCallId ?? ''}:${message.content.length}`).join('|');
		const freshCut = messages.findIndex(message => message.role === 'user' && message.messageId === messageId);
		if (freshCut < 0 || freshCut !== cut) { if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message: 'El mensaje cambió durante el rollback.' }); } return false; }

		const changeSet = s.changeSetOf(id, messageId);
		if (changeSet) {
			const result = await this.agentService.rollbackMessage(changeSet);
			if (result.status === 'conflict' || result.status === 'unavailable') {
				const paths = result.files.filter(file => file.status === 'conflict').map(file => file.uri).join(', ');
				if (result.status === 'unavailable' || result.files.every(file => file.status === 'conflict')) {
					const message = `Rollback cancelado para preservar cambios posteriores${paths ? `: ${paths}` : ''}.`;
					this.notificationService.warn(message); if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message }); }
					return false;
				}
				const decision = await this.dialogService.prompt<'safe' | 'cancel'>({
					type: 'warning',
					message: 'Algunos archivos cambiaron después de este mensaje.',
					detail: `No se sobrescribirán los conflictos: ${paths}.`,
					buttons: [{ label: 'Revertir solo archivos sin conflicto', run: () => 'safe' }],
					cancelButton: { label: 'Cancelar', run: () => 'cancel' },
				});
				if (decision.result !== 'safe') { if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message: 'Rollback cancelado.' }); } return false; }
				const partial = await this.agentService.rollbackMessage(changeSet, true);
				const message = `Rollback parcial: ${partial.files.filter(file => file.status === 'conflict').length} archivo(s) preservados por conflicto; la conversación no se truncó.`;
				this.notificationService.warn(message); if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message }); }
				return false;
			}
			if (result.status === 'partial') {
				const message = 'Solo se revirtieron archivos sin conflicto; la conversación no se truncó.';
				this.notificationService.warn(message); if (requestId) { webview.postMessage({ type: 'rollbackRejected', requestId, message }); }
				return false;
			}
		}
		// handleSend está bloqueado y el run global fue drenado: desde el preflight hasta este commit
		// no existe una ruta normal que agregue turnos. No rechazar después de mutar archivos.
		void transcriptRevision;
		// Sin change set o set vacío: no consultar jamás diffs, snapshots ni Git globales.
		const removedIds = messages.slice(cut).map(message => message.messageId).filter((value): value is string => !!value);
		messages.splice(cut);
		s.removeChangeSets(id, removedIds);
		s.clearUsage(id);
		s.save(id, messages, false);
		if (restoreComposer && this._activeId === id) {
			const restoredMessages = messages.filter(m => !m.hidden).map(m => ({ role: m.role, content: (m.role === 'user' && m.displayText) ? m.displayText : m.content, messageId: m.messageId, toolCalls: m.toolCalls, toolCallId: m.toolCallId, fileDiff: m.fileDiff, images: m.images, capabilities: m.capabilities, providerId: m.providerId, modelId: m.modelId, executionMode: m.executionMode, compaction: m.compaction }));
			webview.postMessage({ type: 'rollbackCommitted', requestId, messages: restoredMessages, composer: { text: rolledBack.displayText || rolledBack.content, images: rolledBack.images, capabilities: rolledBack.capabilities }, mode: rolledBack.executionMode || 'agent', providerId: rolledBack.providerId, model: rolledBack.modelId });
		} else if (this._activeId === id) {
			this.postRestore(webview);
		} else if (requestId) {
			// La sesión cambió mientras se confirmó: cerrar el request pendiente sin tocar la sesión visible.
			webview.postMessage({ type: 'rollbackRejected', requestId, message: 'Rollback completado en la conversación original.' });
		}
		this.postTabs(webview);
		return true;
	}

	/** Copia el transcript de la sesión activa al portapapeles como markdown. */
	private async exportTranscript(): Promise<void> {
		const messages = this.sessions().messagesOf(this._activeId);
		const parts: string[] = [];
		for (const m of messages) {
			if (m.role === 'user' && m.content) {
				parts.push('## Usuario\n\n' + (m.displayText || m.content));
			} else if (m.role === 'assistant') {
				let block = m.content ? m.content : '';
				if (m.toolCalls?.length) {
					block += (block ? '\n\n' : '') + m.toolCalls.map(c => `> herramienta: ${c.name}`).join('\n');
				}
				if (block) {
					parts.push('## Asistente\n\n' + block);
				}
			}
		}
		if (!parts.length) {
			this.notificationService.info('No hay conversación para exportar.');
			return;
		}
		await this.clipboardService.writeText(parts.join('\n\n---\n\n') + '\n');
		this.notificationService.info('Transcript copiado al portapapeles.');
	}

	/** Reinicia: crea una conversación nueva (tab nueva) y la activa. Lo dispara "Nuevo chat". */
	newChat(): void {
		const webview = this._webview.value;
		if (!webview) {
			return;
		}
		this.cancelCurrentRun();
		this._activeId = this.sessions().create();
		this.postRestore(webview);
		this.postTabs(webview);
	}

	/** Lleva una elección explícita de Canvas al composer sin iniciar un turno a espaldas del usuario. */
	injectCanvasChoice(choice: { choiceId: string; label: string; canvas?: string }): void {
		const label = String(choice?.label ?? '').trim().slice(0, 1000);
		const choiceId = String(choice?.choiceId ?? '').slice(0, 160);
		if (!label) { return; }
		this._webview.value?.postMessage({ type: 'canvasChoice', choiceId, label, canvas: typeof choice.canvas === 'string' ? choice.canvas : undefined });
		this.focus();
	}

	/** Fork de la conversación activa (rama independiente con el contexto heredado). */
	forkChat(): void {
		const webview = this._webview.value;
		const active = this.sessions().activeSessionId();
		if (!webview || !active) {
			return;
		}
		const forkedId = this.sessions().fork(active);
		if (forkedId) {
			this.cancelCurrentRun();
			this._activeId = forkedId;
			this.postRestore(webview);
			this.postTabs(webview);
		}
	}

	private async postSession(webview: IOverlayWebview): Promise<void> {
		const generation = ++this._sessionPostGeneration;
		let id = this.agentService.getActiveProviderId();
		let entry = this.agentService.findProvider(id);
		let provider = entry ? entry.label : id;
		let model = this.agentService.getModel() || entry?.defaultModel || '';
		let connected = false;
		try {
			connected = await this.agentService.isConnected(id);
		} catch {
			connected = false;
		}
		// Fuente canónica compartida con el picker del plan: mismos providers conectados,
		// mismo orden, modelos dinámicos y preservación del modelo seleccionado a mano.
		const groups = await this.agentService.getConnectedModelGroups(id, model);
		if (generation !== this._sessionPostGeneration || id !== this.agentService.getActiveProviderId() || model !== (this.agentService.getModel() || this.agentService.findProvider(id)?.defaultModel || '')) { return; }
		// Recuperación del estado incompleto de builds anteriores: guardar una primera API key
		// podía dejar la credencial conectada pero sin proveedor activo. Si hay una única opción
		// conectada no hay ambigüedad, así que la activamos y el chat queda utilizable al instante.
		if (!id && groups.length === 1) {
			if (generation !== this._sessionPostGeneration) { return; }
			id = groups[0].id;
			await this.agentService.setActiveProvider(id);
			entry = this.agentService.findProvider(id);
			provider = entry?.label ?? id;
			const remembered = this.agentService.getModel();
			model = remembered && groups[0].models.includes(remembered) ? remembered : (groups[0].defaultModel || groups[0].models[0] || '');
			if (model !== remembered) { await this.agentService.setModel(model); }
			connected = true;
		}
		if (generation !== this._sessionPostGeneration) { return; }
		// Límite de contexto para el anillo/panel de uso del composer (config override o catálogo por modelo).
		const contextLimit = this.agentService.getContextLimit();
		webview.postMessage({ type: 'session', provider, model, connected, activeId: id, groups, defaultModel: entry?.defaultModel || '', contextLimit, effort: this.agentService.getReasoningEffort(), permission: this.agentService.getPermissionMode() });
		// Refleja modelo/proveedor/límite en el footer nativo (status bar).
		this._statusProvider = provider;
		this._statusModel = model;
		this._statusConnected = connected;
		if (contextLimit > 0) {
			this._ctx.limit = contextLimit;
		}
		this.updateStatusbar();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this._container) {
			this._container.style.height = `${height}px`;
			this._container.style.width = `${width}px`;
		}
		this.layoutWebview();
	}

	override focus(): void {
		super.focus();
		this._webview.value?.focus();
	}
}
