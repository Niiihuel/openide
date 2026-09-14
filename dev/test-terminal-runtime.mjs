#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
// Native harness -> controlled provider -> real git_status/background PTYs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-terminal-runtime-'));
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'user-data');
const reports = path.join(root, '.build/terminal-runtime');
for (const dir of [workspace, path.join(userData, 'User'), reports]) { fs.mkdirSync(dir, { recursive: true }); }
const errors = []; const logs = []; let page; let app;
let phase = 'git'; const results = [];
execFileSync('git', ['init', '-q', workspace]);
function reply(response, call, content = '') {
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	const delta = call ? { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content };
	response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
	response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 60 } })}\n\n`);
	response.end('data: [DONE]\n\n');
}
const server = http.createServer(async (request, response) => {
	try {
		if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] })); return; }
		let body = ''; for await (const chunk of request) { body += chunk; }
		const input = JSON.parse(body);
		const prompt = JSON.stringify(input.messages?.findLast(item => item.role === 'user'));
		if (!prompt?.includes('TERMINAL_RUNTIME')) { reply(response, undefined, 'Terminal fixture'); return; }
		const id = `terminal-${phase}`;
		const result = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === id);
		if (result) {
			assert.ok(!/Error executing|identity was not confirmed/.test(result.content), result.content);
			if (phase === 'git') assert.match(result.content, /branch|rama|repo/i);
			else assert.match(result.content, /Started in the background/);
			results.push({ phase, output: result.content }); reply(response, undefined, `TERMINAL_${phase}_CONFIRMED`);
		} else {
			reply(response, { id, name: phase === 'git' ? 'git_status' : 'run_command', args: phase === 'git' ? {} : { command: 'node server.cjs', background: true } });
		}
	} catch (error) { errors.push(error.stack); if (!response.headersSent) { response.writeHead(500); } response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.title': 'OpenIDE Terminal Tests', 'files.autoSave': 'off',
	'openide.memory.captureMode': 'off',
	'openide.agent.customProviders': [{ id: 'terminal-fixture', label: 'Terminal Fixture', protocol: 'openai', auth: 'none', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'fixture-model' }],
	'openide.agent.provider': 'terminal-fixture', 'openide.agent.model': 'fixture-model', 'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
}, null, 2));
async function launch() {
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1' && !process.env.HYPRLAND_INSTANCE_SIGNATURE) { throw new Error('Workspace 6 cannot be verified'); }
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') execFileSync('hyprctl', ['eval', 'if _G.openide_terminal_fixture_rule then _G.openide_terminal_fixture_rule:set_enabled(false) end; _G.openide_terminal_fixture_rule = hl.window_rule({ name = "openide-terminal-fixture", match = { class = "(?i)openide.*" }, workspace = "6 silent", no_initial_focus = true, suppress_event = "activate activatefocus" }); _G.openide_terminal_fixture_rule:set_enabled(true)']);
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11', '--class=openide-terminal-test'], env: { ...process.env, HL_INITIAL_WORKSPACE_TOKEN: '', VSCODE_DEV: '1' }, timeout: 90000 });
	for (const [name, stream] of [['stdout', app.process().stdout], ['stderr', app.process().stderr]]) { stream?.on('data', chunk => logs.push(`[main ${name}] ${String(chunk)}`)); }
	page = await app.firstWindow(); page.on('console', message => logs.push(message.text())); page.on('pageerror', error => logs.push(error.stack));
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
		const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }));
		const window = clients.find(client => client.pid === app.process().pid);
		assert.equal(window?.workspace.id, 6, 'Test window must stay on workspace 6');
	}
	await page.keyboard.press('Control+Shift+KeyP'); await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /New chat/i }).first().waitFor(); await page.keyboard.press('Enter');
	await page.locator('.openide-chat-composer textarea').first().waitFor();
}
async function submit(prompt, marker) {
	const input = page.locator('.openide-chat-composer textarea').first(); await input.fill(prompt); await input.press('Enter');
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (errors.length) { throw new Error(errors.join('\n')); }
		const allow = page.getByRole('button', { name: 'Allow', exact: true });
		if (phase === 'background' && await allow.count()) { await allow.click(); }
		if ((await page.locator('.openide-chat-native').innerText()).includes(marker) && !await page.locator('.openide-composer-send.running').count()) { return; }
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	throw new Error(`Timed out waiting for ${marker}: ${await page.locator('.openide-chat-native').innerText()}`);
}

try {
	fs.writeFileSync(path.join(workspace, 'server.cjs'), "require('node:fs').writeFileSync('server.pid', String(process.pid)); console.log('BACKGROUND_RUNNING'); setInterval(() => {}, 1000);\n");
	await launch();
	await submit('TERMINAL_RUNTIME: inspect Git status', 'TERMINAL_git_CONFIRMED');
	console.log('PASS native harness git_status');
	phase = 'background';
	await submit('TERMINAL_RUNTIME: launch the fixture background server', 'TERMINAL_background_CONFIRMED');
	const pidFile = path.join(workspace, 'server.pid');
	const deadline = Date.now() + 10000;
	while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
	assert.ok(fs.existsSync(pidFile), 'The real background process must execute');
	const pid = Number(fs.readFileSync(pidFile, 'utf8'));
	await app.close(); app = undefined;
	let alive = true;
	for (let attempt = 0; attempt < 100 && alive; attempt++) {
		try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 50)); } catch (error) { if (error.code !== 'ESRCH') throw error; alive = false; }
	}
	assert.equal(alive, false, 'Closing the owner must stop its background process');
	console.log('PASS native harness background execution and shutdown');
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
} catch (error) {
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: false, error: error.stack, errors }, null, 2));
	throw error;
} finally {
	fs.writeFileSync(path.join(reports, 'console.log'), logs.join('\n'));
	if (app) await app.close();
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(temporary, { recursive: true, force: true });
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) execFileSync('hyprctl', ['eval', 'if _G.openide_terminal_fixture_rule then _G.openide_terminal_fixture_rule:set_enabled(false) end']);
}
