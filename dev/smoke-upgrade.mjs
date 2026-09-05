// Run after the client typecheck, transpilation, built-in extensions and icon build.
// On NixOS: ./result-fhs/bin/openide-build -c 'node dev/smoke-upgrade.mjs'
// Under Xvfb, unset WAYLAND_DISPLAY so Electron uses the isolated display.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'vscode');
const { _electron } = createRequire(path.join(source, 'package.json'))('playwright');
const output = path.join(repo, '.build', 'upgrade-smoke');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(path.join(output, 'profile-'));
mkdirSync(path.join(profile, 'User'), { recursive: true });
writeFileSync(path.join(profile, 'User', 'settings.json'), JSON.stringify({ 'zenMode.fullScreen': false }));
const errors = [];
let app;
try {
	app = await _electron.launch({
		executablePath: path.join(source, '.build/electron/openide'),
		args: [source, '--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes',
			'--user-data-dir', profile, '--extensions-dir', path.join(profile, 'extensions'),
			...(process.env.XDG_SESSION_TYPE === 'x11' ? ['--ozone-platform=x11'] : [])],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 45000,
	});
	const page = await app.firstWindow();
	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => { if (message.type() === 'error') { errors.push(`${message.text()} ${JSON.stringify(message.location())}`); } });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
	await page.waitForSelector('.watermark-launcher-action', { state: 'visible', timeout: 45000 });
	await page.evaluate(() => document.fonts.ready);
	assert.equal(await page.locator('.watermark-launcher-action:visible').count(), 3);
	const geometry = await page.evaluate(() => {
		const box = selector => document.querySelector(selector).getBoundingClientRect();
		const container = box('.editor-group-watermark-wrapper');
		const content = box('.watermark-container');
		return { centerDelta: Math.abs(content.y + content.height / 2 - container.y - container.height / 2), top: content.y - container.y };
	});
	assert.ok(geometry.centerDelta < 80 && geometry.top > 40, `Welcome content is not centered: ${JSON.stringify(geometry)}`);
	await page.screenshot({ path: path.join(output, 'welcome.png') });
	await page.keyboard.press('Control+Shift+KeyP');
	const palette = page.locator('.quick-input-widget input').first();
	await palette.fill('>OpenIDE Agent: New chat');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /New chat/i }).first().waitFor();
	await page.keyboard.press('Enter');
	const composer = page.locator('.openide-chat-composer textarea').first();
	await composer.waitFor({ state: 'visible' });
	await composer.fill('Upgrade smoke test draft');
	await page.screenshot({ path: path.join(output, 'chat.png') });
	assert.equal(await composer.inputValue(), 'Upgrade smoke test draft');
	await page.keyboard.press('Control+KeyK');
	await page.keyboard.press('KeyZ');
	await page.locator('.part.statusbar').waitFor({ state: 'hidden' });
	await composer.waitFor({ state: 'hidden' });
	await page.keyboard.press('Control+KeyK');
	await page.keyboard.press('KeyZ');
	await page.locator('.part.statusbar').waitFor({ state: 'visible' });
	await composer.waitFor({ state: 'visible' });
	assert.equal(await composer.inputValue(), 'Upgrade smoke test draft');
	const runtime = await app.evaluate(({ app }) => ({ name: app.getName(), electron: process.versions.electron, node: process.versions.node }));
	writeFileSync(path.join(output, 'result.json'), JSON.stringify({ runtime, geometry, errors }, null, 2));
	assert.deepEqual(errors, [], 'Workbench reported errors');
	console.log('PASS: welcome layout, built-in extensions, native chat, draft preservation, Zen enter/exit', runtime);
} finally {
	try { await app?.close(); } finally { rmSync(profile, { recursive: true, force: true }); }
}
