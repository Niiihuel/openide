// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') {
	throw new Error('Use dev/run-virtual-gui.mjs');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-window-'));
const output = path.join(root, '.build/agent-window-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace/src/nested'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'workspace/src/nested/component.ts'), 'export const fromAgentFiles = true;\n');
fs.writeFileSync(path.join(tmp, 'workspace/hidden.txt'), 'Excluded');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'files.exclude': { '**/hidden.txt': true },
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
let app;
const runtimeErrors = [];
const observeErrors = page => {
	page.on('pageerror', error => { runtimeErrors.push(error.message); console.error(error); });
	page.on('console', message => {
		if (message.type() === 'error' && !message.text().includes('No default agent registered')) {
			runtimeErrors.push(message.text()); console.error(message.text());
		}
	});
};
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'),
		cwd: path.join(root, 'vscode'),
		args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	observeErrors(ide);
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentWindow', title: 'Agent Window Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService);
				const views = accessor.get(IViewsService);
				const editors = accessor.get(IEditorService);
				const agent = accessor.get(IOpenideAgentService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Agent window fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const widget = view._widget.value;
				const sessions = view._widget.value.sessionStore;
				const first = sessions.createBackground('Window fixture first', [{ role: 'user', content: 'First shared conversation', messageId: 'first-message' }, { role: 'assistant', content: 'First shared answer' }]);
				const second = sessions.createBackground('Window fixture second', [{ role: 'user', content: 'Second shared conversation', messageId: 'second-message' }, { role: 'assistant', content: 'Second shared answer' }]);
				widget.refreshSessions();
				widget.openSession(second);
				for (let index = 0; index < 24; index++) {
					const changed = index === 0 ? 'src/nested/component.ts' : `src/change-${index}.ts`;
					agent.diffSnapshot.setBaselineOnce(changed, '', false);
					agent.diffSnapshot.markPending(changed, true, index + 1, index % 3);
				}
				const runs = [];
				const approvals = [];
				let emit;
				let settle;
				let cancelled = false;
				// The actual controller and both renderers remain real; only provider execution is isolated.
				agent.getActiveProviderId = () => 'fixture-provider';
				agent.getModel = () => 'fixture-model';
				agent.buildMentionContext = async () => undefined;
				agent.hookUserPromptSubmit = async () => undefined;
				agent.runMessages = (messages, onEvent, token, options) => {
					runs.push(options);
					emit = onEvent;
					token.onCancellationRequested(() => { cancelled = true; settle?.(); });
					return new Promise(resolve => { settle = resolve; });
				};
				agent.resolveApproval = (id, answer) => {
					approvals.push({ id, answer });
					emit({ type: 'approval', name: 'run_command', decision: answer.decision ?? answer });
				};
				window.agentWindowFixture = {
					activeFile: () => editors.activeEditor?.resource?.path,
					seedReview: () => agent._onDidChangeFileDiff.fire({ path: 'src/nested/component.ts', added: 1, removed: 0 }),
					deleteStored: id => sessions.delete(id),
					first, second, runs, approvals,
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					active: () => widget.controller.activeConversationId,
					busy: () => widget.controller.isBusy,
					cancelled: () => cancelled,
					emit: event => emit(event),
					finish: () => { emit({ type: 'done' }); settle(); },
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Window Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Agent Window Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentWindowFixture);
	const openWindow = async () => {
		const opened = app.waitForEvent('window', { timeout: 30000 });
		await ide.evaluate(() => window.agentWindowFixture.open());
		const page = await opened;
		observeErrors(page);
		await page.locator('.openide-agent-window .openide-chat-native').filter({ has: page.locator('.openide-chat-input-card') }).waitFor();
		return page;
	};
	let agent = await openWindow();
	assert.notEqual(agent, ide);
	await agent.locator('.openide-agent-window-sidebar').waitFor();
	await agent.locator('.openide-agent-window-context').waitFor({ state: 'attached' });
	await agent.locator('.part.titlebar').waitFor();
	await agent.locator('.part.titlebar .menubar').waitFor();
	for (const control of ['.window-minimize', '.window-max-restore', '.window-close']) { await agent.locator('.part.titlebar ' + control).waitFor(); }
	await agent.locator('.part.statusbar').waitFor();
	for (const id of ['openide.agent.usage', 'openide.agent.footer.environment', 'openide.agent.footer.terminal', 'openide.agent.footer.browser']) {
		assert.equal(await agent.locator(`[id="${id}"]`).count(), 1, `native footer entry ${id}`);
	}
	await agent.locator('[id="openide.agent.usage"]').click();
	await agent.locator('.openide-usage-menu').waitFor();
	await agent.screenshot({path:path.join(output, 'agent-window-footer-menu.png')});
	await agent.waitForFunction(() => {
		const menu = document.querySelector('.openide-usage-menu')?.getBoundingClientRect();
		const footer = document.querySelector('.part.statusbar')?.getBoundingClientRect();
		return menu && footer && menu.bottom <= footer.top + 1;
	}, undefined, { timeout: 5000 });
	await agent.keyboard.press('Escape');
	await agent.locator('[id="openide.agent.footer.environment"]').click();
	assert.equal(await agent.locator('.openide-agent-window-context').isVisible(), true, 'footer opens conversation environment');

	assert.equal(await agent.locator('.openide-agent-island:visible').count(), 3, 'sidebar, chat and context use island surfaces');
	const openFiles = async () => {
		await agent.locator('[id="openide.agent.footer.environment"]').click();
		await agent.locator('.openide-agent-window-views').getByRole('button', { name: 'Open view', exact: true }).click();
		await agent.getByRole('menuitem', { name: 'Files', exact: true }).click();
		// Native context menu actions can run after the click returns. Wait for the real view
		// before reading its geometry; a hidden Files host reports x = 0.
		await agent.locator('.openide-files-editor').waitFor({ state: 'visible' });
		await agent.getByRole('tree', { name: 'Files', exact: true }).waitFor({ state: 'visible' });
	};
	const closeEditor = async () => {
		await agent.getByRole('button',{name:'Open in modal',exact:true}).click();
		await agent.locator('.monaco-modal-editor-block .modal-editor-header .codicon-close').click();
		await agent.locator('.monaco-modal-editor-block').waitFor({state:'detached'});
		await agent.locator('[id="openide.agent.footer.environment"]').click();
	};
	assert.equal(await agent.locator('.openide-agent-titlebar .action-toolbar-container:visible').count(), 0, 'primary IDE toolbar is hidden in the companion');
	assert.equal(await agent.locator('.openide-agent-window-header > button').count(), 2, 'chat header contains conversation menu and Environment');
	assert.equal(await agent.locator('.openide-agent-window-header .openide-agent-window-actions').count(), 0, 'window actions stay separate from the conversation header');
	await agent.locator('.part.titlebar .openide-agent-window-actions').waitFor();
	await agent.locator('.openide-agent-window-footer .openide-settings-profile-block').waitFor();
	assert.equal(await agent.getByRole('tab', { name: 'Conversations', exact: true }).count(), 0, 'sessions sidebar is permanent, not a Files tab');
	assert.equal(await agent.locator('.openide-agent-window-sidebar .openide-chat-sessions-head').isVisible(), false, 'agent sessions use central search');
	assert.equal(await ide.locator('.openide-chat-sessions-pane.compact').count(), 0, 'IDE retains its default sessions search');
	await agent.getByRole('button', { name: 'Search conversations', exact: true }).click();
	const searchOverlay = agent.locator('.quick-input-widget:visible');
	const searchInput = searchOverlay.locator('input').first();
	await searchInput.waitFor();
	assert.equal(await ide.locator('.quick-input-widget:visible').count(), 0, 'conversation search belongs to the auxiliary window');
	await searchOverlay.getByText('Quick actions', { exact: true }).waitFor();
	assert.equal(await searchOverlay.locator('.quick-input-list-separator-as-item').count(), 2, 'native section headings occupy their own rows');
	assert.ok(await searchOverlay.locator('.monaco-keybinding').count() >= 2, 'quick actions show configured native shortcuts');
	await searchOverlay.getByText('Open folder…', { exact: true }).waitFor();
	await searchOverlay.getByText('Window fixture first', { exact: true }).waitFor();
	assert.ok(await searchOverlay.getByText('workspace', { exact: true }).count(), 'results include project labels');
	assert.ok(await searchOverlay.evaluate(el => Math.abs(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - window.innerWidth / 2) < 16), 'search is centered');
	await agent.screenshot({ path: path.join(output, 'agent-window-search.png') });
	await searchInput.fill('Window fixture first');
	await searchOverlay.locator('.monaco-list-row').filter({ hasText: 'Window fixture first' }).waitFor();
	await searchInput.press('ArrowDown');
	await searchInput.press('Enter');
	await ide.waitForFunction(() => window.agentWindowFixture.active() === window.agentWindowFixture.first);
	await agent.keyboard.press('Control+Shift+KeyF');
	await searchInput.waitFor();
	await searchInput.fill('Window fixture second');
	await searchInput.press('Enter');
	await ide.waitForFunction(() => window.agentWindowFixture.active() === window.agentWindowFixture.second);
	await agent.keyboard.press('Control+Shift+KeyF');
	await searchInput.waitFor();
	await searchInput.press('Escape');
	await searchOverlay.waitFor({ state: 'hidden' });
	await agent.keyboard.press('Control+KeyP');
	await searchInput.waitFor();
	await searchInput.fill('hidden.txt');
	await agent.waitForTimeout(300);
	assert.equal(await searchOverlay.getByText('hidden.txt', { exact: true }).count(), 0, 'native file search respects workspace exclusions');
	await searchInput.fill('component');
	await searchOverlay.getByText('component.ts', { exact: true }).waitFor();
	await agent.screenshot({ path: path.join(output, 'agent-window-file-search.png') });
	await searchInput.press('Enter');
	await agent.locator('.monaco-modal-editor-block .monaco-editor').waitFor();
	assert.equal(await ide.locator('.monaco-modal-editor-block:visible').count(), 0, 'Ctrl+P opens files in agent native editor');
	await closeEditor();
	await agent.screenshot({ path: path.join(output, 'agent-window-layout.png') });
	console.log('Final shell chrome and compact changes ready.');
	await agent.locator('.openide-agent-window-changes-heading > button:first-child').waitFor({ state: 'attached' });
	assert.equal(await agent.locator('.openide-agent-window-changes-list').count(), 0, 'Environment uses a compact summary');
	await agent.locator('.openide-agent-window-review-summary').click();
	await agent.locator('.openide-changes-editor').waitFor();
	assert.equal(await agent.locator('.openide-changes-file').count(), 24);
	await closeEditor();
	await openFiles();
	assert.equal(await agent.locator('.openide-agent-window-sidebar').isVisible(), true, 'files never replace conversations');
	assert.ok(await agent.locator('.openide-files-editor').evaluate(el => el.getBoundingClientRect().x > document.querySelector('.openide-agent-window-main').getBoundingClientRect().x), 'files use the right island');
	const fileTree = agent.getByRole('tree', { name: 'Files', exact: true });
	await fileTree.getByText('src', { exact: true }).click();
	await fileTree.getByText('nested', { exact: true }).click();
	await fileTree.getByText('component.ts', { exact: true }).click();
	await agent.locator('.monaco-modal-editor-block .monaco-editor').waitFor();
	await agent.locator('.monaco-modal-editor-block .view-lines').getByText('export const fromAgentFiles = true;', { exact: true }).waitFor();
	assert.equal(await ide.locator('.monaco-modal-editor-block:visible').count(), 0, 'file opens in the auxiliary native modal');
	await agent.screenshot({ path: path.join(output, 'agent-window-native-editor.png') });
	await closeEditor();
	await openFiles();
	assert.equal(await fileTree.getByText('hidden.txt', { exact: true }).count(), 0);
	assert.ok(await fileTree.locator('.file-icon').count(), 'tree reuses themed resource labels');
	assert.equal(await agent.locator('.openide-agent-window-files-tree.show-file-icons').count(), 1, 'native Explorer icon theme scope is enabled');
	const renderedFileIcon = await fileTree.locator('.file-icon').first().evaluate(element => { const icon=getComputedStyle(element, '::before'); return { content: icon.content, image: icon.backgroundImage }; });
	assert.ok((renderedFileIcon.content !== 'none' && renderedFileIcon.content !== 'normal' && renderedFileIcon.content !== '""') || renderedFileIcon.image !== 'none', 'active Explorer icon theme paints a file icon');
	assert.equal(await agent.locator('.openide-agent-window-files-actions button').count(), 1, 'Files header contains navigation, not refresh/collapse/close');
	fs.writeFileSync(path.join(tmp, 'workspace/src/nested/added.ts'), 'export const added = true;\n');
	await fileTree.getByText('added.ts', { exact: true }).waitFor({ timeout: 20000 });
	fs.unlinkSync(path.join(tmp, 'workspace/src/nested/added.ts'));
	await fileTree.getByText('added.ts', { exact: true }).waitFor({ state: 'detached', timeout: 20000 });
	await agent.screenshot({ path: path.join(output, 'agent-window-files.png') });
	await agent.getByRole('button', { name: 'Back to Environment', exact: true }).click();
	assert.equal(await agent.locator('.openide-agent-window-context').isVisible(), true, 'Files returns to Environment');
	await openFiles();
	assert.equal(await fileTree.getByText('component.ts', { exact: true }).isVisible(), true, 'returning to Files preserves expanded directories');
	await fileTree.focus();
	await agent.keyboard.press('Escape');
	assert.equal(await agent.locator('.openide-agent-window-context').isVisible(), true, 'Escape returns from Files to Environment');
	// Shared chat review actions must route from their DOM owner, even without native focus.
	await ide.evaluate(() => window.agentWindowFixture.seedReview());
	await agent.locator('.openide-chat-files-review').click();
	await agent.locator('.monaco-modal-editor-block .monaco-editor').waitFor();
	assert.equal(await ide.locator('.monaco-modal-editor-block:visible').count(), 0, 'shared Review remains in the auxiliary window');
	await closeEditor();
	await agent.locator('.openide-composer-add').click();
	await agent.locator('.openide-menu:visible').getByText('Browser', { exact: true }).click();
	await agent.locator('.monaco-modal-editor-block .browser-container').waitFor();
	assert.equal(await ide.locator('.monaco-modal-editor-block:visible').count(), 0, 'shared Browser action remains in the auxiliary window');
	await closeEditor();
	await agent.screenshot({ path: path.join(output, 'agent-window-initial.png') });
	await agent.getByText('Second shared answer', { exact: true }).waitFor();
	const windowCount = app.windows().length;
	await ide.evaluate(() => window.agentWindowFixture.open());
	assert.equal(app.windows().length, windowCount, 'opening again reuses the same window');
	const appearance = page => page.locator('.openide-chat-native').filter({ has: page.locator('.openide-chat-input-card') }).first().evaluate(el => {
		const style = getComputedStyle(el);
		return { hover: style.getPropertyValue('--oi-hover').trim(), icon: style.getPropertyValue('--oi-icon-action').trim(), composer: getComputedStyle(el.querySelector('.openide-chat-input-card')).backgroundColor };
	});
	assert.deepEqual(await appearance(agent), await appearance(ide), 'both windows inherit the same chat theme');
	await agent.locator('.openide-agent-window-sidebar').getByText('Window fixture first', { exact: true }).click();
	await ide.waitForFunction(() => window.agentWindowFixture.active() === window.agentWindowFixture.first);
	await ide.screenshot({path:path.join(output, 'ide-after-switch.png')});
	await ide.getByText('First shared answer', { exact: true }).waitFor();
	await agent.getByText('First shared answer', { exact: true }).waitFor();
	const companionPrompt = agent.locator('textarea.openide-chat-prompt');
	await companionPrompt.fill('Shared streaming request');
	await ide.waitForFunction(() => document.querySelector('textarea.openide-chat-prompt').value === 'Shared streaming request');
	await companionPrompt.press('Enter');
	await ide.waitForFunction(() => window.agentWindowFixture.runs.length === 1);
	await ide.evaluate(() => window.agentWindowFixture.emit({ type: 'text', delta: 'Streaming in both windows' }));
	for (const page of [ide, agent]) {
		await page.getByText('Streaming in both windows', { exact: true }).waitFor();
		await page.locator('.openide-composer-send.running').waitFor();
	}
	await ide.evaluate(() => window.agentWindowFixture.emit({ type: 'approvalRequest', id: 'window-approval', tool: 'run_command', title: 'Shared approval', command: 'echo fixture', risk: 'exec' }));
	await agent.getByText('Shared approval', { exact: true }).waitFor();
	await agent.locator('.openide-chat-approval').getByRole('button', { name: 'Allow', exact: true }).click();
	await ide.waitForFunction(() => window.agentWindowFixture.approvals.length === 1);
	assert.equal(await ide.evaluate(() => window.agentWindowFixture.runs.length), 1, 'one execution owner across windows');
	for (const page of [ide, agent]) { await page.locator('.openide-chat-approval.decided').waitFor(); }
	await companionPrompt.fill('Queued from agent window');
	await companionPrompt.press('Enter');
	await ide.locator('.openide-chat-queue-tray').waitFor();
	await agent.locator('.openide-chat-queue-tray').waitFor();
	assert.equal(await ide.evaluate(() => window.agentWindowFixture.runs.length), 1, 'queue does not launch a parallel run');
	await agent.screenshot({ path: path.join(output, 'agent-window.png') });
	await agent.close();
	assert.equal(await ide.evaluate(() => window.agentWindowFixture.busy()), true, 'closing the companion keeps the run alive');
	assert.equal(await ide.evaluate(() => window.agentWindowFixture.cancelled()), false);
	agent = await openWindow();
	await agent.getByText('Streaming in both windows', { exact: true }).waitFor();
	await ide.evaluate(() => window.agentWindowFixture.finish());
	await ide.waitForFunction(() => window.agentWindowFixture.runs.length === 2);
	await agent.getByText('Queued from agent window', {exact:true}).waitFor();
	assert.equal(await ide.evaluate(() => window.agentWindowFixture.runs.length), 2, 'one queued request starts once');
	await ide.evaluate(() => window.agentWindowFixture.finish());
	await ide.waitForFunction(() => !window.agentWindowFixture.busy());
	await agent.locator('.openide-composer-send.running').waitFor({ state: 'hidden' });
	for (const selector of ['.openide-composer-model', '.openide-chat-footer-button']) {
		await agent.locator(selector).first().click();
		const popover = agent.locator('.openide-menu:visible').first();
		await popover.waitFor();
		assert.equal(await popover.evaluate(el => {
			const bounds = el.getBoundingClientRect();
			return el.ownerDocument === document && bounds.x >= 0 && bounds.y >= 0 && bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1;
		}), true, 'popover stays inside the auxiliary window');
		assert.equal(await ide.locator('.openide-menu:visible').count(), 0, 'popover is not portalled into IDE');
		await agent.keyboard.press('Escape');
	}
	for (const label of ['Toggle conversations', 'Toggle workspace panel']) {
		const toggle = agent.getByRole('button', { name: label, exact: true });
		await toggle.click();
		assert.equal(await agent.locator('.openide-agent-window').evaluate(el => el.scrollWidth <= el.clientWidth), true);
		await toggle.click();
	}
	// The shared conversation menu stays in the auxiliary native surface.
	await agent.locator('.openide-agent-window-header').getByRole('button', { name: 'More options', exact: true }).click();
	await agent.locator('.openide-chat-kebab-menu').waitFor();
	assert.equal(await ide.locator('.openide-chat-kebab-menu:visible').count(), 0);
	await agent.keyboard.press('Escape');
	// Resize actual Sash controls; effective widths preserve space for the chat at smaller sizes.
	await agent.getByRole('button',{name:'Toggle workspace panel',exact:true}).click();
	for (const [index, delta] of [[0, 90], [1, -70]]) {
		const box = await agent.locator('.openide-agent-window > .monaco-sash.vertical').nth(index).boundingBox();
		await agent.mouse.move(box.x + box.width / 2, box.y + 100);
		await agent.mouse.down(); await agent.mouse.move(box.x + box.width / 2 + delta, box.y + 100); await agent.mouse.up();
	}
	await agent.setViewportSize({ width: 1050, height: 800 });
	await agent.waitForFunction(() => document.querySelector('.openide-agent-window-main').clientWidth >= 340);
	await openFiles();
	await agent.getByRole('button', {name:'Toggle conversations',exact:true}).click();
	await agent.close(); agent = await openWindow();
	assert.equal(await agent.locator('.openide-agent-window-sidebar').isVisible(), false, 'hidden sidebar remains hidden after reopen');
	assert.equal(await agent.locator('.openide-files-editor').isVisible(), true, 'Files tab restores independently');
	await agent.getByRole('button', {name:'Toggle conversations',exact:true}).click();
	assert.equal(await agent.locator('.openide-agent-window-sidebar').isVisible(), true);
	await agent.getByRole('button', {name:'Toggle workspace panel',exact:true}).click();
	await agent.setViewportSize({ width: 720, height: 640 });
	await agent.screenshot({ path: path.join(output, 'agent-window-narrow.png') });
	await agent.waitForFunction(() => { const el = document.querySelector('.openide-agent-window'); return el.scrollWidth <= el.clientWidth; }, undefined, {timeout:5000});
	const contextToggle = agent.locator('.openide-agent-window-header').getByRole('button', {name:'Environment',exact:true});
	if (!await agent.locator('.openide-agent-window-context').isVisible()) { await contextToggle.click(); }
	await agent.locator('.openide-agent-window-context .openide-agent-window-section-heading').first().getByRole('button',{name:'Close',exact:true}).click();
	// The exit animation keeps the element visible until it finishes; observe completion.
	await agent.locator('.openide-agent-window-context').waitFor({ state: 'hidden' });
	assert.equal(await agent.locator('.openide-agent-window-context').isVisible(), false, 'overlay always has a reachable close control');
	// Reload through the real workbench action: the auxiliary document must not outlive its owner.
	const oldAgent = agent;
	const ownerReloaded = ide.waitForEvent('domcontentloaded', { timeout: 60000 });
	const companionClosed = oldAgent.waitForEvent('close', { timeout: 60000 });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Developer: Reload Window');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Developer: Reload Window' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await Promise.all([ownerReloaded, companionClosed]);
	await ide.locator('.monaco-workbench').waitFor({ timeout: 90000 });
	assert.equal(oldAgent.isClosed(), true, 'owner reload closes the previous companion');
	assert.equal(app.windows().filter(page => !page.isClosed()).length, 1, 'reload leaves no orphan auxiliary window');
	const reopened = app.waitForEvent('window', { timeout: 30000 });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>OpenIDE Agent: Open Agent Window');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'OpenIDE Agent: Open Agent Window' }).first().waitFor();
	await ide.keyboard.press('Enter');
	agent = await reopened;
	observeErrors(agent);
	await agent.locator('.openide-agent-window .openide-chat-native').filter({ has: agent.locator('.openide-chat-input-card') }).waitFor();
	assert.equal(app.windows().filter(page => !page.isClosed()).length, 2, 'reopening after reload creates exactly one companion');
	assert.deepEqual(runtimeErrors, [], 'window lifecycle must not report renderer errors');
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ nativeConversationSearch: true, searchKeyboardNavigation: true, nativeWorkspaceFileSearch: true, fileSearchExclusions: true, ownerReloadClosesCompanion: true, reopenAfterOwnerReload: true, layoutPersistence: true, sashResize: true, nativeScopedEditor: true, sharedReviewRouting: true, sharedBrowserRouting: true, compactChanges: true, permanentSessionsSidebar: true, titlebarLayoutControls: true, accountFooter: true, conversationMenu: true, nativeTitlebar: true, windowControls: true, sharedMenus: true, sharedStatusbar: true, islands: true, workspaceFiles: true, realEditorOpen: true, liveFileRefresh: true, separateWindow: true, singleton: true, sharedTheme: true, sharedSelection: true, sharedStreaming: true, composerDraftSync: true, queuedOnce: true, auxiliaryPopovers: true, paneToggles: true, sharedApproval: true, closePreservesRun: true, reopenPreservesTranscript: true, narrowLayout: true }, null, 2));
	console.log('PASS: native titlebar, menus, statusbar, islands, nested files/editor/live refresh, agent window singleton, shared theme/sessions, composer draft/send, single queued run, approval, auxiliary popovers, close/reopen, owner reload cleanup and responsive layout.');
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
