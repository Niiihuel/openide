// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-browser-menu-runtime.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-browser-menu-'));
const output = path.join(root, '.build/browser-menu-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'openide.memory.captureMode': 'off' }));
const server = http.createServer((_request, response) => {
	response.writeHead(200, { 'content-type': 'text/html' });
	response.end('<!doctype html><title>Browser menu fixture</title><h1>Live preview</h1>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({ base, url }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { IConfigurationService } = await import(base + 'platform/configuration/common/configuration.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { IAuxiliaryWindowService } = await import(base + 'workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { OpenideAgentWindowEditors } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowEditors.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.browserMenus', title: 'Browser Menus Fixture', f1: true }); }
			async run(accessor) {
				const editors = accessor.get(IEditorService), browser = accessor.get(IBrowserViewWorkbenchService);
				const configuration = accessor.get(IConfigurationService), windows = accessor.get(IAuxiliaryWindowService), instantiation = accessor.get(IInstantiationService);
				window.browserMenuFixture = {
					theme: name => configuration.updateValue('workbench.colorTheme', name),
					zoom: () => browser.getOrCreatePreview().model?.zoomFactor,
					openAgent: async () => {
						const auxiliary = await windows.open({ bounds: { width: 1000, height: 750 }, nativeTitlebar: true });
						await auxiliary.whenStylesHaveLoaded;
						const host = instantiation.createInstance(OpenideAgentWindowEditors, auxiliary.window.vscodeWindowId);
						auxiliary.onUnload(() => host.dispose());
						const dock = document.createElement('div');
						dock.style.cssText = 'position:absolute;top:45px;bottom:20px;right:12px;width:700px';
						auxiliary.container.appendChild(dock);
						host.configureDock(dock, () => {});
						await host.openEditor(browser.getOrCreatePreview(url + 'agent'), { pinned: true });
					},
				};
				await editors.openEditor(browser.getOrCreatePreview(url), { pinned: true });
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, url });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Browser Menus Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Browser Menus Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.locator('.browser-container').waitFor();

	async function checkMenu(page, name) {
		await page.bringToFront();
		const button = page.locator('.browser-actions-toolbar .codicon-toolbar-more');
		await button.click();
		const menu = page.locator('.context-view .monaco-menu');
		await menu.waitFor();
		// Wait for the native opening transition before measuring the final placement.
		await page.waitForTimeout(250);
		const rows = menu.locator('[role="menuitem"], [role="menuitemcheckbox"]');
		const labels = await rows.allTextContents();
		assert(labels.length > 2 && labels.every(label => label.trim().length), `${name}: every menu action has a readable label`);
		const anchor = await button.boundingBox(), box = await menu.boundingBox();
		assert(box.x > 100 && box.y >= anchor.y && Math.abs(box.x + box.width - anchor.x - anchor.width) < box.width, `${name}: menu opens beside More Actions: ${JSON.stringify({ anchor, box })}`);
		assert.equal(await menu.locator('.menu-entry').count(), 0, 'overflow contains menu rows, not toolbar buttons');
		await page.keyboard.press('ArrowDown');
		assert(await rows.evaluateAll(items => items.some(item => item === item.ownerDocument.activeElement || item.getRootNode().activeElement === item)), `${name}: keyboard can focus a menu action`);
		await page.screenshot({ path: path.join(output, `${name}.png`) });
		await page.keyboard.press('Escape');
		await menu.waitFor({ state: 'hidden' });
		// Reopen via keyboard to verify dismissal did not leave a broken dropdown state.
		await button.focus();
		await page.keyboard.press('Enter');
		await menu.waitFor();
		const before = await ide.evaluate(() => window.browserMenuFixture.zoom());
		await menu.getByRole('menuitem', { name: /^Zoom In/ }).click();
		await menu.waitFor({ state: 'hidden' });
		await ide.waitForFunction(previous => window.browserMenuFixture.zoom() > previous, before);
		await button.click();
		await menu.getByRole('menuitem', { name: /^Reset Zoom/ }).click();
		await menu.waitFor({ state: 'hidden' });
	}

	await checkMenu(ide, 'ide-dark');
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.browserMenuFixture.openAgent());
	const agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));
	await agent.locator('.browser-container').waitFor();
	await checkMenu(agent, 'agent-dark');
	await ide.evaluate(() => window.browserMenuFixture.theme('OpenIDE Light'));
	await agent.locator('.monaco-workbench.vs').waitFor();
	await checkMenu(agent, 'agent-light');
	assert.deepEqual(errors, []);
	console.log('PASS: browser overflow labels, anchor, keyboard navigation, Escape, reopen and native zoom action in IDE and agent dock, dark/light themes.');
} finally {
	if (app) { await app.close(); }
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(tmp, { recursive: true, force: true });
}
