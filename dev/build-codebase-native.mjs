// Copyright (c) OpenIDE. Licensed under the MIT License.
// Build on each target host before packaging; Cargo.lock pins the independent engine dependencies.
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'vscode/native/codebase');
const target = process.argv.find(arg => arg.startsWith('--target='))?.slice(9);
const destination = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const result = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(crate, 'Cargo.toml'), ...(target ? ['--target', target] : [])], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const name = `openide-codebase${(target ? target.includes('windows') : process.platform === 'win32') ? '.exe' : ''}`;
const output = destination ? resolve(destination) : join(root, 'vscode/native/bin');
mkdirSync(output, { recursive: true });
copyFileSync(join(crate, 'target', target ?? '', 'release', name), join(output, name));
if (process.platform !== 'win32') chmodSync(join(output, name), 0o755);
console.log(`Native indexer ready: ${join(output, name)}`);
