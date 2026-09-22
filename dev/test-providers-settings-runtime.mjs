// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run with: node dev/run-virtual-gui.mjs dev/test-providers-settings-runtime.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') { throw new Error('Use dev/run-virtual-gui.mjs'); }
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-providers-settings-'));
const output = path.join(root, '.build/providers-settings-runtime');
const fakeKey = 'fixture-only-key-never-a-real-credential';
const requests = [];
let serverUnavailable = false;
const server = http.createServer((request, response) => {
	const authorized = request.headers.authorization === `Bearer ${fakeKey}`;
	const status = request.url === '/v1/models' ? (serverUnavailable ? 503 : authorized ? 200 : 401) : 404;
	requests.push({ path: request.url, method: request.method, authorized, status });
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(JSON.stringify(status === 200
		? { object: 'list', data: ['fixture-small', 'fixture-reasoning', 'fixture-vision'].map(id => ({ id, object: 'model' })) }
		: { error: { message: 'Fixture authentication rejected', type: 'authentication_error' } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
fs.mkdirSync(path.join(temporary, 'profile/User'), { recursive: true });
fs.mkdirSync(path.join(temporary, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(temporary, 'profile/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'window.titleBarStyle': 'custom',
	'window.controlsStyle': 'custom',
	'openide.agent.usage.enabled': false,
	'chat.plugins.marketplaces': [],
	'chat.plugins.extraMarketplaces': {},
}));

let app;
const errors = [];
try {
	app = await _electron.launch({
		executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'),
		args: ['.', path.join(temporary, 'workspace'), '--user-data-dir', path.join(temporary, 'profile'), '--shared-data-dir', path.join(temporary, 'shared'), '--extensions-dir', path.join(temporary, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--password-store=basic', '--no-sandbox', '--ozone-platform=x11'],
		env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000,
	});
	const ide = await app.firstWindow();
	const observe = page => {
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => {
			if (message.type() === 'error' && !message.text().includes('No default agent registered')) { errors.push(message.text()); }
		});
	};
	observe(ide);
	await ide.waitForSelector('.monaco-workbench', { timeout: 90000 });
	await ide.evaluate(async ({ base, endpoint }) => {
		const { Action2, registerAction2 } = await import(base + 'platform/actions/common/actions.js');
		const { ICommandService } = await import(base + 'platform/commands/common/commands.js');
		const { IConfigurationService } = await import(base + 'platform/configuration/common/configuration.js');
		const { IOpenideProviderService } = await import(base + 'workbench/contrib/openideAgent/browser/openideProviderService.js');
		const { IOpenideNativeServices } = await import(base + 'workbench/contrib/openideAgent/common/openideNativeServices.js');
		const { OpenideRequestChannelClient } = await import(base + 'platform/request/common/openideRequestIpc.js');
		const { IWorkbenchThemeService } = await import(base + 'workbench/services/themes/common/workbenchThemeService.js');
		registerAction2(class extends Action2 {
			constructor() { super({ id: 'test.providersSettings', title: 'Providers Settings Fixture', f1: true }); }
			async run(accessor) {
				const commands = accessor.get(ICommandService);
				const native = accessor.get(IOpenideNativeServices);
				const providers = accessor.get(IOpenideProviderService);
				const configuration = accessor.get(IConfigurationService);
				const themes = accessor.get(IWorkbenchThemeService);
				// Keep actual provider transport and secret storage, with synthetic external sources.
				// No credentials from the user's environment, keyring profile or CLI files participate.
				let external = { env: {}, sources: [] };
				providers.auth.useRegistry(id => ({ registryId: id, envNames: [] }), () => [], async () => external);
				providers.catalog.ensureFresh = async () => {};
				providers.catalog.refreshNow = async () => {};
				providers.catalog.providers = () => [];
				const isolatedRequests = new OpenideRequestChannelClient(native.requests.channel);
				native.requests.request = (options, token) => {
					if (!options.url.startsWith(endpoint + '/')) { return Promise.reject(new Error('Fixture blocks non-local provider requests')); }
					return isolatedRequests.request(options, token);
				};
				window.providersFixture = {
					open: () => commands.executeCommand('openide.agent.openAgentWindow'),
					refresh: () => providers.refreshProviderConnections(),
					configured: () => configuration.getValue('openide.agent.customProviders'),
					selection: () => ({ provider: providers.getActiveProviderId(), model: providers.getModel() }),
					hasKey: id => providers.hasStoredApiKey(id),
					connection: id => providers.checkProviderConnection(id),
					clearKey: id => providers.clearApiKey(id),
					setExternalKey: (id, key) => { external = { env: {}, sources: [{ id: 'fixture-cli', scan: { keys: { [id]: { key } }, oauth: [] } }] }; providers.refreshProviderConnections(); },
					theme: async type => {
						const available = await themes.getColorThemes();
						const theme = available.find(item => item.label === ({ dark: 'OpenIDE Dark', light: 'OpenIDE Light' }[type])) ?? available.find(item => item.type === type);
						if (!theme) { throw new Error(`Missing ${type} theme`); }
						await themes.setColorTheme(theme, undefined);
					},
				};
			}
		});
	}, { base: `vscode-file://vscode-app${root}/vscode/out/vs/`, endpoint });
	await ide.keyboard.press('Control+Shift+KeyP');
	await ide.locator('.quick-input-widget input').first().fill('>Providers Settings Fixture');
	await ide.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Providers Settings Fixture' }).first().waitFor();
	await ide.keyboard.press('Enter');
	await ide.waitForFunction(() => !!window.providersFixture);
	const opened = app.waitForEvent('window');
	await ide.evaluate(() => window.providersFixture.open());
	const agent = await opened;
	observe(agent);
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.setSize(1500, 950)));
	await agent.locator('.openide-agent-window').waitFor();
	await agent.locator('.openide-agent-window-footer button.icon-only').click();
	await agent.locator('.openide-settings').waitFor();
	await agent.locator('[data-nav-id="openideAgent/providers"]').click();
	await agent.locator('.openide-settings-provider-add').waitFor();
	await agent.screenshot({ path: path.join(output, 'providers-index.png') });
	const filter = agent.locator('[data-provider-focus="provider-filter"]');
	await filter.fill('open');
	await filter.evaluate(element => { element.focus(); element.setSelectionRange(2, 2); });
	const filterSnapshot = () => agent.evaluate(() => {
		const input = document.querySelector('[data-provider-focus="provider-filter"]');
		return { value: input?.value, start: input?.selectionStart, focused: document.activeElement === input, active: { tag: document.activeElement?.tagName, classes: document.activeElement?.className } };
	});
	const filterStates = [await filterSnapshot()];
	assert.equal(filterStates[0].focused, true, 'filter focus is established before refreshing detection');
	await ide.evaluate(() => window.providersFixture.refresh());
	filterStates.push(await filterSnapshot());
	await agent.waitForFunction(() => {
		const input = document.querySelector('[data-provider-focus="provider-filter"]');
		return input?.value === 'open' && input.selectionStart === 2 && document.activeElement === input;
	}).catch(async error => { filterStates.push(await filterSnapshot()); fs.writeFileSync(path.join(output, 'filter-failure.json'), JSON.stringify(filterStates)); throw error; });
	fs.writeFileSync(path.join(output, 'filter-state.json'), JSON.stringify(filterStates));
	await filter.fill('');
	await agent.locator('.openide-settings-provider-add').click();
	const form = agent.locator('.openide-provider-setup');
	await form.waitFor();
	const field = name => form.locator(`[data-provider-field="${name}"]`);
	await field('name').fill('Local fixture');
	await field('id').fill('fixture-provider');
	await field('baseUrl').fill(endpoint);
	await field('defaultModel').fill('fixture-small');
	const authentication = form.getByRole('button', { name: 'Authentication', exact: true });
	await authentication.focus();
	await agent.keyboard.press('Enter');
	const dropdown = agent.locator('.openide-menu-settings-dropdown');
	await dropdown.getByRole('button', { name: 'No authentication', exact: true }).waitFor();
	await agent.waitForFunction(() => !!document.activeElement?.closest('.openide-menu-settings-dropdown'));
	assert.equal(await ide.locator('.openide-menu-settings-dropdown:visible').count(), 0, 'authentication options stay in the Agents window');
	await agent.keyboard.press('End');
	await agent.keyboard.press('Enter');
	assert.equal(await field('apiKey').isVisible(), false, 'no-authentication mode hides the key field');
	await authentication.focus();
	await agent.keyboard.press('Enter');
	await dropdown.getByRole('button', { name: 'API key', exact: true }).waitFor();
	await agent.waitForFunction(() => !!document.activeElement?.closest('.openide-menu-settings-dropdown'));
	await agent.keyboard.press('Home');
	await agent.keyboard.press('Enter');
	await field('apiKey').waitFor({ state: 'visible' });
	await field('apiKey').fill(fakeKey);
	assert.equal(await field('apiKey').getAttribute('type'), 'password', 'API keys are masked by default');
	await form.locator('[data-provider-action="reveal-key"]').click();
	assert.equal(await field('apiKey').getAttribute('type'), 'text', 'key visibility changes only through the explicit reveal control');
	await form.locator('[data-provider-action="reveal-key"]').click();
	await form.locator('[data-provider-action="check"]').click();
	await form.locator('.openide-provider-setup-status.success').waitFor();
	assert.equal(await ide.evaluate(() => window.providersFixture.hasKey('fixture-provider')), false, 'testing a draft does not persist its key');
	assert.equal(await ide.evaluate(() => (window.providersFixture.configured() ?? []).some(provider => provider.id === 'fixture-provider')), false, 'testing a draft does not create a provider');
	await field('name').focus();
	await agent.keyboard.press('Tab');
	assert.equal(await field('id').evaluate(element => document.activeElement === element), true, 'keyboard navigation follows the setup form');
	const themeStyles = [];
	for (const theme of ['dark', 'light', 'hcDark']) {
		await ide.evaluate(async theme => window.providersFixture.theme(theme), theme);
		await agent.waitForFunction(themeClass => document.querySelector('.monaco-workbench')?.classList.contains(themeClass), { dark: 'vs-dark', light: 'vs', hcDark: 'hc-black' }[theme]);
		await agent.screenshot({ path: path.join(output, `providers-setup-${theme}.png`) });
		themeStyles.push(await form.evaluate((element, theme) => ({ theme, background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, fitsViewport: element.getBoundingClientRect().right <= innerWidth }), theme));
	}
	await ide.evaluate(async () => window.providersFixture.theme('dark'));
	assert.ok(themeStyles.every(style => style.fitsViewport), 'setup fits the viewport in each theme');
	await form.locator('[data-provider-action="save"]').click();
	await form.waitFor({ state: 'detached' });
	await agent.waitForFunction(() => document.querySelector('.openide-settings-list')?.textContent?.includes('fixture-small'));
	assert.equal(await ide.evaluate(() => window.providersFixture.hasKey('fixture-provider')), true, 'submitted key is stored in the isolated profile');
	const configured = await ide.evaluate(() => window.providersFixture.configured());
	assert.equal(configured.find(provider => provider.id === 'fixture-provider')?.baseUrl, endpoint);
	assert.equal(JSON.stringify(configured).includes(fakeKey), false, 'API key never enters settings JSON');
	assert.ok(requests.some(request => request.path === '/v1/models' && request.authorized), 'real local transport discovers models with the submitted credential');
	assert.equal(await agent.locator('.openide-settings').innerText().then(text => text.includes(fakeKey)), false, 'secret is absent from visible Settings text');
	await agent.locator('.openide-settings-provider-model').filter({ hasText: 'fixture-reasoning' }).click();
	await ide.waitForFunction(() => window.providersFixture.selection().provider === 'fixture-provider' && window.providersFixture.selection().model === 'fixture-reasoning');
	await agent.screenshot({ path: path.join(output, 'providers-connected.png') });
	const key = agent.locator('[data-provider-key-input]');
	await key.fill('fixture-rejected-key');
	await key.evaluate(element => { element.focus(); element.setSelectionRange(7, 7); });
	await ide.evaluate(() => window.providersFixture.refresh());
	await agent.waitForFunction(() => {
		const input = document.querySelector('[data-provider-key-input]');
		return input?.value === 'fixture-rejected-key' && input.selectionStart === 7 && document.activeElement === input;
	});
	await agent.locator('[data-provider-action="save-key"]').click();
	await agent.locator('[data-provider-check="auth-error"]').waitFor();
	assert.equal(await key.inputValue(), 'fixture-rejected-key', 'rejected replacement remains editable');
	assert.equal(await ide.evaluate(async () => (await window.providersFixture.connection('fixture-provider')).status), 'available', 'rejected key does not overwrite the working credential');
	await agent.screenshot({ path: path.join(output, 'providers-rejected-key.png') });
	await key.fill(fakeKey);
	serverUnavailable = true;
	await agent.locator('[data-provider-action="check-key"]').click();
	await agent.locator('[data-provider-action="save-unchecked"]').waitFor();
	assert.equal(await key.inputValue(), fakeKey, 'server failure leaves the draft available for explicit offline save');
	await agent.screenshot({ path: path.join(output, 'providers-server-unavailable.png') });
	serverUnavailable = false;
	await agent.locator('[data-provider-action="check-key"]').click();
	await agent.locator('[data-provider-check="available"]').waitFor();
	await agent.locator('[data-provider-action="save-key"]').click();
	await agent.waitForFunction(() => document.querySelector('[data-provider-key-input]')?.value === '');
	await ide.evaluate(async ({ id, key }) => {
		await window.providersFixture.clearKey(id);
		window.providersFixture.setExternalKey(id, key);
	}, { id: 'fixture-provider', key: fakeKey });
	await agent.waitForFunction(() => document.querySelector('.openide-settings-list')?.textContent?.includes('fixture-cli'));
	assert.equal(await ide.evaluate(() => window.providersFixture.hasKey('fixture-provider')), false, 'detected external credential is not copied into the secret store');
	assert.equal(await ide.evaluate(async () => (await window.providersFixture.connection('fixture-provider')).status), 'available', 'refreshed external credential works through the same transport');
	await agent.screenshot({ path: path.join(output, 'providers-detected.png') });
	await agent.getByRole('button', { name: 'Edit provider', exact: true }).click();
	await form.waitFor();
	assert.equal(await field('id').getAttribute('readonly'), '', 'editing keeps the provider identity stable');
	assert.equal(await field('apiKey').inputValue(), '', 'editing never loads the stored credential into the form');
	await field('name').fill('Updated local fixture');
	await field('apiKey').fill('fixture-rejected-key');
	await form.locator('[data-provider-action="save"]').click();
	await form.locator('.openide-provider-setup-status.error').waitFor();
	assert.equal(await ide.evaluate(() => window.providersFixture.configured().find(provider => provider.id === 'fixture-provider')?.label), 'Local fixture', 'rejected edit does not save a partial configuration');
	assert.equal(await ide.evaluate(() => window.providersFixture.hasKey('fixture-provider')), false, 'rejected edit does not replace an external credential with a bad stored key');
	assert.equal(await field('apiKey').inputValue(), 'fixture-rejected-key', 'rejected edit preserves the key draft for correction');
	await field('apiKey').fill('');
	await form.locator('[data-provider-action="save"]').click();
	await form.waitFor({ state: 'detached' });
	const updated = await ide.evaluate(() => window.providersFixture.configured());
	assert.deepEqual(updated.filter(provider => provider.id === 'fixture-provider').map(provider => provider.label), ['Updated local fixture'], 'editing updates one provider rather than adding a duplicate');
	assert.equal(await ide.evaluate(() => window.providersFixture.hasKey('fixture-provider')), false, 'editing keeps external credentials external');
	assert.ok(requests.every(request => request.method === 'GET'), 'connection tests only list models; they never generate billable content');
	assert.deepEqual(errors, [], 'provider Settings produces no renderer errors');
	const result = { isolatedProfile: true, nativeSetup: true, editPreservesIdentity: true, rejectedEditPreservesConfiguration: true, localModelDiscovery: true, modelSelectionActivatesProvider: true, secretOutsideSettings: true, failedReplacementPreservesKey: true, explicitOfflineFallback: true, externalDetectionWithoutCopy: true, focusAndCaretPreserved: true, keyboardNavigation: true, themeStyles, requests };
	fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
	for (const stale of ['failure-0.png', 'failure-1.png', 'filter-failure.json', 'focus-trace.json']) { fs.rmSync(path.join(output, stale), { force: true }); }
	console.log(JSON.stringify(result));
} catch (error) {
	console.error(error);
	if (app) { for (const [index, page] of app.windows().entries()) { await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {}); } }
	throw error;
} finally {
	if (app) {
		const deadline = setTimeout(() => app.process().kill('SIGKILL'), 5000);
		try { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); } finally { clearTimeout(deadline); }
	}
	await new Promise(resolve => server.close(resolve));
	fs.rmSync(temporary, { recursive: true, force: true });
}
