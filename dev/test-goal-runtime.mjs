#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real GOAL UI -> native harness -> controlled provider -> verifier, Markdown and captured diffs.
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-goal-runtime-'));
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'user-data');
const reports = path.join(root, '.build/goal-runtime');
for (const dir of [workspace, path.join(userData, 'User'), reports]) { fs.mkdirSync(dir, { recursive: true }); }
const errors = []; const logs = []; let page; let app;
let hold = true; let requests = 0; let goalRequests = 0; let releasedTurns = 0; const results = [];
const completedText = 'GOAL_RUNTIME verified artifact\n';
const verification = `node -e "process.exit(require('node:fs').existsSync('goal-result.txt') && require('node:fs').readFileSync('goal-result.txt','utf8') === 'GOAL_RUNTIME verified artifact\\n' ? 0 : 1)"`;
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
		if (!prompt?.includes('GOAL_RUNTIME')) { reply(response, undefined, 'Goal fixture'); return; }
		requests++;
		assert.ok(JSON.stringify(input.messages).includes('OPENIDE GOAL'), 'The native request must carry goal context');
		goalRequests++;
		if (hold) { return; }
		if (releasedTurns++ === 0) {
			reply(response, undefined, 'GOAL_RUNTIME: I claim the goal is already finished.'); return;
		}
		const written = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === 'goal-write');
		const reported = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === 'goal-report');
		if (!written) { reply(response, { id: 'goal-write', name: 'write_file', args: { path: 'goal-result.txt', content: completedText } }); }
		else if (!reported) {
			assert.match(written.content, /^OK:/);
			reply(response, { id: 'goal-report', name: 'goal_report', args: { text: 'GOAL_RUNTIME artifact written; waiting for independent host verification.' } });
		} else {
			assert.match(reported.content, /Goal report saved/);
			reply(response, undefined, 'GOAL_RUNTIME: artifact written; the configured check must verify completion.');
		}
	} catch (error) { errors.push(error.stack); if (!response.headersSent) { response.writeHead(500); } response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.title': 'OpenIDE Goal Tests', 'files.autoSave': 'off',
	'openide.memory.captureMode': 'off',
	'openide.agent.customProviders': [{ id: 'goal-fixture', label: 'Goal Fixture', protocol: 'openai', auth: 'none', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'fixture-model' }],
	'openide.agent.provider': 'goal-fixture', 'openide.agent.model': 'fixture-model', 'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
}, null, 2));
async function launch() {
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1' && !process.env.HYPRLAND_INSTANCE_SIGNATURE) { throw new Error('Workspace 6 cannot be verified'); }
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') execFileSync('hyprctl', ['eval', 'if _G.openide_goal_fixture_rule then _G.openide_goal_fixture_rule:set_enabled(false) end; _G.openide_goal_fixture_rule = hl.window_rule({ name = "openide-goal-fixture", match = { class = "(?i)openide.*" }, workspace = "6 silent", no_initial_focus = true, suppress_event = "activate activatefocus" }); _G.openide_goal_fixture_rule:set_enabled(true)']);
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11', '--class=openide-goal-test'], env: { ...process.env, HL_INITIAL_WORKSPACE_TOKEN: '', VSCODE_DEV: '1' }, timeout: 90000 });
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

const tray = () => page.locator('.openide-chat-goal-tray').first();
const reportPath = () => {
	const directory = path.join(workspace, '.openide/goals');
	if (!fs.existsSync(directory)) return undefined;
	const id = fs.readdirSync(directory)[0];
	return id ? path.join(directory, id, 'REPORT.md') : undefined;
};
const report = () => { const file = reportPath(); return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; };
async function until(predicate, label, milliseconds = 90000) {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) {
		if (errors.length) throw new Error(errors.join('\n'));
		const value = await predicate(); if (value) return value;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out: ${label}\n${report()}\n${await page.locator('.monaco-workbench').innerText()}`);
}
async function quickInput(value, title) {
	await page.locator('.quick-input-widget').filter({ hasText: title }).waitFor({ state: 'visible' });
	await page.locator('.quick-input-widget input').first().fill(value);
	await page.keyboard.press('Enter');
}
try {
	await launch();
	const input = page.locator('.openide-chat-composer textarea').first();
	await input.fill('/goal GOAL_RUNTIME Create an artifact and verify its exact content');
	await input.press('Enter');
	await quickInput('GOAL_RUNTIME Create an artifact and verify its exact content', 'Create Goal');
	await quickInput(`Artifact matches expected text :: ${verification}`, 'Completion Criteria');
	await quickInput('5', 'Maximum Turns');
	await until(() => goalRequests > 0, 'goal request reaches controlled provider');
	await tray().locator('[data-goal-action="toggle"]').click();
	await tray().locator('[data-goal-action="pause"]').click();
	await until(() => report().includes('Status: paused'), 'pause persists');
	assert.ok(!report().includes('Status: completed'));
	const contractPath = path.join(path.dirname(reportPath()), 'GOAL.md');
	const contract = fs.readFileSync(contractPath, 'utf8');
	assert.match(contract, /Artifact matches expected text/);
	assert.ok(contract.includes(verification));
	results.push('UI creates the goal contract and pauses pending native work');
	console.log('PASS goal creation and pause');
	await page.reload();
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await tray().waitFor({ state: 'visible' });
	await until(async () => (await tray().innerText()).includes('Paused'), 'paused goal reloads');
	assert.equal(fs.readFileSync(contractPath, 'utf8'), contract);
	results.push('Paused goal and unchanged contract survive renderer reload');
	console.log('PASS goal reload');
	if (!await tray().locator('[data-goal-action="resume"]').count()) await tray().locator('[data-goal-action="toggle"]').click();
	hold = false;
	await tray().locator('[data-goal-action="resume"]').click();
	let observedFailedCheck = false;
	await until(async () => {
		const allow = page.getByRole('button', { name: 'Allow', exact: true });
		if (await allow.count()) await allow.click();
		const text = report();
		if (text.includes('Exit: 1')) { observedFailedCheck = true; }
		if (text.includes('Status: completed')) {
			assert.ok(observedFailedCheck, 'A model completion claim must first fail the actual configured check');
			return true;
		}
		if (/Status: (failed|blocked|limit_reached)/.test(text)) throw new Error(text);
		return false;
	}, 'goal verifies and completes');
	assert.equal(fs.readFileSync(path.join(workspace, 'goal-result.txt'), 'utf8'), completedText);
	assert.ok(report().includes('Exit: 0') && report().includes('Configured command exited 0'));
	assert.ok(report().includes('GOAL_RUNTIME artifact written; waiting for independent host verification.'));
	assert.equal(fs.readFileSync(contractPath, 'utf8'), contract);
	results.push('Failed verification prevents completion; next native turn writes, reports and passes verification');
	console.log('PASS verifier-driven continuation and completion');
	await tray().locator('[data-goal-action="changes"]').click();
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'goal-result.txt' }).first().waitFor();
	assert.match(await page.locator('.quick-input-list').innerText(), /Captured native edit/);
	await page.keyboard.press('Enter');
	await page.locator('.monaco-diff-editor').first().waitFor({ state: 'visible' });
	await until(async () => (await page.locator('.monaco-diff-editor').innerText()).includes('GOAL_RUNTIME verified artifact'), 'captured after diff');
	results.push('Changes opens the native captured before/after diff');
	console.log('PASS goal diff');
	await page.screenshot({ path: path.join(reports, 'completed.png') });
	fs.writeFileSync(path.join(reports, 'GOAL.md'), contract);
	fs.writeFileSync(path.join(reports, 'REPORT.md'), report());
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: true, results, requests }, null, 2));
} catch (error) {
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: false, error: error.stack, errors, report: report(), results }, null, 2));
	if (page) await page.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {});
	throw error;
} finally {
	fs.writeFileSync(path.join(reports, 'console.log'), logs.join('\n'));
	if (app) await app.close();
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(temporary, { recursive: true, force: true });
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) execFileSync('hyprctl', ['eval', 'if _G.openide_goal_fixture_rule then _G.openide_goal_fixture_rule:set_enabled(false) end']);
}
