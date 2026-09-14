// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-chat-welcome-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-chat-welcome-'));
const output = path.join(root, '.build/chat-welcome-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom',
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow();
	ide.on('pageerror', error => errors.push(error.message));
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { t, openideStringFor } = await import(base + 'workbench/contrib/openideAgent/common/openideStrings.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.chatWelcome', title: 'Chat Welcome Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService), views = accessor.get(IViewsService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Welcome fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value, sessions = view._widget.value.sessionStore;
				const saved = sessions.createBackground('Saved welcome fixture', [{ role: 'user', content: 'A previous task' }, { role: 'assistant', content: 'Previous answer' }]);
				widget.newSession();
				widget._composer.value = '';
				let submits = 0;
				const listener = widget._composer.onDidSubmit(() => submits++);
				window.chatWelcomeFixture = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					stats: () => ({ submits, items: widget.controller.items.length, draft: widget._composer.value }),
					openSaved: () => widget.openSession(saved),
					clearHistory: () => { sessions.delete(saved); widget.refreshSessions(); },
					newSession: () => { widget.newSession(); widget._composer.value = ''; },
					label: key => t(key),
					spanish: key => openideStringFor(key, 'es'),
					dispose: () => listener.dispose(),
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Chat Welcome Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Chat Welcome Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.chatWelcomeFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.chatWelcomeFixture.open());
	const agent = await opened;
	agent.on('pageerror', error => errors.push(error.message));
	const welcome = agent.locator('.openide-chat-empty:visible');
	await welcome.waitFor();
	const composer = agent.locator('.openide-chat-input-card textarea:visible');
	const label = key => ide.evaluate(key => window.chatWelcomeFixture.label(key), key);
	assert.equal(await welcome.locator('.openide-chat-empty-workspace-name').innerText(), 'workspace');
	assert.equal(await welcome.getByRole('heading', { level: 2 }).innerText(), 'What would you like to work on?');
	assert.equal(await welcome.locator('.openide-empty-state-description').innerText(), await label('chat.empty.text'));
	assert.equal(await welcome.locator('.openide-empty-state-brand-icon').count(), 0);
	assert.equal(await welcome.locator('.openide-chat-empty-mark').count(), 0);
	assert.equal(await welcome.locator('.openide-empty-state-action.oi-btn.oi-dock-row').count(), 4);
	assert.equal(await welcome.locator('.openide-empty-state-keybinding').count(), 3, 'draft suggestions display their registered Agents shortcuts');
	await welcome.getByRole('button', { name: await label('chat.empty.explore'), exact: true }).click();
	assert.equal(await composer.inputValue(), await label('chat.empty.explorePrompt'));
	assert.equal(await composer.evaluate(element => element === document.activeElement), true);
	const existing = '  Keep this draft exactly.\n';
	await composer.fill(existing);
	const plan = welcome.getByRole('button', { name: await label('chat.empty.plan'), exact: true });
	await plan.focus();
	await agent.keyboard.press('Enter');
	assert.equal(await composer.inputValue(), existing + '\n\n' + await label('chat.empty.planPrompt'));
	const problem = welcome.getByRole('button', { name: await label('chat.empty.debug'), exact: true });
	await composer.fill('');
	await problem.focus();
	await agent.keyboard.press('Space');
	assert.equal(await composer.inputValue(), await label('chat.empty.debugPrompt'));
	assert.deepEqual(await ide.evaluate(() => window.chatWelcomeFixture.stats()), { submits: 0, items: 0, draft: await composer.inputValue() });
	await agent.emulateMedia({ reducedMotion: 'reduce' });
	assert.equal(await welcome.evaluate(element => getComputedStyle(element).animationName), 'none');
	await composer.fill('');
	await agent.screenshot({ path: path.join(output, 'welcome-wide.png') });
	await welcome.getByRole('button', { name: await label('chat.empty.sessions'), exact: true }).click();
	await welcome.waitFor({ state: 'hidden' });
	await ide.evaluate(() => window.chatWelcomeFixture.openSaved());
	assert.equal(await agent.locator('.openide-chat-empty:visible').count(), 0);
	await ide.evaluate(() => window.chatWelcomeFixture.newSession());
	await welcome.waitFor();
	await welcome.evaluate(element => { element.style.width = '280px'; element.style.height = '280px'; });
	assert.equal(await welcome.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'no horizontal overflow in a narrow chat');
	await welcome.getByRole('button', { name: await label('chat.empty.sessions'), exact: true }).scrollIntoViewIfNeeded();
	assert.equal(await welcome.getByRole('button', { name: await label('chat.empty.sessions'), exact: true }).isVisible(), true);
	await welcome.screenshot({ path: path.join(output, 'welcome-narrow.png') });
	assert.equal(await ide.evaluate(() => window.chatWelcomeFixture.spanish('chat.empty.plan')), 'Planificar un cambio');
	assert.equal(await ide.evaluate(() => window.chatWelcomeFixture.spanish('chat.empty.debugPrompt')), 'Ayudame a investigar un problema. Primero preguntame qué ocurre, qué esperaba y cómo reproducirlo.');
	await ide.evaluate(() => window.chatWelcomeFixture.clearHistory());
	assert.equal(await welcome.getByRole('button', { name: await label('chat.empty.sessions'), exact: true }).isVisible(), false, 'empty sessions do not offer history');
	await ide.evaluate(() => window.chatWelcomeFixture.dispose());
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, assertions: ['context', 'shared controls', 'draft preservation', 'no automatic send', 'shared draft', 'keyboard Enter and Space', 'history', 'reduced motion', 'narrow overflow', 'Spanish strings'] }, null, 2));
	console.log('Chat welcome runtime passed.');
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
