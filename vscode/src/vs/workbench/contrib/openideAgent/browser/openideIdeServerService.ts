/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the workbench half of the IDE server. Main owns the socket; this owns the meaning.
 *
 *  Every tool an external CLI can call lands here as an `onDidRequestIdeTool` event and is
 *  executed against the LIVE workbench — the open editors, the real selection, the marker
 *  service — then answered through `ideRespondTool`. Nothing is faked from disk: the whole
 *  point of the agent asking the IDE instead of reading files itself is to see the state the
 *  human sees, unsaved buffers included.
 *
 *  The tool bodies are terse on purpose. Their result shapes are NOT a design of ours (see
 *  openideIdeServer.ts): they are transcribed from the VS Code extension, double JSON encoding
 *  and all, because Claude's prompt already knows how to unpack exactly those. Read `jsonText`
 *  as "the wire says so", not as an accident.
 *
 *  Tier 2 — OpenIDE's own tools (browser/playwright, diagrams, project map, subagents) — is
 *  bridged at the bottom under an `openide_` prefix. Namespacing is what keeps a future compat
 *  tool from colliding with ours, and keeps this file honest about which half is ours to change.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	IDE_NOTIFY_AT_MENTIONED, IDE_NOTIFY_SELECTION_CHANGED,
	IDE_TAB_CLOSED, IIdeDiscoveryStatus, IIdeServerInfo, IIdeToolResult, IIdeToolSchema, ideClosedDiffTabs, jsonText,
	stableIdePort, text, toolError,
} from '../../../../platform/openideAgentHost/common/openideIdeServer.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IToolDefinition } from '../common/openideAgentTypes.js';
import { parseScreenshotMarker } from './openideBrowserTools.js';
import { parseVideoMarker } from '../common/openideBrowserRecorder.js';
import { buildClaudeSessionSettings, IOpenideCliDefinition, IOpenideMcpEndpoint } from '../common/openideAgentCliCatalog.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IPathService } from '../../../services/path/common/pathService.js';

/** Kill switch. This opens a listening socket, so it has to be something a user can refuse. */
export const OPENIDE_IDE_SERVER_SETTING = 'openide.ideServer.enabled';

export const IOpenideIdeServerService = createDecorator<OpenideIdeServerService>('openideIdeServerService');

/** Executes one Tier 2 tool. Registered by whoever owns those tools, not by this file. */
export interface IIdeExtraTool {
	readonly schema: IIdeToolSchema;
	invoke(args: unknown, token: CancellationToken): Promise<IIdeToolResult>;
}

export type OpenideCliIntegrationState = 'preparing' | 'configured' | 'unavailable' | 'manual' | 'failed';

/** Marker severities, spelled the way the VS Code extension reports them. */
function severityName(severity: MarkerSeverity): string {
	switch (severity) {
		case MarkerSeverity.Error: return 'Error';
		case MarkerSeverity.Warning: return 'Warning';
		case MarkerSeverity.Info: return 'Information';
		default: return 'Hint';
	}
}

export class OpenideIdeServerService extends Disposable {

	declare readonly _serviceBrand: undefined;

	private readonly host: IOpenideAgentHostService;
	private info: IIdeServerInfo | undefined;
	private generation = 0;
	private lifecycle: Promise<unknown> = Promise.resolve();
	private readonly pending = new Map<string, CancellationTokenSource>();
	private readonly extraTools = new Map<string, IIdeExtraTool>();

	/**
	 * The last non-empty selection, kept because `getLatestSelection` must survive the user
	 * clicking away. Without it the agent loses its context the moment focus moves to the dock,
	 * which is precisely when it is about to be asked about that context.
	 */
	private lastSelection: unknown | undefined;

	/** Diff tabs opened by `openDiff`, by tab name, so `closeAllDiffTabs` has something to close. */
	private readonly openDiffs = new Map<string, () => void>();

	constructor(
		@IOpenideNativeServices nativeServices: IOpenideNativeServices,
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IPathService private readonly pathService: IPathService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.host = nativeServices.host;
		this._register(this.host.onDidChangeIdeDiscovery(status => {
			this.discovery = status;
			this._onDidChangeIntegration.fire();
		}));

		this._register(this.host.onDidRequestIdeTool(async request => {
			const cancellation = new CancellationTokenSource();
			this.pending.set(request.requestId, cancellation);
			let result: IIdeToolResult;
			try {
				result = await this.invoke(request.tool, request.args, cancellation.token);
			} catch (error) {
				// A thrown tool still has to answer, or the CLI waits on a reply that never comes.
				result = toolError(error instanceof Error ? error.message : String(error));
			}
			this.pending.delete(request.requestId);
			cancellation.dispose();
			await this.host.ideRespondTool(request.requestId, result).catch(() => undefined);
		}));

		this._register(this.host.onDidCancelIdeTool(id => this.pending.get(id)?.cancel()));

		this._register(this.editorService.onDidActiveEditorChange(() => this.publishSelection()));
		this._register(this.codeEditorService.onCodeEditorAdd(editor => {
			const store = new DisposableStore();
			store.add(editor.onDidChangeCursorSelection(() => this.publishSelection()));
			store.add(editor.onDidDispose(() => store.dispose()));
			this._register(store);
		}));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.reset()));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(OPENIDE_IDE_SERVER_SETTING)) { this.reset(); }
		}));
		this._register(toDisposable(() => this.reset()));
	}

	private readonly _onDidChangeIntegration = this._register(new Emitter<void>());
	readonly onDidChangeIntegration = this._onDidChangeIntegration.event;
	private readonly integrations = new Map<string, OpenideCliIntegrationState>();
	private discovery: IIdeDiscoveryStatus = { toolCount: 0 };

	integrationState(sessionId: string): OpenideCliIntegrationState { return this.integrations.get(sessionId) ?? 'unavailable'; }
	get discoveryStatus(): IIdeDiscoveryStatus { return this.discovery; }
	private setIntegration(sessionId: string, state: OpenideCliIntegrationState): void {
		this.integrations.set(sessionId, state);
		this._onDidChangeIntegration.fire();
	}

	private reset(): void {
		this.generation++;
		this.discovery = { toolCount: 0 };
		this.integrations.clear();
		this._onDidChangeIntegration.fire();
		this.info = undefined;
		this.lastSelection = undefined;
		for (const source of this.pending.values()) { source.cancel(); source.dispose(); }
		this.pending.clear();
		this.closeAllDiffTabs();
		this.lifecycle = this.lifecycle.then(() => this.host.ideServerStop()).catch(() => undefined);
	}

	get serverInfo(): IIdeServerInfo | undefined {
		return this.info;
	}

	/**
	 * Tier 2 registration. Safe at any time: connected agents are told to re-list, so a tool
	 * that appears after a session started still reaches it.
	 */
	registerTools(tools: readonly IIdeExtraTool[]): void {
		for (const tool of tools) {
			this.extraTools.set(tool.schema.name, tool);
		}
		void this.host.ideSetExtraTools([...this.extraTools.values()].map(tool => tool.schema)).catch(() => undefined);
	}

	/**
	 * Opens the door. `lockRootDir` follows CLAUDE_CONFIG_DIR when the caller runs the CLI
	 * against a managed home — writing the lockfile under the real `~/.claude` while the agent
	 * reads a managed one is a silent no-connect, and the symptom (nothing happens) points
	 * nowhere useful.
	 */
	async start(ideName: string, lockRootDir?: string): Promise<IIdeServerInfo | undefined> {
		if (this.configurationService.getValue<boolean>(OPENIDE_IDE_SERVER_SETTING) === false) {
			return undefined;
		}
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri.fsPath);
		if (!folders.length) {
			// No folder ⇒ nothing for a CLI to match its cwd against. Refuse rather than publish
			// a lockfile that would adopt agents from unrelated directories.
			return undefined;
		}
		const root = lockRootDir ?? URI.joinPath(this.pathService.userHome({ preferLocal: true }), '.claude').fsPath;
		const schemas = [...this.extraTools.values()].map(tool => tool.schema);
		const generation = this.generation;
		const start = this.lifecycle.then(() => {
			if (generation !== this.generation || this._store.isDisposed) { return undefined; }
			return this.host.ideServerStart({
				ideName,
				workspaceFolders: folders,
				lockRootDir: root,
				// Prefer a familiar address; credentials still belong to this window generation.
				preferredPort: stableIdePort(folders),
			}, schemas);
		});
		this.lifecycle = start.catch(() => undefined);
		try {
			const info = await start;
			if (!info || generation !== this.generation || this._store.isDisposed) { return undefined; }
			this.info = info;
			this.logService.info(`[openide-ide] server ready on port ${this.info.port}`);
			return this.info;
		} catch (error) {
			this.logService.error('[openide-ide] failed to start', error);
			return undefined;
		}
	}

	/**
	 * The env a hosted CLI must be launched with to adopt THIS window rather than a sibling.
	 * Empty unless the server publishes a lockfile — without one there is nothing to point at.
	 */
	/** One-time registration in a CLI that has no per-session config hook. */
	registerInCli(executable: string, args: readonly string[]): Promise<string> {
		return this.host.ideRegisterInCli(executable, args);
	}

	launchEnvironment(): Record<string, string> {
		return this.info?.lockPath ? { CLAUDE_CODE_SSE_PORT: String(this.info.port) } : {};
	}

	/** OpenIDE's own tools, as an MCP endpoint a CLI can be pointed at. */
	mcpEndpoint(): IOpenideMcpEndpoint | undefined {
		if (!this.info) {
			return undefined;
		}
		return {
			name: 'openide',
			url: `http://127.0.0.1:${this.info.port}/mcp`,
			token: this.info.authToken,
			tokenEnvVar: 'OPENIDE_MCP_TOKEN',
		};
	}

	/**
	 * The endpoint plus, for CLIs that want a path, a 0600 config file written for this session.
	 * Falls back to the endpoint alone if the file cannot be written: a CLI that only accepts a
	 * path then simply gets no OpenIDE tools, which is better than one that fails to launch.
	 */
	async mcpEndpointFor(sessionId: string, cli: IOpenideCliDefinition): Promise<IOpenideMcpEndpoint | undefined> {
		if (!cli.mcpInjection) {
			this.setIntegration(sessionId, cli.mcpRegisterArgs ? 'manual' : 'unavailable');
			return undefined;
		}
		this.setIntegration(sessionId, 'preparing');
		if (!this.info) { await this.start('OpenIDE'); }
		const endpoint = this.mcpEndpoint();
		if (!endpoint) { this.setIntegration(sessionId, 'failed'); return undefined; }
		// A distinct server key adds our launch config without shadowing a user's 'openide' entry.
		const generation = this.generation;
		const scoped = { ...endpoint, name: `openide_${this.info!.port}` };
		if (!cli.mcpConfigBuilder) { this.setIntegration(sessionId, 'configured'); return scoped; }
		try {
			const configFile = await this.host.ideWriteMcpConfig(`${sessionId}-${cli.id}`, cli.mcpConfigBuilder(scoped));
			const settingsFile = cli.id === 'claude' ? await this.host.ideWriteMcpConfig(`${sessionId}-claude-guidance`, buildClaudeSessionSettings()) : undefined;
			if (generation !== this.generation || this._store.isDisposed) { return undefined; }
			this.setIntegration(sessionId, 'configured');
			return { ...scoped, configFile, settingsFile };
		} catch (error) {
			this.logService.warn('[openide-ide] could not write the session MCP config', error);
			this.setIntegration(sessionId, 'failed');
			return undefined;
		}
	}

	/**
	 * Bridges OpenIDE's own tools onto this door.
	 *
	 * `definitions` have already passed the exposure policy — this only translates shapes and
	 * hands execution back to the caller. A browser screenshot comes back as OpenIDE's own text
	 * marker, and is unwrapped into a real MCP image block here: leaving it as a base64 blob
	 * inside a text block is the difference between the agent SEEING the page and reading a wall
	 * of characters that costs a fortune and says nothing.
	 */
	bridgeAgentTools(
		definitions: readonly IToolDefinition[],
		invoke: (name: string, argumentsJson: string, token: CancellationToken) => Promise<{ readonly output: string; readonly isError: boolean }>,
		completions?: ReadonlyMap<string, (output: string, token: CancellationToken) => Promise<string>>,
	): void {
		this.registerTools(definitions.map(definition => ({
			schema: {
				name: definition.name,
				description: definition.description,
				inputSchema: definition.parameters as IIdeToolSchema['inputSchema'],
				blocking: completions?.has(definition.name),
			},
			invoke: async (args: unknown, token: CancellationToken): Promise<IIdeToolResult> => {
				const result = await invoke(definition.name, JSON.stringify(args ?? {}), token);
				if (result.isError) { return { ...text(result.output), isError: true }; }
				let output = result.output;
				// A completion turns a tool that merely DID something into one that waits for a
				// person to answer for it. plan_save writes the file and opens the editor; the
				// completion is the review that follows, and its verdict is what the agent reads.
				const completion = completions?.get(definition.name);
				if (completion) {
					output = await completion(output, token);
				}
				const shot = parseScreenshotMarker(output);
				if (shot) {
					return {
						content: [
							{ type: 'image', data: shot.data, mimeType: shot.mimeType },
							...(shot.note ? [{ type: 'text' as const, text: shot.note }] : []),
						],
					};
				}
				// A recorded flow: MCP has no video content type, so the CLI gets the paths in text
				// (a CLI that takes video reads the .webm itself), the contact sheet as one image and
				// the key frames the tool chose to attach as more images.
				const flow = parseVideoMarker(output);
				if (flow) {
					return {
						content: [
							{ type: 'text', text: flow.note },
							{ type: 'image', data: flow.video.sheet.data, mimeType: flow.video.sheet.mimeType },
							...flow.video.keyFrames.filter(frame => !!frame.data).map(frame => ({ type: 'image' as const, data: frame.data!, mimeType: 'image/jpeg' })),
						],
					};
				}
				return text(output);
			},
		})));
	}

	// ---- Selection, pushed to the agent -------------------------------------------------------

	private publishSelection(): void {
		const editor = this.codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		const selection = editor?.getSelection();
		if (!editor || !model || !selection) {
			return;
		}
		const payload = {
			text: model.getValueInRange(selection),
			filePath: model.uri.fsPath,
			fileUrl: model.uri.toString(),
			selection: {
				// The wire is 0-based; Monaco is 1-based. Off by one here means the agent quotes
				// the wrong line back at the user, which reads as a hallucination.
				start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
				end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
				isEmpty: selection.isEmpty(),
			},
		};
		if (!selection.isEmpty()) {
			this.lastSelection = { success: true, ...payload };
		}
		void this.host.ideNotify(IDE_NOTIFY_SELECTION_CHANGED, payload).catch(() => undefined);
	}

	/** "Send this range to the agent" — the explicit push, as opposed to the ambient one above. */
	mention(resource: URI, lineStart: number, lineEnd: number): void {
		void this.host.ideNotify(IDE_NOTIFY_AT_MENTIONED, {
			filePath: resource.fsPath,
			lineStart,
			lineEnd,
		}).catch(() => undefined);
	}

	// ---- Dispatch ------------------------------------------------------------------------------

	private async invoke(tool: string, rawArgs: unknown, token: CancellationToken): Promise<IIdeToolResult> {
		if (token.isCancellationRequested) { return toolError('IDE request cancelled'); }
		const args = (rawArgs ?? {}) as Record<string, unknown>;
		switch (tool) {
			case 'openFile': return this.openFile(args);
			case 'openDiff': return this.openDiff(args, token);
			case 'getCurrentSelection': return this.getCurrentSelection();
			case 'getLatestSelection': return this.getLatestSelection();
			case 'getOpenEditors': return this.getOpenEditors();
			case 'getWorkspaceFolders': return this.getWorkspaceFolders();
			case 'getDiagnostics': return this.getDiagnostics(args);
			case 'checkDocumentDirty': return this.checkDocumentDirty(args);
			case 'saveDocument': return this.saveDocument(args);
			case 'close_tab': return this.closeTab(args);
			case 'closeAllDiffTabs': return this.closeAllDiffTabs();
			case 'executeCode': return toolError('executeCode requires a Jupyter kernel, which OpenIDE does not host');
			default: {
				const extra = this.extraTools.get(tool);
				if (!extra) {
					return toolError(`unknown tool: ${tool}`);
				}
				return extra.invoke(rawArgs, token);
			}
		}
	}

	private resolvePath(value: unknown): URI | undefined {
		const path = typeof value === 'string' ? value : '';
		if (!path) {
			return undefined;
		}
		return URI.file(path);
	}

	private async openFile(args: Record<string, unknown>): Promise<IIdeToolResult> {
		const resource = this.resolvePath(args['filePath']);
		if (!resource) {
			return toolError('missing filePath');
		}
		const makeFrontmost = args['makeFrontmost'] !== false;
		const pane = await this.editorService.openEditor({
			resource,
			// `preview` on the wire is VS Code's non-pinned tab, and makeFrontmost=false is
			// exactly `inactive` — open it, do not steal the tab the user is looking at.
			options: { pinned: args['preview'] !== true, inactive: !makeFrontmost },
		});
		if (makeFrontmost) {
			return text(`Opened file: ${resource.fsPath}`);
		}
		const model = this.codeEditorService.listCodeEditors().find(editor => editor.getModel()?.uri.toString() === resource.toString())?.getModel();
		return jsonText({
			success: !!pane,
			filePath: resource.fsPath,
			languageId: model?.getLanguageId() ?? 'plaintext',
			lineCount: model?.getLineCount() ?? 0,
		});
	}

	/**
	 * The one blocking tool: it parks until a human decides, and main holds the JSON-RPC id open
	 * meanwhile. Two outcomes only — the sentinel strings the CLI branches on.
	 *
	 * Today it opens the proposal as a normal diff against the file on disk and resolves when the
	 * tab closes. Accepting still goes through OpenIDE's own review surface
	 * (openideEditReview.ts), so a rejection here is genuinely "the user did not take it".
	 */
	private async openDiff(args: Record<string, unknown>, token: CancellationToken): Promise<IIdeToolResult> {
		const original = this.resolvePath(args['old_file_path']);
		const modified = this.resolvePath(args['new_file_path']);
		const tabName = typeof args['tab_name'] === 'string' ? args['tab_name'] : 'Proposed changes';
		if (!original || !modified) {
			return toolError('openDiff needs old_file_path and new_file_path');
		}
		const proposed = String(args['new_file_contents'] ?? '');
		// The proposal is content that does not exist on disk yet, so it travels as an untitled
		// buffer seeded with it rather than as a file we would have to write first — writing it
		// would be the very decision this call is asking the user to make.
		const scratch = await this.textFileService.untitled.resolve({ initialValue: proposed, associatedResource: undefined });
		const store = new DisposableStore();
		try {
			if (token.isCancellationRequested) { return text('DIFF_REJECTED'); }
			await this.editorService.openEditor({
				original: { resource: original },
				modified: { resource: scratch.resource },
				label: tabName,
			});
			return await new Promise<IIdeToolResult>(resolve => {
				let settled = false;
				const finish = (value: string) => {
					if (settled) {
						return;
					}
					settled = true;
					this.openDiffs.delete(tabName);
					store.dispose();
					resolve(text(value));
				};
				if (token.isCancellationRequested) { store.dispose(); resolve(text('DIFF_REJECTED')); return; }
				this.openDiffs.get(tabName)?.();
				this.openDiffs.set(tabName, () => finish('DIFF_REJECTED'));
				store.add(token.onCancellationRequested(() => finish('DIFF_REJECTED')));
				if (token.isCancellationRequested) { finish('DIFF_REJECTED'); return; }
				store.add(this.editorService.onDidCloseEditor(event => {
					if (event.editor.resource?.toString() === scratch.resource.toString()) {
						// Saved-then-closed and closed-outright are the same event; the dirty flag
						// is what separates "took it" from "walked away".
						finish(scratch.isDirty() ? 'DIFF_REJECTED' : 'FILE_SAVED');
					}
				}));
			});
		} catch (error) {
			store.dispose();
			return toolError(error instanceof Error ? error.message : String(error));
		} finally {
			scratch.dispose();
		}
	}

	private getCurrentSelection(): IIdeToolResult {
		const editor = this.codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		const selection = editor?.getSelection();
		if (!editor || !model || !selection) {
			return jsonText({ success: false, message: 'No active editor found' });
		}
		return jsonText({
			success: true,
			text: model.getValueInRange(selection),
			filePath: model.uri.fsPath,
			selection: {
				start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
				end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
			},
		});
	}

	private getLatestSelection(): IIdeToolResult {
		return this.lastSelection
			? jsonText(this.lastSelection)
			: jsonText({ success: false, message: 'No selection available' });
	}

	private getOpenEditors(): IIdeToolResult {
		const active = this.editorService.activeEditor;
		const tabs = this.editorService.editors
			.filter(editor => !!editor.resource)
			.map(editor => {
				const resource = editor.resource!;
				const model = this.codeEditorService.listCodeEditors().find(code => code.getModel()?.uri.toString() === resource.toString())?.getModel();
				return {
					uri: resource.toString(),
					isActive: editor === active,
					label: editor.getName(),
					languageId: model?.getLanguageId() ?? 'plaintext',
					isDirty: editor.isDirty(),
				};
			});
		return jsonText({ tabs });
	}

	private getWorkspaceFolders(): IIdeToolResult {
		const folders = this.contextService.getWorkspace().folders.map(folder => ({
			name: folder.name,
			uri: folder.uri.toString(),
			path: folder.uri.fsPath,
		}));
		return jsonText({ success: true, folders, rootPath: folders[0]?.path });
	}

	private getDiagnostics(args: Record<string, unknown>): IIdeToolResult {
		const raw = typeof args['uri'] === 'string' ? args['uri'] : undefined;
		const resource = raw ? URI.parse(raw) : undefined;
		const markers = this.markerService.read(resource ? { resource } : {});
		const byFile = new Map<string, unknown[]>();
		for (const marker of markers) {
			const key = marker.resource.toString();
			const list = byFile.get(key) ?? [];
			list.push({
				message: marker.message,
				severity: severityName(marker.severity),
				range: {
					start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
					end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
				},
				source: marker.source,
			});
			byFile.set(key, list);
		}
		return jsonText([...byFile].map(([uri, diagnostics]) => ({ uri, diagnostics })));
	}

	private checkDocumentDirty(args: Record<string, unknown>): IIdeToolResult {
		const resource = this.resolvePath(args['filePath']);
		if (!resource) {
			return toolError('missing filePath');
		}
		const model = this.textFileService.files.get(resource);
		if (!model) {
			return jsonText({ success: false, message: `Document not open: ${resource.fsPath}` });
		}
		return jsonText({ success: true, filePath: resource.fsPath, isDirty: model.isDirty(), isUntitled: false });
	}

	private async saveDocument(args: Record<string, unknown>): Promise<IIdeToolResult> {
		const resource = this.resolvePath(args['filePath']);
		if (!resource) {
			return toolError('missing filePath');
		}
		if (!this.textFileService.files.get(resource)) {
			return jsonText({ success: false, message: `Document not open: ${resource.fsPath}` });
		}
		await this.textFileService.save(resource);
		return jsonText({ success: true, filePath: resource.fsPath, saved: true, message: 'Document saved successfully' });
	}

	private async closeTab(args: Record<string, unknown>): Promise<IIdeToolResult> {
		const name = typeof args['tab_name'] === 'string' ? args['tab_name'] : '';
		const diff = this.openDiffs.get(name);
		if (diff) {
			diff();
			return text(IDE_TAB_CLOSED);
		}
		const editor = this.editorService.editors.find(candidate => candidate.getName() === name);
		if (editor) {
			await this.editorService.closeEditor({ editor, groupId: this.editorService.activeEditorPane?.group.id ?? 0 });
		}
		return text(IDE_TAB_CLOSED);
	}

	private closeAllDiffTabs(): IIdeToolResult {
		const count = this.openDiffs.size;
		for (const close of [...this.openDiffs.values()]) {
			close();
		}
		return text(ideClosedDiffTabs(count));
	}
}
