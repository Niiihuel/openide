#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-canvas-'));
const output = path.join(root, '.build/canvas-design-runtime');
const userData = path.join(tmp, 'user-data'); const workspace = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true }); fs.mkdirSync(workspace); fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','update.showPostInstallInfo':false,'openide.memory.captureMode':'off','window.titleBarStyle':'custom'}));
let app, page, exportedApp; const logs=[];
async function command(name) {
 await page.keyboard.press('Escape'); await page.keyboard.press('Control+Shift+KeyP');
 await page.locator('.quick-input-widget input').first().fill(`>${name}`);
 await page.locator('.quick-input-list .monaco-list-row').filter({hasText:name}).first().waitFor(); await page.keyboard.press('Enter');
}
async function approval(title, accept=true) {
 const picker=page.locator('.quick-input-widget');await picker.getByText(title,{exact:true}).waitFor();
 const once=picker.locator('.monaco-list-row').filter({hasText:'Allow once'});await once.waitFor({state:'visible'});
 if(accept)await once.click();else await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
}
async function until(check) { for(let i=0;i<200;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out'); }
async function frameFor(selector) { return until(async()=>{for(const f of page.frames())if(await f.locator(selector).count().catch(()=>0))return f;}); }
try {
 app=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),cwd:path.join(root,'vscode'),args:['.',workspace,'--user-data-dir',userData,'--shared-data-dir',path.join(tmp,'shared'),'--extensions-dir',path.join(tmp,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--no-sandbox','--ozone-platform=x11'],env:{...process.env,VSCODE_DEV:'1'},timeout:90000});
 page=await app.firstWindow();page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(String(e)));await page.waitForSelector('.monaco-workbench',{timeout:90000});
 // Test-only service access creates the editor fixture after verifying the real chat bridge.
 await page.evaluate(async base => {
  const {Action2,registerAction2}=await import(base+'platform/actions/common/actions.js');
  const {IOpenideCanvasService}=await import(base+'workbench/contrib/openideAgent/browser/openideCanvasService.js');
  const {ICommandService}=await import(base+'platform/commands/common/commands.js');
  registerAction2(class extends Action2 {constructor(){super({id:'test.canvas.fixture',title:'Canvas Fixture Services',f1:true});}run(accessor){window.canvasFixture=accessor.get(IOpenideCanvasService);window.canvasCommands=accessor.get(ICommandService);}});
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await command('Canvas Fixture Services');
 await page.evaluate(()=>window.canvasCommands.executeCommand('openide.agent.injectCanvasPrompt',{prompt:'Keep my existing draft.',send:false}));
 await command('Canvas: Create');let frame=await frameFor('.gallery');
 assert.equal(await frame.locator('[data-template]').count(),9);
 const proceed=frame.getByRole('button',{name:'Continue in chat',exact:true});
 assert(await proceed.isDisabled());
 await frame.getByLabel('Project title (optional)',{exact:true}).fill('Mobile checkout');
 await frame.locator('[data-template="mobile"] input').check();
 await frame.getByLabel('Device',{exact:true}).selectOption('mobile');
 await frame.getByLabel('What do you want to create? (optional)',{exact:true}).fill('A checkout with a confirmation screen.');
 assert(!await proceed.isDisabled());
 assert.equal(fs.existsSync(path.join(workspace,'.openide/designs')),false,'selection alone creates no file');
 await page.screenshot({path:path.join(output,'gallery.png')});
 await proceed.click();
 const prompt=page.locator('textarea.openide-chat-prompt').first();
 await until(async()=>/Mobile checkout/.test(await prompt.inputValue()));
 const draft=await prompt.inputValue();
 assert.match(draft,/Keep my existing draft/);assert.match(draft,/Mobile checkout/);assert.match(draft,/confirmation screen/);
 assert.equal(fs.existsSync(path.join(workspace,'.openide/designs')),false,'continue stages the request instead of creating a canned file');
 assert.equal(await page.locator('.openide-composer-send.running').count(),0,'the user sends the staged request');
 await page.screenshot({path:path.join(output,'choice-in-chat.png')});
 await page.evaluate(async()=>{const created=await window.canvasFixture.createDesign('mobile','Mobile checkout','mobile');await window.canvasFixture.open(created.path);});
 frame=await frameFor('#design-status');
 const designDir=path.join(workspace,'.openide/designs');const folder=await until(()=>fs.existsSync(designDir)&&fs.readdirSync(designDir)[0]);const design=path.join(designDir,folder,'design.json');
 const read=()=>JSON.parse(fs.readFileSync(design,'utf8'));const revision=()=>read().revision;
 async function savedAfter(action){const before=revision();await action();await until(()=>revision()>before);await until(async()=>!(await frame.locator('#design-status').textContent()).includes('Saving'));}
 assert.equal(read().document.template,'mobile');assert(fs.existsSync(path.join(path.dirname(design),'DESIGN.md')));
 await frame.locator('[data-node="heading"]').click();await frame.getByLabel('Text',{exact:true}).fill('Your order');
 await savedAfter(()=>frame.getByLabel('Text',{exact:true}).press('Tab'));
 assert.equal(read().document.screens[0].nodes[0].text,'Your order');
 await savedAfter(()=>frame.getByRole('button',{name:'Undo',exact:true}).click());assert.equal(read().document.screens[0].nodes[0].text,'Mobile checkout');
 await savedAfter(()=>frame.getByRole('button',{name:'Redo',exact:true}).click());assert.equal(read().document.screens[0].nodes[0].text,'Your order');
 await frame.locator('[data-node="heading"]').click();const slider=frame.getByRole('slider').first();const handle=await slider.elementHandle();
 await slider.evaluate(el=>{el.value='28';el.dispatchEvent(new Event('input',{bubbles:true}));});assert(await handle.evaluate(el=>el.isConnected));
 await savedAfter(()=>slider.evaluate(el=>el.dispatchEvent(new Event('change',{bubbles:true}))));assert.equal(read().document.screens[0].nodes[0].spacing,28);
 await frame.getByLabel('Comment',{exact:true}).fill('Keep this heading on the checkout.');await savedAfter(()=>frame.getByRole('button',{name:'Save comment',exact:true}).click());
 await savedAfter(()=>frame.getByRole('button',{name:'Duplicate variant',exact:true}).click());assert.equal(read().document.screens.length,3);
 await page.screenshot({path:path.join(output,'editor.png')});
 await frame.getByRole('button',{name:'Play',exact:true}).click();await frame.getByRole('button',{name:'Submit',exact:true}).click();assert.match(await frame.locator('#design-status').textContent(),/Complete the form/);
 await frame.getByLabel('Name',{exact:true}).fill('Nihuel');await frame.getByLabel('Email',{exact:true}).fill('test@example.com');await frame.getByRole('button',{name:'Submit',exact:true}).click();await frame.getByText('Thank you',{exact:true}).waitFor();await frame.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await frame.getByLabel('Name',{exact:true}).inputValue(),'Nihuel');
 await frame.getByLabel('Viewport').selectOption('desktop');assert.equal(await frame.locator('.preview').evaluate(el=>el.style.width),'1100px');await frame.getByLabel('Viewport').selectOption('mobile');
 await frame.getByText('File & delivery',{exact:true}).click();await frame.getByRole('button',{name:'Export HTML',exact:true}).click();const exported=path.join(path.dirname(design),`export-r${revision()}.html`);await until(()=>fs.existsSync(exported));assert(!fs.readFileSync(exported,'utf8').includes('src="https:'));
 const standaloneMain=path.join(tmp,'standalone.cjs');fs.writeFileSync(standaloneMain,`const {app,BrowserWindow}=require('electron');let window;app.whenReady().then(()=>{window=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(exported)});});`);
 exportedApp=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),args:[standaloneMain,'--no-sandbox','--ozone-platform=x11'],env:{...process.env},timeout:30000});const standalone=await exportedApp.firstWindow();await standalone.getByRole('button',{name:'Submit',exact:true}).click();assert.match(await standalone.locator('#design-status').textContent(),/Complete the form/);await standalone.getByLabel('Name',{exact:true}).fill('Offline');await standalone.getByLabel('Email',{exact:true}).fill('offline@example.com');await standalone.getByRole('button',{name:'Submit',exact:true}).click();await standalone.getByText('Thank you',{exact:true}).waitFor();await exportedApp.close();exportedApp=undefined;
 await frame.getByText('File & delivery',{exact:true}).click();await frame.getByRole('button',{name:'Capture editor',exact:true}).click();const captured=path.join(path.dirname(design),`capture-r${revision()}.jpg`);await until(()=>fs.existsSync(captured));assert.equal(fs.readFileSync(captured).subarray(0,2).toString('hex'),'ffd8');fs.copyFileSync(captured,path.join(output,'capture.jpg'));
 await frame.getByText('File & delivery',{exact:true}).click();await frame.getByRole('button',{name:'Prepare Plan',exact:true}).click();await until(()=>fs.existsSync(path.join(workspace,'.openide/plans'))&&fs.readdirSync(path.join(workspace,'.openide/plans')).length);assert(fs.readFileSync(path.join(path.dirname(design),`HANDOFF-r${revision()}.md`),'utf8').includes('Keep this heading'));
 // Capture the live service accessor through a test-only command registered in this window.
 await page.evaluate(async base => {
  const {Action2,registerAction2}=await import(base+'platform/actions/common/actions.js');
  const {IOpenideIdeServerService}=await import(base+'workbench/contrib/openideAgent/browser/openideIdeServerService.js');
  const {IOpenideAgentService}=await import(base+'workbench/contrib/openideAgent/browser/openideAgentService.js');
  const {ICommandService}=await import(base+'platform/commands/common/commands.js');
  registerAction2(class extends Action2 {constructor(){super({id:'test.canvas.services',title:'Canvas Test Services',f1:true});}async run(accessor){const agent=accessor.get(IOpenideAgentService);const server=accessor.get(IOpenideIdeServerService);server.bridgeAgentTools(agent.externalTools(),(name,args,token)=>agent.invokeExternalToolResult(name,args,token));window.canvasCommand=accessor.get(ICommandService);window.canvasServer=await server.start('Canvas test');}});
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await command('Canvas Test Services');const connection=await until(()=>page.evaluate(()=>window.canvasServer));let requestId=0;
 async function rpc(method,params={}) {const response=await fetch(`http://127.0.0.1:${connection.port}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${connection.authToken}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params})});assert.equal(response.status,200);const payload=await response.json();if(payload.error)throw Error(JSON.stringify(payload.error));return payload.result;}
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'openide-canvas-cli-test',version:'1'}});
 const inventory=await rpc('tools/list');assert(inventory.tools.some(t=>t.name==='openide_canvas_create'));
 const call=(name,args)=>rpc('tools/call',{name,arguments:args});
 const inspect=await call('openide_canvas_inspect',{path:design});assert.equal(inspect.isError??false,false);
 const before=revision();const denied=call('openide_canvas_patch',{path:design,expectedRevision:before,operations:[{type:'setNode',id:'heading',text:'Must not write'}]});
 await approval('Edit Canvas',false);assert.equal((await denied).isError,true);assert.equal(revision(),before);
 const permitted=call('openide_canvas_patch',{path:design,expectedRevision:before,operations:[{type:'setNode',id:'heading',text:'Updated from external CLI'}]});
 await approval('Edit Canvas');assert.equal((await permitted).isError??false,false);assert.equal(revision(),before+1);
 const previewCall=call('openide_canvas_preview',{path:design});await approval('Capture Canvas preview');const previewResult=await previewCall;assert.equal(previewResult.isError??false,false);assert.equal(previewResult.content[0].type,'image');assert.equal(previewResult.content[0].mimeType,'image/jpeg');
 const cliCreate=call('openide_canvas_create',{template:'wireframe',title:'CLI wireframe',device:'desktop'});await approval('Create Canvas');const createdResult=await cliCreate;assert.equal(createdResult.isError??false,false);
 const created=JSON.parse(createdResult.content[0].text);assert(fs.existsSync(path.join(workspace,created.path)));await until(async()=>{const f=await frameFor('#design-status');return (await f.locator('header strong').textContent())==='CLI wireframe';});
 await page.evaluate(async design=>window.canvasCommand.executeCommand('openide.canvas.open',design),design);frame=await frameFor('#design-status');await frame.getByText('File & delivery',{exact:true}).click();await frame.getByRole('button',{name:'Create GOAL',exact:true}).click();const goalInput=page.locator('.quick-input-widget input').first();await goalInput.waitFor({state:'visible'});assert.match(await goalInput.inputValue(),/HANDOFF-r/);await page.keyboard.press('Escape');
 // Legacy TSX keeps input identity, selection and persisted state across a reload.
 const legacyDir=path.join(workspace,'.openide/canvases');fs.mkdirSync(legacyDir,{recursive:true});const legacy=path.join(legacyDir,'interaction.canvas.tsx');
 fs.writeFileSync(legacy,`import {Stack,Card,CardBody,Button,Choice,PromptButton,TextInput,Select,useCanvasState} from 'openide/canvas';
 export default function App(){const [name,setName]=useCanvasState('name','');const [amount,setAmount]=useCanvasState('amount','15');const [choice,setChoice]=useCanvasState('choice','b');return <Card><CardBody><Stack><TextInput value={name} onChange={setName} placeholder="Persistent name"/><input aria-label="Amount" type="range" min="0" max="100" value={amount} onInput={e=>setAmount(e.target.value)}/><Select value={choice} onChange={setChoice} options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}/><Choice id="a" title="Option A" description="Use the first option" selected={choice==='a'} onSelect={()=>setChoice('a')}/><Button variant="ghost">Preview</Button><PromptButton prompt={'I choose '+choice} send={false}>Use selection in chat</PromptButton></Stack></CardBody></Card>}`);
 await page.evaluate(async legacy=>{await window.canvasCommand.executeCommand('openide.canvas.open',legacy);},legacy);
 frame=await frameFor('input[placeholder="Persistent name"]');const nameInput=frame.getByPlaceholder('Persistent name');const identity=await nameInput.elementHandle();await nameInput.pressSequentially('abcdefghij',{delay:30});assert.equal(await nameInput.inputValue(),'abcdefghij');assert(await identity.evaluate(el=>el===document.activeElement&&el.selectionStart===10));
 const surface = await frame.locator('.oi-card').evaluate(card=>{const button=card.querySelector('.oi-btn'),field=card.querySelector('.oi-field');return {cardRadius:getComputedStyle(card).borderRadius,buttonRadius:getComputedStyle(button).borderRadius,fieldRadius:getComputedStyle(field).borderRadius};});
 assert.deepEqual(surface,{cardRadius:'14px',buttonRadius:'7px',fieldRadius:'7px'});
 const cardStyles=await page.locator('.openide-chat-canvas-card').last().evaluate(card=>{const path=card.querySelector('.openide-chat-canvas-path');return {pathSpace:getComputedStyle(path).whiteSpace,pathWidth:path.clientWidth,pathScroll:path.scrollWidth,headAlign:getComputedStyle(card.querySelector('.openide-chat-canvas-head')).justifyContent};});
 assert.equal(cardStyles.pathSpace,'nowrap');assert.notEqual(cardStyles.headAlign,'flex-end');
 await page.screenshot({path:path.join(output,'shared-components.png')});
 assert.equal(await frame.locator('select').inputValue(),'b');await frame.locator('select').selectOption('a');assert.equal(await frame.locator('select').inputValue(),'a');
 const amount=frame.getByLabel('Amount');const amountIdentity=await amount.elementHandle();await amount.evaluate(el=>{for(let n=20;n<40;n++){el.value=String(n);el.dispatchEvent(new Event('input',{bubbles:true}));}});assert(await amountIdentity.evaluate(el=>el.isConnected));assert.equal(await amount.inputValue(),'39');
 await frame.getByRole('button',{name:'Use selection in chat',exact:true}).click();
 assert.match(await page.locator('textarea.openide-chat-prompt').first().inputValue(),/I choose a/);
 assert.equal(await page.locator('.openide-composer-send.running').count(),0);
 const sidecar=legacy.replace('.canvas.tsx','.canvas.data.json');await until(()=>fs.existsSync(sidecar)&&JSON.parse(fs.readFileSync(sidecar,'utf8')).name==='abcdefghij');await until(async()=>await frame.locator('.oc-save-status').textContent()==='Saved');
 // Keep a change that is still inside the 200 ms disk debounce when switching editors.
 await amount.evaluate(el=>{el.value='51';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.evaluate(async design=>window.canvasCommand.executeCommand('openide.canvas.open',design),design);await until(()=>JSON.parse(fs.readFileSync(sidecar,'utf8')).amount==='51');
 await page.evaluate(async legacy=>window.canvasCommand.executeCommand('openide.canvas.open',legacy),legacy);frame=await frameFor('input[placeholder="Persistent name"]');assert.equal(await frame.getByLabel('Amount').inputValue(),'51');
 // A real filesystem failure must be visible, and Retry must recover the latest state.
 fs.renameSync(sidecar,sidecar+'.backup');fs.mkdirSync(sidecar);await frame.getByLabel('Amount').evaluate(el=>{el.value='52';el.dispatchEvent(new Event('input',{bubbles:true}));});await until(async()=>/Save failed/.test(await frame.locator('.oc-save-status').textContent()));fs.rmdirSync(sidecar);fs.renameSync(sidecar+'.backup',sidecar);await frame.locator('.oc-save-status').click();await until(()=>JSON.parse(fs.readFileSync(sidecar,'utf8')).amount==='52');
 await frame.getByLabel('Amount').evaluate(el=>{el.value='39';el.dispatchEvent(new Event('input',{bubbles:true}));});await until(()=>JSON.parse(fs.readFileSync(sidecar,'utf8')).amount==='39');
 fs.appendFileSync(legacy,'\n// reload fixture');await until(async()=>{const f=await frameFor('input[placeholder="Persistent name"]');return !(await identity.evaluate(el=>el.isConnected).catch(()=>false))&&await f.getByPlaceholder('Persistent name').inputValue()==='abcdefghij';});
 await app.close();
 app=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),cwd:path.join(root,'vscode'),args:['.',workspace,legacy,'--user-data-dir',userData,'--shared-data-dir',path.join(tmp,'shared'),'--extensions-dir',path.join(tmp,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--no-sandbox','--ozone-platform=x11'],env:{...process.env,VSCODE_DEV:'1'},timeout:90000});page=await app.firstWindow();await page.waitForSelector('.monaco-workbench',{timeout:90000});frame=await frameFor('input[placeholder="Persistent name"]');assert.equal(await frame.getByPlaceholder('Persistent name').inputValue(),'abcdefghij');assert.equal(await frame.getByLabel('Amount').inputValue(),'39');assert.equal(await frame.locator('select').inputValue(),'a');
 fs.writeFileSync(path.join(output,'design.json'),fs.readFileSync(design));
 console.log('PASS: gallery choice → editable chat, preserved draft, shared controls, persisted creation, inspector, gesture continuity, undo/redo, comments, variants, form flow, viewport, offline HTML, native capture, Plan handoff, MCP permissions, external creation, TSX focus/gesture/state, pending-save tab switch, failed-save retry, full restart.');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,choiceInChat:true,preservedDraft:true,sharedControls:true,revision:revision(),mcpPermissionRejectAndAllow:true,externalCreation:true,legacyRestart:true},null,2));
} catch(error) {if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'frames.json'),JSON.stringify(await Promise.all(page.frames().map(async f=>({url:f.url(),html:await f.content().catch(()=> '')})))));}throw error;} finally {fs.writeFileSync(path.join(output,'console.log'),logs.join('\n'));if(exportedApp)await exportedApp.close().catch(()=>{});if(app)await app.close().catch(()=>{});fs.rmSync(tmp,{recursive:true,force:true});}
