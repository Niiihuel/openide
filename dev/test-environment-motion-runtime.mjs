// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-environment-motion-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-chat-welcome-'));
const output = path.join(root, '.build/environment-motion-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace/src'));
fs.writeFileSync(path.join(tmp, 'workspace/src/file.ts'), 'export const preservedFilesTab = true;');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom',
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { t, openideStringFor } = await import(base + 'workbench/contrib/openideAgent/common/openideStrings.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.chatWelcome', title: 'Chat Welcome Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService), views = accessor.get(IViewsService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Welcome fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value, sessions = view._widget.value.sessionStore;
				const saved = sessions.createBackground('Saved welcome fixture', [{ role: 'user', content: 'A previous task' }, { role: 'assistant', content: 'Previous answer' }]);
				widget.newSession();
				widget._composer.value = '';
				let submits = 0;
				const listener = widget._composer.onDidSubmit(() => submits++);
				window.chatWelcomeFixture = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					stats: () => ({ submits, items: widget.controller.items.length, draft: widget._composer.value }),
					openSaved: () => widget.openSession(saved),
					clearHistory: () => { sessions.delete(saved); widget.refreshSessions(); },
					newSession: () => { widget.newSession(); widget._composer.value = ''; },
					label: key => t(key),
					spanish: key => openideStringFor(key, 'es'),
					dispose: () => listener.dispose(),
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Chat Welcome Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Chat Welcome Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.chatWelcomeFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.chatWelcomeFixture.open());
	const agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));


 await agent.setViewportSize({width:1440,height:900});
 const panel = agent.locator('.openide-agent-window-context');
 const chat = agent.locator('.openide-agent-window-chat');
 await panel.waitFor();
 await agent.waitForFunction(()=>document.querySelector('.openide-agent-window-context-scroll').getAnimations().length===0);
 const composer = agent.locator('.openide-chat-input-card textarea:visible');
 await composer.fill('Keep this draft');
 const cdp = await agent.context().newCDPSession(agent);
 await cdp.send('Performance.enable');
 const start = await agent.evaluate(()=>{
  const chat=document.querySelector('.openide-agent-window-chat'), context=document.querySelector('.openide-agent-window-context');
  const before=chat.getBoundingClientRect().width;
  window.motionComposer=chat.querySelector('textarea');
  context.querySelector('.openide-agent-window-section-heading .icon-only').click();
  window.motionAnimations=[...chat.getAnimations(),...context.closest('.openide-agent-window-context-scroll').getAnimations()];
  for(const a of window.motionAnimations){a.pause();a.currentTime=0;}
  return {before,visual:chat.getBoundingClientRect().width,final:chat.clientWidth,animations:window.motionAnimations.length,inert:context.inert,keys:window.motionAnimations.map(a=>Object.keys(a.effect.getKeyframes()[0]))};
 });
 console.log(JSON.stringify(start));
 assert.equal(start.animations,2,'chat and Environment animate together');
 assert.ok(start.final>start.before+250,'final layout is committed at the start');
 assert.ok(Math.abs(start.visual-start.before)<2,'chat starts at its previous visual size');
 assert.equal(start.inert,true);
 assert.ok(start.keys.flat().every(k=>!['width','height','flexBasis','gridTemplateColumns'].includes(k)));
 const metricsBefore=await cdp.send('Performance.getMetrics');
 const samples=await agent.evaluate(()=>{
  const chat=document.querySelector('.openide-agent-window-chat');const widths=[];
  for(const time of [20,45,90,130,170]){for(const a of window.motionAnimations)a.currentTime=time;widths.push(chat.getBoundingClientRect().width);}
  return {widths,sameComposer:window.motionComposer===chat.querySelector('textarea')};
 });
 const metricsAfter=await cdp.send('Performance.getMetrics');
 const layouts=metricsAfter.metrics.find(m=>m.name==='LayoutCount').value-metricsBefore.metrics.find(m=>m.name==='LayoutCount').value;
 assert.ok(samples.widths.every((w,i)=>!i||w>samples.widths[i-1]),JSON.stringify(samples));
 assert.equal(samples.sameComposer,true);
 assert.ok(layouts<=1,`interpolation triggered ${layouts} layouts`);
 await agent.screenshot({path:path.join(output,'chat-expanding.png')});
 await agent.evaluate(()=>window.motionAnimations.forEach(a=>a.finish()));
 await panel.waitFor({state:'hidden'});
 assert.equal(await chat.evaluate(e=>getComputedStyle(e).transform),'none');
 assert.equal(await composer.inputValue(),'Keep this draft');
 // Reverse halfway through opening: continue from the currently painted geometry.
 const reversed=await agent.evaluate(()=>{
  const chat=document.querySelector('.openide-agent-window-chat'),context=document.querySelector('.openide-agent-window-context');
  const toggle=document.querySelector('button[aria-controls="openide-agent-window-context"]');
  toggle.click();
  for(const a of [...chat.getAnimations(),...context.closest('.openide-agent-window-context-scroll').getAnimations()]){a.pause();a.currentTime=70;}
  const before=chat.getBoundingClientRect().width;
  toggle.click();
  window.motionAnimations=[...chat.getAnimations(),...context.closest('.openide-agent-window-context-scroll').getAnimations()];
  for(const a of window.motionAnimations){a.pause();a.currentTime=0;}
  return {before,after:chat.getBoundingClientRect().width};
 });
 assert.ok(Math.abs(reversed.before-reversed.after)<2,JSON.stringify(reversed));
 await agent.evaluate(()=>window.motionAnimations.forEach(a=>a.finish()));
 await panel.waitFor({state:'hidden'});
 // Both sidebar toggles animate the existing layout and keep Environment painted on exit.
 await agent.evaluate(()=>document.querySelector('button[aria-controls="openide-agent-window-context"]').click());
 await panel.waitFor();
 await agent.waitForFunction(()=>document.getAnimations().filter(a=>a.id==='openide-agent-layout').every(a=>a.playState!=='running'));
 const sidebars = await agent.evaluate(()=>{
  const root=document.querySelector('.openide-agent-window');
  const center=root.querySelector('.openide-agent-window-center');
  const env=root.querySelector('.openide-agent-window-context');
  const result=[];
  for(const name of ['workspace','workspace','sidebar','sidebar']){
   const button=document.querySelector(`button[aria-controls="openide-agent-window-${name}"]`);
   const target=document.getElementById(`openide-agent-window-${name}`);
   const before=center.getBoundingClientRect(); const envBefore=env.getBoundingClientRect();
   button.click();
   const animations=root.getAnimations({subtree:true}).filter(a=>a.id==='openide-agent-layout');
   for(const a of animations){a.pause();a.currentTime=0;}
   const start=center.getBoundingClientRect();
   result.push({name,animations:animations.length,continuous:Math.abs(start.left-before.left)<2 && Math.abs(start.width-before.width)<2,
    envPreserved:name!=='workspace'||envBefore.width===0||(env.getBoundingClientRect().width>0 && Math.abs(env.getBoundingClientRect().left-envBefore.left)<2),
    exitInert:!target.classList.contains('openide-agent-motion-exit')||target.inert});
   for(const a of animations)a.finish();
  }
  return result;
 });
 assert.ok(sidebars.every(s=>s.animations>0&&s.continuous&&s.envPreserved&&s.exitInert),JSON.stringify(sidebars));
 await agent.waitForFunction(()=>document.querySelectorAll('.openide-agent-motion-exit').length===0);
 await agent.evaluate(()=>{
  document.querySelector('button[aria-controls="openide-agent-window-workspace"]').click();
  window.sidebarFrames=document.getAnimations().filter(a=>a.id==='openide-agent-layout');
  for(const a of window.sidebarFrames){a.pause();a.currentTime=30;}
  const host=document.querySelector('.openide-agent-window-context-scroll');
  if(host.classList.contains('openide-agent-motion-exit') && host.parentElement!==document.querySelector('.openide-agent-window')){
   throw new Error('Environment must escape the shrinking conversation clip while exiting');
  }
 });
 await agent.screenshot({path:path.join(output,'workspace-opening.png')});
 await agent.evaluate(()=>window.sidebarFrames.forEach(a=>a.finish()));
 await agent.waitForFunction(()=>document.getAnimations().filter(a=>a.id==='openide-agent-layout').length===0);
 await agent.locator('button[aria-controls="openide-agent-window-workspace"]').click();
 await panel.waitFor();
 await agent.waitForFunction(()=>document.getAnimations().filter(a=>a.id==='openide-agent-layout').length===0);
 await agent.evaluate(()=>{const b=document.querySelector('button[aria-controls="openide-agent-window-context"]');if(b.getAttribute('aria-expanded')==='true')b.click();});
 await panel.waitFor({state:'hidden'});
 // Reduced motion applies immediately, including a preference change during an animation.
 await agent.evaluate(()=>document.querySelector('button[aria-controls="openide-agent-window-context"]').click());
 await agent.emulateMedia({reducedMotion:'reduce'});
 await agent.waitForFunction(()=>document.querySelector('.openide-agent-window-chat').getAnimations().length===0);
 await agent.locator('button[aria-controls="openide-agent-window-context"]').click();
 await panel.waitFor({state:'hidden'});
 assert.equal(await chat.evaluate(e=>e.getAnimations().length),0);
 await agent.screenshot({path:path.join(output,'chat-expanded.png')});
 // Narrow Environment is an overlay: it does not need a chat scale animation.
 await agent.setViewportSize({width:800,height:760});
 await agent.emulateMedia({reducedMotion:'no-preference'});
 await agent.evaluate(()=>document.querySelector('button[aria-controls="openide-agent-window-context"]').click());
 await panel.waitFor();
 await agent.waitForFunction(()=>document.querySelector('.openide-agent-window-context-scroll').getAnimations().length===0);
 const narrow=await agent.evaluate(()=>{
  const chat=document.querySelector('.openide-agent-window-chat'),context=document.querySelector('.openide-agent-window-context');
  const before=chat.clientWidth;
  document.querySelector('button[aria-controls="openide-agent-window-context"]').click();
  return {before,after:chat.clientWidth,animations:chat.getAnimations().length};
 });
 assert.equal(narrow.animations,0);
 assert.equal(narrow.before,narrow.after);
 await panel.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({synchronized:true,sidebars,layoutPassesDuringInterpolation:layouts,composerPreserved:true,interruption:true,reducedMotion:true,narrowOverlay:true},null,2));
 await ide.evaluate(()=>window.chatWelcomeFixture.dispose());
 console.log('PASS: synchronized Environment/chat animation, bounded layout, reversal, reduced motion and narrow overlay.');
} finally { if(app) await app.close(); fs.rmSync(tmp,{recursive:true,force:true}); }
