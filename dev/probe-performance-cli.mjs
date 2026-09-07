// Copyright (c) OpenIDE. Licensed under the MIT License.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { externalToolDescription, externalToolName, isExposedToExternalAgents } from '../vscode/out/vs/workbench/contrib/openideAgent/common/openideIdeExposure.js';
import { IDE_COMPAT_TOOLS } from '../vscode/out/vs/platform/openideAgentHost/common/openideIdeServer.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out=path.join(root,'.build/performance-cli-implementation/runtime-virtual'); fs.mkdirSync(out,{recursive:true});
const {_electron}=createRequire(path.join(root,'vscode/package.json'))('playwright-core');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'openide-perf-runtime-'));
const workspace=path.join(temporary,'workspace'); fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace,'sample.ts'),'export const answer = 42;\n');
const virtualDisplay=process.env.OPENIDE_TEST_VIRTUAL_DISPLAY==='1';
const report={isolation:virtualDisplay?'Xvfb':'Hyprland workspace 6',date:new Date().toISOString(),methodology:'Two sequential fresh profiles (initial failed placement run recorded separately), tiny workspace, extensions disabled, dev build, local immediate SSE fixture. Checkpoint response intentionally delayed 1500ms. No real provider or CLI model. Workspace 6 placement asserted; inherited placement token cleared; no initial focus.',runs:[]};
let app, page, active, submittedAt, tools;
const server=http.createServer(async(req,res)=>{
 let data=''; for await(const chunk of req) data+=chunk;
 if(req.method==='GET'){res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
 const input=JSON.parse(data); const checkpoint=input.messages?.some(m=>m.role==='system' && typeof m.content==='string' && m.content.includes('You maintain project memory.'));
 if(checkpoint) {active.checkpointStartedMs=performance.now()-submittedAt; active.checkpoints++; await new Promise(r=>setTimeout(r,1500));}
 else { active.providerArrivedMs=performance.now()-submittedAt; tools=input.tools; active.nativeSchemaBytes=Buffer.byteLength(JSON.stringify(tools)); }
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:checkpoint?JSON.stringify({notes:[],reason:'A routine greeting has no durable change.'}):'PERFORMANCE_FIXTURE_DONE'},finish_reason:null}]})}\n\n`);
 res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})}\n\n`);
 res.end('data: [DONE]\n\n');
 if(checkpoint) active.checkpointCompletedMs=performance.now()-submittedAt;
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
if(!virtualDisplay && !process.env.HYPRLAND_INSTANCE_SIGNATURE) throw new Error('Workspace 6 cannot be verified');
if(!virtualDisplay) execFileSync('hyprctl',['eval','_G.openide_perf_rule = hl.window_rule({name="openide-perf",match={class="(?i)openide.*"},workspace="6 silent",no_initial_focus=true,suppress_event="activate activatefocus"}); _G.openide_perf_rule:set_enabled(true)']);
try {
for(const mode of ['automatic','manual']) {
 if(!virtualDisplay) execFileSync('hyprctl',['eval','if _G.openide_perf_rule then _G.openide_perf_rule:set_enabled(false) end; _G.openide_perf_rule = hl.window_rule({name="openide-perf",match={class="(?i)openide.*"},workspace="6 silent",no_initial_focus=true,suppress_event="activate activatefocus"}); _G.openide_perf_rule:set_enabled(true)']);
 const profile=path.join(temporary,`profile-${report.runs.length}`); fs.mkdirSync(path.join(profile,'User'),{recursive:true});
 fs.writeFileSync(path.join(profile,'User/settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','window.titleBarStyle':'custom','openide.memory.captureMode':mode,'openide.agent.customProviders':[{id:'perf-fixture',label:'Perf Fixture',protocol:'openai',auth:'none',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,defaultModel:'fixture-model'}],'openide.agent.provider':'perf-fixture','openide.agent.model':'fixture-model','openide.agent.fallbackProviders':[],'openide.agent.fallbackChain':[]}));
 active={mode,checkpoints:0}; report.runs.push(active); const started=performance.now();
 app=await _electron.launch({executablePath:path.join(root,'vscode/.build/electron/openide'),cwd:path.join(root,'vscode'),args:['.',workspace,'--user-data-dir',profile,'--shared-data-dir',path.join(profile,'shared'),'--extensions-dir',path.join(profile,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--no-sandbox','--ozone-platform=x11'],env:{...process.env,HL_INITIAL_WORKSPACE_TOKEN:'',VSCODE_DEV:'1'},timeout:90000});
 page=await app.firstWindow(); await page.waitForSelector('.monaco-workbench',{timeout:90000}); active.workbenchMs=performance.now()-started;
 if(!virtualDisplay) { const client=JSON.parse(execFileSync('hyprctl',['clients','-j'],{encoding:'utf8'})).find(c=>c.pid===app.process().pid); assert.equal(client?.workspace.id,6); active.workspace=6; } else active.display=process.env.DISPLAY;
 await page.keyboard.press('Control+Shift+KeyP'); await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat'); await page.locator('.quick-input-list .monaco-list-row').filter({hasText:/New chat/i}).first().waitFor(); await page.keyboard.press('Enter');
 const input=page.locator('.openide-chat-composer textarea').first(); await input.waitFor(); active.chatReadyMs=performance.now()-started;
 const cdp=await page.context().newCDPSession(page); await cdp.send('Performance.enable');
 const before=(await cdp.send('Performance.getMetrics')).metrics; await pause(3000); const after=(await cdp.send('Performance.getMetrics')).metrics;
 const metric=(arr,n)=>arr.find(m=>m.name===n)?.value;
 active.idle3sTaskMs=(metric(after,'TaskDuration')-metric(before,'TaskDuration'))*1000; active.rendererHeapMiB=metric(after,'JSHeapUsedSize')/1048576;
 await input.fill('PERFORMANCE_RUNTIME: Hello. Reply briefly.'); submittedAt=performance.now(); await input.press('Enter');
 const deadline=Date.now()+45000; let done=false;
 while(Date.now()<deadline){const text=await page.locator('.openide-chat-native').innerText(); if(text.includes('PERFORMANCE_FIXTURE_DONE') && active.textVisibleMs===undefined) active.textVisibleMs=performance.now()-submittedAt; if(active.textVisibleMs!==undefined && !await page.locator('.openide-composer-send.running').count()){done=true; break;} await pause(50);}
 assert.ok(done,'Turn should finish'); active.turnSettledMs=performance.now()-submittedAt;
 if(mode==='automatic') {
  const limit=Date.now()+10000;
  while(active.checkpointCompletedMs===undefined && Date.now()<limit) await pause(25);
  assert.ok(active.checkpointCompletedMs!==undefined, 'Background capture must complete');
  assert.ok(active.turnSettledMs<active.checkpointCompletedMs, 'Turn must settle before delayed extraction completes');
  await pause(200);
  active.backgroundNoticeVisible=(await page.locator('.openide-chat-native').innerText()).includes('Memory checked');
 } else assert.equal(active.checkpoints,0);

 active.processMemory=await app.evaluate(async({app})=>app.getAppMetrics().map(m=>({type:m.type,workingSetKiB:m.memory.workingSetSize}))); await app.close(); app=undefined;
 fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(active));
}
const definitions=tools.map(t=>t.function);
const external=definitions.filter(t=>isExposedToExternalAgents(t.name)).map(t=>({name:externalToolName(t.name),description:externalToolDescription(t.name,t.description),inputSchema:t.parameters}));
const overhead=definitions.filter(t=>isExposedToExternalAgents(t.name)).reduce((s,t)=>s+Buffer.byteLength(externalToolDescription(t.name,t.description))-Buffer.byteLength(t.description),0);
fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify({methodology:'Derived from actual native fixture request using production external allowlist/description transforms. Compat schemas added separately; openide_memory_read noted separately. This is not a captured external tools/list.',nativeCount:definitions.length,nativeBytes:Buffer.byteLength(JSON.stringify(tools)),externalCount:external.length,externalBytes:Buffer.byteLength(JSON.stringify(external)),repeatedContextBytes:overhead,compatCount:IDE_COMPAT_TOOLS.filter(t=>!t.hidden).length,compatBytes:Buffer.byteLength(JSON.stringify(IDE_COMPAT_TOOLS.filter(t=>!t.hidden))),additionalTools:['openide_memory_read','openide_capabilities'],descriptionsOver2KiB:external.filter(t=>Buffer.byteLength(t.description)>2048).map(t=>({name:t.name,bytes:Buffer.byteLength(t.description)})),tools:external},null,2));
} catch(error){report.error=error.stack; throw error;}
finally {fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify(report,null,2)); if(app) await app.close(); await new Promise(r=>server.close(r)); if(!virtualDisplay) execFileSync('hyprctl',['eval','if _G.openide_perf_rule then _G.openide_perf_rule:set_enabled(false) end']); fs.rmSync(temporary,{recursive:true,force:true});}
