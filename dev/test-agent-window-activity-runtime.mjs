// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-activity-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-activity-'));
const output = path.join(root, '.build/agent-window-activity-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom', 'workbench.hover.delay': 200, 'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false }));
for (const file of ['App.tsx', 'A much longer file name for alignment.ts']) { fs.writeFileSync(path.join(tmp, 'workspace', file), 'export const fixture = true;\n'); }
let app; const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	app.context().on('dialog', dialog => { if (dialog.type() !== 'beforeunload') { void dialog.dismiss(); } });
	const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
	ide.on('console', msg => { if(msg.type()==='error' && !msg.text().includes('No default agent registered')) { errors.push(msg.text()); console.error(msg.text()); } });
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({base,workspace}) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { ITerminalService } = await import(base + 'workbench/contrib/terminal/browser/terminal.js');
		const { ISubagentRunService } = await import(base + 'workbench/contrib/openideAgent/browser/openideSubagentRunService.js');
		const { OpenideAgentConversationEditor } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentConversationEditor.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { OpenideChatSessionEffects } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatSessionEffects.js');
		const { applyAgentEvent } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatReducer.js');
		const { createOpenideChatReducerState, beginOpenideChatTurn } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatReducerState.js');
		const { createOpenideChatRequestItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { URI } = await import(base + 'base/common/uri.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentActivity',title:'Agent Activity Fixture',f1:true }); }
			async run(accessor) {
				const instantiation=accessor.get(IInstantiationService);
				const commands=accessor.get(ICommandService),views=accessor.get(IViewsService),terminals=accessor.get(ITerminalService),runService=accessor.get(ISubagentRunService),editors=accessor.get(IEditorService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt',{prompt:'Activity fixture',send:false});
				const view=views.getViewWithId('workbench.view.openideChat.view'), sessions=view._widget.value.sessionStore;
				const selected=sessions.createBackground('Review context controls',[{role:'user',content:Array.from({length:8},(_,index)=>`https://example.com/reference-${index}`).join(' ')},{role:'assistant',content:'Controlled UI fixture. No provider request is made.'}]);
				view._widget.value.openSession(selected);view._widget.value.refreshSessions();
				// Run state only: no orchestration delegate or provider execution.
				const run=runService.create({definition:{id:'fixture',version:1,name:'Review compact layout',readonly:true},parentConversationId:selected,parentMessageId:'fixture-message',task:'Check the selected conversation UI'}).run;
				runService.transition(run.runId,'running','Inspecting shared controls');
				const child=sessions.createBackground('Compact specialist conversation',[{role:'user',content:'Check the selected conversation UI'},{role:'assistant',content:'Specialist transcript in the workspace panel'}],run.runId);
				const terminal=await terminals.createTerminal({config:{executable:'/bin/bash',args:['--noprofile','--norc'],name:'Activity test terminal'}});
				const metrics = {renders: 0}; let pane;
				const setInput = OpenideAgentConversationEditor.prototype.setInput;
				OpenideAgentConversationEditor.prototype.setInput = async function (...args) {
					if (args[0].sessionId === child && pane !== this) {
						pane = this;
						const setItems = this.list.setItems.bind(this.list);
						this.list.setItems = items => { metrics.renders++; return setItems(items); };
					}
					return setInput.apply(this, args);
				};
				const unrelated = sessions.createBackground('Unrelated fixture', []);
				const burst = (target, count) => {
					for (let i = 0; i < count; i++) {
						if (target === 'metadata') { sessions.rename(child, `Explore ${i}`); }
						else if (target === 'unrelated') { sessions.save(unrelated, [{role:'assistant',content:`Other ${i}`}],false); }
						else { const messages = sessions.messagesOf(child); messages[messages.length-1].content = `Latest streamed chunk ${i}`; sessions.save(child,messages,false); }
					}
				};
				const seedCompleted = () => {
					const ids = [];
					for (const [profile, title] of [['research','Research project'],['planning','Plan architecture'],['implementation','Implement feature'],['debug','Debug rendering'],['review','Review changes'],['general','Coordinate work']]) {
						const item = runService.create({definition:{id:'fixture-'+profile,version:1,name:title,profile,readonly:profile!=='implementation'},parentConversationId:selected,parentMessageId:'fixture-completed',task:title}).run;
						runService.transition(item.runId,'running');
						sessions.createBackground(title,[{role:'user',content:'Assigned task: '+title},{role:'assistant',content:'Inspecting the workspace before making changes.'},{role:'assistant',content:'',toolCalls:[{id:'read-'+profile,name:'read_file',argumentsJson:JSON.stringify({path:'App.tsx'})}]},{role:'tool',toolCallId:'read-'+profile,content:'export const fixture = true;'},{role:'assistant',content:'Completed: '+title+'\n\nThe shared native services and independent layouts were preserved.'}],item.runId);
						runService.complete(item.runId,{summary:'Completed: '+title}); ids.push(item.runId);
					}
					return ids;
				};
				const seedChatWorkers = () => {
					const parent = sessions.createBackground('Parallel Android work', []);
					const workers = ['Android inputs', 'Android surfaces'].map((title, index) => {
						const item = runService.create({definition:{id:'chat-worker-'+index,version:1,name:title,profile:index?'implementation':'review',readonly:!index},parentConversationId:parent,parentMessageId:'parallel-message',task:title}).run;
						runService.transition(item.runId,'running');
						sessions.createBackground(title,[{role:'user',content:title},{role:'assistant',content:'Inspecting '+title+' in the specialist view.'}],item.runId);
						return item;
					});
					sessions.save(parent,[{role:'user',content:'Improve Android inputs and surfaces in parallel.'},{role:'assistant',content:'I will review the inputs and surfaces with two specialists.',toolCalls:workers.map((run,index)=>({id:'parallel-'+index,name:'delegate_to_subagent',argumentsJson:JSON.stringify({agent:run.definitionName,task:run.task})}))},...workers.map((run,index)=>({role:'tool',toolCallId:'parallel-'+index,content:'Started runId='+run.runId})),{role:'assistant',content:'The specialists are working on their assigned tasks.'}],false);
					view._widget.value.openSession(parent); view._widget.value.refreshSessions();
					return {parent, ids:workers.map(run=>run.runId)};
				};

				const seedLegacy = () => {
					view._widget.value.openSession(selected);
					const effects = instantiation.createInstance(OpenideChatSessionEffects, sessions);
					let state = beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({id:'legacy-request',text:'Review'}));
					const emit = event => { const step = applyAgentEvent(state,event); state=step.state; effects.apply({conversationId:selected,messages:sessions.messagesOf(selected)},step.sessionEffects); };
					emit({type:'subagentStart',id:'legacy-review',parentId:'legacy-call',index:0,total:1,status:'running',title:'Reviewer 1/1',prompt:'Review current changes',model:'fixture'});
					window.agentActivityFixture.finishLegacy = () => {
						emit({type:'subagentEvent',id:'legacy-review',parentId:'legacy-call',index:0,total:1,status:'running',ev:{type:'text',delta:'Current Reviewer result: VERDICT: PASS'}});
						emit({type:'subagentDone',id:'legacy-review',parentId:'legacy-call',index:0,total:1,status:'completed'});
						effects.dispose();
					};
				};
				window.agentActivityFixture={seedLegacy,seedChatWorkers,closeFiles:()=>pane.group.closeAllEditors(),seedCompleted,metrics,burst,state:()=>({visible:pane.transcriptVisible}),openFile:async name=>{await editors.openEditor({resource:URI.file(workspace+'/'+name),options:{pinned:true}},pane.group);},renameChild:title=>sessions.rename(child,title),child,open:()=>commands.executeCommand('openide.agent.openAgentWindow'),terminal,runId:run.runId,queue:()=>view._widget.value._composer._queue.push({inputText:'Pending request with its original text',images:[],references:[],capabilities:[],links:[],mode:'agent',providerId:'fixture',modelId:'fixture'}),active:()=>sessions.activeSessionId(),selected,update:()=>sessions.save(child,[...sessions.messagesOf(child),{role:'assistant',content:'Live specialist update'}],false)};
			}
		});
	}, {base:`vscode-file://vscode-app${root}/vscode/out/vs/`,workspace:path.join(tmp,'workspace')});
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Activity Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Activity Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentActivityFixture, undefined, {timeout:90000});
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.agentActivityFixture.open());
	const agent = await opened;
	agent.on('pageerror',error=>errors.push(error.message));
	agent.on('console',message=>{ if(message.type()==='error') { console.error(message.text()); if(!message.text().includes('No default agent registered')) errors.push(message.text()); } });
	const sources=agent.locator('[data-activity="sources"]');
	await sources.waitFor();
	assert.equal(await sources.locator('.openide-agent-window-section-body > .openide-agent-window-context-row').count(),3);
	await sources.locator('.openide-context-activity-more').click();
	assert.equal(await sources.locator('.openide-agent-window-section-body > .openide-agent-window-context-row').count(),8);
	await sources.locator('.openide-context-activity-toggle').click();
	assert.equal(await sources.locator('.openide-agent-window-section-body').isVisible(),false);
	await sources.locator('.openide-context-activity-toggle').click();
	const runs=agent.locator('[data-activity="subagents"]');
	const runId=await ide.evaluate(()=>window.agentActivityFixture.runId);
	await runs.locator('.openide-subagents-summary').click();
	await agent.locator('.openide-subagents-row[data-run-id="'+runId+'"] .openide-subagents-open').click();
	await agent.locator('.openide-agent-window-workspace .openide-agent-conversation-editor').waitFor();
	await agent.getByText('Specialist transcript in the workspace panel',{exact:true}).waitFor();
	assert.equal(await agent.locator('.openide-context-activity-details').count(),0,'subagent never expands inside Environment');
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.active()===window.agentActivityFixture.selected),true,'parent conversation remains selected');
	const childId=await ide.evaluate(()=>window.agentActivityFixture.child);
	assert.equal(await agent.locator('.openide-agent-window-sidebar [data-session-id="'+childId+'"]').count(),0,'specialist is never a peer session');
	await agent.locator('.openide-chat-sessions-children-toggle').click();
	assert.equal(await agent.locator('.openide-chat-sessions-children-toggle').evaluate(e=>getComputedStyle(e).justifyContent),'flex-start','subagent heading aligns with its tree branch');
	const treeSpacing=await agent.locator('.openide-chat-sessions-children').evaluate(e=>({gap:parseFloat(getComputedStyle(e).gap),margin:parseFloat(getComputedStyle(e).marginTop)}));
	assert.ok(treeSpacing.gap>=2 && treeSpacing.margin>=4,'hover targets have separate rows');
	await agent.locator('[data-subagent-session-id="'+childId+'"]').click();
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.active()===window.agentActivityFixture.selected),true,'nested child keeps parent selected');
	await ide.evaluate(()=>window.agentActivityFixture.renameChild('A very long specialist title '.repeat(8)));
	assert.equal(await agent.locator('.openide-agent-window-workspace .tab').count(),1,'renaming a child keeps a single Subagents tab');
	assert.ok((await agent.locator('.openide-agent-window-workspace .tab').innerText()).includes('Subagents'));
	await agent.screenshot({path:path.join(output,'subagent-hierarchy.png')});
	await ide.evaluate(()=>window.agentActivityFixture.renameChild('Explore'));
	assert.equal(await agent.locator('[data-activity="processes"] .openide-agent-window-section-add').getAttribute('aria-label'),'New Terminal');

	await ide.evaluate(()=>window.agentActivityFixture.update());
	await agent.getByText('Live specialist update',{exact:true}).waitFor();
	const beforeBurst = await ide.evaluate(()=>window.agentActivityFixture.metrics.renders);
	await ide.evaluate(()=>{ window.agentActivityFixture.burst('metadata',20); window.agentActivityFixture.burst('unrelated',20); });
	await agent.waitForTimeout(250);
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.metrics.renders),beforeBurst,'metadata and unrelated saves never replay specialist transcript');
	await ide.evaluate(()=>window.agentActivityFixture.burst('stream',20));
	await agent.getByText('Latest streamed chunk 19',{exact:true}).waitFor();
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.metrics.renders),beforeBurst+1,'a stream burst is coalesced into one transcript update');
	const addView=agent.locator('.openide-agent-window-workspace .tabs-bar-add-tab').getByRole('button');
	await addView.click();
	const menu=agent.locator('.monaco-menu:visible');
	await menu.waitFor();
	const menuGeometry=await menu.evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),width:innerWidth,containers:[el,el.parentElement,el.parentElement.parentElement].map(e=>({class:e.className,style:e.getAttribute('style'),rect:e.getBoundingClientRect().toJSON()}))}));
	assert.ok(menuGeometry.rect.right<=menuGeometry.width+1 && menuGeometry.rect.left>=0,'menu fits the auxiliary window');
	await agent.screenshot({path:path.join(output,'native-view-menu.png')});
	assert.equal(await ide.locator('.monaco-menu:visible').count(),0,'native menu belongs to the auxiliary window');
	await agent.keyboard.press('Escape');
	await menu.waitFor({state:'hidden'});
	assert.equal(await addView.evaluate(el=>el===el.ownerDocument.activeElement),true,'Escape restores focus to menu trigger');
	await agent.locator('.openide-agent-window-workspace-header button').last().click();
	if (!await runs.isVisible()) { await agent.locator('.openide-agent-window-header button[aria-controls="openide-agent-window-context"]').click(); }
	await runs.waitFor();
	assert.equal(await runs.locator('.openide-subagents-summary img').count(),1);
	assert.ok((await runs.boundingBox()).height<140,'subagent stays a compact row');
	await ide.waitForFunction(()=>!window.agentActivityFixture.state().visible);
	const beforeHidden = await ide.evaluate(()=>window.agentActivityFixture.metrics.renders);
	await ide.evaluate(()=>window.agentActivityFixture.burst('stream',21));
	await agent.waitForTimeout(250);
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.metrics.renders),beforeHidden,'hidden specialist does not replay streaming updates');
	const panels = await agent.evaluate(() => {
		const environment = document.querySelector('.openide-agent-window-context');
		const composer = document.querySelector('.openide-agent-window-center .openide-chat-input-card');
		const tray = document.querySelector('.openide-agent-window-center .openide-chat-tray-host');
		return [environment, composer, tray].map(element => getComputedStyle(element).backgroundColor);
	});
	assert.equal(new Set(panels).size, 1, 'Environment, composer and its file/terminal tray share the same elevated surface');
	await runs.locator('.openide-subagents-summary').hover();
	await agent.waitForTimeout(350);
	assert.equal(await agent.locator('.monaco-hover:visible').count(), 0, 'fitting subagent summaries do not repeat their visible label in a tooltip');
	await agent.mouse.move(20, 20);
	await agent.screenshot({path:path.join(output,'context-activity.png')});
	await runs.locator('.openide-subagents-summary').click();
	await agent.locator('.openide-subagents-row[data-run-id="'+runId+'"] .openide-subagents-open').click();
	assert.equal(await agent.locator('.openide-agent-window-workspace .tab').count(),1,'reopening a specialist reuses its tab');
	await agent.getByText('Latest streamed chunk 20',{exact:true}).waitFor();
	await agent.locator('.openide-agent-window-workspace-header button').last().click();
	const env = agent.locator('.openide-agent-window-context');
	if (!await env.isVisible()) { await agent.locator('.openide-agent-window-header button[aria-controls="openide-agent-window-context"]').click(); }
	for (const kind of ['processes', 'sources']) {
		const heading = agent.locator(`[data-activity="${kind}"] .openide-agent-window-section-heading`);
		const toggle = heading.locator('.openide-context-activity-toggle');
		await toggle.click();
		const add = heading.locator('.openide-agent-window-section-add');
		await add.hover();
		const geometry = await heading.evaluate(e => {
			const add = e.querySelector('.openide-agent-window-section-add'), toggle = e.querySelector('.openide-context-activity-toggle');
			const a = add.getBoundingClientRect(), t = toggle.getBoundingClientRect();
			return { aligned: Math.abs(a.y - t.y) < 1, distinct: t.right <= a.left, target: document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)?.closest('button') === add, focusOutline: getComputedStyle(toggle).outlineStyle };
		});
		assert.ok(geometry.aligned && geometry.distinct && geometry.target, JSON.stringify(geometry));
		assert.equal(geometry.focusOutline, 'none', 'mouse focus does not leave a ring on the chevron');
		await toggle.click();
	}
	const processRow=agent.locator('[data-activity="processes"] .openide-context-activity-entry').first();
	await processRow.hover();
	assert.equal(await processRow.locator('.codicon-debug-stop').count(),0,'process controls do not use colored debug icons');
	assert.equal(await processRow.locator('.openide-context-activity-actions button').count(), 1);
	await processRow.locator('.codicon-trash').waitFor();
	assert.equal(await processRow.getByRole('button', { name: 'Rename terminal', exact: true }).count(), 0);
	await processRow.locator('.openide-agent-window-context-row').click();
	await agent.locator('.openide-agent-window-terminal .xterm').waitFor();
	assert.equal(await ide.evaluate(() => window.agentActivityFixture.terminal.isDisposed), false, 'opening retains existing PTY');
	await agent.screenshot({path:path.join(output,'terminal-toolbar.png')});
	const stoppedId = await processRow.getAttribute('data-terminal-id');
	await processRow.locator('.openide-context-activity-actions button').click();
	await agent.locator(`[data-activity="processes"] [data-terminal-id="${stoppedId}"]`).waitFor({ state: 'detached' });
	assert.equal(await ide.evaluate(() => window.agentActivityFixture.terminal.isDisposed), true, 'trash terminates only selected PTY');
	await agent.setViewportSize({width:900,height:740});
	const context=agent.locator('.openide-agent-window-context');
	await context.waitFor();
	await agent.screenshot({path:path.join(output,'context-activity-narrow.png')});
	const overflow=await context.evaluate(element=>{const rect=element.getBoundingClientRect();const offenders=Array.from(element.querySelectorAll('*')).map(el=>({tag:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,client:el.clientWidth,scroll:el.scrollWidth})).filter(el=>el.right>rect.right+1);return {overflow:element.scrollWidth>element.clientWidth+1,client:element.clientWidth,scroll:element.scrollWidth,offenders};});
	console.log('narrow',JSON.stringify(overflow));
	assert.equal(overflow.overflow,false,'compact activity does not overflow');
	await agent.screenshot({path:path.join(output,'context-activity-narrow.png')});
	assert.equal(await context.evaluate(el=>getComputedStyle(el).overflowY),'visible','Environment never owns a scrollbar');
 const environmentToggle=agent.locator('.openide-agent-window-header button[aria-controls="openide-agent-window-context"]');
 await environmentToggle.evaluate(button=>button.click());
 assert.equal(await context.evaluate(el=>el.inert),true,'closing card cannot retain interactive controls');
 await context.waitFor({state:'hidden'});
 await environmentToggle.evaluate(button=>button.click());
 await agent.waitForFunction(()=>{const card=document.querySelector('.openide-agent-window-context');return !card.hidden&&!card.inert&&card.getAnimations().length===0;});
 await environmentToggle.evaluate(button=>{button.click();button.click();});
 await agent.waitForFunction(()=>{const card=document.querySelector('.openide-agent-window-context');return !card.hidden&&!card.inert&&card.getAnimations().length===0;});
 await agent.emulateMedia({reducedMotion:'reduce'});
 await environmentToggle.evaluate(button=>button.click());
 assert.equal(await context.isVisible(),false,'reduced motion closes immediately');
 await environmentToggle.evaluate(button=>button.click());
 assert.equal(await context.evaluate(el=>el.getAnimations().length),0);
 await agent.emulateMedia({reducedMotion:'no-preference'});
	await agent.setViewportSize({width:1800,height:740});
	await agent.waitForTimeout(100);
	const chat=agent.locator('.openide-agent-window-chat > .openide-chat-native');
	const hostWidth=(await agent.locator('.openide-agent-window-chat').boundingBox()).width;
	assert.ok(Math.abs((await chat.boundingBox()).width-Math.min(hostWidth,1000))<2,'chat grows with its host after resizing, up to the readable maximum');
	const rail=agent.locator('.openide-agent-window-chat > .openide-chat-request-rail');
	assert.equal(await rail.count(),1,'request rail belongs to the outside gutter, not the centered transcript');
	await ide.evaluate(()=>window.agentActivityFixture.queue());
	const queue=agent.locator('.openide-chat-queue-host');
	await queue.getByText('Pending request with its original text',{exact:true}).waitFor();
	await queue.locator('button:has(.codicon-ellipsis)').click();
	await agent.locator('.monaco-menu:visible').waitFor();
	await agent.screenshot({path:path.join(output,'queue-menu.png')});
	await agent.locator('.monaco-menu:visible .action-item').filter({hasText:'Edit'}).click();
	await agent.waitForFunction(()=>document.querySelector('.openide-agent-window-chat textarea.openide-chat-prompt')?.value==='Pending request with its original text');
	assert.equal(await queue.isVisible(),false,'edited entry leaves the queue');
	await agent.setViewportSize({width:1400,height:1000});
	await ide.evaluate(()=>window.agentActivityFixture.openFile('App.tsx'));
	await ide.evaluate(()=>window.agentActivityFixture.openFile('A much longer file name for alignment.ts'));
	if (await agent.locator('.openide-agent-window-workspace-header button').last().isVisible()) { await agent.locator('.openide-agent-window-workspace-header button').last().click(); }
	if (!await env.isVisible()) { await environmentToggle.evaluate(button=>button.click()); }
	const viewRows=agent.locator('.openide-agent-window-view-row');
	await agent.waitForFunction(()=>document.querySelectorAll('.openide-agent-window-view-row').length===3);
	const alignment=await viewRows.evaluateAll(rows=>rows.map(row=>{
		const button=row.querySelector('.openide-agent-window-view-name'),label=button.querySelector('.monaco-icon-label'),close=row.querySelector('.openide-agent-window-chrome-action');
		return {labelX:label.getBoundingClientRect().left-row.getBoundingClientRect().left,justify:getComputedStyle(button).justifyContent,rightGap:row.getBoundingClientRect().right-close.getBoundingClientRect().right};
	}));
	assert.ok(alignment.every(row=>row.justify==='flex-start'&&row.rightGap<2&&Math.abs(row.labelX-alignment[0].labelX)<1),JSON.stringify(alignment));
	await agent.locator('.openide-agent-window-context h2').first().hover();
	assert.equal(await viewRows.first().locator('.openide-agent-window-chrome-action').evaluate(el=>getComputedStyle(el).opacity),'0','close is unobtrusive when idle');
	await viewRows.nth(1).hover();
	assert.equal(await viewRows.nth(1).locator('.openide-agent-window-chrome-action').evaluate(el=>getComputedStyle(el).opacity),'1','hover reveals close');
	await agent.screenshot({path:path.join(output,'open-views-aligned.png')});
	await viewRows.first().evaluate(el=>{window.retainedViewRow=el;});
	await viewRows.nth(1).locator('.openide-agent-window-chrome-action').click();
	await agent.waitForFunction(()=>document.querySelectorAll('.openide-agent-window-view-row').length===2);
	assert.equal(await viewRows.first().evaluate(el=>el===window.retainedViewRow),true,'closing another view keeps existing row DOM');
	const completed=await ide.evaluate(()=>window.agentActivityFixture.seedCompleted());
	await agent.waitForFunction(()=>document.querySelector('.openide-subagents-summary')?.textContent.includes('6 done'));
	const sidebarAvatars = agent.locator('.openide-chat-sessions-children .openide-subagent-avatar');
	await agent.waitForFunction(() => document.querySelectorAll('.openide-chat-sessions-children .openide-subagent-avatar').length === 7);
	await sidebarAvatars.evaluateAll(async images => { await Promise.all(images.map(image => image.decode())); });
	assert.equal(await agent.locator('.openide-chat-sessions-child > .codicon-comment-discussion').count(), 0, 'workers use activity avatars in the sessions sidebar');
	const sidebarAvatarSources = new Set(await sidebarAvatars.evaluateAll(images => images.map(image => image.src)));
	await agent.screenshot({path:path.join(output,'subagents-summary.png')});
	await runs.locator('.openide-subagents-summary').click();
	await agent.waitForFunction(()=>document.querySelectorAll('.openide-subagents-row').length===7);
	await agent.waitForTimeout(220);
	assert.equal(await agent.locator('.openide-subagents-rows').first().locator('.openide-subagents-row').count(),1);
	assert.equal(await agent.locator('.openide-subagents-rows').nth(1).locator('.openide-subagents-row').count(),6);
	await agent.waitForFunction(()=>[...document.querySelectorAll('.openide-subagents-row img')].every(img=>img.complete&&img.naturalWidth>0));
	assert.equal(new Set(await agent.locator('.openide-subagents-row img').evaluateAll(imgs=>imgs.map(img=>img.src))).size,6,'activity profiles select distinct generated assets');
	assert.deepEqual(new Set(await agent.locator('.openide-subagents-row img').evaluateAll(images => images.map(image => image.src))), sidebarAvatarSources, 'sidebar and overview reuse the same activity avatars');
	await agent.mouse.move(20, 20);
	await agent.screenshot({path:path.join(output,'subagents-overview.png')});
	await agent.locator('.openide-subagents-row[data-run-id="'+completed[0]+'"] .openide-subagents-open').click();
	await agent.locator('.openide-subagents-transcript').getByText('Completed: Research project',{exact:true}).waitFor();
	assert.equal(await agent.locator('.openide-subagents-work').getAttribute('aria-expanded'),'false','completed work starts with its final response');
	assert.equal(await agent.locator('.openide-subagents-transcript').getByText('Inspecting the workspace before making changes.',{exact:true}).count(),0);
	await agent.screenshot({path:path.join(output,'subagent-result.png')});
	await agent.locator('.openide-subagents-work').click();
	await agent.locator('.openide-subagents-transcript').getByText('Inspecting the workspace before making changes.',{exact:true}).waitFor();
	const workGroup = agent.locator('.openide-subagents-transcript .openide-chat-work-group');
	await workGroup.locator('summary').first().click();
	assert.equal(await workGroup.evaluate(el=>el.open),true,'tool groups retain their native disclosure');
	await agent.locator('.openide-subagents-transcript').getByText('The shared native services and independent layouts were preserved.',{exact:true}).waitFor();
	await agent.screenshot({path:path.join(output,'subagent-history.png')});
	await agent.locator('.openide-subagents-back').click();
	await agent.locator('.openide-subagents-overview').waitFor();
	assert.equal(await ide.locator('.openide-subagents-editor').count(),0,'Subagents UI stays in Agents Window');
	assert.equal(await ide.evaluate(()=>window.agentActivityFixture.active()===window.agentActivityFixture.selected),true);
	await agent.locator('.openide-agent-window-workspace-header button').last().click();
	if (!await env.isVisible()) { await environmentToggle.evaluate(button=>button.click()); }
	await agent.setViewportSize({width:900,height:480});
	await agent.waitForTimeout(100);
	assert.equal(await context.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'all Environment content belongs to the natural-height card');
	await ide.evaluate(async()=>{await window.agentActivityFixture.closeFiles();});
	assert.deepEqual(errors,[],'activity controls support auxiliary DOM');
	await agent.setViewportSize({width:1400,height:1000});
	const terminalClose = agent.locator('.openide-agent-window-terminal .codicon-close');
	if (await terminalClose.isVisible()) { await terminalClose.click(); }
	const pair = await ide.evaluate(() => window.agentActivityFixture.seedChatWorkers());
	const workerGroup = agent.locator('.openide-agent-window-chat .openide-chat-subagent-group');
	await workerGroup.waitFor();
	assert.equal(await workerGroup.count(), 1, 'restored adjacent workers retain the live grouping');
	const workerSummary = workerGroup.locator('summary');
	await workerSummary.getByText('Android inputs and Android surfaces started working', {exact:true}).waitFor();
	assert.equal(await workerSummary.locator('img').count(), 2);
	if (await agent.locator('.openide-agent-window-workspace-header button').last().isVisible()) { await agent.locator('.openide-agent-window-workspace-header button').last().click(); }
	if (!await env.isVisible()) { await environmentToggle.evaluate(button => button.click()); }
	await agent.waitForFunction(() => document.querySelector('.openide-subagents-summary')?.textContent.includes('2 working'));
	await workerSummary.locator('img').evaluateAll(async images => { await Promise.all(images.map(image => image.decode())); });
	await agent.screenshot({path:path.join(output,'subagents-working-chat.png')});
	await workerSummary.click();
	await workerGroup.locator('.openide-chat-sub').first().locator('.openide-chat-part-head').click();
	await agent.locator('.openide-subagents-detail-title').getByText('Android inputs',{exact:true}).waitFor();
	assert.equal(await ide.evaluate(() => window.agentActivityFixture.active()), pair.parent, 'chat activity opens a specialist without navigating the parent');
	assert.equal(await ide.locator('.openide-subagents-editor').count(), 0, 'chat clicks never open the specialist view in the IDE');
	await agent.waitForFunction(() => !document.querySelector('.openide-agent-window').getAnimations({subtree:true}).some(animation => animation.playState === 'running' && Number.isFinite(animation.effect.getTiming().iterations)));
	await agent.locator('.openide-subagents-transcript').getByText('Inspecting Android inputs in the specialist view.',{exact:true}).waitFor();
	await agent.screenshot({path:path.join(output,'subagents-working-detail.png')});
	await ide.evaluate(() => window.agentActivityFixture.seedLegacy());
	// Opening the overview must discover the new in-loop run alongside the older durable runs.
	if (await agent.locator('.openide-agent-window-workspace-header button').last().isVisible()) { await agent.locator('.openide-agent-window-workspace-header button').last().click(); }
	if (!await env.isVisible()) { await environmentToggle.evaluate(button => button.click()); }
	await runs.locator('.openide-subagents-summary').click();
	await agent.locator('.openide-subagents-row[data-run-id="legacy-review"] .openide-subagents-open').click();
	await agent.locator('.openide-subagents-detail-title').getByText('Reviewer 1/1',{exact:true}).waitFor();
	await ide.evaluate(() => window.agentActivityFixture.finishLegacy());
	await agent.locator('.openide-subagents-transcript').getByText('Current Reviewer result: VERDICT: PASS',{exact:true}).waitFor();
	assert.equal(await agent.locator('.openide-subagents-transcript').getByText('Old result',{exact:true}).count(),0);
	await agent.locator('.openide-subagents-back').click();
	await agent.waitForFunction(() => document.querySelectorAll('.openide-subagents-row').length === 8);
	await agent.locator('.openide-subagents-row[data-run-id="legacy-review"] .openide-subagents-open').click();
	await agent.locator('.openide-subagents-transcript').getByText('Current Reviewer result: VERDICT: PASS',{exact:true}).waitFor();
	assert.equal(await agent.locator('.openide-subagents-work').getAttribute('aria-expanded'),'true','returning to the same run preserves the open history');
	await agent.locator('.openide-subagents-work').click();
	await agent.locator('.openide-subagents-transcript').getByText('Current Reviewer result: VERDICT: PASS',{exact:true}).waitFor();
	assert.equal(await ide.locator('.openide-subagents-editor').count(),0);
	await agent.screenshot({path:path.join(output,'legacy-reviewer-result.png')});


	const result={sessionWorkerAvatars:true,compactChatWorkers:true,workerChatClickScoped:true,sourceShowMore:true,sectionCollapse:true,subagentWorkspaceTab:true,generatedRoleIcons:true,activeDoneList:true,summaryHistoryToggle:true,parentPreserved:true,liveTranscript:true,unrelatedTranscriptReplays:0,streamBurstReplays:1,hiddenTranscriptReplays:0,alignedOpenViews:true,nativeMenuScoped:true,processHoverTargets:true,singleKillAction:true,actualTerminalStopped:true,narrowNoOverflow:true};
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error) { if(app) { for(const [index,page] of app.windows().entries()) { await page.screenshot({path:path.join(output,`failure-${index}.png`)}).catch(()=>{}); console.error(await page.locator('.notifications-center,.notifications-toasts').allTextContents().catch(()=>[])); } } throw error; } finally { if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
