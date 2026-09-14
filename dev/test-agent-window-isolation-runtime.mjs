// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-isolation-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-window-isolation-'));
const output = path.join(root, '.build/agent-window-isolation-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace/follow.ts'), 'export const agentWindowOnly = true;\n');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	// Electron handles beforeunload itself, including nested preview webContents.
	app.context().on('dialog', dialog => { if (dialog.type() !== 'beforeunload') { void dialog.dismiss(); } });
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({ base, workspace }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IEditorGroupsService } = await import(base + 'workbench/services/editor/common/editorGroupsService.js');
		const { IWorkbenchLayoutService, Parts } = await import(base + 'workbench/services/layout/browser/layoutService.js');
		const { INativeHostService } = await import(base + 'platform/native/common/native.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		const { IOpenideChatRuntime } = await import(base + 'workbench/contrib/openideAgent/browser/openideChatRuntime.js');
		const { IOpenideIdeServerService } = await import(base + 'workbench/contrib/openideAgent/browser/openideIdeServerService.js');
		const { getOpenideCli } = await import(base + 'workbench/contrib/openideAgent/common/openideAgentCliCatalog.js');
		const { URI } = await import(base + 'base/common/uri.js');
		const { CancellationToken } = await import(base + 'base/common/cancellation.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.windowIsolation', title: 'Window Isolation Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService), views = accessor.get(IViewsService);
				const editors = accessor.get(IEditorService), groups = accessor.get(IEditorGroupsService), layout = accessor.get(IWorkbenchLayoutService);
				const nativeHost = accessor.get(INativeHostService);
				const agent = accessor.get(IOpenideAgentService), runtime = accessor.get(IOpenideChatRuntime), ideServer = accessor.get(IOpenideIdeServerService);
				layout.setPartHidden(true, Parts.AUXILIARYBAR_PART);
				layout.setPartHidden(true, Parts.PANEL_PART);
				const snapshot = () => ({
					editors: groups.mainPart.groups.flatMap(group => group.editors.map(editor => editor.resource?.toString() ?? editor.typeId)),
					chat: views.isViewVisible('workbench.view.openideChat.view'),
					auxiliary: layout.isVisible(Parts.AUXILIARYBAR_PART), panel: layout.isVisible(Parts.PANEL_PART),
				});
				const mutations = [];
				const original = JSON.stringify(snapshot());
				const record = () => { const value = snapshot(); if (JSON.stringify(value) !== original) { mutations.push(value); } };
				const subscriptions = [layout.onDidChangePartVisibility(record), editors.onDidEditorsChange(record)];
				let emit, settle;
				const runs = [];
				agent.getActiveProviderId = () => 'fixture-provider';
				agent.getModel = () => 'fixture-model';
				agent.buildMentionContext = async () => undefined;
				agent.hookUserPromptSubmit = async () => undefined;
				agent.runMessages = (_messages, onEvent, _token, options) => {
					runs.push(options); emit = onEvent;
					return new Promise(resolve => { settle = resolve; });
				};
				agent.setPlanFollowEnabled(true);
				window.windowIsolation = {
					snapshot, mutations, runs,
					conversation: () => ({ id: runtime.widget.sessionStore.activeSessionId(), messages: runtime.widget.sessionStore.messagesOf(runtime.widget.sessionStore.activeSessionId()).map(message => ({ role: message.role, content: message.content })) }),
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					seed: () => {
						const widget = runtime.widget;
						const id = widget.sessionStore.createBackground('Isolation conversation', [{ role: 'user', content: 'Shared history' }, { role: 'assistant', content: 'History stays synchronized' }]);
						widget.refreshSessions(); widget.openSession(id);
					},
					emit: event => emit(event),
					plan: () => agent.tools.getTool('plan_save').invoke({ title: 'Isolation plan', markdown: '# Isolation plan\n\nKeep artifact presentation in the originating window.' }, CancellationToken.None, { targetWindowId: runs[0].targetWindowId }),
					canvas: () => agent.tools.getTool('canvas_write').invoke({ name: 'isolation-canvas', content: "import { Card, CardBody } from 'openide/canvas'; export default function App() { return <Card><CardBody>Isolation canvas</CardBody></Card>; }", auto_open: true }, CancellationToken.None, { targetWindowId: runs[0].targetWindowId }),
					design: () => agent.tools.getTool('canvas_create').invoke({ template: 'wireframe', title: 'Isolation design', device: 'desktop' }, CancellationToken.None, { targetWindowId: runs[0].targetWindowId }),
					cliEndpoint: () => ideServer.mcpEndpointFor('fixture-agent-cli', getOpenideCli('codex'), undefined, workspace, runs[0].targetWindowId),
					artifacts: async () => (await agent.resolveEditorTarget(runs[0].targetWindowId)).editors.map(editor => ({ typeId: editor.typeId, resource: editor.resource?.path })),
					lateOpens: async () => {
						const targetWindowId = runs[0].targetWindowId;
						await nativeHost.closeWindow({ targetWindowId });
						await agent.followAgentLocation({ kind: 'file', path: 'follow.ts', activity: 'edit', review: false }, CancellationToken.None, targetWindowId);
						await agent.openDiff('follow.ts', undefined, targetWindowId);
						try { await commands.executeCommand('openide.browser.open', 'http://localhost:5173', { preserveFocus: true, targetWindowId }); } catch (error) { if (!String(error).includes('preview window has closed')) { throw error; } }
					},
					finish: () => { emit({ type: 'done' }); settle(); },
					injectCanvasPrompt: () => commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Manual companion canvas prompt', send: false }),
					manualChat: () => views.openView('workbench.view.openideChat.view', true),
					manualFile: () => editors.openEditor({ resource: URI.file(workspace + '/follow.ts'), options: { pinned: true } }),
					stopRecording: () => subscriptions.forEach(subscription => subscription.dispose()),
				};
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, workspace: path.join(tmp, 'workspace') });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Window Isolation Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Window Isolation Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.windowIsolation);
	const before = await ide.evaluate(() => window.windowIsolation.snapshot());
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.windowIsolation.open());
	let agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));
	// Electron handles native unload vetoes itself; avoid Playwright auto-accepting them.
	agent.on('dialog', () => {});
	await agent.locator('.openide-agent-window textarea.openide-chat-prompt').waitFor();
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.snapshot()), before, 'opening Agents does not reveal the IDE chat');
	await ide.evaluate(() => window.windowIsolation.seed());
	await agent.getByText('History stays synchronized', { exact: true }).waitFor();
	await agent.locator('textarea.openide-chat-prompt').fill('Run only in the agent window');
	await agent.locator('textarea.openide-chat-prompt').press('Enter');
	await ide.waitForFunction(() => window.windowIsolation.runs.length === 1);
	await ide.evaluate(() => window.windowIsolation.emit({ type: 'text', delta: 'Live agent answer' }));
	await agent.getByText('Live agent answer', { exact: true }).waitFor();
	// A focus change during the turn must not redirect follow effects to the main IDE.
	await ide.bringToFront();
	await ide.evaluate(() => window.windowIsolation.emit({ type: 'agentLocation', location: { kind: 'file', path: 'follow.ts', line: 1, activity: 'edit', review: false } }));
	await agent.locator('.openide-agent-window-workspace .view-lines').filter({ hasText: 'agentWindowOnly' }).first().waitFor();
	await ide.evaluate(() => window.windowIsolation.emit({ type: 'agentLocation', location: { kind: 'browser', activity: 'open' } }));
	await agent.locator('.openide-agent-window-workspace .browser-container').waitFor();
	await ide.evaluate(() => window.windowIsolation.emit({ type: 'agentLocation', location: { kind: 'terminal', command: 'echo fixture', background: false } }));
	const planResult = await ide.evaluate(() => window.windowIsolation.plan());
	assert.match(planResult, /^OK:/);
	await agent.locator('.openide-agent-window-workspace .openide-plan').filter({ hasText: 'Isolation plan' }).waitFor();
	await ide.evaluate(() => window.windowIsolation.canvas());
	const artifacts = await ide.evaluate(() => window.windowIsolation.artifacts());
	assert(artifacts.some(editor => editor.resource?.endsWith('/.openide/plans/isolation-plan.md')), 'saved plan uses companion editor group');
	assert(artifacts.some(editor => editor.typeId === 'workbench.input.openideCanvas' && editor.resource?.endsWith('/.openide/canvases/isolation-canvas.canvas.tsx')), 'canvas auto-open uses companion editor group');
	const design = JSON.parse(await ide.evaluate(() => window.windowIsolation.design()));
	assert((await ide.evaluate(() => window.windowIsolation.artifacts())).some(editor => editor.typeId === 'workbench.input.openideCanvas' && editor.resource?.endsWith('/' + design.path)), 'structured canvas uses companion editor group');
	// The hosted CLI transport must carry its launch window even when the IDE owns focus.
	const endpoint = await ide.evaluate(() => window.windowIsolation.cliEndpoint());
	assert(endpoint, 'session-scoped MCP endpoint is available');
	let requestId = 0;
	async function rpc(method, params) {
		const response = await fetch(endpoint.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload.error, undefined, 'MCP request succeeds');
		return payload.result;
	}
	await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'window-isolation', version: '1' } });
	await ide.bringToFront();
	const cliOpen = await rpc('tools/call', { name: 'openFile', arguments: { filePath: path.join(tmp, 'workspace/follow.ts') } });
	assert.equal(cliOpen.isError ?? false, false, `CLI opens through its scoped editor: ${JSON.stringify(cliOpen)}`);
	await agent.locator('.openide-agent-window-workspace .view-lines').filter({ hasText: 'agentWindowOnly' }).first().waitFor();
	await ide.evaluate(() => window.windowIsolation.finish());
	await agent.locator('.openide-composer-send.running').waitFor({ state: 'hidden' });
	await agent.bringToFront();
	await agent.locator('textarea.openide-chat-prompt').click();
	await ide.evaluate(() => window.windowIsolation.injectCanvasPrompt());
	assert.equal(await agent.locator('textarea.openide-chat-prompt').inputValue(), 'Manual companion canvas prompt', 'manual Canvas action fills the companion composer');
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.snapshot()), before, 'run effects and manual companion actions leave IDE editors and panels untouched');
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.mutations), [], 'no transient open-and-hide in the main IDE');
	await ide.screenshot({ path: path.join(output, 'ide-undisturbed.png') });
	await agent.screenshot({ path: path.join(output, 'agent-follow.png') });
	const conversation = await ide.evaluate(() => window.windowIsolation.conversation());
	const closed = agent.waitForEvent('close');
	await (await app.browserWindow(agent)).evaluate(nativeWindow => nativeWindow.close());
	await closed;
	await ide.evaluate(() => window.windowIsolation.lateOpens());
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.snapshot()), before, 'closing Agents and late opens do not move any view into the IDE');
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.mutations), [], 'no transient main IDE opens during unload');
	console.log('PASS: closing Agents and late native close/file/diff/browser effects keep IDE unchanged');
	const reopened = app.waitForEvent('window');
	await ide.evaluate(() => window.windowIsolation.open());
	agent = await reopened;
	agent.on('pageerror', error => errors.push(error.message));
	agent.on('dialog', () => {});
	await agent.locator('textarea.openide-chat-prompt').waitFor();
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.conversation()), conversation, 'reopening preserves the selected conversation and full history');
	await ide.evaluate(() => window.windowIsolation.stopRecording());
	await ide.evaluate(() => window.windowIsolation.manualChat());
	assert.deepEqual(await ide.evaluate(() => window.windowIsolation.conversation()), conversation, 'manual IDE opening shares the same conversation');
	await ide.getByText('Live agent answer', { exact: true }).waitFor();
	await ide.locator('textarea.openide-chat-prompt').fill('Manual IDE draft');
	await agent.waitForFunction(() => document.querySelector('textarea.openide-chat-prompt').value === 'Manual IDE draft');
	await ide.evaluate(() => window.windowIsolation.manualFile());
	await ide.locator('.part.editor .view-lines').filter({ hasText: 'agentWindowOnly' }).first().waitFor();
	assert.deepEqual(errors, []);
	console.log('PASS: Agents startup, shared transcript, run-origin file/browser follow after focus change, terminal follow, native plan/canvas artifacts, scoped CLI MCP file opening, Canvas-to-chat action, and completion leave IDE untouched; manual IDE chat/file opening and shared drafts still work.');
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
