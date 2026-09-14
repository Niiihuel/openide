// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-chat-changes-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-sessions-'));
const output = path.join(root, '.build/agent-window-chat-changes-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.writeFileSync(path.join(tmp,'workspace/shared.ts'),'const chat_B = 2;\n'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom', 'workbench.hover.delay': 200 }));
let app; const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
	ide.on('console', msg => { if(msg.type()==='error' && !msg.text().includes('No default agent registered')) { errors.push(msg.text()); console.error(msg.text()); } });
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentSessions',title:'Agent Sessions Fixture',f1:true }); }
			async run(accessor) {
				const commands=accessor.get(ICommandService),views=accessor.get(IViewsService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt',{prompt:'Session fixture',send:false});
				const view=views.getViewWithId('workbench.view.openideChat.view'), sessions=view._widget.value.sessionStore;
				const native=[];
				for(let index=0;index<10;index++) native.push(sessions.createBackground(`Project conversation ${index} with useful context`,[{role:'user',content:`Task ${index}`},{role:'assistant',content:'Fixture answer'}]));
				sessions.setPinned(native[2],true);sessions.archive(native[3]);
				const uri = 'shared.ts';
				sessions.saveChangeSet(native[0], { messageId:'edit-a',timestamp:1,state:'finalized',files:[{uri,operation:'modify',beforeContent:'const initial = 0;\n',afterContent:'const chat_A = 1;\n'}] });
				sessions.saveChangeSet(native[1], { messageId:'edit-b',timestamp:2,state:'finalized',files:[{uri,operation:'modify',beforeContent:'const chat_A = 1;\n',afterContent:'const chat_B = 2;\n'}] });

				// Controlled project metadata: no CLI host or PTY is started in this fixture.
				const cli=native[7];sessions.sessions.get(cli).cwd='/tmp/other-project';
				view._widget.value.openSession(native[0]);
				sessions.setStatus(native[5],'in-progress');sessions.setStatus(native[6],'completed');
				view._widget.value.refreshSessions();
				window.agentSessionsFixture={showSessions:()=>view._widget.value._sessionsPane.setOpen(true), clear:()=>sessions.deleteAll(), finish:id=>sessions.setStatus(id,'completed'),open:()=>commands.executeCommand('openide.agent.openAgentWindow'),native,cli};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Sessions Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Sessions Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentSessionsFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.agentSessionsFixture.open());
	const agent = await opened;
	agent.on('pageerror',error=>errors.push(error.message));
	agent.on('console',message=>{ if(message.type()==='error') { console.error(message.text()); if(!message.text().includes('No default agent registered')) errors.push(message.text()); } });
	const pane = agent.locator('.openide-agent-window-sessions');
	await pane.locator('[data-project-id="pinned"]').waitFor();
	await pane.locator('.openide-chat-sessions-more').click();
	const fixture = await ide.evaluate(() => ({ native: window.agentSessionsFixture.native }));
	const editsBefore = await ide.locator('.editor-group-container .tab').count();
	const card = agent.locator('.openide-changes-file');
	await agent.keyboard.press('Control+Shift+KeyG');
	await card.waitFor();
	assert.equal(await card.count(), 1);
	await card.locator('button[aria-expanded]').first().click();
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_A'));
	assert.ok(!(await card.textContent()).includes('chat_B'));
	await agent.screenshot({path: path.join(output, 'chat-a.png')});
	await pane.locator('[data-session-id="' + fixture.native[1] + '"] .openide-chat-sessions-open').click();
	await agent.waitForTimeout(200);
	await agent.keyboard.press('Control+Shift+KeyG');
	await card.waitFor();
	await card.locator('button[aria-expanded]').first().click();
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_B'));
	await agent.screenshot({path: path.join(output, 'chat-b.png')});
	await pane.locator('[data-session-id="' + fixture.native[0] + '"] .openide-chat-sessions-open').click();
	await agent.waitForTimeout(200);
	await agent.keyboard.press('Control+Shift+KeyG');
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_A'));
	assert.equal(await ide.locator('.editor-group-container .tab').count(), editsBefore, 'review stays in Agents Window');
	assert.deepEqual(errors, []);
	console.log('PASS: per-chat receipts, same file, return navigation, IDE isolation');
} catch(error) { console.error(error, errors); if (app) { for (const [index,page] of app.windows().entries()) { await page.screenshot({path:path.join(output, `failure-${index}.png`)}).catch(()=>{}); console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4000)); } } throw error; } finally {
	if(app) { await app.evaluate(({BrowserWindow}) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
	fs.rmSync(tmp,{recursive:true,force:true});
}
