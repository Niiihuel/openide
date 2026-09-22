// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-project-handoff-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-project-handoff-'));
const output = path.join(root, '.build/agent-window-project-handoff-runtime');
const workspaceA = path.join(tmp, 'project-a');
const workspaceB = path.join(tmp, 'project-b');
for (const directory of [path.join(tmp, 'profile/User'), workspaceA, workspaceB, output]) { fs.mkdirSync(directory, { recursive: true }); }
fs.writeFileSync(path.join(workspaceA, 'owner.txt'), 'Original project and editors stay in their IDE.\n');
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'openide.memory.captureMode': 'off',
	'openide.agent.notifications.enabled': false,
}));
let app;
const errors = [];
const observe = page => {
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', dialog => void dialog.accept().catch(() => {}));
};
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspaceA, '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ideA = await app.firstWindow(); observe(ideA);
	await ideA.locator('.part.titlebar .openide-window-switcher').waitFor({ timeout: 90000 });
	await app.evaluate(({ app }) => {
		globalThis.handoffWindowEvents = [];
		app.on('browser-window-created', (_event, window) => {
			globalThis.handoffWindowEvents.push({ kind: 'created', id: window.id, visible: window.isVisible() });
			window.on('show', () => globalThis.handoffWindowEvents.push({ kind: 'show', id: window.id }));
		});
	});
	await ideA.evaluate(async ({ base, file }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { INativeHostService } = await import(base + 'platform/native/common/native.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IWorkspaceContextService } = await import(base + 'platform/workspace/common/workspace.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { URI } = await import(base + 'base/common/uri.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.projectHandoff', title: 'Project Handoff Fixture', f1: true }); }
			async run(accessor) {
				const native = accessor.get(INativeHostService), commands = accessor.get(ICommandService);
				const context = accessor.get(IWorkspaceContextService), editors = accessor.get(IEditorService);
				await editors.openEditor({ resource: URI.file(file), options: { pinned: true } });
				window.projectHandoff = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					switch: (sourceWindowId, folder) => native.openWindow([{ folderUri: URI.file(folder) }], { forceNewWindow: true, openideAgentWindow: { sourceWindowId } }),
					state: () => ({ folder: context.getWorkspace().folders[0]?.uri.fsPath, editor: editors.activeEditor?.resource?.fsPath }),
				};
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, file: path.join(workspaceA, 'owner.txt') });
	await ideA.keyboard.press('Control+Shift+KeyP');
	await ideA.locator('.quick-input-widget input').first().fill('>Project Handoff Fixture');
	await ideA.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Project Handoff Fixture' }).first().click();
	await ideA.waitForFunction(() => !!window.projectHandoff);
	const originalState = await ideA.evaluate(() => window.projectHandoff.state());
	const openSource = async () => {
		const opened = app.waitForEvent('window', { timeout: 30000 });
		await ideA.evaluate(() => window.projectHandoff.open());
		const agent = await opened; observe(agent);
		await agent.locator('.openide-agent-window .openide-chat-input-card').waitFor();
		return agent;
	};
	const source = await openSource();
	const sourceId = await source.evaluate(() => window.vscodeWindowId);
	const sourceClosed = source.waitForEvent('close', { timeout: 30000 });
	const ownerOpened = app.waitForEvent('window', { timeout: 30000 });
	const firstSwitch = ideA.evaluate(({ id, folder }) => window.projectHandoff.switch(id, folder), { id: sourceId, folder: workspaceB });
	const ideB = await ownerOpened; observe(ideB);
	await firstSwitch;
	await sourceClosed;
	await ideB.locator('.monaco-workbench').waitFor();
	const agentB = app.windows().find(page => page !== ideA && page !== ideB && !page.isClosed());
	assert.ok(agentB, 'destination companion is present when the handoff resolves'); observe(agentB);
	await agentB.locator('.openide-agent-window .openide-chat-input-card').waitFor();
	const nativeA = await app.browserWindow(ideA), nativeB = await app.browserWindow(ideB);
	const ownerBId = await nativeB.evaluate(window => window.id);
	assert.deepEqual({ sourceClosed: source.isClosed(), original: await ideA.evaluate(() => window.projectHandoff.state()), originalVisible: await nativeA.evaluate(window => window.isVisible()), destinationVisible: await nativeB.evaluate(window => window.isVisible()) },
		{ sourceClosed: true, original: originalState, originalVisible: true, destinationVisible: false });
	assert.deepEqual(await app.evaluate((_electron, id) => globalThis.handoffWindowEvents.filter(event => event.id === id), ownerBId), [{ kind: 'created', id: ownerBId, visible: false }], 'new workspace owner never flashes onscreen');
	await agentB.screenshot({ path: path.join(output, 'project-b-agent.png') });
	for (const visible of [false, true]) {
		if (visible) { await nativeB.evaluate(window => window.show()); }
		const nextSource = await openSource();
		const count = app.windows().filter(page => !page.isClosed()).length;
		const closed = nextSource.waitForEvent('close', { timeout: 30000 });
		await ideA.evaluate(({ id, folder }) => window.projectHandoff.switch(id, folder), { id: await nextSource.evaluate(() => window.vscodeWindowId), folder: workspaceB });
		await closed;
		assert.equal(nextSource.isClosed(), true);
		assert.equal(agentB.isClosed(), false, 'existing destination companion is reused');
		assert.equal(app.windows().filter(page => !page.isClosed()).length, count - 1, 'existing workspace does not create another IDE');
		assert.equal(await nativeB.evaluate(window => window.isVisible()), visible, 'existing IDE visibility is preserved');
	}
	const failedSource = await openSource();
	await ideB.evaluate(async base => {
		const { CommandsRegistry } = await import(base + 'platform/commands/common/commands.js');
		window.rejectHandoff = CommandsRegistry.registerCommand('openide.agent.openAgentWindow', async () => { throw new Error('Fixture refused companion startup'); });
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	const failure = await ideA.evaluate(async ({ id, folder }) => {
		try { await window.projectHandoff.switch(id, folder); return ''; } catch (error) { return error.message; }
	}, { id: await failedSource.evaluate(() => window.vscodeWindowId), folder: workspaceB });
	assert.match(failure, /Fixture refused companion startup/);
	assert.equal(failedSource.isClosed(), false, 'failed destination keeps the current Agents window available');
	assert.deepEqual(await ideA.evaluate(() => window.projectHandoff.state()), originalState);
	// The dedicated workspace owner must remain hidden all the way through the last
	// companion's close. Showing it just before close was visible as an IDE flash.
	await nativeB.evaluate(window => window.hide());
	const showsBeforeClose = await app.evaluate((_electron, id) => globalThis.handoffWindowEvents.filter(event => event.id === id && event.kind === 'show').length, ownerBId);
	const companionClosed = agentB.waitForEvent('close', { timeout: 30000 });
	const ownerClosed = ideB.waitForEvent('close', { timeout: 30000 });
	await (await app.browserWindow(agentB)).evaluate(window => window.close());
	await Promise.all([companionClosed, ownerClosed]);
	assert.equal(await app.evaluate((_electron, id) => globalThis.handoffWindowEvents.filter(event => event.id === id && event.kind === 'show').length, ownerBId), showsBeforeClose, 'closing Agents never reveals its hidden IDE owner');
	assert.deepEqual(errors, []);
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ hiddenNewOwner: true, hiddenOwnerNeverFlashesOnClose: true, originalIdePreserved: true, existingCompanionReused: true, existingIdeVisibilityPreserved: true, failedHandoffPreservesSource: true }, null, 2));
	console.log('PASS: hidden workspace owner never flashes on close, ready-before-source-close handoff, preserved original IDE, reused workspace/companion, visibility preservation and failed handoff recovery.');
} catch (error) {
	console.error(error); throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(tmp, { recursive: true, force: true });
}
