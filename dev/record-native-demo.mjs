#!/usr/bin/env node
// Copyright (c) OpenIDE. All rights reserved.
// Records the real provider configuration UI in a disposable profile, without credentials.
// Native OAuth is intentionally not copied from the separate Codex CLI account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const ffmpeg = process.env.OPENIDE_DEMO_FFMPEG || '/nix/store/jfnnrn72slgs4ryx4g09lb97r193xddp-ffmpeg-8.1.1-bin/bin/ffmpeg';
const reports = path.join(root, '.build/demos/providers');
const output = process.env.OPENIDE_DEMO_OUTPUT || reports;
const signInOnly = process.env.OPENIDE_DEMO_SIGN_IN === '1';
const nativeRecord = process.env.OPENIDE_DEMO_NATIVE_RECORD === '1';
const nativeProfile = nativeRecord ? JSON.parse(fs.readFileSync(path.join(reports, 'native-profile.json'), 'utf8')) : undefined;
const temporary = nativeProfile?.temporary || fs.mkdtempSync(path.join(os.tmpdir(), 'openide-provider-demo-'));
const userData = path.join(temporary, 'user-data');
const workspace = path.join(temporary, 'taskboard');
for (const directory of [path.join(userData, 'User'), workspace, reports, output]) { fs.mkdirSync(directory, { recursive: true }); }
fs.writeFileSync(path.join(workspace, 'README.md'), '# Taskboard\n\nA small task manager built with OpenIDE.\n');
if (!nativeRecord) { fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom', 'window.zoomLevel': 0,
	'workbench.colorTheme': 'Default Dark Modern', 'openide.agent.language': 'es',
	'openide.agent.provider': 'openai-codex', 'openide.agent.model': 'gpt-5.6-luna',
	'openide.agent.fallbackProviders': [], 'openide.agent.fallbackChain': [],
})); }
if (nativeRecord) {
	assert.equal(nativeProfile.connected, true, 'A supported native sign-in must complete first');
	fs.writeFileSync(path.join(workspace, 'tasks.ts'), 'export interface Task {\n\tid: string;\n\ttitle: string;\n\tcompleted: boolean;\n}\n\nexport function pendingTasks(tasks: Task[]): number {\n\treturn tasks.filter(task => !task.completed).length;\n}\n');
	execFileSync('git', ['init', '-q', workspace]);
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const milestones = [];
const segments = [];
let app, page, video, started, ended, failure;
const mark = name => { milestones.push({ name, time: Date.now() }); console.log(name); };
async function palette(command) {
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill(`>${command}`);
	await pause(700); await page.keyboard.press('Enter');
}
function journalRecords() {
	const directory = path.join(userData, 'User/globalStorage/openide/run-journal');
	if (!fs.existsSync(directory)) { return []; }
	return fs.readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.jsonl')).flatMap(file => {
		const content = fs.readFileSync(path.join(directory, file), 'utf8');
		return content.slice(0, content.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
	});
}
async function waitNative(predicate, label) {
	const deadline = Date.now() + 150000;
	while (Date.now() < deadline) {
		const requests = journalRecords().filter(record => record.event.kind === 'model/request' && record.event.payload.phase === 'attempt');
		assert.ok(requests.length <= 10, 'Bounded demo request budget exceeded');
		for (const record of requests) {
			assert.equal(record.event.payload.request.model, 'gpt-5.6-luna', 'Only the user-requested Luna model may run');
			assert.equal(record.event.payload.request.effort, 'low', 'Only low reasoning may run');
		}
		const error = page.locator('.openide-chat-notice-error:visible').first();
		if (await error.count()) { throw new Error(await error.innerText()); }
		if (await predicate()) { return; }
		const approval = page.locator('.openide-chat-approval:visible').filter({ hasText: 'tasks.ts' }).locator('.openide-chat-abtn.primary:visible').first();
		if (await approval.count()) { await pause(2500); await approval.click(); mark('file-edit-approved'); }
		await pause(400);
	}
	throw new Error(`Timed out: ${label}`);
}
async function recordNativeFlow() {
	await palette('OpenIDE Agent: New chat');
	await page.locator('.openide-chat-composer textarea').first().waitFor();
	await page.keyboard.press('Control+KeyB');
	const dock = await page.locator('.part.auxiliarybar').boundingBox();
	if (dock) {
		await page.mouse.move(dock.x - 2, dock.y + dock.height / 2);
		await page.mouse.down(); await page.mouse.move(690, dock.y + dock.height / 2, { steps: 15 }); await page.mouse.up();
	}
	await page.locator('.openide-composer-model').first().click();
	await page.locator('.openide-menu-search').fill('Luna');
	const luna = page.locator('.openide-mp-row').filter({ hasText: 'GPT-5.6 Luna' }).first();
	await luna.waitFor({ timeout: 30000 });
	await luna.hover();
	await luna.locator('.openide-mp-edit').click();
	await page.locator('.openide-mp-effort-flyout .openide-menu-row').filter({ hasText: /^Low$|^Bajo$/ }).click();
	await luna.click();
	assert.match(await page.locator('.openide-composer-model').first().innerText(), /Luna/);
	assert.match(await page.locator('.openide-composer-model-effort').first().innerText(), /Low|Bajo/i);
	await page.keyboard.press('Control+KeyP');
	await page.locator('.quick-input-widget input').first().fill(path.join(workspace, 'tasks.ts'));
	await pause(700); await page.keyboard.press('Enter');
	await page.locator('.part.editor .monaco-editor .view-lines').first().waitFor();
	await pause(1800);
	const harnessStart = Date.now(); mark('harness-start');
	const input = page.locator('.openide-chat-composer textarea').first();
	await input.fill('Leé tasks.ts y agregá completedTasks(tasks: Task[]): number para contar las tareas completadas. Usá read_file y edit_file o write_file. Solo ese cambio, sin comandos ni pruebas. Al terminar explicá el resultado en una frase.');
	await pause(1800); await input.press('Enter');
	await waitNative(async () => /function completedTasks/.test(fs.readFileSync(path.join(workspace, 'tasks.ts'), 'utf8')) && !await page.locator('.openide-composer-send.running').count(), 'native Luna edit');
	await pause(4000); mark('harness-completed');
	segments.push({ id: 'harness', start: harnessStart, end: Date.now() });
	await page.screenshot({ path: path.join(reports, 'harness-completed.png') });
	const planStart = Date.now(); mark('plan-start');
	await page.locator('.openide-composer-mode').first().click();
	await page.locator('.openide-menu-mode .openide-menu-row').filter({ hasText: /^Plan$/ }).click();
	await pause(1500);
	await input.fill('Planificá filtros Todas, Pendientes y Completadas para Taskboard. No implementes todavía. Leé README.md y usá plan_save con título "Filtros de tareas", un resumen breve y exactamente tres tareas bajo ## Tareas. No ejecutes comandos ni otras herramientas.');
	await pause(1800); await input.press('Enter');
	const planFile = path.join(workspace, '.openide/plans/filtros-de-tareas.md');
	await waitNative(async () => fs.existsSync(planFile), 'native plan_save review');
	await pause(4500);
	assert.match(fs.readFileSync(planFile, 'utf8'), /## Tareas/);
	fs.copyFileSync(planFile, path.join(reports, 'native-plan.md'));
	await page.screenshot({ path: path.join(reports, 'native-plan-review.png') });
	segments.push({ id: 'plan', start: planStart, end: Date.now() });
	const requests = journalRecords().filter(record => record.event.kind === 'model/request' && record.event.payload.phase === 'attempt');
	fs.writeFileSync(path.join(reports, 'native-evidence.json'), JSON.stringify({ model: 'gpt-5.6-luna', effort: 'low', requests: requests.length, tools: journalRecords().filter(record => record.event.kind === 'tool/intent' && typeof record.event.payload.callId === 'string').map(record => record.event.payload.name), plan: fs.readFileSync(planFile, 'utf8'), modifiedFile: fs.readFileSync(path.join(workspace, 'tasks.ts'), 'utf8'), segments }, null, 2));
	ended = Date.now();
}
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' },
		recordVideo: signInOnly ? undefined : { dir: path.join(reports, 'raw'), size: { width: 1440, height: 900 } }, timeout: 90000,
	});
	page = await app.firstWindow(); video = page.video();
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('vscode-file:')).setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
	if (nativeRecord) { await recordNativeFlow(); } else {
	await palette('Connect a provider');
	await page.locator('.openide-settings-provider-filter input').waitFor({ timeout: 30000 });
	for (const close of await page.locator('.notifications-toasts .codicon-notifications-clear').all()) { await close.click(); }
	if (signInOnly) {
		await page.locator('.openide-settings-provider-filter input').fill('Codex');
		await pause(1500);
		await page.locator('.openide-settings-provider-row:visible').filter({ hasText: /Codex/ }).first().locator('.openide-settings-setting-name').click();
		await page.locator('.openide-settings-provider-name').waitFor();
		await page.locator('.openide-settings-card .monaco-button').filter({ hasText: /Sign in|Iniciar sesi.n/ }).first().click();
		const external = page.locator('.monaco-dialog-box').filter({ hasText: 'https://auth.openai.com/codex/device' });
		await external.waitFor({ timeout: 30000 });
		await external.getByRole('button', { name: 'Open', exact: true }).click();
		await page.locator('.openide-settings-code-value').waitFor({ timeout: 30000 });
		console.log(`Authorize this isolated OpenIDE profile at https://auth.openai.com/codex/device with code ${await page.locator('.openide-settings-code-value').innerText()}`);
		await page.waitForFunction(() => {
			const text = document.querySelector('.openide-settings-provider-head')?.textContent || '';
			return /active|connected/i.test(text) && !/not connected/i.test(text);
		}, undefined, { timeout: 14 * 60 * 1000 });
		fs.writeFileSync(path.join(reports, 'native-profile.json'), JSON.stringify({ temporary, workspace, userData, connected: true }, null, 2), { mode: 0o600 });
		mark('native-codex-connected');
	} else {
	await pause(2500);
	started = Date.now(); mark('provider-catalog');
	await page.screenshot({ path: path.join(reports, 'catalog.png') });
	await pause(2500);
	const filter = page.locator('.openide-settings-provider-filter input');
	await filter.fill('Codex');
	await pause(1500);
	await page.locator('.openide-settings-provider-row').filter({ hasText: /Codex/ }).first().click();
	await page.locator('.openide-settings-provider-name').waitFor();
	assert.match(await page.locator('.openide-settings-provider-name').innerText(), /Codex/);
	mark('codex-account-connection-options');
	await pause(4500);
	await page.screenshot({ path: path.join(reports, 'codex.png') });
	await page.locator('.openide-settings-provider-back [role="button"]').click();
	await page.locator('.openide-settings-provider-filter input').fill('OpenAI');
	await pause(1400);
	await page.locator('.openide-settings-provider-row:visible').filter({ hasText: /OpenAI/ }).first().click();
	await page.locator('.openide-settings-provider-name').waitFor();
	assert.match(await page.locator('.openide-settings-provider-name').innerText(), /OpenAI/);
	mark('api-key-connection-options');
	await pause(4500);
	await page.screenshot({ path: path.join(reports, 'api-key.png') });
	await page.locator('.openide-settings-provider-back [role="button"]').click();
	await page.locator('.openide-settings-provider-filter input').fill('Ollama');
	await pause(1400);
	await page.locator('.openide-settings-provider-row').filter({ hasText: /Ollama/ }).first().click();
	await page.locator('.openide-settings-provider-name').waitFor();
	assert.match(await page.locator('.openide-settings-provider-name').innerText(), /Ollama/);
	mark('local-provider-options');
	await pause(4500);
	await page.screenshot({ path: path.join(reports, 'local.png') });
	await page.locator('.openide-settings-provider-back [role="button"]').click();
	await page.locator('.openide-settings-provider-filter input').fill('');
	await pause(2500);
	ended = Date.now(); mark('recording-end');
	}
	}
} catch (error) {
	failure = error;
	if (!signInOnly) { await page?.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {}); }
	console.error(error.message);
} finally {
	await app?.close().catch(() => {});
	const raw = video ? await video.path().catch(() => undefined) : undefined;
	fs.writeFileSync(path.join(reports, signInOnly ? 'auth-status.json' : nativeRecord ? 'native-run-status.json' : 'evidence.json'), JSON.stringify({ kind: signInOnly ? 'native-codex-sign-in' : nativeRecord ? 'real-native-harness-and-plan' : 'real-provider-configuration-ui', requestAttempts: nativeRecord ? journalRecords().filter(record => record.event.kind === 'model/request' && record.event.payload.phase === 'attempt').length : 0, newConnections: signInOnly && !failure ? 1 : 0, nativeAccount: 'separate OAuth sign-in; no CLI tokens copied', milestones, raw, failure: failure?.message }, null, 2));
	if (!failure && raw && started && ended) {
		const probe = JSON.parse(execFileSync(path.join(path.dirname(ffmpeg), 'ffprobe'), ['-v', 'error', '-show_format', '-of', 'json', raw], { encoding: 'utf8' }));
		const duration = (ended - started) / 1000;
		const start = Math.max(0, Number(probe.format.duration) - duration - 1.5);
		for (const [extension, codec] of [['mp4', ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']], ['webm', ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6']]]) {
			execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', raw, '-t', String(duration), '-map', '0:v:0', '-an', ...codec, path.join(output, `providers.${extension}`)], { timeout: 180000 });
		}
		execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', path.join(output, 'providers.mp4'), '-frames:v', '1', '-q:v', '2', path.join(output, 'providers.jpg')]);
		console.log(`Saved real provider configuration demo to ${output}`);
	}
	if (!failure && nativeRecord && raw && ended) {
		const probe = JSON.parse(execFileSync(path.join(path.dirname(ffmpeg), 'ffprobe'), ['-v', 'error', '-show_format', '-of', 'json', raw], { encoding: 'utf8' }));
		for (const segment of segments) {
			const destination = path.join(root, '.build/demos', segment.id); fs.mkdirSync(destination, { recursive: true });
			const start = Math.max(0, Number(probe.format.duration) - (ended - segment.start) / 1000 - 1.5);
			const duration = (segment.end - segment.start) / 1000;
			for (const [extension, codec] of [['mp4', ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']], ['webm', ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6']]]) {
				execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', raw, '-t', String(duration), '-map', '0:v:0', '-an', ...codec, path.join(destination, `${segment.id}.${extension}`)], { timeout: 180000 });
			}
			execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, duration - 4)), '-i', path.join(destination, `${segment.id}.mp4`), '-frames:v', '1', '-q:v', '2', path.join(destination, `${segment.id}.jpg`)]);
		}
	}
	if ((!signInOnly && !nativeRecord) || failure && !nativeRecord) { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (failure) { process.exitCode = 1; }
