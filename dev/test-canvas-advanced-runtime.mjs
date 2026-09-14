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
const output = path.join(root, '.build/canvas-advanced-runtime');
const userData = path.join(tmp, 'user-data'); const workspace = path.join(tmp, 'workspace');
fs.rmSync(output,{recursive:true,force:true});
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

 let frame;
 async function invoke(name,args,title){const pending=call('openide_canvas_'+name,args);if(title)await approval(title);const result=await pending;assert.equal(result.isError??false,false,JSON.stringify(result));return JSON.parse(result.content[0].text);}
 async function create(template,title){const result=await invoke('create',{template,title},'Create Canvas');const resource=path.join(workspace,result.path);frame=await frameFor('#design-status');await until(async()=>await frame.locator('header strong').textContent()===title);return resource;}
 const read=resource=>JSON.parse(fs.readFileSync(resource,'utf8'));
 async function saved(resource, action){const before=read(resource).revision;await action();await until(()=>read(resource).revision>before);await until(async()=>!(await frame.locator('#design-status').textContent()).includes('Saving'));}
 async function exportFile(resource,format){const result=await invoke('export',{path:resource,format},'Export Canvas');assert(fs.existsSync(result.path));const target=path.join(output,path.basename(path.dirname(resource))+'.'+format);fs.copyFileSync(result.path,target);console.log('Exported',format,fs.statSync(target).size);return target;}
 const board=await create('whiteboard','Advanced whiteboard');
 await frame.locator('[data-node="hero"]').click();await saved(board,async()=>{await frame.getByLabel('Frame x',{exact:true}).fill('190');await frame.getByLabel('Frame x',{exact:true}).press('Tab');});
 assert.equal(read(board).document.screens[0].nodes[0].frame.x,190);
 await saved(board,()=>frame.getByRole('button',{name:'Undo',exact:true}).click());assert.equal(read(board).document.screens[0].nodes[0].frame.x,120);
 await saved(board,()=>frame.getByRole('button',{name:'Redo',exact:true}).click());
 const hero=frame.locator('[data-node="hero"]');const box=await hero.boundingBox();await saved(board,async()=>{await page.mouse.move(box.x+50,box.y+50);await page.mouse.down();await page.mouse.move(box.x+120,box.y+80,{steps:8});await page.mouse.up();});assert.equal(read(board).document.screens[0].nodes[0].frame.x,260);
 await frame.getByRole('button',{name:'Draw',exact:true}).click();const surface=await frame.locator('.preview').boundingBox();await saved(board,async()=>{await page.mouse.move(surface.x+30,surface.y+40);await page.mouse.down();await page.mouse.move(surface.x+130,surface.y+100,{steps:12});await page.mouse.up();});assert(read(board).document.screens[0].nodes.some(n=>n.kind==='path'&&n.points.length>5));await frame.getByRole('button',{name:'Select',exact:true}).click();
 await frame.locator('[data-node="hero"]').click();assert.equal(await frame.getByLabel('Frame x',{exact:true}).inputValue(),'260');
 const imageFile=path.join(workspace,'logo.svg');fs.writeFileSync(imageFile,'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#3070cc"/><circle cx="80" cy="60" r="35" fill="#ffcc66"/></svg>');
 await invoke('import',{path:board,expectedRevision:read(board).revision,sourcePath:imageFile,kind:'image'},'Import Canvas asset');
 await until(async()=>frame.locator('.preview img').evaluateAll(images=>images.some(img=>img.complete&&img.naturalWidth===160)));
 const imageNode=read(board).document.screens[0].nodes.find(n=>n.kind==='image');await invoke('patch',{path:board,expectedRevision:read(board).revision,operations:[{type:'setAdvanced',id:imageNode.id,frame:{x:650,y:100,width:320,height:240,rotation:0}}]},'Edit Canvas');

 const corrupt=Buffer.alloc(40);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(corrupt);corrupt.writeUInt32BE(1,16);corrupt.writeUInt32BE(1,20);fs.writeFileSync(path.join(workspace,'corrupt.png'),corrupt);const beforeInvalid=read(board).revision;const invalid=call('openide_canvas_import',{path:board,expectedRevision:beforeInvalid,sourcePath:'corrupt.png',kind:'image'});await approval('Import Canvas asset');assert.equal((await invalid).isError,true);assert.equal(read(board).revision,beforeInvalid);
 const tokens=path.join(workspace,'brand.tokens.json');fs.writeFileSync(tokens,JSON.stringify({accent:{$type:'color',$value:'#8c4ab5'},background:{$type:'color',$value:'#f8f4fc'},fontSize:{$type:'dimension',$value:{value:20,unit:'px'}}}));
 await invoke('import',{path:board,expectedRevision:read(board).revision,sourcePath:tokens,kind:'tokens'},'Import Canvas asset');assert.equal(read(board).document.tokens.accent,'#8c4ab5');
 await until(async()=>await frame.locator('.preview').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(248, 244, 252)');
 await page.screenshot({path:path.join(output,'whiteboard.png')});
 for(const format of ['html','svg','pdf','pptx'])await exportFile(board,format);
 const animation=await create('animation','Advanced motion');
 const motion=frame.locator('[data-node="hero"]');const initial=await motion.evaluate(el=>el.style.transform);
 await frame.getByLabel('Time',{exact:true}).evaluate(el=>{el.value='1.25';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});assert.notEqual(await motion.evaluate(el=>el.style.transform),initial);
 await motion.click();await frame.getByLabel('Keyframe x',{exact:true}).fill('240');await frame.getByLabel('Keyframe x',{exact:true}).press('Tab');await saved(animation,()=>frame.getByRole('button',{name:'Save Keyframe',exact:true}).click());assert(read(animation).document.screens[0].nodes[0].keyframes.some(k=>k.time===1.25&&k.x===240));
 await frame.getByRole('button',{name:'Play Motion',exact:true}).click();const first=await motion.evaluate(el=>el.style.transform);await until(async()=>await motion.evaluate(el=>el.style.transform)!==first);await frame.getByRole('button',{name:'Pause Motion',exact:true}).click();
 await page.screenshot({path:path.join(output,'animation.png')});await exportFile(animation,'svg');await exportFile(animation,'html');
 const scene=await create('scene3d','Advanced scene');const polygons=frame.locator('.preview polygon');assert.equal(await polygons.count(),12);
 const vertices=await polygons.first().getAttribute('points');const sceneBox=await frame.locator('.preview').boundingBox();await page.mouse.move(sceneBox.x+100,sceneBox.y+100);await page.mouse.down();await page.mouse.move(sceneBox.x+160,sceneBox.y+120,{steps:10});await page.mouse.up();assert.notEqual(await polygons.first().getAttribute('points'),vertices);
 await polygons.nth(5).click({force:true});await saved(scene,()=>frame.getByLabel('Primitive',{exact:true}).selectOption('sphere'));assert.equal(read(scene).document.screens[0].nodes[0].object3d.primitive,'sphere');assert.equal(await polygons.count(),256);
 const obj=await exportFile(scene,'obj');fs.copyFileSync(obj,path.join(workspace,'sphere.obj'));await invoke('import',{path:scene,expectedRevision:read(scene).revision,sourcePath:'sphere.obj',kind:'obj'},'Import Canvas asset');assert.equal(read(scene).document.screens[0].nodes.length,2);
 await page.screenshot({path:path.join(output,'scene3d.png')});await exportFile(scene,'pdf');await exportFile(scene,'pptx');
 const slides=await create('slides','Advanced presentation');await exportFile(slides,'pdf');await exportFile(slides,'pptx');

 for(const resource of fs.readdirSync(output).filter(name=>name.includes('advanced-motion')&&name.endsWith('.html'))){
  const main=path.join(tmp,'offline-motion.cjs');fs.writeFileSync(main,`const {app,BrowserWindow}=require('electron');let window;app.whenReady().then(()=>{window=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(path.join(output,resource))});});`);
  exportedApp=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),args:[main,'--no-sandbox','--ozone-platform=x11'],env:{...process.env},timeout:30000});const offline=await exportedApp.firstWindow();const node=offline.locator('[data-node="hero"]');await node.waitFor();const first=await node.evaluate(el=>el.style.transform);await until(async()=>await node.evaluate(el=>el.style.transform)!==first);await exportedApp.close();exportedApp=undefined;
 }

 const svgFile=fs.readdirSync(output).filter(name=>name.includes('advanced-motion')&&name.endsWith('.svg')).at(-1);const svgMain=path.join(tmp,'offline-svg.cjs');fs.writeFileSync(svgMain,`const {app,BrowserWindow}=require('electron');let window;app.whenReady().then(()=>{window=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadFile(${JSON.stringify(path.join(output,svgFile))});});`);
 exportedApp=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),args:[svgMain,'--no-sandbox','--ozone-platform=x11'],env:{...process.env},timeout:30000});const svgPage=await exportedApp.firstWindow();await svgPage.locator('#hero').waitFor();await svgPage.evaluate(()=>{document.documentElement.pauseAnimations();document.documentElement.setCurrentTime(0);});const svgBefore=await svgPage.locator('#hero').boundingBox();await svgPage.evaluate(()=>document.documentElement.setCurrentTime(1.25));const svgAfter=await svgPage.locator('#hero').boundingBox();assert.notEqual(Math.round(svgBefore.x),Math.round(svgAfter.x));await exportedApp.close();exportedApp=undefined;
 const stress=await create('scene3d','Resource budget');const original=read(stress).document.screens[0].nodes[0];const start=performance.now();
 await invoke('patch',{path:stress,expectedRevision:1,operations:[{type:'setAdvanced',id:'hero',object3d:{...original.object3d,primitive:'sphere'}},...Array.from({length:29},(_,i)=>({type:'addNode',screenId:'main',node:{...original,id:'object-'+i,object3d:{...original.object3d,primitive:'sphere',position:[(i%6-3)*.7,Math.floor(i/6)*.4,0],scale:[.3,.3,.3]}}}))]},'Edit Canvas');
 await until(async()=>await frame.locator('.preview polygon').count()===7680);const budgetRenderMs=performance.now()-start;assert(budgetRenderMs<15000,'Bounded scene exceeded interactive render budget');
 const metrics=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory,cpu:m.cpu.percentCPUUsage})));
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,templates:['whiteboard','animation','scene3d'],formats:['html','svg','pdf','pptx','obj'],mcpImports:true,budgetRenderMs,maxSceneTriangles:7680,metrics},null,2));
 console.log('PASS: freehand, dragging, undo/redo, assets and design tokens via MCP, keyframes and playback, orbit and 3D edit, OBJ roundtrip, native PDF/PPTX and offline HTML/SVG exports.');
} catch(error) {if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'frames.json'),JSON.stringify(await Promise.all(page.frames().map(async f=>({url:f.url(),html:await f.content().catch(()=> '')})))));}throw error;} finally {fs.writeFileSync(path.join(output,'console.log'),logs.join('\n'));if(exportedApp)await exportedApp.close().catch(()=>{});if(app)await app.close().catch(()=>{});fs.rmSync(tmp,{recursive:true,force:true});}
