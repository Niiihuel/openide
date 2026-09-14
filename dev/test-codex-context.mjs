// Copyright (c) OpenIDE. Licensed under the MIT License.
// Opt-in, credential-free compatibility check: OPENIDE_TEST_CODEX=/absolute/path/to/codex node dev/test-codex-context.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OpenideIdeServerMain } from '../vscode/out/vs/platform/openideAgentHost/electron-main/openideIdeServerMain.js';
import { NullLogService } from '../vscode/out/vs/platform/log/common/log.js';
const executable = process.env.OPENIDE_TEST_CODEX;
assert(executable && path.isAbsolute(executable), 'Set OPENIDE_TEST_CODEX to the Codex binary to test.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-codex-context-'));
const home = path.join(root, 'home'), workspace = path.join(root, 'workspace');
fs.mkdirSync(home); fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
const previousHome = process.env.CODEX_HOME;
process.env.CODEX_HOME = home;
const original = `developer_instructions = "KEEP_USER_INSTRUCTION ☃"\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`;
fs.writeFileSync(path.join(home, 'config.toml'), original);
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Project instructions\n\nKEEP_PROJECT_AGENTS_INSTRUCTION\n');
const owner = new OpenideIdeServerMain(new NullLogService());
async function context(profile) {
	const child = spawn(executable, ['--profile', profile, 'debug', 'prompt-input', 'Inspect the preview.'], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '';
	child.stdout.on('data', chunk => stdout += chunk);
	child.stderr.resume();
	const timer = setTimeout(() => child.kill(), 15000);
	const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }).finally(() => clearTimeout(timer));
	assert.equal(code, 0, 'Codex must render its context without a model call.');
	return stdout;
}
try {
	await owner.start({ ideName: 'OpenIDE test', workspaceFolders: [workspace], lockRootDir: root });
	const profile = await owner.prepareCodexContext(executable, workspace, 'openide_fixture');
	const profilePath = path.join(home, `${profile}.config.toml`);
	const rendered = await context(profile);
	assert(rendered.includes('KEEP_USER_INSTRUCTION'));
	assert(rendered.includes('KEEP_PROJECT_AGENTS_INSTRUCTION'));
	assert(rendered.includes('This MCP server belongs to the OpenIDE'));
	assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), original);
	if (process.platform !== 'win32') { assert.equal(fs.statSync(profilePath).mode & 0o777, 0o600); }
	console.log('PASS Codex receives OpenIDE orientation while preserving user instructions and AGENTS.md; config remains unchanged.');
	// Codex gives project config higher priority than a user profile. Preserve that user choice.
	fs.writeFileSync(path.join(workspace, '.codex/config.toml'), 'developer_instructions = "KEEP_PROJECT_OVERRIDE"\n');
	const projectProfile = await owner.prepareCodexContext(executable, workspace, 'openide_fixture');
	assert(fs.readFileSync(path.join(home, `${projectProfile}.config.toml`), 'utf8').includes('KEEP_PROJECT_OVERRIDE'));
	assert((await context(projectProfile)).includes('KEEP_PROJECT_OVERRIDE'));
	console.log('PASS higher-priority project instruction overrides remain authoritative.');
} finally {
	owner.dispose();
	assert.equal(fs.readdirSync(home).filter(name => /^openide-.*\.config\.toml$/.test(name)).length, 0);
	fs.rmSync(root, { recursive: true, force: true });
	if (previousHome === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previousHome; }
}
console.log('PASS private launch profiles are removed when the owning IDE server closes.');
