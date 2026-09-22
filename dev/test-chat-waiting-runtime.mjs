// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-waiting-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Use dev/run-virtual-gui.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-waiting-'));
const output = path.join(root, '.build/chat-waiting-runtime');
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
  const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
  const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
  const { createOpenideChatResponseItem, advanceOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
  const { observableValue } = await import(base + 'base/common/observable.js');
  const { Event } = await import(base + 'base/common/event.js');
  registerAction2(class extends Action2 {
   constructor() { super({ id: 'test.chatWaiting', title: 'Chat Waiting Fixture', f1: true }); }
   async run(accessor) {
    const instantiation = accessor.get(IInstantiationService);
    await accessor.get(ICommandService).executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Review the command', send: false });
    const host = document.createElement('div'); host.className = 'openide-chat-native waiting-fixture';
    host.style.cssText = 'position:absolute;left:300px;top:140px;width:540px;padding:20px;background:var(--oi-surface);z-index:100';
    document.querySelector('.monaco-workbench').append(host);
    const renderer = instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 540), Event.None);
    const template = renderer.renderTemplate(host);
    let item = createOpenideChatResponseItem({ id: 'waiting-fixture', requestId: 'request', content: [] });
    window.waitingFixture = {
     update(content, isComplete = false) { item = advanceOpenideChatResponseItem(item, { content, isComplete }); renderer.renderElement({ element: item }, 0, template); },
     dispose() { renderer.disposeTemplate(template); renderer.dispose(); host.remove(); }
    };
    window.waitingFixture.update([{ kind: 'confirmation', requestId: 'approval', tool: 'run_command', title: 'Iniciar servidor de desarrollo', command: 'npm run dev', risk: 'exec' }]);
   }
  });
 }, `vscode-file://vscode-app${root}/vscode/out/vs/`);
 await page.keyboard.press('Control+Shift+KeyP');
 await page.locator('.quick-input-widget input').first().fill('>Chat Waiting Fixture');
 await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Chat Waiting Fixture' }).first().waitFor();
 await page.keyboard.press('Enter');
 const fixture = page.locator('.waiting-fixture');
 const status = fixture.locator('.openide-chat-response-working-label');
 await status.getByText('Waiting for response', { exact: true }).waitFor();
 const scope = fixture.locator('.openide-chat-approval-scope-trigger');
 assert.equal(await scope.evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
 await scope.click();
 const menu = page.locator('.openide-menu[role="menu"]').filter({has:page.getByRole('menuitemradio', {name:'For this session',exact:true})});
 await menu.getByRole('menuitemradio',{name:'For this session',exact:true}).click();
 assert.equal(await scope.textContent(),'For this session');
 await scope.click();
 await page.screenshot({path:path.join(output,'approval-popover.png')});
 await page.keyboard.press('Escape');
 assert.equal(await scope.getAttribute('aria-expanded'),'false');
 assert.equal(await scope.evaluate(el=>el===document.activeElement),true);
 await scope.click();
 await menu.getByRole('menuitemradio',{name:'Only this time',exact:true}).focus();
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'For this session');
 await page.keyboard.press('Home');
 await page.keyboard.press('Enter');
 assert.equal(await scope.textContent(),'Only this time');
 await scope.hover();
 await page.waitForFunction(() => getComputedStyle(document.querySelector('.waiting-fixture .openide-chat-approval-scope-trigger')).backgroundColor !== 'rgba(0, 0, 0, 0)');
 await page.screenshot({ path: path.join(output, 'approval.png') });
 const prompt = page.locator('textarea.openide-chat-prompt').first(); await prompt.focus();
 const colors = await prompt.evaluate(el => {
  const card = el.closest('.openide-chat-input-card');
  return { border: getComputedStyle(card).borderColor, neutral: getComputedStyle(card).getPropertyValue('--oi-border').trim(), beams: document.querySelectorAll('.openide-chat-beam').length, animations: document.getAnimations().filter(a => a.animationName?.includes('working-border')).length };
 });
 assert.equal(colors.beams, 0); assert.equal(colors.animations, 0);
 assert.equal(await prompt.evaluate(el => {
  const card = el.closest('.openide-chat-input-card'); const before = getComputedStyle(card).borderColor;
  el.blur(); return getComputedStyle(card).borderColor === before;
 }), true, 'focusing the prompt does not change its neutral border');
 await page.evaluate(() => window.waitingFixture.update([{ kind: 'ask', requestId: 'ask', questions: [], isComplete: false }]));
 await status.getByText('Waiting for response', { exact: true }).waitFor();
 assert.equal(await fixture.locator('.openide-chat-ask').isVisible(), false);
 assert.equal(await fixture.locator('.openide-chat-response-working:visible').count(), 1);
 await page.emulateMedia({ reducedMotion: 'reduce' });
 assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), 'none');
 await page.evaluate(() => window.waitingFixture.update([{ kind: 'ask', requestId: 'ask', questions: [], isComplete: true, answers: [] }], true));
 await fixture.locator('.openide-chat-response-working').waitFor({ state: 'hidden' });
 await page.emulateMedia({ reducedMotion: 'no-preference' });
 await page.evaluate(() => window.waitingFixture.update([{ kind: 'tool', callId: 'done', name: 'browser_evaluate', argumentsJson: '{}', state: 'success', result: 'Done' }]));
 await status.getByText('Planning next moves', { exact: true }).waitFor();
 assert.equal(await fixture.locator('.openide-chat-status-lattice, .openide-chat-status-trace').count(), 0, 'the live line has no rotating dots or faded previous step');
 assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), 'openide-text-shimmer');
 await fixture.screenshot({ path: path.join(output, 'shimmer-only.png') });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 assert.equal(await status.evaluate(el => getComputedStyle(el).animationName), 'none');
 await page.evaluate(() => window.waitingFixture.dispose());
 fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ neutralComposer: true, noBorderAnimation: true, borderlessApprovalScope: true, sharedWaitingStatus: true, reducedMotion: true }, null, 2));
 console.log('PASS: neutral composer, approval scope, single waiting indicator, reduced motion and completion.');
} finally {
 if (app) await app.close();
 fs.rmSync(tmp, { recursive: true, force: true });
}
