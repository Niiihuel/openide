// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-agent-window-settings-runtime.mjs
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
const output = path.join(root, '.build/agent-window-settings-runtime');
fs.mkdirSync(path.join(tmp, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace')); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom', 'window.controlsStyle': 'custom' }));
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
		const { IOpenideAgentService } = await import(base + 'workbench/contrib/openideAgent/browser/openideAgentService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id:'test.agentSettings',title:'Agent Settings Fixture',f1:true }); }
			async run(accessor) {
				const commands=accessor.get(ICommandService);
				const runtime=accessor.get(IOpenideChatRuntime);
				const agent=accessor.get(IOpenideAgentService);
				agent.getVoiceCapability = async () => ({ available: false, reason: 'Choose an audio model' });
				agent.listVoiceModels = async () => ({
					groups: [{ id: 'nvidia-nim', label: 'NVIDIA NIM', models: [{ id: 'fixture-audio-model', name: 'Fixture audio model', context: '', input: ['audio'], output: ['text'], toolCall: false, reasoning: false, costIn: '', costOut: '', hasCost: false, efforts: [], toggle: false }] }],
					excluded: [{ id: 'openai-codex', label: 'ChatGPT (Codex subscription)', reason: 'noAudioModel' }, { id: 'opencode', label: 'OpenCode Zen', reason: 'protocol' }],
				});
				window.agentSettingsFixture = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
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
	await ide.evaluate(() => window.agentSettingsFixture.showUsage());
	const usageItem=agent.locator('[id="openide.agent.usage"]');
	const usageMenu=agent.locator('.openide-usage-menu');
	await usageItem.locator('.statusbar-item-label').click();
	await usageMenu.waitFor({state:'visible'});
	assert.equal(await ide.locator('.openide-usage-menu').count(),0,'usage label opens only in auxiliary');
	await usageItem.locator('.statusbar-item-label').click();
	await usageMenu.waitFor({state:'hidden'});
	const workspaceVisible = await agent.locator('.openide-agent-window-workspace').isVisible();
	await agent.locator('.openide-agent-window-footer button.icon-only').click();
	await agent.locator('.openide-settings').waitFor();
	assert.equal(await agent.locator('.openide-agent-settings-surface .tabs-container:visible').count(),0);
	await agent.locator('.openide-settings-back').click();
	await agent.locator('.openide-settings').waitFor({state:'detached'});
	assert.equal(await agent.locator('.openide-agent-window-workspace').isVisible(),workspaceVisible,'Settings does not reveal a closed workspace panel');
	await agent.keyboard.press('Control+Shift+KeyE');
	await agent.locator('.openide-agent-window-workspace .tab').first().waitFor();
	const workspaceTabs = await agent.locator('.openide-agent-window-workspace .tab').allTextContents();
	await agent.locator('.openide-agent-window-footer .openide-settings-profile').click();
	await agent.locator('.openide-profile-page').waitFor();
	assert.equal(await agent.locator('[data-nav-id="workbench/profile"].active').count(),1,'profile footer opens the Profile category');
	await agent.screenshot({path:path.join(output,'profile-page.png')});
	const modal = agent.locator('.monaco-modal-editor-block:not(.embedded-editor)');
	await modal.waitFor();
	assert.equal(await modal.locator('.tabs-container:visible').count(),0,'Settings has no workspace tabs');
	await agent.getByRole('button', { name: 'Manage profile', exact: true }).click();
	await agent.locator('.openide-local-profiles').waitFor();
	assert.equal(await modal.count(), 1, 'Manage profile stays in expanded Settings');
	assert.equal(await agent.locator('.openide-settings').count(), 1, 'profile management reuses Settings');
	assert.equal(await agent.locator('.openide-settings-page-title').innerText(), 'Manage profile');
	await agent.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Fixture profile');
	await agent.getByRole('button', { name: 'Create profile', exact: true }).click();
	const profileCard = agent.locator('.openide-settings-card').filter({ has: agent.getByRole('button', { name: 'Save name', exact: true }) });
	await profileCard.waitFor();
	await profileCard.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Renamed fixture');
	await profileCard.getByRole('button', { name: 'Save name', exact: true }).click();
	await agent.waitForFunction(() => document.querySelector('.openide-local-profiles')?.textContent?.includes('Renamed fixture'));
	await profileCard.getByRole('button', { name: 'Use profile', exact: true }).click();
	await profileCard.getByText('Current profile', {exact:true}).waitFor();
	assert.equal(await modal.count(), 1, 'switching profiles stays in Settings');
	await agent.locator('.openide-settings-card').filter({hasText:'Default'}).getByRole('button', {name:'Use profile',exact:true}).click();
	await profileCard.getByRole('button', { name: 'Use profile', exact: true }).waitFor();
	// Profile switching restarts extension hosts and refreshes configuration asynchronously.
	// Wait for the Settings subtree to settle before testing its two-click confirmation.
	await agent.evaluate(() => new Promise(resolve => {
		let timer;
		const observer = new MutationObserver(settle);
		function settle() { clearTimeout(timer); timer = setTimeout(() => { observer.disconnect(); resolve(); }, 750); }
		observer.observe(document.querySelector('.openide-settings-list'), {subtree:true,childList:true});
		settle();
	}));
	await agent.screenshot({path:path.join(output,'manage-profile.png')});
	await profileCard.getByRole('button', { name: 'Delete profile', exact: true }).click();
	assert.equal(await profileCard.count(), 1, 'first click requires confirmation');
	await profileCard.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
	await profileCard.waitFor({state:'detached'});
	await agent.locator('.openide-settings-breadcrumb-item').filter({hasText: /^Profile$/}).click();
	await agent.locator('.openide-profile-page').waitFor();
	assert.equal(await modal.count(), 1, 'profile CRUD and back navigation keep the modal');

	await agent.locator('.openide-settings').waitFor();
	assert.equal(await ide.locator('.openide-settings').count(),0,'Settings stays in auxiliary');
	const search = agent.locator('.openide-settings-sidebar input').first();
	await agent.locator('[data-nav-id="home"]').click();
	await search.fill('font size');
	await agent.waitForFunction(()=>document.querySelector('.openide-settings-list')?.textContent?.toLowerCase().includes('font size'));
	await agent.locator('.openide-settings-sidebar .openide-settings-profile').click();
	await agent.locator('.openide-profile-page').waitFor();
	assert.equal(await search.inputValue(), '', 'profile navigation clears a previous settings filter');
	await search.fill('');
	await agent.locator('[data-nav-id="openideAgent/providers"]').click();
	await agent.locator('.openide-settings-provider-intro').waitFor();
	await agent.screenshot({path:path.join(output,'agent-settings-providers.png')});
	await agent.locator('[data-nav-id="openideAgent/voice"]').click();
	await agent.locator('.openide-settings-voice-excluded').waitFor();
	assert.equal(await agent.locator('.openide-settings-voice-excluded').evaluate(element => element.open), false, 'providers without dictation are collapsed by default');
	assert.equal(await agent.locator('.openide-settings-voice-excluded-count').innerText(), '2');
	await agent.screenshot({path:path.join(output,'agent-settings-voice.png')});
	await agent.locator('.openide-settings-voice-excluded-summary').click();
	assert.equal(await agent.locator('.openide-settings-voice-excluded-content .openide-provider-icon-tile').count(), 2);
	await agent.locator('.openide-settings-voice-excluded').scrollIntoViewIfNeeded();
	await agent.screenshot({path:path.join(output,'agent-settings-voice-details.png')});
	await agent.locator('[data-nav-id="openideAgent/subagents"]').click();
	await agent.locator('.openide-subagent-settings-status .openide-settings-section-body').waitFor();
	await agent.getByRole('button', { name: 'Manage providers', exact: true }).waitFor();
	assert.equal(await agent.locator('.openide-subagent-settings-status .openide-settings-status-row.off').count(), 0, 'subagent routing does not dump disconnected catalog entries');
	await agent.locator('.openide-subagent-settings-status').scrollIntoViewIfNeeded();
	await agent.screenshot({path:path.join(output,'agent-settings-subagents.png')});
	await agent.getByRole('button', { name: 'Manage providers', exact: true }).click();
	await agent.locator('.openide-settings-provider-intro').waitFor();
	await agent.locator('[data-nav-id="openideAgent/projectMap"]').click();
	await agent.locator('.openide-project-map-settings .openide-settings-metrics').first().waitFor();
	assert.equal(await agent.locator('.openide-project-map-index .openide-settings-metric').count(), 5);
	await agent.locator('.openide-project-map-index').scrollIntoViewIfNeeded();
	await agent.screenshot({path:path.join(output,'agent-settings-project-map.png')});
	await agent.locator('.openide-settings-back').click();
	await agent.locator('.openide-settings').waitFor({state:'detached'});
	assert.equal(await agent.locator('.openide-agent-window').count(),1,'closing Settings returns to companion shell');
	assert.deepEqual(await agent.locator('.openide-agent-window-workspace .tab').allTextContents(), workspaceTabs, 'Settings never joins or replaces workspace tabs');
	assert.deepEqual(errors,[],'shared Settings controls support auxiliary DOM');
	const result={localUsageLabel:true,profilePage:true,manageProfileInSettings:true,profileCreateRenameDelete:true,profileSwitch:true,usageToggle:true,localSettings:true,search:true,providersPage:true,voicePage:true,subagentRoutingSummary:true,projectMapLayout:true,closeReturnsToChat:true};
	fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { if(app) { await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())); await app.close(); } fs.rmSync(tmp,{recursive:true,force:true}); }
