// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run after transpiling the updater. Uses only disposable installations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireOpenideUpdateLock } from '../vscode/out/vs/platform/update/node/openideUpdateLock.js';
import { getOpenideAppImagePaths, stageOpenideAppImage } from '../vscode/out/vs/platform/update/electron-main/openideAppImageUpdater.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openide-recovery-'));
const children = new Set();
function run(command, args, options = {}) {
 const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options }); children.add(child);
 const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { children.delete(child); resolve(code); }); });
 return { child, done };
}
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";
try {
 const paths = getOpenideAppImagePaths(path.join(dir, 'OpenIDE.AppImage'));
 const lockModule = pathToFileURL(path.join(root, 'vscode/out/vs/platform/update/node/openideUpdateLock.js')).href;
 const owner = run(process.execPath, ['--input-type=module', '-e', `import {acquireOpenideUpdateLock} from ${JSON.stringify(lockModule)}; await acquireOpenideUpdateLock(${JSON.stringify(paths.lock)}); console.log('locked');`]);
 await once(owner.child.stdout, 'data');
 await assert.rejects(acquireOpenideUpdateLock(paths.lock));
 owner.child.kill('SIGKILL'); await owner.done;
 const release = await acquireOpenideUpdateLock(paths.lock, 5); await release();
 console.log('PASS: SIGKILL releases lock; a subsequent updater can acquire it');

 const installer = await fs.readFile(path.join(root, 'dev/install-appimage.sh'), 'utf8');
 const template = installer.split('cat > "${BIN_DIR}/openide" <<EOF\n')[1].split('\nEOF')[0];
 const render = run('bash', ['-c', 'cat <<EOF\n' + template + '\nEOF'], { env: { ...process.env, BIN_DIR: dir, FLOCK: process.env.OPENIDE_FLOCK || '/usr/bin/flock', APPIMAGE_RUN: '/usr/bin/env', EXTRA_LIB_PATH: '' } });
 let launcher = ''; render.child.stdout.on('data', chunk => launcher += chunk); assert.equal(await render.done, 0);
 const wrapper = path.join(dir, 'openide'); await fs.writeFile(wrapper, launcher, { mode: 0o755 });
 const download = path.join(dir, 'download');
 const old = '#!/bin/sh\nprintf "healthy-old\\n"\n';
 const failed = '#!/bin/sh\nexit 42\n';
 await fs.writeFile(paths.current, old, { mode: 0o755 }); await fs.writeFile(download, failed);
 await stageOpenideAppImage(download, paths, '1.2.0', Buffer.byteLength(failed), createHash('sha256').update(failed).digest('hex'));
 assert.equal(await run(wrapper, []).done, 42);
 assert.equal(JSON.parse(await fs.readFile(paths.marker)).attempts, 1);
 assert.equal(await run(wrapper, []).done, 0);
 assert.equal(await fs.readFile(paths.current, 'utf8'), old);
 await assert.rejects(fs.stat(paths.marker), { code: 'ENOENT' });
 console.log('PASS: generated launcher rolls back an unsuccessful startup atomically');

 const healthModule = pathToFileURL(path.join(root, 'vscode/out/vs/platform/update/electron-main/openideAppImageUpdater.js')).href;
 const healthScript = path.join(dir, 'health.mjs');
 await fs.writeFile(healthScript, `import {markOpenideAppImageHealthy,getOpenideAppImagePaths} from ${JSON.stringify(healthModule)}; if(!await markOpenideAppImageHealthy(getOpenideAppImagePaths(process.env.OPENIDE_APPIMAGE_PATH),'1.3.0'))process.exit(1);`);
 const healthy = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(healthScript)}\n`;
 await fs.writeFile(download, healthy);
 await stageOpenideAppImage(download, paths, '1.3.0', Buffer.byteLength(healthy), createHash('sha256').update(healthy).digest('hex'));
 assert.equal(await run(wrapper, []).done, 0);
 await assert.rejects(fs.stat(paths.marker), { code: 'ENOENT' });
 await assert.rejects(fs.stat(paths.previous), { code: 'ENOENT' });
 assert.equal(await fs.readFile(paths.current, 'utf8'), healthy);
 console.log('PASS: launched version acknowledges health and removes the rollback journal');

 // Two CLI launches while the first process is alive must not trigger rollback.
 const started = path.join(dir, 'started'), finish = path.join(dir, 'finish');
 const running = `#!/bin/sh\nif [ -f ${shellQuote(started)} ]; then exit 0; fi\ntouch ${shellQuote(started)}\nwhile [ ! -f ${shellQuote(finish)} ]; do sleep 0.05; done\nexit 42\n`;
 await fs.writeFile(download, running);
 await stageOpenideAppImage(download, paths, '1.4.0', Buffer.byteLength(running), createHash('sha256').update(running).digest('hex'));
 const first = run(wrapper, []);
 const until = Date.now() + 5000;
 while (!await fs.stat(started).then(() => true, () => false)) {
  assert.ok(Date.now() < until, 'first launch did not start');
  await new Promise(resolve => setTimeout(resolve, 20));
 }
 assert.equal(await run(wrapper, []).done, 0);
 assert.equal(await fs.readFile(paths.current, 'utf8'), running);
 assert.equal(JSON.parse(await fs.readFile(paths.marker)).attempts, 1);
 await fs.writeFile(finish, ''); assert.equal(await first.done, 42);
 console.log('PASS: concurrent CLI invocation preserves a pending running version');

 // A manual upgrade must supersede a pending rollback without truncating current.
 const manual = '#!/bin/sh\nexit 0\n';
 await fs.writeFile(download, manual);
 const start = installer.indexOf('(\n\texec 9>');
 const end = installer.indexOf('\n)\n', start) + 2;
 assert.ok(start > 0 && end > start);
 const install = run('bash', ['-euc', installer.slice(start, end)], { env: { ...process.env, BIN_DIR: dir, APPIMAGE: download, FLOCK: process.env.OPENIDE_FLOCK || '/usr/bin/flock' } });
 assert.equal(await install.done, 0);
 assert.equal(await fs.readFile(paths.current, 'utf8'), manual);
 await assert.rejects(fs.stat(paths.marker), { code: 'ENOENT' });
 await assert.rejects(fs.stat(paths.previous), { code: 'ENOENT' });
 console.log('PASS: manual replacement is atomic and clears obsolete rollback state');
} finally {
 for (const child of children) child.kill('SIGTERM');
 await fs.rm(dir, { recursive: true, force: true });
}
