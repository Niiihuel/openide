// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-activity-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-activity-'));
const output = path.join(root, '.build/chat-activity-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'openide.memory.captureMode': 'off' }));
let app;
try {
 app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
 const page = await app.firstWindow();
 page.on('pageerror', error => console.error(error));
 page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
 await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
 await page.evaluate(async base => {
  const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
  const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
  const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
  const { ITerminalService } = await import(base + 'workbench/contrib/terminal/browser/terminal.js');
  const { CancellationToken } = await import(base + 'base/common/cancellation.js');
  const { Event } = await import(base + 'base/common/event.js');
  const { observableValue } = await import(base + 'base/common/observable.js');
  const { MarkdownString } = await import(base + 'base/common/htmlContent.js');
  const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
  const { createOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
  registerAction2(class extends Action2 {
   constructor() { super({id:'test.chatActivity',title:'Chat Activity Fixture',f1:true}); }
   async run(accessor) {
    const instantiation = accessor.get(IInstantiationService);
    const service = accessor.get(IOpenideAgentService), terminals=accessor.get(ITerminalService);
    const host = document.createElement('div'); host.className = 'openide-chat-native activity-fixture';
    host.style.cssText='position:absolute;inset:70px 60px;z-index:1000;padding:30px;overflow:auto;background:var(--vscode-editor-background);';
    document.querySelector('.monaco-workbench').append(host);
    const renderer=instantiation.createInstance(OpenideChatResponseRenderer,observableValue('width',900),Event.None);
    const template=renderer.renderTemplate(host);
    const command={kind:'terminal',callId:'run',command:'npm test',output:'All checks passed',state:'exited',exitCode:0,background:false};
    const read={kind:'explore',id:'reads',isComplete:true,entries:[{callId:'read',tool:'read_file',target:'src/app.ts',state:'success'}]};
    const prose=text=>({kind:'markdown',value:new MarkdownString(text)});
    let content=[{kind:'edit',diff:{path:'app.ts'},added:0,removed:0},{kind:'edit',diff:{path:''},added:0,removed:0},prose('Voy a revisar la navegación y los controles de la aplicación.'),read,command,prose('Los controles conservan sus atajos y el estado de cada panel.'),{kind:'tool',callId:'browser',name:'browser_evaluate',argumentsJson:JSON.stringify({expression:'document.querySelectorAll("button")'}),state:'success',resultText:'4 buttons'},prose('Listo para probar.')];
    const render=(complete=true)=>renderer.renderElement({element:createOpenideChatResponseItem({id:'fixture',requestId:'request',content,isComplete:complete,startedAt:Date.now()-346000,completedAt:complete?Date.now():undefined})},0,template);
    render();
    window.activityFixture={template,render,failTool:()=>{content=[...content,{kind:'tool',callId:'error',name:'browser_playwright',argumentsJson:'{}',state:'error',resultText:'Error: No preview is connected. Use browser_navigate or browser_open first.\n'+ 'Full diagnostic '.repeat(600)+'END OF ERROR'}];render();},fail:()=>{content=[...content,{...command,callId:'failed',exitCode:1,output:'The check failed'}];render();},run:async()=>{await service.tools.runShellCaptured('printf activity-title-check',CancellationToken.None,10000,'activity-fixture');return terminals.instances.map(instance=>instance.title);},dispose:()=>{renderer.disposeTemplate(template);renderer.dispose();host.remove();}};
   }
  });
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await page.keyboard.press('Control+Shift+KeyP');
 await page.locator('.quick-input-widget input').first().fill('>Chat Activity Fixture');
 await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Chat Activity Fixture'}).first().waitFor();
 await page.keyboard.press('Enter');
 const fixture=page.locator('.activity-fixture'); await fixture.waitFor();
 const groups=fixture.locator('.openide-chat-work-group');
 assert.equal(await groups.count(),2);
 assert.equal(await fixture.locator('.openide-chat-edit-card:visible').count(),0,'empty and pending edits never produce fake diff cards');
 assert.equal(await groups.first().getAttribute('open'),null);
 assert.match(await fixture.locator('.openide-chat-turn-duration').innerText(),/Worked for 5m/);
 await page.screenshot({path:path.join(output,'collapsed.png')});
 await groups.first().locator('summary').first().click();
 assert.equal(await groups.first().locator('.openide-chat-work-group-body').isVisible(),true);
 await page.evaluate(()=>window.activityFixture.render());
 assert.notEqual(await groups.first().getAttribute('open'),null);
 await page.evaluate(()=>window.activityFixture.fail());
 assert.match(await fixture.locator('.openide-chat-response-parts > .openide-chat-term-card').innerText(),/npm test/);
 await fixture.evaluate(el=>el.style.width='360px');
 assert.ok(await fixture.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'narrow transcript has no horizontal overflow');
 await page.evaluate(()=>window.activityFixture.failTool());
 const errorRow=fixture.locator('.openide-chat-tool-activity.openide-chat-part-error');
 assert.equal(await errorRow.locator('.openide-chat-part-chevron').isVisible(),true);
 assert.equal(await errorRow.locator('.openide-chat-part-note').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
 assert.ok(await errorRow.locator('.openide-chat-part-head').evaluate(el=>el.clientHeight<40),'one-line error at narrow width');
 await errorRow.locator('.openide-chat-part-head').click();
 assert.match(await errorRow.locator('pre').innerText(),/END OF ERROR$/);
 await fixture.evaluate(el=>el.style.width='');
 const titles=await page.evaluate(()=>window.activityFixture.run());
 assert.ok(titles.includes('printf activity-title-check'),JSON.stringify(titles));
 await page.screenshot({path:path.join(output,'expanded.png')});
 await page.evaluate(()=>window.activityFixture.dispose());
 console.log(JSON.stringify({collapsedGroups:true,preservesExpansion:true,visibleFailure:true,elapsedTime:true,narrowLayout:true,commandTerminalTitle:true}));
} finally { if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
