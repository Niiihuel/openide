// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-statusbar-layout-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-statusbar-'));
const output = path.join(root, '.build/statusbar-layout-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom',
	'workbench.experimental.modernUI': true, 'window.density.layout': 'default',
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
const measure = page => page.evaluate(() => {
	const root = document.querySelector('.monaco-workbench');
	const status = document.querySelector('.part.statusbar');
	const rect = status.getBoundingClientRect();
	const regions = [...document.querySelectorAll('.part.editor, .part.sidebar, .part.panel, .part.auxiliarybar, .openide-agent-island')]
		.filter(e => e.getBoundingClientRect().height && e.getBoundingClientRect().width);
	return { height: rect.height, bottom: rect.bottom, viewport: innerHeight,
		floating: root.classList.contains('floating-panels'),
		gap: rect.top - Math.max(...regions.map(e => e.getBoundingClientRect().bottom)),
		itemsWithinRail: [...status.querySelectorAll('.statusbar-item-label')].every(e => {
			const r = e.getBoundingClientRect(); return !r.height || (r.top >= rect.top && r.bottom <= rect.bottom + 1);
		}),
	};
});
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow();
	ide.on('pageerror', e => errors.push(e.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.setViewportSize({ width: 1400, height: 900 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IConfigurationService, ConfigurationTarget } = await import(base + 'platform/configuration/common/configuration.js');
		const { IWorkbenchLayoutService, Parts } = await import(base + 'workbench/services/layout/browser/layoutService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.statusbarLayout', title: 'Statusbar Layout Fixture', f1: true }); }
			run(accessor) {
				const commands = accessor.get(ICommandService), config = accessor.get(IConfigurationService), layout = accessor.get(IWorkbenchLayoutService);
				window.statusbarFixture = {
					configure: (key, value) => config.updateValue(key, value, ConfigurationTarget.USER),
					panel: hidden => layout.setPartHidden(hidden, Parts.PANEL_PART),
					openAgent: () => commands.executeCommand('openide.agent.openAgentWindow'),
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Statusbar Layout Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Statusbar Layout Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.statusbarFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.statusbarFixture.openAgent());
	const agent = await opened;
	agent.on('pageerror', e => errors.push(e.message));
	await agent.waitForSelector('.openide-agent-window');
	const agentBefore = await measure(agent);
	const results = [];
	for (const [modern, density, panel] of [[true, 'default', false], [true, 'compact', false], [true, 'compact', true], [false, 'default', true], [true, 'default', false]]) {
		await ide.evaluate(async ({ modern, density, panel }) => {
			await window.statusbarFixture.configure('workbench.experimental.modernUI', modern);
			await window.statusbarFixture.configure('window.density.layout', density);
			window.statusbarFixture.panel(!panel);
		}, { modern, density, panel });
		// OpenIDE deliberately retains floating panels and its established density in every appearance mode.
		await ide.waitForSelector('.monaco-workbench.floating-panels');
		await ide.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const result = await measure(ide);
		assert.equal(result.height, agentBefore.height, 'Main and agent rails use the same native height');
		assert.equal(result.bottom, result.viewport, 'No unused space below the rail');
		assert.equal(result.itemsWithinRail, true, 'Status controls stay inside their hit area');
		assert.ok(Math.abs(result.gap - 4) <= 1, JSON.stringify(result));
		results.push({ modern, density, panel, ...result });
	}
	await ide.evaluate(() => window.statusbarFixture.configure('workbench.statusBar.visible', false));
	await ide.waitForSelector('.monaco-workbench.nostatusbar');
	await ide.setViewportSize({ width: 1000, height: 700 });
	await ide.evaluate(() => window.statusbarFixture.configure('workbench.statusBar.visible', true));
	await ide.waitForSelector('.monaco-workbench:not(.nostatusbar)');
	const resized = await measure(ide);
	assert.equal(resized.bottom, resized.viewport);
	assert.ok(resized.viewport < results[0].viewport);
	assert.equal((await measure(agent)).height, agentBefore.height, 'Agent height is unchanged');
	await ide.screenshot({ path: path.join(output, 'ide-bottom.png') });
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ agentBefore, results, hiddenAndResized: true }, null, 2));
	console.log('PASS: shared statusbar height, appearance settings, panel, hidden and resized windows.');
} finally { if (app) { await app.close(); } fs.rmSync(tmp, { recursive: true, force: true }); }
