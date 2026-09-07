#!/usr/bin/env node
// Real native chat -> provider -> memory tools/checkpoint -> Markdown -> restart -> recall.
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-memory-runtime-'));
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'user-data');
const reports = path.join(root, '.build/performance-cli-implementation/native-runtime');
for (const dir of [workspace, path.join(workspace, 'src'), path.join(userData, 'User'), reports]) { fs.mkdirSync(dir, { recursive: true }); }
fs.writeFileSync(path.join(workspace, 'src/payments.ts'), 'export function retryPayment(key: string) { return key; }\n');
const requests = []; const errors = []; const logs = []; let page; let app;
let savedReceipt; let phase = 'save'; let checkpoints = 0; const testWorkspaces = [];
if (process.env.HYPRLAND_INSTANCE_SIGNATURE) { execFileSync('hyprctl', ['eval', '_G.openide_memory_fixture_rule = hl.window_rule({ name = "openide-memory-fixture", match = { class = "(?i)openide.*" }, workspace = "6 silent", no_initial_focus = true, suppress_event = "activate activatefocus" }); _G.openide_memory_fixture_rule:set_enabled(true)']); }
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
		const system = input.messages?.filter(item => item.role === 'system').map(item => item.content).join('\n') ?? '';
		if (system.includes('You maintain project memory.')) {
			checkpoints++; assert.ok(!input.tools?.length); assert.equal(input.max_tokens ?? input.max_completion_tokens, 1000);
			reply(response, undefined, JSON.stringify(phase === 'automatic' ? { notes: [{ topic_key: 'payments/backoff', body: '# Backoff policy\nQuasarBackoff uses bounded exponential delay.', kind: 'decision', related: ['src/payments.ts#retryPayment'] }] } : { notes: [], reason: 'The explicit note already preserves the decision.' })); return;
		}
		const user = input.messages?.findLast(item => item.role === 'user');
		const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
		if (!prompt?.includes('MEMORY_RUNTIME')) { reply(response, undefined, 'Memory fixture'); return; }
		requests.push({ phase, input });
		const tools = input.tools?.map(tool => tool.function.name) ?? [];
		assert.ok(tools.includes('memory_save') && tools.includes('memory_search'));
		if (phase === 'automatic') { reply(response, undefined, 'AUTOMATIC_MEMORY_CONFIRMED: QuasarBackoff uses bounded exponential delay.'); return; }
		if (phase === 'dirty') {
			const result = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === 'dirty-memory');
			if (result) { assert.match(result.content, /unsaved|sin guardar/i); reply(response, undefined, 'DIRTY_MEMORY_CONFIRMED'); }
			else { reply(response, { id: 'dirty-memory', name: 'memory_save', args: { id: savedReceipt.record.id, expected_revision: savedReceipt.record.revision, expected_hash: savedReceipt.hash, topic_key: savedReceipt.record.topic_key, body: 'This must not replace an unsaved editor buffer.', idempotency_key: 'dirty-runtime-attempt' } }); }
			return;
		}
		if (phase === 'graph') {
			const result = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === 'graph-memory');
			if (result) { assert.ok(result.content.includes('QuasarRecovery') && result.content.includes('NOTE'), result.content); reply(response, undefined, 'GRAPH_MEMORY_CONFIRMED'); }
			else { reply(response, { id: 'graph-memory', name: 'project_map_query', args: { question: 'QuasarRecovery payment retry policy', maxTokens: 2000 } }); }
			return;
		}
		if (phase === 'recall') {
			const serialized = JSON.stringify(input.messages);
			assert.ok(serialized.includes('QuasarRecovery') && serialized.includes('Source:'), 'Canonical memory must be retrieved into the next request');
			reply(response, undefined, 'RECALL_MEMORY_CONFIRMED'); return;
		}
		const result = input.messages.findLast(item => item.role === 'tool' && item.tool_call_id === 'save-memory');
		if (result) { assert.ok(!/^Error/.test(result.content), result.content); const saved = JSON.parse(result.content); savedReceipt = saved; assert.equal(saved.status, 'saved'); assert.ok(fs.existsSync(path.join(workspace, saved.path))); reply(response, undefined, 'SAVED_MEMORY_CONFIRMED'); }
		else { reply(response, { id: 'save-memory', name: 'memory_save', args: { topic_key: 'payments/retry', body: '# Payment retry policy\nQuasarRecovery reuses the idempotency key across retries.', kind: 'decision', related: ['src/payments.ts#retryPayment'], idempotency_key: 'memory-runtime-save' } }); }
	} catch (error) { errors.push(error.stack); if (!response.headersSent) { response.writeHead(500); } response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.title': 'OpenIDE Memory Tests', 'files.autoSave': 'off',
	'openide.memory.captureMode': 'automatic',
	'openide.agent.customProviders': [{ id: 'memory-fixture', label: 'Memory Fixture', protocol: 'openai', auth: 'none', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'fixture-model' }],
	'openide.agent.provider': 'memory-fixture', 'openide.agent.model': 'fixture-model', 'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
}, null, 2));
async function launch() {
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1' && !process.env.HYPRLAND_INSTANCE_SIGNATURE) { throw new Error('Workspace 6 cannot be verified'); }
	if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') execFileSync('hyprctl', ['eval', 'if _G.openide_memory_fixture_rule then _G.openide_memory_fixture_rule:set_enabled(false) end; _G.openide_memory_fixture_rule = hl.window_rule({ name = "openide-memory-fixture", match = { class = "(?i)openide.*" }, workspace = "6 silent", no_initial_focus = true, suppress_event = "activate activatefocus" }); _G.openide_memory_fixture_rule:set_enabled(true)']);
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11', '--class=openide-memory-test'], env: { ...process.env, HL_INITIAL_WORKSPACE_TOKEN: '', VSCODE_DEV: '1' }, timeout: 90000 });
	for (const [name, stream] of [['stdout', app.process().stdout], ['stderr', app.process().stderr]]) { stream?.on('data', chunk => logs.push(`[main ${name}] ${String(chunk)}`)); }
	page = await app.firstWindow(); page.on('console', message => logs.push(message.text())); page.on('pageerror', error => logs.push(error.stack));
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
		const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }));
		const window = clients.find(client => client.pid === app.process().pid);
		assert.equal(window?.workspace.id, 6, 'Test window must stay on workspace 6');
		testWorkspaces.push(window.workspace.id);
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
		if ((await page.locator('.openide-chat-native').innerText()).includes(marker) && !await page.locator('.openide-composer-send.running').count()) { return; }
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	throw new Error(`Timed out waiting for ${marker}: ${await page.locator('.openide-chat-native').innerText()}`);
}
async function waitCapture() {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const notice = await page.locator('.openide-chat-native').innerText();
		if (notice.includes('Memory checked:') || notice.includes('Memory saved:') || notice.includes('Memoria guardada:')) { await new Promise(resolve => setTimeout(resolve, 300)); return; }
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}
async function waitNoteCount(count) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) { if (notes().length === count) { return; } await new Promise(resolve => setTimeout(resolve, 50)); }
	assert.equal(notes().length, count);
}
const notes = () => fs.readdirSync(path.join(workspace, '.openide/memory/notes')).map(name => fs.readFileSync(path.join(workspace, '.openide/memory/notes', name), 'utf8'));
try {
	await launch();
	await submit('MEMORY_RUNTIME: Remember the payment retry decision. QuasarRecovery reuses the idempotency key across retries in src/payments.ts#retryPayment.', 'SAVED_MEMORY_CONFIRMED');
	await waitNoteCount(1); await waitCapture();
	assert.equal(notes().length, 1); assert.ok(notes()[0].includes('source_kind: "native"')); assert.ok(checkpoints >= 1);
	await page.screenshot({ path: path.join(reports, 'saved.png') });
	phase = 'automatic';
	await submit('MEMORY_RUNTIME: The project decision is that QuasarBackoff uses bounded exponential delay. Explain this convention.', 'AUTOMATIC_MEMORY_CONFIRMED');
	await waitNoteCount(2);
	assert.equal(notes().length, 2); assert.ok(notes().some(note => note.includes('QuasarBackoff')));
	phase = 'graph'; await submit('MEMORY_RUNTIME: Query Project Map for the QuasarRecovery payment retry policy.', 'GRAPH_MEMORY_CONFIRMED');
	await app.close(); app = undefined; phase = 'recall';
	await launch(); await submit('MEMORY_RUNTIME: What does QuasarRecovery do during payment retries?', 'RECALL_MEMORY_CONFIRMED');
	assert.equal(notes().length, 2);
	await page.screenshot({ path: path.join(reports, 'recalled-after-restart.png') });
	phase = 'dirty';
	const notePath = path.join(workspace, savedReceipt.path); const before = fs.readFileSync(notePath, 'utf8');
	await page.keyboard.press('Control+KeyP'); await page.locator('.quick-input-widget input').first().fill(notePath);
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: path.basename(notePath) }).first().waitFor(); await page.keyboard.press('Enter');
	await page.locator('.part.editor .monaco-editor .view-lines').first().click(); await page.keyboard.press('Control+KeyA'); await page.keyboard.insertText('Unsaved memory fixture');
	await submit('MEMORY_RUNTIME: Try to update the saved memory while preserving unsaved editor changes.', 'DIRTY_MEMORY_CONFIRMED');
	assert.equal(fs.readFileSync(notePath, 'utf8'), before);
	assert.ok((await page.locator('.part.editor .monaco-editor .view-lines').allTextContents()).join(' ').replace(/\u00a0/g, ' ').includes('Unsaved memory fixture'));
	await page.screenshot({ path: path.join(reports, 'dirty-buffer-preserved.png') });
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: true, temporary, testWorkspaces, checkpoints, requests: requests.map(item => item.phase), notes: notes().length }, null, 2));
	console.log('PASS native save, automatic checkpoint, Markdown persistence, restart and scoped recall');
} catch (error) { fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: false, error: error.stack, temporary, errors }, null, 2)); if (page) { await page.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {}); } throw error; }
finally { fs.writeFileSync(path.join(reports, 'console.log'), logs.join('\n')); if (app) { await app.close(); } await new Promise(resolve => server.close(resolve)); if (process.env.HYPRLAND_INSTANCE_SIGNATURE) { execFileSync('hyprctl', ['eval', 'if _G.openide_memory_fixture_rule then _G.openide_memory_fixture_rule:set_enabled(false) end']); } }
