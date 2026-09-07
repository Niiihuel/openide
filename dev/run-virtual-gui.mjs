// Copyright (c) OpenIDE. Licensed under the MIT License.
// Run inside the Electron FHS: node dev/run-virtual-gui.mjs dev/test-memory-runtime.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
const executable = process.env.OPENIDE_XVFB_EXECUTABLE || '/nix/store/qsdmhmzxmhpdmp5a7hn68id3i9q1qwdl-xorg-server-21.1.23/bin/Xvfb';
if (!existsSync(executable)) throw new Error('Set OPENIDE_XVFB_EXECUTABLE to an installed Xvfb binary.');
const scripts = process.argv.slice(2);
if (!scripts.length) throw new Error('Pass one or more GUI test scripts.');
const server = spawn(executable, ['-displayfd', '3', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
let child;
try {
 const display = await new Promise((resolve, reject) => {
  let data = ''; const timer = setTimeout(() => reject(new Error('Xvfb did not become ready')), 10000);
  const fail = error => { clearTimeout(timer); reject(error); };
  server.once('error', fail); server.once('exit', code => fail(new Error(`Xvfb exited (${code})`)));
  server.stdio[3].on('data', chunk => { data += chunk; if (/^\d+\n/.test(data)) { clearTimeout(timer); resolve(`:${data.trim()}`); } });
 });
 const env = { ...process.env, DISPLAY: display, XDG_SESSION_TYPE: 'x11', OPENIDE_TEST_VIRTUAL_DISPLAY: '1' };
 for (const key of ['WAYLAND_DISPLAY', 'HYPRLAND_INSTANCE_SIGNATURE', 'HL_INITIAL_WORKSPACE_TOKEN', 'ELECTRON_RUN_AS_NODE']) delete env[key];
 console.log(`Isolated GUI display ${display}; no desktop windows will be opened.`);
 for (const script of scripts) {
  child = spawn(process.execPath, [script], { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit'); child = undefined;
  if (code !== 0) throw new Error(`${script} failed (${code})`);
 }
} finally {
 if (child) child.kill('SIGTERM');
 server.kill('SIGTERM');
}
