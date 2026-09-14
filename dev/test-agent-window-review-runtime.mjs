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
const output = path.join(root, '.build/agent-window-review-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace/src/nested'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace/src/nested/component.ts'), 'export const fromAgentFiles = true;\n');
fs.writeFileSync(path.join(tmp, 'workspace/hidden.txt'), 'Excluded');
fs.writeFileSync(path.join(tmp,'workspace/src/late.ts'),'export const late = true;\n');
for (let i=1;i<40;i++) fs.writeFileSync(path.join(tmp, `workspace/src/change-${i}.ts`), `export const value${i} = ${i};\n`);
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
		const { IWorkbenchThemeService } = await import(base + 'workbench/services/themes/common/workbenchThemeService.js');
		const { ICodeEditorService } = await import(base + 'editor/browser/services/codeEditorService.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentWindow', title: 'Agent Window Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService);
				const views = accessor.get(IViewsService);
				const editors = accessor.get(IEditorService), groups = accessor.get(IEditorGroupsService);
				const agent = accessor.get(IOpenideAgentService);
				const code = accessor.get(ICodeEditorService);
				const theme = accessor.get(IWorkbenchThemeService);
				agent.completeText = async () => 'completionFromReview';
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Agent window fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value;
				const sessions = view._widget.value.sessionStore;
				const first = sessions.createBackground('Window fixture first', [{ role: 'user', content: 'First shared conversation', messageId: 'first-message' }, { role: 'assistant', content: 'First shared answer' }]);
				const second = sessions.createBackground('Window fixture second', Array.from({length:40},(_,i)=>[{role:'user',content:`Request ${i+1} navigate here`,messageId:`request-${i}`},{role:'assistant',content:`Answer ${i+1} preview here. `+'Long answer paragraph. '.repeat(100)}]).flat());
				widget.refreshSessions();
				widget.openSession(second);
				for (let index = 0; index < 40; index++) {
					const changed = index === 0 ? 'src/nested/component.ts' : `src/change-${index}.ts`;
					agent.diffSnapshot.setBaselineOnce(changed, '', false, second);
					sessions.saveChangeSet(second, {messageId:`review-${index}`,timestamp:index,state:'finalized',files:[{uri:changed,operation:'create',beforeContent:'',afterContent:index === 0 ? 'export const fromAgentFiles = true;\n' : `export const value${index} = ${index};\n`}]});
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
                    theme: async label => { const target=(await theme.getColorThemes()).find(t=>t.label===label);await theme.setColorTheme(target,'preview');return theme.getColorTheme().tokenColors.length; },
                    editAndSelectComparison: () => { const e = code.listDiffEditors().find(e => e.getModel()?.modified.uri.path.endsWith('/component.ts')).getModifiedEditor(); e.focus(); e.executeEdits('test', [{ range: {startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1}, text:'// Modal review edit\n' }]); e.setSelection({startLineNumber:1,startColumn:4,endLineNumber:1,endColumn:21}); },
                    comparison: () => code.listDiffEditors().map(e=>({before:e.getModel()?.original.getValue(),after:e.getModel()?.modified.getValue()})),
                    openedFile: () => code.listCodeEditors().find(e=>e.getDomNode()?.closest('.editor-instance')&&!e.getDomNode()?.closest('.openide-changes-editor'))?.getModel()?.getValue(),
					addReviewFile: () => { sessions.saveChangeSet(second,{messageId:'review-late',timestamp:40,state:'finalized',files:[{uri:'src/late.ts',operation:'create',beforeContent:'',afterContent:'export const late = true;\n'}]}); agent.diffSnapshot.setBaselineOnce('src/late.ts','',false,second); agent.diffSnapshot.markPending('src/late.ts',true,1,0); agent._onDidChangeFileDiff.fire({path:'src/late.ts',added:1,removed:0}); },
					focusedReview: () => code.getFocusedCodeEditor()?.getModel()?.uri.path,
					code: () => code.listCodeEditors().filter(e=>e.getDomNode()?.closest('.openide-changes-editor')).map(e=>({uri:e.getModel()?.uri.toString(),text:e.getModel()?.getValue(),hint:!!e.getContribution('openide.editor.selectionHint'),inline:!!e.getContribution('editor.contrib.inlineCompletionsController')})),
					selectReview: () => {const e=code.listCodeEditors().find(e=>e.getDomNode()?.closest('.openide-changes-editor')&&e.getModel()?.uri.path.endsWith('/component.ts')); e.focus(); e.setSelection({startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:7});},
					editReview: () => {const e=code.listCodeEditors().find(e=>e.getDomNode()?.closest('.openide-changes-editor')&&e.getModel()?.uri.path.endsWith('/component.ts')); e.focus(); e.setPosition({lineNumber:1,column:1});e.executeEdits('test',[{range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},text:'// Unsaved review edit\n'}]);},
					prepareCompletion: () => {const e=code.listCodeEditors().find(e=>e.getDomNode()?.closest('.openide-changes-editor')&&e.getModel()?.uri.path.endsWith('/component.ts')); e.focus(); e.setPosition({lineNumber:1,column:e.getModel().getLineMaxColumn(1)});e.trigger('test','editor.action.inlineSuggest.trigger',{});},
					dirty: () => editors.editors.filter(e=>e.typeId==='openide.changes').map(e=>e.isDirty()),
					list: () => [...widget._companions][0]._list.scrollTop,
					resetList: () => [...widget._companions][0]._list.scrollToEnd(),
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
 await agent.setViewportSize({width:1440,height:900});
 await agent.locator('.openide-chat-request-rail').waitFor();
 assert.equal(await agent.locator('.openide-chat-request-tick').count(),40);
 const rail=agent.locator('.openide-chat-request-ticks');
 const rb=await rail.boundingBox();
 await agent.mouse.move(rb.x+4,rb.y+rb.height/40*3.5);
 await agent.locator('.openide-chat-request-preview-prompt').filter({hasText:'Request 4'}).waitFor();
 await agent.screenshot({path:path.join(output,'request-rail.png')});
 const before=await ide.evaluate(()=>window.agentWindowFixture.list());
 await agent.mouse.click(rb.x+4,rb.y+rb.height/40*3.5);
 await agent.waitForTimeout(300);
 assert.ok(await ide.evaluate(()=>window.agentWindowFixture.list())<before,'rail jumps back without following the tail');
 await agent.locator('.openide-chat-request-rail').focus(); await agent.keyboard.press('Home'); await agent.keyboard.press('Enter');
 assert.equal(await ide.evaluate(()=>window.agentWindowFixture.list()),0);
 await agent.keyboard.press('Escape');
 const summary=agent.locator('.openide-agent-window-review-summary');
 assert.equal(await summary.locator('.openide-agent-window-row-label').textContent(),'Changes');
 assert.equal(await summary.locator('.codicon-chevron-down').count(),0);
 assert.equal(await agent.locator('.openide-context-activity-toggle.oi-btn').count(),0);
 await summary.click();
 await agent.locator('.openide-changes-file').first().waitFor();
 assert.equal(await agent.locator('.openide-changes-save .monaco-button').count(),1);
 assert.equal(await agent.locator('.openide-changes-save .monaco-button').getAttribute('aria-disabled'),'true');
 await agent.locator('.openide-agent-window-editor-host .tabs-container .tab').filter({hasText:'Changes'}).waitFor();
 assert.equal(await agent.locator('.openide-changes-editor .monaco-editor').count(),0,'all reviews begin collapsed without loading editors');
 assert.equal(await agent.locator('.openide-changes-file.collapsed').count(),40);
 await agent.screenshot({path:path.join(output,'changes-collapsed.png')});
 await agent.locator('.openide-changes-file[data-path="src/nested/component.ts"] .openide-changes-file-label').click();
 await agent.locator('.openide-changes-editor .monaco-editor').first().waitFor();
 await agent.locator('.openide-review-added-line').first().waitFor();
 assert.equal(await agent.locator('.openide-changes-file').count(),40);
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.code())).length<12,'offscreen editors are virtualized');
 const contributions=await ide.evaluate(()=>window.agentWindowFixture.code());
 assert.ok(contributions.every(e=>e.hint&&e.inline),JSON.stringify(contributions));
 await agent.screenshot({path:path.join(output,'changes.png')});
 await ide.evaluate(()=>window.agentWindowFixture.editReview());
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.dirty())).includes(true));
 await agent.evaluate(() => {
  const row = document.querySelector('.openide-changes-file[data-path="src/nested/component.ts"]');
  window.reviewIdentity = { row, editor: row.querySelector('.monaco-editor') };
 });
 await ide.evaluate(()=>window.agentWindowFixture.addReviewFile());
 await agent.waitForFunction(()=>document.querySelectorAll('.openide-changes-file').length===41);
 await ide.waitForFunction(()=>window.agentWindowFixture.focusedReview()?.endsWith('/component.ts'));
 assert.equal(await agent.evaluate(() => {
  const {row, editor} = window.reviewIdentity;
  return row === document.querySelector('.openide-changes-file[data-path="src/nested/component.ts"]') && row.querySelector('.monaco-editor') === editor;
 }), true, 'adding a file retains the existing row and editable Monaco instance');
 await agent.getByRole('button',{name:'Open in modal',exact:true}).click();
 await agent.locator('.monaco-modal-editor-block:not(.embedded-editor) .openide-changes-editor').waitFor();
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.code())).some(e=>e.text.includes('Unsaved review edit')));
 await agent.getByRole('button',{name:'Return to workspace panel',exact:true}).click();
 const filter=agent.locator('.openide-changes-toolbar input'); await filter.fill('src change-39');
 await agent.waitForFunction(()=>document.querySelectorAll('.openide-changes-file').length===1);
 assert.equal(await agent.locator('.openide-changes-file.collapsed').count(),1,'new search matches stay collapsed');
 if (await agent.getByRole('button',{name:'Toggle file tree',exact:true}).getAttribute('aria-pressed') !== 'true') { await agent.getByRole('button',{name:'Toggle file tree',exact:true}).click(); }
 const treeLeaf=agent.locator('.openide-changes-navigator .monaco-list-row').filter({hasText:'change-39.ts'});
 await treeLeaf.waitFor();
 assert.equal(await treeLeaf.locator('.label-name').evaluate(el=>getComputedStyle(el).maskImage),'none','native tree labels do not fade before their overflow boundary');
 await agent.screenshot({path:path.join(output,'native-tree-labels.png')});
 assert.equal(await treeLeaf.locator('.monaco-tl-twistie').evaluate(el=>getComputedStyle(el).boxSizing),'content-box','native indentation does not eat the twistie width');
 assert.equal(await treeLeaf.locator('.monaco-icon-label').evaluate(el=>getComputedStyle(el,'::before').boxSizing),'content-box','file glyph keeps its complete content width');
 await treeLeaf.click();
 await agent.locator('.openide-changes-file[data-path="src/change-39.ts"] .monaco-editor').waitFor();
 assert.equal(await agent.locator('.openide-changes-file').count(),1);
 await filter.fill('component');
 await agent.locator('.openide-changes-file[data-path="src/nested/component.ts"] .monaco-editor').waitFor();
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.code())).some(e=>e.text.includes('Unsaved review edit')),'filter does not lose dirty models');
 await ide.evaluate(()=>window.agentWindowFixture.selectReview());
 await agent.keyboard.press('Control+KeyL');
 await agent.locator('.openide-agent-window-chat .openide-chat-snippet-card').waitFor({timeout:5000});
 await ide.evaluate(()=>window.agentWindowFixture.prepareCompletion());
 await agent.locator('.ghost-text, .ghost-text-decoration').first().waitFor({timeout:10000});
 await agent.keyboard.press('Tab');
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.code())).some(e=>e.text.includes('completionFromReview')),'native autocomplete accepted with Tab');
 await agent.getByRole('button',{name:'Save all',exact:true}).click();
 await agent.waitForTimeout(300);
 assert.ok(!(await ide.evaluate(()=>window.agentWindowFixture.dirty())).includes(true));
 assert.ok(fs.readFileSync(path.join(tmp,'workspace/src/nested/component.ts'),'utf8').includes('Unsaved review edit'));
 for (const width of [1050,800,640]) { await agent.setViewportSize({width,height:760}); await agent.screenshot({path:path.join(output,`review-${width}.png`)}); const b=await agent.locator('.openide-changes-editor').boundingBox(); assert.ok(b.x>=0&&b.x+b.width<=width+1,JSON.stringify({width,b})); const filter=await agent.locator('.openide-changes-filter').boundingBox(); const toolbar=await agent.locator('.openide-changes-toolbar').boundingBox(); assert.ok(filter.height<=30&&filter.y+filter.height<=toolbar.y+toolbar.height,JSON.stringify({width,filter,toolbar})); const uncovered=await agent.locator('.openide-changes-editor').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width*0.65,r.y+r.height*0.8));}); assert.ok(uncovered,`Review covered by chat at ${width}`); }
 await agent.getByRole('button',{name:'Collapse all files',exact:true}).click();
 assert.equal(await agent.locator('.openide-changes-editor .monaco-editor').count(),0);
 await agent.getByRole('button',{name:'Clear filter',exact:true}).click();
 await agent.waitForFunction(()=>document.querySelectorAll('.openide-changes-file.collapsed').length===41);
 await filter.fill('missing-file-no-match');
 await agent.locator('.openide-changes-files').getByRole('heading', { name: 'No matching changes', exact: true }).waitFor();
 await filter.press('Escape');
 await agent.waitForFunction(()=>document.querySelectorAll('.openide-changes-file.collapsed').length===41);
 await agent.setViewportSize({width:1440,height:900});
 await filter.fill('component');
 await agent.locator('.openide-changes-file[data-path="src/nested/component.ts"]').getByRole('button',{name:'Open Diff in Modal',exact:true}).click();
 await ide.waitForFunction(()=>window.agentWindowFixture.comparison().some(e=>e.before===''&&e.after?.includes('Unsaved review edit')));
 await agent.locator('.monaco-modal-editor-block:not(.embedded-editor) .monaco-diff-editor').waitFor();
 await ide.evaluate(()=>window.agentWindowFixture.editAndSelectComparison());
 await agent.keyboard.press('Control+KeyL');
 await agent.waitForFunction(()=>[...document.querySelectorAll('.openide-chat-snippet-card')].some(el=>el.textContent.includes('Modal review edit')));
 assert.equal(await agent.locator('.openide-chat-snippet-card').count(),1,'reattaching the edited range updates the existing snapshot');
 assert.ok((await ide.evaluate(()=>window.agentWindowFixture.comparison())).some(e=>e.after.includes('Modal review edit')),'modal edits the shared live file');
 await agent.screenshot({path:path.join(output,'before-after-modal.png')});
 assert.equal(await agent.locator('.diffOverview:visible').count(),0,'comparison uses the editor scrollbars without an extra diff overview rail');
 await agent.getByRole('button',{name:'Return to workspace panel',exact:true}).click();
 await agent.locator('.openide-agent-window-workspace .tab').filter({hasText:'Changes'}).first().click();
 await agent.locator('.openide-changes-file[data-path="src/nested/component.ts"] .openide-changes-file-label').click();
 await ide.waitForFunction(()=>window.agentWindowFixture.code().some(e=>e.text.includes('Modal review edit')));
 await agent.getByRole('button',{name:'Save all',exact:true}).click();
 await agent.waitForTimeout(200);
 assert.ok(fs.readFileSync(path.join(tmp,'workspace/src/nested/component.ts'),'utf8').includes('Modal review edit'));
 const openFile=agent.locator('.openide-changes-file[data-path="src/nested/component.ts"]').getByRole('button',{name:'Open file',exact:true});
 await openFile.click();
 await agent.locator('.editor-instance .monaco-editor').first().waitFor();
 await ide.waitForFunction(()=>window.agentWindowFixture.openedFile()?.includes('Unsaved review edit'));
 for (const label of ['OpenIDE Dark','OpenIDE Light']) {
  assert.ok(await ide.evaluate(label=>window.agentWindowFixture.theme(label),label)>50,'theme inherits the native syntax rules');
  await agent.waitForTimeout(200);
  await agent.screenshot({path:path.join(output,label.replaceAll(' ','-')+'.png')});
 }
 assert.equal(await agent.locator('.monaco-diff-editor:visible').count(),0,'Open file opens the editable file, not another diff with a second overview scrollbar');
 assert.equal(await agent.locator('.openide-agent-window-editor-host .monaco-editor:visible').count(),1);
 assert.deepEqual(runtimeErrors,[]);
 console.log('Request rail preview/jump/keyboard; all-files inline review; lazy native editors; dirty filter/modal; Continue; autocomplete Tab; save; responsive passed');
} finally { if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
