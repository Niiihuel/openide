/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — registry de herramientas del agente. Lectura (read/list/search/find) = 'safe';
 *  writes (write/edit) = 'write'; terminal (run_command) = 'exec'. The approval gate is applied
 *  by the service (OpenideApprovalManager) BEFORE invoking 'write'/'exec' tools.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { relativePath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarker, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ICommandDetectionCapability, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ISearchService, resultIsMatch } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { IAgentLocation, IBackgroundTerminalEvent, IFileEditEvent, IToolDefinition, ToolRisk } from '../common/openideAgentTypes.js';
import { resolvePathInsideWorkspace } from '../common/openideWorkspacePath.js';

/** Leaves the pty output as plain text: strips OSC (including shell integration 633/133),
 *  CSI, stray escapes and controls other than \n/\t. The \r stays: the webview uses it to
 *  overwrite the current line (progress bars). */
function stripAnsi(data: string): string {
	return data
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')  // OSC ... BEL|ST
		.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')           // CSI
		.replace(/\x1b[@-_]/g, '')                            // escapes de 2 bytes
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');        // controles (quedan \n \t \r)
}

/** awaiting-input heuristic: the command has run for a minimum time, already emitted output and
 *  has been silent for a while (y/N prompt, password, menu). It does not fire on continuous
 *  streams (progress bars) nor on hangs with no output (that is a real timeout).
 *  Defaults conservadores: 12s runtime + 6s de silencio — builds con pausas cortas no
 *  should not produce a false positive as easily as with 5s/3s. */
export function shouldDetectAwaitingInput(opts: {
	readonly now: number;
	readonly startTime: number;
	readonly lastDataTime: number;
	readonly minRuntimeMs?: number;
	readonly quietAfterOutputMs?: number;
}): boolean {
	const minRuntimeMs = opts.minRuntimeMs ?? 12_000;
	const quietAfterOutputMs = opts.quietAfterOutputMs ?? 6_000;
	if (opts.lastDataTime <= 0) {
		return false;
	}
	const sinceStart = opts.now - opts.startTime;
	const sinceData = opts.now - opts.lastDataTime;
	return sinceStart >= minRuntimeMs && sinceData >= quietAfterOutputMs;
}

/** Respuesta de terminal_send / runShellCaptured con estados distinguibles. */
export type ShellCaptureResult = {
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly awaitingInput?: boolean;
	/** Timeout de captura (no implica prompt interactivo). */
	readonly timedOut?: boolean;
};

/** Only long-running commands (dev servers, watchers) go to the composer's "background
 *  terminal" tray — not quick reads (cat/grep/git status) nor one-shot builds. */
export function isBackgroundTrayWorthy(command: string): boolean {
	const c = command.trim().toLowerCase();
	if (!c) {
		return false;
	}
	if (/^(cat|head|tail|wc|ls|pwd|echo|printf|which|type|file|stat|test|\[|true|false)\b/.test(c)) {
		return false;
	}
	if (/^(grep|rg|find|git\s+(status|diff|log|show|branch|stash\s+list|rev-parse|checkout|switch|add|commit))\b/.test(c)) {
		return false;
	}
	if (/^(npm|pnpm|yarn|bun)\s+(test|run\s+(test|lint|check|build|compile|format|typecheck|verify))\b/.test(c)) {
		return false;
	}
	if (/^(curl|wget)\s/.test(c) && !/\s(-d|--data|--upload-file)/.test(c)) {
		return false;
	}
	if (/\b(dev|serve|server|watch|watchers?|start|nodemon|pm2|tail\s+-f|journalctl\s+-f|docker\s+(compose\s+up|run)|code\.sh)\b/.test(c)) {
		return true;
	}
	if (/^(npm|yarn|pnpm|bun)\s+run\s+\w/.test(c) && !/\b(test|lint|check|build|compile|format|typecheck|verify)\b/.test(c)) {
		return true;
	}
	return false;
}

export interface IToolApprovalInfo {
	readonly title: string;
	readonly detail?: string;
	readonly command?: string;
	readonly path?: string;
}

export interface IAgentToolContext {
	readonly messageId?: string;
	readonly workspaceRoot?: URI;
	/**
	 * The call came from an EXTERNAL agent (a CLI in the dock), not from OpenIDE's own loop.
	 *
	 * It matters for artefacts that carry an action: a plan an external agent wrote must not be
	 * offered a "Build" that would launch OUR agent on it. Whoever asked is the one who executes.
	 */
	readonly external?: boolean;
}

export interface IAgentTool {
	readonly def: IToolDefinition;
	readonly risk: ToolRisk;
	approvalInfo?(args: any): IToolApprovalInfo;
	/** Visual destination the workspace can follow while this tool runs. */
	agentLocation?(args: any): IAgentLocation | undefined;
	invoke(args: any, token: CancellationToken, context?: IAgentToolContext): Promise<string>;
}

export class OpenideToolRegistry extends Disposable {

	private readonly tools = new Map<string, IAgentTool>();
	private agentTerminal: ITerminalInstance | undefined;
	/**
	 * Open interactive session: valid only while a run_command returned awaiting-input and the
	 * process is still alive. terminal_send requires this session (it never writes to a free shell).
	 * Hard TTL: if shell integration does not emit finish, the session expires on its own.
	 */
	private static readonly INTERACTIVE_SESSION_TTL_MS = 10 * 60_000;
	private interactiveSession: {
		readonly term: ITerminalInstance;
		openedAt: number;
		finishedListener?: { dispose(): void };
		dataListener?: { dispose(): void };
		exitListener?: { dispose(): void };
		ttlTimer?: ReturnType<typeof setTimeout>;
	} | undefined;
	private readonly bgTerminals = new Map<string, { term: ITerminalInstance; command: string; persistent: boolean }>();

	private readonly _onDidEdit = this._register(new Emitter<IFileEditEvent>());
	readonly onDidEdit: Event<IFileEditEvent> = this._onDidEdit.event;
	private readonly _onDidChangeBackgroundTerminal = this._register(new Emitter<IBackgroundTerminalEvent>());
	readonly onDidChangeBackgroundTerminal: Event<IBackgroundTerminalEvent> = this._onDidChangeBackgroundTerminal.event;
	/** Incremental output (plain text, no ANSI) of the command running in the agent terminal —
	 *  it feeds the chat's embedded terminal while run_command is in flight. */
	private readonly _onDidShellData = this._register(new Emitter<string>());
	readonly onDidShellData: Event<string> = this._onDidShellData.event;

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly searchService: ISearchService,
		private readonly instantiationService: IInstantiationService,
		private readonly terminalService: ITerminalService,
		private readonly markerService: IMarkerService,
		private readonly textModelService: ITextModelService,
	) {
		super();
		this.register(this.readFileTool());
		this.register(this.listFilesTool());
		this.register(this.searchTextTool());
		this.register(this.findFilesTool());
		this.register(this.getDiagnosticsTool());
		this.register(this.writeFileTool());
		this.register(this.editFileTool());
		this.register(this.deleteFileTool());
		this.register(this.renameFileTool());
		this.register(this.runCommandTool());
		this.register(this.updateTodosTool());
		this.register(this.askUserTool());
		this.register(this.terminalSendTool());
	}

	// ---- tools intercepted by the service (their invoke is a fallback) ----

	private updateTodosTool(): IAgentTool {
		return {
			risk: 'safe',
			def: {
				name: 'update_todos',
				description: 'Mantiene la lista de tareas visible para el usuario. Usala para trabajo multi-paso: mandá SIEMPRE la lista COMPLETA en cada llamada; exactamente UNA tarea "in-progress"; marcá "completed" apenas termines cada una.',
				parameters: {
					type: 'object',
					properties: {
						todos: {
							type: 'array',
							description: 'Lista completa de tareas',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									title: { type: 'string' },
									status: { type: 'string', enum: ['pending', 'in-progress', 'completed'] },
								},
								required: ['title', 'status'],
							},
						},
					},
					required: ['todos'],
				},
			},
			invoke: async () => 'OK', // interceptada en openideAgentService; este invoke no se llama
		};
	}

	private askUserTool(): IAgentTool {
		return {
			risk: 'safe',
			def: {
				name: 'ask_user',
				description: 'Hacé una o varias preguntas al usuario cuando el pedido sea ambiguo o falte info importante, ANTES de adivinar. Agrupá preguntas relacionadas en una sola llamada (hasta 5); ofrecé opciones cuando tenga sentido.',
				parameters: {
					type: 'object',
					properties: {
						questions: {
							type: 'array',
							description: 'Preguntas para el usuario (1 a 5)',
							items: {
								type: 'object',
								properties: {
									question: { type: 'string', description: 'La pregunta' },
									options: { type: 'array', items: { type: 'string' }, description: 'Opciones sugeridas (opcional)' },
								},
								required: ['question'],
							},
						},
						question: { type: 'string', description: 'Forma corta: una sola pregunta (equivale a questions con un elemento)' },
						options: { type: 'array', items: { type: 'string' }, description: 'Opciones para la forma corta' },
						allow_free_text: { type: 'boolean', description: 'Permitir respuesta libre (default true)' },
					},
				},
			},
			invoke: async () => '(sin respuesta)', // interceptada en openideAgentService
		};
	}

	/** terminal_send: answers interactive prompts from the agent terminal (y/N, passwords, menus).
	 *  Intercepted in openideAgentService because it needs the live terminal of the current run. */
	private terminalSendTool(): IAgentTool {
		return {
			// exec: writing to the pty is as privileged as run_command; the approval gate applies.
			// It also requires an awaiting-input session (not a free shell after exit).
			risk: 'exec',
			def: {
				name: 'terminal_send',
				description: 'Send text input to the interactive prompt of the last run_command that is awaiting input (y/N confirmations, passwords, menu selections). Returns the new output accumulated after sending and the exit code if the command finished. Only use after run_command returned "awaiting-input". Never use to run new shell commands.',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'Short reply to the interactive prompt (e.g. "y", "yes", a password, a menu option number). A newline is appended automatically. Max 500 chars; not for full shell commands.' },
					},
					required: ['text'],
				},
			},
			// Never echo the payload: it may be a password / a secret from the prompt.
			approvalInfo: () => ({ title: 'Responder prompt de terminal', detail: 'Respuesta interactiva (oculta)', command: 'terminal_send' }),
			invoke: async () => 'Error: no hay una terminal interactiva activa.', // interceptada en openideAgentService
		};
	}

	private register(tool: IAgentTool): void {
		this.tools.set(tool.def.name, tool);
	}

	/** Registers a tool built elsewhere (e.g. `memory`, which needs services the registry lacks). */
	registerTool(tool: IAgentTool): void {
		this.register(tool);
	}

	/** Removes a dynamically registered tool (MCP tools when their server drops/reloads) —
	 *  getDefinitions() reads the live registry, so the tool disappears from the next turn. */
	deregisterTool(name: string): void {
		this.tools.delete(name);
	}

	/** Collision guard for dynamic registrars: never overwrite an existing tool. */
	hasTool(name: string): boolean {
		return this.tools.has(name);
	}

	getTool(name: string): IAgentTool | undefined {
		return this.tools.get(name);
	}

	/** Resolves a tool's visual location. Built-ins use explicit metadata; for MCP
	 *  y herramientas instaladas conservamos un fallback deliberadamente acotado. */
	agentLocation(name: string, argumentsJson: string): IAgentLocation | undefined {
		let args: any = {};
		try { args = JSON.parse(argumentsJson || '{}'); } catch { return undefined; }
		const explicit = this.tools.get(name)?.agentLocation?.(args);
		if (explicit) {
			return explicit;
		}
		const lower = name.toLowerCase();
		if (/browser|playwright|webview/.test(lower)) {
			const activity = /open/.test(lower) ? 'open' : /navigate/.test(lower) ? 'navigate' : /click|type|set_style|dialog/.test(lower) ? 'interact' : 'inspect';
			return { kind: 'browser', url: typeof args.url === 'string' ? args.url : undefined, activity };
		}
		if (/terminal|command|shell|exec|bash/.test(lower) && typeof args.command === 'string') {
			return { kind: 'terminal', command: args.command, background: args.background === true };
		}
		const path = typeof args.path === 'string' ? args.path.trim()
			: typeof args.file === 'string' ? args.file.trim()
				: typeof args.file_path === 'string' ? args.file_path.trim() : '';
		if (!path || !/file|read|write|edit|patch|delete/.test(lower)) {
			return undefined;
		}
		const activity = /delete|remove/.test(lower) ? 'delete'
			: /create|write/.test(lower) ? 'write'
				: /edit|patch|replace/.test(lower) ? 'edit' : 'read';
		const line = Number(args.start_line ?? args.line);
		return { kind: 'file', path, line: Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined, activity };
	}

	/** Resolves a path inside one of the open roots; used by the chat diff. */
	resolveWorkspacePath(path: string, workspaceRoot?: URI): URI | undefined {
		return this.resolvePath(path, workspaceRoot);
	}

	getDefinitions(): IToolDefinition[] {
		return [...this.tools.values()].map(t => t.def);
	}

	async invoke(name: string, argumentsJson: string, token: CancellationToken, messageId?: string, workspaceRoot?: URI): Promise<string> {
		return this.run(name, argumentsJson, token, { messageId, workspaceRoot });
	}

	/** Same call, marked as coming from an external agent. */
	async invokeExternal(name: string, argumentsJson: string, token: CancellationToken): Promise<string> {
		return this.run(name, argumentsJson, token, { external: true });
	}

	private async run(name: string, argumentsJson: string, token: CancellationToken, context: IAgentToolContext): Promise<string> {
		const tool = this.tools.get(name);
		if (!tool) {
			return `Error: herramienta desconocida "${name}".`;
		}
		let args: any = {};
		try { args = JSON.parse(argumentsJson || '{}'); } catch { return `Error: argumentos JSON inválidos para ${name}.`; }
		try {
			return await tool.invoke(args, token, context);
		} catch (e) {
			return `Error ejecutando ${name}: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	// ---- helpers ----

	private resolvePath(p: string, workspaceRoot?: URI): URI | undefined {
		return resolvePathInsideWorkspace(p, workspaceRoot ? [workspaceRoot] : this.folders());
	}

	private relPath(uri: URI): string {
		const folder = this.contextService.getWorkspace().folders[0];
		if (folder) {
			const rel = relativePath(folder.uri, uri);
			if (rel) {
				return rel;
			}
		}
		return uri.path;
	}

	private folders(): URI[] {
		return this.contextService.getWorkspace().folders.map(f => f.uri);
	}

	/** LSP/linter diagnostics for a file, formatted for the model. It opens a reference to the text
	 *  model so language features validate it (a file that is NOT open has no markers) and leaves
	 *  some slack so validation can run after a write. */
	private async collectDiagnostics(uri: URI, waitMs = 1200): Promise<string> {
		try {
			const ref = await this.textModelService.createModelReference(uri);
			try {
				await timeout(waitMs);
				return this.formatMarkers(this.markerService.read({ resource: uri }), false, 20);
			} finally {
				ref.dispose();
			}
		} catch {
			return ''; // sin modelo (binario, inexistente): sin diagnósticos
		}
	}

	private formatMarkers(markers: IMarker[], includePath: boolean, cap: number): string {
		const relevant = markers
			.filter(m => m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning)
			.sort((a, b) => (b.severity - a.severity) || a.startLineNumber - b.startLineNumber)
			.slice(0, cap);
		if (!relevant.length) {
			return '';
		}
		const lines = relevant.map(m =>
			`${m.severity === MarkerSeverity.Error ? 'error' : 'warning'}${includePath ? ' ' + this.relPath(m.resource) : ''} L${m.startLineNumber}:${m.startColumn} — ${m.message}${m.source ? ` [${m.source}]` : ''}`
		);
		return lines.join('\n');
	}

	/** Diagnostics suffix for the write/edit result: immediate feedback to the model. */
	private async diagnosticsSuffix(uri: URI): Promise<string> {
		const diag = await this.collectDiagnostics(uri);
		return diag ? `\n\nDiagnósticos del archivo tras la edición (corregí los que hayas introducido):\n${diag}` : '';
	}

	// ---- @menciones del composer (autocomplete + contexto adjunto) ----

	/** Fuzzy search of workspace files for the composer's @ autocomplete. */
	async searchFilesForMention(query: string, maxResults = 12, token?: CancellationToken): Promise<string[]> {
		const folders = this.folders();
		if (!folders.length) {
			return [];
		}
		const qb = this.instantiationService.createInstance(QueryBuilder);
		const q = qb.file(folders, { filePattern: query, sortByScore: true, maxResults });
		const result = await this.searchService.fileSearch(q, token ?? CancellationToken.None);
		return result.results.map(r => this.relPath(r.resource));
	}

	/** Reads an @-mentioned file (capped) to attach it as message context. */
	async readMentionedFile(path: string, capChars = 20000): Promise<string | undefined> {
		const uri = this.resolvePath(path);
		if (!uri) {
			return undefined;
		}
		try {
			const text = (await this.fileService.readFile(uri)).value.toString();
			return text.length > capChars ? text.slice(0, capChars) + '\n…(truncado)' : text;
		} catch {
			return undefined;
		}
	}

	// ---- tools: lectura (safe) ----

	private readFileTool(): IAgentTool {
		return {
			risk: 'safe',
			agentLocation: args => {
				const line = Number(args.start_line);
				return {
					kind: 'file', path: String(args.path ?? ''), activity: 'read',
					line: Number.isFinite(line) && line > 0 ? Math.floor(line) : 1,
				};
			},
			def: {
				name: 'read_file',
				description: 'Lee un archivo completo o un rango de líneas del workspace. Acepta una ruta relativa a la primera carpeta abierta o una ruta absoluta dentro de alguna carpeta abierta.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Ruta del archivo a leer' },
						start_line: { type: 'number', description: 'Primera línea a leer, basada en 1 (opcional)' },
						end_line: { type: 'number', description: 'Última línea a leer, inclusiva (opcional)' },
					},
					required: ['path'],
				},
			},
			invoke: async (args, _token, context) => {
				const uri = this.resolvePath(String(args.path ?? ''), context?.workspaceRoot);
				if (!uri) { return 'Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.'; }
				const content = await this.fileService.readFile(uri);
				const text = content.value.toString();
				const requestedStart = Number(args.start_line);
				const requestedEnd = Number(args.end_line);
				const hasStart = Number.isFinite(requestedStart) && requestedStart > 0;
				const hasEnd = Number.isFinite(requestedEnd) && requestedEnd > 0;
				let selected = text;
				if (hasStart || hasEnd) {
					const lines = text.split(/\r?\n/);
					const start = hasStart ? Math.floor(requestedStart) : 1;
					const end = hasEnd ? Math.floor(requestedEnd) : lines.length;
					if (end < start) { return `Error: end_line (${end}) no puede ser menor que start_line (${start}).`; }
					if (start > lines.length) { return `Error: start_line (${start}) excede las ${lines.length} líneas del archivo.`; }
					selected = lines.slice(start - 1, Math.min(end, lines.length)).join('\n');
				}
				return selected.length > 60000 ? selected.slice(0, 60000) + '\n…(truncado)' : selected;
			},
		};
	}

	private listFilesTool(): IAgentTool {
		return {
			risk: 'safe',
			def: {
				name: 'list_files',
				description: 'Lista archivos y carpetas de un directorio del workspace.',
				parameters: { type: 'object', properties: { path: { type: 'string', description: 'Ruta del directorio (vacío o "." = raíz del workspace)' } } },
			},
			invoke: async (args, _token, context) => {
				const uri = this.resolvePath(String(args.path ?? '.') || '.', context?.workspaceRoot);
				if (!uri) { return 'Error: no hay carpeta abierta.'; }
				const stat = await this.fileService.resolve(uri);
				if (!stat.children) { return '(no es un directorio o está vacío)'; }
				return stat.children
					.map(c => (c.isDirectory ? '[dir]  ' : '[file] ') + c.name)
					.sort()
					.join('\n');
			},
		};
	}

	private searchTextTool(): IAgentTool {
		return {
			risk: 'safe',
			def: {
				name: 'search_text',
				description: 'Busca texto en los archivos del workspace (como grep). Devuelve archivos y líneas que coinciden.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Texto a buscar' },
						isRegExp: { type: 'boolean', description: 'Tratar query como expresión regular' },
					},
					required: ['query'],
				},
			},
			invoke: async (args, token) => {
				const pattern = String(args.query ?? '').trim();
				if (!pattern) { return 'Error: query vacía.'; }
				const folders = this.folders();
				if (!folders.length) { return 'Error: no hay carpeta abierta.'; }
				const qb = this.instantiationService.createInstance(QueryBuilder);
				const query = qb.text({ pattern, isRegExp: !!args.isRegExp }, folders, { maxResults: 200 });
				const result = await this.searchService.textSearch(query, token);
				const lines: string[] = [];
				for (const fm of result.results) {
					const matches = (fm.results ?? []).filter(resultIsMatch);
					lines.push(this.relPath(fm.resource) + (matches.length ? `  (${matches.length})` : ''));
					for (const m of matches.slice(0, 5)) {
						lines.push('   ' + m.previewText.replace(/\n+$/, '').slice(0, 200));
					}
				}
				if (!lines.length) { return '(sin resultados)'; }
				return lines.join('\n') + (result.limitHit ? '\n…(se alcanzó el límite de resultados)' : '');
			},
		};
	}

	private findFilesTool(): IAgentTool {
		return {
			risk: 'safe',
			def: {
				name: 'find_files',
				description: 'Busca archivos por nombre/glob en el workspace (ej: "*.ts", "src/**/index.*").',
				parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Patrón de nombre o glob' } }, required: ['pattern'] },
			},
			invoke: async (args, token) => {
				const pattern = String(args.pattern ?? '').trim();
				if (!pattern) { return 'Error: pattern vacío.'; }
				const folders = this.folders();
				if (!folders.length) { return 'Error: no hay carpeta abierta.'; }
				const qb = this.instantiationService.createInstance(QueryBuilder);
				const query = qb.file(folders, { filePattern: pattern, maxResults: 200 });
				const result = await this.searchService.fileSearch(query, token);
				const out = result.results.map(m => this.relPath(m.resource)).sort();
				return out.length ? out.join('\n') : '(sin resultados)';
			},
		};
	}

	private getDiagnosticsTool(): IAgentTool {
		return {
			risk: 'safe',
			agentLocation: args => {
				const path = String(args.path ?? '').trim();
				return path ? { kind: 'file', path, activity: 'read' } : undefined;
			},
			def: {
				name: 'get_diagnostics',
				description: 'Lee los diagnósticos actuales (errores y warnings de LSP/linters) del workspace o de un archivo puntual. Usala para verificar el estado del código después de una serie de ediciones.',
				parameters: { type: 'object', properties: { path: { type: 'string', description: 'Archivo puntual (opcional; sin path = todo el workspace)' } } },
			},
			invoke: async (args) => {
				const p = String(args.path ?? '').trim();
				if (p) {
					const uri = this.resolvePath(p);
					if (!uri) { return 'Error: la ruta está fuera del workspace o no hay una carpeta abierta.'; }
					const out = await this.collectDiagnostics(uri, 600);
					return out || '(sin errores ni warnings)';
				}
				const out = this.formatMarkers(this.markerService.read({}), true, 40);
				return out || '(sin errores ni warnings)';
			},
		};
	}

	// ---- tools: escritura (write) ----

	private writeFileTool(): IAgentTool {
		return {
			risk: 'write',
			agentLocation: args => ({ kind: 'file', path: String(args.path ?? ''), line: 1, activity: 'write' }),
			def: {
				name: 'write_file',
				description: 'Crea o sobreescribe un archivo con el contenido dado. Crea las carpetas intermedias si hace falta.',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Ruta del archivo' },
						content: { type: 'string', description: 'Contenido completo del archivo' },
					},
					required: ['path', 'content'],
				},
			},
			approvalInfo: (args) => ({ title: 'Escribir archivo', detail: String(args.path ?? ''), path: String(args.path ?? '') }),
			invoke: async (args, _token, context) => {
				const uri = this.resolvePath(String(args.path ?? ''));
				if (!uri) { return 'Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.'; }
				const content = String(args.content ?? '');
				let oldContent = '';
				let created = true;
				try { oldContent = (await this.fileService.readFile(uri)).value.toString(); created = false; } catch (error) {
					if (toFileOperationResult(error as Error) !== FileOperationResult.FILE_NOT_FOUND) { throw error; }
				}
				if (!created && oldContent === content) {
					return `OK: ${this.relPath(uri)} ya tenía el contenido solicitado (sin cambios).`;
				}
				await this.fileService.writeFile(uri, VSBuffer.fromString(content));
				this._onDidEdit.fire({ messageId: context?.messageId, path: this.relPath(uri), operation: created ? 'create' : 'modify', beforeContent: created ? undefined : oldContent, afterContent: content });
				return `OK: escrito ${this.relPath(uri)} (${content.length} chars).` + await this.diagnosticsSuffix(uri);
			},
		};
	}

	/** Whitespace-tolerant matching for edit_file when the exact one fails (with limits independent of the model):
	 *  pass 1 ignores whitespace at the END of each line; pass 2 compares lines with .trim()
	 *  and re-indents new_string to the file's real indentation. It requires a UNIQUE match. */
	private fuzzyReplace(current: string, oldStr: string, newStr: string): { updated?: string; error?: string } {
		const eol = current.includes('\r\n') ? '\r\n' : '\n';
		const fileLines = current.split(/\r?\n/);
		const oldLines = oldStr.split(/\r?\n/);
		if (!oldLines.length || oldLines.length > fileLines.length) {
			return {};
		}

		const findMatches = (norm: (s: string) => string): number[] => {
			const target = oldLines.map(norm);
			const hits: number[] = [];
			outer: for (let i = 0; i + target.length <= fileLines.length; i++) {
				for (let j = 0; j < target.length; j++) {
					if (norm(fileLines[i + j]) !== target[j]) {
						continue outer;
					}
				}
				hits.push(i);
			}
			return hits;
		};

		let hits = findMatches(l => l.replace(/\s+$/, ''));
		let reindent = false;
		if (!hits.length) {
			hits = findMatches(l => l.trim());
			reindent = true;
		}
		if (!hits.length) {
			return {};
		}
		if (hits.length > 1) {
			return { error: `Error: old_string (con matching aproximado) aparece ${hits.length} veces; agregá contexto para que sea único.` };
		}

		const start = hits[0];
		let newLines = newStr.split(/\r?\n/);
		if (reindent) {
			const fileIndent = (fileLines[start].match(/^[ \t]*/) ?? [''])[0];
			const oldIndent = (oldLines[0].match(/^[ \t]*/) ?? [''])[0];
			newLines = newLines.map(l => {
				if (!l.trim()) {
					return l;
				}
				if (oldIndent && l.startsWith(oldIndent)) {
					return fileIndent + l.slice(oldIndent.length);
				}
				return oldIndent ? l : fileIndent + l;
			});
		}
		const updatedLines = [...fileLines.slice(0, start), ...newLines, ...fileLines.slice(start + oldLines.length)];
		return { updated: updatedLines.join(eol) };
	}

	private editFileTool(): IAgentTool {
		return {
			risk: 'write',
			agentLocation: args => ({ kind: 'file', path: String(args.path ?? ''), activity: 'edit' }),
			def: {
				name: 'edit_file',
				description: 'Reemplaza una ocurrencia exacta de texto en un archivo. old_string debe aparecer EXACTAMENTE una vez (incluí contexto único).',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: 'Ruta del archivo' },
						old_string: { type: 'string', description: 'Texto exacto a reemplazar' },
						new_string: { type: 'string', description: 'Texto nuevo' },
					},
					required: ['path', 'old_string', 'new_string'],
				},
			},
			approvalInfo: (args) => ({ title: 'Editar archivo', detail: String(args.path ?? ''), path: String(args.path ?? '') }),
			invoke: async (args, _token, context) => {
				const uri = this.resolvePath(String(args.path ?? ''));
				if (!uri) { return 'Error: la ruta está vacía, fuera del workspace o no hay una carpeta abierta.'; }
				const oldStr = String(args.old_string ?? '');
				const newStr = String(args.new_string ?? '');
				if (!oldStr) { return 'Error: old_string vacío (usá write_file para crear).'; }
				const current = (await this.fileService.readFile(uri)).value.toString();
				const count = current.split(oldStr).length - 1;
				if (count > 1) { return `Error: old_string aparece ${count} veces; agregá contexto para que sea único.`; }
				let updated: string;
				let note = '';
				if (count === 1) {
					updated = current.replace(oldStr, newStr);
				} else {
					const fz = this.fuzzyReplace(current, oldStr, newStr);
					if (fz.error) { return fz.error; }
					if (fz.updated === undefined) { return 'Error: old_string no se encontró en el archivo (ni con matching tolerante a whitespace). Releé el archivo por si cambió.'; }
					updated = fz.updated;
					note = ' (match aproximado por whitespace)';
				}
				if (current === updated) {
					return `OK: ${this.relPath(uri)} quedó sin cambios efectivos${note}.`;
				}
				await this.fileService.writeFile(uri, VSBuffer.fromString(updated));
				this._onDidEdit.fire({ messageId: context?.messageId, path: this.relPath(uri), operation: 'modify', beforeContent: current, afterContent: updated });
				return `OK: editado ${this.relPath(uri)}${note}.` + await this.diagnosticsSuffix(uri);
			},
		};
	}

	private deleteFileTool(): IAgentTool {
		return {
			risk: 'write',
			agentLocation: args => ({ kind: 'file', path: String(args.path ?? ''), activity: 'delete' }),
			def: {
				name: 'delete_file',
				description: 'Elimina un archivo del workspace y registra la operación para rollback aislado del mensaje.',
				parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
			},
			approvalInfo: args => ({ title: 'Eliminar archivo', detail: String(args.path ?? ''), path: String(args.path ?? '') }),
			invoke: async (args, _token, context) => {
				const uri = this.resolvePath(String(args.path ?? ''));
				if (!uri) { return 'Error: ruta vacía o fuera del workspace.'; }
				let before: string;
				try { before = (await this.fileService.readFile(uri)).value.toString(); } catch { return `Error: no existe ${this.relPath(uri)}.`; }
				await this.fileService.del(uri);
				this._onDidEdit.fire({ messageId: context?.messageId, path: this.relPath(uri), operation: 'delete', beforeContent: before });
				return `OK: eliminado ${this.relPath(uri)}.`;
			},
		};
	}

	private renameFileTool(): IAgentTool {
		return {
			risk: 'write',
			agentLocation: args => ({ kind: 'file', path: String(args.to ?? ''), activity: 'write' }),
			def: {
				name: 'rename_file',
				description: 'Renombra o mueve un archivo dentro del workspace y registra la operación para rollback aislado del mensaje.',
				parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
			},
			approvalInfo: args => ({ title: 'Mover archivo', detail: `${String(args.from ?? '')} → ${String(args.to ?? '')}`, path: String(args.to ?? '') }),
			invoke: async (args, _token, context) => {
				const from = this.resolvePath(String(args.from ?? ''));
				const to = this.resolvePath(String(args.to ?? ''));
				if (!from || !to) { return 'Error: ruta origen/destino vacía o fuera del workspace.'; }
				if (await this.fileService.exists(to)) { return `Error: el destino ya existe: ${this.relPath(to)}.`; }
				let content: string;
				try { content = (await this.fileService.readFile(from)).value.toString(); } catch { return `Error: no existe ${this.relPath(from)}.`; }
				await this.fileService.move(from, to, false);
				this._onDidEdit.fire({ messageId: context?.messageId, path: this.relPath(to), originalPath: this.relPath(from), operation: 'rename', beforeContent: content, afterContent: content });
				return `OK: movido ${this.relPath(from)} → ${this.relPath(to)}.`;
			},
		};
	}

	// ---- tools: terminal (exec) ----

	private runCommandTool(): IAgentTool {
		return {
			risk: 'exec',
			agentLocation: args => ({
				kind: 'terminal',
				command: String(args.command ?? ''),
				background: args.background === true || args.background_persistent === true,
			}),
			def: {
				name: 'run_command',
				description: 'Run a shell command and return stdout/stderr + exit code. Use background:true ONLY for long-running processes (dev servers, "npm run dev", watchers) — never for quick reads (cat, grep, git status).',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'Shell command to run' },
						description: { type: 'string', description: 'Short English label (3–5 words) for the UI (e.g. "Start dev server", "Install dependencies")' },
						background: { type: 'boolean', description: 'Run in background without blocking (dev servers/watchers only — not for cat/grep/status checks)' },
						background_persistent: { type: 'boolean', description: 'Like background, but the terminal stays VISIBLE in the IDE terminal panel (dock) and is NOT auto-disposed when the command exits. Use for long-running processes the user wants to monitor indefinitely.' },
						timeoutSeconds: { type: 'number', description: 'Tope de espera en segundos (default 120, máx 600) — subilo SOLO para builds/instalaciones lentas. Al vencer, el proceso se TERMINA.' },
					},
					required: ['command'],
				},
			},
			approvalInfo: (args) => ({
				title: String(args.description ?? '') || (args.background_persistent ? 'Run in dock' : args.background ? 'Run in background' : 'Run command'),
				detail: String(args.command ?? ''),
				command: String(args.command ?? ''),
			}),
			invoke: async (args, token) => {
				const command = String(args.command ?? '').trim();
				if (!command) { return 'Error: empty command.'; }
				// background_persistent always goes to the dock (visible, no auto-dispose), even when the
				// command is not "tray-worthy". background:true is only for servers/watchers.
				if (args.background_persistent) {
					return this.startBackgroundCommand(command, true);
				}
				if (args.background) {
					if (isBackgroundTrayWorthy(command)) {
						return this.startBackgroundCommand(command, false);
					}
					// background:true misused (a quick read) → foreground with capture
				}
				const timeoutSec = Math.min(600, Math.max(5, Number(args.timeoutSeconds) || 120));
				const finished = await this.runShellCaptured(command, token, timeoutSec * 1000);
				if (token.isCancellationRequested) { return '(cancelado — el proceso fue terminado)'; }
				if (finished === 'no-shell-integration') {
					return '(comando enviado a la terminal, pero shell integration no está disponible → no se pudo capturar la salida)';
				}
				if (!finished) {
					return `(timeout: el comando no terminó en ${timeoutSec}s y fue TERMINADO. Si es un server/watcher usá background:true; si es un build/instalación lenta reintentá con timeoutSeconds más alto.)`;
				}
				if (finished.awaitingInput) {
					const tail = finished.output.length > 2000 ? finished.output.slice(-2000) : finished.output;
					return `awaiting-input: el comando está esperando una respuesta interactiva (y/N, password, menú). Última salida:\n${tail || '(sin salida visible)'}\n\nUsá terminal_send para responder.`;
				}
				const out = finished.output.length > 30000 ? finished.output.slice(0, 30000) + '\n…(truncado)' : finished.output;
				return `exit code: ${finished.exitCode ?? '?'}\n${out || '(sin salida)'}`;
			},
		};
	}

	/**
	 * Closes the interactive session. By default it does NOT dispose the pty (the command may
	 * still be alive and terminal_send/finish need it). With `killPty` it does kill and detach
	 * agentTerminal (TTL / abandon / nuevo run_command).
	 */
	private clearInteractiveSession(term?: ITerminalInstance, opts?: { killPty?: boolean }): void {
		const s = this.interactiveSession;
		if (!s) {
			return;
		}
		if (term && s.term !== term) {
			return;
		}
		const owned = s.term;
		if (s.ttlTimer) { clearTimeout(s.ttlTimer); s.ttlTimer = undefined; }
		try { s.finishedListener?.dispose(); } catch { /* ignore */ }
		try { s.dataListener?.dispose(); } catch { /* ignore */ }
		try { s.exitListener?.dispose(); } catch { /* ignore */ }
		this.interactiveSession = undefined;
		if (opts?.killPty) {
			if (!owned.isDisposed) {
				owned.dispose();
			}
			if (this.agentTerminal === owned) {
				this.agentTerminal = undefined;
			}
		}
	}

	/** Renueva el TTL (actividad de terminal_send). */
	private touchInteractiveSession(): void {
		const s = this.interactiveSession;
		if (!s) {
			return;
		}
		s.openedAt = Date.now();
		if (s.ttlTimer) { clearTimeout(s.ttlTimer); }
		const term = s.term;
		s.ttlTimer = setTimeout(() => {
			// Only kill if it is still the same session.
			if (this.interactiveSession?.term === term) {
				this.clearInteractiveSession(term, { killPty: true });
			}
		}, OpenideToolRegistry.INTERACTIVE_SESSION_TTL_MS);
	}

	/** True when the session points exactly at this term and is still alive (and within the TTL). */
	private sessionStillOwns(term: ITerminalInstance): boolean {
		if (!this.hasInteractiveSession()) {
			return false;
		}
		const s = this.interactiveSession;
		return !!s && s.term === term && !term.isDisposed;
	}

	/** True si hay un proceso interactivo vivo esperando terminal_send. */
	hasInteractiveSession(): boolean {
		const s = this.interactiveSession;
		if (!s) {
			return false;
		}
		if (s.term.isDisposed) {
			// Orphaned metadata: the pty is already dead.
			this.clearInteractiveSession();
			if (this.agentTerminal === s.term) {
				this.agentTerminal = undefined;
			}
			return false;
		}
		// TTL: if SI never emitted finish, we close the gate AND kill the orphaned pty so the
		// next run_command does not reuse a hung process (console freeze).
		if (Date.now() - s.openedAt > OpenideToolRegistry.INTERACTIVE_SESSION_TTL_MS) {
			this.clearInteractiveSession(undefined, { killPty: true });
			return false;
		}
		return true;
	}

	/** Runs a command in the agent's hidden terminal, capturing output + exit code
	 *  (shell integration). Used by run_command and the git flow.
	 *  If the command does NOT finish (timeout or run cancellation), the shared terminal is
	 *  KILLED — the hung process dies with it and the next call creates a fresh one. Otherwise
	 *  every following command queues behind the hung one and "the console freezes"
	 *  (y el pty host termina unresponsive). */
	async runShellCaptured(command: string, token: CancellationToken, timeoutMs = 120000): Promise<ShellCaptureResult | 'no-shell-integration' | undefined> {
		// Previous interactive session (or a TTL that just killed it): do not reuse that pty.
		if (this.hasInteractiveSession()) {
			this.clearInteractiveSession(this.interactiveSession!.term, { killPty: true });
		}
		const term = await this.getAgentTerminal();
		await term.processReady;
		const cd = await this.waitForCommandDetection(term);
		if (!cd) {
			// Without SI there is no reliable capture. We send the command and DETACH the shared
			// terminal (the next getAgentTerminal creates a fresh one) so nothing queues behind it.
			// No dispose: that would kill the process instantly.
			term.sendText(command, true);
			if (this.agentTerminal === term) {
				this.agentTerminal = undefined;
			}
			return 'no-shell-integration';
		}
		// A single finish listener: it resolves the race AND clears the interactive session.
		// It is never half-disposed between race and open-session (avoids a free shell with an open gate).
		let finishedResolved: ShellCaptureResult | undefined;
		let finishResolve: ((r: ShellCaptureResult) => void) | undefined;
		const finishedP = new Promise<ShellCaptureResult>(resolve => { finishResolve = resolve; });
		const finishedListener = cd.onCommandFinished(cmd => {
			const r: ShellCaptureResult = { output: cmd.getOutput() ?? '', exitCode: cmd.exitCode };
			finishedResolved = r;
			this.clearInteractiveSession(term);
			finishResolve?.(r);
		});
		let cancelListener: { dispose(): void } | undefined;
		const cancelledP = new Promise<undefined>(resolve => {
			cancelListener = token.onCancellationRequested(() => resolve(undefined));
		});
		// Streaming to the chat's embedded terminal: the raw pty includes the prompt and the command
		// echo → we only start forwarding once command detection marks "executing" (post-echo), and
		// we stop at the end. ANSI/OSC is stripped: the card shows plain text.
		let streaming = false;
		let lastDataTime = 0;
		let accumulatedOutput = '';
		const execListener = cd.onCommandExecuted(() => { streaming = true; });
		const dataListener = term.onData(data => {
			if (!streaming) { return; }
			const plain = stripAnsi(data);
			if (plain) { lastDataTime = Date.now(); accumulatedOutput += plain; this._onDidShellData.fire(plain); }
		});
		try {
			term.sendText(command, true);
			// awaiting-input detection: minimum runtime + there was output + subsequent silence
			// (prompt y/N / password). No mata la terminal: terminal_send escribe al pty vivo.
			const startTime = Date.now();
			let awaitingResolved = false;
			let awaitingInterval: ReturnType<typeof setInterval> | undefined;
			const awaitingInputP = new Promise<ShellCaptureResult | undefined>(resolve => {
				awaitingInterval = setInterval(() => {
					if (awaitingResolved) { return; }
					if (shouldDetectAwaitingInput({ now: Date.now(), startTime, lastDataTime })) {
						awaitingResolved = true;
						if (awaitingInterval) { clearInterval(awaitingInterval); awaitingInterval = undefined; }
						resolve({ output: accumulatedOutput.slice(-4000), exitCode: undefined, awaitingInput: true });
					}
				}, 1000);
			});
			const result = await Promise.race([finishedP, awaitingInputP, timeout(timeoutMs).then(() => undefined), cancelledP]);
			awaitingResolved = true;
			if (awaitingInterval) { clearInterval(awaitingInterval); awaitingInterval = undefined; }
			// Timeout / cancel: matar la terminal colgada.
			if (result === undefined) {
				finishedListener.dispose();
				this.clearInteractiveSession(term);
				term.dispose();
				if (this.agentTerminal === term) {
					this.agentTerminal = undefined;
				}
				return undefined;
			}
			// Normal finish (finishedP won, or the command ended during the race): no session.
			if (!result.awaitingInput || finishedResolved) {
				finishedListener.dispose();
				this.clearInteractiveSession(term);
				return finishedResolved ?? result;
			}
			// Real awaiting-input: the finishedListener is STILL alive and clears the session on exit.
			// If the command already ended between the race and here, finishedResolved is set and we do not open.
			if (finishedResolved) {
				finishedListener.dispose();
				return finishedResolved;
			}
			// Interactive session: data + finish + exit + proactive TTL.
			this.clearInteractiveSession();
			const exitListener = term.onExit(() => {
				// Process died: clear the gate and detach (dispose if not already).
				this.clearInteractiveSession(term, { killPty: true });
			});
			this.interactiveSession = {
				term,
				openedAt: Date.now(),
				finishedListener,
				dataListener,
				exitListener,
			};
			this.touchInteractiveSession(); // arma el timer TTL proactivo
			// Avoid disposing the dataListener in the finally: the session now owns it.
			return result;
		} finally {
			cancelListener?.dispose();
			execListener.dispose();
			// If the session kept the dataListener, do not dispose it here.
			if (this.interactiveSession?.term !== term || this.interactiveSession?.dataListener !== dataListener) {
				dataListener.dispose();
			}
		}
	}

	/** Writes a line to the agent terminal (user input in the chat's embedded terminal while
	 *  run_command runs: answering y/N prompts, typing into a REPL, etc.). */
	writeToAgentTerminal(text: string): void {
		// Prefer a VALID interactive session (TTL/ownership); otherwise the in-flight agent terminal.
		const term = this.hasInteractiveSession()
			? this.interactiveSession!.term
			: this.agentTerminal;
		if (term && !term.isDisposed) {
			term.sendText(text, true);
		}
	}

	/**
	 * Writes text to the interactive session's pty and captures new output.
	 * Returns undefined when there is NO awaiting-input session (safety gate).
	 * It distinguishes timedOut from awaitingInput. Multi-line payloads are rejected.
	 */
	async sendToAgentTerminalInteractive(text: string, token: CancellationToken, timeoutMs = 30000): Promise<ShellCaptureResult | undefined> {
		if (!this.hasInteractiveSession()) {
			return undefined;
		}
		const session = this.interactiveSession!;
		// A single line: newlines would allow queueing commands after answering the prompt.
		if (/[\r\n\u2028\u2029\0]/.test(text)) {
			return { output: 'Error: terminal_send acepta una sola línea (sin saltos de línea).', exitCode: undefined };
		}
		if (text.length > 500) {
			return { output: 'Error: terminal_send acepta como máximo 500 caracteres (no se trunca en silencio).', exitCode: undefined };
		}
		const payload = text;
		const term = session.term;
		const cd = await this.waitForCommandDetection(term);
		// TOCTOU: el comando pudo terminar durante el await → no escribir a shell libre.
		if (!this.sessionStillOwns(term)) {
			return undefined;
		}
		if (!cd) {
			// Without SI we cannot observe: we do not write, and we kill the opaque session (killPty).
			this.clearInteractiveSession(term, { killPty: true });
			return { output: 'Error: shell integration no disponible; no se puede confirmar el prompt.', exitCode: undefined };
		}
		let outputBuffer = '';
		// 0 until the first data after send: with no echo (password) we do not fake "quiet after output".
		let lastDataTime = 0;
		const dataListener = term.onData(data => {
			const plain = stripAnsi(data);
			if (plain) { outputBuffer += plain; lastDataTime = Date.now(); this._onDidShellData.fire(plain); }
		});
		// Revalidate once more right before touching the pty.
		if (!this.sessionStillOwns(term)) {
			dataListener.dispose();
			return undefined;
		}
		this.touchInteractiveSession(); // actividad renueva TTL
		term.sendText(payload, true);
		const startTime = Date.now();
		try {
			return await new Promise<ShellCaptureResult | undefined>(resolve => {
				let resolved = false;
				const finish = (val: ShellCaptureResult | undefined) => {
					if (resolved) { return; }
					resolved = true;
					clearInterval(interval);
					clearTimeout(absoluteTimer);
					cmdListener.dispose();
					tokenListener.dispose();
					resolve(val);
				};
				const cmdListener = cd.onCommandFinished(cmd => {
					this.clearInteractiveSession(term);
					finish({ output: outputBuffer.slice(-4000), exitCode: cmd.exitCode });
				});
				const tokenListener = token.onCancellationRequested(() => finish(undefined));
				const interval = setInterval(() => {
					// Otro prompt: silencio tras haber recibido data nueva post-send.
					if (shouldDetectAwaitingInput({
						now: Date.now(),
						startTime,
						lastDataTime,
						minRuntimeMs: 4_000,
						quietAfterOutputMs: 4_000,
					})) {
						finish({ output: outputBuffer.slice(-4000), exitCode: undefined, awaitingInput: true });
					}
				}, 1000);
				// Timeout absoluto: NO afirmar awaiting-input (puede ser hang real).
				const absoluteTimer = setTimeout(() => {
					finish({ output: outputBuffer.slice(-4000), exitCode: undefined, timedOut: true });
				}, timeoutMs);
			});
		} finally {
			dataListener.dispose();
		}
	}

	/** Shows the agent's shared terminal without stealing focus from the composer. Creating the same
	 *  instance before the invoke avoids races between the location event and run_command. */
	async followAgentTerminal(): Promise<void> {
		const term = await this.getAgentTerminal();
		await term.processReady;
		await this.terminalService.showBackgroundTerminal(term);
		this.terminalService.setActiveInstance(term);
	}

	/** "Send to panel": reveals and focuses the agent terminal (or the interactive session) in the dock. */
	async revealAgentTerminalToPanel(): Promise<boolean> {
		const term = this.hasInteractiveSession()
			? this.interactiveSession!.term
			: this.agentTerminal;
		if (!term || term.isDisposed) {
			return false;
		}
		await term.processReady;
		await this.terminalService.showBackgroundTerminal(term);
		this.terminalService.setActiveInstance(term);
		await this.terminalService.focusInstance(term);
		return true;
	}

	private async getAgentTerminal(): Promise<ITerminalInstance> {
		if (this.agentTerminal && !this.agentTerminal.isDisposed) {
			return this.agentTerminal;
		}
		const term = await this.terminalService.createTerminal({ config: { name: 'OpenIDE Agent' } });
		this.agentTerminal = term;
		return term;
	}

	/** Launches a long-running command in a hidden panel terminal (non-blocking).
	 *  Before starting, it KILLS any previous terminal for the SAME command (restarting the dev
	 *  server replaces the old one instead of stacking) and purges finished ones — so they do not pile up
	 *  10 terminales fantasma tras varios intentos. */
	private async startBackgroundCommand(command: string, persistent = false): Promise<string> {
		for (const [oldId, entry] of [...this.bgTerminals]) {
			// Purgar disposed. Mismo comando no-persistent se reemplaza.
			// Live persistent ones for the same command: replaced only if the new one is also
			// persistent (re-levantar dev server en dock); si no, se dejan.
			const sameCmd = entry.command === command;
			const shouldReplace = sameCmd && (!entry.persistent || persistent);
			if (entry.term.isDisposed || shouldReplace) {
				if (!entry.term.isDisposed) {
					entry.term.dispose();
				}
				this.bgTerminals.delete(oldId);
				this._onDidChangeBackgroundTerminal.fire({ id: oldId, command: entry.command, status: 'exited' });
			}
		}
		const term = await this.terminalService.createTerminal({
			config: {
				name: command.slice(0, 40),
				// persistent: visible in the dock from the start. Normal background: hidden until reveal.
				hideFromUser: !persistent,
				// forcePersist helps the dock session survive layout reloads.
				forcePersist: persistent || undefined,
			},
			location: TerminalLocation.Panel,
		});
		await term.processReady;
		const cd = await this.waitForCommandDetection(term);
		const id = this.trackBackgroundTerminal(term, command, undefined, cd, persistent);
		term.sendText(command, true);
		if (!cd && !persistent) {
			// Without shell integration there is no onCommandFinished: leave an exit queued so the
			// terminal closes by itself when the command ends and the tray does not stay alive.
			// For persistent ones we do NOT force exit: the user controls it from the dock.
			term.sendText('exit', true);
		}
		if (persistent) {
			// Make sure it ends up visible and active in the panel (in case hideFromUser was false
			// but the group had not shown it yet).
			await this.terminalService.showBackgroundTerminal(term);
			this.terminalService.setActiveInstance(term);
			return `Iniciado en terminal persistente del dock (id=${id}). La terminal queda visible y NO se cierra al terminar el comando.`;
		}
		return `Iniciado en segundo plano (id=${id}). Seguís sin esperar a que termine; el usuario puede abrir la terminal para ver la salida.`;
	}

	/** Registers an already-live terminal as "background" and wires its output events. */
	private trackBackgroundTerminal(term: ITerminalInstance, command: string, finished?: Promise<{ output: string; exitCode: number | undefined }>, commandDetection?: ICommandDetectionCapability, persistent = false): string {
		const id = generateUuid();
		this.bgTerminals.set(id, { term, command, persistent });
		if (isBackgroundTrayWorthy(command) || persistent) {
			this._onDidChangeBackgroundTerminal.fire({ id, command, status: 'running' });
		}
		let done = false;
		const disposables: { dispose(): void }[] = [];
		const cleanup = () => {
			while (disposables.length) {
				try { disposables.pop()?.dispose(); } catch { /* ignore */ }
			}
		};
		const markExited = (exitCode: number | undefined) => {
			if (done) { return; }
			done = true;
			cleanup();
			// persistent: the terminal stays alive in the dock and the id keeps resolving reveal/kill.
			// No-persistent: dispose + sacar del mapa.
			if (!persistent) {
				this.bgTerminals.delete(id);
				if (!term.isDisposed) {
					term.dispose();
				}
			}
			if (isBackgroundTrayWorthy(command) || persistent) {
				this._onDidChangeBackgroundTerminal.fire({ id, command, status: 'exited', exitCode });
			}
		};
			const exitDisposable = term.onExit(e => markExited(typeof e === 'number' ? e : undefined));
			disposables.push(exitDisposable);
			this._register(exitDisposable);
			const bindCommandDetection = (cd: ICommandDetectionCapability) => {
				const d = cd.onCommandFinished(cmd => { d.dispose(); markExited(cmd.exitCode); });
				disposables.push(d);
				this._register(d);
			};
			if (finished) {
				void finished.then(result => markExited(result.exitCode), () => markExited(undefined));
			} else if (commandDetection) {
				bindCommandDetection(commandDetection);
			} else {
				void this.waitForCommandDetection(term).then(cd => {
					if (!cd || done) { return; }
					bindCommandDetection(cd);
				});
			}
			return id;
		}

	/** Reveals and focuses a background terminal in the IDE panel (click on the chat widget). */
	async revealBackgroundTerminal(id: string): Promise<void> {
		const entry = this.bgTerminals.get(id);
		if (!entry) { return; }
		await this.terminalService.showBackgroundTerminal(entry.term);
		this.terminalService.setActiveInstance(entry.term);
		await this.terminalService.focusInstance(entry.term);
	}

	/** Follow variant: reveals the exact terminal but keeps focus on the chat. */
	async followBackgroundTerminal(id: string): Promise<void> {
		const entry = this.bgTerminals.get(id);
		if (!entry) { return; }
		await this.terminalService.showBackgroundTerminal(entry.term);
		this.terminalService.setActiveInstance(entry.term);
	}

	/** Kills a background terminal (the chat widget's trash button). The already-wired onExit
	 *  emits 'exited', so the UI updates on its own. */
	killBackgroundTerminal(id: string): void {
		const entry = this.bgTerminals.get(id);
		if (entry) {
			entry.term.dispose();
		}
	}

	/** Waits (by polling) for shell integration (command detection) to be ready, with a timeout. */
	private async waitForCommandDetection(term: ITerminalInstance): Promise<ICommandDetectionCapability | undefined> {
		for (let i = 0; i < 25; i++) {
			const cd = term.capabilities.get(TerminalCapability.CommandDetection);
			if (cd) { return cd; }
			await timeout(200);
		}
		return undefined;
	}
}
