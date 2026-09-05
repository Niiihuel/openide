#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const stateFile = git('rev-parse', '--git-path', 'openide-codeoss-sync.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
const metadata = readJson('openide-version.json');

function finish(state) {
	if (git('diff', '--name-only', '--diff-filter=U')) {
		throw new Error('Todavía hay conflictos sin resolver.');
	}
	const pkg = readJson('vscode/package.json');
	if (pkg.version !== state.version) {
		throw new Error(`package.json debe declarar la API ${state.version}; revisá la resolución del conflicto.`);
	}
	metadata.codeOss = { version: state.version, commit: state.commit };
	writeJson('openide-version.json', metadata);
	const lock = readJson('vscode/package-lock.json');
	lock.version = state.version;
	lock.packages[''].version = state.version;
	writeJson('vscode/package-lock.json', lock);
	fs.copyFileSync('vscode/.nvmrc', '.nvmrc');
	git('add', '--', 'vscode', 'openide-version.json', '.nvmrc');
	fs.rmSync(stateFile, { force: true });
	console.log(`Code OSS ${state.version} integrado; OpenIDE conserva su versión ${metadata.version}.`);
	console.log('Instalá las dependencias con la versión de .nvmrc, ejecutá typecheck-client, transpile-client y las pruebas. Si cambió Node, actualizá también los hashes de dev/nodejs.nix.');
}

try {
	if (process.argv[2] === '--continue') {
		finish(readJson(stateFile));
	} else {
		if (fs.existsSync(stateFile)) { throw new Error('Hay una integración pendiente: resolvé sus conflictos y usá --continue.'); }
		if (git('diff', '--name-only', '--', 'vscode', 'openide-version.json', '.nvmrc') || git('diff', '--name-only', '--diff-filter=U')) {
			throw new Error('Prepará los cambios locales en una rama de integración antes de sincronizar.');
		}
		const current = metadata.codeOss.commit;
		let ref = process.argv[2];
		if (!ref) {
			const response = await fetch('https://update.code.visualstudio.com/api/update/linux-x64/stable/0000000000000000000000000000000000000000');
			if (!response.ok) { throw new Error(`No se pudo consultar stable: HTTP ${response.status}`); }
			ref = (await response.json()).version;
		}
		if (typeof ref !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref)) { throw new Error('Referencia upstream inválida.'); }
		if (!git('remote').split('\n').includes('codeoss')) { git('remote', 'add', 'codeoss', 'https://github.com/microsoft/vscode.git'); }
		// FETCH_HEAD selects its first entry: fetch the target separately from the base.
		git('fetch', '--no-tags', 'codeoss', current);
		git('fetch', '--no-tags', 'codeoss', ref);
		const commit = git('rev-parse', 'FETCH_HEAD^{commit}');
		const version = JSON.parse(git('show', `${commit}:package.json`)).version;
		if (commit === current) {
			console.log(`Code OSS ${version} ya está integrado.`);
		} else {
			const preserved = readJson('dev/codeoss-preserved-paths.json');
			const exclusions = new Set(preserved.paths);
			// Preserve deliberate upstream removals in this fork, including renamed old paths.
			for (const file of git('ls-tree', '-r', '--name-only', current).split('\n')) {
				if (!fs.existsSync(path.join('vscode', file))) { exclusions.add(file); }
			}
			const patchFile = git('rev-parse', '--git-path', 'openide-codeoss-sync.patch');
			const fd = fs.openSync(patchFile, 'w');
			try {
				const diff = spawnSync('git', ['diff', '--binary', '--no-renames', current, commit, '--', '.', ...[...exclusions].map(file => `:(exclude,literal)${file}`)], { stdio: ['ignore', fd, 'inherit'] });
				if (diff.status !== 0) { throw new Error('No se pudo generar el delta upstream.'); }
			} finally { fs.closeSync(fd); }
			const result = spawnSync('git', ['apply', '--3way', '--index', '--directory=vscode', patchFile], { stdio: 'inherit' });
			const state = { commit, version, previousCommit: current };
			if (result.status !== 0) {
				if (git('diff', '--name-only', '--diff-filter=U')) {
					writeJson(stateFile, state);
					throw new Error('Resolvé los conflictos, preparalos con git add y ejecutá ./dev/sync-codeoss.sh --continue.');
				}
				throw new Error(`El delta no pudo aplicarse. La versión base sigue intacta; revisá ${patchFile}.`);
			}
			writeJson(stateFile, state);
			finish(state);
		}
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
