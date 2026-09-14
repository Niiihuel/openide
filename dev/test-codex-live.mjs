// Copyright (c) OpenIDE. Licensed under the MIT License.
// Explicit opt-in: uses the authenticated Codex CLI and consumes model usage.
// This tests intent-based selection with controlled tool responses, not browser or memory implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OpenideIdeServerMain } from '../vscode/out/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.js';
import { NullLogService } from '../vscode/out/vs/platform/log/common/log.js';
import { buildOpenideCliLaunch, getOpenideCli } from '../vscode/out/vs/workbench/contrib/openideAgent/common/openideAgentCliCatalog.js';
const executable = process.env.OPENIDE_LIVE_CODEX;
assert(executable && path.isAbsolute(executable), 'Set OPENIDE_LIVE_CODEX to the authenticated binary to test.');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-codex-intent-'));
const reportDirectory = path.resolve('.build/codex-discovery/live');
fs.mkdirSync(reportDirectory, { recursive: true });
const cases = [
	{ id: 'browser', prompt: 'Mirá la pantalla que tengo abierta en el navegador interno de OpenIDE y decime qué muestra. No abras otras ventanas ni cambies archivos.', tools: ['openide_browser_snapshot'], response: 'OPENIDE_BROWSER_CANARY: the visible preview heading is Panel de pedidos.' },
	{ id: 'memory', prompt: '¿Qué habíamos decidido sobre los reintentos de pagos en este proyecto? Revisá la memoria compartida del IDE. No guardes ni cambies nada.', tools: ['openide_memory_search', 'openide_memory_get'], response: 'OPENIDE_MEMORY_CANARY: payment retries reuse the same idempotency key, with at most three attempts. Canonical note: .openide/memory/notes/payment-retries.md' },
	{ id: 'map', prompt: 'Antes de tocar PaymentService, consultá el mapa del proyecto en el IDE y decime qué componentes dependen de él. No cambies archivos.', tools: ['openide_project_map_query'], response: 'OPENIDE_MAP_CANARY: CheckoutController and RetryWorker depend on PaymentService.' },
];
const server = new OpenideIdeServerMain(new NullLogService());
const calls = [];
let subscription;
try {
	const definitions = cases.flatMap(test => test.tools.map(name => ({ name, description: `${test.id === 'browser' ? "Inspect the user's visible OpenIDE browser page" : test.id === 'memory' ? 'Recall saved project decisions from shared OpenIDE memory' : 'Query architecture, dependencies and change impact in the OpenIDE Project Map'}. Read-only diagnostic fixture.`, inputSchema: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string' } }, additionalProperties: true }, annotations: { readOnlyHint: true, destructiveHint: false } })));
	const info = await server.start({ ideName: 'OpenIDE test', workspaceFolders: [workspace], lockRootDir: workspace }, definitions);
	subscription = server.onDidRequestTool(request => {
		calls.push(request.tool);
		const test = cases.find(test => test.tools.includes(request.tool));
		server.respondTool(request.requestId, { content: [{ type: 'text', text: test?.response ?? 'This fixture does not execute editor or file operations.' }], isError: !test });
	});
	const contextProfile = await server.prepareCodexContext(executable, workspace, 'openide_intent_test');
	const launch = buildOpenideCliLaunch(getOpenideCli('codex'), executable, undefined, { name: 'openide_intent_test', url: `http://127.0.0.1:${info.port}/mcp`, token: info.authToken, tokenEnvVar: 'OPENIDE_MCP_TOKEN', contextProfile });
	const reports = [];
	for (const test of cases) {
		const start = calls.length;
		const child = spawn(executable, [...launch.args, 'exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', ...(process.env.OPENIDE_CODEX_TEST_MODEL ? ['-m', process.env.OPENIDE_CODEX_TEST_MODEL] : []), test.prompt], { cwd: workspace, env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		child.stdout.on('data', chunk => stdout += chunk);
		const errors = fs.createWriteStream(path.join(reportDirectory, `${test.id}.stderr`), { mode: 0o600 });
		child.stderr.pipe(errors);
		const timer = setTimeout(() => child.kill(), 120000);
		const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timer));
		fs.writeFileSync(path.join(reportDirectory, `${test.id}.jsonl`), stdout, { mode: 0o600 });
		const selected = calls.slice(start);
		reports.push({ intent: test.id, exitCode: code, calls: selected, readCanary: stdout.includes(`OPENIDE_${test.id.toUpperCase()}_CANARY`) });
		fs.writeFileSync(path.join(reportDirectory, 'result.json'), JSON.stringify(reports, null, 2));
		assert.equal(code, 0);
		assert(selected.some(name => test.tools.includes(name)), `${test.id}: Codex must choose an OpenIDE tool from the natural request.`);
		assert(reports.at(-1).readCanary, `${test.id}: Codex must read the returned evidence.`);
		console.log(`PASS natural ${test.id} request: ${selected.join(', ')}`);
	}
} finally {
	subscription?.dispose();
	server.dispose();
	fs.rmSync(workspace, { recursive: true, force: true });
}
