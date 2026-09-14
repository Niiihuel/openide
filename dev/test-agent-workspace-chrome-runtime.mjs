// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-workspace-chrome-runtime.mjs
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
const output = path.join(root, '.build/agent-workspace-chrome-runtime');
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

	await agent.setViewportSize({ width: 1440, height: 900 });
	await agent.locator('.openide-chat-input-card textarea:visible').waitFor();
	await agent.getByRole('button', { name: 'Toggle workspace panel', exact: true }).click();
	const workspace = agent.locator('.openide-agent-window-workspace');
	const launcher = workspace.locator('.openide-agent-window-editor-empty');
	await launcher.waitFor();
	assert.equal(await launcher.locator('.openide-empty-state-heading').isVisible(), false);
	assert.equal(await launcher.locator('.openide-empty-state-keybinding:not([hidden])').count(), 3);
	assert.equal(await launcher.locator('.openide-empty-state-action').count(), 3);
	await agent.screenshot({ path: path.join(output, 'workspace-empty.png') });
	await launcher.getByRole('button', { name: 'Browser', exact: true }).click();
	await workspace.locator('.browser-welcome-container .openide-empty-state').waitFor();
	const chrome = workspace.locator('.editor-actions .openide-agent-window-workspace-header');
	await chrome.waitFor();
	const aligned = () => workspace.evaluate(element => {
		const tab = element.querySelector('.tabs-container .tab')?.getBoundingClientRect();
		const controls = element.querySelector('.editor-actions .openide-agent-window-workspace-header')?.getBoundingClientRect();
		return !!tab && !!controls && Math.abs(tab.top + tab.height / 2 - controls.top - controls.height / 2) <= 4 && tab.right <= controls.left;
	});
	assert.equal(await aligned(), true, 'native tabs and panel actions share one row without overlap');
	assert.equal(await workspace.locator('.openide-agent-window-workspace-label').count(), 0, 'no duplicate panel title');
	assert.equal(await workspace.locator('.browser-welcome-container .openide-empty-state-icon').evaluate(element => getComputedStyle(element).fontSize), '32px', 'empty icon retains its semantic size');
	await agent.screenshot({ path: path.join(output, 'workspace-browser.png') });
	await workspace.locator('.tabs-bar-add-tab').getByRole('button').click();
	const menuIcons = await agent.locator('.monaco-menu').getByRole('menuitem').evaluateAll(items => items.map(item => {
		const icon = item.querySelector('.action-label.codicon');
		return icon && { content: getComputedStyle(icon, '::before').content, font: getComputedStyle(icon, '::before').fontFamily, labelFont: getComputedStyle(icon).fontFamily };
	}));
	assert.equal(menuIcons.length, 3);
	assert.ok(menuIcons.every(icon => icon && !icon.labelFont.includes('codicon')), 'icons never replace the text font');
	assert.ok(menuIcons.every(icon => icon && !['none', 'normal', '""'].includes(icon.content)), JSON.stringify(menuIcons));
	await agent.screenshot({ path: path.join(output, 'workspace-add-menu.png') });
	await agent.getByRole('menuitem', { name: /^Review changes/ }).click();
	await workspace.getByRole('heading', { name: 'No changes to review', exact: true }).waitFor();
	assert.equal(await workspace.locator('.tabs-container .tab').count(), 2);
	assert.equal(await aligned(), true);
	await agent.screenshot({ path: path.join(output, 'workspace-review.png') });
	await workspace.locator('.tabs-bar-add-tab').getByRole('button').click();
	assert.equal(await agent.locator('.monaco-menu').getByRole('menuitem', { name: /^Terminal/ }).count(), 0);
	await agent.getByRole('menuitem', { name: /^Files/ }).click();
	const filesPane = workspace.locator('.openide-files-editor');
	await filesPane.waitFor();
	assert.equal(await workspace.locator('.tabs-container .tab').count(), 3, 'Files joins Browser and Changes');
	await agent.keyboard.press('Control+Shift+KeyE');
	assert.equal(await workspace.locator('.tabs-container .tab').count(), 3, 'Files shortcut reuses its tab');
	const tree = agent.getByRole('tree', { name: 'Files', exact: true });
	await tree.getByText('src', { exact: true }).click();
	await tree.getByText('file.ts', { exact: true }).click();
	await workspace.locator('.view-lines').filter({ hasText: 'preservedFilesTab' }).waitFor();
	assert.equal(await workspace.locator('.tabs-container .tab').count(), 4, 'opening a file preserves the Files tab');
	await workspace.locator('.tabs-container .tab').filter({ hasText: /^Files/ }).click();
	await tree.getByText('file.ts', { exact: true }).waitFor();
	fs.writeFileSync(path.join(tmp, 'workspace/src/added.ts'), 'export const added = true;');
	await filesPane.getByRole('button', { name: 'Refresh', exact: true }).click();
	await tree.getByText('added.ts', { exact: true }).waitFor();
	assert.equal(await workspace.locator('.tabs-container .tab').count(), 4);
	await agent.screenshot({ path: path.join(output, 'workspace-files-tabs.png') });
	await chrome.getByRole('button', { name: 'Open in modal', exact: true }).click();
	await agent.locator('.monaco-modal-editor-block:not(.embedded-editor)').waitFor();
	await agent.locator('.monaco-modal-editor-block:not(.embedded-editor) .openide-files-editor').waitFor();
	await workspace.locator('.openide-agent-window-workspace-header-home .openide-agent-window-workspace-header').waitFor();
	await agent.locator('.openide-return-to-workspace').click();
	await chrome.waitFor();
	assert.equal(await aligned(), true, 'redocking restores integrated toolbar');
	await chrome.getByRole('button', { name: 'Minimize to environment', exact: true }).click();
	await workspace.waitFor({ state: 'hidden' });
	await agent.getByRole('button', { name: 'Toggle workspace panel', exact: true }).click();
	await chrome.waitFor();
	await agent.setViewportSize({ width: 800, height: 760 });
	assert.equal(await chrome.evaluate(element => { const box = element.getBoundingClientRect(); return box.right <= innerWidth && box.width > 0; }), true);
	await agent.screenshot({ path: path.join(output, 'workspace-narrow.png') });
	await agent.setViewportSize({ width: 1440, height: 900 });
	for (let i = 0; i < 4; i++) {
		await workspace.locator('.tabs-container .tab.active').hover();
		await workspace.locator('.tabs-container .tab.active .monaco-action-bar .action-label').first().click();
	}
	await launcher.waitFor();
	await workspace.locator('.openide-agent-window-workspace-header-home .openide-agent-window-workspace-header').waitFor();
	assert.equal(await launcher.locator('.openide-empty-state-action').count(), 3, 'closing last tab restores launcher and controls');
	await ide.evaluate(() => window.chatWelcomeFixture.dispose());
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, nativeTabs: true, filesTab: true, filesReuse: true, terminalExcludedFromTabs: true, integratedControls: true, emptyLauncher: true, browserEmpty: true, reviewEmpty: true, modalDock: true, narrow: true, closeLastTab: true }, null, 2));
	console.log('Workspace chrome and shared empty states passed.');
} catch (error) {
	if (app) { for (const [index, page] of app.windows().entries()) { await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {}); } }
	throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
