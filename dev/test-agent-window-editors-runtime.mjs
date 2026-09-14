// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-editors-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-editors-'));
const output = path.join(root, '.build/agent-window-editors-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace/current.ts'), 'export const value = 2;\n');
fs.writeFileSync(path.join(tmp, 'workspace/original.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom' }));
const server = http.createServer((request, response) => {
	response.writeHead(200, { 'content-type': 'text/html' });
	response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent native preview</title><style>body{background:#181818;color:#eee;font:20px system-ui;padding:32px}a{color:#efb364}</style><h1>Native browser in agent window</h1><p>Shared workbench preview is rendering.</p><a href="/next">Navigate locally</a>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const previewUrl = `http://127.0.0.1:${server.address().port}/`;
let app; const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
	ide.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('No default agent registered')) { errors.push(msg.text()); console.error(msg.text()); } });
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({ base, workspace, previewUrl }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { IConfigurationService } = await import(base + 'platform/configuration/common/configuration.js');
		const { IHoverService } = await import(base + 'platform/hover/browser/hover.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { IAuxiliaryWindowService } = await import(base + 'workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IEditorGroupsService } = await import(base + 'workbench/services/editor/common/editorGroupsService.js');
		const { IFileDialogService } = await import(base + 'platform/dialogs/common/dialogs.js');
		const { IModelService } = await import(base + 'editor/common/services/model.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { OpenideAgentWindowEditors } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowEditors.js');
		const { URI } = await import(base + 'base/common/uri.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentEditors', title: 'Agent Editors Fixture', f1: true }); }
			async run(accessor) {
				const hoverService = accessor.get(IHoverService), configuration = accessor.get(IConfigurationService);
				const commands = accessor.get(ICommandService), instantiation = accessor.get(IInstantiationService), windows = accessor.get(IAuxiliaryWindowService), editors = accessor.get(IEditorService), groups = accessor.get(IEditorGroupsService), models = accessor.get(IModelService), browser = accessor.get(IBrowserViewWorkbenchService);
				const current = URI.file(workspace + '/current.ts'), original = URI.file(workspace + '/original.ts');
				let host, auxiliary;
				let saveChoice = 2, savePrompts = 0;
				accessor.get(IFileDialogService).showSaveConfirm = async () => { savePrompts++; return saveChoice; };
				window.agentEditorsFixture = {
					saveChoice: choice => { saveChoice = choice; },
					savePrompts: () => savePrompts,
					theme: name => configuration.updateValue('workbench.colorTheme', name),
					tooltip: index => hoverService.showManagedHover(auxiliary.window.document.querySelectorAll('.browser-actions-toolbar .action-item:not(.disabled) .action-label.codicon:not(.separator)')[index].parentElement),
					open: async () => { auxiliary = await windows.open({ bounds: { width: 1000, height: 750 }, nativeTitlebar: true }); await auxiliary.whenStylesHaveLoaded; host = instantiation.createInstance(OpenideAgentWindowEditors, auxiliary.window.vscodeWindowId); auxiliary.onUnload(() => host.dispose()); await host.openEditor({ resource: current, options: { pinned: true } }); },
					file: async () => { await host.openEditor({ resource: current, options: { pinned: true } }); },
					diff: async () => { await host.openEditor({ original: { resource: original }, modified: { resource: current }, options: { pinned: true } }); },
					browser: async () => { await host.openEditor(browser.getOrCreatePreview(previewUrl), { pinned: true }); },
					device: () => browser.getOrCreatePreview().model?.device,
					emulation: async () => { await commands.executeCommand('workbench.action.browser.toggleDeviceEmulation', (await host.getEditorService()).activeEditorPane); },
					mainModal: async () => { const part = await groups.createModalEditorPart({ targetWindowId: window.vscodeWindowId }); await editors.openEditor({ resource: original }, part.activeGroup); },
					closeModal: () => host.close(),
					dirty: () => models.getModel(current).setValue('export const unsavedAgentEdit = true;\n'),
					value: () => models.getModel(current)?.getValue(),
					mainEditors: () => groups.mainPart.groups.flatMap(group => group.editors.map(editor => ({ resource: editor.resource?.path, dirty: editor.isDirty() }))),
				};
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, workspace: path.join(tmp, 'workspace'), previewUrl });
	await ide.keyboard.press('Control+Shift+KeyP'); await ide.locator('.quick-input-widget input').first().fill('>Agent Editors Fixture'); await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Editors Fixture' }).first().waitFor(); await ide.keyboard.press('Enter'); await ide.waitForFunction(() => !!window.agentEditorsFixture);
	const opened = app.waitForEvent('window'); await ide.evaluate(() => window.agentEditorsFixture.open()); const agent = await opened; agent.on('pageerror', error => errors.push(error.message)); agent.on('dialog', () => {});
	await agent.locator('.modal-editor-part .monaco-editor').first().waitFor(); assert.equal(await ide.locator('.monaco-modal-editor-block').count(), 0, 'file stays in agent window');
	await agent.locator('.monaco-editor .view-lines').first().click();
	await agent.keyboard.press('Escape');
	await agent.locator('.monaco-modal-editor-block').waitFor({ state: 'detached' });
	await ide.evaluate(() => window.agentEditorsFixture.file());
	await ide.evaluate(() => window.agentEditorsFixture.diff()); await agent.locator('.monaco-diff-editor').waitFor();
	assert.ok(await agent.locator('.tabs-container .tab').count() >= 2, 'native tabs expose file and diff');
	await agent.screenshot({ path: path.join(output, 'agent-native-diff.png') });
	await ide.evaluate(() => window.agentEditorsFixture.mainModal()); await ide.locator('.monaco-modal-editor-block').waitFor(); assert.equal(await agent.locator('.monaco-modal-editor-block').count(), 1, 'IDE and auxiliary modal coexist');
	await agent.locator('.modal-editor-header .codicon-close').click(); await agent.locator('.monaco-modal-editor-block').waitFor({ state: 'detached' }); assert.equal(await ide.locator('.monaco-modal-editor-block').count(), 1, 'closing auxiliary modal does not close IDE modal');
	await ide.evaluate(() => window.agentEditorsFixture.browser()); await agent.locator('.browser-container').waitFor();
	await ide.waitForFunction(() => !!document.querySelector('.monaco-workbench'));
	const pageContents = await app.evaluate(async ({ webContents }, url) => {
		let view;
		const deadline = Date.now() + 15000;
		while (!(view = webContents.getAllWebContents().find(content => content.getURL() === url))) {
			if (Date.now() > deadline) { throw new Error('Native preview webcontents missing'); }
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		await view.executeJavaScript('new Promise(resolve => document.readyState === "complete" ? resolve() : addEventListener("load",resolve,{once:true}))');
		return { title: view.getTitle(), heading: await view.executeJavaScript('document.querySelector("h1").textContent') };
	}, previewUrl);
	assert.equal(pageContents.heading, 'Native browser in agent window');
	await agent.bringToFront();
	await agent.locator('.modal-editor-title').click();
	await agent.waitForTimeout(250);
	const toolbar = agent.locator('.browser-navbar');
	const actionGeometry = await toolbar.locator('.oi-dock-toolbar .action-label.codicon:not(.separator)').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
		const box = node.getBoundingClientRect(), style = getComputedStyle(node);
		return { width: box.width, height: box.height, font: style.fontSize };
	}));
	assert.ok(actionGeometry.length > 3 && actionGeometry.every(value => value.width === 24 && value.height === 24 && value.font === '16px'), JSON.stringify(actionGeometry));
	const actions = toolbar.locator('.browser-actions-toolbar .action-item:not(.disabled) .action-label.codicon:not(.separator)');
	for (let index = 0; index < Math.min(2, await actions.count()); index++) {
		const action = actions.nth(index);
		await action.hover();
		// Exercise the same managed hover used by keyboard accessibility; native WebContents owns the OS pointer.
		await ide.evaluate(index => window.agentEditorsFixture.tooltip(index), index);
		const tip = agent.locator('.monaco-hover:visible').last();
		await tip.waitFor();
		const buttonBox = await action.boundingBox(), tipBox = await tip.boundingBox();
		assert.ok(tipBox.y >= buttonBox.y + buttonBox.height - 1, 'browser tooltip opens below, away from window actions');
		await agent.screenshot({ path: path.join(output, `browser-toolbar-hover-${index}.png`) });
	}
	await agent.mouse.move(500, 500);
	for (const width of [720, 460]) {
		await agent.setViewportSize({ width, height: 750 });
		await agent.waitForTimeout(200);
		const geometry = await toolbar.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, url: node.querySelector('.browser-url-container').getBoundingClientRect().width }));
		assert.ok(geometry.scroll <= geometry.width && geometry.url >= 120, JSON.stringify(geometry));
		await agent.screenshot({ path: path.join(output, `browser-toolbar-${width}.png`) });
	}
	await agent.setViewportSize({ width: 1000, height: 750 });
	await ide.evaluate(() => window.agentEditorsFixture.theme('OpenIDE Light'));
	await agent.locator('.monaco-workbench.vs').waitFor();
	await agent.screenshot({ path: path.join(output, 'browser-toolbar-light.png') });
	await ide.evaluate(() => window.agentEditorsFixture.theme('OpenIDE Dark'));
	await agent.locator('.monaco-workbench.vs-dark').waitFor();

	await ide.evaluate(() => window.agentEditorsFixture.emulation());
	await agent.getByLabel('Viewport width', { exact: true }).fill('390');
	await agent.getByLabel('Viewport width', { exact: true }).press('Enter');
	await agent.getByLabel('Viewport height', { exact: true }).fill('844');
	await agent.getByLabel('Viewport height', { exact: true }).press('Enter');
	await agent.screenshot({ path: path.join(output, 'agent-native-browser.png') });
	const device = await ide.evaluate(() => window.agentEditorsFixture.device());
	assert.equal(device.width, 390, 'native model records exact requested width');
	assert.equal(device.height, 844, 'native model records exact requested height');
	const viewportWidth = await app.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(content => content.getURL() === url).executeJavaScript('window.innerWidth'), previewUrl);
	// Auto-fit scales CSS bounds; BrowserView rounds native bounds to physical pixels.
	assert.ok(Math.abs(viewportWidth - 390) <= 1, `native device emulation reaches live page (scaled viewport: ${viewportWidth})`);
	const navigatedUrl = await app.evaluate(async ({ webContents }, url) => {
		const view = webContents.getAllWebContents().find(content => content.getURL() === url);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Native page navigation timed out')), 15000);
			view.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
			void view.executeJavaScript('document.querySelector("a").click()');
		});
		return view.getURL();
	}, previewUrl);
	assert.equal(navigatedUrl, previewUrl + 'next');
	await ide.evaluate(() => window.agentEditorsFixture.file()); await agent.locator('.modal-editor-part .monaco-editor').first().waitFor(); await ide.evaluate(() => window.agentEditorsFixture.dirty());
	const beforeClose = await ide.evaluate(() => window.agentEditorsFixture.mainEditors());
	await (await app.browserWindow(agent)).evaluate(nativeWindow => nativeWindow.close());
	await ide.waitForFunction(() => window.agentEditorsFixture.savePrompts() === 1);
	assert.equal(agent.isClosed(), false, 'Cancel keeps Agents and its dirty buffer open');
	assert.match(await ide.evaluate(() => window.agentEditorsFixture.value()), /unsavedAgentEdit/);
	assert.deepEqual(await ide.evaluate(() => window.agentEditorsFixture.mainEditors()), beforeClose);
	await ide.evaluate(() => window.agentEditorsFixture.saveChoice(0));
	const closed = agent.waitForEvent('close');
	await (await app.browserWindow(agent)).evaluate(nativeWindow => nativeWindow.close());
	await closed;
	assert.match(fs.readFileSync(path.join(tmp, 'workspace/current.ts'), 'utf8'), /unsavedAgentEdit/, 'Save persists the original buffer before closing');
	assert.deepEqual(await ide.evaluate(() => window.agentEditorsFixture.mainEditors()), beforeClose, 'no tabs migrate into the IDE');
	assert.equal(await ide.locator('.monaco-modal-editor-block').count(), 1, 'the unrelated IDE modal remains open');
	assert.deepEqual(errors, []);
	const result = { nativeFileEditor: true, nativeDiffEditor: true, nativeBrowserEditor: true, liveBrowserPage: true, browserNavigation: true, nativeDeviceEmulation: true, separateWindowModals: true, closeIsolated: true, dirtyBufferPreserved: true }; fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { if (app) { await app.close(); } server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); }
