#!/usr/bin/env node
// Record the real installed Codex CLI inside an isolated OpenIDE window.
// Uses the user's existing Codex login, explicitly gpt-5.6-luna, never a fixture provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
const model = 'gpt-5.6-luna';
const realCodex = process.env.OPENIDE_DEMO_CODEX || path.join(os.homedir(), '.npm-global/bin/codex');
const ffmpeg = process.env.OPENIDE_DEMO_FFMPEG || '/nix/store/jfnnrn72slgs4ryx4g09lb97r193xddp-ffmpeg-8.1.1-bin/bin/ffmpeg';
const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe');
const output = process.env.OPENIDE_DEMO_OUTPUT || path.resolve(root, '../openide-web/public/demos');
const reports = path.join(root, '.build/demos/cli-mcp');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-real-codex-demo-'));
const workspace = path.join(temporary, 'taskboard');
const userData = path.join(temporary, 'user-data');
const binaries = path.join(temporary, 'bin');
for (const dir of [workspace, binaries, path.join(userData, 'User'), reports, output]) { fs.mkdirSync(dir, { recursive: true }); }
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const staging = fs.mkdtempSync(path.join(reports, 'export-'));
const cliVersion = execFileSync(realCodex, ['--version'], { encoding: 'utf8' }).trim();
const login = execFileSync(realCodex, ['login', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8'));
assert.ok(cache.models.some(candidate => candidate.slug === model && candidate.visibility === 'list'), `Requested model ${model} is absent from the local account catalog; refusing another model`);
assert.ok(cliVersion.startsWith('codex-cli '));
void login;
const launcher = path.join(binaries, 'codex');
// Only adds explicit invocation options; the exec target is the genuine installed Codex binary.
fs.writeFileSync(launcher, `#!/bin/sh\nexec ${quote(realCodex)} --model ${quote(model)} -c 'check_for_update_on_startup=false' -c 'model_reasoning_effort="low"' -c 'mcp_servers.openaiDeveloperDocs.enabled=false' --no-alt-screen "$@"\n`, { mode: 0o755 });
const shell = path.join(binaries, 'demo-shell');
fs.writeFileSync(shell, '#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(workspace, 'tasks.ts'), 'export interface Task {\n\tid: string;\n\ttitle: string;\n\tcompleted: boolean;\n}\n\nexport function pendingTasks(tasks: Task[]): number {\n\treturn tasks.filter(task => !task.completed).length;\n}\n');
fs.writeFileSync(path.join(workspace, 'README.md'), '# Taskboard\n\nA small task list. We want filters for all, pending and completed tasks.\n');
execFileSync('git', ['init', '-q', workspace]);
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false,
	'window.titleBarStyle': 'custom', 'window.zoomLevel': 0, 'editor.fontSize': 17,
	'editor.accessibilitySupport': 'on', 'editor.minimap.enabled': false, 'terminal.integrated.fontSize': 15,
	'workbench.colorTheme': 'Default Dark Modern', 'openide.agent.language': 'es',
}));
let app, page, video, started, ended, failure;
const milestones = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const mark = name => { milestones.push({ name, time: Date.now() }); console.log(name); };
async function palette(command) {
	await page.keyboard.press('Control+Shift+KeyP');
	await page.locator('.quick-input-widget input').first().fill(`>${command}`);
	await pause(500);
	await page.keyboard.press('Enter');
}
async function until(predicate, label, milliseconds = 120000) {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) { if (await predicate()) { return; } await pause(500); }
	throw new Error(`Timed out: ${label}`);
}
async function terminalText() {
	return page.locator('.openide-chat-agent-terminal .xterm-accessibility-tree').innerText();
}
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspace, '--user-data-dir', userData, '--shared-data-dir', path.join(temporary, 'shared'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1', PATH: `${binaries}${path.delimiter}/nix/store/g7svy17fhkg2cq3q4lfzzc0mmsl3d8hq-bubblewrap-0.11.2/bin${path.delimiter}${process.env.PATH}`, SHELL: shell },
		recordVideo: { dir: path.join(reports, 'raw'), size: { width: 1440, height: 900 } }, timeout: 90000,
	});
	page = await app.firstWindow(); video = page.video();
	await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('vscode-file:')).setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
	await palette('OpenIDE Agent: New chat');
	await page.locator('.openide-chat-head-collapse').first().waitFor();
	if (!await page.locator('.openide-chat-head-split-chevron').first().isVisible()) { await page.locator('.openide-chat-head-collapse').first().click(); }
	await page.locator('.openide-chat-head-split-chevron').first().click();
	const row = page.locator('.openide-chat-kind-installed [title]').filter({ hasText: 'Codex' }).first();
	await row.waitFor(); assert.equal(await row.getAttribute('title'), launcher);
	await row.click();
	await page.locator('.openide-chat-agent-terminal .xterm').waitFor({ state: 'visible' });
	await page.keyboard.press('Control+KeyB');
	const dock = await page.locator('.part.auxiliarybar').boundingBox();
	if (dock) {
		await page.mouse.move(dock.x - 2, dock.y + dock.height / 2);
		await page.mouse.down(); await page.mouse.move(690, dock.y + dock.height / 2, { steps: 15 }); await page.mouse.up();
	}
	await pause(5000);
	await page.screenshot({ path: path.join(reports, 'startup.png') });
	mark('cli-launched');
	await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus();
	await until(async () => {
		const text = await terminalText();
		if (/Update available|Updating Codex/.test(text)) { throw new Error('Unexpected update prompt; refusing automated input'); }
		if (/Yes, I trust this folder|Yes, continue/.test(text) && /trust|folder/.test(text)) {
			await page.keyboard.press('Enter');
			await pause(1000);
			return false;
		}
		return text.includes(model) && /context|shortcuts|GPT-5|model:/.test(text);
	}, 'real Codex prompt with the exact requested model', 40000);
	await page.screenshot({ path: path.join(reports, 'cli-ready.png') });
	// A file selection visible in the editor is the context the actual MCP call should return.
	await page.keyboard.press('Control+KeyP');
	await page.locator('.quick-input-widget input').first().fill(path.join(workspace, 'tasks.ts'));
	await pause(700); await page.keyboard.press('Enter');
	await page.locator('.part.editor .monaco-editor .view-lines').first().waitFor();
	await pause(1000);
	started = Date.now(); mark('recording-start');
	await page.locator('.part.editor .monaco-editor .view-lines').first().click();
	await page.keyboard.press('Control+KeyA');
	await pause(1500);
	await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus();
	const prompt = 'En español y breve. Usá solo MCP de OpenIDE: consultá getCurrentSelection y getWorkspaceFolders. Luego llamá openide_plan_save con título "Filtros de tareas" y un plan Markdown de tres pasos para agregar filtros Todas, Pendientes y Completadas a Taskboard. Esperá mi aprobación. No ejecutes comandos ni edites archivos. Al aprobarse respondé únicamente: "Plan revisado desde OpenIDE."';
	await page.keyboard.type(prompt, { delay: 8 }); await pause(1200);
	assert.ok((await terminalText()).includes('getCurrentSelection'), 'The prompt must reach the real terminal before submission');
	await page.keyboard.press('Enter'); mark('prompt-sent');
	const approval = page.locator('.notifications-toasts').getByRole('button', { name: /Approve and send back|Aprobar y devolver/, exact: true });
	const approved = new Set();
	await until(async () => {
		if (await approval.isVisible()) { return true; }
		const text = await terminalText();
		for (const tool of ['getWorkspaceFolders', 'getCurrentSelection', 'openide_plan_save']) {
			if (!approved.has(tool) && text.includes(`Allow the openide MCP server to run tool "${tool}"?`)) {
				await pause(1600);
				await page.screenshot({ path: path.join(reports, `${tool}.png`) });
				await page.locator('.openide-chat-agent-terminal .xterm-helper-textarea').focus();
				await page.keyboard.press('Enter');
				approved.add(tool); mark(`mcp-approved-once:${tool}`);
			}
		}
		if (/model.*not.*(available|supported)|usage limit|not authenticated/i.test(text)) {
			throw new Error('The requested account/model cannot complete this run; refusing a fallback');
		}
		return false;
	}, 'real OpenIDE plan review from Codex MCP', 180000);
	mark('real-mcp-plan-ready');
	const plan = path.join(workspace, '.openide/plans/filtros-de-tareas.md');
	assert.ok(fs.existsSync(plan), 'MCP must create the actual plan file');
	await pause(3500); await page.screenshot({ path: path.join(reports, 'plan-review.png') });
	await approval.click(); mark('plan-approved');
	await until(async () => /•\s*Plan revisado desde OpenIDE\./.test(await terminalText()), 'actual Codex completion after PLAN_APPROVED', 60000);
	await pause(4500);
	await page.screenshot({ path: path.join(reports, 'completed.png') });
	ended = Date.now(); mark('recording-end');
	fs.copyFileSync(plan, path.join(reports, 'plan.md'));
} catch (error) {
	failure = error;
	await page?.screenshot({ path: path.join(reports, 'failure.png') }).catch(() => {});
	console.error(error.message);
} finally {
	await app?.close().catch(() => {});
	const raw = video ? await video.path().catch(() => undefined) : undefined;
	fs.writeFileSync(path.join(reports, 'evidence.json'), JSON.stringify({ cliVersion, model, reasoningEffort: 'low', accountCatalogVerified: true, temporaryWorkspace: workspace, milestones, raw, failure: failure?.message }, null, 2));
	if (!failure && raw && started && ended) {
		const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', raw], { encoding: 'utf8' }));
		const duration = (ended - started) / 1000;
		const start = Math.max(0, Number(probe.format.duration) - duration - 1.5);
		for (const [extension, codec] of [['mp4', ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']], ['webm', ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6']]]) {
			execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', raw, '-t', String(duration), '-map', '0:v:0', '-an', ...codec, path.join(staging, `cli-mcp.${extension}`)], { timeout: 180000 });
		}
		execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, duration - 6)), '-i', path.join(staging, 'cli-mcp.mp4'), '-frames:v', '1', '-q:v', '2', path.join(staging, 'cli-mcp.jpg')]);
		for (const extension of ['mp4', 'webm']) {
			const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', path.join(staging, `cli-mcp.${extension}`)], { encoding: 'utf8' }));
			assert.ok(metadata.streams.length === 1 && metadata.streams[0].codec_type === 'video', 'The delivered demo must contain no audio track');
		}
		// Publish complete encodes only; the web app must never discover a partial video.
		for (const extension of ['jpg', 'webm', 'mp4']) {
			fs.renameSync(path.join(staging, `cli-mcp.${extension}`), path.join(output, `cli-mcp.${extension}`));
		}
		console.log(`Saved real CLI demo to ${output}`);
	}
}
if (failure) { process.exitCode = 1; }
