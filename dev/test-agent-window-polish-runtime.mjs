// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-polish-runtime.mjs
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
const output = path.join(root, '.build/agent-window-polish-runtime');
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
                    mainEditors: () => groups.mainPart.groups.flatMap(g=>g.editors).map(e=>e.getName()),
                    openFileDefault: async () => { const { URI }=await import(base+'base/common/uri.js'); await editors.openEditor({resource:URI.file(window.agentWindowFixture.workspaceFile)}); },
					seedReview: () => agent._onDidChangeFileDiff.fire({ path: 'src/nested/component.ts', added: 1, removed: 0 }),
					deleteStored: id => sessions.delete(id),
					first, second, runs, approvals, workspaceFile: undefined,
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
 await agent.setViewportSize({width:1440,height:900});
 const switcher=ide.locator('.part.titlebar .openide-window-switcher');
 await ide.bringToFront();
 await switcher.hover();
 await ide.waitForFunction(()=>getComputedStyle(document.querySelector('.openide-window-switcher-label')).opacity==='1');
 await ide.screenshot({path:path.join(output,'switcher.png')});
 await agent.bringToFront();
 await agent.getByRole('button',{name:/Search/}).first().click();
 await agent.locator('.quick-input-widget').waitFor({state:'visible'});
 assert.equal(await agent.locator('.quick-input-backdrop').count(),1);
 assert.equal(await ide.locator('.quick-input-backdrop').count(),0);
 assert.notEqual(await agent.locator('.quick-input-backdrop').evaluate(e=>getComputedStyle(e).backdropFilter),'none');

 const heading=agent.locator('.quick-input-list-separator-as-item').filter({hasText:'Quick actions'});
 await heading.hover();
 assert.equal(await heading.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','section labels never get selection hover');
 await agent.screenshot({path:path.join(output,'search.png')});
 await agent.keyboard.press('Escape');
 assert.equal(await agent.locator('.quick-input-backdrop').count(),0);

 const usage=agent.locator('[id="openide.agent.usage"]');
 await usage.hover();
 assert.equal(await usage.locator('.openide-agent-footer-usage').evaluate(e=>getComputedStyle(e).zIndex),'1');
 await agent.screenshot({path:path.join(output,'usage-hover.png')});
 await agent.locator('.openide-agent-window-title').hover();
 const sources=agent.locator('[data-activity="sources"] .openide-agent-window-section-add');
 await sources.hover();
 const sourceTip=agent.locator('.monaco-hover:visible').filter({hasText:'Attach an image'});
 await sourceTip.waitFor();
 const sourceBounds=await sources.boundingBox(), sourceTipBounds=await sourceTip.boundingBox();
 assert.ok(sourceTipBounds.y+sourceTipBounds.height <= sourceBounds.y+2 || sourceTipBounds.y >= sourceBounds.y+sourceBounds.height-2,'tooltip must not cover adjacent actions');
 await agent.screenshot({path:path.join(output,'source-tooltip.png')});
 await agent.locator('.openide-agent-window-title').hover();
 if (!process.env.OPENIDE_TEST_SEARCH_ONLY) {
 const mainBefore=await ide.evaluate(()=>window.agentWindowFixture.mainEditors());
 await agent.keyboard.press('Control+Shift+KeyP');
 await agent.locator('.quick-input-widget input').first().fill('>Preferences: Open Settings (UI)');
 await agent.locator('.quick-input-list .monaco-list-row').filter({hasText:'Open Settings (UI)'}).first().click();
 await agent.locator('.openide-settings').waitFor();
 assert.deepEqual(await ide.evaluate(()=>window.agentWindowFixture.mainEditors()),mainBefore);
 await ide.evaluate(file=>{window.agentWindowFixture.workspaceFile=file;},path.join(tmp,'workspace/src/nested/component.ts'));
 await agent.bringToFront();
 await ide.evaluate(()=>window.agentWindowFixture.openFileDefault());
 await agent.locator('.openide-agent-window-editor-host .tabs-container .tab').filter({hasText:'component.ts'}).waitFor();
 assert.equal(await agent.locator('.openide-agent-window-editor-host .tabs-container .tab').count(),2);
 assert.deepEqual(await ide.evaluate(()=>window.agentWindowFixture.mainEditors()),mainBefore);
 const selectedTab=agent.locator('.openide-agent-window-editor-host .tabs-container .tab[aria-selected=true]');
 await selectedTab.focus(); await agent.keyboard.press('ArrowLeft');
 await agent.locator('.openide-agent-window-editor-host .tabs-container .tab[aria-selected=true]').filter({hasText:'Settings'}).waitFor();
 await agent.waitForFunction(()=>document.activeElement?.matches('.tabs-container .tab[aria-selected=true]'));
 await agent.keyboard.press('ArrowRight');
 await agent.locator('.openide-agent-window-editor-host .tabs-container .tab[aria-selected=true]').filter({hasText:'component.ts'}).waitFor();
 await agent.screenshot({path:path.join(output,'tabs.png')});
 await agent.getByRole('button',{name:'Minimize to environment',exact:true}).click();
 const input=agent.locator('.openide-chat-input-card textarea');
 await input.fill('Keep running with the IDE surface closed'); await input.press('Enter');
 await ide.waitForFunction(()=>window.agentWindowFixture.busy());
 const owner=await app.browserWindow(ide);
 await owner.evaluate(win=>win.close());
 for(let i=0;i<50 && await owner.evaluate(win=>win.isVisible());i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(await owner.evaluate(win=>win.isVisible()),false);
 assert.equal(agent.isClosed(),false);
 assert.equal(await ide.evaluate(()=>window.agentWindowFixture.cancelled()),false);
 await ide.evaluate(()=>window.agentWindowFixture.finish());
 await ide.waitForFunction(()=>!window.agentWindowFixture.busy());
 await agent.getByRole('button',{name:'Open in IDE',exact:true}).click();
 for(let i=0;i<50 && !await owner.evaluate(win=>win.isVisible());i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(await owner.evaluate(win=>win.isVisible()),true);
 await agent.bringToFront();
 await agent.getByRole('button',{name:'Toggle workspace panel',exact:true}).click();
 await agent.locator('.openide-agent-window-editor-host .tabs-container .tab').first().waitFor();
 assert.equal(await agent.locator('.openide-agent-window-editor-host .tabs-container .tab').count(),2);
 assert.deepEqual(runtimeErrors,[]);
 await owner.evaluate(win=>win.close());
 for(let i=0;i<50 && await owner.evaluate(win=>win.isVisible());i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(await owner.evaluate(win=>win.isVisible()),false);
 const closed = app.waitForEvent('close',{timeout:30000});
 await agent.close();
 await closed;
 app=undefined;
 }
 console.log(process.env.OPENIDE_TEST_SEARCH_ONLY ? 'Native search blur, noninteractive headings, usage hover and source tooltip placement passed' : 'Branded handoff; native search blur; independent settings/file routing; keyboard tabs; execution survives IDE close; IDE restored with tabs retained passed');
} finally { if(app) await app.close(); fs.rmSync(tmp,{recursive:true,force:true}); }
