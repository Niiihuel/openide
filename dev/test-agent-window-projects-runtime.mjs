// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-projects-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-project-picker-'));
const output = path.join(root, '.build/agent-window-projects-runtime');
const workspaceA = path.join(tmp, 'project-a');
const workspaceB = path.join(tmp, 'project-b');
for (const directory of [path.join(tmp, 'profile/User'), workspaceA, workspaceB, output]) { fs.mkdirSync(directory, { recursive: true }); }
fs.writeFileSync(path.join(workspaceA, 'original.txt'), 'Keep this editor in the original IDE.\n');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom',
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
const observe = page => {
	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => { if (message.type() === 'error' && !message.text().includes('No default agent registered')) { console.error(message.text()); } });
	page.on('dialog', dialog => void dialog.accept().catch(() => {}));
};
async function installFixture(page, file) {
	await page.evaluate(async ({ base, file }) => {
		const { CommandsRegistry } = await import(base + 'platform/commands/common/commands.js');
		const { IFileDialogService } = await import(base + 'platform/dialogs/common/dialogs.js');
		const { IWorkspaceContextService } = await import(base + 'platform/workspace/common/workspace.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { URI } = await import(base + 'base/common/uri.js');
		CommandsRegistry.registerCommand('test.agentProjectPicker', async accessor => {
			const dialogs = accessor.get(IFileDialogService), context = accessor.get(IWorkspaceContextService), editors = accessor.get(IEditorService);
			let selected, count = 0;
			// Only automate the OS folder picker. UI commands, workspace opening and window lifetimes remain real.
			Object.defineProperty(dialogs, 'showOpenDialog', { configurable: true, value: async options => {
				if (!options.canSelectFolders || options.canSelectFiles || options.canSelectMany) { throw new Error('Expected a single project folder picker'); }
				count++;
				return selected ? [URI.file(selected)] : undefined;
			} });
			if (file) { await editors.openEditor({ resource: URI.file(file), options: { pinned: true } }); }
			window.projectPicker = {
				select: folder => { selected = folder; },
				count: () => count,
				state: () => ({ folder: context.getWorkspace().folders[0]?.uri.fsPath, editor: editors.activeEditor?.resource?.fsPath }),
			};
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, file });
	const native = await app.browserWindow(page);
	await native.evaluate(window => window.webContents.send('vscode:runAction', { id: 'test.agentProjectPicker' }));
	await page.waitForFunction(() => !!window.projectPicker);
}
async function companionExcept(excluded) {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		for (const page of app.windows()) {
			if (!page.isClosed() && !excluded.includes(page) && await page.locator('.openide-agent-window .openide-chat-input-card').count().catch(() => 0)) { return page; }
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error('Destination Agents surface did not become ready');
}
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspaceA, '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	app.on('window', observe);
	const ide = await app.firstWindow(); observe(ide);
	await ide.locator('.part.titlebar .openide-window-switcher').waitFor({ timeout: 90000 });
	await installFixture(ide, path.join(workspaceA, 'original.txt'));
	const original = await ide.evaluate(() => window.projectPicker.state());
	const opened = app.waitForEvent('window');
	await ide.locator('.part.titlebar .openide-window-switcher').click();
	const agent = await opened;
	const projectButton = agent.locator('.openide-chat-empty-workspace');
	await projectButton.waitFor();
	const initialWindows = app.windows().length;
	for (const selection of [null, workspaceA]) {
		await ide.evaluate(folder => window.projectPicker.select(folder), selection);
		const count = await ide.evaluate(() => window.projectPicker.count());
		await projectButton.click();
		await ide.waitForFunction(count => window.projectPicker.count() === count + 1, count);
		assert.equal(app.windows().length, initialWindows, 'cancelling or choosing the current project opens nothing');
		assert.deepEqual(await ide.evaluate(() => window.projectPicker.state()), original);
	}
	await ide.evaluate(folder => window.projectPicker.select(folder), workspaceB);
	const ownerOpened = app.waitForEvent('window');
	const sourceClosed = agent.waitForEvent('close');
	await projectButton.click();
	const destinationOwner = await ownerOpened;
	const destination = await companionExcept([ide, destinationOwner, agent]);
	await sourceClosed;
	const nativeOwner = await app.browserWindow(destinationOwner);
	assert.equal(await nativeOwner.evaluate(window => window.isVisible()), false, 'changing project does not reveal another IDE');
	assert.deepEqual(await ide.evaluate(() => window.projectPicker.state()), original, 'original IDE was not reloaded or repurposed');
	assert.equal((await destination.locator('.openide-chat-empty-workspace-name').textContent())?.trim(), 'project-b');
	assert.deepEqual(await destination.locator('.openide-chat-input-card').evaluate(element => ({
		background: getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)',
		rounded: parseFloat(getComputedStyle(element).borderRadius) > 0,
		styled: element.ownerDocument.styleSheets.length > 0,
	})), { background: true, rounded: true, styled: true });
	await destination.screenshot({ path: path.join(output, 'changed-project.png') });
	await installFixture(destinationOwner);
	await destination.bringToFront();
	const file = destination.locator('.openide-agent-menubar').getByRole('menuitem', { name: 'File', exact: true });
	await file.click();
	// Workbench menus arm their mouse-up handler after 100ms to ignore the opening gesture.
	await destination.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: 'Open project…', exact: true }).click({ delay: 250 });
	await destinationOwner.waitForFunction(() => window.projectPicker.count() === 1);
	assert.equal(destination.isClosed(), false, 'cancelling the File menu picker retains the styled companion');
	await file.click();
	await destination.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: 'Open recent…', exact: true }).click({ delay: 250 });
	const recent = destination.locator('.quick-input-widget:visible');
	await recent.waitFor({ timeout: 10000 }).catch(async error => {
		for (const [index, page] of app.windows().entries()) {
			console.error('Window picker diagnostics', index, await page.evaluate(() => ({ title: document.title, pickers: [...document.querySelectorAll('.quick-input-widget')].map(element => ({ display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility, text: element.textContent })), anchor: document.querySelector('.openide-agent-window-search-anchor')?.getBoundingClientRect().toJSON() })));
			await page.screenshot({ path: path.join(output, `picker-failure-${index}.png`) });
		}
		throw error;
	});
	assert.equal(await destinationOwner.locator('.quick-input-widget:visible').count(), 0, 'recent projects picker belongs to Agents');
	const destinationClosed = destination.waitForEvent('close');
	await recent.locator('.monaco-list-row').filter({ hasText: 'project-a' }).first().click();
	const returned = await companionExcept([ide, destinationOwner, agent, destination]);
	await destinationClosed;
	assert.equal((await returned.locator('.openide-chat-empty-workspace-name').textContent())?.trim(), 'project-a');
	assert.deepEqual(await ide.evaluate(() => window.projectPicker.state()), original, 'returning to an existing project keeps the IDE editor intact');
	assert.equal(await returned.locator('.browser-container').count(), 0, 'project switch does not restore an unrelated browser');
	assert.deepEqual(errors, []);
	console.log('PASS: real project button, cancel/same folder, scoped native handoff, styled destination, File picker, recent projects in Agents, existing IDE preservation, no stray browser.');
} catch (error) {
	if (app) {
		for (const [index, page] of app.windows().entries()) {
			console.error('Project picker state', index, await page.evaluate(() => ({ title: document.title, count: window.projectPicker?.count(), focus: document.activeElement?.outerHTML.slice(0, 200) })).catch(() => ({})));
			await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
		}
	}
	console.error(error); throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
