#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real installed Codex, private HOME, TUI + controller; only a local Responses fixture, no paid model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.OPENIDE_TEST_CODEX;
if (!binary) throw new Error('Set OPENIDE_TEST_CODEX to the Codex executable to opt into the real transport test.');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-codex-transport-'));
const workspace = path.join(temporary, 'workspace'); fs.mkdirSync(workspace);
const home = path.join(temporary, 'codex'); fs.mkdirSync(home);
const env = { ...process.env, CODEX_HOME: home };
const reports = path.join(root, '.build/codex-goal-runtime'); fs.mkdirSync(reports, { recursive: true });
let fixtureRequests = 0;
let commandPhase = true;
let commandSent = false;
const approvalFile = path.join(workspace, 'approved.txt');
const provider = http.createServer(async (request, response) => {
	if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] })); return; }
	let body = ''; for await (const part of request) body += part;
	const input = JSON.parse(body); fixtureRequests++;
	fs.writeFileSync(path.join(reports, 'provider-input.json'), JSON.stringify(input, null, 2));
	const text = 'Native Codex structured transport verified.';
	let item = { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
	if (commandPhase && !commandSent) {
		commandSent = true;
		item = { id: 'fc_fixture', type: 'function_call', call_id: 'call_fixture', name: 'exec_command', arguments: JSON.stringify({ cmd: "printf approved > approved.txt", workdir: workspace, sandbox_permissions: 'require_escalated', justification: 'Allow the isolated approval fixture to write approved.txt?' }) };
	}
	const completed = { id: 'resp_fixture', object: 'response', created_at: Math.floor(Date.now()/1000), status: 'completed', error: null, output: [item], usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18, input_tokens_details: { cached_tokens: 0 } } };
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	const event = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
	event('response.created', { response: { ...completed, status: 'in_progress', output: [] } });
	event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
	if (item.type === 'message') {
	event('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
	event('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: text });
	event('response.output_text.done', { output_index: 0, item_id: item.id, content_index: 0, text });
	}
	event('response.output_item.done', { output_index: 0, item });
	event('response.completed', { response: completed }); response.end();
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const config = `developer_instructions = "KEEP_GLOBAL_INSTRUCTIONS"
model = "fixture-model"
model_provider = "openide_fixture"
[model_providers.openide_fixture]
name = "Local Fixture"
base_url = "http://127.0.0.1:${provider.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
[projects.${JSON.stringify(workspace)}]
trust_level = "trusted"
`;
fs.writeFileSync(path.join(home, 'config.toml'), config);

const userData = path.join(temporary, 'user-data');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.title': 'OpenIDE Codex Goal Tests',
 'openide.memory.captureMode': 'off', 'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
}));
execFileSync('git', ['init', '-q', workspace]);
let app; let page; const logs = [];
const tray = () => page.locator('.openide-chat-goal-tray').first();
const reportPath = () => {
 const directory = path.join(workspace, '.openide/goals');
 const id = fs.existsSync(directory) && fs.readdirSync(directory)[0];
 return id ? path.join(directory, id, 'REPORT.md') : undefined;
};
const report = () => { const file = reportPath(); return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; };
async function until(predicate, label) {
 const deadline = Date.now() + 90000;
 while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
 throw new Error(`Timed out ${label}: ${await page.locator('.monaco-workbench').innerText()}\n${report()}`);
}
async function quickInput(value, title) {
 await page.locator('.quick-input-widget').filter({ hasText: title }).waitFor({ state: 'visible' });
 await page.locator('.quick-input-widget input').first().fill(value); await page.keyboard.press('Enter');
}
try {
 assert.equal(process.env.OPENIDE_TEST_VIRTUAL_DISPLAY, '1', 'Use dev/run-virtual-gui.mjs to avoid disturbing the desktop');
 app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11', '--class=openide-codex-goal-test'], env: { ...env, HL_INITIAL_WORKSPACE_TOKEN: '', VSCODE_DEV: '1' }, timeout: 90000 });
 for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', data => logs.push(String(data)));
 page = await app.firstWindow(); page.on('console', message => { logs.push(message.text()); if (message.text().includes('Codex diagnostic')) console.log(message.text()); }); page.on('pageerror', error => logs.push(error.stack));
 await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
 await page.keyboard.press('Control+Shift+KeyP'); await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat');
 await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /New chat/i }).first().waitFor(); await page.keyboard.press('Enter');
 await page.locator('.openide-chat-composer textarea').first().waitFor();
 const collapsed = page.locator('.openide-chat-head-collapse.collapsed');
 if (await collapsed.count()) await collapsed.click();
 await page.locator('.openide-chat-head-split-chevron').click();
 await page.locator('.openide-chat-kind-installed .openide-menu-row').filter({ hasText: 'Codex' }).click();
 await until(async () => { const text = await tray().innerText(); if (text.includes('could not be verified')) throw new Error(text); return text.includes('Codex is connected'); }, 'structured adapter connection');
 await until(async () => (await page.locator('.openide-chat-agent-terminal').innerText()).includes('fixture-model'), 'real TUI resumed the configured model');
 await tray().locator('[data-goal-action="create"]').click();
 await quickInput('CODEX_GOAL_RUNTIME Write approved.txt through a reviewed command', 'Create Goal');
 const verify = `node -e "process.exit(require('fs').readFileSync('approved.txt','utf8') === 'approved' ? 0 : 1)"`;
 await quickInput(`Approved artifact matches :: ${verify}`, 'Completion Criteria');
 await quickInput('3', 'Maximum Turns');
 const approve = page.getByRole('button', { name: 'Allow Once', exact: true });
 await approve.waitFor({ timeout: 90000 });
 assert.equal(fs.existsSync(approvalFile), false, 'GUI command approval must precede execution');
 assert.match(await page.locator('.monaco-dialog-box').innerText(), /printf approved > approved.txt/);
 await page.screenshot({ path: path.join(reports, 'approval.png') });
 await approve.click();
 await until(async () => {
  if (report().includes('Status: completed')) return true;
  // The independent OpenIDE verifier retains its own approval flow.
  const allow = page.getByRole('button', { name: 'Allow', exact: true }); if (await allow.count()) await allow.click();
  const quickAllow = page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /^\s*Allow once\s*$/i }); if (await quickAllow.isVisible()) { assert.ok((await page.locator('.quick-input-widget input').first().getAttribute('placeholder'))?.includes(verify), 'Only the configured verification command may be approved'); await quickAllow.click(); }
  const text = report(); if (/Status: (failed|blocked|limit_reached)/.test(text)) throw new Error(text);
  return text.includes('Status: completed');
 }, 'CLI goal verified completion');
 assert.equal(fs.readFileSync(approvalFile, 'utf8'), 'approved');
 assert.match(report(), /Exit: 0/); assert.match(report(), /Native Codex structured transport verified/);
 assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), config);
 const providerInput = fs.readFileSync(path.join(reports, 'provider-input.json'), 'utf8');
 assert.ok(providerInput.includes('KEEP_GLOBAL_INSTRUCTIONS') && providerInput.includes('OpenIDE tools for this session'), 'Codex must preserve global instructions and OpenIDE orientation after TUI attach');
 fs.writeFileSync(path.join(reports, 'GOAL.md'), fs.readFileSync(path.join(path.dirname(reportPath()), 'GOAL.md')));
 fs.writeFileSync(path.join(reports, 'REPORT.md'), report());
 await page.keyboard.press('Control+Shift+KeyP'); await page.locator('.quick-input-widget input').first().fill('>Notifications: Clear All Notifications');
 await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Clear All Notifications' }).first().waitFor(); await page.keyboard.press('Enter');
 await tray().locator('[data-goal-action="toggle"]').click();
 assert.match(await tray().innerText(), /Completed/);
 await page.screenshot({ path: path.join(reports, 'completed.png') });
 fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: true, realCodex: true, guiApproval: true, independentVerification: true, externalModels: false, fixtureRequests }, null, 2));
 console.log('PASS real GUI Codex TTY + GOAL + command approval + native verifier + Markdown');
} catch (error) {
 fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: false, error: error.stack, report: report() }, null, 2));
 if (page) await page.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {});
 throw error;
} finally {
 fs.writeFileSync(path.join(reports, 'console.log'), logs.join('\n'));
 if (app) await app.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); fs.rmSync(temporary, { recursive: true, force: true });
}
