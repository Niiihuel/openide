// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run via dev/run-virtual-gui.mjs inside the FHS. Uses signed synthetic release fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openide-restart-'));
const executable = path.join(root, 'vscode/.build/electron/openide');
const worker = path.join(root, 'dev/fixtures/updater-restart-electron.mjs');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const current = path.join(dir, 'OpenIDE.AppImage');
const artifact = Buffer.from(`#!/bin/sh\nexport OPENIDE_UPDATE_TEST_PHASE=next\nexec ${quote(executable)} ${quote(worker)} --no-sandbox --ozone-platform=x11\n`);
const keys = generateKeyPairSync('ed25519');
const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, product: 'openide', channel: 'stable', platform: 'linux', architecture: process.arch, target: 'appimage', productVersion: '1.3.0', buildVersion: 'b'.repeat(40), codeOssVersion: '1.136.1', publishedAt: new Date().toISOString(), minimumUpdaterVersion: 1, artifact: { url: 'https://github.com/Niiihuel/openide/releases/download/v1.3.0/OpenIDE-1.3.0-x86_64.AppImage', size: artifact.length, sha256: createHash('sha256').update(artifact).digest('hex') }, releaseNotesUrl: 'https://github.com/Niiihuel/openide/releases/tag/v1.3.0' }));
const signature = Buffer.from(JSON.stringify({ keyId: 'fixture-key', algorithm: 'ed25519', signature: sign(null, manifest, keys.privateKey).toString('base64') }));
const server = createServer((req, res) => { const body = req.url === '/manifest' ? manifest : req.url === '/signature' ? signature : artifact; res.writeHead(200, { 'Content-Length': body.length }); res.end(body); });
let child;
try {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 await fs.writeFile(current, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
 await fs.writeFile(path.join(dir, 'public-key.txt'), keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
 child = spawn(executable, [worker, '--no-sandbox', '--ozone-platform=x11'], { stdio: 'inherit', env: { ...process.env, OPENIDE_UPDATE_TEST_DIR: dir, OPENIDE_UPDATE_TEST_SERVER: `http://127.0.0.1:${server.address().port}`, OPENIDE_APPIMAGE_PATH: current, OPENIDE_APPIMAGE_LAUNCHER: current } });
 assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }), 0);
 const until = Date.now() + 30000;
 let report;
 do {
  await new Promise(resolve => setTimeout(resolve, 100));
  report = JSON.parse(await fs.readFile(path.join(dir, 'result.json'), 'utf8'));
  if (report.steps.some(step => step.startsWith('FAILED'))) throw Error(JSON.stringify(report));
  if (report.steps.at(-1)?.includes('confirmed version')) break;
 } while (Date.now() < until);
 assert.ok(report.steps.at(-1)?.includes('confirmed version'), 'relaunch did not complete');
 console.log('PASS: signed fixture feed → download → staging → Electron relaunch → new window health');
} finally {
 child?.kill('SIGTERM'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true });
}
