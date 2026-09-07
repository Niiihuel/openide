// Copyright (c) OpenIDE. Licensed under the MIT License.
// Electron worker for test-updater-restart.mjs; never touches a real installation.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { get } from 'node:http';
import path from 'node:path';
import { LinuxUpdateService } from '../../vscode/out/vs/platform/update/electron-main/updateService.linux.js';
import { TestConfigurationService } from '../../vscode/out/vs/platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../vscode/out/vs/platform/log/common/log.js';
import { NullTelemetryService } from '../../vscode/out/vs/platform/telemetry/common/telemetryUtils.js';
import { Event } from '../../vscode/out/vs/base/common/event.js';
import { newWriteableBufferStream, VSBuffer } from '../../vscode/out/vs/base/common/buffer.js';
import { StateType } from '../../vscode/out/vs/platform/update/common/update.js';
const fixture = process.env.OPENIDE_UPDATE_TEST_DIR;
assert.ok(fixture && fixture.includes('openide-restart-'));
const phase = process.env.OPENIDE_UPDATE_TEST_PHASE || 'old';
const result = path.join(fixture, 'result.json');
app.setPath('userData', path.join(fixture, 'profile'));
app.commandLine.appendSwitch('no-sandbox');
let updater;
const timer = setTimeout(() => { console.error('Update restart test timed out'); app.exit(1); }, 30000);
class Updater extends LinuxUpdateService {
 check() { this.quality = 'stable'; this.doCheckForUpdates(true); }
}
async function record(step) {
 let report; try { report = JSON.parse(await fs.readFile(result, 'utf8')); } catch { report = { steps: [] }; }
 report.steps.push(step); await fs.writeFile(result, JSON.stringify(report, null, 2)); console.log(step);
}
async function main() {
try {
 await app.whenReady();
 const window = new BrowserWindow({ width: 700, height: 400, show: false });
 await window.loadURL('data:text/html,<h1>OpenIDE isolated update lifecycle test</h1>');
 const publicKey = await fs.readFile(path.join(fixture, 'public-key.txt'), 'utf8');
 const storage = new Map();
 const request = { request: options => new Promise((resolve, reject) => {
  const route = options.url.endsWith('.minisig') ? '/signature' : options.url.endsWith('.json') ? '/manifest' : '/artifact';
  const req = get(process.env.OPENIDE_UPDATE_TEST_SERVER + route, response => {
   const stream = newWriteableBufferStream();
   response.on('data', data => stream.write(VSBuffer.wrap(data)));
   response.on('end', () => stream.end()); response.on('error', error => stream.error(error));
   resolve({ res: { statusCode: response.statusCode, headers: response.headers }, stream });
  }); req.on('error', reject);
 }) };
 updater = new Updater(
  { when: () => new Promise(() => {}), quit: async () => false },
  new TestConfigurationService({ update: { mode: 'manual' } }),
  { isBuilt: true }, request, new NullLogService(), { openExternal: () => { throw Error('Unexpected external download'); } },
  { applicationName: 'openide', nameShort: 'OpenIDE', quality: 'stable', version: '1.136.1', openideVersion: phase === 'old' ? '1.2.0' : '1.3.0', commit: 'a'.repeat(40), openideUpdateUrl: 'https://raw.githubusercontent.com/Niiihuel/openide/updates', updateUrl: 'https://raw.githubusercontent.com/Niiihuel/openide/updates', openideUpdateKeyId: 'fixture-key', openideUpdatePublicKey: publicKey, openideUpdaterVersion: 1 },
  NullTelemetryService,
  { whenReady: Promise.resolve(), get: (key, _scope, fallback) => storage.get(key) ?? fallback, store: (key, value) => storage.set(key, value) },
  { onDidChangeIsConnectionMetered: Event.None },
  { getWindows: () => [{ isReady: true }], onDidSignalReadyWindow: Event.None }
 );
 if (phase === 'next') {
  const until = Date.now() + 10000;
  while (await fs.stat(process.env.OPENIDE_APPIMAGE_PATH + '.update.json').then(() => true, () => false) || await fs.stat(process.env.OPENIDE_APPIMAGE_PATH + '.previous').then(() => true, () => false)) {
   if (Date.now() > until) throw Error('New window did not acknowledge its health');
   await new Promise(resolve => setTimeout(resolve, 50));
  }
  await assert.rejects(fs.stat(process.env.OPENIDE_APPIMAGE_PATH + '.previous'), { code: 'ENOENT' });
  await record('new Electron process opened a window and confirmed version 1.3.0 health');
 } else {
  const available = new Promise((resolve, reject) => {
   const listener = updater.onStateChange(state => {
    if (state.type === StateType.AvailableForDownload) { listener.dispose(); resolve(); }
    else if (state.type === StateType.Idle) { listener.dispose(); reject(Error(state.error || 'No update')); }
   });
  });
  updater.check(); await available;
  await record('signed manifest and artifact metadata accepted');
  await updater.downloadUpdate(true); assert.equal(updater.state.type, StateType.Ready);
  assert.equal(JSON.parse(await fs.readFile(process.env.OPENIDE_APPIMAGE_PATH + '.update.json')).version, '1.3.0');
  await record('VSBuffer download verified and staged with rollback copy');
  await updater.quitAndInstall();
  // AbstractUpdateService schedules doQuitAndInstall after lifecycle quit resolves.
  await new Promise(resolve => setTimeout(resolve, 100));
  await record('restart requested through production updater and Electron app.relaunch');
 }
 clearTimeout(timer); updater.dispose(); window.destroy(); app.exit(0);
} catch (error) { console.error(error); await record('FAILED: ' + error.stack); clearTimeout(timer); updater?.dispose(); app.exit(1); }

}
void main();
