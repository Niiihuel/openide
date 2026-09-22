// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-terminal-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-window-terminal-'));
const workspace = path.join(temporary, 'workspace');
const controls = path.join(temporary, 'controls');
const binaries = path.join(temporary, 'bin');
const profile = path.join(temporary, 'profile');
const output = path.join(root, '.build/agent-window-terminal-runtime');
for (const directory of [workspace, controls, binaries, path.join(profile, 'User'), output]) { fs.mkdirSync(directory, { recursive: true }); }
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const executable = path.join(binaries, 'terminal-fixture');
fs.writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'dev/fixtures/hosted-cli.mjs'))} "$@"\n`, { mode: 0o755 });
const shell = path.join(binaries, 'fixture-shell');
fs.writeFileSync(shell, '#!/bin/sh\nif [ "$1" = "-l" ]; then shift; fi\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o755 });
fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
	'terminal.integrated.environmentChangesRelaunch': false,
	'terminal.integrated.profiles.linux': { Fixture: { path: executable } }, 'terminal.integrated.defaultProfile.linux': 'Fixture',
	'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.shellIntegration.enabled': false,
	'openide.memory.captureMode': 'off', 'openide.agent.notifications.enabled': false,
}));
fs.writeFileSync(path.join(profile, 'User/keybindings.json'), JSON.stringify([{key:'ctrl+alt+j',command:'workbench.action.togglePanel'}, {key:'ctrl+shift+`',command:'workbench.action.terminal.new',args:{cwd:workspace,config:{executable,name:'Custom Shortcut Terminal'}}}]));
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
	await ide.evaluate(async ({base, executable, workspace}) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ITerminalService } = await import(base + 'workbench/contrib/terminal/browser/terminal.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IViewsService } = await import(base + 'workbench/services/views/common/viewsService.js');
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.agentWindowTerminal', title: 'Agent Window Terminal Fixture', f1: true }); }
			async run(accessor) {
				const service = accessor.get(ITerminalService);
				const commands = accessor.get(ICommandService);
				const views = accessor.get(IViewsService), agentService = accessor.get(IOpenideAgentService);
				await commands.executeCommand('openide.agent.injectCanvasPrompt', { prompt: 'Terminal fixture', send: false });
				const primary = views.getViewWithId('workbench.view.openideChat.view')._widget.value;
				const instance = await service.createTerminal({ config: { executable, cwd: workspace, name: 'Fixture Terminal' } });
				await service.revealTerminal(instance);
				window.agentWindowTerminalFixture = { instance, service, open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					startBackground: async () => {
						const conversationId = primary.sessionStore.activeSessionId();
						const background = await service.createTerminal({ config: { executable, cwd: workspace, name: 'Background fixture', hideFromUser: true, env: { OPENIDE_CONVERSATION_ID: conversationId } } });
						await background.processReady;
						// A real hidden PTY in the same registry used by run_command; no provider is needed.
						agentService.tools.trackBackgroundTerminal(background, 'npm run dev', new Promise(() => {}), undefined, true, 'fixture', conversationId);
						window.agentWindowTerminalFixture.background = background;
						return { id: background.instanceId, pid: background.processId };
					},
					showChat: async () => { await views.openView('workbench.view.openideChat.view', true); },
				};
			}
		});
	}, {base:`vscode-file://vscode-app${root}/vscode/out/vs/`, executable, workspace});
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Window Terminal Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Window Terminal Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentWindowTerminalFixture);
	const first = await until(async () => { const pid = await ide.evaluate(() => window.agentWindowTerminalFixture.instance.processId); return generations().find(state=>state.pid===pid); }, 'real integrated PTY startup');
	assert.equal(first.tty, true);
	await ide.evaluate(async () => {
		const raw=window.agentWindowTerminalFixture.instance.xterm.raw;
		await new Promise(resolve=>raw.write(Array.from({length:160},(_,i)=>`Scroll fixture line ${i}\r\n`).join(''),resolve));
	});
	const checkScroll = async page => {
		const slider=page.locator('.xterm:visible .xterm-scrollbar.xterm-vertical > .xterm-slider').first();
		await slider.waitFor({state:'attached'});
		const style=await slider.evaluate(el=>({background:getComputedStyle(el).backgroundColor,width:getComputedStyle(el,'::after').width,radius:getComputedStyle(el,'::after').borderRadius,scrollports:el.closest('.xterm').querySelectorAll('.xterm-scrollable-element').length}));
		assert.equal(style.background,'rgba(0, 0, 0, 0)');
		assert.equal(style.width,'6px');
		assert.notEqual(style.radius,'0px');
		assert.equal(style.scrollports,1,'terminal owns exactly one scrollport');
	};
	await checkScroll(ide);
	const opening = app.waitForEvent('window');
	await ide.evaluate(() => window.agentWindowTerminalFixture.open());
	const agent = await opening; observe(agent);
	await agent.bringToFront();
	await agent.waitForFunction(() => document.hasFocus() && !!document.querySelector('.openide-agent-window-chat .openide-chat-native'));
	await agent.keyboard.press('Control+KeyJ');
	const input = agent.locator('.openide-agent-window-terminal .xterm-helper-textarea').first();
	await input.waitFor();
	await checkScroll(agent);
	await input.focus();
	await input.pressSequentially('from-terminal-island', {delay:15});
	await agent.screenshot({path:path.join(output,'terminal-input.png')});
	await until(() => generations().find(state => state.pid === first.pid)?.input.includes('from-terminal-island'), 'typing into auxiliary PTY');
	await agent.keyboard.press('Control+Alt+KeyJ');
	await agent.locator('.openide-agent-window-terminal-island').waitFor({state:'hidden'});
	await agent.keyboard.press('Control+KeyJ');
	await input.waitFor();
	await input.focus();
	await agent.keyboard.press('Control+Shift+Backquote');
	await until(() => generations().length === 2, 'new terminal created from island action');
	await until(() => agent.locator('.openide-agent-window-terminal-tab').count().then(count => count === 2), 'two terminal tabs');
	await agent.locator('.openide-agent-window-terminal-tab[aria-selected="true"]').filter({hasText:'Custom Shortcut Terminal'}).waitFor();
	await input.focus();
	await agent.keyboard.press('Control+PageUp');
	await until(() => agent.locator('.openide-agent-window-terminal-tab[aria-selected="true"]').textContent().then(text => text.includes('Fixture Terminal')), 'original tab becomes selected');
	await input.focus();
	await input.pressSequentially('selected-original', {delay:15});
	await until(() => generations().find(state => state.pid === first.pid)?.input.includes('selected-original'), 'original terminal selected');
	await agent.keyboard.press('Control+Shift+Digit5');
	await until(() => generations().length === 3, 'native split shortcut creates one additional PTY');
	await until(() => agent.locator('.terminal-split-pane').count().then(count => count === 2), 'two native split panes');
	await agent.keyboard.press('Alt+ArrowLeft');
	await agent.keyboard.type('previous-pane');
	await until(() => generations().find(state => state.pid === first.pid)?.input.includes('previous-pane'), 'native split previous-pane shortcut');
	const beforeResize = await agent.locator('.terminal-split-pane').first().evaluate(element => element.clientWidth);
	await agent.keyboard.press('Control+Shift+ArrowRight');
	await until(() => agent.locator('.terminal-split-pane').first().evaluate(element => element.clientWidth).then(width => width > beforeResize), 'native terminal pane resize shortcut');
	await agent.keyboard.press('Control+PageDown');
	await until(() => agent.locator('.terminal-split-pane').count().then(count => count === 1), 'next group skips split sibling');
	await agent.keyboard.press('Control+PageUp');
	await until(() => agent.locator('.terminal-split-pane').count().then(count => count === 2), 'previous group restores native split');
		await agent.screenshot({path:path.join(output,'terminal-island.png')});
	const background = await ide.evaluate(() => window.agentWindowTerminalFixture.startBackground());
	await until(() => generations().find(state => state.pid === background.pid), 'background tool PTY startup');
	await ide.locator('.openide-chat-terms-tray:not(.hidden)').waitFor({state:'attached'});
	assert.equal(await agent.locator('.openide-chat-terms-tray').count(), 0, 'Agents never duplicates the IDE composer tray');
	const workspaceTabs = agent.locator('.openide-conversation-context-tabs');
	if (!await workspaceTabs.isVisible()) { await agent.locator('.openide-agent-window-header button[aria-controls="openide-agent-window-context"]').click(); }
	await agent.locator('#conversation-context-tab-terminals').click();
	const moreProcesses = agent.locator('#conversation-context-panel-terminals .openide-context-activity-more');
	if (await moreProcesses.isVisible()) { await moreProcesses.click(); }
	const processRow = agent.locator(`#conversation-context-panel-terminals [data-terminal-id="${background.id}"]`);
	await processRow.locator('button.openide-agent-window-context-row').click();
	await agent.locator('.openide-agent-window-terminal-tab[aria-selected="true"]').filter({hasText:'Background fixture'}).waitFor();
	const backgroundInput = agent.locator('.openide-agent-window-terminal .xterm-helper-textarea').first();
	await backgroundInput.focus();
	await backgroundInput.pressSequentially('from-workspace-terminals', {delay:15});
	await until(() => generations().find(state => state.pid === background.pid)?.input.includes('from-workspace-terminals'), 'Terminals tab reveals the same background PTY');
	await agent.screenshot({path:path.join(output,'workspace-background-terminal.png')});
	await agent.close();
	assert.equal(await ide.evaluate(() => window.agentWindowTerminalFixture.background.isDisposed), false, 'closing Agents preserves background work');
	await ide.evaluate(() => window.agentWindowTerminalFixture.showChat());
	const tray = ide.locator('.openide-chat-terms-tray:not(.hidden)');
	await tray.waitFor();
	await tray.locator('.openide-chat-terms-toggle').click();
	await tray.getByRole('button', {name:'npm run dev', exact:true}).click();
	await until(() => ide.evaluate(() => window.agentWindowTerminalFixture.service.activeInstance === window.agentWindowTerminalFixture.background), 'IDE tray can still reveal the background process');
	await ide.screenshot({path:path.join(output,'ide-background-tray.png')});
	await ide.evaluate(() => window.agentWindowTerminalFixture.service.focusInstance(window.agentWindowTerminalFixture.instance));
	const ideInput = ide.locator('.terminal-wrapper.active .xterm-helper-textarea').first();
	await ideInput.waitFor();
	await checkScroll(ide);
	await ideInput.focus();
	await ideInput.pressSequentially('returned-to-ide', {delay:15});
	await until(() => generations().find(state => state.pid === first.pid)?.input.includes('returned-to-ide'), 'typing into returned IDE PTY');
	assert.equal(generations().length, 4, 'one PTY for New, Split, and background; presentation never spawns');
	assert.equal(generations().find(state => state.pid === first.pid)?.generation, first.generation, 'same original generation after close');
	await ide.screenshot({path:path.join(output,'terminal-returned-ide.png')});
	assert.deepEqual(errors, [], 'island handoff produces no renderer errors');
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({realPty:true,sharedScrollbar:true,singleScrollport:true,auxiliaryKeyboard:true,multipleTerminals:true,nativeSplit:true,nativeShortcuts:true,customShortcut:true,keybindingLaunchArguments:true,selection:true,sameProcess:true,closeReturnsToIde:true,noAgentsComposerTray:true,workspaceRevealsBackground:true,ideTrayPreserved:true,backgroundSurvivesClose:true},null,2));
	console.log('PASS: real integrated PTY moves to terminal island and returns to IDE without losing process or keyboard input.');

} catch(error) {
	console.log('fixture states',generations());
	if(app) { for(const page of app.windows()) { console.log('page',page.url(),await page.evaluate(()=>({active:document.activeElement?.tagName})).catch(()=>null)); } }
	throw error;
} finally {
	if (app) { await app.close(); }
	fs.rmSync(temporary, {recursive:true,force:true});
}
