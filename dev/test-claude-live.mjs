// Copyright (c) OpenIDE. Licensed under the MIT License.
// Explicit opt-in: uses the authenticated Claude binary and consumes model usage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const real=process.env.OPENIDE_LIVE_CLAUDE;
if(!real || !fs.existsSync(real)) throw new Error('Explicit OPENIDE_LIVE_CLAUDE absolute binary path required.');
const reportDir=path.join(repo,'.build/performance-cli-implementation/claude-live');fs.mkdirSync(reportDir,{recursive:true});
// The dock launches this transparent harness; all model/tool choices come from the real CLI.
if(process.env.OPENIDE_CLAUDE_LIVE_CHILD==='1') {
 const args=process.argv.slice(2), config=args[args.indexOf('--mcp-config')+1];
 const names=Object.keys(JSON.parse(fs.readFileSync(config,'utf8')).mcpServers);
 const allowed=names.flatMap(name=>['openide_capabilities','openide_memory_read','openide_memory_search','openide_memory_get','openide_memory_save','openide_project_map_query'].map(tool=>`mcp__${name}__${tool}`));
 const prompts=[
  'This is an authorized integration check in a disposable project. Discover what IDE capabilities you have and briefly describe the available families. Then remember this durable project decision: payment retries reuse the same idempotency key, with at most three attempts. Use the IDE shared memory to save it as a decision with topic payments/retry-policy. Do not claim it is saved unless a tool confirms persistence. Do not edit any personal configuration.',
  'This is a new session in the same disposable project. What was the saved decision about payment retries? Retrieve it from the shared project memory and include the canonical note path as evidence. Do not create or update any notes.'
 ];
 const outcomes=[];
 for(let index=0;index<prompts.length;index++) {
  const stream=fs.createWriteStream(path.join(reportDir,`turn-${index+1}.jsonl`),{mode:0o600});
  const errorStream=fs.createWriteStream(path.join(reportDir,`turn-${index+1}.stderr`),{mode:0o600});
  const started=Date.now();
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(real,[...args,'--print','--verbose','--output-format','stream-json','--no-session-persistence','--strict-mcp-config','--setting-sources','','--tools','','--allowedTools',allowed.join(','),'--permission-prompts','none','--max-budget-usd','2',prompts[index]],{env:{...process.env,OPENIDE_CLAUDE_LIVE_CHILD:'0'},stdio:['ignore','pipe','pipe']});
   const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
   child.stdout.pipe(stream);child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.pipe(errorStream);
   child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  outcomes.push({turn:index+1,exitCode:code,elapsedMs:Date.now()-started});
  if(code!==0) break;
 }
 fs.writeFileSync(path.join(reportDir,'completed.json'),JSON.stringify(outcomes,null,2));process.exit(0);
}
if(process.env.OPENIDE_TEST_VIRTUAL_DISPLAY!=='1') throw new Error('Run this live check inside dev/run-virtual-gui.mjs.');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'openide-claude-live-'));
const workspace=path.join(temporary,'workspace'),bin=path.join(temporary,'bin'),profile=path.join(temporary,'profile');
for(const dir of [workspace,bin,path.join(profile,'User')]) fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(workspace,'README.md'),'# Disposable payments project\n');execFileSync('git',['init','-q',workspace]);
fs.writeFileSync(path.join(profile,'User/settings.json'),JSON.stringify({'security.workspace.trust.enabled':false,'workbench.startupEditor':'none','terminal.integrated.enablePersistentSessions':false,'terminal.integrated.shellIntegration.enabled':false,'window.titleBarStyle':'custom'}));
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
const launcher=path.join(bin,'claude');fs.writeFileSync(launcher,`#!/bin/sh\nOPENIDE_CLAUDE_LIVE_CHILD=1 exec ${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} "$@"\n`,{mode:0o755});
const shell=path.join(bin,'shell');fs.writeFileSync(shell,'#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n',{mode:0o755});
fs.rmSync(path.join(reportDir,'completed.json'),{force:true});
const {_electron}=createRequire(path.join(repo,'vscode/package.json'))('playwright-core');let app;const errors=[];
try {
 app=await _electron.launch({executablePath:path.join(repo,'vscode/.build/electron/openide'),cwd:path.join(repo,'vscode'),args:['.',workspace,'--user-data-dir',profile,'--shared-data-dir',path.join(temporary,'shared'),'--extensions-dir',path.join(temporary,'extensions'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--no-sandbox','--ozone-platform=x11'],env:{...process.env,VSCODE_DEV:'1',PATH:`${bin}:${process.env.PATH}`,SHELL:shell},timeout:90000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.monaco-workbench',{timeout:90000});
 await page.keyboard.press('Control+Shift+KeyP');await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat');await page.locator('.quick-input-list .monaco-list-row').filter({hasText:/New chat/i}).first().waitFor();await page.keyboard.press('Enter');
 await page.locator('.openide-chat-head-collapse').first().waitFor();if(!await page.locator('.openide-chat-head-split-chevron').first().isVisible())await page.locator('.openide-chat-head-collapse').first().click();
 await page.locator('.openide-chat-head-split-chevron').first().click();const row=page.locator('.openide-chat-kind-installed [title]').filter({hasText:'Claude Code'}).first();await row.waitFor();assert.equal(await row.getAttribute('title'),launcher);await row.click();
 const deadline=Date.now()+390000;while(!fs.existsSync(path.join(reportDir,'completed.json'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,500));
 assert.ok(fs.existsSync(path.join(reportDir,'completed.json')),'Real Claude must complete');
 const outcomes=JSON.parse(fs.readFileSync(path.join(reportDir,'completed.json'),'utf8'));assert.equal(outcomes.length,2);assert.ok(outcomes.every(o=>o.exitCode===0));
 const turns=[1,2].map(n=>fs.readFileSync(path.join(reportDir,`turn-${n}.jsonl`),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
 const calls=turns.map(events=>events.flatMap(e=>e.message?.content??[]).filter(c=>c.type==='tool_use').map(c=>c.name));
 const results=turns.map(events=>events.findLast(e=>e.type==='result'));
 const notesPath=path.join(workspace,'.openide/memory/notes');const notes=fs.existsSync(notesPath)?fs.readdirSync(notesPath).map(name=>({path:`.openide/memory/notes/${name}`,content:fs.readFileSync(path.join(notesPath,name),'utf8')})):[];
 fs.writeFileSync(path.join(reportDir,'result.json'),JSON.stringify({binary:real,version:execFileSync(real,['--version'],{encoding:'utf8'}).trim(),isolation:'Xvfb',outcomes,calls,results,notes,errors},null,2),{mode:0o600});
 assert.ok(calls[0].some(n=>n.endsWith('openide_memory_save')),'Claude must choose canonical save');assert.ok(notes.some(n=>n.content.includes('payments/retry-policy')),'Canonical note must exist');assert.ok(calls[1].some(n=>/openide_memory_(search|get)/.test(n)),'Fresh Claude must retrieve canonical memory');assert.ok(!results.some(r=>!r||r.is_error));
 console.log('PASS authenticated Claude: capability discovery, canonical Markdown save and fresh-session recall');
} finally {if(app)await app.close();fs.rmSync(temporary,{recursive:true,force:true});}
