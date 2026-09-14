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

import { t } from './../common/openideStrings.js';
import { timeout } from '../../../../base/common/async.js';
import { getOpenideDesignHtml } from './openideDesignHtml.js';
import { DESIGN_TEMPLATES, DesignOperation, DesignTemplate, DesignDocument, DesignFile } from '../common/openideDesign.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { MutableDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
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
	private generation = 0;
	private documentId = '';
	private designReady = false;
	private stateDraft: { documentId: string; revision: number; state: object } | undefined;
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
		this.flushStateDraft();
		const previousDocument = this.documentId;
		await super.setInput(input, options, context, token);
		this.armWatcher();
		if (previousDocument === this.documentId) { await this.reload(); }
	}

	private armWatcher(): void {
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput)) { this.watcher.clear(); return; }
		if (input.resource.scheme === 'openide-canvas') { this.watcher.clear(); return; }
		const store = new DisposableStore();
		const watch = store.add(this.fileService.createWatcher(input.resource, { recursive: false, excludes: [] }));
		store.add(watch.onDidChange(e => { if (e.contains(input.resource)) { if (input.resource.path.endsWith('/design.json')) { void this.refreshDesign(input); } else { void this.reload(); } } }));
		this.watcher.value = store;
	}

	private async renderHtml(): Promise<string> {
		const generation = ++this.generation;
		this.designReady = false;
		const nonce = generateUuid().replace(/-/g, '');
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput)) { return getOpenideCanvasHtml(nonce, undefined, ['No hay un canvas abierto.'], {}); }
		if (input.resource.scheme === 'openide-canvas') { this.documentId = nonce; return getOpenideDesignHtml(nonce); }
		if (input.resource.path.endsWith('/design.json')) {
			try { const html = await this.canvasService.designHtml(input.resource.fsPath, false, nonce); if (generation !== this.generation || input !== this.input) { return ''; } this.documentId = nonce; return html; }
			catch (error) { return generation === this.generation && input === this.input ? getOpenideCanvasHtml(nonce, undefined, [String(error)], {}) : ''; }
		}
		let source = '';
		try { source = (await this.fileService.readFile(input.resource)).value.toString(); } catch (e) { return generation === this.generation && input === this.input ? getOpenideCanvasHtml(nonce, undefined, [e instanceof Error ? e.message : String(e)], {}) : ''; }
		const compiled = this.canvasService.compile(source);
		let state: unknown = {};
		try { state = JSON.parse((await this.fileService.readFile(this.canvasService.stateUri(input.resource))).value.toString()); } catch { /* estado inicial */ }
		if (generation !== this.generation || input !== this.input) { return ''; }
		this.documentId = nonce;
		return getOpenideCanvasHtml(nonce, compiled.code, compiled.errors, state);
	}

	private async reload(): Promise<void> { const html = await this.renderHtml(); if (html) { this.webview?.setHtml(html); } }

	private flushStateDraft(): void { if (this.stateDraft) { this.onMessage({ ...this.stateDraft, type: 'stateWrite' }); } }
	override dispose(): void { this.flushStateDraft(); super.dispose(); }
	override clearInput(): void { this.flushStateDraft(); this.generation++; this.documentId = ''; this.watcher.clear(); super.clearInput(); }

	async capturePreview(): Promise<string> {
		const input = this.input; const deadline = Date.now() + 5000;
		while (!this.designReady && this.input === input && Date.now() < deadline) { await timeout(25); }
		if (!this.designReady || this.input !== input || !(input instanceof OpenideCanvasInput) || !input.resource.path.endsWith('/design.json')) { throw new Error('Open the structured Canvas before capturing it.'); }
		const bounds = this.container?.getBoundingClientRect();
		if (!bounds || bounds.width < 1 || bounds.height < 1) { throw new Error('Canvas is not visible.'); }
		const path = await this.commandService.executeCommand<string>('openide.canvas.capture', { path: input.resource.fsPath, rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } });
		if (!path) { throw new Error('Canvas capture is unavailable.'); }
		return path;
	}
	private async refreshDesign(input: OpenideCanvasInput): Promise<void> {
		const documentId = this.documentId;
		try { const file = await this.canvasService.readDesign(input.resource.fsPath); const assets = await this.canvasService.designAssets(input.resource.fsPath); if (input === this.input && documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, file, assets }); } }
		catch (error) { if (input === this.input && documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, error: String(error) }); } }
	}
	private async designMessage(msg: { type: string; template?: DesignTemplate; title?: string; details?: string; device?: DesignDocument['device']; expectedRevision?: number; operations?: DesignOperation[] | 'undo' | 'redo'; goal?: boolean; format?: 'html'|'pdf'|'pptx'|'svg'|'obj'; kind?: 'image'|'tokens'|'obj'; screenId?: string }, input: OpenideCanvasInput): Promise<void> {
		const documentId = this.documentId;
		try {
			if (msg.type === 'designRequest' && input.resource.scheme === 'openide-canvas') {
				const template = DESIGN_TEMPLATES.find(entry => entry.id === msg.template);
				if (!template || !['desktop', 'tablet', 'mobile'].includes(msg.device ?? '')) { throw new Error('Choose a Canvas format and device.'); }
				const prompt = [
					t('openide.canvas.requestPrompt', template.title, msg.device ?? ''),
					typeof msg.title === 'string' && msg.title.trim() ? t('openide.canvas.requestTitle', msg.title.trim().slice(0, 200)) : '',
					typeof msg.details === 'string' ? msg.details.trim().slice(0, 3000) : '',
				].filter(Boolean).join('\n\n');
				await this.commandService.executeCommand('openide.agent.injectCanvasPrompt', { prompt, send: false });
				if (input === this.input && documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, message: t('openide.canvas.requestReady') }); }
				return;
			}
			const path = input.resource.fsPath;
			if (msg.type === 'designChange') { const file = await this.canvasService.patchDesign(path, msg.expectedRevision!, msg.operations!); if (documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, file }); } }
			else if (msg.type === 'designCapture') { const bounds = this.container?.getBoundingClientRect(); if (bounds) { const path = await this.commandService.executeCommand<string>('openide.canvas.capture', { path: input.resource.fsPath, rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }); if (documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, message: `Captured editor: ${path}` }); } } }
			else if (msg.type === 'designExport') { const exported = await this.canvasService.exportDesign(path, msg.format); if (documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, message: `Exported revision ${exported.revision}: ${exported.path}` }); } }
			else if (msg.type === 'designImport') { const file = await this.commandService.executeCommand<DesignFile>('openide.canvas.import', { path, expectedRevision: msg.expectedRevision, kind: msg.kind, screenId: msg.screenId }); if (file && documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, file }); } }
			else if (msg.type === 'designHandoff') {
				const handoff = await this.canvasService.handoffDesign(path);
				const root = this.contextService.getWorkspace().folders[0]?.uri;
				if (!root || input !== this.input || documentId !== this.documentId) { return; }
				const plan = joinPath(root, '.openide', 'plans', `design-${generateUuid().slice(0,8)}.md`);
				await this.fileService.writeFile(plan, VSBuffer.fromString(handoff.markdown));
				if (msg.goal) { await this.commandService.executeCommand('openide.agent.createGoalFromPlan', { planPath: plan.fsPath, objective: `Implement the design described in ${handoff.path}. Verify its screens, interactions and responsive behavior.` }); }
				else { await this.commandService.executeCommand('openide.plan.open', plan); }
			}
		} catch (error) { if (input === this.input && documentId === this.documentId) { await this.webview?.postMessage({ type: 'designResult', documentId, error: String(error) }); } }
	}

	/** Path relativo al workspace; si el canvas quedara afuera, cae al fsPath. */
	private workspaceRelativePath(resource: URI): string {
		const root = this.contextService.getWorkspace().folders[0];
		const relative = root ? relativePath(root.uri, resource) : undefined;
		return relative && !relative.startsWith('..') ? relative : resource.fsPath;
	}

	protected onMessage(msg: any): void {
		const input = this.input;
		if (!(input instanceof OpenideCanvasInput) || msg.documentId !== this.documentId) { return; }
		if (msg.type === 'designReady') { this.designReady = true; return; }
		if (msg.type?.startsWith('design')) { void this.designMessage(msg, input); return; }
		if (msg.type === 'stateDraft' && msg.state && typeof msg.state === 'object') { this.stateDraft = { documentId: msg.documentId, revision: msg.revision, state: msg.state }; return; }
		if (msg.type === 'stateWrite' && msg.state && typeof msg.state === 'object') {
			if (this.stateDraft?.revision === msg.revision) { this.stateDraft = undefined; }
			const data = JSON.stringify(msg.state, null, 2) + '\n';
			const documentId = this.documentId;
			this.stateWrite = this.stateWrite.then(async () => {
				if (data.length > 1_000_000) { throw new Error('Canvas state exceeds 1 MB.'); }
				await this.fileService.writeFile(this.canvasService.stateUri(input.resource), VSBuffer.fromString(data), { atomic: { postfix: '.canvas-state' } });
				if (documentId === this.documentId) { await this.webview?.postMessage({ type: 'stateSaved', revision: msg.revision }); }
			}).catch(error => { if (documentId === this.documentId) { void this.webview?.postMessage({ type: 'stateSaved', revision: msg.revision, error: String(error) }); } });
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
