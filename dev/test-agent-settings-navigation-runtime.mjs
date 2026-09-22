// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-settings-navigation-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-agent-settings-'));
const output = path.join(root, '.build/agent-settings-navigation-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
for (let index = 0; index < 30; index++) {
	const name = `fixture-skill-${String(index).padStart(2, '0')}`;
	const folder = path.join(tmp, 'workspace/.agents/skills', name);
	fs.mkdirSync(folder, { recursive: true });
	fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A reusable project workflow with a clear description, keyboard actions and native Settings controls.\n---\nFixture instructions.\n`);
}
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom', 'chat.plugins.marketplaces': [], 'chat.plugins.extraMarketplaces': {} }));
let app; const errors = [];
try {
	app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', path.join(tmp, 'profile'), '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
	const ide = await app.firstWindow(); ide.on('pageerror', error => { errors.push(error.message); console.error(error); });
	ide.on('console', msg => { if(msg.type()==='error' && !msg.text().includes('No default agent registered')) { errors.push(msg.text()); console.error(msg.text()); } });
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async base => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IOpenideChatRuntime } = await import(base + 'workbench/contrib/openideAgent/browser/openideChatRuntime.js');
		const { IEditorService } = await import(base + 'workbench/services/editor/common/editorService.js');
		const { IBrowserViewWorkbenchService } = await import(base + 'workbench/contrib/browserView/common/browserView.js');
		const { IWorkbenchThemeService } = await import(base + 'workbench/services/themes/common/workbenchThemeService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentSettings',title:'Agent Settings Fixture',f1:true }); }
			async run(accessor) {
				const commands=accessor.get(ICommandService);
				const runtime=accessor.get(IOpenideChatRuntime);
				const editors=accessor.get(IEditorService);
				const browser=accessor.get(IBrowserViewWorkbenchService);
				const themes=accessor.get(IWorkbenchThemeService);
				window.agentSettingsFixture = {
					theme: async type => {
						const available = await themes.getColorThemes();
						const theme = available.find(theme => theme.label === ({dark:'OpenIDE Dark',light:'OpenIDE Light'}[type])) ?? available.find(theme => theme.type === type);
						if (!theme) { throw new Error(`Missing ${type} theme`); }
						await themes.setColorTheme(theme, undefined);
					},
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					openProjectBrowser: () => editors.openEditor(browser.getOrCreatePreview('about:blank'), { pinned: true }),
					showUsage: () => {
						// Controlled display snapshot only; no account connection, quota fetch or model request.
						const status=runtime.status;
						status._statusConnected=true;
						status._statusProviderId='fixture-provider';
						status._usageSummary={providerId:'fixture-provider',text:'42%',tooltip:'Fixture usage'};
						status.updateStatusbar();
					},
				};
			}
		});
	}, `vscode-file://vscode-app${root}/vscode/out/vs/`);
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Agent Settings Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({hasText:'Agent Settings Fixture'}).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.agentSettingsFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.agentSettingsFixture.open());
	const agent = await opened;
	agent.on('pageerror',error=>errors.push(error.message));
	agent.on('console',message=>{ if(message.type()==='error') { console.error(message.text()); if(!message.text().includes('No default agent registered')) errors.push(message.text()); } });
	await agent.locator('.openide-agent-window').waitFor();
	await ide.evaluate(async () => { await window.agentSettingsFixture.openProjectBrowser(); });
	await agent.locator('.openide-agent-editor-surface.embedded-editor .tab').first().waitFor();
	const workspaceTabs = await agent.locator('.openide-agent-editor-surface .tab').allTextContents();
	assert.ok(workspaceTabs.length > 0, 'fixture has a real project browser tab');
	const workspaceModalBefore = await agent.locator('.openide-agent-editor-surface:not(.embedded-editor)').count();
	await agent.locator('.openide-agent-window-footer button.icon-only').click();
	await agent.locator('.openide-settings').waitFor();
	await agent.locator('[data-nav-id="openideAgent/skills"]').click();
	await agent.getByRole('button', { name: 'Browse plugins', exact: true }).click();
	const customizations = agent.locator('.ai-customization-management-editor');
	await customizations.waitFor({state:'visible'});
	const pluginModal = agent.locator('.monaco-modal-editor-block').filter({ has: customizations });
	assert.equal(await pluginModal.locator('.browser-root').count(), 0, 'marketplace has no project browser');
	assert.equal(await pluginModal.locator('.openide-settings').count(), 0, 'marketplace is a child surface, preserving Settings behind it');
	assert.equal(await agent.locator('.openide-agent-editor-surface:not(.embedded-editor)').count(), workspaceModalBefore, 'marketplace never expands the project workspace');
	assert.deepEqual(await agent.locator('.openide-agent-editor-surface .tab').allTextContents(), workspaceTabs, 'marketplace does not join project tabs');
	await agent.screenshot({path:path.join(output,'plugins-isolated.png')});
	await customizations.locator('.section-list-item').filter({ has: agent.locator('.section-label', { hasText: /^Skills$/ }) }).click();
	const fixtureRow = customizations.locator('.customization-home-row').filter({ hasText: 'fixture-skill-00' });
	await fixtureRow.waitFor({ state: 'visible' });
	const more = fixtureRow.locator('.plugin-card-icon-button');
	const customizationStyles = [];
	for (const theme of ['dark', 'light', 'hcDark']) {
		await ide.evaluate(async theme => { await window.agentSettingsFixture.theme(theme); }, theme);
		await agent.waitForFunction(themeClass => document.querySelector('.monaco-workbench')?.classList.contains(themeClass), {dark:'vs-dark',light:'vs',hcDark:'hc-black'}[theme]);
		await agent.mouse.move(0, 0);
		await agent.waitForFunction(() => {
			const action = document.querySelector('.customization-home-row .plugin-card-icon-button');
			return action && getComputedStyle(action).backgroundColor === 'rgba(0, 0, 0, 0)';
		});
		const style = await more.evaluate(element => {
			const action = getComputedStyle(element);
			const manager = element.closest('.ai-customization-management-editor');
			return { background: action.backgroundColor, border: action.borderTopWidth, radius: action.borderRadius,
				panel: getComputedStyle(manager.querySelector('.prompts-content-container')).backgroundColor,
				settings: getComputedStyle(document.querySelector('.openide-settings')).backgroundColor,
				rowShadow: getComputedStyle(element.closest('.plugin-home-row')).boxShadow };
		});
		assert.deepEqual({ background: style.background, border: style.border, rowShadow: style.rowShadow }, { background: 'rgba(0, 0, 0, 0)', border: '0px', rowShadow: 'none' }, `${theme}: overflow actions are quiet and rows have no separator stripes`);
		assert.equal(style.panel, style.settings, `${theme}: manager reuses Settings surface`);
		await more.hover();
		await agent.waitForFunction(element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)', await more.elementHandle());
		assert.notEqual(await more.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'hover reveals the icon target');
		await more.click();
		await agent.locator('.monaco-menu').last().waitFor({state:'visible'});
		await agent.keyboard.press('Escape');
		await fixtureRow.locator('.customization-card-primary-action').focus();
		await agent.keyboard.press('Tab');
		assert.equal(await more.evaluate(element => document.activeElement === element), true, 'Tab enters the row action');
		assert.equal(await more.evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'keyboard focus stays visible');
		await agent.screenshot({path:path.join(output,`customizations-skills-${theme}.png`)});
		customizationStyles.push({theme, ...style});
	}
	await ide.evaluate(async () => { await window.agentSettingsFixture.theme('dark'); });
	await pluginModal.locator('.modal-editor-header .codicon-close').click();
	await customizations.waitFor({state:'detached'});
	await agent.getByRole('button', { name: 'Browse plugins', exact: true }).waitFor({state:'visible'});
	assert.equal(await agent.locator('.openide-settings').count(), 1, 'closing marketplace restores the same Settings page');
	await agent.getByRole('button', { name: 'Install skill…', exact: true }).first().click();
	const installer = agent.locator('.openide-skill-installer');
	await installer.waitFor({state:'visible'});
	const installerModal = agent.locator('.monaco-modal-editor-block').filter({ has: installer });
	assert.ok(await installerModal.locator('.tab').count() <= 1, 'installer has at most its own tab');
	assert.equal(await installerModal.locator('.modal-editor-title').innerText(), 'Instalar Skill');
	assert.equal(await installerModal.locator('.browser-root').count(), 0, 'installer never takes the project browser');
	assert.equal(await installerModal.locator('.ai-customization-management-editor').count(), 0, 'previous marketplace is not revived inside installer');
	assert.deepEqual(await agent.locator('.openide-agent-editor-surface .tab').allTextContents(), workspaceTabs, 'installer preserves project tabs');
	await agent.screenshot({path:path.join(output,'installer-isolated.png')});
	await installerModal.locator('.modal-editor-header .codicon-close').click();
	await installer.waitFor({state:'detached'});
	await agent.getByRole('button', { name: 'Browse plugins', exact: true }).waitFor({state:'visible'});
	await agent.locator('.openide-settings-back').click();
	await agent.locator('.openide-settings').waitFor({state:'detached'});
	assert.deepEqual(await agent.locator('.openide-agent-editor-surface .tab').allTextContents(), workspaceTabs, 'closing Settings restores the original workspace');
	assert.equal(await agent.locator('.openide-agent-editor-surface.embedded-editor').count(), 1, 'workspace retains its docked presentation');
	assert.equal(await ide.locator('.ai-customization-management-editor, .openide-skill-installer, .openide-settings').count(),0,'Settings actions never open in the IDE owner');
	assert.deepEqual(errors,[],'Settings navigation produces no renderer errors');
	const result={browseVisible:true,pluginsIsolated:true,installerIsolated:true,projectTabsPreserved:true,backRestoresSettings:true,closeRestoresWorkspace:true,customizationStyles};
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch (error) {
	console.error(error);
	if (app) { for (const [index,page] of app.windows().entries()) { await page.screenshot({path:path.join(output,`failure-${index}.png`)}).catch(()=>{}); } }
	throw error;
} finally {
	if(app) {
		const deadline = setTimeout(() => app.process().kill('SIGKILL'), 5000);
		try { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{}); await app.close().catch(()=>{}); } finally { clearTimeout(deadline); }
	}
	fs.rmSync(tmp,{recursive:true,force:true});
}
