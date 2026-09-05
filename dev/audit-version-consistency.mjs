#!/usr/bin/env node
/**
 * OpenIDE carries two version numbers and one signing key across four files. This checks that the
 * committed tree agrees with itself, so a mismatch shows up while reading the repo instead of
 * forty minutes into a release.
 *
 *   node dev/audit-version-consistency.mjs
 *
 * THE TWO VERSIONS
 *
 * `openide-version.json.version` is the PRODUCT version -- what OpenIDE calls itself. It names the
 * tarballs and the installers, it is what the update feed publishes and compares, and it is what
 * the About dialog shows. It travels into `product.json.openideVersion`.
 *
 * `openide-version.json.codeOss.version` is the API version -- which VS Code extension API this
 * build implements. It travels into `vscode/package.json.version`, because `product.json` has no
 * top-level `version` and so `platform/product/common/product.ts` falls back to
 * `_VSCODE_PACKAGE_JSON.version` for `productService.version`. That value is what
 * `extensionValidator.isEngineValid` checks every extension's `engines.vscode` range against.
 *
 * Putting the product version in `package.json` would make a 1.0.0 editor claim it implements the
 * 1.0.0 extension API, and Open VSX would stop serving it anything built for modern VS Code. The
 * two numbers are deliberately independent; this audit keeps each one pinned to its own source.
 *
 * THE SIGNING KEY
 *
 * `openide-version.json.updater` holds the key the release job signs update manifests with. The
 * client reads `product.json.openideUpdateKeyId` / `openideUpdatePublicKey`. Nothing propagates
 * one to the other, and they silently drifted once: manifests signed with `openide-release-2026-08`
 * against clients trusting `openide-release-2026-01`, i.e. every update rejected as unsigned. The
 * feed had never been published, so nobody saw it. This check is why it cannot happen twice.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const problems = [];

function readJson(relative) {
	const absolute = path.join(root, relative);
	if (!fs.existsSync(absolute)) {
		problems.push(`${relative}: missing`);
		return undefined;
	}
	try {
		return JSON.parse(fs.readFileSync(absolute, 'utf8'));
	} catch (error) {
		problems.push(`${relative}: not valid JSON (${error.message})`);
		return undefined;
	}
}

const openide = readJson('openide-version.json');
const pkg = readJson('vscode/package.json');
const lock = readJson('vscode/package-lock.json');
const products = [
	['product.json', readJson('product.json')],
	['vscode/product.json', readJson('vscode/product.json')],
];

if (openide && openide.schemaVersion !== 3) {
	problems.push(
		`openide-version.json declares schemaVersion ${openide.schemaVersion}, expected 3.\n`
		+ '    Schema 3 is where the product version stopped tracking the Code OSS API line.');
}

const productVersion = openide?.version;
const apiVersion = openide?.codeOss?.version;

// The API version must reach vscode/package.json, or the extension gallery sees the wrong engine.
if (pkg && apiVersion && pkg.version !== apiVersion) {
	problems.push(
		`vscode/package.json declares ${pkg.version}, but the Code OSS API version is ${apiVersion}.\n`
		+ '    That value becomes productService.version, which every extension engines.vscode range\n'
		+ '    is validated against. Getting it wrong costs the extension ecosystem, silently.\n'
		+ `    Fix: set "version": "${apiVersion}" in vscode/package.json.`);
}

// npm rewrites package-lock.json from package.json, so a stale lockfile version quietly comes
// back on the next `npm ci`. It drifted once already: package.json 1.121.2, lockfile 1.121.1.
if (lock && apiVersion) {
	for (const [label, value] of [['version', lock.version], ['packages[""].version', lock.packages?.['']?.version]]) {
		if (value !== apiVersion) {
			problems.push(
				`vscode/package-lock.json ${label} is ${value ?? '(absent)'}, expected ${apiVersion}.\n`
				+ '    It must track vscode/package.json, which carries the Code OSS API version.');
		}
	}
}

// Both entry points must build against the same Node ABI.
const requiredNode = fs.readFileSync(path.join(root, 'vscode/.nvmrc'), 'utf8').trim();
const buildNode = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
if (requiredNode !== buildNode) {
	problems.push(`.nvmrc declares ${buildNode}, but Code OSS requires ${requiredNode}.`);
}

// The product version must reach both product.json files, or About and the installers disagree.
for (const [name, product] of products) {
	if (!product || !productVersion) {
		continue;
	}
	if (product.openideVersion !== productVersion) {
		problems.push(
			`${name} declares openideVersion ${product.openideVersion ?? '(absent)'}, `
			+ `but openide-version.json declares ${productVersion}.\n`
			+ '    The About dialog and the Linux package names read this one.\n'
			+ `    Fix: set "openideVersion": "${productVersion}" in ${name}.`);
	}
}

// The shipped client must trust the key the release job signs with.
for (const [name, product] of products) {
	if (!product || !openide?.updater) {
		continue;
	}
	if (product.openideUpdateKeyId !== openide.updater.keyId) {
		problems.push(
			`${name} trusts key id ${product.openideUpdateKeyId ?? '(absent)'}, `
			+ `but manifests are signed with ${openide.updater.keyId}.\n`
			+ '    Every update would be rejected as unsigned.\n'
			+ `    Fix: set "openideUpdateKeyId": "${openide.updater.keyId}" in ${name}.`);
	}
	if (product.openideUpdatePublicKey !== openide.updater.publicKey) {
		problems.push(
			`${name} carries a public key that is not the one in openide-version.json.\n`
			+ '    Signature verification would fail for every published manifest.\n'
			+ `    Fix: set "openideUpdatePublicKey": "${openide.updater.publicKey}" in ${name}.`);
	}
}

// The two product.json files are merged into one at build time; disagreement there is a landmine.
const [[, rootProduct], [, vscodeProduct]] = products;
if (rootProduct && vscodeProduct) {
	for (const key of ['nameShort', 'nameLong', 'applicationName', 'updateUrl']) {
		if (rootProduct[key] !== vscodeProduct[key]) {
			problems.push(`product.json and vscode/product.json disagree on ${key}: ${rootProduct[key]} vs ${vscodeProduct[key]}`);
		}
	}
}

if (problems.length) {
	console.error(`audit-version-consistency: ${problems.length} problem(s)\n`);
	for (const problem of problems) { console.error(`  ${problem}`); }
	process.exit(1);
}
console.log(`Version consistency: OK (OpenIDE ${productVersion}, VS Code API ${apiVersion}, key ${openide.updater.keyId})`);
