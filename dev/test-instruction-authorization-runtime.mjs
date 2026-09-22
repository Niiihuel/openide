// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-instruction-authorization-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-instruction-authorization-'));
const workspace = path.join(tmp, 'workspace'), profile = path.join(tmp, 'profile');
const output = path.join(root, '.build/instruction-authorization-runtime');
for (const directory of [workspace, path.join(profile, 'User'), output]) { fs.mkdirSync(directory, { recursive: true }); }
const errors = [], requests = [], results = [];
let phase = 'initial', app, page;
const rule = (name, content, scope = 'global') => ({ name: 'rule_manage', args: { action: 'save', scope, name, content } });
const scripts = {
	initial: [rule('rtk-project', 'Use RTK for commands.', 'project')],
	answer: [{ name: 'ask_user', args: { question: '¿Crear una regla global para usar RTK?', options: ['Sí, crear la regla global', 'No'] } }, rule('rtk-global', 'Use RTK for all commands.')],
	preference: [{ name: 'memory', args: { action: 'add', target: 'user', content: 'I prefer RTK for all commands.' } }],
	blocked: [rule('confirmed-once', 'Only the confirmed content.'), rule('confirmed-once', 'This unconfirmed replacement must not be saved.')],
	memory: [{ name: 'memory', args: { action: 'add', target: 'user', content: 'An unrequested preference must not be saved.' } }],
	cancel: [rule('cancelled', 'This cancelled rule must not be saved.')],
};
function reply(response, tool, id) {
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	const delta = tool ? { tool_calls: [{ index: 0, id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: `AUTH_COMPLETE_${phase}` };
	response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
	response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 50 } })}\n\n`);
	response.end('data: [DONE]\n\n');
}
const server = http.createServer(async (request, response) => {
	try {
		if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] })); return; }
		let body = ''; for await (const chunk of request) { body += chunk; }
		const input = JSON.parse(body);
		const user = input.messages?.findLast(message => message.role === 'user');
		if (!JSON.stringify(user?.content).includes('AUTH_RUNTIME')) { reply(response); return; }
		requests.push({ phase, input });
		const completed = input.messages.filter(message => message.role === 'tool' && message.tool_call_id?.startsWith(`${phase}-`));
		for (const item of completed) { if (!results.some(result => result.id === item.tool_call_id)) { results.push({ id: item.tool_call_id, output: item.content }); } }
		const step = completed.length;
		reply(response, scripts[phase][step], `${phase}-${step}`);
	} catch (error) { errors.push(error.stack); response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom',
	'openide.memory.captureMode': 'manual', 'openide.agent.notifications.enabled': false,
	'openide.agent.customProviders': [{ id: 'auth-fixture', label: 'Authorization Fixture', protocol: 'openai', auth: 'none', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'fixture-model' }],
	'openide.agent.provider': 'auth-fixture', 'openide.agent.model': 'fixture-model', 'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
}));
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspace, '--user-data-dir', profile, '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	page = await app.firstWindow();
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', dialog => void dialog.accept().catch(() => {}));
	await page.locator('.monaco-workbench').waitFor({ timeout: 90000 });
	await page.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.instructionAuthorization', title: 'Instruction Authorization Fixture', f1: true }); }
			async run(accessor) {
				const agent = accessor.get(IOpenideAgentService);
				const commands = accessor.get(ICommandService);
				window.closeFixtureNotifications = () => commands.executeCommand('notifications.clearAll');
				await agent.setPermissionMode('auto-all');
				window.globalRulesPath = agent.rulesManager().root('global').fsPath;
				await commands.executeCommand('openide.agent.newChat');
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill('>Instruction Authorization Fixture');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Instruction Authorization Fixture' }).first().click();
	await page.waitForFunction(() => !!window.globalRulesPath);
	const globalRules = await page.evaluate(() => window.globalRulesPath);
	const submit = async text => { const input = page.locator('.openide-chat-composer textarea').first(); await input.fill(`AUTH_RUNTIME: ${text}`); await input.press('Enter'); };
	const done = async () => {
		await page.getByText(`AUTH_COMPLETE_${phase}`, { exact: true }).waitFor({ timeout: 60000 });
		await page.locator('.openide-composer-send.running').waitFor({ state: 'detached' });
	};
	const confirmation = () => page.locator('.openide-chat-approval:visible').filter({ has: page.locator('.openide-chat-abtn.primary:visible') }).last();
	await submit('podemos integrar una regla o hook para que use todos los comandos de rtk y no los normales?'); await done();
	assert.match(fs.readFileSync(path.join(workspace, '.openide/rules/rtk-project.md'), 'utf8'), /Use RTK/);
	assert.equal(await page.locator('.openide-chat-approval').count(), 0);
	phase = 'answer'; await submit('Revisá cómo se ejecutan los comandos.');
	await page.locator('.openide-chat-questions-option').filter({ hasText: 'Sí, crear la regla global' }).click();
	await page.locator('.openide-chat-questions-continue').click(); await done();
	assert.match(fs.readFileSync(path.join(globalRules, 'rtk-global.md'), 'utf8'), /Use RTK/);
	assert.equal(await page.locator('.openide-chat-approval').count(), 0, 'the explicit UI answer is not requested again');
	phase = 'preference'; await submit('I prefer RTK for all commands.'); await done();
	const memoryFile = path.join(path.dirname(globalRules), 'USER.md');
	const memoryBefore = fs.readFileSync(memoryFile, 'utf8');
	assert.match(memoryBefore, /prefer RTK/);
	phase = 'blocked'; await submit('Inspect the project files.');
	await confirmation().waitFor();
	assert.equal(await confirmation().locator('.openide-chat-approval-scope-trigger').count(), 0, 'protected confirmation cannot grant session/always');
	assert.equal(fs.existsSync(path.join(globalRules, 'confirmed-once.md')), false, 'auto-all cannot perform the protected operation');
	await page.screenshot({ path: path.join(output, 'protected-confirmation.png') });
	await confirmation().locator('.openide-chat-abtn.primary').click();
	await page.waitForFunction(() => [...document.querySelectorAll('.openide-chat-approval')].filter(element => element.textContent.includes('unconfirmed replacement')).length > 0);
	await confirmation().locator('.openide-chat-abtn.deny').click(); await done();
	assert.equal(fs.readFileSync(path.join(globalRules, 'confirmed-once.md'), 'utf8').trim(), 'Only the confirmed content.');
	phase = 'memory'; await submit('Inspect the terminal setup.');
	await confirmation().waitFor(); await confirmation().locator('.openide-chat-abtn.deny').click(); await done();
	assert.equal(fs.readFileSync(memoryFile, 'utf8'), memoryBefore);
	phase = 'cancel'; await submit('Inspect the tooling.');
	await confirmation().waitFor();
	await page.evaluate(() => window.closeFixtureNotifications());
	await page.locator('.openide-composer-send.running').click();
	await page.locator('.openide-composer-send.running').waitFor({ state: 'detached' });
	assert.equal(fs.existsSync(path.join(globalRules, 'cancelled.md')), false);
	assert.deepEqual(errors, []);
	assert.ok(results.filter(result => /^(?:initial|answer|preference)-/.test(result.id)).every(result => !/^Error/.test(result.output)));
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, results }, null, 2));
	console.log('PASS: real ES/EN requests, UI answer propagation, global memory, protected per-operation Allow/Deny under auto-all, repeat operation denial and cancellation.');
} catch (error) {
	console.error(error);
	if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
	fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors, results, requests }, null, 2));
	throw error;
} finally {
	if (app) { await app.close(); }
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(tmp, { recursive: true, force: true });
}
