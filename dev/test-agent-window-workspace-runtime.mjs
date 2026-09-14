// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-workspace-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') {
	throw new Error('Use dev/run-virtual-gui.mjs');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-window-'));
const output = path.join(root, '.build/agent-window-workspace-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace/src/nested'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace/src/nested/component.ts'), 'export const fromAgentFiles = true;\n');
fs.writeFileSync(path.join(tmp, 'workspace/hidden.txt'), 'Excluded');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'files.exclude': { '**/hidden.txt': true },
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
let app;
const runtimeErrors = [];
const observeErrors = page => {
	page.on('pageerror', error => { runtimeErrors.push(error.message); console.error(error); });
	page.on('console', message => {
		if (message.type() === 'error' && !message.text().includes('No default agent registered')) {
			runtimeErrors.push(message.text()); console.error(message.text());
		}
	});
};
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	observeErrors(ide);
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { OpenideAgentConversationInput } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentConversationEditor.js');
		const { IEditorGroupsService } = await import(base + 'workbench/services/editor/common/editorGroupsService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentWindow', title: 'Agent Window Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService);
				const views = accessor.get(IViewsService);
				const editors = accessor.get(IEditorService), groups = accessor.get(IEditorGroupsService);
				const agent = accessor.get(IOpenideAgentService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Agent window fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value;
				const sessions = view._widget.value.sessionStore;
				const first = sessions.createBackground('Window fixture first', [{ role: 'user', content: 'First shared conversation', messageId: 'first-message' }, { role: 'assistant', content: 'First shared answer' }]);
				const second = sessions.createBackground('Window fixture second', [{ role: 'user', content: 'Second shared conversation', messageId: 'second-message' }, { role: 'assistant', content: 'Second shared answer' }]);
				widget.refreshSessions();
				widget.openSession(second);
				for (let index = 0; index < 24; index++) {
					const changed = index === 0 ? 'src/nested/component.ts' : `src/change-${index}.ts`;
					agent.diffSnapshot.setBaselineOnce(changed, '', false);
					agent.diffSnapshot.markPending(changed, true, index + 1, index % 3);
				}
				const runs = [];
				const approvals = [];
				let emit;
				let settle;
				let cancelled = false;
				// The actual controller and both renderers remain real; only provider execution is isolated.
				agent.getActiveProviderId = () => 'fixture-provider';
				agent.getModel = () => 'fixture-model';
				agent.buildMentionContext = async () => undefined;
				agent.hookUserPromptSubmit = async () => undefined;
				agent.runMessages = (messages, onEvent, token, options) => {
					runs.push(options);
					emit = onEvent;
					token.onCancellationRequested(() => { cancelled = true; settle?.(); });
					return new Promise(resolve => { settle = resolve; });
				};
				agent.resolveApproval = (id, answer) => {
					approvals.push({ id, answer });
					emit({ type: 'approval', name: 'run_command', decision: answer.decision ?? answer });
				};
				window.agentWindowFixture = {
					openConversation: async () => { await editors.openEditor(new OpenideAgentConversationInput(first, widget), { pinned: true }, groups.groups.find(group => group.windowId !== window.vscodeWindowId)); },
					updateConversation: () => sessions.save(first,[...sessions.messagesOf(first),{role:'assistant',content:'Live subagent update'}],false),
					activeFile: () => editors.activeEditor?.resource?.path,
					seedReview: () => agent._onDidChangeFileDiff.fire({ path: 'src/nested/component.ts', added: 1, removed: 0 }),
					deleteStored: id => sessions.delete(id),
					first, second, runs, approvals,
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					active: () => widget.controller.activeConversationId,
					busy: () => widget.controller.isBusy,
					cancelled: () => cancelled,
					emit: event => emit(event),
					finish: () => { emit({ type: 'done' }); settle(); },
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Window Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Window Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentWindowFixture);
	const openWindow = async () => {
		const opened = app.waitForEvent('window', { timeout: 30000 });
		await ide.locator('.part.titlebar .openide-window-switcher').click();
		const page = await opened;
		observeErrors(page);
		await page.locator('.openide-agent-window .openide-chat-native').filter({ has: page.locator('.openide-chat-input-card') }).waitFor();
		return page;
	};

 const agent = await openWindow();
 assert.equal(await agent.locator('.openide-agent-conversation-body > .openide-agent-window-context').count(), 1);
 assert.equal(await agent.locator('.openide-agent-window-workspace').isVisible(), false);
 assert.equal(await agent.locator('.openide-agent-window-actions > button').count(), 4);
 await agent.setViewportSize({width:1440,height:900});
 await agent.screenshot({path:path.join(output,'environment.png')});
 await agent.getByRole('button',{name:'Toggle workspace panel',exact:true}).click();
 await agent.getByRole('button',{name:'Open view',exact:true}).first().click();
 await agent.locator('.openide-menu:visible').getByText('Files',{exact:true}).click();
 await agent.locator('.openide-files-editor').waitFor();
 await agent.getByRole('tree',{name:'Files',exact:true}).getByText('src',{exact:true}).click();
 await agent.getByRole('tree',{name:'Files',exact:true}).getByText('nested',{exact:true}).click();
 await agent.getByRole('tree',{name:'Files',exact:true}).getByText('component.ts',{exact:true}).click();
 await agent.locator('.openide-agent-window-workspace .monaco-editor').first().waitFor();
 await agent.locator('.openide-agent-window-workspace .view-lines').filter({hasText:'fromAgentFiles'}).first().waitFor();
 assert.equal(await agent.locator('.openide-agent-window-context').isVisible(), false);
 await agent.screenshot({path:path.join(output,'editor.png')});
 await agent.getByRole('button',{name:'Minimize to environment',exact:true}).click();
 await agent.locator('.openide-agent-window-context').waitFor();
 await agent.locator('.openide-agent-window-views').getByRole('button',{name:'component.ts',exact:true}).click();
 await agent.locator('.embedded-editor').waitFor();
 await agent.getByRole('button',{name:'Open in modal',exact:true}).click();
 await agent.locator('.monaco-modal-editor-block:not(.embedded-editor)').waitFor();
 await agent.getByRole('button',{name:'Return to workspace panel',exact:true}).click();
 await agent.locator('.embedded-editor').waitFor();
 assert.equal(await agent.locator('.monaco-modal-editor-block:not(.embedded-editor)').count(),0);
 await ide.evaluate(() => window.agentWindowFixture.openConversation());
 await agent.locator('.openide-agent-conversation-editor').waitFor();
 await agent.locator('.openide-agent-conversation-editor').getByText('First shared answer',{exact:true}).waitFor();
 assert.equal(await ide.evaluate(() => window.agentWindowFixture.active()),await ide.evaluate(() => window.agentWindowFixture.second));
 await ide.evaluate(() => window.agentWindowFixture.updateConversation());
 await agent.locator('.openide-agent-conversation-editor').getByText('Live subagent update',{exact:true}).waitFor();
 await agent.screenshot({path:path.join(output,'subagent.png')});
 await agent.getByRole('button',{name:'Minimize to environment',exact:true}).click();
 await agent.locator('.openide-agent-window-views').getByRole('button',{name:'component.ts',exact:true}).click();
 await agent.locator('.openide-agent-window-workspace .view-lines').filter({hasText:'fromAgentFiles'}).first().waitFor();
 await agent.getByRole('button',{name:'Minimize to environment',exact:true}).click();
 await agent.locator('.openide-agent-window-views').getByRole('button',{name:'Open view',exact:true}).click();
 const menuBox=await agent.locator('.openide-menu:visible').boundingBox(); assert.ok(menuBox.x>100 && menuBox.y>50, 'Environment + anchors to its own button');
 await agent.keyboard.press('Escape');
 await agent.locator('.openide-agent-window-views').getByRole('button',{name:'component.ts',exact:true}).click();
 for(const width of [1050,800,640]) {
   await agent.setViewportSize({width,height:760});
   const box=await agent.locator('.openide-agent-window-workspace').boundingBox();
   assert.ok(box.x>=0 && box.x+box.width<=width+1, JSON.stringify({width,box}));
   await agent.screenshot({path:path.join(output,`workspace-${width}.png`)});
 }
 assert.deepEqual(runtimeErrors,[]);
 console.log('Native launcher, inline Environment, editor workspace, minimize/restore, modal round-trip, independent live conversation, own popover anchor, responsive layout passed');
} finally { if(app) await app.close(); fs.rmSync(tmp,{recursive:true,force:true}); }
