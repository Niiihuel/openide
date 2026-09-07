#!/usr/bin/env node
// Real Electron facade -> local HTTP provider -> workspace tools -> durable journal.
// The product is configured through settings and driven through its ordinary chat/editor UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-harness-runtime-'));
const workspace = path.join(temporary, 'workspace');
const userData = path.join(temporary, 'user-data');
const reports = path.join(root, '.build/fork-hardening/harness-runtime');
for (const directory of [workspace, path.join(userData, 'User'), reports]) { fs.mkdirSync(directory, { recursive: true }); }
const target = path.join(workspace, 'fixture.txt');
const original = 'original fixture content\n';
const replacement = 'updated through the real OpenIDE harness\n';
const dirtyText = 'unsaved editor content must survive';
const ptyCommand = ['printf OPENIDE_PTY_RUNTIME > pty-marker.txt', ...Array.from({ length: 8 }, (_, index) => `printf 'OpenIDE terminal preview line ${index + 1}\\n'`)].join(' &&\n');
fs.writeFileSync(target, original);
execFileSync('git', ['init', '-q', workspace]);
const results = [], requests = [], providerErrors = [], consoleLog = [];
const capturedApprovals = new Set();
let application, page, failure;

function journalRecords() {
	const directory = path.join(userData, 'User/globalStorage/openide/run-journal');
	if (!fs.existsSync(directory)) { return []; }
	return fs.readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.jsonl')).flatMap(file => {
		const text = fs.readFileSync(path.join(directory, file), 'utf8');
		return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
	});
}

function reply(response, call, text) {
	response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
	const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: 'assistant', content: text };
	response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
	response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 30 } })}\n\n`);
	response.end('data: [DONE]\n\n');
}

const server = http.createServer(async (request, response) => {
	try {
		if (request.method === 'GET' && request.url?.endsWith('/models')) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model', owned_by: 'local-fixture' }] })); return; }
		if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404); response.end(); return; }
		let body = '';
		for await (const chunk of request) { body += chunk; }
		const input = JSON.parse(body);
		const user = input.messages?.findLast(message => message.role === 'user');
		const prompt = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
		const dirty = prompt?.includes('DIRTY_RUNTIME_FIXTURE');
		const clean = prompt?.includes('CLEAN_RUNTIME_FIXTURE');
		const pty = prompt?.includes('PTY_RUNTIME_FIXTURE');
		if (!dirty && !clean && !pty) { reply(response, undefined, 'Fixture session'); return; }
		const run = pty ? 'pty' : dirty ? 'dirty' : 'clean';
		const marker = pty ? 'PTY_RUNTIME_FIXTURE' : dirty ? 'DIRTY_RUNTIME_FIXTURE' : 'CLEAN_RUNTIME_FIXTURE';
		requests.push({ run, input });
		const records = journalRecords();
		const durableAttempts = records.filter(record => {
			if (record.event.kind !== 'model/request' || record.event.payload.phase !== 'attempt') { return false; }
			const user = record.event.payload.request.messages.findLast(message => message.role === 'user');
			return user?.content.includes(marker);
		});
		assert.equal(durableAttempts.length, requests.filter(request => request.run === run).length, 'Each journal request must be on disk before its HTTP dispatch');
		const tools = input.tools?.map(tool => tool.function.name) ?? [];
		if (pty) {
			assert.ok(tools.includes('run_command'));
			const result = input.messages.findLast(message => message.role === 'tool' && message.tool_call_id === 'pty-shell');
			if (result) {
				assert.ok(!/^Error/i.test(result.content), result.content);
				const file = path.join(workspace, 'pty-marker.txt');
				for (let attempt = 0; attempt < 50 && !fs.existsSync(file); attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); }
				assert.equal(fs.readFileSync(file, 'utf8'), 'OPENIDE_PTY_RUNTIME');
				reply(response, undefined, 'PTY_RUNTIME_CONFIRMED');
			} else { reply(response, { id: 'pty-shell', name: 'run_command', args: { command: ptyCommand, description: 'Write disposable PTY marker', timeoutSeconds: 15 } }); }
			return;
		}
		assert.ok(tools.includes('read_file') && tools.includes('write_file'), 'Native Agent mode must expose the actual workspace tools');
		const read = input.messages.findLast(message => message.role === 'tool' && message.tool_call_id === `${run}-read`);
		const write = input.messages.findLast(message => message.role === 'tool' && message.tool_call_id === `${run}-write`);
		if (write) {
			if (dirty) { assert.match(write.content, /dirty|unsaved|sin guardar/i); assert.equal(fs.readFileSync(target, 'utf8'), replacement); }
			else { assert.ok(!/^Error/i.test(write.content), write.content); assert.equal(fs.readFileSync(target, 'utf8'), replacement); }
			reply(response, undefined, dirty ? 'DIRTY_REFUSAL_CONFIRMED' : 'CLEAN_RUNTIME_CONFIRMED');
		} else if (read) {
			assert.ok(read.content.includes(dirty ? dirtyText : original.trim()), `read_file must return the ${run} file state: ${read.content}`);
			reply(response, { id: `${run}-write`, name: 'write_file', args: { path: 'fixture.txt', content: dirty ? 'must never reach disk\n' : replacement } });
		} else { reply(response, { id: `${run}-read`, name: 'read_file', args: { path: 'fixture.txt' } }); }
	} catch (error) {
		providerErrors.push(error.stack);
		if (!response.headersSent) { response.writeHead(500); }
		response.end(String(error));
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'files.autoSave': 'off',
	'terminal.integrated.profiles.linux': { 'Fixture Bash': { path: '/bin/bash', args: ['--noprofile', '--norc'] } },
	'terminal.integrated.defaultProfile.linux': 'Fixture Bash',
	'openide.agent.customProviders': [{ id: 'runtime-fixture', label: 'Runtime Fixture', protocol: 'openai', auth: 'none', baseUrl: endpoint, defaultModel: 'fixture-model' }],
	// Exercise the existing settings migration, not a private test-only setter.
	'openide.agent.provider': 'runtime-fixture',
	'openide.agent.model': 'fixture-model',
	'openide.agent.fallbackProviders': [],
	'openide.agent.fallbackChain': [],
}, null, 2));

async function until(predicate, label, milliseconds = 60000) {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) {
		if (providerErrors.length) { throw new Error(providerErrors.join('\n')); }
		const errorCard = page?.locator('.openide-chat-notice-error').first();
		if (errorCard && await errorCard.isVisible()) { throw new Error(`Native chat failed: ${await errorCard.innerText()}`); }
		if (await predicate()) { return; }
		// Approve only this fixture's file writes and disposable PTY command through normal UI.
		const approval = page?.locator('.openide-chat-approval').filter({ hasText: /fixture\.txt|OPENIDE_PTY_RUNTIME/ }).locator('button.openide-chat-abtn.primary:visible').first();
		if (approval && await approval.isVisible()) {
			const card = approval.locator('..').locator('..').locator('..');
			const kind = (await card.innerText()).includes('OPENIDE_PTY_RUNTIME') ? 'terminal' : 'file';
			if (!capturedApprovals.has(kind)) {
				capturedApprovals.add(kind);
				await revealCard(card);
				const layout = await card.evaluate(element => {
					const card = element.getBoundingClientRect();
					const controls = [...element.querySelectorAll('button, select')];
					return { actions: controls.length, contained: controls.every(control => {
						const bounds = control.getBoundingClientRect();
						return bounds.left >= card.left && bounds.right <= card.right && bounds.bottom <= card.bottom;
					}) };
				});
				assert.deepEqual(layout, { actions: 3, contained: true }, 'Approval actions must fit inside the native chat card');
				await card.screenshot({ path: path.join(reports, `approval-${kind}.png`) });
			}
			await approval.click();
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out: ${label}`);
}
async function check(name, task) { try { await task(); results.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, passed: false, error: error.stack }); throw error; } }
async function submit(prompt) {
	const input = page.locator('.openide-chat-composer textarea').first();
	await input.fill(prompt);
	await input.press('Enter');
}
async function revealCard(card) {
	await card.scrollIntoViewIfNeeded();
	const viewport = await page.locator('.openide-chat-list-host').boundingBox();
	const pinnedRequest = page.locator('.openide-chat-pinned.visible');
	const pinned = await pinnedRequest.count() ? await pinnedRequest.boundingBox() : null;
	const bounds = await card.boundingBox();
	const visibleTop = Math.max(viewport.y, pinned ? pinned.y + pinned.height : viewport.y) + 16;
	if (bounds.y < visibleTop) {
		// Native scrollIntoView does not account for the pinned request above the transcript.
		await page.mouse.move(viewport.x + 4, viewport.y + viewport.height / 2);
		await page.mouse.wheel(0, bounds.y - visibleTop);
		await page.waitForTimeout(250);
	}
}
async function assertApprovalsSettled() {
	assert.equal(await page.locator('.openide-chat-approval').filter({ hasText: /fixture\.txt|OPENIDE_PTY_RUNTIME/ }).locator('button.openide-chat-abtn.primary:visible').count(), 0, 'Completed fixture approvals must not offer Allow again after transcript repaint');
}

try {
	application = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared-data'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	for (const [name, stream] of [['stdout', application.process().stdout], ['stderr', application.process().stderr]]) { stream?.on('data', chunk => consoleLog.push(`[main ${name}] ${String(chunk)}`)); }
	page = await application.firstWindow();
	page.on('requestfailed', request => consoleLog.push(`[request failed] ${request.url()} ${request.failure()?.errorText}`));
	page.on('console', message => consoleLog.push(`[${message.type()}] ${message.text()}`));
	page.on('pageerror', error => consoleLog.push(error.stack));
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: New chat');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /New chat/i }).first().waitFor();
	await page.keyboard.press('Enter');
	await page.locator('.openide-chat-composer textarea').first().waitFor();

	await check('real native facade reads, writes and completes through the local HTTP provider', async () => {
		await submit('CLEAN_RUNTIME_FIXTURE: Read fixture.txt, then replace its content with "updated through the real OpenIDE harness\\n".');
		await until(async () => (await page.locator('.openide-chat-native').innerText()).includes('CLEAN_RUNTIME_CONFIRMED') && !await page.locator('.openide-composer-send.running').count(), 'native clean turn');
		assert.equal(fs.readFileSync(target, 'utf8'), replacement);
		assert.equal(requests.filter(request => request.run === 'clean').length, 3, 'Exactly read, write, and final-response rounds');
		await assertApprovalsSettled();
	});
	await check('journal persists request, tool intents/results and final conversation', async () => {
		await until(() => journalRecords().some(record => record.event.kind === 'run/end'), 'durable final checkpoint');
		const records = journalRecords();
		for (const callId of ['clean-read', 'clean-write']) {
			assert.ok(records.some(record => record.event.kind === 'tool/intent' && record.event.payload.callId === callId));
			assert.ok(records.some(record => record.event.kind === 'tool/result' && record.event.payload.callId === callId));
		}
		assert.ok(records.some(record => record.event.kind === 'run/end' && record.event.payload.messages.some(message => message.content === 'CLEAN_RUNTIME_CONFIRMED')));
	});
	await check('dirty editor content is read and a subsequent model write is refused', async () => {
		await page.keyboard.press('Control+KeyP');
		await page.locator('.quick-input-widget input').first().fill(target);
		await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'fixture.txt' }).first().waitFor();
		await page.keyboard.press('Enter');
		await page.locator('.part.editor .monaco-editor .view-lines').first().click();
		await page.keyboard.press('Control+KeyA');
		await page.keyboard.insertText(dirtyText);
		assert.equal(fs.readFileSync(target, 'utf8'), replacement);
		await submit('DIRTY_RUNTIME_FIXTURE: Read fixture.txt, then try to replace it. Preserve any unsaved editor changes.');
		await until(async () => (await page.locator('.openide-chat-native').innerText()).includes('DIRTY_REFUSAL_CONFIRMED') && !await page.locator('.openide-composer-send.running').count(), 'dirty refusal turn');
		assert.equal(fs.readFileSync(target, 'utf8'), replacement);
		assert.equal(requests.filter(request => request.run === 'dirty').length, 3);
		const editorText = (await page.locator('.part.editor .monaco-editor .view-lines').allTextContents()).join('\n').replace(/\u00a0/g, ' ');
		assert.ok(editorText.includes(dirtyText), `The unsaved editor text must survive the refusal: ${editorText}`);
		assert.ok(await page.locator('.part.editor .tab.dirty').filter({ hasText: 'fixture.txt' }).count(), 'The fixture editor must remain marked as unsaved');
		await assertApprovalsSettled();
	});
	await check('native run_command executes in the real PTY and journals its result', async () => {
		await submit('PTY_RUNTIME_FIXTURE: Run printf OPENIDE_PTY_RUNTIME > pty-marker.txt in this disposable workspace.');
		await until(async () => (await page.locator('.openide-chat-native').innerText()).includes('PTY_RUNTIME_CONFIRMED') && !await page.locator('.openide-composer-send.running').count(), 'native PTY turn');
		assert.equal(fs.readFileSync(path.join(workspace, 'pty-marker.txt'), 'utf8'), 'OPENIDE_PTY_RUNTIME');
		assert.equal(requests.filter(request => request.run === 'pty').length, 2);
		const records = journalRecords();
		assert.ok(records.some(record => record.event.kind === 'tool/intent' && record.event.payload.callId === 'pty-shell'));
		assert.ok(records.some(record => record.event.kind === 'tool/result' && record.event.payload.callId === 'pty-shell'));
		await assertApprovalsSettled();
	});
	await check('terminal expansion stays outside its output and inside the card frame', async () => {
		const card = page.locator('.openide-chat-term-card').last();
		await revealCard(card);
		const expand = card.locator('.openide-fold-expand');
		assert.ok(await expand.isVisible(), 'The multiline command must offer expansion');
		await card.screenshot({ path: path.join(reports, 'terminal-card.png') });
		const layout = await card.evaluate(element => {
			const card = element.getBoundingClientRect();
			const output = element.querySelector('.openide-chat-term-out').getBoundingClientRect();
			const footer = element.querySelector('.openide-fold-expand').getBoundingClientRect();
			return { belowOutput: footer.top >= output.bottom, insideFrame: footer.bottom < card.bottom,
				outputBottom: output.bottom, footerTop: footer.top, footerBottom: footer.bottom, cardBottom: card.bottom };
		});
		assert.ok(layout.belowOutput && layout.insideFrame, JSON.stringify(layout));
		await expand.focus();
		await expand.press('Enter');
		assert.equal(await expand.getAttribute('aria-expanded'), 'true');
		await expand.press('Space');
		assert.equal(await expand.getAttribute('aria-expanded'), 'false');
		await revealCard(card);
		await card.screenshot({ path: path.join(reports, 'terminal-card.png') });
	});
	await page.screenshot({ path: path.join(reports, 'harness-runtime.png') });
} catch (error) { failure = error; console.error(error); await page?.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {}); }
finally {
	fs.writeFileSync(path.join(reports, 'journal.json'), JSON.stringify(journalRecords(), null, 2));
	fs.writeFileSync(path.join(reports, 'requests.json'), JSON.stringify(requests, null, 2));
	fs.writeFileSync(path.join(reports, 'console.log'), consoleLog.join('\n'));
	fs.writeFileSync(path.join(reports, 'results.json'), JSON.stringify({ platform: process.platform, results, failure: failure?.stack, providerErrors, limitations: 'Local deterministic provider and real native facade. No third-party API credentials or model quality claims. Process-crash recovery is covered separately by the disk journal SIGKILL test.' }, null, 2));
	// Dirty-buffer refusal is intentional; exit the disposable product without accepting a save prompt.
	await application?.evaluate(({ app }) => app.exit(0)).catch(() => {});
	await application?.close().catch(() => {});
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(temporary, { recursive: true, force: true });
	process.exitCode = failure ? 1 : 0;
}
