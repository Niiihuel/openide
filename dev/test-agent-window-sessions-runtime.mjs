// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-sessions-runtime.mjs
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
const output = path.join(root, '.build/agent-window-sessions-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
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
	const pane=agent.locator('.openide-agent-window-sessions');
	await pane.locator('[data-project-id="pinned"]').waitFor();
	const fixture=await ide.evaluate(()=>({native:window.agentSessionsFixture.native,cli:window.agentSessionsFixture.cli}));
	assert.equal(await pane.locator('.openide-chat-sessions-more').count(),1);
	assert.equal(await pane.locator('[data-project-id="archived"]').getAttribute('aria-expanded'),'false');
	assert.equal(await agent.locator('.openide-agent-window-new > button').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 34)), true, 'new conversation and picker share a full-height control');
	assert.equal(await agent.locator('.openide-agent-window-brand strong').count(), 0, 'sidebar heading has no redundant brand');
	const project = pane.locator('[data-project-id]:not([data-project-id="pinned"]):not([data-project-id="archived"])').first();
	await project.hover();
	await agent.locator('.openide-chat-session-preview').waitFor();
	assert.match(await agent.locator('.openide-chat-session-preview').innerText(), /conversations · \d+ active/);
	await agent.screenshot({path:path.join(output,'project-preview.png')});
	await agent.mouse.move(20, 20);
	const branch = project.locator('xpath=following-sibling::*[1]');
	const retained = await branch.locator('.openide-chat-sessions-row').first().elementHandle();
	await agent.emulateMedia({ reducedMotion: 'no-preference' });
	await agent.waitForTimeout(500);
	const animation = await project.evaluate(async button => {
		const branch = button.nextElementSibling;
		const start = branch.getBoundingClientRect().height;
		const frames = [];
		button.click();
		const until = performance.now() + 500;
		while (performance.now() < until) {
			await new Promise(resolve => requestAnimationFrame(resolve));
			frames.push(branch.getBoundingClientRect().height);
		}
		const end = branch.getBoundingClientRect().height;
		button.click();
		return { start, frames, end, inert: branch.querySelector('.openide-chat-sessions-branch').inert };
	});
	assert.ok(animation.frames.some(height => height > 0 && height < animation.start) && animation.end < 1, JSON.stringify(animation));
	assert.equal(animation.inert, false);
	await agent.waitForTimeout(180);
	assert.equal(await retained.evaluate(row => row.isConnected), true, 'animated tree retains existing rows');

	await agent.screenshot({path:path.join(output,'sessions-wide.png')});
	await pane.locator('.openide-chat-sessions-more').click();
	assert.ok(await pane.locator('[data-session-id="'+fixture.native[1]+'"]').count());
	const running=pane.locator('[data-session-id="'+fixture.native[5]+'"]');
	await running.locator('.oi-spinner').waitFor();
	const indicator=await running.evaluate(row=>{const title=row.querySelector('.openide-chat-sessions-body').getBoundingClientRect(), spinner=row.querySelector('.oi-spinner').getBoundingClientRect();return {titleRight:title.right,spinnerLeft:spinner.left,animation:getComputedStyle(row.querySelector('.oi-spinner'),'::before').animationName};});
	assert.ok(indicator.spinnerLeft>=indicator.titleRight && indicator.animation!=='none',JSON.stringify(indicator));
	await running.locator('.openide-chat-sessions-open').hover();
	await agent.locator('.openide-chat-session-preview').waitFor({timeout:10000});
	await agent.screenshot({path:path.join(output,'running-preview.png')});
	await ide.evaluate(id=>window.agentSessionsFixture.finish(id),fixture.native[5]);
	await running.locator('.oi-spinner').waitFor({state:'detached'});

	const row=pane.locator('[data-session-id="'+fixture.native[0]+'"]');
	await agent.mouse.move(20, 20);
	const beforeHover = await row.locator('.openide-chat-sessions-row-title').boundingBox();
	assert.equal(await row.locator('time.openide-chat-sessions-row-time').isVisible(), true, 'recency is available without opening the preview');
	await row.hover();
	const afterHover = await row.locator('.openide-chat-sessions-row-title').boundingBox();
	assert.deepEqual({ x: afterHover.x, width: afterHover.width }, { x: beforeHover.x, width: beforeHover.width }, 'revealing actions does not shift the conversation title');
	await row.locator('.openide-chat-sessions-row-actions button').focus();
	assert.equal(await row.locator('.openide-chat-sessions-row-actions').evaluate(element => getComputedStyle(element).pointerEvents), 'auto', 'keyboard focus reveals the actions');
	await row.hover();await row.locator('.openide-chat-sessions-row-actions button').click();
	await agent.locator('.openide-menu-content').waitFor();
	await agent.waitForTimeout(150);
	await agent.screenshot({path:path.join(output,'session-actions.png')});
	await agent.getByRole('button',{name:'Rename conversation',exact:true}).click();
	const rename=pane.locator('.openide-chat-sessions-rename input');
	await rename.fill('Renamed from companion');await rename.press('Enter');
	await row.getByRole('button').filter({hasText:'Renamed from companion'}).waitFor();
	await row.hover();await row.locator('.openide-chat-sessions-row-actions button').click();
	await agent.getByRole('button',{name:'Pin conversation',exact:true}).click();
	await pane.locator('[data-project-id="pinned"]').waitFor();
	const stableRow = await row.elementHandle();
	await agent.setViewportSize({width:720,height:740});
	assert.equal(await stableRow.evaluate(element => element.isConnected), true, 'resize preserves the session DOM');
	await row.waitFor();
	const layout=await pane.evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth,rows:Array.from(element.querySelectorAll('.openide-chat-sessions-row')).map(row=>({client:row.clientWidth,scroll:row.scrollWidth}))}));
	assert.ok(layout.scroll<=layout.client+1 && layout.rows.every(row=>row.scroll<=row.client+1),'sidebar rows do not overflow narrow layout');
	await agent.screenshot({path:path.join(output,'sessions-narrow.png')});
	await pane.locator('[data-project-id="archived"]').click();
	assert.equal(await pane.locator('[data-session-id="'+fixture.native[3]+'"]').count(),1,'archived history stays reachable');
	await agent.emulateMedia({ reducedMotion: 'reduce' });
	assert.equal(await row.locator('.openide-chat-sessions-row-actions').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
	// Empty results reuse the same command rows, and clearing filters restores the list.
	await ide.evaluate(()=>window.agentSessionsFixture.showSessions());
	const search=ide.locator('.openide-chat-sessions-search input:visible');
	await search.fill('no-matching-session-fixture');
	await ide.getByRole('button',{name:'Clear Filters',exact:true}).click();
	assert.equal(await search.inputValue(),'');
	await ide.locator('.openide-chat-sessions-row').first().waitFor();
	await ide.evaluate(()=>window.agentSessionsFixture.clear());
	const empty=pane.locator('.openide-empty-state');
	await empty.waitFor();
	assert.equal(await empty.locator('.openide-command-row .codicon').count(),0);
	assert.equal(await empty.locator('.monaco-keybinding-key').count(),2);
	await agent.screenshot({path:path.join(output,'sessions-empty.png')});
	await empty.getByRole('button',{name:'New chat',exact:true}).click();
	await pane.locator('.openide-chat-sessions-row').first().waitFor();
	assert.deepEqual(errors,[],'session controls support auxiliary DOM');
	const result={projectGroups:true,pinned:true,archiveReachable:true,showMore:true,nativeRename:true,sharedMenu:true,narrowNoOverflow:true,visibleRecency:true,stableHoverGeometry:true,stableResizeDom:true,keyboardActions:true,reducedMotion:true};
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch (error) { console.error('Session fixture failed:', error); throw error; } finally { if(app) { await app.evaluate(({BrowserWindow}) => { for (const window of BrowserWindow.getAllWindows()) { window.destroy(); } }).catch(() => {}); await app.close().catch(() => {}); } fs.rmSync(tmp,{recursive:true,force:true}); }
