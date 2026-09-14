// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real agent browser tool, IPC lifecycle and native auxiliary tabs on an isolated display.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {_electron}=createRequire(path.join(root,'vscode/package.json'))('playwright-core');
if(process.env.OPENIDE_TEST_VIRTUAL_DISPLAY!=='1') throw new Error('Use dev/run-virtual-gui.mjs');
const html=`<!doctype html><title>Automation fixture</title><style>body{background:#181818;color:white;font:20px system-ui;padding:70px}button,input{font:inherit;padding:12px;margin:20px}section{height:1200px}</style><h1>Browser feedback</h1><button onclick="window.clicked=(window.clicked||0)+1">Save</button><input aria-label="Name"><section></section><button>Bottom</button><script>
window.samples=[]; function sample(){const c=window.__openideAgentCursor;if(c&&samples.length<1600)samples.push({label:c.labelText(),box:c.boxRect(),position:c.position(),typing:c.typingActive(),clicked:window.clicked||0});requestAnimationFrame(sample)} sample();</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'openide-playwright-feedback-'));
const output=path.join(root,'.build/playwright-feedback-runtime');fs.mkdirSync(output,{recursive:true});
fs.mkdirSync(path.join(tmp,'profile/User'),{recursive:true});fs.mkdirSync(path.join(tmp,'workspace'));
fs.writeFileSync(path.join(tmp,'profile/User/settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','openide.memory.captureMode':'off','openide.agent.notifications.enabled':false}));
let app; const errors=[];
try{
app=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),cwd:path.join(root,'vscode'),args:['.',path.join(tmp,'workspace'),'--user-data-dir',path.join(tmp,'profile'),'--shared-data-dir',path.join(tmp,'shared'),'--extensions-dir',path.join(tmp,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--no-sandbox','--ozone-platform=x11'],env:{...process.env,VSCODE_DEV:'1'},timeout:90000});
const ide=await app.firstWindow();ide.on('pageerror',e=>errors.push(e.message));await ide.waitForSelector('.monaco-workbench',{timeout:90000});
await ide.evaluate(async base=>{
 const {Action2,registerAction2}=await import(base+'platform/actions/common/actions.js');
 const {ICommandService}=await import(base+'platform/commands/common/commands.js');
 const {IConfigurationService}=await import(base+'platform/configuration/common/configuration.js');
 const {IFileService}=await import(base+'platform/files/common/files.js');
 const {IEnvironmentService}=await import(base+'platform/environment/common/environment.js');
 const {IPlaywrightService}=await import(base+'platform/browserView/common/playwrightService.js');
 const {IBrowserViewWorkbenchService}=await import(base+'workbench/contrib/browserView/common/browserView.js');
 const {IOpenideNativeServices}=await import(base+'workbench/contrib/openideAgent/common/openideNativeServices.js');
 const {OpenideBrowserAutomation}=await import(base+'workbench/contrib/openideAgent/browser/openideBrowserTools.js');
 const {getWindows}=await import(base+'base/browser/dom.js');
 const {CancellationToken}=await import(base+'base/common/cancellation.js');
 registerAction2(class extends Action2{
 constructor(){super({id:'test.playwrightFeedback',title:'Playwright Feedback Fixture',f1:true})}
 async run(a){
 const commands=a.get(ICommandService), browsers=a.get(IBrowserViewWorkbenchService), playwright=a.get(IPlaywrightService);
 const automation=new OpenideBrowserAutomation(a.get(IOpenideNativeServices),a.get(IConfigurationService),browsers,playwright,a.get(IFileService),a.get(IEnvironmentService));
 const tools=new Map();automation.registerTools({registerTool:t=>tools.set(t.def.name,t)});
 const events=[];playwright.onDidChangeActivity(e=>events.push(e));
 window.feedback={events,open:()=>commands.executeCommand('openide.agent.openAgentWindow'),
 async navigate(url){const target=[...getWindows()].map(w=>w.window).find(w=>w.document.querySelector('.openide-agent-window'));await browsers.openPreview(url,undefined,{targetWindowId:target.vscodeWindowId,reveal:true});},
 async run(args){return tools.get('browser_playwright').invoke(args,CancellationToken.None)},
 start(args){this.result=undefined;this.run(args).then(r=>this.result=r,e=>this.result='FAILED: '+e.message)},
 name:()=>browsers.getPreview()?.getName(),
 };
 }});
},`vscode-file://vscode-app${root}/vscode/out/vs/`);
await ide.keyboard.press('Control+Shift+KeyP');await ide.locator('.quick-input-widget input').first().fill('>Playwright Feedback Fixture');await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Playwright Feedback Fixture'}).first().waitFor();await ide.keyboard.press('Enter');await ide.waitForFunction(()=>!!window.feedback);
const opened=app.waitForEvent('window');await ide.evaluate(()=>window.feedback.open());const agent=await opened;agent.on('pageerror',e=>errors.push(e.message));await agent.setViewportSize({width:1440,height:900});await agent.locator('.openide-chat-input-card textarea').waitFor();
await ide.evaluate(url=>window.feedback.navigate(url),url);await agent.locator('.browser-container').waitFor();
const read=async expression=>app.evaluate(async({webContents},{url,expression})=>{const p=webContents.getAllWebContents().find(w=>w.getURL()===url);return p?.executeJavaScript(expression)}, {url,expression});
for(let i=0;i<80&&!(await read('!!document.querySelector("input")'));i++)await new Promise(r=>setTimeout(r,100));
const code=`await page.getByRole('button',{name:'Save',exact:true}).click(); await page.getByRole('textbox',{name:'Name'}).fill('Kept value'); await page.mouse.wheel(0,120); await page.waitForTimeout(1600); return 'finished';`;
await ide.evaluate(code=>window.feedback.start({code,timeoutMs:100}),code);
await ide.waitForFunction(()=>window.feedback.name()?.startsWith('Playwright ·'));
await agent.locator('.tab.active').filter({hasText:'Playwright ·'}).waitFor();
await agent.screenshot({path:path.join(output,'active-tab.png')});
await ide.waitForFunction(()=>window.feedback.result!==undefined);
const deferred=await ide.evaluate(()=>window.feedback.result);assert.match(deferred,/Run still pending:/);
assert.equal(await ide.evaluate(()=>window.feedback.name().startsWith('Playwright ·')),true,'deferral does not clear active state');
await ide.waitForFunction(()=>!window.feedback.name()?.startsWith('Playwright ·'),{},{timeout:30000});
const samples=await read('samples');
assert.ok(samples.some(s=>s.label==='Click'&&s.box&&s.clicked===0),'target is shown before click');
assert.ok(samples.some(s=>s.label==='Typing'&&s.typing),'typing feedback is visible');
assert.ok(samples.some(s=>s.label==='Scroll'),'scroll feedback is visible');
assert.equal(await read('clicked'),1);assert.equal(await read('document.querySelector("input").value'),'Kept value');
assert.equal(await read('__openideAgentCursor.typingActive()'),false);
const id=deferred.match(/Run still pending: ([^.]+)\./)[1];
assert.match(await ide.evaluate(id=>window.feedback.run({deferredResultId:id,timeoutMs:2000}),id),/finished/);
const navigation=await ide.evaluate(url=>window.feedback.run({code:`await page.goto(${JSON.stringify(url)}); await page.getByRole('button',{name:'Save',exact:true}).click(); return 'navigated';`,timeoutMs:15000}),url);
assert.match(navigation,/navigated/);assert.equal(await read('clicked'),1);assert.ok((await read('samples')).some(s=>s.label==='Click'&&s.box&&s.clicked===0),'navigation reinstalls feedback');
const failure=await ide.evaluate(()=>window.feedback.run({code:"throw new Error('fixture failure')",timeoutMs:10000}));assert.match(failure,/fixture failure/);
await ide.waitForFunction(()=>!window.feedback.name()?.startsWith('Playwright ·'));
const before=await read('__openideAgentCursor.position()');
await app.evaluate(({webContents},url)=>{const p=webContents.getAllWebContents().find(w=>w.getURL()===url);p.sendInputEvent({type:'mouseMove',x:15,y:15});},url);
assert.deepEqual(await read('__openideAgentCursor.position()'),before,'user mouse does not move agent overlay');
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,deferredLifecycle:true,navigation:true,actionsBeforeInput:true,typing:true,scroll:true,errorCleanup:true,events:await ide.evaluate(()=>window.feedback.events)},null,2));
console.log('PASS: Playwright tab lifetime, deferred completion, actions, navigation, error cleanup and independent cursor.');
}finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close()}server.close();fs.rmSync(tmp,{recursive:true,force:true})}
