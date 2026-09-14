// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-workspace-chrome-runtime.mjs
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
const output = path.join(root, '.build/agent-empty-shortcuts-runtime');
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
				let submits = 0; const executed = []; const commandListener = commands.onDidExecuteCommand(event => executed.push(event.commandId));
				const listener = widget._composer.onDidSubmit(() => submits++);
				window.chatWelcomeFixture = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					executed: () => executed.slice(),
					stats: () => ({ submits, items: widget.controller.items.length, draft: widget._composer.value }),
					openSaved: () => widget.openSession(saved),
					clearHistory: () => { sessions.delete(saved); widget.refreshSessions(); },
					newSession: () => { widget.newSession(); widget._composer.value = ''; },
					label: key => t(key),
					spanish: key => openideStringFor(key, 'es'),
					dispose: () => { listener.dispose(); commandListener.dispose(); },
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

	await agent.setViewportSize({ width: 1440, height: 900 });
	await agent.locator('.openide-chat-input-card textarea:visible').waitFor();
	await agent.getByRole('button', { name: 'Toggle workspace panel', exact: true }).click();
	const workspace = agent.locator('.openide-agent-window-workspace');
	const launcher = workspace.locator('.openide-agent-window-editor-empty');
	await launcher.waitFor();

	// Both hosts use the watermark row component, while agent commands stay scoped.
	const emptyPresentation = page => page.locator('.openide-chat-empty .openide-empty-state').evaluate(element => ({
		shortcuts: element.querySelectorAll('.openide-empty-state-keybinding:not([hidden])').length,
		icons: element.querySelectorAll('.openide-command-row .codicon').length,
		transparent: getComputedStyle(element.querySelector('.openide-command-row')).backgroundColor === 'rgba(0, 0, 0, 0)',
		keysBorder: element.querySelector('.monaco-keybinding-key') ? getComputedStyle(element.querySelector('.monaco-keybinding-key')).borderTopStyle : undefined,
	}));
	const traditionalEmpty = await emptyPresentation(ide);
	const agentEmpty = await emptyPresentation(agent);
	assert.deepEqual({ traditional: traditionalEmpty, agent: agentEmpty }, {
		traditional: { shortcuts: 0, icons: 0, transparent: true, keysBorder: 'solid' },
		agent: { shortcuts: 3, icons: 0, transparent: true, keysBorder: 'solid' },
	}, 'native minimal command rows with real keycaps and window-scoped shortcuts');

	const cdp = await agent.context().newCDPSession(agent);
	await cdp.send('Performance.enable');
	const before = await cdp.send('Performance.getMetrics');
	const rows = agent.locator('.openide-empty-state-action:visible');
	const boxes = await rows.evaluateAll(elements => elements.map(e => {const b=e.getBoundingClientRect();const s=getComputedStyle(e);return {x:b.x+b.width/2,y:b.y+b.height/2,transition:s.transitionDuration,transitionProperty:s.transitionProperty};}));
	await agent.evaluate(() => { window.emptyMutations=0; window.emptyObserver=new MutationObserver(records=>window.emptyMutations+=records.length); for(const root of document.querySelectorAll('.openide-empty-state-actions'))window.emptyObserver.observe(root,{subtree:true,childList:true,attributes:true}); });
	const started=Date.now();
	for(let i=0;i<64;i++){const b=boxes[i%boxes.length];await agent.mouse.move(b.x,b.y);}
	const after = await cdp.send('Performance.getMetrics');
	const metrics=Object.fromEntries(after.metrics.filter(m=>['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','ScriptDuration','TaskDuration'].includes(m.name)).map(m=>[m.name,m.value-(before.metrics.find(v=>v.name===m.name)?.value??0)]));
	const result={elapsed:Date.now()-started,styles:boxes,metrics,mutations:await agent.evaluate(()=>{window.emptyObserver.disconnect();return window.emptyMutations;})};
	fs.writeFileSync(path.join(output,'hover-profile.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
	await agent.screenshot({path:path.join(output,'empty.png')});
	assert.equal(result.mutations, 0, 'hover does not rebuild action DOM');
	assert.ok(result.styles.every(style => style.transition === '0s'), 'launcher hover paints immediately');
	assert.equal(await agent.locator('.openide-chat-empty .openide-empty-state-brand-icon').count(), 0);
	assert.equal(await launcher.locator('.openide-empty-state-brand-icon').count(), 0);
	assert.equal(await launcher.locator('.openide-empty-state-keybinding:not([hidden])').count(), 3);
	const composer = agent.locator('.openide-chat-input-card textarea:visible');
	await composer.fill('Keep this draft');
	await composer.press('Control+Alt+Digit1');
	assert.match(await composer.inputValue(), /^Keep this draft\n\n/);
	assert.equal((await ide.evaluate(() => window.chatWelcomeFixture.stats())).submits, 0);
	await agent.keyboard.press('Control+Shift+KeyG');
	await workspace.getByRole('heading', { name: 'No changes to review', exact: true }).waitFor();
	await agent.keyboard.press('Control+Shift+KeyE');
	await agent.locator('.openide-files-editor').waitFor({state:'visible'});
	await agent.keyboard.press('Control+Alt+KeyL');
	assert.equal(await composer.evaluate(e=>e===document.activeElement), true);
	await agent.keyboard.press('Control+KeyB');
	assert.equal(await agent.locator('.openide-agent-window').evaluate(e=>e.classList.contains('sidebar-hidden')), true);
	await agent.keyboard.press('Control+KeyB');
	await agent.keyboard.press('Control+KeyN');
	assert.match(await composer.inputValue(), /^Keep this draft/, 'new-chat navigation preserves the shared unsent draft');
	const executed = await ide.evaluate(() => window.chatWelcomeFixture.executed());
	for(const id of ['explore','review','files','focusChat','sidebar','newChat']) assert.ok(executed.includes('openide.agentWindow.'+id), id+' dispatches through the native command service');
	await ide.bringToFront();
	await ide.locator('.part.titlebar').click({position:{x:300,y:12}});
	await ide.keyboard.press('Control+KeyN');
	await ide.waitForFunction(() => window.chatWelcomeFixture.executed().includes('workbench.action.files.newUntitledFile'));
	assert.equal((await ide.evaluate(() => window.chatWelcomeFixture.executed())).filter(id=>id==='openide.agentWindow.newChat').length, 1, 'traditional IDE keeps native new-file shortcut');
	await agent.bringToFront();
	await composer.click();
	await agent.keyboard.press('Control+Shift+KeyF');
	await agent.locator('.quick-input-widget').waitFor({state:'visible'});
	assert.equal(await ide.locator('.quick-input-widget').isVisible(), false);
	await agent.keyboard.press('Escape');
	await agent.keyboard.press('Control+KeyT');
	await workspace.locator('.browser-welcome-container').waitFor({state:'visible'});
	await agent.keyboard.press('Control+Alt+KeyL');
	await agent.keyboard.press('Control+Backquote');
	await agent.locator('.openide-agent-window-terminal-island').waitFor({state:'visible'});
	await agent.keyboard.press('Control+Backquote');
	await agent.locator('.openide-agent-window-terminal-island').waitFor({state:'hidden'});
	await composer.click();
	fs.writeFileSync(path.join(tmp,'profile/User/keybindings.json'), JSON.stringify([{key:'ctrl+alt+r',command:'openide.agentWindow.review',when:'openideAgentWindowId > 0'}]));
	await agent.waitForFunction(() => document.querySelector('.openide-agent-window-editor-empty .openide-empty-state-keybinding')?.textContent.includes('R'));
	await agent.keyboard.press('Control+Alt+KeyR');
	await workspace.getByRole('heading', { name: 'No changes to review', exact: true }).waitFor();
	await ide.evaluate(() => window.chatWelcomeFixture.dispose());
	assert.deepEqual(errors, []);
	console.log('Empty states and scoped shortcuts passed');
} finally { if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true}); }
