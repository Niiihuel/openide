// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-browser-offline-runtime.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-browser-offline-'));
const output = path.join(root, '.build/browser-offline-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'openide.memory.captureMode': 'off' }));
const server = http.createServer((_request, response) => {
	response.writeHead(200, { 'content-type': 'text/html' });
	response.end('<!doctype html><title>Offline recovery fixture</title><h1>Live preview</h1>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
await new Promise(resolve => server.close(resolve));
let app;
async function launch() {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	app.context().on('dialog', dialog => { if (dialog.type() !== 'beforeunload') { void dialog.dismiss(); } });
	const page = await app.firstWindow();
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	return page;
}
async function install(page) {
	await page.evaluate(async ({ base, url }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { IAuxiliaryWindowService } = await import(base + 'workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { OpenideAgentWindowEditors } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentWindowEditors.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.browserOffline', title: 'Browser Offline Fixture', f1: true }); }
			async run(accessor) {
				const editors = accessor.get(IEditorService), browser = accessor.get(IBrowserViewWorkbenchService);
				const windows = accessor.get(IAuxiliaryWindowService), instantiation = accessor.get(IInstantiationService);
				window.browserOfflineFixture = {
					state: () => {
						const model = browser.getOrCreatePreview().model;
						return { error: model?.error, loading: model?.loading, visible: model?.visible, url: model?.url, title: model?.title };
					},
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
				window.browserOfflineFixture.open = () => editors.openEditor(browser.getOrCreatePreview(url), { pinned: true });
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, url });
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill('>Browser Offline Fixture');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Browser Offline Fixture' }).first().waitFor();
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => !!window.browserOfflineFixture);
}
async function offline(page, name) {
	const error = page.locator('.browser-error-container');
	await error.waitFor({ state: 'visible', timeout: 15000 });
	assert.match(await error.innerText(), /Nothing is listening on port/);
	await page.screenshot({ path: path.join(output, name + '.png') });
}
try {
	let ide = await launch();
	await install(ide);
	await ide.evaluate(() => window.browserOfflineFixture.open());
	await offline(ide, 'new-tab');
	await app.close(); app = undefined;
	ide = await launch();
	// Do not navigate/reload: the error must appear from the restored tab itself.
	await offline(ide, 'restored-tab');
	await install(ide);
	const state = await ide.evaluate(() => window.browserOfflineFixture.state());
	assert.equal(state.error?.errorCode, -102);
	assert.equal(state.visible, false, 'The Chromium error surface cannot cover the IDE error state');
	await ide.locator('.browser-error-retry').click();
	await offline(ide, 'retry');
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.browserOfflineFixture.openAgent());
	const agent = await opened;
	await offline(agent, 'agent-tab');
	await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
	await agent.waitForFunction(() => {
		const error = document.querySelector('.browser-error-container');
		return error && getComputedStyle(error).display === 'none';
	}, undefined, { timeout: 20000 });
	await ide.waitForFunction(() => {
		const state = window.browserOfflineFixture.state();
		return !state.error && !state.loading && state.title === 'Offline recovery fixture';
	}, undefined, { timeout: 20000 });
	await agent.screenshot({ path: path.join(output, 'recovered.png') });
	console.log('PASS: restored localhost failures, retry, agent dock and automatic recovery when the server starts.');
} finally {
	if (app) { await app.close(); }
	server.closeAllConnections();
	if (server.listening) { await new Promise(resolve => server.close(resolve)); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
