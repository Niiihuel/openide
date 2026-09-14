#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
// Real installed Codex, private HOME, TUI + controller; only a local Responses fixture, no paid model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.OPENIDE_TEST_CODEX;
if (!binary) throw new Error('Set OPENIDE_TEST_CODEX to the Codex executable to opt into the real transport test.');
const { OpenideCodexGoalOwner } = await import('../vscode/out/vs/platform/openideAgentHost/node/openideCodexGoalOwner.js');
const { spawn } = createRequire(path.join(root, 'vscode/package.json'))('node-pty');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-codex-transport-'));
const workspace = path.join(temporary, 'workspace'); fs.mkdirSync(workspace);
const home = path.join(temporary, 'codex'); fs.mkdirSync(home);
const env = { ...process.env, CODEX_HOME: home };
const reports = path.join(root, '.build/codex-goal-transport'); fs.mkdirSync(reports, { recursive: true });
let fixtureRequests = 0;
let commandPhase = false;
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
fs.writeFileSync(path.join(home, 'openide-fixture.config.toml'), 'developer_instructions = "KEEP_PROFILE_INSTRUCTIONS"\n');
const owner = new OpenideCodexGoalOwner(async () => env);
let tty; let output = '';
try {
	await owner.setWorkspace([workspace]);
	const connection = await owner.prepare({ sessionId: 'controlled', executable: binary, cwd: workspace, configurationArgs: [], env: {} }, 'KEEP_GLOBAL_INSTRUCTIONS\nKEEP_PROFILE_INSTRUCTIONS');
	assert.match(connection.threadId, /^[a-f0-9-]+$/);
	tty = spawn(binary, ['resume', connection.threadId, '--remote', connection.endpoint, '--no-alt-screen'], { cwd: workspace, env, cols: 100, rows: 30, name: 'xterm-256color' });
	let exited = false; tty.onExit(() => { exited = true; }); tty.onData(data => { output = (output + data).slice(-100000); });
	const deadline = Date.now() + 12000;
	while (Date.now() < deadline && !exited && !output.includes('OpenAI Codex') && !output.includes('Codex')) await new Promise(resolve => setTimeout(resolve, 100));
	await new Promise(resolve => setTimeout(resolve, 1500));
	assert.equal(exited, false, output);
	assert.ok(!/thread not found|No saved session|Failed to resume|already has an active writer/i.test(output), output);
	const readyDeadline = Date.now() + 12000;
	while (!output.includes('fixture-model') && !exited && Date.now() < readyDeadline) await new Promise(resolve => setTimeout(resolve, 100));
	assert.ok(output.includes('fixture-model'), 'The real Codex TUI must finish attaching the configured model: ' + output);
	assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), config);
	const turn = await owner.run('controlled', 'fixture-run', 'Return the local fixture response only.');
	assert.equal(turn.stop, undefined, JSON.stringify(turn));
	assert.match(turn.report, /Native Codex structured transport verified/);
	assert.ok(fixtureRequests >= 1);
	const input = fs.readFileSync(path.join(reports, 'provider-input.json'), 'utf8');
	assert.ok(input.includes('KEEP_GLOBAL_INSTRUCTIONS') && input.includes('KEEP_PROFILE_INSTRUCTIONS'), 'The TUI must preserve the controller context');
	let approvalSeen = false;
	const subscription = owner.onDidChange(event => {
		if (event.kind !== 'approval') return;
		assert.equal(fs.existsSync(approvalFile), false, 'The command must wait for approval');
		assert.match(event.detail, /approved.txt/);
		approvalSeen = true;
		owner.respond('controlled', event.approvalId, true);
	});
	commandPhase = true;
	const commandTurn = await owner.run('controlled', 'approval-run', 'Run the isolated local approval fixture.');
	subscription.dispose();
	assert.equal(commandTurn.stop, undefined, JSON.stringify(commandTurn));
	assert.equal(approvalSeen, true, 'Native Codex approval must reach the controller');
	assert.equal(fs.readFileSync(approvalFile, 'utf8'), 'approved');
	await owner.setWorkspace([]);
	assert.throws(() => owner.run('controlled', 'run', 'Must not execute'), /No structured/);
	assert.equal(fs.existsSync(connection.endpoint.replace('unix://', '')), false);
	await owner.setWorkspace([workspace]);
	const pending = owner.prepare({ sessionId: 'closing', executable: binary, cwd: workspace, configurationArgs: [], env: {} });
	await owner.close('closing');
	await assert.rejects(pending, /could not be verified/);
	assert.throws(() => owner.run('closing', 'late', 'Must not execute'), /No structured/);
	fs.writeFileSync(path.join(reports, 'result.json'), JSON.stringify({ passed: true, threadId: connection.threadId, configPreserved: true, nativeApprovalVerified: approvalSeen, localFixtureRequests: fixtureRequests, externalModelRequests: false }, null, 2));
	console.log('PASS real Codex server + TUI + structured local Responses turn + native command approval + config preservation + workspace revocation');
} finally {
	fs.writeFileSync(path.join(reports, 'tty.txt'), output);
	tty?.kill(); owner.dispose(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); fs.rmSync(temporary, { recursive: true, force: true });
}
