#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'dev/branding-allowlist.json'), 'utf8'));
const allowed = config.allowed.map(entry => entry.path.replaceAll('\\', '/'));
const inheritedNames = ['VSC' + 'odium', 'Code' + ' - OSS', 'Visual Studio' + ' Code', 'github.com/' + 'VSCodium', 'go.microsoft.com/' + 'fwlink'];
const patterns = inheritedNames.map(value => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
const scanRoots = process.argv.slice(2).length ? process.argv.slice(2) : [
	// what ships
	'vscode/product.json', 'vscode/resources/linux', 'vscode/src/vs/code/browser/workbench/callback.html', 'stores',
	// and what produces it: packaging scripts decide installer names, icons and
	// update feeds, so inherited branding here reaches users just as directly
	'build', 'icons', 'utils.sh', 'dev/build.sh', 'build_cli.sh', 'prepare_assets.sh', 'version.sh'
];
const failures = [];
const binary = /\.(png|ico|icns|bmp|jpg|jpeg|gif|zip|gz|AppImage)$/i;
function walk(relative) {
	const absolute = path.join(root, relative); if (!fs.existsSync(absolute)) { return; }
	const normalized = relative.replaceAll('\\', '/');
	if (allowed.some(entry => normalized === entry || normalized.startsWith(entry + '/'))) { return; }
	const stat = fs.statSync(absolute);
	if (stat.isDirectory()) { for (const name of fs.readdirSync(absolute)) { walk(path.join(relative, name)); } return; }
	if (binary.test(relative) || stat.size > 2_000_000) { return; }
	const text = fs.readFileSync(absolute, 'utf8');
	for (const expression of patterns) { expression.lastIndex = 0; let match; while ((match = expression.exec(text))) { failures.push(`${normalized}:${text.slice(0, match.index).split('\n').length}: ${match[0]}`); } }
}
for (const scanRoot of scanRoots) { walk(scanRoot); }
if (failures.length) { console.error('Inherited branding is not allowed here:\n' + failures.join('\n')); process.exit(1); }
console.log('Branding: OK');
