/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE Canvas editor — transpiles one .canvas.tsx, mounts it in an isolated webview and
 *  recompiles on save. Persistent hook state is stored in the adjacent .canvas.data.json.
 *
 *  NOTE (2026-08): a native `<iframe sandbox>` migration was attempted and reverted. A child
 *  iframe embedded in the workbench INHERITS the workbench CSP (`require-trusted-types-for
 *  'script'` + a locked `script-src`), so neither `srcdoc` nor `blob:` inline scripts run and the
 *  canvas runtime never executes. `IWebviewService` is the sandbox that serves the frame from a
 *  separate origin with its OWN CSP header — the correct tool for executing untrusted transpiled
 *  TSX, so the canvas keeps using it.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { OpenideOverlayWebviewEditor } from './openideOverlayEditor.js';
import { OpenideCanvasInput } from './openideCanvasInput.js';
import { IOpenideCanvasService } from './openideCanvasService.js';
import { getOpenideCanvasHtml } from './openideCanvasHtml.js';
import { IOpenideAgentService } from './openideAgentService.js';

export class OpenideCanvasEditor extends OpenideOverlayWebviewEditor {
	static readonly ID = 'workbench.editor.openideCanvas';
	protected readonly viewType = 'openideCanvas';
	protected readonly webviewTitle = 'Canvas';
	private readonly watcher = this._register(new MutableDisposable());
	private stateWrite: Promise<void> = Promise.resolve();

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService webviewService: IWebviewService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IFileService private readonly fileService: IFileService,
		@IOpenideCanvasService private readonly canvasService: IOpenideCanvasService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
	) { super(OpenideCanvasEditor.ID, group, telemetryService, themeService, storageService, webviewService, layoutService, editorGroupsService); }

	protected async buildHtml(): Promise<string> { return this.renderHtml(); }

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.armWatcher();
		await this.reload();
	}

	private armWatcher(): void {
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput)) { this.watcher.clear(); return; }
		this.watcher.value = this.fileService.onDidFilesChange(e => { if (e.contains(input.resource)) { void this.reload(); } });
	}

	private async renderHtml(): Promise<string> {
		const nonce = generateUuid().replace(/-/g, '');
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput)) { return getOpenideCanvasHtml(nonce, undefined, ['No hay un canvas abierto.'], {}); }
		let source = '';
		try { source = (await this.fileService.readFile(input.resource)).value.toString(); } catch (e) { return getOpenideCanvasHtml(nonce, undefined, [e instanceof Error ? e.message : String(e)], {}); }
		const compiled = this.canvasService.compile(source);
		let state: unknown = {};
		try { state = JSON.parse((await this.fileService.readFile(this.canvasService.stateUri(input.resource))).value.toString()); } catch { /* estado inicial */ }
		return getOpenideCanvasHtml(nonce, compiled.code, compiled.errors, state);
	}

	private async reload(): Promise<void> { this.webview?.setHtml(await this.renderHtml()); }

	/** Path relativo al workspace; si el canvas quedara afuera, cae al fsPath. */
	private workspaceRelativePath(resource: URI): string {
		const root = this.contextService.getWorkspace().folders[0];
		const relative = root ? relativePath(root.uri, resource) : undefined;
		return relative && !relative.startsWith('..') ? relative : resource.fsPath;
	}

	protected onMessage(msg: any): void {
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput)) { return; }
		if (msg.type === 'stateWrite' && msg.state && typeof msg.state === 'object') {
			const data = JSON.stringify(msg.state, null, 2) + '\n';
			this.stateWrite = this.stateWrite.then(async () => { await this.fileService.writeFile(this.canvasService.stateUri(input.resource), VSBuffer.fromString(data)); }).catch(() => undefined);
			return;
		}
		if (msg.type !== 'action' || !msg.action || typeof msg.action !== 'object') { return; }
		const action = msg.action;
		if (action.type === 'openFile' && typeof action.path === 'string') {
			const folders = this.contextService.getWorkspace().folders;
			const root = folders[0];
			if (!root) { return; }
			const resource = action.path.startsWith('/') ? URI.file(action.path) : joinPath(root.uri, action.path);
			// Only open files INSIDE the workspace: a canvas cannot open arbitrary host paths.
			const rel = relativePath(root.uri, resource);
			if (!rel || rel.startsWith('..')) { return; }
			void this.commandService.executeCommand('vscode.open', resource);
		}
		else if (action.type === 'openLink' && typeof action.url === 'string') {
			let uri: URI;
			try { uri = URI.parse(action.url); } catch { return; }
			// Restrict to safe navigation schemes: never file/vscode-file/smb or other host ones.
			if (uri.scheme !== 'http' && uri.scheme !== 'https' && uri.scheme !== 'mailto') { return; }
			try { void this.openerService.open(uri, { openExternal: true }); } catch { /* inválido */ }
		}
		else if (action.type === 'designPick' && typeof action.selector === 'string' && typeof action.html === 'string') {
			// Same contract as the browser's Pick & Polish: the chat attaches it to the next
			// message through the path that already exists, and shows the selector chip.
			const rect = action.rect && typeof action.rect === 'object' ? action.rect : { x: 0, y: 0, width: 0, height: 0 };
			const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
			this.agentService.reportPickedElement({
				selector: action.selector.slice(0, 400),
				html: action.html.slice(0, 4000),
				styles: typeof action.styles === 'string' ? action.styles.slice(0, 2000) : '',
				rect: { x: number(rect.x), y: number(rect.y), w: number(rect.width), h: number(rect.height) },
				// The path identifies the canvas AND tells the chat this pick is not from the browser.
				pageUrl: this.workspaceRelativePath(input.resource),
			});
		}
		else if (action.type === 'runPrompt' && typeof action.prompt === 'string') {
			const prompt = action.prompt.trim().slice(0, 4000);
			if (prompt) { void this.commandService.executeCommand('openide.agent.injectCanvasPrompt', { prompt, send: action.send !== false, canvas: this.workspaceRelativePath(input.resource) }); }
		}
		else if (action.type === 'toggleFullscreen') {
			// Presentation: maximize the editor group, which is the native equivalent of
			// "full-screen viewing" and is reverted with the same command.
			void this.commandService.executeCommand('workbench.action.toggleMaximizeEditorGroup');
		}
		else if (action.type === 'newComposerChat') { void this.commandService.executeCommand('openide.agent.newChat'); }
		else if (action.type === 'canvasChoice' && typeof action.choiceId === 'string' && typeof action.label === 'string') {
			const choiceId = action.choiceId.trim().slice(0, 160);
			const label = action.label.trim().slice(0, 1000);
			if (choiceId && label) { void this.commandService.executeCommand('openide.agent.injectCanvasChoice', { choiceId, label, canvas: input.resource.fsPath }); }
		}
	}
}
