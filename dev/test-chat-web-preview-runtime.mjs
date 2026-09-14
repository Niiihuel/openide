// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-workspace-chrome-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import http from 'node:http';
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Preview fixture</title><style>body{background:#181818;color:#ddd;font:20px system-ui;padding:40px}input{font:inherit}</style><h1>Preview fixture</h1><label>Preserved state <input id=state></label>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-web-preview-'));
const output = path.join(root, '.build/chat-web-preview-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
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
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { getWindows } = await import(base + 'base/browser/dom.js');
		const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
		const { createOpenideChatResponseItem, advanceOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
		const { observableValue } = await import(base + 'base/common/observable.js');
		const { Event } = await import(base + 'base/common/event.js');
		const { DisposableStore } = await import(base + 'base/common/lifecycle.js');
		const { renderImageStrip } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatRequestBubble.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.webPreview', title: 'Web Preview Fixture', f1: true }); }
			async run(accessor) {
				const instantiation = accessor.get(IInstantiationService), browsers = accessor.get(IBrowserViewWorkbenchService);
				const commands = accessor.get(ICommandService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Preserved composer draft', send: false });
				window.webPreviewFixture = {
					install(url) {
 const target = [...getWindows()].map(w => w.window).find(w => w.document.querySelector('.openide-agent-window'));
 const host = document.createElement('div'); host.className = 'openide-chat-native preview-fixture';
 host.style.cssText = 'position:absolute;left:20px;right:20px;top:120px;z-index:5;background:var(--vscode-editor-background)';
 target.document.querySelector('.openide-agent-window-main').append(host);
 const renderer = instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 500), Event.None);
 const template = renderer.renderTemplate(host);
 const tool = { kind:'tool', callId:'nav', name:'browser_navigate', argumentsJson:JSON.stringify({url}), state:'running' };
 let item = createOpenideChatResponseItem({id:'preview',requestId:'r',content:[tool]});
 const render = () => renderer.renderElement({element:item},0,template); render();
 this.complete = () => { item = advanceOpenideChatResponseItem(item,{content:[{...tool,state:'success',resultText:`OK: loaded ${url} (title: Preview fixture).`},{...tool,callId:'again',state:'success',resultText:`OK: loaded ${url} (title: Preview fixture).`}],isComplete:true}); render(); };
 this.replay = () => { item = {...item,id:'restored'}; render(); };
 this.previewId = () => browsers.getPreview()?.id;
 this.previewVisible = () => browsers.getPreview()?.model?.visible;
 const attachments = document.createElement('div'); attachments.className = 'preview-fixture-attachments';
 const imageStore = new DisposableStore(); host.append(attachments);
 renderImageStrip(attachments,[{mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}],imageStore,commands);
 this.nativeNavigate = () => browsers.openPreview(url,undefined,{targetWindowId:target.vscodeWindowId});
 this.dispose = () => {imageStore.dispose();renderer.disposeTemplate(template);renderer.dispose();host.remove();};
 },
 open: () => commands.executeCommand('openide.agent.openAgentWindow'),
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Web Preview Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Web Preview Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.webPreviewFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.webPreviewFixture.open());
	const agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));


 await agent.setViewportSize({width:1440,height:900});
 await agent.locator('.openide-chat-input-card textarea:visible').waitFor();
 await ide.evaluate(url => window.webPreviewFixture.install(url), url);
 const card = agent.locator('.preview-fixture .openide-chat-resource-card:not([hidden])');
 assert.equal(await card.count(), 0);
 await ide.evaluate(() => window.webPreviewFixture.complete());
 await card.waitFor();
 assert.equal(await ide.evaluate(() => window.webPreviewFixture.previewId()), undefined, 'render has no browser side effect');
 await card.locator('.oi-split-main').click();
 await agent.locator('.embedded-editor .browser-container').waitFor();
 const previewId = await ide.evaluate(() => window.webPreviewFixture.previewId());
 const state = async value => app.evaluate(async ({webContents}, {url,value}) => {
  const page = webContents.getAllWebContents().find(w => w.getURL() === url);
  if (!page) return undefined;
  if (value !== undefined) await page.executeJavaScript(`document.querySelector('#state').value = ${JSON.stringify(value)}`);
  return { id:page.id, value:await page.executeJavaScript("document.querySelector('#state').value"), count:webContents.getAllWebContents().filter(w=>w.getURL()===url).length };
 },{url,value});
 for (let n=0;n<50 && !(await state());n++) await new Promise(r=>setTimeout(r,100));
 const initial = await state('Keep this draft');
 assert.equal(initial.value,'Keep this draft');
 assert.equal(await card.locator('.openide-chat-resource-full').count(),0);
 await agent.screenshot({path:path.join(output,'card-panel.png')});
 await card.locator('.oi-split-more').click();
 await agent.locator('.monaco-menu').getByRole('menuitem').nth(1).click();
 await agent.locator('.monaco-modal-editor-block:not(.embedded-editor)').waitFor();
 assert.equal(await ide.locator('.monaco-modal-editor-block').count(),0,'modal stays in owning window');
 assert.deepEqual(await state(),initial,'full view reuses the page and preserves input');
 await agent.screenshot({path:path.join(output,'native-full-view.png')});
 const modalHeader = agent.locator('.monaco-modal-editor-block:not(.embedded-editor) .modal-editor-header');
 assert.equal(await modalHeader.locator('.codicon-open-in-product, .codicon-screen-full').count(),0,'expanded dock has no redundant move/maximize controls');
 await agent.locator('.openide-return-to-workspace').click();
 await agent.locator('.embedded-editor .browser-container').waitFor();
 assert.deepEqual(await state(),initial,'return to workspace preserves page');
 await agent.evaluate(() => {
  const panel = document.querySelector('.openide-agent-window-workspace');
  document.querySelector('button[aria-controls="openide-agent-window-workspace"]').click();
  window.browserExitFrames = [];
  const sample = () => {
   window.browserExitFrames.push({exiting:panel.classList.contains('openide-agent-motion-exit'),snapshot:!!panel.querySelector('.browser-placeholder-screenshot')?.style.backgroundImage});
   if (window.browserExitFrames.length < 20) requestAnimationFrame(sample);
  }; requestAnimationFrame(sample);
 });
 await ide.waitForFunction(()=>window.webPreviewFixture.previewVisible()===false);
 assert.equal(await agent.evaluate(()=>document.querySelector('.openide-agent-window-workspace').classList.contains('openide-agent-motion-exit')),true,'native browser is hidden before exit animation finishes');
 await agent.waitForFunction(()=>window.browserExitFrames.length===20);
 assert.equal(await agent.evaluate(()=>window.browserExitFrames.some(f=>f.exiting&&f.snapshot)),true,'DOM snapshot follows outgoing panel');
 await agent.locator('button[aria-controls="openide-agent-window-workspace"]').click();
 await ide.waitForFunction(()=>window.webPreviewFixture.previewVisible()===true);
 assert.deepEqual(await state(),initial,'hide/reopen preserves live page');
 // Use the real attachment click path inside the auxiliary document.
 await agent.locator('.preview-fixture-attachments .openide-chat-request-image').click();
 const picture = agent.locator('.openide-diagram-viewer-canvas img');
 await picture.waitFor();
 await picture.evaluate(img=>img.decode());
 assert.equal(await picture.evaluate(img=>img.naturalWidth),1);
 await agent.locator('.openide-diagram-viewer-btn').first().click();
 await agent.screenshot({path:path.join(output,'attachment-viewer.png')});
 await agent.locator('.modal-editor-header .codicon-close').click();
 await picture.waitFor({state:'detached'});
 assert.deepEqual(await state(),initial,'closing image preserves browser tab and state');
 await agent.locator('.openide-return-to-workspace').click();
 await agent.locator('.embedded-editor .browser-container').waitFor();
 await card.locator('.oi-split-more').click();
 const menu=agent.locator('.monaco-menu');
 assert.equal(await menu.getByRole('menuitem').count(),4);
 await agent.screenshot({path:path.join(output,'card-menu.png')});
 await agent.keyboard.press('Escape');
 assert.equal(await card.locator('.oi-split-more').evaluate(el=>el===el.ownerDocument.activeElement),true);
 await card.locator('.oi-split-main').click();
 assert.deepEqual(await state(),initial,'repeated click does not navigate');
 await ide.evaluate(()=>window.webPreviewFixture.replay());
 await card.waitFor();
 assert.equal(await ide.evaluate(()=>window.webPreviewFixture.previewId()),previewId);
 assert.deepEqual(await state(),initial);
 // A genuine browser navigation must still reload, even when the URL is unchanged.
 await ide.evaluate(()=>window.webPreviewFixture.nativeNavigate());
 for(let n=0;n<50 && (await state())?.value;n++) await new Promise(r=>setTimeout(r,100));
 assert.equal((await state()).value,'');
 await agent.setViewportSize({width:1000,height:760});
 assert.equal(await card.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'card fits a narrow chat');
 assert.equal(await agent.locator('.openide-chat-input-card textarea:visible').inputValue(),'Preserved composer draft');
 await ide.evaluate(()=>window.webPreviewFixture.dispose());
 assert.deepEqual(errors,[], 'no runtime errors in main or auxiliary windows');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({liveCard:true,replay:true,oneBrowser:true,nativeFullView:true,attachmentViewer:true,closeOnlyActive:true,browserExitSnapshot:true,preservedPage:true,nativeMenu:true,explicitNavigationStillWorks:true},null,2));
 console.log('PASS: web card, full native modal, page state, same browser, menu and restored transcript.');
} finally {
 if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); }
 server.close();
 fs.rmSync(tmp,{recursive:true,force:true});
}
