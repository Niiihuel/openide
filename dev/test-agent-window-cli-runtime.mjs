// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-cli-runtime.mjs
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-window-cli-'));
const workspace = path.join(temporary, 'workspace');
const controls = path.join(temporary, 'controls');
const binaries = path.join(temporary, 'bin');
const profile = path.join(temporary, 'profile');
const output = path.join(root, '.build/agent-window-cli-runtime');
for (const directory of [workspace, controls, binaries, path.join(profile, 'User'), output]) { fs.mkdirSync(directory, { recursive: true }); }
fs.writeFileSync(path.join(workspace, 'fixture.txt'), 'before CLI edit\n');
execFileSync('git', ['init', '-q'], { cwd: workspace });
execFileSync('git', ['add', 'fixture.txt'], { cwd: workspace });
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Fixture baseline'], { cwd: workspace });
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const executable = path.join(binaries, 'gemini');
fs.writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'dev/fixtures/hosted-cli.mjs'))} "$@"\n`, { mode: 0o755 });
const shell = path.join(binaries, 'fixture-shell');
fs.writeFileSync(shell, '#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false,
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
const generations = () => fs.readdirSync(controls).filter(file => file.endsWith('.json') && !file.endsWith('.command.json')).map(file => JSON.parse(fs.readFileSync(path.join(controls, file), 'utf8')));
async function until(predicate, label) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const result = await predicate();
		if (result) { return result; }
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out: ${label}`);
}
const errors = [];
const observe = page => {
	page.on('pageerror', error => errors.push(error.stack));
	page.on('console', message => {
		if (message.type() === 'error' && !message.text().includes('No default agent registered')) { errors.push(message.text()); }
	});
};
let app;
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', workspace, '--user-data-dir', profile, '--shared-data-dir', path.join(temporary, 'shared'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1', PATH: `${binaries}${path.delimiter}${process.env.PATH}`, SHELL: shell, OPENIDE_FIXTURE_DIRECTORY: controls, OPENIDE_FIXTURE_WORKSPACE: workspace }, timeout: 90000,
	});
	const ide = await app.firstWindow(); observe(ide);
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { ICodeEditorService } = await import(base + 'editor/browser/services/codeEditorService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentWindowCli', title: 'Agent Window CLI Fixture', f1: true }); }
			async run(accessor) {
				try {
				const commands = accessor.get(ICommandService);
				const editors = accessor.get(ICodeEditorService);
				const views = accessor.get(IViewsService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'CLI fixture', send: false });
				const view = views.getViewWithId('workbench.view.openideChat.view');
				const native = view._widget.value.sessionStore.createBackground('Native previous session', [{ role: 'user', content: 'Prior native conversation', messageId: 'native-message' }, { role: 'assistant', content: 'Native harness transcript' }]);
				view._widget.value.refreshSessions();
				view._widget.value.openSession(native);
				window.agentWindowCliFixture = { selectReview: () => { const e = editors.listCodeEditors().find(editor => editor.getDomNode()?.closest('.openide-changes-editor')); e.focus(); e.setSelection({startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:15}); }, reviewModels: () => editors.listCodeEditors().filter(editor=>editor.getDomNode()?.closest('.openide-changes-editor')).map(editor=>editor.getModel()?.getValue()), open: () => commands.executeCommand('openide.agent.openAgentWindow'), selected: () => view._widget.value.sessionStore.metaOf(view._widget.value.sessionStore.activeSessionId()), native: () => view._widget.value.sessionStore.messagesOf(native), diffs: () => editors.listDiffEditors().filter(editor => editor.getContainerDomNode().ownerDocument !== document).map(editor => ({ original: editor.getModel()?.original.getValue(), modified: editor.getModel()?.modified.getValue() })) };
				} catch (error) { window.agentWindowCliFixtureError = String(error.stack || error); }
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Window CLI Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Window CLI Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentWindowCliFixture || !!window.agentWindowCliFixtureError);
	assert.equal(await ide.evaluate(() => window.agentWindowCliFixtureError), undefined);
	const opening = app.waitForEvent('window');
	await ide.evaluate(() => window.agentWindowCliFixture.open());
	const agent = await opening; observe(agent);
	await agent.locator('.openide-agent-window').waitFor();
	await agent.getByText('Native harness transcript', { exact: true }).waitFor();
	await agent.getByRole('button', {name:'Choose harness', exact:true}).click();
	const cli = agent.locator('.openide-chat-kind-installed [title]').filter({hasText:'Gemini CLI'}).first();
	await cli.waitFor();
	assert.equal(await cli.getAttribute('title'), executable, 'only the exact disposable executable may launch');
	await agent.getByRole('textbox', { name: 'Conversation name (optional)' }).fill('CLI custom title');
	assert.equal(generations().length, 0, 'typing a title never starts a process');
	await cli.click();
	await agent.locator('.openide-agent-window-title').filter({ hasText: 'CLI custom title' }).waitFor();
	const first = await until(() => generations()[0], 'real CLI PTY startup');
	assert.equal(first.tty, true);
	assert.ok(first.sessionId);
	const metadata = await ide.evaluate(() => window.agentWindowCliFixture.selected());
	assert.equal(metadata.id, first.sessionId);
	assert.equal(metadata.title, 'CLI custom title');
	assert.equal(metadata.cwd, workspace);
	assert.equal(await agent.getByText('Native harness transcript', { exact: true }).isVisible(), false, 'native transcript does not leak into the CLI island');
	assert.equal(await agent.locator('.openide-chat-goal-tray:visible').count(), 0, 'CLI owns its surface without an OpenIDE goal footer');
	assert.equal(await agent.locator('.openide-chat-native > .openide-chat-goal-tray').count(), 0, 'goal tray stays inside the native composer');
	assert.equal((await ide.evaluate(() => window.agentWindowCliFixture.native())).length, 2, 'switching harness preserves prior native history');
	const useHere = agent.getByRole('button', {name:'Use Terminal Here', exact:true});
	assert.equal(await useHere.isVisible(), false, 'New CLI presents the shared terminal directly in the originating window');
	const input = agent.locator('.openide-chat-agent-terminal .xterm-helper-textarea').first();
	await input.waitFor();
	await input.focus();
	await input.pressSequentially('from-agent-window', {delay:15});
	await until(() => generations()[0]?.input.includes('from-agent-window'), 'typing into auxiliary PTY');
	assert.equal(generations().length, 1, 'moving into auxiliary does not launch a second process');
	await agent.screenshot({path:path.join(output, 'cli-agent-window.png')});
	const environmentAnchor = agent.locator('.openide-agent-window-context button').filter({ has: agent.locator('.openide-agent-window-row-label') }).filter({ hasText: 'Local · Gemini CLI' });
	await environmentAnchor.click();
	const environment = agent.getByRole('dialog', { name: 'Environment', exact: true });
	await environment.waitFor();
	assert.ok((await environment.innerText()).includes(workspace), 'popover shows exact selected conversation cwd');
	await agent.screenshot({ path: path.join(output, 'cli-environment.png') });
	await environment.getByRole('button', { name: 'Copy path', exact: true }).click();
	assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), workspace);
	await environmentAnchor.click();
	await environment.getByRole('button', { name: 'Browse files', exact: true }).click();
	await agent.locator('.openide-files-editor .monaco-list-row').filter({ hasText: 'fixture.txt' }).waitFor();
	await agent.getByRole('button', { name: 'Back to Environment', exact: true }).click();
	await environmentAnchor.click();
	await environment.getByRole('button', { name: 'Open terminal here', exact: true }).click();
	const nativeInput = agent.locator('.openide-agent-window-terminal-island .xterm-helper-textarea').first();
	await nativeInput.waitFor();
	await nativeInput.focus();
	const cwdProof = path.join(controls, 'cwd-proof.txt');
	await nativeInput.pressSequentially(`pwd > ${quote(cwdProof)}`, { delay: 10 });
	await nativeInput.press('Enter');
	await until(() => fs.existsSync(cwdProof), 'environment terminal actual working directory');
	assert.equal(fs.readFileSync(cwdProof, 'utf8').trim(), workspace);
	await agent.screenshot({ path: path.join(output, 'cli-environment-terminal.png') });
	await agent.keyboard.press('Control+KeyJ');
	fs.writeFileSync(path.join(controls, `${first.generation}.command.json`), JSON.stringify({ id: 'edit-file', action: 'write', content: 'after CLI edit\n' }));
	await until(() => generations()[0]?.commands['edit-file']?.ok, 'controlled CLI workspace edit');
	const changedFile = agent.locator('.openide-agent-window-review-summary');
	await until(async () => (await agent.locator('.openide-agent-window-context .openide-agent-window-changes-totals').textContent()).replace(/\s/g, '') === '+1−1', 'CLI added and removed line totals');
	await changedFile.click();
	await agent.locator('.openide-changes-editor .monaco-editor').waitFor();
	await agent.locator('.openide-review-deleted-code').filter({hasText:'before CLI edit'}).waitFor();
	await until(async () => (await ide.evaluate(() => window.agentWindowCliFixture.reviewModels())).includes('after CLI edit\n'), 'live file in editable CLI review');
	assert.equal(await ide.locator('.monaco-modal-editor-block').count(), 0, 'review stays in auxiliary workbench');
	await ide.evaluate(() => window.agentWindowCliFixture.selectReview());
	await agent.keyboard.press('Control+KeyL');
	await until(() => generations()[0].input.includes('after CLI edit'), 'Continue selection reaches same CLI PTY');
	assert.equal((await ide.evaluate(() => window.agentWindowCliFixture.selected())).id, first.sessionId);
	await agent.screenshot({path:path.join(output,'cli-inline-review.png')});
	await agent.getByRole('button',{name:'Open in modal',exact:true}).click();
	await agent.locator('.modal-editor-header .codicon-close').click();
	await agent.locator('.monaco-modal-editor-block').waitFor({ state: 'detached' });
	assert.equal(generations()[0].pid, first.pid, 'reviewing edits preserves the live CLI process');
	await agent.close();
	const ideInput = ide.locator('.openide-chat-agent-terminal .xterm-helper-textarea').first();
	await ideInput.waitFor();
	await ideInput.focus();
	await ideInput.pressSequentially('returned-to-ide', {delay:15});
	await until(() => generations()[0]?.input.includes('returned-to-ide'), 'typing into returned IDE PTY');
	const returned = generations();
	assert.deepEqual(returned.map(state => ({generation:state.generation,pid:state.pid,sessionId:state.sessionId})), [{generation:first.generation,pid:first.pid,sessionId:first.sessionId}], 'same PTY generation, process and conversation after close');
	await ide.screenshot({path:path.join(output, 'cli-returned-ide.png')});
	assert.deepEqual(errors, [], 'handoff produces no renderer errors');
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({environmentActions:true,environmentTerminalCwd:true,exactExecutable:true,customTitle:true,automaticPresentation:true,nativeSessionDiff:true,realPty:true,auxiliaryKeyboard:true,sameProcess:true,closeReturnsToIde:true},null,2));
	console.log('PASS: detected fixture CLI, same live PTY and session, auxiliary input and return to IDE after close.');
} finally {
	if (app) { await app.close(); }
	fs.rmSync(temporary, {recursive:true,force:true});
}
