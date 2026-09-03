#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'dev/branding-allowlist.json'), 'utf8'));
const allowed = config.allowed.map(entry => entry.path.replaceAll('\\', '/'));
const inheritedNames = ['VSC' + 'odium', 'Code' + ' - OSS', 'Visual Studio' + ' Code', 'github.com/' + 'VSCodium', 'go.microsoft.com/' + 'fwlink'];
const patterns = inheritedNames.map(value => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
// The theme extensions' display strings. `vscode/extensions` is allowed wholesale -- upstream code
// with its attributions -- but these particular files are not code, they are the NAMES a user reads
// in the theme picker and the extensions list, and they had inherited branding in ten of them
// ("Monokai theme for Visual Studio Code", and an icon theme literally called "Seti (Visual Studio
// Code)"). Naming them here overrides the directory-level allowance below.
const themeStrings = fs.existsSync(path.join(root, 'vscode/extensions'))
	? fs.readdirSync(path.join(root, 'vscode/extensions'))
		.filter(name => name.startsWith('theme-'))
		.map(name => `vscode/extensions/${name}/package.nls.json`)
		.filter(relative => fs.existsSync(path.join(root, relative)))
	: [];

const scanRoots = process.argv.slice(2).length ? process.argv.slice(2) : [
	// what ships
	'vscode/product.json', 'vscode/resources/linux', 'vscode/src/vs/code/browser/workbench/callback.html', 'stores',
	// and what produces it: packaging scripts decide installer names, icons and
	// update feeds, so inherited branding here reaches users just as directly
	'build', 'icons', 'utils.sh', 'dev/build.sh', 'build_cli.sh', 'prepare_assets.sh', 'version.sh',
	...themeStrings
];
/** Explicitly named targets: naming a file beats a directory-level allowance that contains it. */
const explicit = new Set(scanRoots.map(entry => entry.replaceAll('\\', '/')));
const failures = [];
const binary = /\.(png|ico|icns|bmp|jpg|jpeg|gif|zip|gz|AppImage)$/i;
function walk(relative) {
	const absolute = path.join(root, relative); if (!fs.existsSync(absolute)) { return; }
	const normalized = relative.replaceAll('\\', '/');
	if (!explicit.has(normalized) && allowed.some(entry => normalized === entry || normalized.startsWith(entry + '/'))) { return; }
	const stat = fs.statSync(absolute);
	if (stat.isDirectory()) { for (const name of fs.readdirSync(absolute)) { walk(path.join(relative, name)); } return; }
	if (binary.test(relative) || stat.size > 2_000_000) { return; }
	const text = fs.readFileSync(absolute, 'utf8');
	for (const expression of patterns) { expression.lastIndex = 0; let match; while ((match = expression.exec(text))) { failures.push(`${normalized}:${text.slice(0, match.index).split('\n').length}: ${match[0]}`); } }
}
for (const scanRoot of scanRoots) { walk(scanRoot); }
if (failures.length) { console.error('Inherited branding is not allowed here:\n' + failures.join('\n')); process.exit(1); }
console.log('Branding: OK');
