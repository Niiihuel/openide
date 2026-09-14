// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-trays-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-trays-'));
const output = path.join(root, '.build/chat-trays-runtime');
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
  const { ServiceCollection } = await import(base + 'platform/instantiation/common/serviceCollection.js');
  const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
  const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
  const { IHoverService } = await import(base + 'platform/hover/browser/hover.js');
  const { InMemoryStorageService } = await import(base + 'platform/storage/common/storage.js');
  const { Event } = await import(base + 'base/common/event.js');
  const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
  const { OpenideChatTerminalsTray } = await import(base + 'workbench/contrib/openideAgent/browser/chat/parts/openideChatTerminalsTray.js');
  const { OpenideChatFilesTray } = await import(base + 'workbench/contrib/openideAgent/browser/chat/parts/openideChatFilesTray.js');
  const { OpenideChatComposerQueue } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatComposerQueue.js');
  registerAction2(class extends Action2 {
   constructor() { super({ id: 'test.chatTrays', title: 'Chat Trays Fixture', f1: true }); }
   async run(accessor) {
    const instantiation = accessor.get(IInstantiationService); const hover = accessor.get(IHoverService);
    const views = accessor.get(IViewsService), commands = accessor.get(ICommandService);
    await accessor.get(ICommandService).executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Review the command', send: false });
    const widget = views.getViewWithId('workbench.view.openideChat.view')._widget.value;
    widget._terminalsTray.update({id:'motion-a',command:'npm run dev',status:'running'});
    widget._terminalsTray.update({id:'motion-b',command:'npm run watch',status:'running'});
    const host = document.createElement('div'); host.className = 'openide-chat-native trays-fixture';
    host.style.cssText = 'position:absolute;left:400px;top:180px;width:500px;padding:20px;background:var(--oi-surface);z-index:5000';
    const block = host.appendChild(document.createElement('div')); block.className = 'openide-chat-block';
    const trayHost = block.appendChild(document.createElement('div')); trayHost.className = 'openide-chat-tray-host';
    const card = block.appendChild(document.createElement('div')); card.className = 'openide-chat-input-card'; card.textContent = 'Plan, Build, / for skills, @ for context';
    document.querySelector('.monaco-workbench').append(host);
    const parent = host.querySelector('.openide-chat-tray-host');
    const actions = []; const storage = new InMemoryStorageService();
    const service = { onDidChangeBackgroundTerminal: Event.None, onDidChangeFileDiff: Event.None, pendingFileDiffs: () => [{path:'src/app.ts',added:12,removed:3}], keepEdit:async()=>{}, keepEdits:async()=>{},revertEdit:async()=>{},openDiff:async()=>{},killBackgroundTerminal:id=>actions.push(['stop',id]),revealBackgroundTerminal:async id=>actions.push(['reveal',id]) };
    const child = instantiation.createChild(new ServiceCollection([IOpenideAgentService, service]));
    const files = child.createInstance(OpenideChatFilesTray, parent);
    const queue = new OpenideChatComposerQueue(parent, storage, hover);
    queue.setConversation('session'); queue.push({inputText:'Review accessibility in the settings page',images:[],references:[],capabilities:[],links:[],mode:'agent',providerId:'p',modelId:'m'});
    const terminals = new OpenideChatTerminalsTray(parent, service, hover);
    terminals.update({id:'server',command:'npm run dev',status:'running'});
    window.traysFixture = { actions, widget,
     openAgents: () => commands.executeCommand('openide.agent.openAgentWindow'),
     seedCompanion: () => { const companion=[...widget._companions][0]; companion._terminalsTray.update({id:'aux-a',command:'npm run dev',status:'running'}); companion._terminalsTray.update({id:'aux-b',command:'npm run watch',status:'running'}); },
     companionSize: () => { const composer=[...widget._companions][0]._composer; return {actual:composer._dock.offsetHeight,measured:composer.height.get()}; },
     dispose() { terminals.dispose();queue.dispose();files.dispose();child.dispose();storage.dispose();host.remove(); } };
   }
  });
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await page.keyboard.press('Control+Shift+KeyP');
 await page.locator('.quick-input-widget input').first().fill('>Chat Trays Fixture');
 await page.locator('.quick-input-list .monaco-list-row').filter({hasText:'Chat Trays Fixture'}).first().waitFor();
 await page.keyboard.press('Enter');
 const fixture = page.locator('.trays-fixture'); await fixture.waitFor();
 const measurements = {};
 for (const variant of ['files','queue','terms']) {
  const tray = fixture.locator(`.openide-chat-${variant}-tray`);
  await tray.locator('.openide-chat-tray-toggle').click();
  const row = tray.locator(`.openide-chat-${variant}-row`).first(); await row.waitFor();
  measurements[variant] = await tray.evaluate(el => ({ height:el.getBoundingClientRect().height, head:el.querySelector('.openide-chat-tray-head').getBoundingClientRect().height, row:el.querySelector('.openide-chat-tray-body').firstElementChild.getBoundingClientRect().height, icons:[...el.querySelectorAll('.codicon')].map(icon=>getComputedStyle(icon).fontSize) }));
  assert(measurements[variant].head <= 26, JSON.stringify(measurements));
  assert(measurements[variant].row <= 26, JSON.stringify(measurements));
  assert(measurements[variant].icons.every(size=>size==='16px'), JSON.stringify(measurements));
  assert.equal(await fixture.locator('.openide-chat-tray.expanded').count(), 1);
 }
 // Native grid motion must have intermediate sizes on both paths and retain row identity.
 const motionTray = fixture.locator('.openide-chat-terms-tray');
 async function fold(tray) {
  return tray.evaluate(async el => {
   await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
   const body = el.querySelector('.openide-chat-tray-body'), row = body.firstElementChild;
   const sizes = [el.getBoundingClientRect().height];
   el.querySelector('.openide-chat-tray-toggle').click();
   const started = performance.now();
   await new Promise(resolve => {
    const sample = () => { sizes.push(el.getBoundingClientRect().height); if (performance.now()-started < 320) requestAnimationFrame(sample); else resolve(); };
    requestAnimationFrame(sample);
   });
   return {sizes, retained:row === body.firstElementChild, inert:body.inert, expanded:el.classList.contains('expanded')};
  });
 }
 for (const expanded of [false,true]) {
  const result = await fold(motionTray);
  const first = result.sizes[0], last = result.sizes.at(-1);
  assert.equal(result.expanded,expanded);
  assert.equal(result.inert,!expanded);
  assert(result.retained,'fold retains the terminal DOM');
  assert(result.sizes.some(height => height > Math.min(first,last)+1 && height < Math.max(first,last)-1),`both directions animate intermediate heights: ${JSON.stringify(result)}`);
 }
 for (const variant of ['files','terms']) {
  const tray = fixture.locator(`.openide-chat-${variant}-tray`);
  if (await tray.locator('.openide-chat-tray-toggle').getAttribute('aria-expanded') !== 'true') await tray.locator('.openide-chat-tray-toggle').click();
  const row = tray.locator(`.openide-chat-${variant}-row`).first();
  await row.hover();
  const geometry = await tray.evaluate(el => {
   const row=el.querySelector('.openide-chat-tray-body').firstElementChild.getBoundingClientRect(), head=el.querySelector('.openide-chat-tray-head').getBoundingClientRect();
   return {left:row.left-head.left,right:head.right-row.right};
  });
  assert(Math.abs(geometry.left)<1 && Math.abs(geometry.right)<1,`row hover spans the same width as header: ${JSON.stringify(geometry)}`);
 }
 // The real composer updates its observable and the transcript throughout the fold.
 const live = page.locator('.openide-chat-native:not(.trays-fixture) .openide-chat-terms-tray').first();
 const liveMotion = await live.evaluate(async el => {
  const samples=[]; el.querySelector('.openide-chat-tray-toggle').click(); const start=performance.now();
  await new Promise(resolve=>{const sample=()=>{const widget=window.traysFixture.widget; samples.push({actual:widget._composer._dock.offsetHeight,measured:widget._composer.height.get()}); if(performance.now()-start<320)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});
  return samples;
 });
 assert(new Set(liveMotion.map(s=>s.measured)).size>2,'composer reports intermediate heights');
 assert.equal(liveMotion.at(-1).actual,liveMotion.at(-1).measured,'composer settles without a transcript gap');
 // Respect reduced motion and leave no focusable controls inside a collapsed body.
 await page.emulateMedia({reducedMotion:'reduce'});
 await live.locator('.openide-chat-tray-toggle').click();
 assert.equal(await live.locator('.openide-chat-tray-reveal').evaluate(el=>({height:el.getBoundingClientRect().height,duration:getComputedStyle(el).transitionDuration})).then(value=>value.height===0 && value.duration==='0s'),true);
 await page.emulateMedia({reducedMotion:'no-preference'});
 const terminal = fixture.locator('.openide-chat-terms-tray');
 await terminal.locator('.openide-chat-terms-row').hover();
 const stop = terminal.locator('.openide-chat-terms-stop');
 assert.deepEqual(await stop.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,border:getComputedStyle(el).borderTopWidth})), {width:22,height:22,border:'0px'});
 await page.screenshot({path:path.join(output,'trays.png')});
 await terminal.locator('.openide-chat-terms-label').click(); await stop.click();
 assert.deepEqual(await page.evaluate(()=>window.traysFixture.actions), [['reveal','server'],['stop','server']]);
 await fixture.evaluate(el=>el.style.width='280px');
 assert.equal(await fixture.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:path.join(output,'narrow.png')});
 const opened=app.waitForEvent('window');
 await page.evaluate(()=>window.traysFixture.openAgents());
 const agents=await opened;
 await agents.locator('.openide-agent-window textarea.openide-chat-prompt').waitFor();
 await page.evaluate(()=>window.traysFixture.seedCompanion());
 const auxiliaryTray=agents.locator('.openide-agent-window-chat .openide-chat-terms-tray');
 for(const expanded of [true,false]) {
  const result=await fold(auxiliaryTray);
  assert.equal(result.expanded,expanded);
  assert(result.sizes.some(height=>height>Math.min(result.sizes[0],result.sizes.at(-1))+1 && height<Math.max(result.sizes[0],result.sizes.at(-1))-1),'auxiliary window animates the same tray');
  const size=await page.evaluate(()=>window.traysFixture.companionSize());
  assert.equal(size.actual,size.measured);
 }
 await auxiliaryTray.locator('.openide-chat-tray-toggle').click();
 await auxiliaryTray.locator('.openide-chat-terms-row').first().hover();
 await agents.screenshot({path:path.join(output,'agents-tray.png')});
 await page.evaluate(()=>window.traysFixture.dispose());
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(measurements,null,2));
 console.log('PASS: compact rows, full-width hovers, animated open/close with stable DOM, live composer height, reduced motion, independent reveal/stop and narrow layout.');
} finally {
 if(app) await app.close();
 fs.rmSync(tmp,{recursive:true,force:true});
}
