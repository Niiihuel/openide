// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-project-map-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-project-map-'));
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace', 'example.ts'), 'export const answer = 42;\n');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'window.menuStyle': 'custom',
	'openide.memory.captureMode': 'off',
}));
const errors = [];
let app;
let agent;
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.stack || error.message));
	ide.on('console', message => { if (message.type() === 'error') { errors.push(`IDE: ${message.text()}`); } });
	const opened = app.waitForEvent('window', { timeout: 30000 });
	await ide.locator('.part.titlebar .openide-window-switcher').click();
	agent = await opened;
	agent.on('pageerror', error => errors.push(error.stack || error.message));
	agent.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); } });
	await agent.locator('.openide-agent-window .openide-chat-input-card').waitFor({ timeout: 30000 });
	await agent.locator('.openide-agent-window-header button[aria-label="More Actions"]').click().catch(async () => {
		await agent.locator('.openide-agent-window-header .codicon-ellipsis').click();
	});
	await agent.getByText('Project Map', { exact: true }).last().click();
	await agent.locator('.openide-pmap').waitFor({ timeout: 12000 });
	assert.equal(await agent.getByText('The editor could not be opened due to an unexpected error.').count(), 0);
	assert.equal(await ide.locator('.openide-pmap').count(), 0, 'Project Map belongs to the Agents window');
	console.log('PASS: Project Map opens in Agents window.');
} catch (error) {
	console.error(error, errors);
	if (app) { for (const page of app.windows()) { console.error('Captured editor error:', await page.evaluate(() => globalThis.__openideLastEditorError).catch(() => undefined)); } }
	if (agent) {
		console.error('Agents window:', (await agent.locator('body').innerText().catch(() => '')).slice(-3500));
		console.error('Editor errors:', await agent.locator('.editor-instance,.editor-error').allTextContents().catch(() => []));
	}
	const logFiles = fs.readdirSync(tmp, { recursive: true }).filter(name => typeof name === 'string' && name.endsWith('.log'));
	for (const file of logFiles) {
		const content = fs.readFileSync(path.join(tmp, file), 'utf8');
		if (/project.?map|unexpected|typeerror|error/i.test(content)) { console.error('Log', file, content.slice(-5000)); }
	}
	throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
