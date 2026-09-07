#!/usr/bin/env node
// Linux product smoke. Uses a temporary executable selected by its exact path in the dock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-hosted-cli-'));
const workspace = path.join(temporary, 'workspace'), controls = path.join(temporary, 'controls'), binaries = path.join(temporary, 'bin');
const userData = path.join(temporary, 'user-data');
const reportDirectory = path.join(root, '.build/fork-hardening/hosted-cli');
for (const directory of [workspace, controls, binaries, path.join(userData, 'User'), reportDirectory]) { fs.mkdirSync(directory, { recursive: true }); }
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const executable = path.join(binaries, 'codex');
const fixtureLauncher = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'dev/fixtures/hosted-cli.mjs'))} "$@"\n`;
fs.writeFileSync(executable, fixtureLauncher, { mode: 0o755 });
const shell = path.join(binaries, 'fixture-shell');
fs.writeFileSync(shell, '#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false, 'window.titleBarStyle': 'custom' }));
execFileSync('git', ['init', '-q', workspace]);
const results = [], consoleLog = [];
let application, page, failure;
const generations = () => fs.readdirSync(controls).filter(file => file.endsWith('.json') && !file.endsWith('.command.json')).map(file => JSON.parse(fs.readFileSync(path.join(controls, file), 'utf8')));
async function until(predicate, label, milliseconds = 30000) {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) { const result = await predicate(); if (result) { return result; } await new Promise(resolve => setTimeout(resolve, 50)); }
	throw new Error(`Timed out: ${label}`);
}
function beginCommand(generation, action, args = {}) {
	const id = `${Date.now()}-${Math.random()}`;
	const file = path.join(controls, `${generation}.command.json`);
	fs.writeFileSync(`${file}.tmp`, JSON.stringify({ id, action, ...args })); fs.renameSync(`${file}.tmp`, file);
	const completion = action === 'exit' ? Promise.resolve() : until(() => generations().find(candidate => candidate.generation === generation && candidate.commands[id]), action);
	// A UI assertion may fail while a blocking tool is parked; retain artifacts instead of
	// allowing its later timeout to become an unhandled rejection during cleanup.
	void completion.catch(() => {});
	return { id, completion };
}
async function command(generation, action, args = {}) {
	const pending = beginCommand(generation, action, args);
	const state = await pending.completion;
	if (state) { assert.equal(state.commands[pending.id].ok, true, state.commands[pending.id].error); }
	return state;
}
const resultText = state => state.mcp.body.result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');

async function check(name, task) { try { await task(); results.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, passed: false, error: error.stack }); throw error; } }
try {
	console.log('Launching isolated product for hosted CLI fixture');
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE && process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { execFileSync('hyprctl', ['eval', '_G.openide_hosted_cli_fixture_rule = hl.window_rule({ name = "openide-hosted-cli-fixture", match = { class = "(?i)openide.*" }, workspace = "6 silent", no_initial_focus = true, suppress_event = "activate activatefocus" }); _G.openide_hosted_cli_fixture_rule:set_enabled(true)']); }
	application = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, HL_INITIAL_WORKSPACE_TOKEN: '', VSCODE_DEV: '1', PATH: `${binaries}${path.delimiter}${process.env.PATH}`, SHELL: shell, OPENIDE_FIXTURE_DIRECTORY: controls, OPENIDE_FIXTURE_WORKSPACE: workspace }, timeout: 90000 });
	for (const [name, stream] of [['stdout', application.process().stdout], ['stderr', application.process().stderr]]) {
		stream?.on('data', chunk => { consoleLog.push(`[main ${name}] ${String(chunk)}`); fs.writeFileSync(path.join(reportDirectory, 'console.log'), consoleLog.join('\n')); });
	}
	page = await application.firstWindow();
	page.on('requestfailed', request => consoleLog.push(`[request failed] ${request.url()} ${request.failure()?.errorText}`));
	let rejectStartup;
	const startupError = new Promise((_, reject) => { rejectStartup = reject; });
	page.on('console', message => {
		consoleLog.push(`[${message.type()}] ${message.text()}`);
		if (message.text().includes('[uncaught exception]')) { rejectStartup(new Error(message.text())); }
	});
	page.on('pageerror', error => consoleLog.push(error.stack));
	await Promise.race([page.waitForSelector('.monaco-workbench', { timeout: 90000 }), startupError]);
	console.log('Product workbench mounted');
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE && process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { const client = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' })).find(client => client.pid === application.process().pid); assert.equal(client?.workspace?.id, 6, 'Hosted CLI tests must stay on workspace 6'); }
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /New chat/i }).first().waitFor();
	await page.keyboard.press('Enter');
	await page.locator('.openide-chat-head-collapse').first().waitFor();
	if (!await page.locator('.openide-chat-head-split-chevron').first().isVisible()) {
		await page.locator('.openide-chat-head-collapse').first().click();
	}
	await page.waitForSelector('.openide-chat-head-split-chevron', { timeout: 10000 });
	let first, second;
	await check('dock launches the exact fixture executable in a real session PTY', async () => {
		await page.locator('.openide-chat-head-split-chevron').first().click();
		// Refuse to select a real CLI installed on the machine.
		await page.locator('.openide-chat-kind-installed [title]').filter({ hasText: 'Codex' }).first().waitFor();
		const row = page.locator('.openide-chat-kind-installed [title]').filter({ hasText: 'Codex' }).first();
		assert.equal(await row.getAttribute('title'), executable, 'The picker must resolve the isolated fixture, never an installed CLI');
		await row.click();
		first = await until(() => generations()[0], 'fixture startup', 60000);
		assert.equal(first.tty, true); assert.ok(first.sessionId);
		await page.locator('.openide-chat-agent-terminal .xterm').first().waitFor({ state: 'visible' });
	});
	await check('launch-scoped MCP reaches the live product server', async () => {
		const state = await command(first.generation, 'mcp'); assert.equal(state.mcp.status, 200); assert.ok(state.mcp.toolCount > 0);
	});
	await check('capability help and window discovery evidence are available without claiming session identity', async () => {
		const help = JSON.parse(resultText(await command(first.generation, 'mcp', { tool: 'openide_capabilities', arguments: { family: 'memory' } })));
		assert.ok(help.families[0].tools.includes('openide_memory_save'));
		await page.locator('.openide-cli-tools summary').click();
		assert.match(await page.locator('.openide-cli-tools').innerText(), /client listed|cliente consultó/);
		assert.match(await page.locator('.openide-cli-tools summary').innerText(), /not yet verified|sin verificar/);
		await page.locator('.openide-cli-tools summary').click();
	});
	await check('invalid memory write returns MCP isError', async () => {
		const state = await command(first.generation, 'mcp', { tool: 'openide_memory_save', arguments: {} });
		assert.equal(state.mcp.body.result.isError, true);
	});
	await check('hosted PTY receives keyboard input and edits only its disposable workspace', async () => {
		const input = page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').first();
		await input.focus();
		assert.equal(await input.evaluate(element => element === document.activeElement), true, 'The terminal textarea must own keyboard focus after closing help');
		// xterm consumes keydown/keypress; CDP insertText alone can bypass that path in a
		// virtual display. Exercise actual keyboard events instead of IME text injection.
		await input.pressSequentially('fixture-selection', { delay: 20 });
		await until(() => generations()[0].input.includes('fixture-selection'), 'PTY input');
		await command(first.generation, 'write', { content: 'controlled fixture edit\n' });
		assert.equal(fs.readFileSync(path.join(workspace, 'fixture.txt'), 'utf8'), 'controlled fixture edit\n');
	});
	await check('MCP reads the live renderer workspace, open editor and selected text', async () => {
		await page.keyboard.press('Control+KeyP');
		await page.locator('.quick-input-widget input').first().fill(path.join(workspace, 'fixture.txt'));
		await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'fixture.txt' }).first().waitFor();
		await page.keyboard.press('Enter');
		await page.locator('.part.editor .monaco-editor .view-lines').first().click();
		await page.keyboard.press('Control+KeyA');
		const selection = JSON.parse(resultText(await command(first.generation, 'mcp', { tool: 'getCurrentSelection' })));
		assert.equal(selection.success, true); assert.equal(selection.filePath, path.join(workspace, 'fixture.txt'));
		assert.equal(selection.text, 'controlled fixture edit\n');
		const editors = JSON.parse(resultText(await command(first.generation, 'mcp', { tool: 'getOpenEditors' })));
		assert.ok(editors.tabs.some(tab => tab.label === 'fixture.txt' && tab.isActive));
		const folders = JSON.parse(resultText(await command(first.generation, 'mcp', { tool: 'getWorkspaceFolders' })));
		assert.equal(folders.rootPath, workspace); assert.equal(folders.folders.length, 1);
	});
	await check('Add selection to chat delivers the actual editor snippet to the hosted CLI', async () => {
		await page.locator('.part.editor .monaco-editor .view-lines').first().click();
		await page.keyboard.press('Control+KeyA');
		await page.keyboard.press('Control+KeyL');
		await until(() => generations().find(candidate => candidate.generation === first.generation && candidate.input.includes('controlled fixture edit') && candidate.input.includes('fixture.txt')), 'selection delivery');
	});
	await check('external plan approval returns the plan edited on disk through MCP', async () => {
		const pending = beginCommand(first.generation, 'mcp', { tool: 'openide_plan_save', arguments: { title: 'Fixture approval', markdown: '# Fixture approval\n\n## Tareas\n- [ ] Original fixture step' }, timeoutMs: 30000 });
		const approve = page.locator('.notifications-toasts').getByRole('button', { name: /Approve and send back|Aprobar y devolver/, exact: true });
		await approve.waitFor();
		const file = path.join(workspace, '.openide/plans/fixture-approval.md');
		const edited = fs.readFileSync(file, 'utf8').replace('Original fixture step', 'Human reviewed fixture step');
		fs.writeFileSync(file, edited);
		await approve.click();
		const state = await pending.completion;
		assert.equal(state.commands[pending.id].ok, true, state.commands[pending.id].error);
		const output = resultText(state);
		assert.match(output, /^PLAN_APPROVED/); assert.ok(output.includes('Human reviewed fixture step')); assert.ok(!output.includes('Original fixture step'));
	});
	await check('external plan rejection answers the parked MCP call without approval', async () => {
		const pending = beginCommand(first.generation, 'mcp', { tool: 'openide_plan_save', arguments: { title: 'Fixture rejection', markdown: '# Fixture rejection\n\n## Tareas\n- [ ] Do not execute' }, timeoutMs: 30000 });
		await page.locator('.notifications-toasts').getByRole('button', { name: /Discard|Descartar/, exact: true }).click();
		const state = await pending.completion;
		assert.match(resultText(state), /^PLAN_REJECTED/);
	});
	await check('aborting a pending MCP plan request removes its review without approval', async () => {
		const pending = beginCommand(first.generation, 'mcp', { tool: 'openide_plan_save', arguments: { title: 'Fixture cancellation', markdown: '# Fixture cancellation\n\n## Tareas\n- [ ] Cancelled task' }, timeoutMs: 30000 });
		const approve = page.locator('.notifications-toasts').getByRole('button', { name: /Approve and send back|Aprobar y devolver/, exact: true });
		await approve.waitFor();
		await command(first.generation, 'cancel', { requestId: pending.id });
		const state = await pending.completion;
		assert.equal(state.commands[pending.id].ok, false); assert.match(state.commands[pending.id].error, /abort/i);
		await approve.waitFor({ state: 'hidden' });
	});
	await check('resizing the real product window updates the hosted PTY dimensions', async () => {
		const before = generations().find(candidate => candidate.generation === first.generation);
		const bounds = await application.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith('vscode-file:'));
			const original = window.getBounds(); window.setBounds({ width: 1100, height: 650 }); return original;
		});
		await until(() => generations().find(candidate => candidate.generation === first.generation && (candidate.rows !== before.rows || candidate.columns !== before.columns)), 'PTY resize');
		await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith('vscode-file:')).setBounds(bounds), bounds);
	});
	await check('switching to native chat and back preserves the live terminal process', async () => {
		await page.locator('.openide-chat-head-split-chevron').first().click();
		await page.locator('.openide-chat-kind-menu .openide-menu-row').first().click();
		await page.locator('.openide-chat-composer textarea').first().waitFor({ state: 'visible' });
		await page.locator('.openide-chat-tab').filter({ hasText: 'Codex' }).first().click();
		await page.locator('.openide-chat-agent-terminal .xterm').first().waitFor({ state: 'visible' });
		assert.equal(generations().length, 1); assert.equal(generations()[0].pid, first.pid);
	});
	await check('exit presents relaunch and creates a new fixture process', async () => {
		await command(first.generation, 'exit');
		await page.locator('.openide-chat-agent-terminal-relaunch').click();
		second = await until(() => generations().find(candidate => candidate.generation !== first.generation), 'fixture relaunch');
		assert.notEqual(second.pid, first.pid); assert.equal(second.sessionId, first.sessionId);
	});
	await check('CLI startup failure is reported and a retry restores the same session', async () => {
		await command(second.generation, 'exit');
		fs.writeFileSync(executable, '#!/bin/sh\nexit 23\n');
		await page.locator('.openide-chat-agent-terminal-relaunch').click();
		await until(async () => /23/.test(await page.locator('.openide-chat-agent-terminal').innerText()), 'CLI failure banner');
		assert.equal(generations().length, 2, 'Failed launcher must not execute a fallback CLI');
		fs.writeFileSync(executable, fixtureLauncher);
		await page.locator('.openide-chat-agent-terminal-relaunch').click();
		const recovered = await until(() => generations().find(candidate => candidate.generation !== first.generation && candidate.generation !== second.generation), 'startup retry');
		assert.equal(recovered.sessionId, first.sessionId);
		assert.notEqual(recovered.pid, second.pid);
	});
	await page.screenshot({ path: path.join(reportDirectory, 'hosted-cli.png') });
} catch (error) { failure = error; console.error(error); await page?.screenshot({ path: path.join(reportDirectory, 'failure.png') }).catch(() => {}); }
finally {
	await application?.close().catch(() => {});
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE && process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { try { execFileSync('hyprctl', ['eval', 'if _G.openide_hosted_cli_fixture_rule then _G.openide_hosted_cli_fixture_rule:set_enabled(false) end']); } catch { /* compositor may have exited */ } }
	fs.writeFileSync(path.join(reportDirectory, 'console.log'), consoleLog.join('\n'));
	fs.writeFileSync(path.join(reportDirectory, 'fixture-generations.json'), JSON.stringify(generations(), null, 2));
	fs.writeFileSync(path.join(reportDirectory, 'results.json'), JSON.stringify({ platform: process.platform, isolation: process.env.OPENIDE_TEST_VIRTUAL_DISPLAY === '1' ? 'Xvfb' : 'workspace6', results, failure: failure?.stack, limitations: 'Local Codex-shaped fixture only. Does not prove third-party CLI compatibility, real Claude hooks or rollback behavior.' }, null, 2) + '\n');
	fs.rmSync(temporary, { recursive: true, force: true });
	process.exitCode = failure ? 1 : 0;
}
