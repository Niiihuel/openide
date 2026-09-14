#!/usr/bin/env node
// Copyright (c) OpenIDE. Licensed under the MIT License.
// Public What's New command + production subagent row, in a disposable real workbench.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _electron } = createRequire(path.join(root, 'vscode/package.json'))('playwright-core');
if (process.env.OPENIDE_TEST_VIRTUAL_DISPLAY !== '1') throw new Error('Run with dev/run-virtual-gui.mjs to avoid disturbing the desktop.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openide-update-card-'));
const output = path.join(root, '.build/update-card-runtime');
const userData = path.join(tmp, 'user-data');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'workspace'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'window.titleBarStyle': 'custom',
 'update.showPostInstallInfo': false, 'openide.memory.captureMode': 'off',
}));
let app; let page; const logs = [];
async function command(name) {
 await page.keyboard.press('Escape');
 await page.keyboard.press('Control+Shift+KeyP');
 const input = page.locator('.quick-input-widget input').first();
 await input.fill(`>${name}`);
 await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: name }).first().waitFor({ state: 'visible' });
 await page.keyboard.press('Enter');
}
try {
 app = await _electron.launch({ executablePath: path.join(root, 'vscode/.build/electron/openide'), cwd: path.join(root, 'vscode'), args: ['.', path.join(tmp, 'workspace'), '--user-data-dir', userData, '--shared-data-dir', path.join(tmp, 'shared'), '--extensions-dir', path.join(tmp, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--ozone-platform=x11'], env: { ...process.env, VSCODE_DEV: '1' }, timeout: 90000 });
 page = await app.firstWindow();
 page.on('console', message => logs.push(message.text()));
 page.on('pageerror', error => logs.push(error.stack));
 await page.waitForSelector('.monaco-workbench', { timeout: 90000 });
 await command("OpenIDE: What's New");
 const card = page.locator('.post-update-widget');
 await card.waitFor({ state: 'visible', timeout: 30000 });
 await card.locator('.title').filter({ hasText: 'OpenIDE 1.3.0' }).waitFor();
 assert.equal(await card.locator('.feature').count(), 5);
 assert.equal(await card.locator('.feature-icon.codicon-notebook').count(), 1);
 await page.screenshot({ path: path.join(output, 'whats-new.png') });
 await card.locator('.banner-close').click();
 await card.waitFor({ state: 'hidden' });
 await command('OpenIDE Agent: New chat');
 await page.locator('.openide-chat-composer textarea').first().waitFor();
 // Instantiate the production component, with only tooltip plumbing stubbed; the real
 // chat's full CSS cascade remains loaded. No model or subagent execution is requested.
 await page.evaluate(async moduleUrl => {
  const { OpenideChatSubagentPart } = await import(moduleUrl);
  const part = new OpenideChatSubagentPart({ kind: 'subagent', runId: 'visual-fixture', index: 0, total: 1, title: 'Revisar estilos de la interfaz', status: 'running', timeline: [] }, {}, { setupDelayedHover: () => ({ dispose() {} }) });
  const host = document.createElement('div');
  host.className = 'openide-chat-native';
  host.id = 'subagent-visual-fixture';
  Object.assign(host.style, { position: 'fixed', zIndex: '10000', top: '160px', left: '80px', width: '600px', padding: '24px', background: 'var(--vscode-editor-background)' });
  host.appendChild(part.domNode);
  document.querySelector('.monaco-workbench').appendChild(host);
  window.disposeSubagentFixture = () => { part.dispose(); host.remove(); };
 }, `vscode-file://vscode-app${root}/vscode/out/vs/workbench/contrib/openideAgent/browser/chat/parts/openideChatSubagentPart.js`);
 const button = page.locator('#subagent-visual-fixture .openide-chat-sub-action');
 const styles = () => button.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, border: s.borderTopWidth, radius: s.borderRadius, padding: s.padding, shadow: s.boxShadow }; });
 const expected = { background: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px', padding: '0px', shadow: 'none' };
 assert.deepEqual(await styles(), expected);
 await button.hover();
 assert.deepEqual(await styles(), expected);
 await page.locator('#subagent-visual-fixture').screenshot({ path: path.join(output, 'subagent-hover.png'), animations: 'disabled' });
 await button.focus();
 assert.equal(await button.evaluate(el => el === document.activeElement), true);
 await page.evaluate(() => window.disposeSubagentFixture());
 fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, releaseCard: '1.3.0', publicCommand: true, subagentProductionComponent: true, transparentRestAndHover: true, keyboardFocusable: true }, null, 2));
 console.log('PASS: public release card, dismissal, subagent rest/hover styles and keyboard focus.');
} catch (error) {
 if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
 fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, error: String(error) }, null, 2));
 throw error;
} finally {
 fs.writeFileSync(path.join(output, 'console.log'), logs.join('\n'));
 if (app) await app.close().catch(() => {});
 fs.rmSync(tmp, { recursive: true, force: true });
}
