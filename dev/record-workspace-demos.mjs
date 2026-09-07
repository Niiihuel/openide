#!/usr/bin/env node
// Record the real installed Codex CLI inside an isolated OpenIDE window.
// Uses the user's existing Codex login, explicitly gpt-5.6-luna, never a fixture provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const model = 'gpt-5.6-luna';
const realCodex = process.env.OPENIDE_DEMO_CODEX || path.join(os.homedir(), '.npm-global/bin/codex');
const ffmpeg = process.env.OPENIDE_DEMO_FFMPEG || '/nix/store/jfnnrn72slgs4ryx4g09lb97r193xddp-ffmpeg-8.1.1-bin/bin/ffmpeg';
const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe');
const output = process.env.OPENIDE_DEMO_OUTPUT || path.resolve(root, '../openide-web/public/demos');
const reports = path.join(root, '.build/demos/workspace');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-workspace-demos-'));
const workspace = path.join(temporary, 'taskboard');
const userData = path.join(temporary, 'user-data');
const binaries = path.join(temporary, 'bin');
for (const dir of [workspace, binaries, path.join(userData, 'User'), reports, output]) { fs.mkdirSync(dir, { recursive: true }); }
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const cliVersion = execFileSync(realCodex, ['--version'], { encoding: 'utf8' }).trim();
const login = execFileSync(realCodex, ['login', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8'));
assert.ok(cache.models.some(candidate => candidate.slug === model && candidate.visibility === 'list'), `Requested model ${model} is absent from the local account catalog; refusing another model`);
assert.ok(cliVersion.startsWith('codex-cli '));
void login;
const launcher = path.join(binaries, 'codex');
// Only adds explicit invocation options; the exec target is the genuine installed Codex binary.
fs.writeFileSync(launcher, `#!/bin/sh\nexec ${quote(realCodex)} --model ${quote(model)} -c 'check_for_update_on_startup=false' -c 'model_reasoning_effort="low"' -c 'mcp_servers.openaiDeveloperDocs.enabled=false' --no-alt-screen "$@"\n`, { mode: 0o755 });
const shell = path.join(binaries, 'demo-shell');
fs.writeFileSync(shell, '#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(workspace, 'tasks.ts'), 'export interface Task {\n\tid: string;\n\ttitle: string;\n\tcompleted: boolean;\n}\n\nexport function pendingTasks(tasks: Task[]): number {\n\treturn tasks.filter(task => !task.completed).length;\n}\n');
fs.writeFileSync(path.join(workspace, 'README.md'), '# Taskboard\n\nA small task list. We want filters for all, pending and completed tasks.\n');
execFileSync('git', ['init', '-q', workspace]);
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false,
	'window.titleBarStyle': 'custom', 'window.zoomLevel': 0, 'editor.fontSize': 17,
	'editor.accessibilitySupport': 'on', 'editor.wordWrap': 'on', 'editor.minimap.enabled': false, 'terminal.integrated.fontSize': 15,
	'workbench.colorTheme': 'Default Dark Modern', 'openide.agent.language': 'es',
}));
const html = `<!doctype html><html><meta charset="utf-8"><title>Taskboard</title><style>
*{box-sizing:border-box}body{margin:0;background:#131517;color:#f5f4ef;font:18px system-ui;padding:48px 36px}small{color:#afa996;letter-spacing:.12em}h1{font-size:46px;font-weight:500;letter-spacing:-2px;margin:20px 0 8px}p{color:#a2a4a9;line-height:1.6}form{display:flex;gap:10px;margin:34px 0 28px}input{min-width:0;flex:1;padding:16px;background:#202326;color:white;border:1px solid #383b40;border-radius:8px;font:inherit}button{border:0;border-radius:8px;background:#c6f274;padding:14px 20px;font:600 16px system-ui;color:#1b2510;cursor:pointer}ul{list-style:none;padding:0}li{padding:22px 0;border-bottom:1px solid #33363a}li:before{content:'○';margin-right:16px;color:#aab790}footer{margin-top:42px;color:#7c8085;font-size:14px}
</style><small>OPENIDE / WORKSPACE</small><h1>Un paso a la vez.</h1><p>Un espacio simple para convertir ideas en tareas.</p><form><input aria-label="Nueva tarea" placeholder="¿Qué sigue?"><button id="add-task">Agregar</button></form><ul><li>Diseñar la navegación</li><li>Revisar accesibilidad</li></ul><footer id="status">2 tareas pendientes</footer><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const input=document.querySelector('input');if(!input.value)return;const li=document.createElement('li');li.textContent=input.value;document.querySelector('ul').append(li);input.value='';document.querySelector('#status').textContent=document.querySelectorAll('li').length+' tareas pendientes'}</script></html>`;
fs.writeFileSync(path.join(workspace, 'index.html'), html);
const server = createServer((request,response) => {response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});response.end(html);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let app, page, video, started, ended, failure;
const clips = [];
async function openFile(file) {
 await page.keyboard.press('Control+KeyP'); await page.locator('.quick-input-widget input').first().fill(file); await pause(700); await page.keyboard.press('Enter'); await pause(900);
}
async function ask(prompt, toolsAllowed, marker) {
 await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus();
 await page.keyboard.type(prompt, {delay:6}); await pause(700); await page.keyboard.press('Enter'); mark('prompt:'+marker);
 let activeApproval;
 await until(async () => {
  const text = await terminalText();
  const pending = toolsAllowed.find(tool => text.includes(`Allow the openide MCP server to run tool "${tool}"?`));
  if (!pending) activeApproval = undefined;
  for (const tool of toolsAllowed) {
   if (activeApproval !== tool && pending === tool) {
    await pause(1000); await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus(); await page.keyboard.press('Enter'); activeApproval = tool; mark('approved:'+tool);
   }
  }
  if (/model.*not.*(available|supported)|usage limit|not authenticated/i.test(text)) throw new Error('Requested account/model unavailable; no fallback');
  return new RegExp('•\\s*'+marker).test(text);
 }, 'real Codex completion '+marker, 160000);
 await pause(2000);
 fs.writeFileSync(path.join(reports, marker+'.txt'), await terminalText());
}

const milestones = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const mark = name => { milestones.push({ name, time: Date.now() }); console.log(name); };
async function palette(command) {
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill(`>${command}`);
	await pause(500);
	await page.keyboard.press('Enter');
}
async function until(predicate, label, milliseconds = 120000) {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) { if (await predicate()) { return; } await pause(500); }
	throw new Error(`Timed out: ${label}`);
}
async function terminalText() {
	return page.locator('.openide-chat-agent-terminal .xterm-accessibility-tree').innerText();
}
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1', PATH: `${binaries}${path.delimiter}/nix/store/g7svy17fhkg2cq3q4lfzzc0mmsl3d8hq-bubblewrap-0.11.2/bin${path.delimiter}${process.env.PATH}`, SHELL: shell },
		recordVideo: { dir: path.join(reports, 'raw'), size: { width: 1440, height: 900 } }, timeout: 90000,
	});
	page = await app.firstWindow(); video = page.video();
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('vscode-file:')).setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
	await palette('OpenIDE Agent: New chat');
	await page.locator('.openide-chat-head-collapse').first().waitFor();
	if (!await page.locator('.openide-chat-head-split-chevron').first().isVisible()) { await page.locator('.openide-chat-head-collapse').first().click(); }
	await page.locator('.openide-chat-head-split-chevron').first().click();
	const row = page.locator('.openide-chat-kind-installed [title]').filter({ hasText: 'Codex' }).first();
	await row.waitFor(); assert.equal(await row.getAttribute('title'), launcher);
	await row.click();
	await page.locator('.openide-chat-agent-terminal .xterm').waitFor({ state: 'visible' });
	await page.keyboard.press('Control+KeyB');
	const dock = await page.locator('.part.auxiliarybar').boundingBox();
	if (dock) {
		await page.mouse.move(dock.x - 2, dock.y + dock.height / 2);
		await page.mouse.down(); await page.mouse.move(690, dock.y + dock.height / 2, { steps: 15 }); await page.mouse.up();
	}
	await pause(5000);
	await page.screenshot({ path: path.join(reports, 'startup.png') });
	mark('cli-launched');
	await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus();
	await until(async () => {
		const text = await terminalText();
		if (/Update available|Updating Codex/.test(text)) { throw new Error('Unexpected update prompt; refusing automated input'); }
		if (/Yes, I trust this folder|Yes, continue/.test(text) && /trust|folder/.test(text)) {
			await page.keyboard.press('Enter');
			await pause(1000);
			return false;
		}
		return text.includes(model) && /context|shortcuts|GPT-5|model:/.test(text);
	}, 'real Codex prompt with the exact requested model', 40000);
	await page.screenshot({ path: path.join(reports, 'cli-ready.png') });
 started = Date.now(); mark('memory-start');
 await ask('Usá solo MCP OpenIDE. Primero openide_memory_read. Guardá con openide_memory action add target project: "Taskboard: los colores de acento se definen con variables CSS; mantener contraste AA y navegación por teclado." Volvé a leer con openide_memory_read. Sin comandos ni otros archivos. Al terminar respondé solo "Memoria compartida verificada."', ['openide_memory_read','openide_memory'], 'Memoria compartida verificada.');
 const memoryPath = path.join(workspace, '.openide/MEMORY.md');
 assert.ok(fs.readFileSync(memoryPath,'utf8').includes('contraste AA'));
 await openFile(memoryPath); await pause(3200);
 await page.screenshot({path:path.join(reports,'memory.png')});
 clips.push({id:'memory',start:started,end:Date.now()}); mark('memory-done');
 started=Date.now(); mark('playwright-start');
 await ask(`Usá solo MCP OpenIDE. Abrí ${url} con openide_browser_navigate. Luego openide_browser_playwright para llenar getByRole('textbox', {name:'Nueva tarea'}) con 'Validar el flujo con Playwright', hacer click en getByRole('button',{name:'Agregar'}) y devolver el texto de #status. Sin otras tools. Al verificar las 3 tareas respondé solo "Flujo real verificado."`, ['openide_browser_navigate','openide_browser_playwright'], 'Flujo real verificado.');
 const preview = await app.evaluate(({webContents}, target) => webContents.getAllWebContents().flatMap(w=>w.mainFrame.framesInSubtree.map(f=>({id:w.id,url:f.url}))).filter(f=>f.url.startsWith(target)),url);
 fs.writeFileSync(path.join(reports,'preview-frames.json'), JSON.stringify(preview,null,2));
 assert.ok(preview.length,'Native preview must really load the application');
 const state = await app.evaluate(async ({webContents}, target) => {
  for(const contents of webContents.getAllWebContents()) for(const frame of contents.mainFrame.framesInSubtree) if(frame.url.startsWith(target)) return frame.executeJavaScript('JSON.stringify({status:document.querySelector("#status").textContent,tasks:document.querySelector("ul").textContent})');
 },url);
 assert.ok(state.includes('3 tareas pendientes')&&state.includes('Validar el flujo con Playwright'),state);
 await pause(3500); await page.screenshot({path:path.join(reports,'playwright.png')});
 clips.push({id:'playwright',start:started,end:Date.now()}); mark('playwright-done');
 // The picker is a real product command and the click passes through its injected overlay.
 started=Date.now(); mark('css-start');
 await palette('OpenIDE: Pick an element from the app (Pick & Polish)'); await pause(2000);
 if(await page.locator('.quick-input-widget input').first().isVisible()) { await page.locator('.quick-input-widget input').first().fill(url); await page.keyboard.press('Enter'); }
 await pause(2000);
 const targetPage = app.context().pages().find(candidate=>candidate.url().startsWith(url));
 const targetFrame = page.frames().find(candidate=>candidate.url().startsWith(url));
 const picker = targetPage || targetFrame;
 assert.ok(picker,'Preview frame must be reachable for the real picker click');
 await picker.locator('#add-task').hover(); await pause(1700); await picker.locator('#add-task').click(); await pause(1700);
 await page.screenshot({path:path.join(reports,'css-picked.png')});
 await ask('Usá solo openide_browser_set_style para #add-task: "background: #ddd6fe; color: #342258; border-radius: 999px; padding: 14px 24px". Es un ajuste visual en vivo, no persistirlo. Al terminar respondé solo "Estilo aplicado en vivo."',['openide_browser_set_style'],'Estilo aplicado en vivo.');
 const style = await app.evaluate(async ({webContents}, target) => {
  for(const contents of webContents.getAllWebContents()) for(const frame of contents.mainFrame.framesInSubtree) if(frame.url.startsWith(target)) return frame.executeJavaScript('document.querySelector("#add-task").style.cssText');
 },url);
 assert.ok(style.includes('999px'),style);
 await pause(3500); await page.screenshot({path:path.join(reports,'css.png')});
 clips.push({id:'css',start:started,end:Date.now()}); mark('css-done');
} catch(error) {
 failure=error; await page?.screenshot({path:path.join(reports,'failure.png')}).catch(()=>{}); console.error(error.stack);
} finally {
 ended=Date.now(); await app?.close().catch(()=>{}); server.close();
 const raw=video?await video.path().catch(()=>undefined):undefined;
 fs.writeFileSync(path.join(reports,'evidence.json'),JSON.stringify({cliVersion,model,reasoningEffort:'low',accountCatalogVerified:true,temporaryWorkspace:workspace,milestones,clips,raw,failure:failure?.message},null,2));
 if(raw&&clips.length){
  const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-of','json',raw],{encoding:'utf8'}));
  for(const clip of clips){
   const start=Math.max(0,Number(probe.format.duration)-(ended-clip.start)/1000-1.5);
   const duration=(clip.end-clip.start)/1000;
   for(const [ext,codec] of [['mp4',['-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart']],['webm',['-c:v','libvpx-vp9','-crf','32','-b:v','0','-deadline','realtime','-cpu-used','6']]]){
    execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',raw,'-t',String(duration),'-an',...codec,path.join(output,`${clip.id}.${ext}`)],{timeout:180000});
   }
   execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(Math.max(0,duration-3)),'-i',path.join(output,`${clip.id}.mp4`),'-frames:v','1','-q:v','2',path.join(output,`${clip.id}.jpg`)]);
  }
 }
}
if(failure)process.exitCode=1;
