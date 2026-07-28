/*---------------------------------------------------------------------------------------------
 *  OpenIDE — servicio del motor agéntico. Resuelve el provider desde el CATÁLOGO (datos),
 *  el adaptador de PROTOCOLO correcto, y la credencial vía la capa de AUTH; corre el
 *  agent loop (model → tool → model) con streaming, reintentos con backoff, límites de
 *  contexto por modelo (models.dev) y compactación automática del historial.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceCancellation, timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { basename, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { linesDiffComputers } from '../../../../editor/common/diff/linesDiffComputers.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { DEFAULT_EDITOR_ASSOCIATION } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEncryptionService, PasswordStoreCLIOption } from '../../../../platform/encryption/common/encryptionService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IPlaywrightService } from '../../../../platform/browserView/common/playwrightService.js';
import { OPENIDE_REQUEST_CHANNEL, OpenideRequestChannelClient } from '../../../../platform/request/common/openideRequestIpc.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IOpenideAgentHostService, OPENIDE_AGENT_HOST_CHANNEL } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IJSONEditingService } from '../../../services/configuration/common/jsonEditing.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { OpenideApprovalManager } from './openideApproval.js';
import { IOAuthInteraction, OpenideOAuthManager } from './openideOAuth.js';
import { DiagramResult, parseDiagramSource } from '../common/diagrams/openideDiagramEngine.js';
import { AgentLoopEvent, AgentMode, AgentStreamEvent, IAgentLocation, IAgentRunOptions, IAskQuestion, IBackgroundTerminalEvent, IChatMessage, ICredential, IFileRollbackCheckpoint, ILLMProvider, IMessageChangeSet, IMessageRollbackResult, IPersistedFileDiff, IProviderRequest, IProviderResult, IToolApprovalRequest, IToolDefinition, ITodoItem, ToolApprovalDecision } from '../common/openideAgentTypes.js';
import { findProvider, IProviderEntry, resolveProviders } from '../common/openideProviderCatalog.js';
import { breakdownTotal, computeContextBreakdown, estimateConversationTokens, estimateTextTokens, estimateToolsTokens } from '../common/openideTokens.js';
import { classifyProviderError } from '../common/openideErrorClassifier.js';
import { buildCompactionTranscript, buildDeterministicFallbackSummary, buildStructuredSummaryMessage, compactionSavingsRatio, normalizeCompactionOptions, planContextCompaction, shouldCompactContext } from '../common/openideContextCompaction.js';
import { OpenideToolCallGuard, repairToolArgumentsJson, validateToolArguments } from '../common/openideToolGuardrails.js';
import { resolveStreamStaleTimeoutSeconds } from '../common/openideReasoningTimeouts.js';
import { fallbackStepKey, parseFallbackChain, parseProviderModelTarget } from '../common/openideFallback.js';
import { normalizeModelForProvider } from '../common/openideModelNormalize.js';
import { OpenideRunSequencer } from '../common/openideRunSequencer.js';
import { isOutputLimitStopReason, MAX_OUTPUT_CONTINUATIONS, resolveAgentIterationLimit } from '../common/openideRunLimits.js';
import { AnthropicProvider } from '../common/providers/anthropicProvider.js';
import { GeminiCloudCodeProvider } from '../common/providers/geminiCloudCodeProvider.js';
import { CodexProvider } from '../common/providers/codexProvider.js';
import { OpenAICompatibleProvider } from '../common/providers/openaiProvider.js';
import { OpenAIResponsesProvider } from '../common/providers/openaiResponsesProvider.js';
import { IAgentMemorySnapshot, OpenideAgentMemory } from './openideAgentMemory.js';
import { HOOK_PAYLOAD_TEXT_CAP, OpenideAgentHooks } from './openideAgentHooks.js';
import { OpenideMcpManager } from './openideAgentMcp.js';
import { ISkillInfo, OpenideAgentSkills } from './openideAgentSkills.js';
import { OpenideAgentRules, RuleScope } from './openideAgentRules.js';
import { IOpenideCanvasService } from './openideCanvasService.js';
import { IOpenideUsageService } from './openideUsageService.js';
import { IProviderRateLimits, providerSupportsAnthropicUsage } from '../common/openideUsage.js';
import { OpenideAuthManager } from './openideAuth.js';
import { IGitProposal, OpenideGitFlow, shq } from './openideGitFlow.js';
import { normalizeLocalUrl } from '../common/openideLocalUrl.js';
import { OPENIDE_DIFF_SCHEME, OpenideDiffSnapshotProvider } from './openideDiffSnapshot.js';
import { OpenideEditReview, ReviewAction } from './openideEditReview.js';
import { OpenideModelCatalog } from './openideModelCatalog.js';
import { IOpenideCodebaseGraph } from './openideCodebaseGraph.js';
import { IOpenideCodebaseQueryService } from './openideCodebaseQueryService.js';
import { IOpenideCodebaseContextService } from './openideCodebaseContextService.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideCodebasePriorities } from './openideCodebasePriorities.js';
import { OpenideToolRegistry } from './openideTools.js';
import { OpenideMessageChangeSetService } from './openideMessageChangeSetService.js';
import { ISubagentExecutionService, ISubagentExecutionRequest } from './openideSubagentExecutionService.js';
import { ISubagentRoutingService } from './openideSubagentRoutingService.js';
import { ISubagentRoutingAvailability, ISubagentRoutingTarget, subagentTargetKey } from '../common/openideSubagentRouting.js';
import { ISubagentPermissionService } from './openideSubagentPermissionService.js';
import { ISubagentRegistryService } from './openideSubagentRegistryService.js';
import { ISubagentOrchestrationService } from './openideSubagentOrchestrationService.js';
import { ISubagentDefinition } from '../common/openideSubagentTypes.js';
import { ISubagentWorkspaceService } from './openideSubagentWorkspaceService.js';
import { OpenideBrowserAutomation, parseScreenshotMarker } from './openideBrowserTools.js';
import { OpenideWebResearch } from './openideWebResearch.js';
import { IBrowserPickResult } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';

export const IOpenideAgentService = createDecorator<IOpenideAgentService>('openideAgentService');

export type ComposerCapabilityKind = 'skill' | 'tool' | 'mcp';

export interface IComposerCapability {
	readonly kind: ComposerCapabilityKind;
	readonly name: string;
	readonly description: string;
	readonly risk?: 'safe' | 'write' | 'exec';
}

export interface IOpenideAgentService {
	readonly _serviceBrand: undefined;
	/** Catálogo de providers (built-in + custom de settings). */
	listProviders(): IProviderEntry[];
	findProvider(providerId: string): IProviderEntry | undefined;
	getActiveProviderId(): string;
	setActiveProvider(providerId: string): Promise<void>;
	getModel(): string;
	setModel(model: string): Promise<void>;
	/** Esfuerzo de razonamiento global ('' default · none · minimal…xhigh). */
	getReasoningEffort(): string;
	setReasoningEffort(effort: string): Promise<void>;
	getPermissionMode(): string;
	setPermissionMode(mode: string): Promise<void>;
	setApiKey(providerId: string, key: string): Promise<void>;
	clearApiKey(providerId: string): Promise<void>;
	hasApiKey(providerId: string): Promise<boolean>;
	/** Inicia el flujo OAuth (device-code / PKCE) para un provider que lo soporte. La UI puede
	 *  pasar su propia interacción (código/paste inline); sin ella se usan modales nativos. */
	signIn(providerId: string, interaction?: IOAuthInteraction): Promise<boolean>;
	isSignedIn(providerId: string): Promise<boolean>;
	signOut(providerId: string): Promise<void>;
	/** True si el provider ya tiene credencial utilizable (api key, sesión OAuth, o no requiere). */
	isConnected(providerId: string): Promise<boolean>;
	/**
	 * Usage/rate-limits OAuth del provider (Anthropic por ahora). No expone el token.
	 * `force` saltea el cache corto del UsageService.
	 */
	getProviderUsage(providerId: string, force?: boolean): Promise<IProviderRateLimits | undefined>;
	/** Modelos del provider: estáticos del catálogo o fetch dinámico (dynamicModels). */
	resolveProviderModels(entry: IProviderEntry): Promise<string[]>;
	/** Fuente compartida de los pickers de modelo (chat, planes y futuras superficies). */
	getConnectedModelGroups(selectedProviderId?: string, selectedModel?: string): Promise<{ id: string; label: string; defaultModel: string; models: string[] }[]>;
	/** Cómo persisten las credenciales: 'persisted' = disco (keyring/basic); 'in-memory' = se
	 *  pierden al cambiar de carpeta/reiniciar (típico en Linux sin keyring). */
	getSecretsPersistence(): Promise<'persisted' | 'in-memory' | 'unknown'>;
	/** True si se puede activar password-store=basic (Linux + secrets en memoria). */
	canEnableBasicPasswordStore(): Promise<boolean>;
	/** Activa password-store=basic en argv.json (Linux sin keyring) y reinicia la ventana para
	 *  que las credenciales nuevas se guarden en disco. */
	enableBasicPasswordStore(): Promise<void>;
	/** Evento que dispara cuando cambia algo del estado (config o credenciales). */
	readonly onDidChange: Event<void>;
	/** Pick & Polish: abre el picker visual sobre una app local; el resultado dispara
	 *  onDidPickElement (el chat lo adjunta al composer). Devuelve false si se canceló. */
	pickElement(url: string): Promise<boolean>;
	readonly onDidPickElement: Event<IBrowserPickResult>;
	/** Dictado por voz: transcribe un WAV (base64) con un modelo multimodal conectado. */
	transcribeAudio(wavBase64: string): Promise<string>;
	runAgent(prompt: string, onEvent: (e: AgentLoopEvent) => void, token?: CancellationToken): Promise<void>;
	/** Como runAgent pero con historial completo (multi-turn): el loop appendea al mismo array. */
	runMessages(messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, token?: CancellationToken, options?: IAgentRunOptions): Promise<void>;
	/** Compactación manual del historial (/compact), serializada con los runs normales. */
	compactConversation(messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, token?: CancellationToken): Promise<void>;
	cancelSubagent(id: string): void;
	/** Límite de contexto (tokens) del modelo activo — config override o catálogo por modelo. */
	getContextLimit(): number;
	/** Terminales en segundo plano (run_command background): emite create + cambios de estado. */
	readonly onDidChangeBackgroundTerminal: Event<IBackgroundTerminalEvent>;
	/** Revela y enfoca en el panel del IDE una terminal de fondo (click en el widget del chat). */
	revealBackgroundTerminal(id: string): Promise<void>;
	killBackgroundTerminal(id: string): void;
	/** Escribe una línea a la terminal del agente (input del usuario en la terminal embebida
	 *  del chat mientras run_command corre). */
	writeToolTerminal(text: string): void;
	/** Revela la terminal del agente en el panel/dock del IDE (menú "Enviar al panel"). */
	revealAgentTerminalToPanel(): Promise<boolean>;
	/** Sigue una ubicación semántica del agente sin robar el foco del chat. */
	followAgentLocation(location: IAgentLocation): Promise<void>;
	/** Sigue una terminal de background cuando ya existe su id estable. */
	followBackgroundTerminal(id: string): Promise<void>;
	/** Abre el REVIEW inline (integrado) de un archivo editado por el agente: el archivo en
	 *  el editor normal con los bloques pintados + Deshacer/Conservar por bloque y por archivo. */
	openDiff(path: string): Promise<void>;
	/** Descarta las ediciones del agente sobre un archivo: restaura el snapshot (o borra el archivo creado). */
	revertEdit(path: string): Promise<void>;
	/** Legacy: restaura snapshots completos; no se usa para rollback por mensaje. */
	rollbackFiles(checkpoints: readonly IFileRollbackCheckpoint[]): Promise<void>;
	/** Revierte exclusivamente el change set identificado, con patches y conflictos seguros. */
	rollbackMessage(changeSet: IMessageChangeSet, includeNonConflicting?: boolean): Promise<IMessageRollbackResult>;
	/** Acepta las ediciones de un archivo: olvida el baseline (el próximo edit arranca un diff nuevo). */
	keepEdit(path: string): Promise<void>;
	/** Acepta varios archivos atómicamente y fuerza el flush del snapshot antes de resolver. */
	keepEdits(paths: readonly string[]): Promise<void>;
	/** Conteos de diff actualizados FUERA de un run (Deshacer/Conservar por bloque en el editor):
	 *  la bandeja de archivos del chat se sincroniza con esto. added=removed=0 ⇒ archivo resuelto. */
	readonly onDidChangeFileDiff: Event<{ path: string; added: number; removed: number }>;
	/** Diffs pendientes restaurados del storage del workspace (para reconstruir la bandeja). */
	pendingFileDiffs(): readonly { path: string; added: number; removed: number }[];
	/** Acción del review inline sobre el editor enfocado (keybindings Ctrl+N / Ctrl+Shift+Y / Ctrl+Enter). */
	reviewAction(action: ReviewAction): void;
	/** MODO PLAN: la tool plan_save guardó un plan en .openide/plans — el chat muestra la card
	 *  de revisión/aprobación. path RELATIVO al workspace (ej: '.openide/plans/x.md'). */
	readonly onDidCreatePlan: Event<{ path: string; title: string; markdown: string }>;
	readonly onDidChangeCanvas: Event<{ path: string; title: string; created: boolean }>;
	/** Aprueba un plan (.openide/plans/*.md): frontmatter → `status: aprobado`, cambia el modelo
	 *  activo al execModel del plan si difiere, y pide al chat que lance el run de ejecución
	 *  (onDidRequestPlanBuild) — los runs viven en el chatView con su array de messages. */
	buildPlan(resource: URI): Promise<void>;
	readonly onDidRequestPlanBuild: Event<{ path: string; title: string; resource: URI; owner: string; providerId: string; model: string }>;
	readonly onDidChangePlanBuild: Event<{ resource: URI; busy: boolean }>;
	readonly onDidChangePlanFollow: Event<boolean>;
	startPlanBuild(resource: URI): string | undefined;
	finishPlanBuild(resource: URI, owner: string): void;
	failPlanBuild(resource: URI, owner: string): void;
	invalidatePlanBuild(resource: URI): void;
	reconcilePlanBuild(resource: URI, content: string): Promise<void>;
	isPlanBuildRunning(resource: URI): boolean;
	isPlanBuildCompleted(resource: URI): boolean;
	setPlanFollowEnabled(enabled: boolean): void;
	isPlanFollowEnabled(): boolean;
	getPlanExecutionModel(resource: URI): Promise<string>;
	getPlanExecutionTarget(resource: URI): Promise<{ providerId?: string; model: string }>;
	setPlanExecutionModel(resource: URI, model: string, providerId?: string): Promise<void>;
	updatePlanTasks(resource: URI, tasks: readonly { text?: unknown; done?: unknown }[]): Promise<void>;
	/** Resuelve una pregunta pendiente del agente (ask_user) con la respuesta del usuario. */
	resolveAsk(id: string, answer: string): void;
	resolveModeSuggestion(id: string, accepted: boolean): void;
	resolveApproval(id: string, decision: string): void;
	/** Motor de diagramas (backend único): parsea una fuente mermaid a spec (+layout si es grafo).
	 *  El chat lo llama SIEMPRE (el webview solo renderiza); vía MCP lo usan chats de extensiones. */
	parseDiagram(source: string): DiagramResult | undefined;
	/** Búsqueda fuzzy de archivos del workspace (autocomplete del @ del composer). */
	searchWorkspaceFiles(query: string, maxResults?: number): Promise<string[]>;
	/** Resuelve las @menciones de un texto a un bloque de contexto (contenido de los archivos). */
	buildMentionContext(text: string): Promise<string | undefined>;
	/** Resuelve chips de archivo estructurados del composer. A diferencia del parser de @,
	 *  admite espacios en el path y no contamina el texto visible del mensaje. */
	buildFileReferenceContext(paths: readonly string[]): Promise<string | undefined>;
	/** Catálogo vivo para el picker `/`: skills habilitadas + tools nativas y MCP conectadas. */
	listComposerCapabilities(): Promise<IComposerCapability[]>;
	/** Contexto semántico de una capability elegida en el picker; seleccionarla cambia el turno
	 *  que recibe el modelo, no es una etiqueta meramente visual. */
	buildComposerCapabilityContext(kind: ComposerCapabilityKind, name: string): Promise<string | undefined>;
	/** Recarga los servers MCP (.openide/mcp.json + global): disconnect + re-read + reconnect.
	 *  Devuelve un resumen legible (para la notificación del comando / la UI de extensiones). */
	reloadMcpServers(): Promise<string>;
	mcpClientId(): string;
	mcpOwnerToken(): string;
	/** Hooks userPromptSubmit (.openide/hooks.json + global): corre los hooks del evento y
	 *  devuelve el contexto a inyectar al MENSAJE DE USUARIO (message.context, mismo vehículo
	 *  que las @menciones — NUNCA al system prompt, que preserva el prefix cache). Fail-open. */
	hookUserPromptSubmit(text: string, sessionId?: string): Promise<string | undefined>;
	/** Skills del proyecto para la página "Extensiones del Agente" (includeDisabled=true lista
	 *  también las apagadas por openide.agent.disabledSkills, con su flag). */
	listSkills(includeDisabled?: boolean): Promise<ISkillInfo[]>;
	saveSkill(name: string, description: string, content: string): Promise<string>;
	deleteSkill(name: string): Promise<boolean>;
	/** Alta/baja en la lista de exclusión openide.agent.disabledSkills (Switch de la UI). */
	setSkillDisabled(name: string, disabled: boolean): Promise<void>;
	/** URI del SKILL.md de una skill (la UI lo abre en un editor normal). */
	skillFileUri(name: string): URI | undefined;
	/** Manager de hooks (allowlist de consentimiento, drift, test) — lo administra la UI de
	 *  extensiones sobre la MISMA instancia del loop (el consent de sesión no puede divergir). */
	hooksManager(): OpenideAgentHooks;
	/** Manager de Rules siempre activas; la UI comparte esta instancia con el prompt builder. */
	rulesManager(): OpenideAgentRules;
}

function normalizeTodos(raw: any): ITodoItem[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map((t: any, i: number): ITodoItem => ({
		id: typeof t?.id === 'string' && t.id ? t.id : `t${i}`,
		title: String(t?.title ?? ''),
		status: (t?.status === 'in-progress' || t?.status === 'completed') ? t.status : 'pending',
	}));
}

/** Normaliza los args de ask_user: forma batch (questions[]) o forma corta (question). Máx 5. */
function normalizeAskQuestions(a: any): IAskQuestion[] {
	const out: IAskQuestion[] = [];
	if (Array.isArray(a?.questions)) {
		for (const q of a.questions.slice(0, 5)) {
			if (typeof q === 'string' && q) {
				out.push({ question: q });
			} else if (q && typeof q.question === 'string' && q.question) {
				out.push({ question: q.question, options: Array.isArray(q.options) ? q.options.map((o: any) => String(o?.label ?? o)) : undefined });
			}
		}
	}
	if (!out.length && typeof a?.question === 'string' && a.question) {
		out.push({ question: a.question, options: Array.isArray(a.options) ? a.options.map(String) : undefined });
	}
	return out;
}

/** Cuenta líneas agregadas/eliminadas entre dos textos (mismo cómputo que el chat-editing de VS Code). */
function countDiff(oldStr: string, newStr: string): { added: number; removed: number } {
	const result = linesDiffComputers.getDefault().computeDiff(
		oldStr.split(/\r\n|\r|\n/),
		newStr.split(/\r\n|\r|\n/),
		{ ignoreTrimWhitespace: false, maxComputationTimeMs: 3000, computeMoves: false },
	);
	let added = 0;
	let removed = 0;
	for (const change of result.changes) {
		added += change.modified.length;
		removed += change.original.length;
	}
	return { added, removed };
}

/** Envolvente de líneas modificadas del lado NUEVO. El review la usa para seguir únicamente
 *  la escritura recién aplicada (una eliminación pura se ancla en la línea anterior). */
function changedLineRange(oldStr: string, newStr: string): { startLine: number; endLine: number } {
	const changes = linesDiffComputers.getDefault().computeDiff(
		oldStr.split(/\r\n|\r|\n/),
		newStr.split(/\r\n|\r|\n/),
		{ ignoreTrimWhitespace: false, maxComputationTimeMs: 3000, computeMoves: false },
	).changes;
	if (!changes.length) {
		return { startLine: 1, endLine: 1 };
	}
	let startLine = Number.MAX_SAFE_INTEGER;
	let endLine = 1;
	for (const change of changes) {
		const start = change.modified.isEmpty ? Math.max(1, change.modified.startLineNumber - 1) : change.modified.startLineNumber;
		const end = change.modified.isEmpty ? start : Math.max(start, change.modified.endLineNumberExclusive - 1);
		startLine = Math.min(startLine, start);
		endLine = Math.max(endLine, end);
	}
	return { startLine, endLine };
}

/** Diff unificado COMPACTO de UNA edición para la card del chat (compacto):
 *  hunks con 2 líneas de contexto, gaps entre hunks, cap de líneas y de ancho. */
function buildDiffPreview(oldStr: string, newStr: string, maxLines = 120): { t: 'add' | 'del' | 'ctx' | 'gap'; x: string }[] {
	const o = oldStr.split(/\r\n|\r|\n/);
	const n = newStr.split(/\r\n|\r|\n/);
	const changes = linesDiffComputers.getDefault().computeDiff(o, n, { ignoreTrimWhitespace: false, maxComputationTimeMs: 3000, computeMoves: false }).changes;
	const out: { t: 'add' | 'del' | 'ctx' | 'gap'; x: string }[] = [];
	const cap = (s: string) => s.length > 240 ? s.slice(0, 240) + '…' : s;
	let lastShown = 0; // última línea (lado nuevo) ya emitida
	for (const c of changes) {
		if (out.length >= maxLines) {
			out.push({ t: 'gap', x: '⋯' });
			break;
		}
		const ctxFrom = Math.max(Math.max(1, c.modified.startLineNumber - 2), lastShown + 1);
		if (lastShown && ctxFrom > lastShown + 1) {
			out.push({ t: 'gap', x: '⋯' });
		}
		for (let l = ctxFrom; l < c.modified.startLineNumber; l++) {
			out.push({ t: 'ctx', x: cap(n[l - 1] ?? '') });
		}
		for (let l = c.original.startLineNumber; l < c.original.endLineNumberExclusive; l++) {
			out.push({ t: 'del', x: cap(o[l - 1] ?? '') });
		}
		for (let l = c.modified.startLineNumber; l < c.modified.endLineNumberExclusive; l++) {
			out.push({ t: 'add', x: cap(n[l - 1] ?? '') });
		}
		lastShown = Math.max(lastShown, c.modified.endLineNumberExclusive - 1, c.modified.startLineNumber - 1);
	}
	return out.slice(0, maxLines);
}

/** Reescribe (o agrega) una clave del frontmatter YAML de un plan (.openide/plans/*.md).
 *  Tolerante línea-a-línea — mismo criterio que el parser de skills. Sin frontmatter ⇒ no toca.
 *  Lo comparten buildPlan (status), el Rechazar del chat y el picker de modelo de ejecución. */
export function setPlanFrontmatterValue(content: string, key: string, value: string): string {
	if (!content.startsWith('---')) {
		return content;
	}
	const end = content.indexOf('\n---', 3);
	if (end < 0) {
		return content;
	}
	const head = content.slice(0, end);
	const re = new RegExp(`^${key}:.*$`, 'm');
	const next = re.test(head) ? head.replace(re, `${key}: ${value}`) : `${head}\n${key}: ${value}`;
	return next + content.slice(end);
}

const MAX_STREAM_ATTEMPTS = 3;

const OUTPUT_CONTINUATION_PROMPT = '[Continuación interna de OpenIDE: la respuesta anterior alcanzó el límite de salida. Continuá exactamente donde se cortó, sin repetir texto ni dar por terminada la tarea antes de tiempo.]';

const SYSTEM_PROMPT = `Sos el asistente de OpenIDE, un editor de código basado en VS Code. Ayudás al usuario con tareas de programación de forma concisa y directa.

Tenés herramientas para trabajar sobre el workspace real (usalas en vez de inventar):
- read_file, list_files, search_text (grep), find_files (glob): lectura, no piden permiso.
- get_diagnostics: errores/warnings actuales del LSP y linters (de un archivo o del workspace).
- write_file, edit_file: escritura. edit_file requiere que old_string aparezca exactamente una vez (si el match exacto falla se intenta uno tolerante a whitespace). Ambas te devuelven los diagnósticos del archivo tras la edición: si introdujiste errores, corregilos antes de dar la tarea por terminada.
- run_command: ejecuta comandos de shell y te devuelve salida + exit code (para builds, tests, git…).
- update_todos: para tareas multi-paso mantené una lista de to-dos visible (mandá la lista COMPLETA cada vez, con UNA sola tarea "in-progress", y marcá "completed" apenas termines).
- memory: memoria persistente entre sesiones (add/replace/remove). target "project" para convenciones/decisiones/gotchas de este repo; target "user" para preferencias estables del usuario. Guardá solo hechos duraderos.
- skill_view / skill_save: skills del proyecto (procedimientos reutilizables). Si el índice de skills del prompt matchea la tarea, cargá la skill con skill_view ANTES de trabajar; cuando resuelvas algo difícil o descubras una receta repetible, guardala con skill_save.
- git_status / git_preflight / git_commit / workflow_configure: flujo de commits seguro. Al TERMINAR una tarea con ediciones llamá git_status; revisá el diff con review_changes, corregí los hallazgos, ejecutá git_preflight y recién entonces proponé un git_commit ATÓMICO por tema. git_commit requiere archivos explícitos y aprobación del usuario, nunca hace push. Buenas prácticas: mensajes Conventional Commits, nada de secretos, no acumular trabajo sin commitear.
- review_changes: revisión adversarial del diff actual por subagentes aislados. Usala para CADA implementación antes de un commit; los revisores no editan. Si devuelven VERDICT: BLOCK, corregí y repetí la revisión antes de continuar.
- browser_open / browser_navigate: abren o navegan UNA ÚNICA VISTA PREVIA nativa dentro del IDE (SOLO localhost). Apenas levantes un dev server llamá browser_open con esa URL para que el usuario vea la app sin salir del editor.
- web_search / web_fetch: investigan la web pública sin abrir la preview local. Citá las afirmaciones con los IDs [S#]/[W#] devueltos y listá sus URLs; no inventes citas.
- browser_snapshot / browser_screenshot / browser_console / browser_read_dom / browser_click / browser_type / browser_evaluate / browser_set_style: inspeccionan y manejan con Playwright ESA MISMA vista previa visible, nunca un browser invisible. Después de cambios de UI mirá el snapshot o screenshot y la consola. browser_set_style sirve para prototipar; luego llevá el cambio validado al código fuente.
- browser_playwright: ejecuta un flujo Playwright autocontenido sobre la page nativa existente cuando las tools específicas no alcanzan. No crees otra page/browser. browser_dialog responde alerts, prompts o file choosers que interrumpan el flujo.
- ask_user: si el pedido es ambiguo o falta info importante, preguntá ANTES de adivinar (podés agrupar hasta 5 preguntas en una llamada).

write_file, edit_file y run_command piden aprobación al usuario antes de ejecutarse; si el usuario rechaza, recibís un resultado de error y debés adaptarte (no reintentar lo mismo). Antes de editar un archivo, leelo. Respondé en el idioma del usuario.

Cuando ayude a explicar una arquitectura o un flujo, podés incluir un diagrama con un fence \`\`\`mermaid usando flowchart/graph (TD o LR); el chat lo renderiza.`;

/** Sufijo del system prompt según el modo (plan/ask son de solo lectura). */
const MODE_PROMPTS: Record<AgentMode, string> = {
	agent: '',
	plan: '\n\nMODO PLAN (solo lectura): tu entregable es un PLAN DE IMPLEMENTACIÓN completo, no código. Primero EXPLORÁ el código real con las herramientas de lectura (read_file, search_text, find_files, list_files, get_diagnostics) hasta entender el terreno — no planifiques sobre supuestos. Después armá el plan COMPLETO en Markdown con esta estructura: `# título` del plan; `## Contexto y decisiones` (qué encontraste y qué elegiste; usá tablas para comparar opciones y diagramas ```mermaid donde sumen); `## Archivos a tocar` (ruta + qué cambia en cada uno); `## Validación y revisión` (diagnósticos/tests, riesgos y foco que deberá revisar un subagente); `## Límites de commit` (cambios que deben ir juntos y cambios que deben separarse); `## Riesgos y fuera de alcance`; y AL FINAL `## Tareas` con checkboxes `- [ ] paso accionable` en ORDEN de ejecución (pasos chicos y verificables). En este modo NO tenés herramientas de escritura ni terminal; no intentes editar. COMO ÚLTIMO PASO llamá a la tool plan_save con el título y el markdown completo del plan — eso lo guarda para la revisión y aprobación del usuario; no termines el turno sin llamarla.',
	ask: '\n\nMODO PREGUNTA (solo lectura): respondé la consulta usando las herramientas de lectura. En este modo NO tenés herramientas de escritura ni terminal.',
	ultra: '\n\nMODO ULTRACODE (orquestación multi-agente): para pedidos que requieren entender varias partes del código o tareas paralelas, descomponé el trabajo en tareas INDEPENDIENTES y lanzalas EN PARALELO con UNA llamada a delegate_task (2 a 6 tasks). Cada prompt de delegación debe ser AUTÓNOMO: objetivo claro, paths/pistas concretas, formato de salida esperado y límite de esfuerzo — el subagente NO ve esta conversación. Los subagentes pueden EXPLORAR, PLANIFICAR y RESOLVER sus tareas de forma autónoma: pueden editar archivos, crear archivos y ejecutar comandos. Cada subagente trabaja de forma independiente y devuelve un INFORME final con lo que hizo, archivos modificados y decisiones tomadas. Tu rol como orquestador: (1) validar que los reportes sean correctos y auténticos, (2) integrar los resultados, resolver conflictos entre tareas, y (3) cerrar con una síntesis que confirme que cada tarea se completó correctamente. Tras cada implementación ejecutá review_changes: crea DOS revisores adversariales aislados, con el diff pero sin tu razonamiento. Si bloquean, corregí y repetí (máximo 2 rondas). No delegues tareas triviales; máximo 2 rondas de delegate_task por pedido.',
};

/** Revisión de cambios con contexto aislado: el implementador no se revisa a sí mismo. */
const REVIEW_CHANGES_TOOL_DEF: IToolDefinition = {
	name: 'review_changes',
	description: 'Revisa el diff actual de archivos explícitos con subagentes aislados. En Agent ejecuta 1 revisor y en Ultracode 2 revisores adversariales en paralelo. Los informes deben dar VERDICT: PASS o VERDICT: BLOCK; un BLOCK impide git_commit hasta corregir y volver a revisar.',
	parameters: {
		type: 'object',
		properties: {
			files: { type: 'array', items: { type: 'string' }, description: 'Archivos explícitos del cambio que se revisará' },
			focus: { type: 'string', description: 'Riesgos o contrato que los revisores deben priorizar' },
		},
		required: ['files'],
	},
};

interface ISubAgentContext {
	readonly adapter: ILLMProvider;
	readonly credential: ICredential;
	readonly entry: IProviderEntry;
	readonly model: string;
	readonly baseUrl: string | undefined;
	readonly maxTokens: number | undefined;
}

/** Tool de orquestación del modo Ultracode (solo se expone en ese modo; profundidad 1). */
const DELEGATE_TOOL_DEF: IToolDefinition = {
    name: 'delegate_task',
    description: 'Lanza subagentes AUTÓNOMOS EN PARALELO (2 a 6), cada uno con contexto aislado. Cada subagente EXPLORA, PLANIFICA y RESUELVE su tarea: puede leer archivos, editar, crear y ejecutar comandos de forma independiente. No ven esta conversación: cada prompt debe ser autónomo (objetivo, paths, formato de salida, límite de esfuerzo). Devuelven un informe final cada uno con lo que hicieron y archivos modificados. Tu rol: validar la autenticidad de los reportes e integrar los resultados.',
	parameters: {
		type: 'object',
		properties: {
			tasks: {
				type: 'array',
				description: 'Tareas independientes a investigar en paralelo (2 a 6)',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'Título corto visible en la UI (3 a 6 palabras)' },
						prompt: { type: 'string', description: 'Instrucciones completas y autónomas para el subagente' },
					},
					required: ['title', 'prompt'],
				},
			},
		},
		required: ['tasks'],
	},
};

/** Tool de triaje: el agente RECOMIENDA cambiar de modo (plan/ultra/fork). Solo se expone en
 *  agent/ask; no ejecuta el cambio — el usuario acepta la tarjeta accionable del chat. */
const SUBAGENT_TOOL_DEFS: readonly IToolDefinition[] = [
	{
		name: 'delegate_to_subagent',
		description: 'Delega una tarea a un subagente REGISTRADO. El nombre debe existir en el catálogo provisto por OpenIDE. Puede ejecutarse foreground o background.',
		parameters: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' }, context: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, symbols: { type: 'array', items: { type: 'string' } }, diagnostics: { type: 'boolean' }, selection: { type: 'string' } } }, background: { type: 'boolean' }, model: { type: 'string' } }, required: ['agent', 'task'] },
	},
	{ name: 'get_subagent_status', description: 'Consulta el estado de un run de subagente.', parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
	{ name: 'await_subagent', description: 'Espera el resultado terminal de un subagente.', parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
	{ name: 'cancel_subagent', description: 'Cancela solo el subagente indicado.', parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
	{ name: 'get_subagent_result', description: 'Obtiene el resultado persistido de un subagente.', parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
];

const SUGGEST_MODE_TOOL_DEF: IToolDefinition = {
	name: 'suggest_mode',
	description: 'Solicitá al usuario cambiar a un modo más adecuado (Agent, Plan, Ask, Ultracode o Fork). Muestra una tarjeta y BLOQUEA el loop hasta aceptar o rechazar. Si acepta, la UI reenvía el pedido en ese modo; si rechaza, continuá en el actual. Usala sólo cuando el cambio aporta valor real.',
	parameters: {
		type: 'object',
		properties: {
			mode: { type: 'string', enum: ['agent', 'plan', 'ask', 'ultra', 'fork'], description: 'agent = ejecutar y editar · plan = diseñar antes de editar · ask = sólo lectura · ultra = investigación paralela · fork = rama divergente' },
			reason: { type: 'string', description: 'Justificación BREVE y concreta para el usuario (1 frase): por qué conviene ese modo para ESTE pedido' },
			prompt: { type: 'string', description: 'Opcional: el pedido ya reformulado y scopeado para el modo destino, que se enviará si el usuario acepta. Si lo omitís, se reenvía el pedido original.' },
		},
		required: ['mode', 'reason'],
	},
};

export class OpenideAgentService extends Disposable implements IOpenideAgentService {

	declare readonly _serviceBrand: undefined;

	/** Adaptadores de PROTOCOLO (pocos). Los providers son datos del catálogo. */
	private readonly protocols = new Map<string, ILLMProvider>();
	private readonly auth: OpenideAuthManager;
	private readonly oauth: OpenideOAuthManager;
	private readonly netRequests: IRequestService;
	private readonly browserAutomation: OpenideBrowserAutomation;
	/** Cache corto del ping a providers locales (evita martillar el server en cada refresh). */
	private readonly localProbeCache = new Map<string, { at: number; ok: boolean }>();
	/** Cache de GET /models para providers con dynamicModels (TTL 5 min). */
	private readonly dynamicModelsCache = new Map<string, { at: number; models: string[] }>();
	private readonly tools: OpenideToolRegistry;
	private readonly mcp: OpenideMcpManager;
	private readonly hooks: OpenideAgentHooks;
	/** Id sintético estable por conversación (identidad del array de messages): correlaciona
	 *  los payloads de hooks de un mismo hilo. Ausencia en el WeakMap = sesión nueva. */
	private readonly hookSessions = new WeakMap<IChatMessage[], string>();
	private readonly memory: OpenideAgentMemory;
	private readonly skills: OpenideAgentSkills;
	private readonly rules: OpenideAgentRules;
	private readonly gitFlow: OpenideGitFlow;
	private readonly approval: OpenideApprovalManager;
	private readonly diffSnapshot: OpenideDiffSnapshotProvider;
	private readonly catalog: OpenideModelCatalog;
	/** Preguntas (ask_user) en vuelo, esperando respuesta del usuario. */
	private readonly _pendingAsks = new Map<string, DeferredPromise<string>>();
	private readonly _pendingModeSuggestions = new Map<string, DeferredPromise<boolean>>();
	private readonly _pendingApprovals = new Map<string, DeferredPromise<ToolApprovalDecision>>();
	private readonly subagentRuns = new Map<string, CancellationTokenSource>();
	private readonly compactionState = new WeakMap<IChatMessage[], { failures: number; lowSavings: number; cooldownUntil: number }>();
	/** Serializa los runs que comparten tools, terminal y mapas de interacción del servicio. */
	private readonly runSequencer = new OpenideRunSequencer();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidPickElement = this._register(new Emitter<IBrowserPickResult>());
	readonly onDidPickElement: Event<IBrowserPickResult> = this._onDidPickElement.event;

	private readonly _onDidChangeFileDiff = this._register(new Emitter<{ path: string; added: number; removed: number }>());
	readonly onDidChangeFileDiff: Event<{ path: string; added: number; removed: number }> = this._onDidChangeFileDiff.event;

	// MODO PLAN: plan_save escribió el documento (card de revisión del chat) / el usuario lo
	// aprobó (el chat lanza el run de ejecución).
	private readonly _onDidCreatePlan = this._register(new Emitter<{ path: string; title: string; markdown: string }>());
	readonly onDidCreatePlan: Event<{ path: string; title: string; markdown: string }> = this._onDidCreatePlan.event;
	get onDidChangeCanvas(): Event<{ path: string; title: string; created: boolean }> { return this.canvasService.onDidChangeCanvas; }
	private readonly _onDidRequestPlanBuild = this._register(new Emitter<{ path: string; title: string; resource: URI; owner: string; providerId: string; model: string }>());
	readonly onDidRequestPlanBuild: Event<{ path: string; title: string; resource: URI; owner: string; providerId: string; model: string }> = this._onDidRequestPlanBuild.event;
	private readonly _onDidChangePlanBuild = this._register(new Emitter<{ resource: URI; busy: boolean }>());
	readonly onDidChangePlanBuild: Event<{ resource: URI; busy: boolean }> = this._onDidChangePlanBuild.event;
	private readonly _onDidChangePlanFollow = this._register(new Emitter<boolean>());
	readonly onDidChangePlanFollow: Event<boolean> = this._onDidChangePlanFollow.event;
	private readonly planBuildStates = new Map<string, string>();
	/** Contenido exacto del plan al completar: cualquier edición posterior invalida el Build. */
	private readonly completedPlanBuilds = new Map<string, string>();
	private planFollowEnabled = false;
	private readonly editReview: OpenideEditReview;
	private readonly messageChanges: OpenideMessageChangeSetService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IBrowserViewWorkbenchService browserViewService: IBrowserViewWorkbenchService,
		@IPlaywrightService playwrightService: IPlaywrightService,
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService workspaceTrust: IWorkspaceTrustManagementService,
		@IOpenerService openerService: IOpenerService,
		@IQuickInputService quickInputService: IQuickInputService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITerminalService terminalService: ITerminalService,
		@ITextModelService textModelService: ITextModelService,
		@ICommandService private readonly commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
		@IMarkerService markerService: IMarkerService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IPathService pathService: IPathService,
		@ILogService logService: ILogService,
		@IOpenideCodebaseGraph private readonly codebaseGraph: IOpenideCodebaseGraph,
		@IOpenideCodebasePriorities private readonly codebasePriorities: IOpenideCodebasePriorities,
		@IOpenideCodebaseQueryService private readonly codebaseQuery: IOpenideCodebaseQueryService,
		@IOpenideCodebaseContextService private readonly codebaseContext: IOpenideCodebaseContextService,
		@ICodebaseMemoryService private readonly codebaseMemory: ICodebaseMemoryService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@IHostService private readonly hostService: IHostService,
		@IOpenideCanvasService private readonly canvasService: IOpenideCanvasService,
						@IOpenideUsageService private readonly usageService: IOpenideUsageService,
						@IEditorService private readonly editorService: IEditorService,
		@ISubagentExecutionService private readonly subagentExecution: ISubagentExecutionService,
		@ISubagentRoutingService private readonly subagentRouting: ISubagentRoutingService,
		@ISubagentPermissionService private readonly subagentPermissions: ISubagentPermissionService,
		@ISubagentRegistryService private readonly subagentRegistry: ISubagentRegistryService,
		@ISubagentOrchestrationService private readonly subagentOrchestration: ISubagentOrchestrationService,
		@ISubagentWorkspaceService private readonly subagentWorkspaces: ISubagentWorkspaceService,
	) {
		super();
		this.memory = new OpenideAgentMemory(fileService, contextService, environmentService);
		this.skills = new OpenideAgentSkills(fileService, contextService, configurationService, joinPath(pathService.userHome({ preferLocal: true }), '.config', 'agents', 'skills'));
		this.rules = new OpenideAgentRules(fileService, contextService, environmentService);
		// TODO el tráfico del agente (providers, OAuth, catálogo) va por el canal del MAIN
		// (Electron net, sin CORS y con streaming) — el fetch del renderer se estrella contra
		// CORS en endpoints como chatgpt.com/backend-api ("Failed to fetch").
		const netRequests: IRequestService = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
		this.netRequests = netRequests;
		this.protocols.set('anthropic', new AnthropicProvider(netRequests));
		this.protocols.set('openai', new OpenAICompatibleProvider(netRequests));
		this.protocols.set('openai-responses', new OpenAIResponsesProvider(netRequests));
		this.protocols.set('codex', new CodexProvider(netRequests));
		this.protocols.set('gemini-cloudcode', new GeminiCloudCodeProvider(netRequests, () => this.configurationService.getValue<string>('openide.agent.googleCloudProject')));
		// El loopback OAuth (Google: redirect a localhost) vive en el MAIN — canal del host.
		const hostForOAuth = ProxyChannel.toService<IOpenideAgentHostService>(mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL));
		this.oauth = new OpenideOAuthManager(netRequests, this.secretStorage, openerService, quickInputService, {
			start: opts => hostForOAuth.oauthLoopbackStart(opts),
			wait: (id, ms) => hostForOAuth.oauthLoopbackWait(id, ms),
			cancel: id => hostForOAuth.oauthLoopbackCancel(id),
		});
		this.auth = new OpenideAuthManager(this.secretStorage, this.oauth);
		this.tools = this._register(new OpenideToolRegistry(fileService, contextService, searchService, instantiationService, terminalService, markerService, textModelService));
		this.messageChanges = new OpenideMessageChangeSetService(fileService, contextService);
		void this.subagentRegistry.initialize();
		this.subagentRouting.setAvailabilityBackend(targets => this.resolveSubagentRoutingAvailability(targets));
		this.subagentExecution.setBackend(request => this.executeRegisteredSubagent(request));
		this.tools.registerTool(this.memoryTool());
		this.tools.registerTool(this.skillViewTool());
		this.tools.registerTool(this.skillSaveTool());
		this.tools.registerTool(this.ruleManageTool());
		this.tools.registerTool(this.planSaveTool());
		this.tools.registerTool(this.canvasWriteTool());
		this.tools.registerTool(this.canvasReadTool());
		this.tools.registerTool(this.canvasListTool());
		this.tools.registerTool(this.canvasOpenTool());
		this.tools.registerTool(this.codebaseSearchTool());
		this.tools.registerTool(this.codebaseExploreTool());
		this.tools.registerTool(this.codebaseCallersTool());
		this.tools.registerTool(this.memoryGraphStatusTool());
		this.tools.registerTool(this.memoryGraphSearchTool());
		this.tools.registerTool(this.memoryGraphExploreTool());
		this.tools.registerTool(this.memoryGraphCallersTool());
		this.tools.registerTool(this.memoryGraphCalleesTool());
		this.tools.registerTool(this.memoryGraphImpactTool());
		this.tools.registerTool(this.memoryGraphPathTool());
		this.tools.registerTool(this.memoryGraphRelatedTestsTool());
		this.tools.registerTool(this.codebaseSavePriorityTool());
		this.gitFlow = new OpenideGitFlow(fileService, contextService, this.tools);
		this.tools.registerTool(this.gitStatusTool());
		this.tools.registerTool(this.gitPreflightTool());
		this.tools.registerTool(this.gitCommitTool());
		this.tools.registerTool(this.gitCheckpointAliasTool());
		this.tools.registerTool(this.workflowConfigureTool());
		this.tools.registerTool(this.gitConfigureAliasTool());
		this.tools.registerTool(this.browserOpenTool());
		for (const tool of new OpenideWebResearch(hostForOAuth, this.configurationService).buildTools()) { this.tools.registerTool(tool); }
		// Playwright opera sobre el mismo BrowserView nativo visible; el canal main queda para Pick & Polish.
		this.browserAutomation = new OpenideBrowserAutomation(mainProcessService, this.configurationService, browserViewService, playwrightService);
		this.browserAutomation.registerTools(this.tools);
		// Servers MCP del usuario (main process): conecta lazy en el primer runMessages y va
		// registrando/deregistrando tools mcp_* en el registry según el estado de cada server.
		this.mcp = this._register(new OpenideMcpManager(mainProcessService, fileService, contextService, environmentService, workspaceTrust, this.configurationService, logService));
		this.mcp.registerTools(this.tools);
		// Hooks de shell del usuario (.openide/hooks.json + global): observan o bloquean el
		// lifecycle del agente. Fail-open siempre; la ejecución real vive en el main (execHook).
		this.hooks = this._register(new OpenideAgentHooks(mainProcessService, fileService, contextService, environmentService, this.configurationService, storageService, quickInputService, pathService, logService));
		this.approval = new OpenideApprovalManager(quickInputService, this.configurationService);
		this.diffSnapshot = instantiationService.createInstance(OpenideDiffSnapshotProvider);
		this.catalog = new OpenideModelCatalog(netRequests, storageService);
		this._register(textModelService.registerTextModelContentProvider(OPENIDE_DIFF_SCHEME, this.diffSnapshot));
		// Review inline integrado sobre el editor normal (bloques + Deshacer/Conservar).
		this.editReview = this._register(instantiationService.createInstance(OpenideEditReview, this.diffSnapshot, {
			resolveUri: (path: string) => this.tools.resolveWorkspacePath(path),
			gitBaseline: (path: string) => this.gitBaselineFor(path),
			clearBaseline: (path: string) => this.diffSnapshot.clearBaseline(path),
			revertFile: (path: string) => this.revertEdit(path),
			keepFile: (path: string) => this.keepEdit(path),
			notifyCounts: (path: string, added: number, removed: number) => this._onDidChangeFileDiff.fire({ path, added, removed }),
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openide.agent')) {
				this._onDidChange.fire();
			}
		}));

		this.migrateProviderSettings();
	}

	private customProviders(): any[] | undefined {
		return this.configurationService.getValue<any[]>('openide.agent.customProviders');
	}

	listProviders(): IProviderEntry[] {
		return resolveProviders(this.customProviders());
	}

	findProvider(providerId: string): IProviderEntry | undefined {
		return findProvider(this.customProviders(), providerId);
	}

	// Proveedor/modelo activos viven en IStorageService (no en settings.json): se configuran
	// desde la página "Proveedores de IA" / el picker nativo de modelos, no desde el Settings.
	private static readonly STORAGE_PROVIDER = 'openide.agent.activeProvider';
	/** Clave antigua (un único modelo global). Se conserva sólo para migrar builds previos. */
	private static readonly STORAGE_MODEL = 'openide.agent.activeModel';
	/** Cada proveedor recuerda su propio modelo. Esto evita arrastrar, por ejemplo, un GLM a Claude. */
	private static readonly STORAGE_MODELS_BY_PROVIDER = 'openide.agent.activeModelsByProvider';

	private modelsByProvider(): Record<string, string> {
		const raw = this.storageService.get(OpenideAgentService.STORAGE_MODELS_BY_PROVIDER, StorageScope.APPLICATION);
		if (!raw) {
			return {};
		}
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
		} catch {
			return {};
		}
	}

	private modelForProvider(providerId: string): string {
		if (!providerId) {
			return '';
		}
		const value = this.modelsByProvider()[providerId];
		return typeof value === 'string' ? value : '';
	}

	/** Migración one-time: los valores viejos de settings.json pasan a storage y se limpian. */
	private migrateProviderSettings(): void {
		const legacyProvider = this.configurationService.getValue<string>('openide.agent.provider');
		if (legacyProvider && this.storageService.get(OpenideAgentService.STORAGE_PROVIDER, StorageScope.APPLICATION) === undefined) {
			this.storageService.store(OpenideAgentService.STORAGE_PROVIDER, legacyProvider, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		const legacyModel = this.configurationService.getValue<string>('openide.agent.model');
		const storedLegacyModel = this.storageService.get(OpenideAgentService.STORAGE_MODEL, StorageScope.APPLICATION);
		const activeProvider = this.storageService.get(OpenideAgentService.STORAGE_PROVIDER, StorageScope.APPLICATION) || legacyProvider || '';
		const modelToMigrate = storedLegacyModel || legacyModel || '';
		if (activeProvider && modelToMigrate) {
			const models = this.modelsByProvider();
			if (typeof models[activeProvider] !== 'string') {
				models[activeProvider] = modelToMigrate;
				this.storageService.store(OpenideAgentService.STORAGE_MODELS_BY_PROVIDER, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
		}
		// Limpieza best-effort de settings.json (las keys ya no están registradas).
		if (legacyProvider !== undefined) {
			this.configurationService.updateValue('openide.agent.provider', undefined).catch(() => { });
		}
		if (legacyModel !== undefined) {
			this.configurationService.updateValue('openide.agent.model', undefined).catch(() => { });
		}
	}

	getActiveProviderId(): string {
		// '' = sin proveedor — la UI (chat/status bar) ofrece conectar; runMessages lo reporta accionable.
		return this.storageService.get(OpenideAgentService.STORAGE_PROVIDER, StorageScope.APPLICATION) || '';
	}

	async setActiveProvider(providerId: string): Promise<void> {
		this.storageService.store(OpenideAgentService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	getModel(): string {
		return this.modelForProvider(this.getActiveProviderId());
	}

	async setModel(model: string): Promise<void> {
		const providerId = this.getActiveProviderId();
		if (!providerId) {
			return;
		}
		const models = this.modelsByProvider();
		models[providerId] = model;
		this.storageService.store(OpenideAgentService.STORAGE_MODELS_BY_PROVIDER, JSON.stringify(models), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	private static readonly STORAGE_EFFORT = 'openide.agent.reasoningEffort';
	private static readonly STORAGE_PERMISSION = 'openide.agent.permissionMode';

	/** '' = default del modelo · 'none' apagado · minimal/low/medium/high/xhigh (con límites independientes del modelo). */
	getReasoningEffort(): string {
		return this.storageService.get(OpenideAgentService.STORAGE_EFFORT, StorageScope.APPLICATION) || '';
	}

	async setReasoningEffort(effort: string): Promise<void> {
		this.storageService.store(OpenideAgentService.STORAGE_EFFORT, effort, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	/** Política de permisos: 'ask' pregunta siempre (default) · 'auto-edit' auto-aprueba
	 *  ediciones (write) y pregunta por terminal (exec) · 'auto-all' auto-aprueba todo salvo el
	 *  piso hardline y los paths sensibles. Vive en storage (persiste). */
	getPermissionMode(): string {
		return this.storageService.get(OpenideAgentService.STORAGE_PERMISSION, StorageScope.APPLICATION) || 'ask';
	}

	async setPermissionMode(mode: string): Promise<void> {
		this.storageService.store(OpenideAgentService.STORAGE_PERMISSION, mode, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	async setApiKey(providerId: string, key: string): Promise<void> {
		await this.auth.setApiKey(providerId, key);
		this.subagentRouting.clearHealth(providerId);
		if (!this.getActiveProviderId()) {
			this.storageService.store(OpenideAgentService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		this._onDidChange.fire();
	}

	async clearApiKey(providerId: string): Promise<void> {
		await this.auth.clearApiKey(providerId);
		this._onDidChange.fire();
	}

	hasApiKey(providerId: string): Promise<boolean> {
		return this.auth.hasApiKey(providerId);
	}

	async signIn(providerId: string, interaction?: IOAuthInteraction): Promise<boolean> {
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry) {
			throw new Error(`Provider desconocido: "${providerId}".`);
		}
		const ok = await this.oauth.signIn(entry, interaction);
		if (ok) {
			this.subagentRouting.clearHealth(providerId);
			if (!this.getActiveProviderId()) {
				this.storageService.store(OpenideAgentService.STORAGE_PROVIDER, providerId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			}
			this._onDidChange.fire();
		}
		return ok;
	}

	isSignedIn(providerId: string): Promise<boolean> {
		return this.oauth.isSignedIn(providerId);
	}

	async signOut(providerId: string): Promise<void> {
		await this.oauth.signOut(providerId);
		this._onDidChange.fire();
	}

	async isConnected(providerId: string): Promise<boolean> {
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry) {
			return false;
		}
		if (entry.auth === 'none') {
			// Local (Ollama/LM Studio/llama.cpp): "conectado" = el server está escuchando.
			return this.probeLocalProvider(entry.id, entry.baseUrl ?? '');
		}
		if (entry.auth === 'oauth') {
			return this.oauth.isSignedIn(providerId);
		}
		return this.auth.hasApiKey(providerId);
	}

	/**
	 * Usage OAuth del provider. Resuelve el bearer vía AuthManager (nunca lo devuelve)
	 * y delega el fetch+cache a OpenideUsageService. Scope inicial: Anthropic OAuth.
	 */
	async getProviderUsage(providerId: string, force = false): Promise<IProviderRateLimits | undefined> {
		if (!this.configurationService.getValue<boolean>('openide.agent.usage.enabled')) {
			return undefined;
		}
		const entry = findProvider(this.customProviders(), providerId);
		if (!entry || !providerSupportsAnthropicUsage(entry)) {
			return undefined;
		}
		if (!(await this.isConnected(providerId))) {
			return undefined;
		}
		try {
			const cred = await this.auth.resolveCredential(entry);
			if (cred.kind !== 'oauth' || !cred.token) {
				return undefined;
			}
			return await this.usageService.fetchAnthropicOAuthUsage(providerId, cred.token, { force });
		} catch {
			return {
				providerId,
				fetchedAt: Date.now(),
				windows: [],
				error: 'No se pudo resolver la credencial OAuth para usage.',
			};
		}
	}

	async getSecretsPersistence(): Promise<'persisted' | 'in-memory' | 'unknown'> {
		// Forzar init del SecretStorage (type arranca en 'unknown' hasta el primer get/set).
		try {
			await this.secretStorage.get('openide.agent._probe');
		} catch { /* ignore */ }
		const t = this.secretStorage.type;
		return t === 'persisted' || t === 'in-memory' ? t : 'unknown';
	}

	async canEnableBasicPasswordStore(): Promise<boolean> {
		// password-store=basic / plain-text encryption solo aplica en Linux (Win/mac usan DPAPI/Keychain).
		if (!isLinux || isWindows || isMacintosh) {
			return false;
		}
		return (await this.getSecretsPersistence()) === 'in-memory';
	}

	async enableBasicPasswordStore(): Promise<void> {
		if (!(await this.canEnableBasicPasswordStore())) {
			throw new Error('El almacenamiento local de credenciales solo está disponible en Linux cuando el keyring del sistema no está disponible.');
		}
		// Mismo fix que el diálogo nativo de VS Code en Linux sin keyring: password-store=basic
		// en argv.json + plain-text encryption en esta sesión, y reload para que el main lo tome.
		await this.encryptionService.setUsePlainTextEncryption();
		await this.jsonEditingService.write(
			this.environmentService.argvResource,
			[{ path: ['password-store'], value: PasswordStoreCLIOption.basic }],
			true,
		);
		await this.hostService.reload();
	}

	/** Ping con timeout corto al baseUrl de un provider local. Cualquier respuesta HTTP
	 *  (incluso 404) cuenta como vivo; solo el fallo de conexión cuenta como caído. */
	private async probeLocalProvider(providerId: string, baseUrl: string): Promise<boolean> {
		if (!baseUrl) {
			return true; // sin URL no hay qué probar (no bloquear providers custom raros)
		}
		const cached = this.localProbeCache.get(providerId);
		if (cached && Date.now() - cached.at < 5_000) {
			return cached.ok;
		}
		let ok = false;
		const cts = new CancellationTokenSource();
		const timer = setTimeout(() => cts.cancel(), 1_500);
		try {
			const url = `${baseUrl.replace(/\/+$/, '')}/models`;
			const ctx = await this.netRequests.request({ type: 'GET', url, callSite: 'openideAgentLocalProbe' }, cts.token);
			ok = typeof ctx.res.statusCode === 'number';
		} catch {
			ok = false;
		} finally {
			clearTimeout(timer);
			cts.dispose();
		}
		this.localProbeCache.set(providerId, { at: Date.now(), ok });
		return ok;
	}

	async resolveProviderModels(entry: IProviderEntry): Promise<string[]> {
		const fallback = entry.models?.length ? [...entry.models] : (entry.defaultModel ? [entry.defaultModel] : []);
		if (!entry.dynamicModels || !entry.baseUrl) {
			return fallback;
		}
		const cached = this.dynamicModelsCache.get(entry.id);
		if (cached && Date.now() - cached.at < 300_000) {
			return cached.models;
		}
		try {
			const url = `${entry.baseUrl.replace(/\/+$/, '')}/models`;
			const headers: Record<string, string> = {};
			if (entry.auth === 'apiKey' && await this.auth.hasApiKey(entry.id)) {
				const cred = await this.auth.resolveCredential(entry);
				if (cred.kind === 'apiKey' && cred.value) {
					headers['Authorization'] = `Bearer ${cred.value}`;
				}
			}
			const ctx = await this.netRequests.request({ type: 'GET', url, headers, callSite: 'openideAgentModels' }, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			if (status < 200 || status >= 300) {
				throw new Error(`HTTP ${status}`);
			}
			const text = await asText(ctx);
			if (!text) {
				throw new Error('empty body');
			}
			const body = JSON.parse(text);
			const ids = (Array.isArray(body?.data) ? body.data : [])
				.map((m: { id?: string }) => m?.id)
				.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
				.sort((a: string, b: string) => a.localeCompare(b));
			if (ids.length) {
				this.dynamicModelsCache.set(entry.id, { at: Date.now(), models: ids });
				return ids;
			}
		} catch { /* sin red o API caída: fallback estático */ }
		return fallback;
	}

	async getConnectedModelGroups(selectedProviderId = this.getActiveProviderId(), selectedModel = this.getModel()): Promise<{ id: string; label: string; defaultModel: string; models: string[] }[]> {
		const providers = this.listProviders();
		const groups: { id: string; label: string; defaultModel: string; models: string[] }[] = [];
		await Promise.all(providers.map(async provider => {
			try {
				if (!(await this.isConnected(provider.id))) { return; }
				const models = [...await this.resolveProviderModels(provider)];
				// Igual que el composer histórico: el valor persistido/manual sigue visible aunque
				// discovery cambie. Build lo revalida antes de ejecutar y dará un error accionable si caducó.
				if (provider.id === selectedProviderId && selectedModel && !models.includes(selectedModel)) { models.push(selectedModel); }
				if (models.length) { groups.push({ id: provider.id, label: provider.label, defaultModel: provider.defaultModel || '', models }); }
			} catch { /* provider desconectado o discovery fallido */ }
		}));
		groups.sort((a, b) => providers.findIndex(provider => provider.id === a.id) - providers.findIndex(provider => provider.id === b.id));
		return groups;
	}

	resolveAsk(id: string, answer: string): void {
		const deferred = this._pendingAsks.get(id);
		if (deferred && !deferred.isSettled) {
			deferred.complete(answer);
		}
	}

	resolveModeSuggestion(id: string, accepted: boolean): void {
		const deferred = this._pendingModeSuggestions.get(id);
		if (deferred && !deferred.isSettled) { deferred.complete(accepted); }
	}

	resolveApproval(id: string, decision: string): void {
		const deferred = this._pendingApprovals.get(id);
		if (deferred && !deferred.isSettled) {
			const valid = decision === 'once' || decision === 'session' || decision === 'always' ? decision : 'deny';
			deferred.complete(valid as ToolApprovalDecision);
		}
	}

	cancelSubagent(id: string): void {
		this.subagentRuns.get(id)?.cancel();
	}

	/** Emite el pedido de aprobación como card INLINE del chat y espera la elección del usuario. */
	private promptApprovalInline(req: IToolApprovalRequest, sensitive: boolean, onEvent: (e: AgentLoopEvent) => void, token: CancellationToken): Promise<ToolApprovalDecision> {
		const id = generateUuid();
		const deferred = new DeferredPromise<ToolApprovalDecision>();
		this._pendingApprovals.set(id, deferred);
		const sub = token.onCancellationRequested(() => { if (!deferred.isSettled) { deferred.complete('deny'); } });
		onEvent({ type: 'approvalRequest', id, tool: req.tool, title: req.title, detail: req.detail, command: req.command, risk: req.risk, sensitive });
		return deferred.p.finally(() => { sub.dispose(); this._pendingApprovals.delete(id); });
	}

	parseDiagram(source: string): DiagramResult | undefined {
		try {
			return parseDiagramSource(source);
		} catch {
			return undefined; // fuente malformada: el cliente cae a su fallback (code block)
		}
	}

	searchWorkspaceFiles(query: string, maxResults = 12): Promise<string[]> {
		return this.tools.searchFilesForMention(query, maxResults);
	}

	/** Extrae los tokens @ruta del texto, lee esos archivos (máx 8, presupuesto total ~48k chars)
	 *  y arma el bloque de contexto que viaja junto al mensaje del usuario. */
	async buildMentionContext(text: string): Promise<string | undefined> {
		const seen = new Set<string>();
		const paths: string[] = [];
		for (const m of text.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
			const p = m[1].replace(/[.,;:!?)]+$/, ''); // puntuación pegada al final de la mención
			if (p && !seen.has(p)) {
				seen.add(p);
				paths.push(p);
			}
		}
		return this.buildFileReferenceContext(paths);
	}

	async buildFileReferenceContext(inputPaths: readonly string[]): Promise<string | undefined> {
		const paths = [...new Set(inputPaths.map(path => String(path).trim()).filter(Boolean))];
		if (!paths.length) { return undefined; }
		const parts: string[] = [];
		let budget = 48000;
		for (const p of paths.slice(0, 8)) {
			if (budget <= 0) {
				break;
			}
			const content = await this.tools.readMentionedFile(p, Math.min(20000, budget));
			if (content === undefined) {
				continue; // no existe / no legible: la mención queda como texto plano
			}
			budget -= content.length;
			parts.push(`=== ${p} ===\n${content}`);
		}
		if (!parts.length) {
			return undefined;
		}
		return '[Archivos adjuntados por el usuario con @ — contenido al momento del mensaje]\n\n' + parts.join('\n\n');
	}

	async listComposerCapabilities(): Promise<IComposerCapability[]> {
		// El picker refleja el registry efectivo. La primera apertura también inicia MCP con el
		// mismo wait acotado usado por runMessages; no inventamos servers ni tools desconectadas.
		await this.mcp.ensureStarted();
		const skills = await this.skills.listSkills();
		const out: IComposerCapability[] = skills.map(skill => ({
			kind: 'skill', name: skill.name, description: skill.description,
		}));
		for (const def of this.tools.getDefinitions()) {
			const tool = this.tools.getTool(def.name);
			out.push({
				kind: def.name.startsWith('mcp_') ? 'mcp' : 'tool',
				name: def.name,
				description: def.description,
				risk: tool?.risk,
			});
		}
		return out;
	}

	async buildComposerCapabilityContext(kind: ComposerCapabilityKind, name: string): Promise<string | undefined> {
		if (kind === 'skill') {
			const content = await this.skills.readSkill(name);
			return content
				? `[Skill seleccionada explícitamente por el usuario: ${name}]\nSeguí estas instrucciones para este turno:\n\n${content}`
				: undefined;
		}
		await this.mcp.ensureStarted();
		const def = this.tools.getDefinitions().find(candidate => candidate.name === name);
		if (!def || (kind === 'mcp') !== name.startsWith('mcp_')) { return undefined; }
		return `[Herramienta seleccionada explícitamente por el usuario]\nPriorizá la herramienta \`${name}\` cuando sea aplicable a este pedido. Descripción: ${def.description}`;
	}

	reloadMcpServers(): Promise<string> { return this.mcp.reload(); }
	mcpClientId(): string { return this.mcp.getClientId(); }
	mcpOwnerToken(): string { return this.mcp.getOwnerToken(); }

	async hookUserPromptSubmit(text: string, sessionId?: string): Promise<string | undefined> {
		const outcomes = await this.hooks.dispatch('userPromptSubmit', { sessionId, extra: { prompt: String(text ?? '').slice(0, HOOK_PAYLOAD_TEXT_CAP) } });
		return this.hooks.getInjectedContext(outcomes);
	}

	// ---- API de skills / hooks para la página "Extensiones del Agente" ----

	listSkills(includeDisabled?: boolean): Promise<ISkillInfo[]> {
		return this.skills.listSkills(includeDisabled);
	}

	saveSkill(name: string, description: string, content: string): Promise<string> {
		return this.skills.saveSkill(name, description, content);
	}

	deleteSkill(name: string): Promise<boolean> {
		return this.skills.deleteSkill(name);
	}

	setSkillDisabled(name: string, disabled: boolean): Promise<void> {
		return this.skills.setDisabled(name, disabled);
	}

	skillFileUri(name: string): URI | undefined {
		return this.skills.fileUri(name);
	}

	hooksManager(): OpenideAgentHooks {
		return this.hooks;
	}

	rulesManager(): OpenideAgentRules {
		return this.rules;
	}

	/** Id de sesión para los payloads de hooks — estable por array de messages (conversación). */
	private hookSessionId(messages: IChatMessage[]): string {
		let id = this.hookSessions.get(messages);
		if (!id) {
			id = generateUuid();
			this.hookSessions.set(messages, id);
		}
		return id;
	}

	get onDidChangeBackgroundTerminal(): Event<IBackgroundTerminalEvent> {
		return this.tools.onDidChangeBackgroundTerminal;
	}

	revealBackgroundTerminal(id: string): Promise<void> {
		return this.tools.revealBackgroundTerminal(id);
	}

	killBackgroundTerminal(id: string): void {
		this.tools.killBackgroundTerminal(id);
	}

	writeToolTerminal(text: string): void {
		this.tools.writeToAgentTerminal(text);
	}

	revealAgentTerminalToPanel(): Promise<boolean> {
		return this.tools.revealAgentTerminalToPanel();
	}

	async followAgentLocation(location: IAgentLocation): Promise<void> {
		if (location.kind === 'terminal') {
			if (!location.background) {
				await this.tools.followAgentTerminal();
			}
			return;
		}
		if (location.kind === 'browser') {
			await this.commandService.executeCommand('openide.browser.open');
			return;
		}
		const path = location.path.trim();
		const uri = path ? this.tools.resolveWorkspacePath(path) : undefined;
		if (!uri) {
			return;
		}
		// Los planes son siempre un artefacto visual, incluso cuando la edición pide review:
		// el review de texto crudo nunca debe ganarle al editor visual del plan.
		const isPlan = /(?:^|[\\/])\.openide[\\/]plans[\\/][^\\/]+\.md$/i.test(path);
		if (location.review && !isPlan) {
			await this.editReview.openReview(path, true, { startLine: location.line, endLine: location.endLine });
			return;
		}
		await this.editorService.openEditor({
			resource: uri,
			options: {
				preserveFocus: true,
				pinned: isPlan,
				revealIfOpened: true,
				...(isPlan ? { override: 'openide.planEditor' } : { override: DEFAULT_EDITOR_ASSOCIATION.id }),
				...(!isPlan && location.line ? { selection: { startLineNumber: location.line, startColumn: 1 } } : {}),
			},
		});
	}

	followBackgroundTerminal(id: string): Promise<void> {
		return this.tools.followBackgroundTerminal(id);
	}

	async openDiff(path: string): Promise<void> {
		// Una card histórica aceptada puede seguir existiendo en el transcript, pero ya no tiene
		// snapshot pendiente. Abrirla debe mostrar el archivo actual PLANO: reconstruir un baseline
		// contra Git resucitaba cambios ya conservados después de cada reinicio.
		if (!this.diffSnapshot.pendingPaths().includes(path)) {
			const uri = this.tools.resolveWorkspacePath(path);
			if (uri) {
				await this.editorService.openEditor({
					resource: uri,
					options: { pinned: true, override: DEFAULT_EDITOR_ASSOCIATION.id },
				});
			}
			return;
		}
		// review inline integrado: el archivo en el editor NORMAL con los bloques pintados
		// (el side-by-side dejaba medio editor muerto y scrollbars de más para este flujo)
		await this.editReview.openReview(path);
	}

	pendingFileDiffs(): readonly { path: string; added: number; removed: number }[] {
		return this.diffSnapshot.pendingDiffs();
	}

	async revertEdit(path: string): Promise<void> {
		const uri = this.tools.resolveWorkspacePath(path);
		if (!uri) {
			return;
		}
		const snap = this.diffSnapshot.getSnapshot(path);
		this.editReview.detach(path);
		if (snap) {
			// sesión en vivo: restaurar el contenido exacto previo a la edición del agente.
			if (snap.existed) {
				await this.fileService.writeFile(uri, VSBuffer.fromString(snap.content));
			} else {
				try { await this.fileService.del(uri); } catch { /* ya no existe */ }
			}
		} else {
			// sin snapshot (p.ej. tras reinicio): revertir a git HEAD; si no está trackeado, borrar.
			const res = await this.tools.runShellCaptured(`git checkout HEAD -- ${shq(uri.fsPath)} 2>/dev/null`, CancellationToken.None, 30000);
			const ok = !!res && res !== 'no-shell-integration' && (res.exitCode ?? 1) === 0;
			if (!ok) {
				try { await this.fileService.del(uri); } catch { /* no trackeado y ya borrado */ }
			}
			this.gitBaselines.delete(path);
		}
		this.diffSnapshot.clearBaseline(path);
		this._onDidChangeFileDiff.fire({ path, added: 0, removed: 0 });
		// fileService escribe directo al disco; si el archivo seguia abierto, Monaco puede
		// conservar el contenido del agente aun despues de Undo. Recargar el modelo limpio
		// mantiene editor, snapshot y bandeja en el mismo estado.
		await this.editReview.reloadFromDisk(path);
	}

	async rollbackMessage(changeSet: IMessageChangeSet, includeNonConflicting = false): Promise<IMessageRollbackResult> {
		const result = await this.messageChanges.rollback(changeSet, includeNonConflicting);
		for (const file of result.files) {
			if (file.status !== 'reverted') { continue; }
			const baseline = this.diffSnapshot.getSnapshot(file.uri);
			if (baseline) {
				const uri = this.tools.resolveWorkspacePath(file.uri);
				let current = '';
				let exists = false;
				if (uri) { try { current = (await this.fileService.readFile(uri)).value.toString(); exists = true; } catch { /* deleted */ } }
				const counts = countDiff(baseline.content, current);
				const pending = baseline.existed !== exists || counts.added + counts.removed > 0;
				this.diffSnapshot.markPending(file.uri, pending, counts.added, counts.removed);
				this._onDidChangeFileDiff.fire({ path: file.uri, added: pending ? counts.added : 0, removed: pending ? counts.removed : 0 });
			}
			await this.editReview.reloadFromDisk(file.uri);
		}
		return result;
	}

	async rollbackFiles(checkpoints: readonly IFileRollbackCheckpoint[]): Promise<void> {
		// El caller conserva el primer checkpoint cronológico por path. No tocamos conversación
		// ni snapshots hasta que todas las escrituras del rollback hayan terminado. Guardamos el
		// estado actual para deshacer también un rollback que falle a mitad de camino.
		const beforeRollback: Array<{ path: string; uri: URI; content: string; existed: boolean }> = [];
		const restored: Array<{ checkpoint: IFileRollbackCheckpoint; content: string }> = [];
		try {
			for (const checkpoint of checkpoints) {
				const uri = this.tools.resolveWorkspacePath(checkpoint.path);
				if (!uri) {
					throw new Error(`No se puede restaurar fuera del workspace: ${checkpoint.path}`);
				}
				let current = '';
				let existed = true;
				try { current = (await this.fileService.readFile(uri)).value.toString(); } catch { existed = false; }
				beforeRollback.push({ path: checkpoint.path, uri, content: current, existed });
				this.editReview.detach(checkpoint.path);
				if (checkpoint.existed) {
					await this.fileService.writeFile(uri, VSBuffer.fromString(checkpoint.content));
				} else {
					try { await this.fileService.del(uri); } catch { /* creado en el turno y ya ausente */ }
				}
				restored.push({ checkpoint, content: checkpoint.existed ? checkpoint.content : '' });
			}
		} catch (error) {
			for (const previous of beforeRollback.reverse()) {
				try {
					if (previous.existed) {
						await this.fileService.writeFile(previous.uri, VSBuffer.fromString(previous.content));
					} else {
						await this.fileService.del(previous.uri);
					}
					await this.editReview.reloadFromDisk(previous.path);
				} catch { /* best effort: conservamos el error original */ }
			}
			throw error;
		}

		for (const { checkpoint, content } of restored) {
			const baseline = this.diffSnapshot.getSnapshot(checkpoint.path);
			let added = 0;
			let removed = 0;
			if (baseline) {
				const matchesBaseline = baseline.existed === checkpoint.existed && baseline.content === content;
				if (matchesBaseline) {
					this.diffSnapshot.clearBaseline(checkpoint.path);
				} else {
					const counts = countDiff(baseline.content, content);
					this.diffSnapshot.markPending(checkpoint.path, counts.added + counts.removed > 0 || baseline.existed !== checkpoint.existed, counts.added, counts.removed);
					added = counts.added;
					removed = counts.removed;
				}
			}
			this._onDidChangeFileDiff.fire({ path: checkpoint.path, added, removed });
			await this.editReview.reloadFromDisk(checkpoint.path);
		}
	}

	private readonly gitBaselines = new Map<string, string | undefined>();

	/** Contenido del archivo en HEAD de git (baseline de respaldo cuando no hay snapshot de la
	 *  sesión — p.ej. tras un reinicio). Cacheado por path. undefined = no trackeado / sin commits /
	 *  git caído ⇒ el review trata el archivo como nuevo (todo verde). */
	private async gitBaselineFor(path: string): Promise<string | undefined> {
		if (this.gitBaselines.has(path)) {
			return this.gitBaselines.get(path);
		}
		const uri = this.tools.resolveWorkspacePath(path);
		if (!uri) {
			this.gitBaselines.set(path, undefined);
			return undefined;
		}
		// Resolvemos el path relativo al repo (ls-files --full-name, funciona aunque el workspace
		// sea un subfolder del repo) y pedimos el contenido en HEAD. El guard [ -n "$__oi_rel" ] es
		// CRÍTICO: si el archivo no está trackeado, ls-files devuelve vacío y `git show "HEAD:"`
		// (path vacío) listaría el árbol raíz entero con exit 0 → baseline basura. Con el guard,
		// el no-trackeado corta la cadena → exit != 0 → baseline undefined (archivo nuevo, todo verde).
		const cmd = `__oi_rel=$(git ls-files --full-name -- ${shq(uri.fsPath)} 2>/dev/null) && [ -n "$__oi_rel" ] && git show "HEAD:$__oi_rel" 2>/dev/null`;
		const res = await this.tools.runShellCaptured(cmd, CancellationToken.None, 30000);
		let baseline: string | undefined;
		if (res && res !== 'no-shell-integration' && (res.exitCode ?? 1) === 0) {
			baseline = res.output ?? '';
		}
		this.gitBaselines.set(path, baseline);
		return baseline;
	}

	async keepEdit(path: string): Promise<void> {
		await this.keepEdits([path]);
	}

	async keepEdits(paths: readonly string[]): Promise<void> {
		const unique = [...new Set(paths.filter(path => typeof path === 'string' && path.trim()))];
		for (const path of unique) {
			this.editReview.detach(path);
		}
		await this.diffSnapshot.clearBaselines(unique);
	}

	reviewAction(action: ReviewAction): void {
		this.editReview.runAction(action);
	}

	/** Tool `memory` (con límites independientes del modelo): risk 'safe' — solo escribe sus propios archivos de memoria. */
	private memoryTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'memory',
				description: 'Memoria persistente entre sesiones. Guardá hechos DURADEROS: target "project" (convenciones, decisiones y gotchas de ESTE repo → .openide/MEMORY.md) o "user" (preferencias estables del usuario, global). Usala cuando el usuario exprese una preferencia o te corrija la forma de trabajar. NO guardes estados transitorios, errores ya resueltos ni detalles de un solo turno.',
				parameters: {
					type: 'object',
					properties: {
						action: { type: 'string', enum: ['add', 'replace', 'remove'], description: 'add agrega una entrada; replace/remove operan sobre la entrada que contenga old_text' },
						target: { type: 'string', enum: ['project', 'user'] },
						content: { type: 'string', description: 'Texto de la entrada (add/replace)' },
						old_text: { type: 'string', description: 'Fragmento único de la entrada existente (replace/remove)' },
					},
					required: ['action', 'target'],
				},
			},
			invoke: (args: any) => this.memory.mutate(
				args.target === 'user' ? 'user' : 'project',
				args.action === 'replace' ? 'replace' : args.action === 'remove' ? 'remove' : 'add',
				String(args.content ?? ''),
				String(args.old_text ?? ''),
			),
		};
	}

	/** skill_view: carga el cuerpo completo de una skill (progressive disclosure tier 2). */
	private skillViewTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'skill_view',
				description: 'Carga el contenido completo de una skill del proyecto (las del índice del system prompt). Usala ANTES de encarar una tarea que matchee la description de una skill.',
				parameters: {
					type: 'object',
					properties: { name: { type: 'string', description: 'Nombre de la skill (kebab-case, como figura en el índice)' } },
					required: ['name'],
				},
			},
			invoke: async (args: any) => {
				const content = await this.skills.readSkill(String(args.name ?? ''));
				return content ?? `Error: no existe la skill "${String(args.name ?? '')}".`;
			},
		};
	}

	/** skill_save: el MODELO crea/actualiza skills (convenciones, recetas, soluciones difíciles). */
	private skillSaveTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'skill_save',
				description: 'Crea o actualiza una skill del proyecto (.openide/skills/<name>/SKILL.md). Guardá PROCEDIMIENTOS reutilizables: una convención descubierta, una configuración/receta que se repite, la solución a un problema difícil. La description debe decir qué hace y CUÁNDO usarla (con keywords) — es lo único que ve el índice. Preferí actualizar una skill existente antes que crear una parecida.',
				parameters: {
					type: 'object',
					properties: {
						name: { type: 'string', description: 'kebab-case, coincide con el directorio' },
						description: { type: 'string', description: 'Qué hace + cuándo usarla, una línea con keywords' },
						content: { type: 'string', description: 'Cuerpo markdown: instrucciones imperativas, pasos, ejemplos' },
					},
					required: ['name', 'description', 'content'],
				},
			},
			invoke: (args: any) => this.skills.saveSkill(String(args.name ?? ''), String(args.description ?? ''), String(args.content ?? '')),
		};
	}

	/** Rules son instrucciones duras, no memoria heurística. El loop bloquea esta tool salvo que
	 *  el último pedido del usuario haya solicitado explícitamente modificar reglas. */
	private ruleManageTool() {
		return {
			risk: 'write' as const,
			def: {
				name: 'rule_manage',
				description: 'Crea, actualiza o elimina una Rule Markdown siempre activa. Usala ÚNICAMENTE cuando el usuario pida explícitamente modificar sus reglas; nunca infieras permiso a partir de una preferencia casual.',
				parameters: {
					type: 'object',
					properties: {
						action: { type: 'string', enum: ['save', 'delete'] },
						scope: { type: 'string', enum: ['project', 'global'], description: 'project por default' },
						name: { type: 'string', description: 'Nombre kebab-case' },
						content: { type: 'string', description: 'Markdown completo; requerido para save' },
					},
					required: ['action', 'name'],
				},
			},
			approvalInfo: (args: any) => ({ title: args.action === 'delete' ? 'Eliminar Rule' : 'Guardar Rule', detail: `${args.scope === 'global' ? 'global' : 'project'}: ${String(args.name ?? '')}`, path: args.scope === 'global' ? undefined : `.openide/rules/${String(args.name ?? '')}.md` }),
			invoke: async (args: any) => {
				const scope: RuleScope = args.scope === 'global' ? 'global' : 'project';
				const name = String(args.name ?? '').trim();
				if (args.action === 'delete') {
					return await this.rules.delete(scope, name) ? `OK: regla ${scope} "${name}" eliminada.` : `Error: no existe la regla ${scope} "${name}".`;
				}
				return this.rules.save(scope, name, String(args.content ?? ''));
			},
		};
	}

	/** plan_save: EL CIERRE del modo plan — risk 'safe' (solo escribe su propio documento). */
	private planSaveTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'plan_save',
				description: 'Guarda el plan COMPLETO en .openide/plans/<slug>.md para que el usuario lo revise y lo apruebe. Es EL CIERRE del modo plan: llamala UNA sola vez, como último paso, con el markdown completo del plan (incluida la sección "## Tareas" con checkboxes al final). No la uses fuera del modo plan.',
				parameters: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'Título corto del plan (da nombre al archivo)' },
						markdown: { type: 'string', description: 'Plan completo en Markdown: # título, secciones y "## Tareas" al final' },
					},
					required: ['title', 'markdown'],
				},
			},
			invoke: (args: any) => this.savePlan(String(args.title ?? ''), String(args.markdown ?? '')),
		};
	}

	private canvasWriteTool() {
		return {
			risk: 'write' as const,
			def: {
				name: 'canvas_write',
				description: 'Crea o actualiza un Canvas real en .openide/canvases. Cargá primero la skill openide-canvas. Debe ser un único .canvas.tsx, importar solo openide/canvas, embeber sus datos y tener un default export.',
				parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nombre kebab-case' }, content: { type: 'string', description: 'Fuente TSX completa' }, auto_open: { type: 'boolean', description: 'Abrir al terminar' } }, required: ['name', 'content'] },
			},
			approvalInfo: (args: any) => ({ title: 'Escribir canvas', detail: String(args.name ?? ''), path: `.openide/canvases/${String(args.name ?? '')}` }),
			invoke: async (args: any) => {
				const out = await this.canvasService.write(String(args.name ?? ''), String(args.content ?? ''));
				if (args.auto_open) { await this.canvasService.open(out.path); }
				const uri = this.canvasService.resolve(out.path);
				return `OK: canvas ${out.created ? 'creado' : 'actualizado'} en ${out.path}.\nCanvas TypeScript check: no errors.\nLink absoluto: ${uri?.fsPath ?? out.path}`;
			},
		};
	}

	private canvasReadTool() {
		return { risk: 'safe' as const, def: { name: 'canvas_read', description: 'Lee el source actual de un canvas antes de un cambio incremental.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, invoke: (args: any) => this.canvasService.read(String(args.path ?? '')) };
	}

	private canvasListTool() {
		return { risk: 'safe' as const, def: { name: 'canvas_list', description: 'Lista los canvases del workspace.', parameters: { type: 'object', properties: {} } }, invoke: async () => { const items = await this.canvasService.list(); return items.length ? items.join('\n') : '(sin canvases)'; } };
	}

	private canvasOpenTool() {
		return { risk: 'safe' as const, def: { name: 'canvas_open', description: 'Abre un canvas en el editor visual al lado del chat.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, invoke: async (args: any) => { await this.canvasService.open(String(args.path ?? '')); return 'OK: canvas abierto.'; } };
	}

	private memoryGraphStatusTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_status', description: 'Estado de la memoria persistida del codebase: versión, frescura y cantidad de nodos/relaciones.', parameters: { type: 'object', properties: {} } }, invoke: async () => {
			const version = await this.codebaseMemory.getVersion();
			return JSON.stringify(version ? { ready: true, ...version } : { ready: false, version: 0, staleCount: 0, nodeCount: 0, edgeCount: 0 });
		} };
	}

	private memoryGraphSearchTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_search', description: 'Busca archivos, módulos y símbolos en la memoria híbrida del codebase. Devuelve procedencia, confianza y frescura.', parameters: { type: 'object', properties: { query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string' } }, languages: { type: 'array', items: { type: 'string' } }, pathPrefix: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.search(String(args.query ?? ''), { kinds: args.kinds, languages: args.languages, pathPrefix: args.pathPrefix, limit: Number(args.limit) || 50 })) };
	}

	private memoryGraphExploreTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_explore', description: 'Explora relaciones de un nodo bajo demanda. Las relaciones heurísticas se marcan con menor confianza.', parameters: { type: 'object', properties: { target: { type: 'string' }, direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] }, relationTypes: { type: 'array', items: { type: 'string' } }, depth: { type: 'number' }, limit: { type: 'number' } }, required: ['target'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.explore(String(args.target ?? ''), args.direction === 'incoming' || args.direction === 'outgoing' ? args.direction : 'both', args.relationTypes, Math.min(3, Math.max(1, Number(args.depth) || 1)), Number(args.limit) || 100)) };
	}

	private memoryGraphCallersTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_callers', description: 'Busca callers directos o transitivos de un símbolo.', parameters: { type: 'object', properties: { target: { type: 'string' }, transitive: { type: 'boolean' }, maxDepth: { type: 'number' }, limit: { type: 'number' } }, required: ['target'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.callers(String(args.target ?? ''), args.transitive === true, Number(args.maxDepth) || 2, Number(args.limit) || 100)) };
	}

	private memoryGraphCalleesTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_callees', description: 'Busca callees directos o transitivos de un símbolo.', parameters: { type: 'object', properties: { target: { type: 'string' }, transitive: { type: 'boolean' }, maxDepth: { type: 'number' }, limit: { type: 'number' } }, required: ['target'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.callees(String(args.target ?? ''), args.transitive === true, Number(args.maxDepth) || 2, Number(args.limit) || 100)) };
	}

	private memoryGraphImpactTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_impact', description: 'Analiza impacto directo/transitivo, dependencias y tests relacionados antes de modificar símbolos.', parameters: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, includeTests: { type: 'boolean' }, includeTransitive: { type: 'boolean' }, maxDepth: { type: 'number' } }, required: ['targets'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.impact(Array.isArray(args.targets) ? args.targets.map(String) : [], args.includeTests !== false, args.includeTransitive !== false, Number(args.maxDepth) || 2)) };
	}

	private memoryGraphPathTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_path', description: 'Busca un camino de relaciones entre dos entidades del codebase.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, relationTypes: { type: 'array', items: { type: 'string' } }, maxDepth: { type: 'number' } }, required: ['from', 'to'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.path(String(args.from ?? ''), String(args.to ?? ''), args.relationTypes, Number(args.maxDepth) || 5)) };
	}

	private memoryGraphRelatedTestsTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_related_tests', description: 'Encuentra tests relacionados con una o varias entidades.', parameters: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: ['targets'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.relatedTests(Array.isArray(args.targets) ? args.targets.map(String) : [], Number(args.limit) || 100)) };
	}

	/** codebase_search: ubica símbolos en el codebase por nombre (índice del language server). */
	private codebaseSearchTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_search',
				description: 'Búsqueda RÁPIDA de símbolos en el codebase por nombre (índice del language server, preciso). Solo ubicaciones + firma, sin código. Para código + relaciones usá codebase_explore.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Nombre (o parte) del símbolo a buscar' },
						kind: { type: 'string', description: 'Opcional: filtra por tipo (clase, función, método, interface…)' },
					},
					required: ['query'],
				},
			},
			invoke: async (args: any) => {
				const query = String(args.query ?? '').trim();
				if (!query) { return 'Error: query vacío.'; }
				const kind = String(args.kind ?? '').trim().toLowerCase();
				const memoryHits = await this.codebaseQuery.search(query, { kinds: kind ? [kind] : undefined, limit: 15 });
				let hits = await this.codebaseGraph.search(query, 15);
				if (kind) { hits = hits.filter(h => h.kindLabel.toLowerCase().includes(kind)); }
				const memoryLines = memoryHits.data.map(h => `${h.kind} ${h.name}${h.qualifiedName ? ` [${h.qualifiedName}]` : ''} — ${h.uri}:${h.range?.startLine ?? 1} (provider=${h.evidence.provider}, confianza=${Math.round(h.evidence.confidence * 100)}%)`);
				const languageLines = hits.map(h => `${h.kindLabel} ${h.name}${h.container ? ` [${h.container}]` : ''} — ${h.path}:${h.line} (language server)`);
				const out = [...memoryLines, ...languageLines].filter((line, index, all) => all.indexOf(line) === index);
				if (!out.length) { return 'Sin coincidencias en el índice — probá grep.'; }
				return out.join('\n');
			},
		};
	}

	/** codebase_explore: código verbatim de un símbolo + callers/callees, en una sola llamada. */
	private codebaseExploreTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_explore',
				description: 'Herramienta PRIMARIA de navegación — llamala PRIMERO ante casi cualquier pregunta del codebase y ANTES de editar. Busca el símbolo, devuelve su código VERBATIM actual + quién lo llama y a qué llama, en una sola llamada. Usala EN VEZ de cadenas grep/read_file. Tratá el código devuelto como YA LEÍDO.',
				parameters: {
					type: 'object',
					properties: { query: { type: 'string', description: 'Nombre del símbolo (función/clase/método) a explorar' } },
					required: ['query'],
				},
			},
			invoke: async (args: any) => {
				const query = String(args.query ?? '').trim();
				if (!query) { return 'Error: query vacío.'; }
				const memoryContext = await this.codebaseContext.select(query, { maxTokens: 6000, maxNodes: 30 }).catch(() => undefined);
				const { hits } = await this.codebaseGraph.symbolDetail(query);
				if (!hits.length && !memoryContext?.nodes.length) { return `Sin resultados en el índice para «${query}» — usá grep/read_file.`; }
				if (!hits.length && memoryContext?.text) { return memoryContext.text; }
				const blocks: string[] = [];
				// Prioridades del proyecto que matchean (scope por paths tocados / keywords del query).
				const priorities = await this.codebasePriorities.match(query, hits.map(h => h.path));
				const prioBlock = this.codebasePriorities.render(priorities);
				if (prioBlock) { blocks.push(prioBlock); }
				for (const h of hits) {
					const parts: string[] = [`== ${h.kindLabel} ${h.name} — ${h.path}:${h.line} ==`, h.source];
					const rel: string[] = [];
					for (const c of h.callees) { rel.push(`${h.name} —llama→ ${c.name} (${c.path}:${c.line})`); }
					for (const c of h.callers) { rel.push(`${c.name} —llama→ ${h.name} (${c.path}:${c.line})`); }
					if (rel.length) { parts.push('== Relaciones ==', rel.join('\n')); }
					blocks.push(parts.join('\n'));
				}
				blocks.push('Tratá el código mostrado como ya leído — NO re-abras estos archivos con read_file.');
				return blocks.join('\n\n');
			},
		};
	}

	/** codebase_callers: quién llama (o es llamado por) un símbolo — call hierarchy precisa. */
	private codebaseCallersTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_callers',
				description: 'Quién LLAMA (o es llamado por) un símbolo — call hierarchy precisa, para medir impacto antes de refactorizar.',
				parameters: {
					type: 'object',
					properties: {
						symbol: { type: 'string', description: 'Nombre del símbolo/función/método' },
						direction: { type: 'string', enum: ['callers', 'callees'], description: 'callers (quién lo llama, default) o callees (a qué llama)' },
					},
					required: ['symbol'],
				},
			},
			invoke: async (args: any) => {
				const symbol = String(args.symbol ?? '').trim();
				if (!symbol) { return 'Error: symbol vacío.'; }
				const direction = args.direction === 'callees' ? 'callees' as const : 'callers' as const;
				const { hits } = await this.codebaseGraph.callers(symbol, direction, 20);
				if (!hits.length) { return `Sin resultados en el índice para «${symbol}».`; }
				const lines: string[] = [];
				for (const h of hits) {
					lines.push(`${h.name} (${h.path}:${h.line})`);
					if (h.related.length) {
						for (const r of h.related) { lines.push(`  ${r.name} — ${r.path}:${r.line}`); }
					} else {
						lines.push('  (nadie en el índice)');
					}
				}
				return lines.join('\n');
			},
		};
	}

	/** codebase_save_priority: guarda una REGLA PERMANENTE del proyecto con scope. */
	private codebaseSavePriorityTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_save_priority',
				description: "Guardá una REGLA PERMANENTE del proyecto. Llamala PROACTIVAMENTE cuando el usuario exprese una convención o requisito duro ('es importante que siempre…', 'nunca uses…', 'de ahora en más…'). Scope: paths = fragmentos de ruta donde aplica (ej 'src/api'), keywords = temas (ej 'auth'). Se inyecta sola en respuestas futuras de codebase_explore cuando el scope matchea. Dejá scope VACÍO solo para reglas de todo el proyecto.",
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'La regla, en imperativo claro (ej "Siempre validá el input en la capa de API")' },
						level: { type: 'string', enum: ['critical', 'high', 'normal'], description: 'Importancia (default high)' },
						paths: { type: 'array', items: { type: 'string' }, description: 'Fragmentos de ruta donde aplica (ej "src/api"). Vacío = todo el proyecto.' },
						keywords: { type: 'array', items: { type: 'string' }, description: 'Temas donde aplica (ej "auth", "cache").' },
					},
					required: ['text'],
				},
			},
			invoke: async (args: any) => {
				const text = String(args.text ?? '').trim();
				if (!text) { return 'Error: text vacío.'; }
				const level = (args.level === 'critical' || args.level === 'normal') ? args.level : 'high';
				const paths = Array.isArray(args.paths) ? args.paths.map((s: any) => String(s)) : [];
				const keywords = Array.isArray(args.keywords) ? args.keywords.map((s: any) => String(s)) : [];
				const saved = await this.codebasePriorities.save({ text, level, paths, keywords });
				if (!saved) { return 'Error: no pude guardar la prioridad (¿hay carpeta abierta?).'; }
				const scopeParts = [...saved.scope.paths, ...saved.scope.keywords];
				const scope = scopeParts.length ? scopeParts.join(', ') : 'todo el proyecto';
				return `Prioridad guardada [${saved.level}], scope: ${scope}. Se va a inyectar en las respuestas de memoria cuando sea relevante.`;
			},
		};
	}

	/** Escribe el documento del plan (frontmatter + markdown), dispara la card de revisión del
	 *  chat (onDidCreatePlan) y abre el preview nativo de markdown al lado. */
	private async savePlan(title: string, markdown: string): Promise<string> {
		if (!title.trim()) {
			return 'Error: title vacío.';
		}
		if (!markdown.trim()) {
			return 'Error: markdown vacío.';
		}
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder) {
			return 'Error: no hay carpeta abierta (los planes viven en .openide/plans del workspace).';
		}
		// slug kebab del título (sin acentos); colisión ⇒ sufijo -2/-3/…
		const base = title.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'plan';
		let slug = base;
		for (let i = 2; await this.fileService.exists(joinPath(folder.uri, '.openide', 'plans', `${slug}.md`)); i++) {
			slug = `${base}-${i}`;
		}
		const uri = joinPath(folder.uri, '.openide', 'plans', `${slug}.md`);
		const model = this.getModel();
		const providerId = this.getActiveProviderId();
		const doc = `---\ntitle: ${title.trim().replace(/\n+/g, ' ')}\nstatus: borrador\nplanModel: ${model}\nexecProvider: ${providerId}\nexecModel: ${model}\ncreated: ${new Date().toISOString()}\n---\n\n${markdown.trim()}\n`;
		await this.fileService.writeFile(uri, VSBuffer.fromString(doc));
		const rel = `.openide/plans/${slug}.md`;
		this._onDidCreatePlan.fire({ path: rel, title: title.trim(), markdown });
		// editor de plan PROPIO (openidePlanEditor): markdown lindo + toolbar (modelo / Build) +
		// tareas interactivas — reemplaza el preview nativo. La card del chat queda en paralelo.
		this.commandService.executeCommand('openide.plan.open', uri).then(undefined, () => { /* el editor no cargó: la card alcanza */ });
		return `OK: plan guardado en ${rel}`;
	}

	/** Parser tolerante línea-a-línea del frontmatter de un plan (mismo criterio que las skills). */
	private parsePlanFrontmatter(content: string): { title?: string; status?: string; execModel?: string; execProvider?: string } {
		if (!content.startsWith('---')) {
			return {};
		}
		const end = content.indexOf('\n---', 3);
		if (end < 0) {
			return {};
		}
		const out: { title?: string; status?: string; execModel?: string; execProvider?: string } = {};
		for (const line of content.slice(3, end).split('\n')) {
			const m = line.match(/^(title|status|execModel|execProvider):\s*(.*?)\s*$/);
			if (m) {
				out[m[1] as 'title' | 'status' | 'execModel' | 'execProvider'] = m[2].replace(/^['"]|['"]$/g, '');
			}
		}
		return out;
	}

	startPlanBuild(resource: URI): string | undefined {
		const key = resource.toString();
		if (this.planBuildStates.has(key) || this.completedPlanBuilds.has(key)) { return undefined; }
		const owner = generateUuid();
		this.planBuildStates.set(key, owner);
		this._onDidChangePlanBuild.fire({ resource, busy: true });
		return owner;
	}

	finishPlanBuild(resource: URI, owner: string): void {
		const key = resource.toString();
		if (this.planBuildStates.get(key) !== owner) { return; }
		if (!this.planBuildStates.has(key)) { return; }
		// Mantener el último render en busy hasta persistir `status: completado`: así el breadcrumb
		// pasa directamente de spinner a Finalizado, sin un frame intermedio habilitado.
		void this.markPlanCompleted(resource).then(completedContent => {
			if (this.planBuildStates.get(key) !== owner) { return; }
			this.planBuildStates.delete(key);
			this.completedPlanBuilds.set(key, completedContent);
			this._onDidChangePlanBuild.fire({ resource, busy: false });
		}, () => this.failPlanBuild(resource, owner));
	}

	failPlanBuild(resource: URI, owner: string): void {
		const key = resource.toString();
		if (this.planBuildStates.get(key) !== owner) { return; }
		this.planBuildStates.delete(key);
		this.completedPlanBuilds.delete(key);
		this._onDidChangePlanBuild.fire({ resource, busy: false });
	}

	invalidatePlanBuild(resource: URI): void {
		const key = resource.toString();
		if (!this.completedPlanBuilds.delete(key)) { return; }
		this._onDidChangePlanBuild.fire({ resource, busy: false });
	}

	isPlanBuildRunning(resource: URI): boolean {
		return this.planBuildStates.has(resource.toString());
	}

	isPlanBuildCompleted(resource: URI): boolean {
		return this.completedPlanBuilds.has(resource.toString());
	}

	async reconcilePlanBuild(resource: URI, content: string): Promise<void> {
		const key = resource.toString();
		const completedContent = this.completedPlanBuilds.get(key);
		if (completedContent !== undefined) {
			if (completedContent !== content) {
				this.invalidatePlanBuild(resource);
				const modified = setPlanFrontmatterValue(content, 'status', 'modificado');
				if (modified !== content) { await this.fileService.writeFile(resource, VSBuffer.fromString(modified), { atomic: { postfix: '.openide-plan' } }); }
			}
			return;
		}
		// Restaurar el estado tras reiniciar OpenIDE. Desde este punto el contenido exacto es la
		// revisión completada; una modificación posterior lo invalida aunque conserve el frontmatter.
		if (this.parsePlanFrontmatter(content).status === 'completado') {
			this.completedPlanBuilds.set(key, content);
			this._onDidChangePlanBuild.fire({ resource, busy: false });
		}
	}

	private async markPlanCompleted(resource: URI): Promise<string> {
		const file = await this.fileService.readFile(resource);
		const content = file.value.toString();
		const updated = setPlanFrontmatterValue(content, 'status', 'completado');
		if (updated !== content) { await this.fileService.writeFile(resource, VSBuffer.fromString(updated), { etag: file.etag, mtime: file.mtime, atomic: { postfix: '.openide-plan' } }); }
		return updated;
	}

	setPlanFollowEnabled(enabled: boolean): void {
		this.planFollowEnabled = enabled;
		this._onDidChangePlanFollow.fire(enabled);
	}

	isPlanFollowEnabled(): boolean {
		return this.planFollowEnabled;
	}

	async getPlanExecutionModel(resource: URI): Promise<string> {
		return (await this.getPlanExecutionTarget(resource)).model;
	}

	async getPlanExecutionTarget(resource: URI): Promise<{ providerId?: string; model: string }> {
		try {
			const frontmatter = this.parsePlanFrontmatter((await this.fileService.readFile(resource)).value.toString());
			return { providerId: frontmatter.execProvider, model: frontmatter.execModel || '' };
		} catch { return { model: '' }; }
	}

	async setPlanExecutionModel(resource: URI, model: string, providerId = this.getActiveProviderId()): Promise<void> {
		const provider = this.findProvider(providerId);
		if (!provider || !(await this.isConnected(providerId))) { throw new Error(`Provider no conectado: ${providerId || '(sin provider)'}.`); }
		const models = await this.resolveProviderModels(provider);
		if (!model || !models.includes(model)) { throw new Error(`Modelo no disponible en ${provider.label}: ${model || '(vacío)'}.`); }
		const file = await this.fileService.readFile(resource);
		const content = file.value.toString();
		this.completedPlanBuilds.delete(resource.toString());
		const withModel = setPlanFrontmatterValue(content, 'execModel', model);
		const withProvider = setPlanFrontmatterValue(withModel, 'execProvider', providerId);
		await this.fileService.writeFile(resource, VSBuffer.fromString(setPlanFrontmatterValue(withProvider, 'status', 'modificado')), { etag: file.etag, mtime: file.mtime, atomic: { postfix: '.openide-plan' } });
		this._onDidChangePlanBuild.fire({ resource, busy: this.isPlanBuildRunning(resource) });
	}

	async updatePlanTasks(resource: URI, tasks: readonly { text?: unknown; done?: unknown }[]): Promise<void> {
		const file = await this.fileService.readFile(resource);
		const content = file.value.toString();
		const clean = tasks.slice(0, 100)
			.filter(task => task && typeof task === 'object')
			.map(task => ({ text: String(task.text ?? '').trim().slice(0, 2000), done: task.done === true }))
			.filter(task => task.text.length > 0);
		const taskLines = clean.map(task => `- [${task.done ? 'x' : ' '}] ${task.text}`);
		const lines = content.split('\n');
		let headingIdx = lines.findIndex(line => /^##\s+(Tareas|Tasks|To-?dos?)\b/i.test(line));
		let next: string;
		if (headingIdx < 0) {
			const tail = content.endsWith('\n') ? '' : '\n';
			next = content + `${tail}\n## Tareas\n\n${taskLines.join('\n')}\n`;
		} else {
			let endIdx = lines.length;
			for (let i = headingIdx + 1; i < lines.length; i++) { if (/^#{1,6}\s/.test(lines[i])) { endIdx = i; break; } }
			next = [...lines.slice(0, headingIdx + 1), ...(taskLines.length ? ['', ...taskLines, ''] : ['']), ...lines.slice(endIdx)].join('\n');
		}
		if (next !== content) {
			next = setPlanFrontmatterValue(next, 'status', 'modificado');
			await this.fileService.writeFile(resource, VSBuffer.fromString(next), { etag: file.etag, mtime: file.mtime, atomic: { postfix: '.openide-plan' } });
			this.completedPlanBuilds.delete(resource.toString());
			this._onDidChangePlanBuild.fire({ resource, busy: false });
		}
	}

	async buildPlan(resource: URI): Promise<void> {
		const folder = this.contextService.getWorkspace().folders[0];
		const plansRoot = folder ? joinPath(folder.uri, '.openide', 'plans') : undefined;
		if (!folder || !plansRoot || resource.scheme !== plansRoot.scheme || resource.authority !== plansRoot.authority || !resource.path.startsWith(`${plansRoot.path}/`) || !resource.path.endsWith('.md')) { throw new Error('Build sólo admite planes bajo .openide/plans/*.md.'); }
		const owner = this.startPlanBuild(resource);
		if (!owner) { return; }
		try {
			const content = (await this.fileService.readFile(resource)).value.toString();
			const fm = this.parsePlanFrontmatter(content);
			const providerId = fm.execProvider || this.getActiveProviderId();
			const provider = this.findProvider(providerId);
			if (!provider || !(await this.isConnected(provider.id))) { throw new Error(`El provider del plan ya no está conectado: ${providerId || '(sin provider)'}.`); }
			const knownModels = await this.resolveProviderModels(provider);
			const model = fm.execModel || provider.defaultModel || '';
			if (!model || knownModels.length && !knownModels.includes(model)) { throw new Error(`El modelo del plan no está disponible en ${provider.label}: ${model || '(sin modelo)'}.`); }
			// No mutar provider/model global: el target viaja capturado al turno hidden.
			// Releer después de las validaciones/awaits para no pisar cambios concurrentes del plan.
			const latestFile = await this.fileService.readFile(resource);
			const latest = latestFile.value.toString();
			const latestFm = this.parsePlanFrontmatter(latest);
			if ((latestFm.execProvider || this.getActiveProviderId()) !== provider.id || (latestFm.execModel || provider.defaultModel || '') !== model) { throw new Error('El target del plan cambió mientras se preparaba el Build; volvé a ejecutarlo.'); }
			const updated = setPlanFrontmatterValue(latest, 'status', 'aprobado');
			if (updated !== latest) { await this.fileService.writeFile(resource, VSBuffer.fromString(updated), { etag: latestFile.etag, mtime: latestFile.mtime, atomic: { postfix: '.openide-plan' } }); }
			const rel = relativePath(folder.uri, resource) ?? resource.path;
			this._onDidRequestPlanBuild.fire({ path: rel, title: fm.title || basename(resource).replace(/\.md$/, ''), resource, owner, providerId: provider.id, model });
		} catch (error) {
			this.failPlanBuild(resource, owner);
			throw error;
		}
	}

	/** git_status: estado del repo + política del workflow. */
	private gitStatusTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'git_status',
				description: 'Estado del repo git y siguiente paso del workflow. Llamala al terminar una tarea con ediciones antes de revisar y proponer un commit.',
				parameters: { type: 'object', properties: {} },
			},
			invoke: (_args: any, token: CancellationToken) => this.gitFlow.describeStatus(token),
		};
	}

	/** git_preflight: valida alcance, índice, secretos, identidad y revisión vigente sin modificar git. */
	private gitPreflightTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'git_preflight',
				description: 'Valida sin modificar git que un commit es seguro: archivos explícitos, índice limpio, secretos, identidad, whitespace y revisión vigente. Ejecutala inmediatamente antes de git_commit.',
				parameters: {
					type: 'object',
					properties: {
						message: { type: 'string', description: 'Mensaje del commit (una línea; Conventional Commits si la config lo pide)' },
						body: { type: 'string', description: 'Cuerpo opcional del commit' },
						files: { type: 'array', items: { type: 'string' }, description: 'Paths explícitos a incluir; nunca se agregan todos los cambios' },
						new_branch: { type: 'string', description: 'Crear y commitear en esta rama nueva (opcional)' },
					},
					required: ['message', 'files'],
				},
			},
			invoke: (args: any, token: CancellationToken) => {
				const proposal: IGitProposal = {
					message: String(args.message ?? '').trim(),
					body: typeof args.body === 'string' && args.body.trim() ? args.body.trim() : undefined,
					files: Array.isArray(args.files) ? args.files.map(String) : [],
					newBranch: typeof args.new_branch === 'string' && args.new_branch.trim() ? args.new_branch.trim() : undefined,
				};
				return this.gitFlow.preflight(proposal, token).then(result => result.message);
			},
		};
	}

	/** git_commit: commit atómico ya aprobado; nunca fuerza push ni usa git add -A. */
	private gitCommitTool() {
		return {
			risk: 'exec' as const,
			def: {
				name: 'git_commit',
				description: 'Propone y ejecuta un commit git atómico con archivos explícitos. Requiere una revisión vigente (review_changes), preflight correcto y confirmación del usuario. Nunca hace push automático ni mezcla staging ajeno.',
				parameters: {
					type: 'object',
					properties: {
						message: { type: 'string', description: 'Mensaje del commit (una línea; Conventional Commits si la config lo pide)' },
						body: { type: 'string', description: 'Cuerpo opcional del commit' },
						files: { type: 'array', items: { type: 'string' }, description: 'Paths explícitos a incluir' },
						new_branch: { type: 'string', description: 'Crear la rama nueva antes del commit (opcional)' },
					},
					required: ['message', 'files'],
				},
			},
			approvalInfo: (args: any) => ({
				title: 'Commit Git',
				detail: `${String(args.message ?? '')}${args.new_branch ? ` — rama nueva ${args.new_branch}` : ''} — ${Array.isArray(args.files) ? `${args.files.length} archivo(s)` : 'sin archivos'}. Sin push automático.`,
				command: 'git add -- <archivos> && git commit',
			}),
			invoke: (args: any, token: CancellationToken) => this.gitFlow.execute({
				message: String(args.message ?? '').trim(),
				body: typeof args.body === 'string' && args.body.trim() ? args.body.trim() : undefined,
				files: Array.isArray(args.files) ? args.files.map(String) : [],
				newBranch: typeof args.new_branch === 'string' && args.new_branch.trim() ? args.new_branch.trim() : undefined,
			}, token),
		};
	}

	/** Alias de transición para conversaciones y skills ya existentes. */
	private gitCheckpointAliasTool() {
		const commitTool = this.gitCommitTool();
		return {
			...commitTool,
			def: {
				...commitTool.def,
				name: 'git_checkpoint',
				description: 'Alias obsoleto de git_commit. Usa git_commit en nuevos flujos. Mantiene las mismas protecciones: archivos explícitos, revisión y sin push automático.',
			},
			invoke: (args: any, token: CancellationToken) => {
				if (args.push) {
					return Promise.resolve('Error: git_checkpoint ya no admite push. Ejecutá git push manualmente después de revisar el commit.');
				}
				return commitTool.invoke(args, token);
			},
		};
	}

	/** workflow_configure: reglas y umbrales persistidos en .openide/workflow.json. */
	private workflowConfigureTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'workflow_configure',
				description: 'Configura el workflow de commits y revisión cuando el usuario exprese preferencias: umbrales, Conventional Commits, revisión requerida y reglas en lenguaje natural. Guarda en .openide/workflow.json.',
				parameters: {
					type: 'object',
					properties: {
						max_changed_lines: { type: 'number', description: 'Umbral de líneas cambiadas para recomendar checkpoint' },
						max_unpushed_commits: { type: 'number', description: 'Umbral de commits sin pushear' },
						conventional_commits: { type: 'boolean' },
						require_review: { type: 'boolean', description: 'Exigir review_changes antes de git_commit (por defecto: true)' },
						agent_reviewers: { type: 'number', description: 'Revisores en modo Agent (1 o 2)' },
						ultra_reviewers: { type: 'number', description: 'Revisores en modo Ultracode (2 a 4)' },
						add_rule: { type: 'string', description: 'Regla nueva en lenguaje natural' },
						remove_rule: { type: 'string', description: 'Fragmento de la regla a borrar' },
					},
				},
			},
			invoke: async (args: any) => {
				const cfg = await this.gitFlow.readConfig();
				if (typeof args.max_changed_lines === 'number' && args.max_changed_lines > 0) { cfg.maxChangedLines = Math.round(args.max_changed_lines); }
				if (typeof args.max_unpushed_commits === 'number' && args.max_unpushed_commits > 0) { cfg.maxUnpushedCommits = Math.round(args.max_unpushed_commits); }
				if (typeof args.conventional_commits === 'boolean') { cfg.conventionalCommits = args.conventional_commits; }
				if (typeof args.require_review === 'boolean') { cfg.requireReview = args.require_review; }
				if (typeof args.agent_reviewers === 'number') { cfg.agentReviewers = Math.min(2, Math.max(1, Math.round(args.agent_reviewers))); }
				if (typeof args.ultra_reviewers === 'number') { cfg.ultraReviewers = Math.min(4, Math.max(2, Math.round(args.ultra_reviewers))); }
				if (typeof args.add_rule === 'string' && args.add_rule.trim()) { cfg.rules.push(args.add_rule.trim()); }
				if (typeof args.remove_rule === 'string' && args.remove_rule.trim()) {
					cfg.rules = cfg.rules.filter(r => !r.toLowerCase().includes(args.remove_rule.trim().toLowerCase()));
				}
				return this.gitFlow.writeConfig(cfg);
			},
		};
	}

	/** Compatibilidad para skills existentes; los nuevos flujos usan workflow_configure. */
	private gitConfigureAliasTool() {
		const workflowTool = this.workflowConfigureTool();
		return {
			...workflowTool,
			def: {
				...workflowTool.def,
				name: 'git_configure',
				description: 'Alias obsoleto de workflow_configure. Guarda la configuración en .openide/workflow.json.',
			},
		};
	}

	/** browser_open: abre una app LOCAL en la vista previa integrada (browser liviano). */
	private browserOpenTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'browser_open',
				description: 'Abre una URL LOCAL (localhost/127.0.0.1/*.localhost) en la vista previa integrada del IDE, para que el usuario VEA su app corriendo. Solo apps locales de desarrollo — no navega la web. Útil después de levantar un dev server con run_command background.',
				parameters: {
					type: 'object',
					properties: { url: { type: 'string', description: 'URL local (ej: http://localhost:5173) o solo el puerto (ej: 5173)' } },
					required: ['url'],
				},
			},
			invoke: async (args: any) => {
				const extraHosts = this.configurationService.getValue<string[]>('openide.agent.browserAllowedHosts');
				const url = normalizeLocalUrl(String(args.url ?? ''), Array.isArray(extraHosts) ? extraHosts : []);
				if (!url) {
					return 'Error: URL no permitida — la vista previa es solo para apps locales (localhost, 127.0.0.1, *.localhost o la allowlist del usuario).';
				}
				await this.commandService.executeCommand('openide.browser.open', url);
				return `OK: ${url} abierta en la vista previa del IDE.`;
			},
		};
	}

	// ---- Pick & Polish ----

	/** Picker visual DENTRO de la vista previa nativa del IDE: inyecta el overlay en el iframe
	 *  de la preview (main process → webFrameMain). Si no hay preview de ese origin abierta, la
	 *  abre y espera al iframe. El resultado va por onDidPickElement. */
	async pickElement(url: string): Promise<boolean> {
		const extraHosts = this.browserAutomation.extraHosts();
		const target = normalizeLocalUrl(url, extraHosts);
		if (!target) {
			throw new Error('URL no permitida: el picker es solo para apps locales (localhost, 127.0.0.1, *.localhost o la allowlist).');
		}
		let r = await this.browserAutomation.automation.pickInPage(target, extraHosts, 1500);
		if (!r.ok && 'noFrame' in r && r.noFrame) {
			// no hay preview abierta de ese origin → abrirla y esperar a que cargue el iframe
			await this.commandService.executeCommand('openide.browser.open', target);
			r = await this.browserAutomation.automation.pickInPage(target, extraHosts, 15_000);
		}
		if (!r.ok && 'noFrame' in r && r.noFrame) {
			throw new Error('La vista previa no cargó (¿el server local está corriendo?).');
		}
		if (r.ok) {
			this._onDidPickElement.fire(r.result);
			return true;
		}
		if ('cancelled' in r && r.cancelled) {
			return false;
		}
		throw new Error(('error' in r && r.error) || 'El picker falló.');
	}

	// ---- Dictado por voz ----

	/** Modelos multimodales (openai-compat, aceptan input_audio en chat/completions) que sirven
	 *  de transcriptor, en orden de preferencia. Se usa el primero con el provider conectado,
	 *  salvo override con el setting openide.agent.voiceModel ("provider/modelo"). */
	private static readonly VOICE_CANDIDATES: ReadonlyArray<{ provider: string; model: string }> = [
		{ provider: 'gemini', model: 'gemini-3.5-flash' },
		{ provider: 'openai', model: 'gpt-audio-mini' },
		{ provider: 'dashscope', model: 'qwen3-omni-flash' },
	];

	async transcribeAudio(wavBase64: string): Promise<string> {
		const override = String(this.configurationService.getValue('openide.agent.voiceModel') ?? '').trim();
		let pick: { entry: IProviderEntry; model: string } | undefined;
		if (override) {
			const slash = override.indexOf('/');
			if (slash <= 0) {
				throw new Error(`openide.agent.voiceModel debe tener formato "provider/modelo" (ej: google/gemini-3.5-flash); vino "${override}".`);
			}
			const entry = this.findProvider(override.slice(0, slash));
			if (!entry) {
				throw new Error(`openide.agent.voiceModel: proveedor desconocido en "${override}".`);
			}
			pick = { entry, model: override.slice(slash + 1) };
		} else {
			for (const c of OpenideAgentService.VOICE_CANDIDATES) {
				const entry = this.findProvider(c.provider);
				if (entry && await this.isConnected(c.provider)) {
					pick = { entry, model: c.model };
					break;
				}
			}
		}
		if (!pick) {
			throw new Error('El dictado necesita un proveedor multimodal conectado (Gemini, OpenAI API key o Qwen/DashScope). Conectá uno en "Proveedores de IA" o fijá openide.agent.voiceModel ("provider/modelo").');
		}
		const credential = await this.auth.resolveCredential(pick.entry);
		const base = (pick.entry.baseUrl || '').replace(/\/+$/, '');
		const body = {
			model: pick.model,
			temperature: 0,
			messages: [{
				role: 'user',
				content: [
					{ type: 'text', text: 'Transcribí el audio EXACTAMENTE como se dijo, en su mismo idioma. Devolvé SOLO la transcripción, sin comillas ni comentarios.' },
					{ type: 'input_audio', input_audio: { data: wavBase64, format: 'wav' } },
				],
			}],
		};
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		const authToken = credential.kind === 'apiKey' ? credential.value : credential.token;
		if (authToken) {
			headers['Authorization'] = `Bearer ${authToken}`;
		}
		Object.assign(headers, pick.entry.extraHeaders ?? {});
		const ctx = await this.netRequests.request({
			type: 'POST',
			url: `${base}/chat/completions`,
			data: JSON.stringify(body),
			headers,
			callSite: 'openideAgentVoice',
		}, CancellationToken.None);
		const text = (await asText(ctx)) ?? '';
		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			throw new Error(`La transcripción falló (HTTP ${status}): ${text.slice(0, 400)}`);
		}
		const out = JSON.parse(text)?.choices?.[0]?.message?.content;
		const result = typeof out === 'string' ? out.trim() : '';
		if (!result) {
			throw new Error('El modelo no devolvió transcripción.');
		}
		return result;
	}

	// ---- límites de contexto / modelo activo ----

	private activeModel(entry?: IProviderEntry): string {
		const e = entry ?? findProvider(this.customProviders(), this.getActiveProviderId());
		return this.modelForProvider(e?.id ?? this.getActiveProviderId()) || e?.defaultModel || '';
	}

	private resolveContextLimit(model: string): number {
		const cfg = this.configurationService.getValue<number>('openide.agent.contextTokens');
		if (typeof cfg === 'number' && cfg > 0) {
			return cfg;
		}
		return this.catalog.contextLimitFor(model);
	}

	getContextLimit(): number {
		return this.resolveContextLimit(this.activeModel());
	}

	/** Tope de tokens de salida: config (capada al límite del modelo) o límite del catálogo,
	 *  recortado al tope duro del ENDPOINT si la entrada del provider define uno (outputCap). */
	private resolveMaxTokens(model: string, entry?: IProviderEntry): number | undefined {
		const cfg = this.configurationService.getValue<number>('openide.agent.maxOutputTokens');
		const catalogLimit = this.catalog.lookup(model).outputLimit;
		let limit = (typeof cfg === 'number' && cfg > 0)
			? (catalogLimit ? Math.min(cfg, catalogLimit) : cfg)
			: catalogLimit;
		if (entry?.outputCap) {
			limit = limit ? Math.min(limit, entry.outputCap) : entry.outputCap;
		}
		return limit;
	}

	// ---- system prompt dinámico ----
	private rulesEditExplicitlyRequested(messages: IChatMessage[]): boolean {
		const lastUser = [...messages].reverse().find(message => message.role === 'user');
		const text = String(lastUser?.displayText ?? lastUser?.content ?? '');
		const mentionsRules = /(?:\breglas?\b|\brules?\b|\.openide[\\/]rules)/i.test(text);
		const requestsMutation = /(?:\b(?:modific|edit|actualiz|cambi|cre|agreg|a(?:ñ|n)ad|elimin|borr|reescrib|guard|write|update|change|create|add|delete|remove)\w*\b)/i.test(text);
		return mentionsRules && requestsMutation;
	}

	private isRulesMutation(toolName: string, args: any): boolean {
		if (toolName === 'rule_manage') {
			return true;
		}
		if (toolName === 'write_file' || toolName === 'edit_file') {
			return /(?:^|[\\/])\.openide[\\/]rules[\\/]/i.test(String(args?.path ?? ''));
		}
		if (toolName === 'run_command') {
			return /(?:\.openide[\\/]rules|openideAgent[\\/]rules)/i.test(String(args?.command ?? ''));
		}
		return false;
	}

	private buildSystemPrompt(mode: AgentMode, memory?: IAgentMemorySnapshot, skillsBlock?: string, rulesBlock?: string): string {
		const folder = this.contextService.getWorkspace().folders[0];
		const os = isWindows ? 'Windows' : isMacintosh ? 'macOS' : 'Linux';
		const env = [
			`- SO: ${os}`,
			folder ? `- Workspace: ${folder.name} (${folder.uri.fsPath})` : '- Workspace: (sin carpeta abierta)',
			`- Fecha: ${new Date().toISOString().slice(0, 10)}`,
		].join('\n');
		let out = SYSTEM_PROMPT + '\n\nContexto del entorno:\n' + env;
		const registeredSubagents = this.subagentRegistry.list();
		if (registeredSubagents.length) {
			out += '\n\nSUBAGENTES REGISTRADOS (usá exclusivamente estos nombres con delegate_to_subagent):\n' + registeredSubagents.map(agent => `- ${agent.name}: ${agent.description}`).join('\n');
		}
		out += '\n\nNavegación del codebase (índice preciso del language server): codebase_explore es tu herramienta PRIMARIA — llamala PRIMERO ante casi cualquier pregunta del codebase y ANTES de editar (te da el código verbatim + callers/callees, tratalo como ya leído, EN VEZ de cadenas grep/read_file). codebase_search para ubicar rápido por nombre; codebase_callers para medir impacto antes de refactorizar. Cuando el usuario exprese una convención o regla dura del proyecto ("siempre…", "nunca…", "de ahora en más…"), guardala con codebase_save_priority.';
		// Memoria agéntica (snapshot congelado al inicio del run — las escrituras mid-run van a
		// disco pero el prompt no cambia hasta el próximo turno; preserva el prefix cache).
		if (memory?.project) {
			out += '\n\nMEMORIA DEL PROYECTO (tus notas persistentes de este repo — actualizala con la tool memory):\n' + memory.project;
		}
		if (memory?.user) {
			out += '\n\nSOBRE EL USUARIO (preferencias estables — actualizalas con la tool memory):\n' + memory.user;
		}
		if (skillsBlock) {
			out += skillsBlock;
		}
		if (rulesBlock) {
			out += rulesBlock;
		}
		// Triaje de complejidad: SIEMPRE presente. Enseña al modelo a evaluar el tamaño/forma del
		// pedido y recomendar el modo adecuado (plan/ultra/fork) vía suggest_mode, en vez de
		// arrancar a ciegas. La tool solo se expone en agent/ask (ver toolDefs).
		out += '\n\nTRIAJE DE COMPLEJIDAD (elegí el modo correcto ANTES de arrancar): al recibir un pedido, evaluá su tamaño y forma antes de tocar nada. Si estás en modo Agente o Preguntar y el pedido encaja en uno de estos patrones, en vez de arrancar a ciegas llamá a la tool suggest_mode para RECOMENDARLE al usuario el modo adecuado (muestra una tarjeta que, si acepta, reenvía el pedido en ese modo — vos no cambiás el modo solo):\n'
			+ '- MODO PLAN — tarea grande y multi-paso donde conviene acordar el ENFOQUE antes de escribir código: toca más de ~4 archivos, o son más de ~6 subtareas secuenciales, o cambia arquitectura / contratos públicos / migraciones / esquema de datos, o el usuario pide explícitamente «planificá» / «diseñá» / «cómo lo encararías». El entregable primero es un plan revisable, no el código.\n'
			+ '- MODO ULTRACODE — para resolver hay que ENTENDER en paralelo varias partes INDEPENDIENTES del código antes de editar: 2 o más áreas/módulos sin dependencia entre sí que se investigan por separado, auditorías tipo «dónde se usa X en todo el repo», comparar subsistemas, o mapear un flujo que cruza muchos archivos.\n'
			+ '- FORK (rama nueva) — hay 2 o más enfoques VÁLIDOS y DIVERGENTES y conviene explorarlos por separado sin perder el hilo actual, o el usuario quiere probar algo arriesgado conservando el estado. El fork hereda todo el contexto en una tab nueva.\n'
			+ '- QUEDATE EN AGENTE — para lo simple y acotado: 1 a 3 archivos, camino claro, un bug puntual, un refactor local, o responder algo del código. NO sugieras cambiar de modo para tareas triviales ni interrumpas un pedido claro y chico: sugerí SOLO cuando aporta valor real, como MÁXIMO una vez por pedido y al principio. Si el usuario ya eligió un modo a propósito, respetalo.\n'
			+ 'Regla de oro: ante la duda, si el pedido es claro y chico avanzá; si es grande, ambiguo en el enfoque, paralelizable o divergente, sugerí el modo con suggest_mode y cerrá el turno con una frase breve. En modo Ultracode NO uses suggest_mode: ya podés descomponer y delegar directamente con delegate_task.';
		return out + MODE_PROMPTS[mode];
	}

	// ---- usage enriquecido para la UI ----

	private enrichUsage(
		ev: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number },
		system: string,
		toolDefs: IToolDefinition[],
		messages: IChatMessage[],
		contextLimit: number,
		memoryText = '',
		skillsText = '',
	): AgentLoopEvent {
		const reported = (ev.inputTokens ?? 0) + (ev.cacheReadTokens ?? 0) + (ev.cacheCreationTokens ?? 0) + (ev.outputTokens ?? 0);
		const breakdown = computeContextBreakdown(system, memoryText, skillsText, toolDefs, messages, reported > 0 ? reported : undefined);
		return {
			type: 'usage',
			inputTokens: ev.inputTokens,
			outputTokens: ev.outputTokens,
			cacheReadTokens: ev.cacheReadTokens,
			cacheCreationTokens: ev.cacheCreationTokens,
			contextUsed: breakdownTotal(breakdown),
			contextLimit,
			breakdown,
		};
	}

	// ---- streaming con reintentos ----

	private streamAttemptWithStaleTimeout(
		adapter: ILLMProvider,
		request: IProviderRequest,
		onStream: (e: AgentStreamEvent) => void,
		token: CancellationToken,
	): Promise<IProviderResult> {
		const configured = this.configurationService.getValue<number>('openide.agent.streamStaleTimeoutSeconds');
		const seconds = resolveStreamStaleTimeoutSeconds(request.model, configured, request.effort);
		if (seconds <= 0) {
			return adapter.streamChat(request, onStream, token);
		}

		const attemptCts = new CancellationTokenSource(token);
		return new Promise<IProviderResult>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let cancelSub: IDisposable | undefined;
			const cleanup = () => {
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				cancelSub?.dispose();
				attemptCts.dispose();
			};
			const succeed = (result: IProviderResult) => {
				if (settled) { return; }
				settled = true;
				cleanup();
				resolve(result);
			};
			const fail = (error: unknown) => {
				if (settled) { return; }
				settled = true;
				cleanup();
				reject(error);
			};
			const arm = () => {
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				timer = setTimeout(() => {
					if (settled) { return; }
					settled = true;
					attemptCts.cancel();
					cleanup();
					reject(new Error(`Stream stale timeout: el provider no emitió eventos durante ${seconds}s (${request.model}).`));
				}, seconds * 1000);
			};
			cancelSub = token.onCancellationRequested(() => fail(new Error('Canceled')));
			if (settled) {
				return;
			}
			arm();
			void adapter.streamChat(request, event => {
				if (settled) { return; }
				arm();
				onStream(event);
			}, attemptCts.token).then(succeed, fail);
		});
	}

	/**
	 * Llama a streamChat reintentando errores transitorios (red, 429, 5xx) con backoff
	 * exponencial + jitter. Solo reintenta si el intento fallido NO llegó a emitir contenido
	 * (para no duplicar texto ya mostrado).
	 */
	private async streamWithRetry(
		adapter: ILLMProvider,
		request: IProviderRequest,
		onStream: (e: AgentStreamEvent) => void,
		token: CancellationToken,
		onEvent: (e: AgentLoopEvent) => void,
	): Promise<IProviderResult> {
		for (let attempt = 1; ; attempt++) {
			let emitted = false;
			try {
				return await this.streamAttemptWithStaleTimeout(adapter, request, ev => {
					if (ev.type === 'text' || ev.type === 'reasoning' || ev.type === 'toolCall') {
						emitted = true;
					}
					onStream(ev);
				}, token);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const cls = classifyProviderError(msg);
				const transient = cls.kind === 'transient' || cls.kind === 'rate-limit';
				if (emitted || !transient || attempt >= MAX_STREAM_ATTEMPTS || token.isCancellationRequested) {
					throw e;
				}
				// rate-limit con espera sugerida por el provider gana sobre el backoff exponencial
				const delay = cls.retryAfterMs ?? (Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 300));
				onEvent({ type: 'retry', kind: cls.kind === 'rate-limit' ? 'rate-limit' : 'transient', attempt: attempt + 1, max: MAX_STREAM_ATTEMPTS, delayMs: delay });
				await raceCancellation(timeout(delay), token);
				if (token.isCancellationRequested) {
					throw e;
				}
			}
		}
	}

	runAgent(prompt: string, onEvent: (e: AgentLoopEvent) => void, token: CancellationToken = CancellationToken.None): Promise<void> {
		return this.runMessages([{ role: 'user', content: prompt }], onEvent, token);
	}

	runMessages(messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, token: CancellationToken = CancellationToken.None, options?: IAgentRunOptions): Promise<void> {
		return this.runSequencer.queue(async () => {
			if (!token.isCancellationRequested) {
				await this.runMessagesInternal(messages, onEvent, token, options);
			}
		});
	}

	compactConversation(messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, token: CancellationToken = CancellationToken.None): Promise<void> {
		return this.runMessages(messages, onEvent, token, { compactOnly: true });
	}

	private async runMessagesInternal(messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, token: CancellationToken, options?: IAgentRunOptions): Promise<void> {
		// Failover: si el provider falla en seco (auth/billing/rate-limit) ANTES de emitir
		// contenido, se reintenta con el siguiente de openide.agent.fallbackProviders.
		const providerId = options?.providerOverride ?? this.getActiveProviderId();
		const rawOnEvent = onEvent;
		let emittedContent = false;
		onEvent = ev => {
			if (ev.type === 'text' || ev.type === 'reasoning' || ev.type === 'toolStart' || ev.type === 'subagentStart') {
				emittedContent = true;
			}
			rawOnEvent(ev);
		};
		// Mientras corre, reenviamos cada edición de archivo (write/edit) como un diff (+N/−N) al chat.
		// added/removed = ACUMULADO contra el baseline (para la bandeja); editAdded/editRemoved y
		// diffLines = SOLO esta edición (para la card inline del transcript).
		// Diff de la última edición del call en curso: se persiste junto al tool result para
		// reconstruir la edit card estilizada al restaurar la sesión (Ctrl+R). Cap más agresivo
		// que la card en vivo (el storage del workspace no debe inflarse con diffs enormes).
		let lastEditDiff: IPersistedFileDiff | undefined;
		const ownerMessageId = options?.messageId;
		const ownsChangeSet = !!ownerMessageId && !this.messageChanges.hasOpen(ownerMessageId);
		if (ownerMessageId) {
			this.messageChanges.begin(ownerMessageId);
			if (ownsChangeSet) {
				const openSet = this.messageChanges.snapshot(ownerMessageId);
				if (openSet) { onEvent({ type: 'messageChangeSet', changeSet: openSet }); }
			}
		}
		const editSub = this.tools.onDidEdit(e => {
			if (!ownsChangeSet || !ownerMessageId || e.messageId !== ownerMessageId) { return; }
			this.messageChanges.record(ownerMessageId, e);
			const openSet = this.messageChanges.snapshot(ownerMessageId);
			if (openSet) { onEvent({ type: 'messageChangeSet', changeSet: openSet }); }
			const oldContent = e.beforeContent ?? '';
			const newContent = e.afterContent ?? '';
			const createdByOperation = e.operation === 'create';
			this.diffSnapshot.setBaselineOnce(e.path, oldContent, !createdByOperation);
			// si el archivo ya está abierto en Monaco, mostrar el diff del review AL TOQUE (sin
			// tener que clickear la card del chat).
			this.editReview.attachIfOpen(e.path);
			const baseline = this.diffSnapshot.getBaseline(e.path) ?? oldContent;
			const { added, removed } = countDiff(baseline, newContent);
			this.diffSnapshot.markPending(e.path, added + removed > 0, added, removed);
			const per = countDiff(oldContent, newContent);
			const created = this.diffSnapshot.getSnapshot(e.path)?.existed === false;
			const diffLines = buildDiffPreview(oldContent, newContent);
			const editRange = changedLineRange(oldContent, newContent);
			onEvent({
				type: 'agentLocation',
				location: {
					kind: 'file', path: e.path,
					line: editRange.startLine, endLine: editRange.endLine,
					activity: created ? 'create' : 'edit', review: true,
				},
			});
			onEvent({
				type: 'fileDiff', path: e.path, added, removed,
				created, editAdded: per.added, editRemoved: per.removed, diffLines,
			});
			lastEditDiff = { path: e.path, created, editAdded: per.added, editRemoved: per.removed, diffLines: diffLines.slice(0, 60) };
		});
		try {
			if (!providerId) {
				onEvent({ type: 'error', message: 'No tenés ningún proveedor de IA conectado. Conectá una cuenta (OAuth) o pegá una API key para empezar.', action: 'connect' });
				return;
			}
			const entry = findProvider(this.customProviders(), providerId);
			if (!entry) {
				onEvent({ type: 'error', message: `Provider desconocido: "${providerId}".`, action: 'connect' });
				return;
			}
			const adapter = this.protocols.get(entry.protocol);
			if (!adapter) {
				onEvent({ type: 'error', message: `Protocolo no soportado: "${entry.protocol}".` });
				return;
			}

			// Falla de credencial → va al catch de abajo, que decide failover o reporte.
			const credential: ICredential = await this.auth.resolveCredential(entry);

			this.catalog.ensureFresh(); // refresco lazy del catálogo de modelos (no bloquea)
			// Tools MCP: el primer run conecta los servers (espera acotada); después es no-op —
			// getDefinitions() lee el registry vivo, así que lo conectado entra a ESTE turno.
			await this.mcp.ensureStarted();

			// Hooks sessionStart (observador, fire-and-forget): UNA vez por conversación —
			// la identidad del array de messages es la sesión (ausente en el WeakMap = nueva).
			if (!this.hookSessions.has(messages)) {
				this.hooks.dispatchObserved('sessionStart', { sessionId: this.hookSessionId(messages) });
			}

			const mode: AgentMode = options?.mode ?? 'agent';
			// Con provider de failover, el modelo configurado puede no existir ahí: usamos su default.
			const model = normalizeModelForProvider(
				options?.modelOverride
					?? (options?.providerOverride ? (entry.defaultModel || this.activeModel(entry)) : this.activeModel(entry)),
				entry,
			);
			const baseUrl = entry.baseUrl;
			const contextLimit = this.resolveContextLimit(model);
			const maxTokens = this.resolveMaxTokens(model, entry);
			let memorySnapshot: IAgentMemorySnapshot | undefined;
			try {
				memorySnapshot = await this.memory.load();
			} catch { /* memoria ilegible: el run sigue sin ella */ }
			let skillsBlock: string | undefined;
			try {
				skillsBlock = await this.skills.buildPromptBlock();
			} catch { /* índice de skills ilegible: el run sigue sin él */ }
			let rulesBlock: string | undefined;
			try {
				rulesBlock = await this.rules.buildPromptBlock();
			} catch { /* una Rule ilegible no impide iniciar el run */ }
			const codebaseContext = this.configurationService.getValue<boolean>('openide.memory.enabled') === false ? undefined : await this.codebaseContext.select(messages.filter(message => message.role === 'user').map(message => message.content).join('\n').slice(-8000), { maxTokens: this.configurationService.getValue<number>('openide.memory.maxContextTokens') || 12000, maxNodes: this.configurationService.getValue<number>('openide.memory.maxRetrievedNodes') || 50 }).catch(() => undefined);
			const internalModeInstruction = options?.modeInstruction?.trim().slice(0, 20_000);
			const system = this.buildSystemPrompt(mode, memorySnapshot, skillsBlock, rulesBlock)
				+ (codebaseContext?.text ? `\n\n${codebaseContext.text}` : '')
				+ (internalModeInstruction ? `\n\nINSTRUCCIÓN INTERNA DE REANUDACIÓN DE MODO (no es un nuevo mensaje del usuario):\n${internalModeInstruction}` : '');
			// Textos de memoria/skills por separado para el desglose del panel de contexto.
			const memoryText = [memorySnapshot?.project, memorySnapshot?.user].filter(Boolean).join('\n');
			const skillsText = skillsBlock ?? '';

			// En modos de solo lectura (plan/ask) el modelo NI VE las tools de escritura/terminal.
			// ultra tiene TODAS (el orquestador edita) + delegate_task para spawnear subagentes.
			const readonlyOnly = mode === 'plan' || mode === 'ask';
			const toolDefs = this.tools.getDefinitions().filter(d => !readonlyOnly || (this.tools.getTool(d.name)?.risk ?? 'safe') === 'safe');
			if (mode === 'ultra') {
				toolDefs.push(DELEGATE_TOOL_DEF);
			}
			if ((mode === 'agent' || mode === 'ultra') && this.configurationService.getValue<boolean>('openide.subagents.enabled') !== false) {
				toolDefs.push(...SUBAGENT_TOOL_DEFS);
			}
			if (mode === 'agent' || mode === 'ultra') {
				toolDefs.push(REVIEW_CHANGES_TOOL_DEF);
			}
			// triaje de complejidad: recomendar plan/ultra/fork. Solo en agent/ask (en plan/ask ya
			// filtró por risk 'safe' — este def NO está en el registry, se pushea a mano acá).
			if (mode === 'agent' || mode === 'ask') {
				toolDefs.push(SUGGEST_MODE_TOOL_DEF);
			}
			const subCtx = { adapter, credential, entry, model, baseUrl, maxTokens };
			const toolCallGuard = new OpenideToolCallGuard();
			let contextOverflowRecoveries = 0;
			let imageFallbackApplied = false;
			const maxIterations = resolveAgentIterationLimit(this.configurationService.getValue<number>('openide.agent.maxAgentIterations'));
			let continueTruncatedOutput = false;
			let outputContinuations = 0;

			if (options?.compactOnly) {
				await this.compactIfNeeded(messages, adapter, model, credential, baseUrl, token, onEvent, system, toolDefs, contextLimit, entry.extraHeaders, entry.cloudCodeMetadata, 'manual');
				onEvent({ type: 'done', reason: 'compaction' });
				return;
			}

			for (let i = 0; i < maxIterations; i++) {
				if (token.isCancellationRequested) {
					return;
				}
				const isOutputContinuation = continueTruncatedOutput;
				continueTruncatedOutput = false;
				await this.compactIfNeeded(messages, adapter, model, credential, baseUrl, token, onEvent, system, toolDefs, contextLimit, entry.extraHeaders, entry.cloudCodeMetadata);
				let sawUsage = false;
				// Los mensajes user con @menciones llevan `context` (contenido de archivos): viaja
				// al modelo appendeado al content, pero la UI/persistencia mantienen el texto limpio.
				const wireMessages = messages.map(message => {
					const withContext = message.context ? { ...message, content: `${message.content}\n\n${message.context}` } : message;
					if (!imageFallbackApplied || !withContext.images?.length) {
						return withContext;
					}
					const { images, ...withoutImages } = withContext;
					return {
						...withoutImages,
						content: `${withoutImages.content}\n\n[${images.length} imagen(es) omitidas: el modelo activo no admite visión]`,
					};
				});
				if (isOutputContinuation) {
					// Sólo viaja al provider: no aparece como mensaje del usuario ni se persiste en la sesión.
					wireMessages.push({ role: 'user', content: OUTPUT_CONTINUATION_PROMPT });
				}
				let iterationEmitted = false;
				let result: IProviderResult;
				try {
					result = await this.streamWithRetry(
						adapter,
						{ credential, providerId: entry.id, baseUrl, model, system, messages: wireMessages, tools: toolDefs, maxTokens, extraHeaders: entry.extraHeaders, cloudCodeMetadata: entry.cloudCodeMetadata, effort: this.getReasoningEffort() || undefined },
						ev => {
							if (ev.type === 'text') {
								iterationEmitted = true;
								onEvent({ type: 'text', delta: ev.delta });
							} else if (ev.type === 'reasoning') {
								iterationEmitted = true;
								onEvent({ type: 'reasoning', delta: ev.delta });
							} else if (ev.type === 'usage') {
								sawUsage = true;
								onEvent(this.enrichUsage(ev, system, toolDefs, messages, contextLimit, memoryText, skillsText));
							}
						},
						token,
						onEvent,
					);
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					const classified = classifyProviderError(detail);
					if (classified.shouldCompact && !iterationEmitted && contextOverflowRecoveries < 1) {
						contextOverflowRecoveries++;
						const compacted = await this.compactIfNeeded(messages, adapter, model, credential, baseUrl, token, onEvent, system, toolDefs, contextLimit, entry.extraHeaders, entry.cloudCodeMetadata, 'recovery');
						if (compacted) {
							i--;
							continue;
						}
					}
					if (classified.shouldDropImages && !iterationEmitted && !imageFallbackApplied && messages.some(message => !!message.images?.length)) {
						imageFallbackApplied = true;
						onEvent({ type: 'info', message: 'El modelo rechazó las imágenes; reintentando con referencias textuales para no perder el resto del turno.' });
						i--;
						continue;
					}
					throw error;
				}

				if (token.isCancellationRequested) {
					return; // cancelado mientras streameaba (abort/rollback): no appendear el resultado stale
				}
				if (isOutputContinuation && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
					// El webview ya dibujó ambos streams como un único bloque. Guardarlos también como un
					// solo mensaje evita que al restaurar la sesión aparezca un corte artificial.
					const previous = messages[messages.length - 1];
					messages[messages.length - 1] = {
						...previous,
						content: `${previous.content ?? ''}${result.message.content ?? ''}`,
						toolCalls: result.message.toolCalls,
						geminiParts: result.message.geminiParts,
					};
				} else {
					messages.push(result.message);
				}
				if (!sawUsage) {
					// El endpoint no reportó usage en streaming: emitimos el estimado local.
					onEvent(this.enrichUsage({}, system, toolDefs, messages, contextLimit, memoryText, skillsText));
				}
				const calls = result.message.toolCalls;
				if (!calls || !calls.length) {
					if (isOutputLimitStopReason(result.stopReason) && outputContinuations < MAX_OUTPUT_CONTINUATIONS) {
						outputContinuations++;
						continueTruncatedOutput = true;
						if (outputContinuations === 1) {
							onEvent({ type: 'info', message: 'La respuesta alcanzó el límite de salida del modelo; OpenIDE la continúa automáticamente.' });
						}
						continue;
					}
					if (!result.message.content?.trim()) {
						const stopInfo = result.stopReason ? ` (finish_reason: ${result.stopReason})` : '';
						const nimHint = entry.id === 'nvidia-nim'
							? ' El modelo no emitió texto ni tools (ya se reintentó sin tools). En NVIDIA NIM no todos los modelos soportan modo agente: probá meta/llama-3.3-70b-instruct, nvidia/nemotron-3-nano-30b-a3b, deepseek-ai/deepseek-v4-flash u openai/gpt-oss-20b.'
							: '';
						onEvent({ type: 'error', message: `El modelo respondió vacío${stopInfo}.${nimHint}` });
						return;
					}
					// Hooks stop (observador): el agente terminó su turno (junto al emit de 'done').
					this.hooks.dispatchObserved('stop', { sessionId: this.hookSessionId(messages) });
					onEvent({ type: 'done', reason: result.stopReason });
					return;
				}

				for (const rawCall of calls) {
					const repairedArguments = repairToolArgumentsJson(rawCall.argumentsJson);
					const call = repairedArguments === undefined ? rawCall : { ...rawCall, argumentsJson: repairedArguments };
					if (token.isCancellationRequested) {
						return;
					}
					const loopDecision = toolCallGuard.inspect(call.name, call.argumentsJson);
					if (loopDecision.warn) {
						onEvent({ type: 'info', message: `La herramienta "${call.name}" repitió exactamente la misma llamada 3 veces; se bloqueará si vuelve a ocurrir.` });
					}
					if (loopDecision.block) {
						const blocked = `Error: llamada repetida bloqueada para evitar un ciclo (${call.name}, ${loopDecision.occurrence} repeticiones idénticas). Revisá el resultado anterior y cambiá de estrategia.`;
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: blocked, isError: true });
						messages.push({ role: 'tool', toolCallId: call.id, content: blocked });
						continue;
					}

					// Tools "especiales" interceptadas acá (necesitan la UI / el loop, no sólo devolver string).
					if (SUBAGENT_TOOL_DEFS.some(def => def.name === call.name)) {
						let parsed: any = {}; try { parsed = JSON.parse(call.argumentsJson || '{}'); } catch { /* validación abajo */ }
						let output = '';
						if (call.name === 'delegate_to_subagent') {
							const owner = ownerMessageId;
							if (!owner || !parsed.agent || !parsed.task) { output = 'Error: agent, task y parent message son obligatorios.'; }
							else {
								const run = await this.subagentOrchestration.delegate({ agent: String(parsed.agent), task: String(parsed.task), context: parsed.context, background: parsed.background, model: parsed.model, parentConversationId: this.hookSessionId(messages), parentMessageId: owner });
								onEvent({ type: 'subagentRun', run }); output = run.background ? `Subagente iniciado en background. runId=${run.runId}` : JSON.stringify(run.result ?? { status: run.status, runId: run.runId });
							}
						} else {
							const runId = String(parsed.runId ?? ''); const run = this.subagentOrchestration.get(runId);
							if (!run) { output = 'Error: runId inexistente.'; }
							else if (call.name === 'cancel_subagent') { output = this.subagentOrchestration.cancel(runId) ? `Cancelado ${runId}.` : `No se pudo cancelar ${runId}.`; }
							else if (call.name === 'await_subagent') { const done = await this.subagentOrchestration.awaitResult(runId); output = JSON.stringify(done.result ?? { status: done.status, error: done.error }); }
							else if (call.name === 'get_subagent_result') { output = JSON.stringify(run.result ?? { status: run.status, error: run.error }); }
							else { output = JSON.stringify({ runId, status: run.status, progress: run.progress }); }
						}
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: output, isError: output.startsWith('Error') }); messages.push({ role: 'tool', toolCallId: call.id, content: output }); continue;
					}
					if (call.name === 'review_changes' && (mode === 'agent' || mode === 'ultra')) {
						let parsed: any = {};
						try { parsed = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos */ }
						const files = (Array.isArray(parsed.files) ? parsed.files : []).map(String).filter(Boolean);
						const focus = typeof parsed.focus === 'string' ? parsed.focus.trim() : '';
						if (!files.length) {
							const err = 'Error: review_changes necesita files explícitos.';
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						onEvent({ type: 'toolStart', id: call.id, name: call.name, argumentsJson: call.argumentsJson });
						const out = await this.runReviewChanges(call.id, files, focus, mode, subCtx, onEvent, token);
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: out, isError: out.startsWith('REVISIÓN BLOQUEADA') || out.startsWith('Error') });
						messages.push({ role: 'tool', toolCallId: call.id, content: out });
						continue;
					}
					if (call.name === 'delegate_task' && mode === 'ultra') {
						const legacySubCtx = await this.resolveLegacySubagentContext('implementation', subCtx);
						let parsed: any = {};
						try { parsed = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos */ }
						const tasks: { title: string; prompt: string }[] = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
							.slice(0, 6)
							.map((t: any) => ({ title: String(t?.title ?? '').trim() || 'Subagente', prompt: String(t?.prompt ?? '').trim() }))
							.filter((t: { prompt: string }) => t.prompt);
						if (!tasks.length) {
							const err = 'Error: delegate_task sin tasks válidas (cada una necesita title y prompt).';
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						// Subagentes en PARALELO: cada uno con contexto aislado, tools read-only y su
						// card inline en el chat. Al padre solo vuelve el informe final de cada uno.
						const total = tasks.length;
						onEvent({ type: 'delegationStart', id: call.id, total });
						const results = await Promise.all(tasks.map(async (t, idx) => {
							const subId = `${call.id}-${idx}`;
							const subCts = new CancellationTokenSource(token);
							this.subagentRuns.set(subId, subCts);
							onEvent({ type: 'subagentStart', id: subId, parentId: call.id, index: idx, total, status: 'running', title: t.title, prompt: t.prompt, model: legacySubCtx.model });
							try {
								const out = await this.runSubAgent(subId, call.id, idx, total, t.prompt, legacySubCtx, onEvent, subCts.token, undefined, undefined, undefined, true);
								const cancelled = subCts.token.isCancellationRequested;
								onEvent({ type: 'subagentDone', id: subId, parentId: call.id, index: idx, total, status: cancelled ? 'cancelled' : 'completed', isError: false, cancelled });
								// Hooks subagentStop (observador): el subagente cerró su informe.
								this.hooks.dispatchObserved('subagentStop', { sessionId: this.hookSessionId(messages), extra: { title: t.title, is_error: false, cancelled } });
								return { title: t.title, out: cancelled ? '(cancelado por el usuario)' : out, status: cancelled ? 'cancelled' as const : 'completed' as const };
							} catch (e) {
								const cancelled = subCts.token.isCancellationRequested;
								onEvent({ type: 'subagentDone', id: subId, parentId: call.id, index: idx, total, status: cancelled ? 'cancelled' : 'failed', isError: !cancelled, cancelled });
								this.hooks.dispatchObserved('subagentStop', { sessionId: this.hookSessionId(messages), extra: { title: t.title, is_error: !cancelled, cancelled } });
								return { title: t.title, out: cancelled ? '(cancelado por el usuario)' : `Error del subagente: ${e instanceof Error ? e.message : String(e)}`, status: cancelled ? 'cancelled' as const : 'failed' as const };
							} finally {
								this.subagentRuns.delete(subId);
								subCts.dispose();
							}
						}));
						const failed = results.filter(result => result.status === 'failed').length;
						const cancelled = results.filter(result => result.status === 'cancelled').length;
						onEvent({ type: 'delegationDone', id: call.id, total, status: cancelled === total ? 'cancelled' : failed || cancelled ? 'partial' : 'completed' });
						if (token.isCancellationRequested) {
							return;
						}
						const combined = results.map(r => `### ${r.title}\n${r.out || '(sin informe)'}`).join('\n\n').slice(0, 60000);
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: `${results.length} subagente(s) completados.`, isError: false });
						messages.push({ role: 'tool', toolCallId: call.id, content: combined });
						continue;
					}
					// suggest_mode: recomienda cambiar de modo (plan/ultra/fork) con una tarjeta
					// accionable. No cambia nada por sí sola — el usuario acepta en el chat. Va
					// interceptada acá porque NO está en el registry (getTool sería undefined).
					if (call.name === 'suggest_mode') {
						let a: any = {};
						try { a = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos */ }
						const target = a.mode === 'agent' || a.mode === 'plan' || a.mode === 'ask' || a.mode === 'ultra' || a.mode === 'fork' ? a.mode : '';
						const reason = String(a.reason ?? '').trim();
						if (!target || !reason) {
							const err = 'Error: suggest_mode necesita mode (agent|plan|ask|ultra|fork) y reason.';
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						const suggestPrompt = String(a.prompt ?? '').trim() || undefined;
						const modeDecision = new DeferredPromise<boolean>();
						this._pendingModeSuggestions.set(call.id, modeDecision);
						const modeCancel = token.onCancellationRequested(() => { if (!modeDecision.isSettled) { modeDecision.complete(false); } });
						onEvent({ type: 'suggestMode', id: call.id, mode: target, reason, prompt: suggestPrompt });
						const accepted = await modeDecision.p;
						modeCancel.dispose(); this._pendingModeSuggestions.delete(call.id);
						const ack = accepted
							? `El usuario aceptó cambiar al modo ${target}. La UI reenviará el pedido en ese modo; no continúes este turno.`
							: `El usuario rechazó cambiar al modo ${target}. Continuá en el modo actual y resolvé el pedido si es seguro hacerlo.`;
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: ack, isError: false });
						messages.push({ role: 'tool', toolCallId: call.id, content: ack });
						if (accepted) { onEvent({ type: 'done', reason: 'mode-switch' }); return; }
						continue;
					}
					if (call.name === 'update_todos') {
						let items: ITodoItem[] = [];
						try { items = normalizeTodos(JSON.parse(call.argumentsJson || '{}').todos); } catch { /* args inválidos */ }
						onEvent({ type: 'todos', items });
						const ack = `Lista de tareas actualizada (${items.length}).`;
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: ack, isError: false });
						messages.push({ role: 'tool', toolCallId: call.id, content: ack });
						continue;
					}
					if (call.name === 'ask_user') {
						let a: any = {};
						try { a = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos */ }
						const questions = normalizeAskQuestions(a);
						if (!questions.length) {
							const err = 'Error: ask_user sin preguntas (pasá "questions" o "question").';
							onEvent({ type: 'toolResult', id: call.id, name: 'ask_user', result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						const askId = generateUuid();
						const deferred = new DeferredPromise<string>();
						this._pendingAsks.set(askId, deferred);
						const sub = token.onCancellationRequested(() => { if (!deferred.isSettled) { deferred.complete('(el usuario canceló)'); } });
						onEvent({ type: 'ask', id: askId, questions, allowFreeText: a.allow_free_text !== false });
						const answer = await deferred.p;
						sub.dispose();
						this._pendingAsks.delete(askId);
						onEvent({ type: 'toolResult', id: call.id, name: 'ask_user', result: answer, isError: false });
						messages.push({ role: 'tool', toolCallId: call.id, content: answer });
						continue;
				}
				// terminal_send: escribe SOLO si hay sesión awaiting-input (gate en tools).
				// risk=exec → pasa por el approval manager como el resto de exec tools.
				if (call.name === 'terminal_send') {
						let a: any = {};
						try { a = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos */ }
						const text = String(a.text ?? '');
						if (!text) {
							const err = 'Error: terminal_send necesita "text" (respuesta corta al prompt interactivo).';
							onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						if (/[\r\n\u2028\u2029\0]/.test(text) || text.length > 500) {
							const err = text.length > 500
								? 'Error: terminal_send acepta como máximo 500 caracteres.'
								: 'Error: terminal_send acepta una sola línea (sin saltos de línea ni nulos).';
							onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: err, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: err });
							continue;
						}
						if (!this.tools.hasInteractiveSession()) {
							const noTerm = 'Error: no hay una sesión interactiva awaiting-input. Lanzá run_command primero; terminal_send sólo responde prompts (y/N), no ejecuta comandos nuevos.';
							onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: noTerm, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: noTerm });
							continue;
						}
						// Approval gate (risk=exec): misma política que run_command / write tools.
						const termTool = this.tools.getTool('terminal_send');
						const termInfo = termTool?.approvalInfo?.({ text }) ?? { title: 'Responder prompt de terminal', detail: text.slice(0, 80) };
						const decision = await this.approval.check(
							{ tool: 'terminal_send', risk: 'exec', title: termInfo.title, detail: termInfo.detail, command: termInfo.command },
							(r, sensitive) => this.promptApprovalInline(r, sensitive, onEvent, token),
							this.getPermissionMode(),
						);
						onEvent({ type: 'approval', name: 'terminal_send', decision });
						if (decision === 'deny') {
							const denied = 'Error: el usuario rechazó terminal_send.';
							onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: denied, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: denied });
							continue;
						}
						const result = await this.tools.sendToAgentTerminalInteractive(text, token, 30_000);
						if (!result) {
							const noTerm = 'Error: la sesión interactiva se cerró. Reintentá con run_command.';
							onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: noTerm, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: noTerm });
							continue;
						}
						const out = result.output.length > 4000 ? result.output.slice(-4000) : result.output;
						const summary = result.timedOut
							? `timeout: no hubo exit ni nuevo prompt en 30s. Salida parcial:\n${out || '(sin salida nueva)'}\n\nSi sigue el prompt, reintentá terminal_send; si colgó, cancelá y usá run_command de nuevo.`
							: result.awaitingInput
								? `awaiting-input (aún esperando): ${out || '(sin salida nueva)'}`
								: result.exitCode !== undefined
									? `exit code: ${result.exitCode}\n${out || '(sin salida nueva)'}`
									: out || '(sin salida nueva)';
						onEvent({ type: 'toolResult', id: call.id, name: 'terminal_send', result: summary, isError: !!result.timedOut && !out });
						messages.push({ role: 'tool', toolCallId: call.id, content: summary });
						continue;
				}

					const tool = this.tools.getTool(call.name);
					if (tool) {
						let parsedArguments: unknown;
						try {
							parsedArguments = JSON.parse(call.argumentsJson || '{}');
						} catch {
							const invalid = `Error: argumentos JSON inválidos para ${call.name}.`;
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: invalid, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: invalid });
							continue;
						}
						const argumentErrors = validateToolArguments(tool.def.parameters, parsedArguments);
						if (argumentErrors.length) {
							const invalid = `Error: argumentos inválidos para ${call.name}: ${argumentErrors.join('; ')}.`;
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: invalid, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: invalid });
							continue;
						}
					}
					let mutationArguments: any = {};
					try { mutationArguments = JSON.parse(call.argumentsJson || '{}'); } catch { /* validación anterior reporta el error */ }
					if (this.isRulesMutation(call.name, mutationArguments) && !this.rulesEditExplicitlyRequested(messages)) {
						const denied = 'Error: las Rules son instrucciones protegidas. Solo se pueden modificar cuando el usuario lo pide explícitamente en su mensaje actual.';
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: denied, isError: true });
						messages.push({ role: 'tool', toolCallId: call.id, content: denied });
						continue;
					}
					// Hooks preToolUse: corren ANTES del approval gate (un block acá le ahorra el
					// prompt al usuario) y son FAIL-OPEN. El approval sigue fail-closed y el piso
					// HARDLINE_DENY (dentro del ApprovalManager) es inapelable: corre igual.
					if (await this.hooks.has('preToolUse')) {
						let hookInput: any = {};
						try { hookInput = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos: payload vacío */ }
						const outcomes = await this.hooks.dispatch('preToolUse', { toolName: call.name, toolInput: hookInput, sessionId: this.hookSessionId(messages) });
						const blocked = this.hooks.getBlockMessage(outcomes);
						if (blocked !== undefined) {
							const denied = `Error: bloqueado por un hook preToolUse: ${blocked}`;
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: denied, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: denied });
							this.hooks.dispatchObserved('postToolUse', { toolName: call.name, toolInput: hookInput, sessionId: this.hookSessionId(messages), extra: { status: 'blocked' } });
							continue;
						}
					}
					// Gate de aprobación para herramientas de escritura/terminal.
					if (tool && tool.risk !== 'safe') {
						let parsed: any = {};
						try { parsed = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos: igual pedimos aprobación genérica */ }
						const info = tool.approvalInfo ? tool.approvalInfo(parsed) : { title: call.name };
						const decision = await this.approval.check(
							{ tool: call.name, risk: tool.risk, title: info.title, detail: info.detail, command: info.command, path: info.path },
							(r, sensitive) => this.promptApprovalInline(r, sensitive, onEvent, token),
							this.getPermissionMode(),
						);
						onEvent({ type: 'approval', name: call.name, decision });
						if (decision === 'deny') {
							const denied = `Acción rechazada por el usuario: ${call.name}.`;
							onEvent({ type: 'toolResult', id: call.id, name: call.name, result: denied, isError: true });
							messages.push({ role: 'tool', toolCallId: call.id, content: denied });
							continue;
						}
					}
					const agentLocation = this.tools.agentLocation(call.name, call.argumentsJson);
					if (agentLocation) {
						onEvent({ type: 'agentLocation', location: agentLocation });
					}
					onEvent({ type: 'toolStart', id: call.id, name: call.name, argumentsJson: call.argumentsJson });
					const invokedAt = Date.now();
					// run_command: mientras corre, el output del pty fluye a la terminal embebida
					// del chat (solo lo suscribimos acá para no arrastrar el ruido del git flow).
					let shellSub: IDisposable | undefined;
					if (call.name === 'run_command') {
						shellSub = this.tools.onDidShellData(data => onEvent({ type: 'terminalData', id: call.id, data }));
					}
					lastEditDiff = undefined; // el editSub lo setea si esta tool edita un archivo
					let out: string;
					try {
						out = await this.tools.invoke(call.name, call.argumentsJson, token, ownerMessageId);
					} finally {
						shellSub?.dispose();
					}
					// Hooks postToolUse (observador, fire-and-forget): result capado a 8k chars.
					if (await this.hooks.has('postToolUse')) {
						let hookInput: any = {};
						try { hookInput = JSON.parse(call.argumentsJson || '{}'); } catch { /* args inválidos: payload vacío */ }
						this.hooks.dispatchObserved('postToolUse', { toolName: call.name, toolInput: hookInput, sessionId: this.hookSessionId(messages), extra: { result: out.slice(0, HOOK_PAYLOAD_TEXT_CAP), duration_ms: Date.now() - invokedAt, status: out.startsWith('Error') ? 'error' : 'ok' } });
					}
					// Screenshots: los roles 'tool' no llevan imagen en todos los protocolos, así
					// que la imagen viaja como mensaje 'user' adjunto (soportado en los 3).
					const shot = parseScreenshotMarker(out);
					if (shot) {
						onEvent({ type: 'toolResult', id: call.id, name: call.name, result: shot.note, isError: false });
						// la captura se MUESTRA en el chat (card de imagen inline) además de ir al modelo
						onEvent({ type: 'screenshot', id: call.id, mimeType: shot.mimeType, data: shot.data });
						messages.push({ role: 'tool', toolCallId: call.id, content: `${shot.note} La imagen va en el mensaje siguiente.` });
						messages.push({ role: 'user', content: `[imagen: resultado de ${call.name}]`, images: [{ mimeType: shot.mimeType, data: shot.data }] });
						continue;
					}
					onEvent({ type: 'toolResult', id: call.id, name: call.name, result: out, isError: out.startsWith('Error') });
					// el diff de la edición (si la tool editó un archivo) se pega al tool result →
					// se persiste con la sesión y reconstruye la edit card al restaurar (Ctrl+R).
					messages.push({ role: 'tool', toolCallId: call.id, content: out, ...(lastEditDiff ? { fileDiff: lastEditDiff } : {}) });
				}
			}
			this.hooks.dispatchObserved('stop', { sessionId: this.hookSessionId(messages) });
			onEvent({
				type: 'error',
				message: `La ejecución alcanzó el límite de seguridad de ${maxIterations} ciclos. El historial quedó guardado: podés escribir “continuá” para retomar sin perder el trabajo.`,
			});
		} catch (e) {
			// Un abort voluntario no debe terminar como una card de error ni dejar que un run
			// viejo compita con el siguiente mensaje de la misma conversación.
			if (token.isCancellationRequested) {
				return;
			}
			const msg = e instanceof Error ? e.message : String(e);
			const cls = classifyProviderError(msg);
			let refreshHint = '';
			const refreshed = options?.refreshedOAuthProviders ?? [];
			const entryForRefresh = findProvider(this.customProviders(), providerId);
			// Los access tokens OAuth pueden ser invalidados por el backend antes de expiresAt.
			// Renovamos una sola vez y solo antes de mostrar salida, para no duplicar texto.
			if (cls.kind === 'auth' && !emittedContent && entryForRefresh?.auth === 'oauth' && !refreshed.includes(providerId)) {
				try {
					await this.auth.refreshOAuthCredential(entryForRefresh);
					this.subagentRouting.clearHealth(providerId);
					onEvent({ type: 'info', message: `La sesión OAuth de "${entryForRefresh.label}" venció o fue revocada; renovando el token y reintentando…` });
					editSub.dispose();
					return this.runMessagesInternal(messages, rawOnEvent, token, {
						...options,
						refreshedOAuthProviders: [...refreshed, providerId],
					});
				} catch (refreshError) {
					const detail = refreshError instanceof Error ? refreshError.message : String(refreshError);
					refreshHint = `\nNo se pudo renovar la sesión OAuth automáticamente: ${detail}`;
				}
			}
			// La cadena nueva puede cambiar provider y modelo. Se mantiene fallbackProviders
			// como compatibilidad para perfiles existentes.
			const currentStep = { providerId, ...(options?.modelOverride ? { model: options.modelOverride } : {}) };
			const triedSteps = [...(options?.triedFallbackSteps ?? []), fallbackStepKey(currentStep)];
			const fallbackChain = parseFallbackChain(
				this.configurationService.getValue<unknown>('openide.agent.fallbackChain'),
				this.configurationService.getValue<unknown>('openide.agent.fallbackProviders'),
			);
			const canFailover = cls.kind === 'auth'
				|| cls.kind === 'billing'
				|| cls.kind === 'rate-limit'
				|| cls.reason === 'network'
				|| cls.reason === 'overloaded'
				|| cls.reason === 'model-not-found'
				|| cls.reason === 'model-retired'
				|| cls.reason === 'provider-unavailable'
				|| cls.reason === 'project-not-found';
			const next = canFailover && !emittedContent
				? fallbackChain.find(step => !triedSteps.includes(fallbackStepKey(step)) && !!this.findProvider(step.providerId))
				: undefined;
			if (next && !token.isCancellationRequested) {
				const target = next.model ? `${next.providerId}/${next.model}` : next.providerId;
				onEvent({ type: 'info', message: `El proveedor "${providerId}" falló (${cls.reason}); probando con "${target}"…` });
				editSub.dispose();
				return this.runMessagesInternal(messages, rawOnEvent, token, {
					...options,
					providerOverride: next.providerId,
					modelOverride: next.model,
					triedProviders: [...(options?.triedProviders ?? []), providerId],
					triedFallbackSteps: triedSteps,
				});
			}
			const errorMessage = cls.hint ? `${msg}\n${cls.hint}` : msg;
			onEvent({ type: 'error', message: errorMessage + refreshHint, action: cls.kind === 'auth' || cls.kind === 'billing' ? 'connect' : undefined });
		} finally {
			editSub.dispose();
			if (ownerMessageId && ownsChangeSet) {
				onEvent({ type: 'messageChangeSet', changeSet: this.messageChanges.finalize(ownerMessageId, token.isCancellationRequested) });
			}
		}
	}

	// ---- subagentes (modo Ultracode) ----

	/** Ejecuta revisores aislados sobre el diff exacto. Un diff nuevo invalida automáticamente
	 *  la revisión porque OpenideGitFlow guarda su fingerprint, no una bandera booleana. */
	private async resolveLegacySubagentContext(profile: 'review' | 'implementation' | 'research', fallback: ISubAgentContext): Promise<ISubAgentContext> {
		if (!this.subagentRouting.isEnabled()) { return fallback; }
		const decision = await this.subagentRouting.decide(profile);
		return decision.selected ? this.resolveSubagentContext(decision.selected.model, decision.selected.providerId) : fallback;
	}

	private async runReviewChanges(
		parentId: string,
		files: string[],
		focus: string,
		mode: 'agent' | 'ultra',
		ctx: ISubAgentContext,
		onEvent: (e: AgentLoopEvent) => void,
		token: CancellationToken,
	): Promise<string> {
		ctx = await this.resolveLegacySubagentContext('review', ctx);
		const diff = await this.gitFlow.readReviewDiff(files, token);
		if (!diff.ok || !diff.fingerprint) {
			return diff.text;
		}
		const cfg = await this.gitFlow.readConfig();
		const total = mode === 'ultra' ? cfg.ultraReviewers : cfg.agentReviewers;
		const focusText = focus || 'correctitud, regresiones, seguridad, manejo de errores y cobertura de validación';
		const tasks = Array.from({ length: total }, (_, index) => ({
			title: `Revisor ${index + 1}/${total}`,
			prompt: `Sos un revisor adversarial e INDEPENDIENTE. Tu única tarea es encontrar errores en el diff siguiente; no implementes ni propongas cambios fuera de este alcance. Revisá línea por línea con foco en ${focusText}. Buscá bugs reales, regresiones, contratos rotos, seguridad, concurrencia y validación faltante. Para cada hallazgo indicá severidad (CRITICAL/HIGH/MEDIUM/LOW), archivo y línea aproximada, evidencia y corrección propuesta. Si no hay un hallazgo bloqueante, cerrá exactamente con \`VERDICT: PASS\`. Si hay algo que debe corregirse antes de integrar, cerrá exactamente con \`VERDICT: BLOCK\`.\n\nARCHIVOS: ${files.join(', ')}\n\nDIFF A REVISAR:\n${diff.text}`,
		}));
		onEvent({ type: 'delegationStart', id: parentId, total });
		const results = await Promise.all(tasks.map(async (task, index) => {
			const subId = `${parentId}-review-${index}`;
			const subCts = new CancellationTokenSource(token);
			this.subagentRuns.set(subId, subCts);
			onEvent({ type: 'subagentStart', id: subId, parentId, index, total, status: 'running', title: task.title, prompt: 'Revisión aislada del diff actual', model: ctx.model });
			try {
				const out = await this.runSubAgent(subId, parentId, index, total, task.prompt, ctx, onEvent, subCts.token);
				const cancelled = subCts.token.isCancellationRequested;
				onEvent({ type: 'subagentDone', id: subId, parentId, index, total, status: cancelled ? 'cancelled' : 'completed', isError: false, cancelled });
				return { title: task.title, out: cancelled ? '(cancelado por el usuario)' : out, failed: cancelled };
			} catch (error) {
				const cancelled = subCts.token.isCancellationRequested;
				onEvent({ type: 'subagentDone', id: subId, parentId, index, total, status: cancelled ? 'cancelled' : 'failed', isError: !cancelled, cancelled });
				return { title: task.title, out: cancelled ? '(cancelado por el usuario)' : `Error del revisor: ${error instanceof Error ? error.message : String(error)}`, failed: true };
			} finally {
				this.subagentRuns.delete(subId);
				subCts.dispose();
			}
		}));
		const report = results.map(result => `### ${result.title}\n${result.out || '(sin informe)'}`).join('\n\n').slice(0, 60_000);
		const blocked = results.some(result => result.failed || /VERDICT:\s*BLOCK\b/i.test(result.out));
		onEvent({ type: 'delegationDone', id: parentId, total, status: blocked ? 'partial' : 'completed' });
		if (blocked) {
			return `REVISIÓN BLOQUEADA: corregí los hallazgos y ejecutá review_changes otra vez.\n\n${report}`;
		}
		this.gitFlow.markReviewed(diff.fingerprint);
		return `REVISIÓN APROBADA: ${total} revisor(es) independiente(s) aprobaron el diff actual. Podés ejecutar git_preflight.\n\n${report}`;
	}

	/** Loop de un subagente de investigación: contexto AISLADO (solo su prompt de delegación),
	 *  tools de SOLO LECTURA, profundidad 1 (no puede delegar), y eventos envueltos en
	 *  subagentEvent para la card inline del chat. Devuelve su informe final (texto). */
	private async runSubAgent(
		subId: string,
		parentId: string,
		index: number,
		total: number,
		prompt: string,
		ctx: ISubAgentContext,
		onEvent: (e: AgentLoopEvent) => void,
		token: CancellationToken,
		definition?: ISubagentDefinition,
		workspaceRoot?: URI,
		onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void,
		writable = false,
): Promise<string> {
			const folder = this.contextService.getWorkspace().folders[0];
			const registeredDefinition = definition ?? this.subagentRegistry.get(subId);
			const automaticContext = await this.codebaseContext.select(prompt, { runId: subId, maxTokens: 4000, maxNodes: 20 }).catch(() => undefined);
			// Modo escritura (Claude Code): el subagente explora, planifica Y resuelve su tarea de
			// forma autónoma, editando archivos directamente. Modo lectura: solo investiga y reporta.
			const baseSystem = writable
				? (registeredDefinition?.systemPrompt || ('Sos un subagente AUTÓNOMO de OpenIDE con herramientas COMPLETAS (lectura Y escritura) sobre el workspace real'
					+ (folder ? ` (${folder.name}: ${folder.uri.fsPath})` : '')
					+ '. Tu tarea es RESOLVER de forma independiente: explorá el código, planificá los cambios, editá los archivos y verificá. Trabajá de forma eficiente y autónoma. Al terminar, escribí un INFORME breve de lo que hiciste, archivos modificados y decisiones tomadas.'))
				: (registeredDefinition?.systemPrompt || ('Sos un subagente de investigación de OpenIDE con herramientas de SOLO LECTURA sobre el workspace real'
					+ (folder ? ` (${folder.name}: ${folder.uri.fsPath})` : '')
					+ '. Cumplí exactamente la tarea delegada: investigá con las tools y terminá con un INFORME final claro y accionable (hallazgos concretos, rutas de archivo y líneas relevantes). No intentes editar nada ni pidas permisos: reportá. Sé eficiente: no más de ~10 llamadas a herramientas.'));
			const system = automaticContext?.text ? `${baseSystem}\n\n${automaticContext.text}` : baseSystem;
			// En modo escritura permitimos tools de riesgo 'write' y 'exec' además de 'safe'.
			const EXCLUDED = new Set(['ask_user', 'update_todos', 'memory', 'skill_save', 'delegate_task', 'git_configure', 'browser_open']);
			const configuredTools = new Set(registeredDefinition?.tools ?? []);
			const allowedRisks = writable ? new Set(['safe', 'write', 'exec']) : new Set(['safe']);
			const toolDefs = this.tools.getDefinitions().filter(d =>
				(!configuredTools.size || configuredTools.has(d.name)) &&
				(!registeredDefinition || this.subagentPermissions.checkTool(registeredDefinition, d.name, this.tools.getTool(d.name)?.risk).allowed) &&
				allowedRisks.has(this.tools.getTool(d.name)?.risk ?? 'write') && !EXCLUDED.has(d.name) && !d.name.startsWith('browser_') && !d.name.startsWith('mcp_'));
		const allowedTools = new Set(toolDefs.map(tool => tool.name));
		const toolCallGuard = new OpenideToolCallGuard();
		let toolCallCount = 0;
		const messages: IChatMessage[] = [{ role: 'user', content: prompt }];
		const wrap = (ev: AgentLoopEvent) => onEvent({ type: 'subagentEvent', id: subId, parentId, index, total, status: 'running', ev });

		const maxSubIterations = writable ? 40 : 12;
		for (let i = 0; i < maxSubIterations; i++) {
			if (token.isCancellationRequested) {
				return '(cancelado)';
			}
			const result = await this.streamWithRetry(
				ctx.adapter,
				{ credential: ctx.credential, providerId: ctx.entry.id, baseUrl: ctx.baseUrl, model: ctx.model, system, messages, tools: toolDefs, maxTokens: ctx.maxTokens, extraHeaders: ctx.entry.extraHeaders, cloudCodeMetadata: ctx.entry.cloudCodeMetadata, effort: this.getReasoningEffort() || undefined },
				ev => {
					if (ev.type === 'text') { wrap({ type: 'text', delta: ev.delta }); }
					if (ev.type === 'usage') {
						onUsage?.({ inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
						// También viaja a la card legacy de delegate_task/review_changes para que el árbol
						// Agentes muestre consumo aun cuando el run no usa todavía el registro persistente.
						wrap(ev);
					}
				},
				token,
				wrap,
			);
			if (token.isCancellationRequested) {
				return '(cancelado)';
			}
			messages.push(result.message);
			const calls = result.message.toolCalls;
			if (!calls || !calls.length) {
				return result.message.content?.trim() || '(sin informe)';
			}
			for (const rawCall of calls) {
				const repairedArguments = repairToolArgumentsJson(rawCall.argumentsJson);
				const call = repairedArguments === undefined ? rawCall : { ...rawCall, argumentsJson: repairedArguments };
				if (token.isCancellationRequested) {
					return '(cancelado)';
				}
				toolCallCount++;
				const registered = this.tools.getTool(call.name);
				const loopDecision = toolCallGuard.inspect(call.name, call.argumentsJson);
				if (!allowedTools.has(call.name) || !allowedRisks.has(registered?.risk ?? 'write') || toolCallCount > maxSubIterations || loopDecision.block) {
					const reason = toolCallCount > maxSubIterations
						? 'límite de iteraciones alcanzado'
						: loopDecision.block
							? 'llamada idéntica repetida'
							: 'herramienta fuera de la allowlist';
					const denied = `Error: herramienta bloqueada para este subagente (${reason}).`;
					wrap({ type: 'toolResult', id: call.id, name: call.name, result: denied, isError: true });
					messages.push({ role: 'tool', toolCallId: call.id, content: denied });
					continue;
				}
				wrap({ type: 'toolStart', id: call.id, name: call.name, argumentsJson: call.argumentsJson });
				const out = await this.tools.invoke(call.name, call.argumentsJson, token, undefined, workspaceRoot);
				wrap({ type: 'toolResult', id: call.id, name: call.name, result: out.slice(0, 400), isError: out.startsWith('Error') });
				messages.push({ role: 'tool', toolCallId: call.id, content: out });
			}
		}
		// Límite de iteraciones: pedimos un cierre con lo que haya.
		const last = messages.filter(m => m.role === 'assistant' && m.content).pop();
		return (last?.content ?? '').trim() || '(el subagente alcanzó el límite de iteraciones sin informe)';
	}

	private async executeRegisteredSubagent(request: ISubagentExecutionRequest) {
		const runtime = await this.resolveSubagentContext(request.target?.model ?? (request.model && request.model !== 'default' ? request.model : undefined), request.target?.providerId);
		const available = this.tools.getDefinitions().map(tool => tool.name);
		const allowedNames = new Set(this.subagentPermissions.allowedTools(request.definition, available));
		const originalTools = request.definition.tools;
		const isolatedDefinition = { ...request.definition, tools: originalTools.length ? originalTools : [...allowedNames] };
		request.onEvent({ type: 'progress', message: 'Planning next moves' });
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder) { throw new Error('No hay workspace abierto.'); }
		const preferWorktree = this.configurationService.getValue<boolean>('openide.subagents.useWorktrees') !== false;
		const lease = await this.subagentWorkspaces.acquire(request.runId, folder.uri, request.definition.readonly, preferWorktree);
		try {
		const contextFiles = Array.isArray(request.context?.files) ? request.context.files.map(String).slice(0, 20) : [];
		const contextSymbols = Array.isArray(request.context?.symbols) ? request.context.symbols.map(String).slice(0, 30) : [];
		const contextSelection = typeof request.context?.selection === 'string' ? request.context.selection.slice(0, 50_000) : '';
		const materializedFiles: string[] = [];
		for (const path of contextFiles) {
			const uri = this.tools.resolveWorkspacePath(path, lease.root);
			if (!uri) { materializedFiles.push(`${path}: [ruta inválida]`); continue; }
			try { materializedFiles.push(`--- ${path} ---\n${(await this.fileService.readFile(uri)).value.toString().slice(0, 50_000)}`); } catch { materializedFiles.push(`${path}: [no disponible]`); }
		}
		const explicitContext = request.context ? [
			contextFiles.length ? `Archivos seleccionados: ${contextFiles.join(', ')}` : '',
			contextSymbols.length ? `Símbolos seleccionados: ${contextSymbols.join(', ')}` : '',
			request.context?.diagnostics === true ? 'Incluí diagnósticos del workspace.' : '',
			contextSelection ? `Selección explícita:\n${contextSelection}` : '',
			materializedFiles.length ? `Snapshot de archivos:\n${materializedFiles.join('\n\n')}` : '',
			`Workspace asignado (${lease.kind}): ${lease.root.fsPath}`,
		].filter(Boolean).join('\n') : '';
		const delegatedPrompt = explicitContext ? `${request.task}\n\nCONTEXTO EXPLÍCITO DEL PADRE:\n${explicitContext}` : request.task;
		const report = await this.runSubAgent(request.runId, request.runId, 0, 1, delegatedPrompt, runtime, event => {
			if (event.type === 'subagentEvent') {
				const nested = event.ev;
				if (nested.type === 'text' || nested.type === 'reasoning') { request.onExecutionState?.({ emittedOutput: true }); }
				if (nested.type === 'toolStart') {
					const tool = this.tools.getTool(nested.name);
					// Desde el primer dispatch de tool el intento deja de ser reproducible con certeza,
					// incluso si la tool declara riesgo safe (puede consultar/mutar estado externo).
					request.onExecutionState?.({ emittedOutput: true, producedSideEffects: true });
					const decision = this.subagentPermissions.checkTool(isolatedDefinition, nested.name, tool?.risk);
					request.onEvent(decision.allowed
						? { type: 'toolStart', toolCallId: nested.id, toolName: nested.name, argumentsJson: nested.argumentsJson }
						: { type: 'permissionDenied', toolCallId: nested.id, toolName: nested.name, message: decision.reason });
				} else if (nested.type === 'toolResult') {
					request.onEvent({ type: 'toolResult', toolCallId: nested.id, toolName: nested.name, message: nested.result.slice(0, 400), isError: nested.isError });
				} else if (nested.type === 'info') { request.onEvent({ type: 'progress', message: nested.message }); }
			}
		}, request.token, isolatedDefinition, lease.root, request.onUsage);
		return { summary: report, metadata: { workspaceUri: lease.root.toString(), workspaceKind: lease.kind } };
		} finally { await this.subagentWorkspaces.release(request.runId); }
	}

	/** Resuelve provider/model para un runtime hijo sin compartir messages, CTS ni counters. */
	private async resolveSubagentRoutingAvailability(targets: readonly ISubagentRoutingTarget[]): Promise<ReadonlyMap<string, ISubagentRoutingAvailability>> {
		const result = new Map<string, ISubagentRoutingAvailability>();
		await Promise.all(targets.map(async target => {
			const entry = this.findProvider(target.providerId);
			if (!entry) { result.set(subagentTargetKey(target), { connected: false }); return; }
			let connected = false;
			try { connected = await this.isConnected(entry.id); } catch { /* desconectado */ }
			const knownModels = await this.resolveProviderModels(entry).catch(() => entry.models ? [...entry.models] : []);
			result.set(subagentTargetKey(target), { connected, knownModels, capabilities: this.catalog.lookup(target.model) });
		}));
		return result;
	}

	private async resolveSubagentContext(modelOverride?: string, providerOverride?: string): Promise<ISubAgentContext> {
		const entry = this.findProvider(providerOverride || this.getActiveProviderId());
		if (!entry) { throw new Error(providerOverride ? `Proveedor de subagente desconocido: ${providerOverride}.` : 'No hay proveedor activo para ejecutar el subagente.'); }
		const adapter = this.protocols.get(entry.protocol);
		if (!adapter) { throw new Error(`Protocolo no disponible: ${entry.protocol}.`); }
		const credential = await this.auth.resolveCredential(entry);
		const model = modelOverride || (providerOverride ? this.modelForProvider(entry.id) : this.getModel()) || entry.defaultModel;
		if (!model) { throw new Error(`El proveedor ${entry.label} no tiene modelo disponible.`); }
		return { adapter, credential, entry, model, baseUrl: entry.baseUrl, maxTokens: this.resolveMaxTokens(model, entry) };
	}

	// ---- auto-compactación de contexto ----

	/** Compacta el historial preservando un tail por presupuesto y evitando ciclos sin progreso. */
	private async compactIfNeeded(
		messages: IChatMessage[],
		adapter: ILLMProvider,
		model: string,
		credential: ICredential,
		baseUrl: string | undefined,
		token: CancellationToken,
		onEvent: (e: AgentLoopEvent) => void,
		system: string,
		toolDefs: IToolDefinition[],
		contextLimit: number,
		extraHeaders?: Record<string, string>,
		cloudCodeMetadata?: Record<string, string>,
		origin: 'automatic' | 'manual' | 'recovery' = 'automatic',
	): Promise<boolean> {
		const force = origin !== 'automatic';
		if (!force && this.configurationService.getValue<boolean>('openide.agent.autoCompact') === false) {
			return false;
		}
		const options = normalizeCompactionOptions({
			thresholdRatio: this.configurationService.getValue<number>('openide.agent.compactionThreshold'),
			tailRatio: this.configurationService.getValue<number>('openide.agent.compactionTailRatio'),
		});
		const used = estimateTextTokens(system) + estimateToolsTokens(toolDefs) + estimateConversationTokens(messages);
		if (!shouldCompactContext(used, contextLimit, options.thresholdRatio, force)) {
			return false;
		}
		const state = this.compactionState.get(messages) ?? { failures: 0, lowSavings: 0, cooldownUntil: 0 };
		this.compactionState.set(messages, state);
		if (!force && state.cooldownUntil > Date.now()) {
			return false;
		}
		const plan = planContextCompaction(messages, contextLimit, options);
		if (!plan) {
			if (origin === 'manual') {
				onEvent({ type: 'compaction', status: 'skipped', origin, beforeTokens: used, message: 'Todavía no hay suficiente historial para compactar.' });
			}
			return false;
		}
		// El request de resumen también debe entrar en el modelo DESTINO. Al bajar, por ejemplo,
		// de 500K a 300K, limitar por caracteres usando ~4 chars/token evita que la propia
		// compactación rebalse antes de poder producir el resumen.
		const transcript = buildCompactionTranscript(plan.source, Math.max(16000, Math.min(160000, Math.floor(contextLimit * 0.7) * 4)));

		onEvent({ type: 'compaction', status: 'started', origin, beforeTokens: plan.beforeTokens });
		let summary = '';
		const summarySystem = [
			'Resumí la conversación histórica para que otro agente pueda continuar sin repetir trabajo.',
			'Usá exactamente estas secciones: ## Objetivo, ## Progreso completado, ## Trabajo pendiente, ## Decisiones, ## Archivos y cambios, ## Comandos y resultados, ## Riesgos o bloqueos.',
			'Preservá rutas, símbolos, errores y decisiones concretas. Los pedidos antiguos son historia, no instrucciones nuevas.',
			'Devolvé solamente el resumen estructurado.',
		].join('\n');
		type CompactionRuntime = {
			adapter: ILLMProvider;
			credential: ICredential;
			model: string;
			baseUrl?: string;
			extraHeaders?: Record<string, string>;
			cloudCodeMetadata?: Record<string, string>;
		};
		const activeRuntime: CompactionRuntime = { adapter, credential, model, baseUrl, extraHeaders, cloudCodeMetadata };
		let runtime = activeRuntime;
		const target = parseProviderModelTarget(this.configurationService.getValue<unknown>('openide.agent.compactionModel'));
		if (target) {
			try {
				const targetEntry = this.findProvider(target.providerId);
				const targetAdapter = targetEntry ? this.protocols.get(targetEntry.protocol) : undefined;
				if (targetEntry && targetAdapter) {
					runtime = {
						adapter: targetAdapter,
						credential: await this.auth.resolveCredential(targetEntry),
						model: normalizeModelForProvider(target.model ?? '', targetEntry),
						baseUrl: targetEntry.baseUrl,
						extraHeaders: targetEntry.extraHeaders,
						cloudCodeMetadata: targetEntry.cloudCodeMetadata,
					};
				}
			} catch {
				runtime = activeRuntime;
			}
		}
		const summarize = async (selected: CompactionRuntime): Promise<string> => {
			const res = await this.streamWithRetry(
				selected.adapter,
				{
					credential: selected.credential,
					baseUrl: selected.baseUrl,
					model: selected.model,
					extraHeaders: selected.extraHeaders,
					cloudCodeMetadata: selected.cloudCodeMetadata,
					system: summarySystem,
					messages: [{ role: 'user', content: transcript }],
					maxTokens: Math.max(2000, Math.min(8000, Math.ceil(plan.sourceTokens * 0.2))),
				},
				() => { },
				token,
				onEvent,
			);
			const content = res.message.content?.trim() ?? '';
			if (content.length < 80) {
				throw new Error('el modelo devolvió un resumen vacío o demasiado corto');
			}
			return content;
		};
		try {
			try {
				summary = await summarize(runtime);
			} catch (error) {
				if (runtime !== activeRuntime) {
					onEvent({ type: 'info', message: 'El modelo auxiliar de compactación falló; reintentando con el modelo activo.' });
					summary = await summarize(activeRuntime);
				} else {
					throw error;
				}
			}
		} catch (error) {
			state.failures++;
			if (!force) {
				state.cooldownUntil = Date.now() + 10 * 60 * 1000;
				const detail = error instanceof Error ? error.message : String(error);
				onEvent({ type: 'compaction', status: 'failed', origin, beforeTokens: plan.beforeTokens, message: `No se pudo compactar el contexto; se conserva el historial completo. ${detail}` });
				return false;
			}
			summary = buildDeterministicFallbackSummary(plan.source);
			onEvent({ type: 'info', message: 'La compactación del modelo falló; se aplicó una recuperación determinista para poder continuar.' });
		}
		const compacted = [buildStructuredSummaryMessage(summary), ...plan.tail];
		const savings = compactionSavingsRatio(plan.beforeTokens, compacted);
		if (!force && savings < 0.1) {
			state.lowSavings++;
			state.cooldownUntil = Date.now() + (state.lowSavings >= 2 ? 10 * 60 * 1000 : 60 * 1000);
			onEvent({ type: 'compaction', status: 'failed', origin, beforeTokens: plan.beforeTokens, message: 'La compactación no liberó suficiente contexto; se pausaron nuevos intentos para evitar un ciclo.' });
			return false;
		}
		const afterTokens = estimateConversationTokens(compacted);
		compacted[0].compaction = {
			beforeTokens: plan.beforeTokens,
			afterTokens,
			savingsPercent: Math.round(savings * 100),
			origin,
		};
		messages.splice(0, messages.length, ...compacted);
		state.failures = 0;
		state.lowSavings = 0;
		state.cooldownUntil = 0;
		onEvent({ type: 'compaction', status: 'completed', origin, beforeTokens: plan.beforeTokens, afterTokens, savingsPercent: Math.round(savings * 100) });
		return true;
	}
}

registerSingleton(IOpenideAgentService, OpenideAgentService, InstantiationType.Delayed);
