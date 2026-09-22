// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-selection-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-selection-'));
const output = path.join(root, '.build/chat-selection-runtime');
for (const dir of [path.join(tmp, 'profile/User'), path.join(tmp, 'workspace'), output]) { fs.mkdirSync(dir, { recursive: true }); }
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'openide.memory.captureMode': 'off' }));
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
	await page.locator('.monaco-workbench').waitFor({ timeout: 90000 });
	await page.evaluate(async base => {
		const { CommandsRegistry } = await import(base + 'platform/commands/common/commands.js');
		const { IInstantiationService } = await import(base + 'platform/instantiation/common/instantiation.js');
		const { OpenideChatResponseRenderer } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatResponseRenderer.js');
		const { OpenideChatListWidget } = await import(base + 'workbench/contrib/openideAgent/browser/chat/openideChatListWidget.js');
		const { createOpenideChatResponseItem, advanceOpenideChatResponseItem } = await import(base + 'workbench/contrib/openideAgent/common/chat/openideChatItem.js');
		const { MarkdownString } = await import(base + 'base/common/htmlContent.js');
		const { Event } = await import(base + 'base/common/event.js');
		const { observableValue } = await import(base + 'base/common/observable.js');
		CommandsRegistry.registerCommand('test.chatSelection', accessor => {
			const instantiation = accessor.get(IInstantiationService);
			const host = document.createElement('div'); host.className = 'openide-chat-native selection-fixture';
			host.style.cssText = 'position:absolute;left:300px;top:130px;width:640px;height:360px;z-index:1000;background:var(--oi-surface)';
			document.querySelector('.monaco-workbench').append(host);
			const renderer = instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 640), Event.None);
			const list = instantiation.createInstance(OpenideChatListWidget, host, { renderers: [renderer] });
			let content = 'Select this live answer while it is still growing.';
			let item = createOpenideChatResponseItem({ id: 'selection', requestId: 'request', content: [{ kind: 'markdown', value: new MarkdownString(content) }] });
			list.layout(360, 640); list.setItems([item]);
			window.selectionFixture = {
				append: () => { content += ' More streamed text arrives.'; item = advanceOpenideChatResponseItem(item, { content: [{ kind: 'markdown', value: new MarkdownString(content) }] }); list.setItems([item]); },
				long: () => { content += '\n\nAnother paragraph arrives while you copy the first one.'.repeat(30); item = advanceOpenideChatResponseItem(item, { content: [{ kind: 'markdown', value: new MarkdownString(content) }] }); list.setItems([item]); },
				reading: () => ({ scrollTop: list.scrollTop, following: list.isFollowingTail }),
				dispose: () => { list.dispose(); renderer.dispose(); host.remove(); },
			};
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await (await app.browserWindow(page)).evaluate(window => window.webContents.send('vscode:runAction', { id: 'test.chatSelection' }));
	const prose = page.locator('.selection-fixture .openide-chat-markdown p');
	await prose.waitFor();
	const box = await prose.boundingBox();
	await page.mouse.move(box.x + 1, box.y + 8); await page.mouse.down();
	await page.mouse.move(box.x + 180, box.y + 8, { steps: 10 }); await page.mouse.up();
	const selected = await page.evaluate(() => getSelection()?.toString());
	assert.ok(selected?.length > 8, 'dragging selects transcript text');
	assert.equal(await prose.evaluate(element => getComputedStyle(element).userSelect), 'text');
	await page.evaluate(() => window.selectionFixture.append());
	assert.equal(await page.evaluate(() => getSelection()?.toString()), selected, 'a streamed delta preserves the selection');
	await page.keyboard.press('Control+KeyC');
	assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), selected, 'native Copy copies the selected streaming text');
	await page.evaluate(() => window.selectionFixture.long());
	assert.equal(await page.evaluate(() => getSelection()?.toString()), selected);
	assert.deepEqual(await page.evaluate(() => window.selectionFixture.reading()), { scrollTop: 0, following: false }, 'new content does not scroll the selected text out of view');
	const row = page.locator('.selection-fixture .monaco-list-row');
	assert.equal(await row.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle === 'none' || style.outlineColor === 'rgba(0, 0, 0, 0)'; }), true, 'pointer selection does not draw a list focus outline');
	await page.screenshot({ path: path.join(output, 'selected-streaming-text.png') });
	await page.evaluate(() => window.selectionFixture.dispose());
	assert.deepEqual(errors, []);
	console.log('PASS: pointer selection, streaming continuity, native clipboard copy, and no inherited row focus outline.');
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
