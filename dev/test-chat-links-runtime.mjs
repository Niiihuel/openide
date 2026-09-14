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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-chat-links-'));
const output = path.join(root, '.build/chat-links-runtime');
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
		const { ServiceCollection } = await import(base + 'platform/instantiation/common/serviceCollection.js');
		const { IOpenerService } = await import(base + 'platform/opener/common/opener.js');
		const { IClipboardService } = await import(base + 'platform/clipboard/common/clipboardService.js');
		const { MarkdownString } = await import(base + 'base/common/htmlContent.js');
		const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
		const { createOpenideChatResponseItem, advanceOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
		const { observableValue } = await import(base + 'base/common/observable.js');
		const { Event } = await import(base + 'base/common/event.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.webPreview', title: 'Web Preview Fixture', f1: true }); }
			async run(accessor) {
				const instantiation = accessor.get(IInstantiationService), browsers = accessor.get(IBrowserViewWorkbenchService);
				const commands = accessor.get(ICommandService);
				const clipboard = accessor.get(IClipboardService), opener = accessor.get(IOpenerService), external = [];
				const originalOpen = opener.open.bind(opener);
				const scoped = instantiation.createChild(new ServiceCollection([IOpenerService, { open: async (resource, options) => { if(options?.openExternal) { external.push(String(resource)); return true; } return originalOpen(resource, options); } }]));
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Preserved composer draft', send: false });
				window.webPreviewFixture = {
					install(url) {
 const target = [...getWindows()].map(w => w.window).find(w => w.document.querySelector('.openide-agent-window'));
 const host = document.createElement('div'); host.className = 'openide-chat-native preview-fixture';
 host.style.cssText = 'position:absolute;left:20px;right:20px;top:120px;z-index:5;background:var(--vscode-editor-background)';
 target.document.querySelector('.openide-agent-window-main').append(host);
 const renderer = scoped.createInstance(OpenideChatResponseRenderer, observableValue('width', 500), Event.None);
 const template = renderer.renderTemplate(host);
 const item = createOpenideChatResponseItem({id:'links',requestId:'r',content:[{kind:'markdown',value:new MarkdownString(`[Local fixture](${url}) · [GitHub build](https://github.com/openide/repo/actions/runs/123) · [Other](https://example.com)`)}],isComplete:true});
 renderer.renderElement({element:item},0,template);
 this.external = () => external;
 this.clipboard = () => clipboard.readText();
 this.previewId = () => browsers.getPreview()?.id;
 this.nativeNavigate = () => browsers.openPreview(url,undefined,{targetWindowId:target.vscodeWindowId});
 this.dispose = () => {renderer.disposeTemplate(template);renderer.dispose();host.remove();};
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
 const links = agent.locator('.preview-fixture a');
 assert.equal(await links.count(), 3);
 assert.equal(await agent.locator('.preview-fixture .codicon-github').count(), 1);
 assert.equal(await ide.evaluate(() => window.webPreviewFixture.previewId()), undefined, 'render does not navigate');
 const github = links.filter({hasText:'GitHub build'});
 await github.click({button:'right'});
 const menu = agent.locator('.monaco-menu');
 await menu.waitFor();
 const labels = await menu.getByRole('menuitem').allTextContents();
 assert.equal(labels.length, 3);
 await agent.screenshot({path:path.join(output,'link-menu.png')});
 await menu.getByRole('menuitem').nth(2).click();
 let copied = '';
 for (let attempt = 0; attempt < 40; attempt++) {
  copied = await ide.evaluate(() => window.webPreviewFixture.clipboard());
  if (copied) break;
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 assert.equal(copied, 'https://github.com/openide/repo/actions/runs/123');
 await menu.waitFor({state:'hidden'});
 await github.click({button:'right'});
 await menu.getByRole('menuitem').nth(1).click();
 await ide.waitForFunction(() => window.webPreviewFixture.external().length === 1);
 assert.deepEqual(await ide.evaluate(() => window.webPreviewFixture.external()), ['https://github.com/openide/repo/actions/runs/123']);
 const local = links.filter({hasText:'Local fixture'});
 await local.click();
 await agent.locator('.embedded-editor .browser-container').waitFor();
 assert.equal(await ide.locator('.browser-container').count(), 0, 'native browser stays in Agents Window');
 await local.click({button:'right'});
 await menu.getByRole('menuitem').nth(0).click();
 assert.equal(await agent.locator('.embedded-editor .browser-container').count(), 1);
 assert.equal(await ide.locator('.browser-container').count(), 0);
 await agent.screenshot({path:path.join(output,'native-link.png')});
 assert.equal(await agent.locator('.openide-chat-input-card textarea:visible').inputValue(), 'Preserved composer draft');
 await ide.evaluate(()=>window.webPreviewFixture.dispose());
 fs.writeFileSync(path.join(output,'result.json'), JSON.stringify({labels,nativeBrowser:true,windowIsolation:true,githubIcon:true,copy:true,external:true,errors},null,2));
 console.log('PASS: inline GitHub icon, native default click, contextual native/external/copy, originating window.');
} finally {
 if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); }
 server.close();
 fs.rmSync(tmp,{recursive:true,force:true});
}
