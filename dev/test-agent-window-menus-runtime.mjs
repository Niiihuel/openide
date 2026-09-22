// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-menus-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') {
	throw new Error('Use dev/run-virtual-gui.mjs');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-menus-'));
const output = path.join(root, '.build/agent-window-menus-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'), { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'window.menuStyle': 'custom',
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
const runtimeErrors = [];
let app;
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	ide.on('dialog', dialog => void dialog.accept().catch(() => {}));
	ide.on('pageerror', error => runtimeErrors.push(error.message));
	await ide.locator('.part.titlebar .openide-window-switcher').waitFor({ timeout: 90000 });
	const opened = app.waitForEvent('window', { timeout: 30000 });
	await ide.locator('.part.titlebar .openide-window-switcher').click();
	const agent = await opened;
	agent.on('dialog', dialog => void dialog.accept().catch(() => {}));
	agent.on('pageerror', error => runtimeErrors.push(error.message));
	await agent.locator('.openide-agent-window .openide-chat-input-card').waitFor();
	await agent.bringToFront();
	const menus = agent.locator('.openide-agent-menubar');
	const popup = agent.locator('.monaco-menu-container:visible');
	for (const [label, item] of [['File', 'New chat'], ['View', 'Terminal'], ['Help', 'Settings']]) {
		const button = menus.getByRole('menuitem', { name: label, exact: true });
		assert.equal(await button.evaluate(element => {
			const bounds = element.getBoundingClientRect();
			return element.contains(element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
		}), true, `${label} receives pointer input above the window drag region`);
		await button.click({ timeout: 5000 });
		await popup.getByRole('menuitem', { name: item, exact: true }).waitFor({ timeout: 5000 });
		assert.equal(await button.getAttribute('aria-expanded'), 'true');
		assert.equal(await ide.locator('.monaco-menu-container:visible').count(), 0, 'menu belongs to the Agents window');
		await agent.screenshot({ path: path.join(output, `${label.toLowerCase()}.png`) });
		await agent.keyboard.press('Escape');
		await popup.waitFor({ state: 'hidden' });
		assert.equal(await button.getAttribute('aria-expanded'), 'false');
		assert.equal(await button.evaluate(element => element === element.ownerDocument.activeElement), true, 'Escape returns keyboard focus to its menu button');
	}
	const view = menus.getByRole('menuitem', { name: 'View', exact: true });
	await view.focus();
	await agent.keyboard.press('Enter');
	await popup.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
	await agent.locator('#openide-agent-window-terminal:not([hidden]) .xterm').waitFor();
	assert.equal(await view.getAttribute('aria-expanded'), 'false');
	assert.equal(await ide.locator('#openide-agent-window-terminal').count(), 0);
	const help = menus.getByRole('menuitem', { name: 'Help', exact: true });
	await help.focus();
	await agent.keyboard.press('Space');
	await popup.getByRole('menuitem', { name: 'Settings', exact: true }).click();
	await agent.locator('.openide-settings').waitFor();
	assert.equal(await ide.locator('.openide-settings:visible').count(), 0, 'menu action opens Settings in the Agents window');
	assert.deepEqual(runtimeErrors, [], 'menus must not report renderer errors');
	console.log('PASS: File/View/Help pointer hit targets, auxiliary popovers, Escape focus, keyboard activation, and Terminal/Settings action routing.');
} catch (error) {
	console.error(error);
	throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
