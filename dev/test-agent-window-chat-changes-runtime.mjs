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
fs.writeFileSync(path.join(tmp,'workspace/accepted.ts'),'const after = 1;\n');
fs.writeFileSync(path.join(tmp,'workspace/unrelated.ts'),'const unrelated = 1;\n');
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
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentSessions',title:'Agent Sessions Fixture',f1:true }); }
			async run(accessor) {
				const commands=accessor.get(ICommandService),views=accessor.get(IViewsService),agentService=accessor.get(IOpenideAgentService);
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
				window.agentSessionsFixture={
					showSessions:()=>view._widget.value._sessionsPane.setOpen(true), clear:()=>sessions.deleteAll(), finish:id=>sessions.setStatus(id,'completed'),open:()=>commands.executeCommand('openide.agent.openAgentWindow'),native,cli,
					select:id=>view._widget.value.openSession(id), active:()=>sessions.activeSessionId(),
					draft:()=>view._widget.value._composer.value,
					draftReferences:()=>view._widget.value._composer.draft.referenceChips,
					preparePending:()=>{
						for(const [file,owner] of [['accepted.ts',native[8]],['unrelated.ts',native[9]]]){agentService.diffSnapshot.setBaselineOnce(file,'const before = 0;\n',true,owner);agentService.diffSnapshot.markPending(file,true,1,1);}
						sessions.saveChangeSet(native[8],{messageId:'accept-edit',timestamp:3,state:'finalized',files:[{uri:'accepted.ts',operation:'modify',beforeContent:'const before = 0;\n',afterContent:'const after = 1;\n'}]});
						view._widget.value.openSession(native[8]);
						agentService._onDidChangeFileDiff.fire({path:'accepted.ts',added:1,removed:1});
					},
					pending:()=>agentService.pendingFileDiffs().map(file=>file.path),
					pendingBusy:busy=>sessions.setStatus(native[8],busy?'in-progress':'completed'),
					setDraft:text=>view._widget.value.injectCanvasPrompt(text,false),
					reading:()=>{const widget=[...view._widget.value._companions][0];const state=widget._list.captureReadingState();return {top:state.scrollTop,following:state.following,anchor:state.anchor};},
					readEarlier:(top=0)=>{const widget=[...view._widget.value._companions][0];widget._list.setFollowTail(false);widget._list.scrollTop=top;},
					longHistory:()=>{sessions.save(native[0],Array.from({length:60},(_,i)=>[{role:'user',messageId:'history-'+i,content:'Question '+i},{role:'assistant',content:('Answer '+i+' with useful context and several wrapped words for a tall Markdown response.\n\n').repeat(30)}]).flat(),false);view._widget.value.openSession(native[0]);},
				};
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
	const changeRow = agent.locator('.openide-conversation-changes-files .openide-agent-window-context-row').first();
	await changeRow.waitFor();
	await agent.waitForFunction(() => document.querySelector('.openide-conversation-changes-files .openide-agent-window-changes-added')?.textContent === '+1');
	assert.match(await changeRow.locator('.openide-agent-window-change-icon').getAttribute('class'), /file-icon/);
	assert.deepEqual(await changeRow.locator('.openide-agent-window-changes-added, .openide-agent-window-changes-removed').allTextContents(), ['+1', '−1']);
	const fixture = await ide.evaluate(() => ({ native: window.agentSessionsFixture.native }));
	await ide.evaluate(() => window.agentSessionsFixture.setDraft('Draft for the first conversation'));
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	assert.equal(await ide.evaluate(() => window.agentSessionsFixture.draft()), '');
	await ide.evaluate(() => window.agentSessionsFixture.setDraft('Draft for the second conversation'));
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[0]);
	assert.equal(await ide.evaluate(() => window.agentSessionsFixture.draft()), 'Draft for the first conversation');
	const editsBefore = await ide.locator('.editor-group-container .tab').count();
	const card = agent.locator('.openide-changes-file');
	await agent.keyboard.press('Control+Shift+KeyG');
	await card.waitFor();
	assert.equal(await card.count(), 1);
	assert.equal(await agent.locator('.openide-changes-save .monaco-button').getAttribute('aria-disabled'),'true','historical receipts cannot accept unrelated pending edits');
	await card.locator('button[aria-expanded]').first().click();
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_A'));
	assert.ok(!(await card.textContent()).includes('chat_B'));
	await agent.screenshot({path: path.join(output, 'chat-a.png')});
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	await agent.waitForTimeout(200);
	await agent.keyboard.press('Control+Shift+KeyG');
	await card.waitFor();
	await card.locator('button[aria-expanded]').first().click();
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_B'));
	await agent.screenshot({path: path.join(output, 'chat-b.png')});
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[0]);
	await agent.waitForTimeout(200);
	await agent.keyboard.press('Control+Shift+KeyG');
	await agent.waitForFunction(() => document.querySelector('.openide-changes-file .view-lines')?.textContent.includes('chat_A'));
	assert.equal(await ide.locator('.editor-group-container .tab').count(), editsBefore, 'review stays in Agents Window');
	// Sending a reviewed file stays bound to its source even when another conversation is selected.
	assert.equal(await card.locator('button:has(.codicon-comment-discussion), .openide-review-comment').count(), 0);
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	await card.locator('button:has(.codicon-mention)').click();
	await ide.waitForFunction(id => window.agentSessionsFixture.active()===id, fixture.native[0]);
	assert.ok((await ide.evaluate(() => window.agentSessionsFixture.draft())).includes('Review the changes in shared.ts.'));
	assert.ok((await ide.evaluate(() => window.agentSessionsFixture.draft())).includes('Draft for the first conversation'));
	const reference=await ide.evaluate(()=>window.agentSessionsFixture.draftReferences()[0]);
	assert.equal(reference.path,'shared.ts');
	assert.match(reference.iconClasses, /file-icon/);
	assert.match(reference.context,/-const initial = 0;[\s\S]*\+const chat_A = 1;/);
	assert.ok(!reference.context.includes('chat_B'),'review snapshot stays bound to the displayed conversation');
	assert.equal(await agent.locator('.openide-agent-window-chat .openide-chat-reference-chip').count(),1);
	assert.ok(await agent.locator('.openide-agent-window-chat .openide-chat-reference-chip .file-icon').count());
	await card.locator('button:has(.codicon-mention)').click();
	await ide.waitForFunction(()=>window.agentSessionsFixture.draft().includes('Review the changes in shared.ts.'));
	assert.equal((await ide.evaluate(()=>window.agentSessionsFixture.draftReferences())).length,1,'same file updates its reference instead of duplicating it');
	await agent.screenshot({path:path.join(output,'structured-review-reference.png')});
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	assert.equal(await ide.evaluate(() => window.agentSessionsFixture.draft()), 'Draft for the second conversation');
	// Preserve reading position across conversations after rows have real measured heights.
	await ide.evaluate(() => window.agentSessionsFixture.longHistory());
	await agent.waitForTimeout(300);
	await ide.evaluate(() => window.agentSessionsFixture.readEarlier());
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[0]);
	await agent.waitForTimeout(300);
	assert.deepEqual(await ide.evaluate(() => {const state=window.agentSessionsFixture.reading();return {top:state.top,following:state.following};}), {top:0,following:false});
	// A nonzero intra-response offset must survive a switch through an unmeasured short thread.
	await ide.evaluate(() => window.agentSessionsFixture.readEarlier(1700));
	await agent.waitForTimeout(300);
	const readingBefore = await ide.evaluate(() => window.agentSessionsFixture.reading());
	assert.ok(readingBefore.top > 1000 && readingBefore.anchor.offset > 0, JSON.stringify(readingBefore));
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[1]);
	await agent.waitForTimeout(100);
	await ide.evaluate(id => window.agentSessionsFixture.select(id), fixture.native[0]);
	await agent.waitForTimeout(500);
	const readingAfter = await ide.evaluate(() => window.agentSessionsFixture.reading());
	assert.equal(readingAfter.following, false);
	assert.equal(readingAfter.anchor.id, readingBefore.anchor.id);
	assert.ok(Math.abs(readingAfter.anchor.offset-readingBefore.anchor.offset)<3, JSON.stringify({readingBefore,readingAfter}));
	await agent.locator('.openide-agent-window-header button[aria-controls="openide-agent-window-context"]').click();
	const tabs=agent.locator('.openide-conversation-context-tabs');
	await tabs.waitFor();
	await tabs.locator('[role=tab]').first().focus();
	await agent.keyboard.press('End');
	assert.equal(await tabs.locator('[role=tab]').last().getAttribute('aria-selected'),'true');
	await agent.waitForFunction(() => document.getAnimations().filter(animation => animation.id === 'openide-agent-layout').every(animation => animation.playState !== 'running'));
	await agent.screenshot({path:path.join(output,'conversation-workspace-dark.png')});
	assert.deepEqual(errors, []);
	await ide.evaluate(()=>window.agentSessionsFixture.preparePending());
	await agent.waitForTimeout(200);
	await agent.keyboard.press('Control+Shift+KeyG');
	await agent.locator('.openide-changes-file[data-path="accepted.ts"]').waitFor();
	const accept=agent.locator('.openide-changes-save .monaco-button');
	await agent.waitForFunction(()=>document.querySelector('.openide-changes-save .monaco-button')?.getAttribute('aria-disabled')==='false');
	assert.match(await accept.textContent(),/Accept all changes/);
	await ide.evaluate(()=>window.agentSessionsFixture.pendingBusy(true));
	await agent.waitForFunction(()=>document.querySelector('.openide-changes-save .monaco-button')?.getAttribute('aria-disabled')==='true');
	await ide.evaluate(()=>window.agentSessionsFixture.pendingBusy(false));
	await agent.waitForFunction(()=>document.querySelector('.openide-changes-save .monaco-button')?.getAttribute('aria-disabled')==='false');
	await accept.click();
	await ide.waitForFunction(()=>!window.agentSessionsFixture.pending().includes('accepted.ts'));
	assert.deepEqual(await ide.evaluate(()=>window.agentSessionsFixture.pending()),['unrelated.ts'],'accept only the originating conversation’s live agent edits');
	assert.equal(fs.readFileSync(path.join(tmp,'workspace/accepted.ts'),'utf8'),'const after = 1;\n','accept keeps the file content');
	await agent.waitForFunction(()=>document.querySelector('.openide-changes-save .monaco-button')?.getAttribute('aria-disabled')==='true');
	await agent.locator('.openide-agent-window-chat .openide-chat-files-tray').waitFor({state:'hidden'});
	await agent.screenshot({path:path.join(output,'changes-accepted.png')});
	assert.deepEqual(errors, []);
	console.log('PASS: per-chat receipts, review feedback ownership, isolated drafts, reading position, context tabs, IDE isolation, structured diff references, conversation-owned acceptance');
} catch(error) { console.error(error, errors); if (app) { for (const [index,page] of app.windows().entries()) { await page.screenshot({path:path.join(output, `failure-${index}.png`)}).catch(()=>{}); console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4000)); } } throw error; } finally {
	if(app) { await app.evaluate(({BrowserWindow}) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await app.close().catch(() => {}); }
	fs.rmSync(tmp,{recursive:true,force:true});
}
