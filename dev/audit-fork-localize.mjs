#!/usr/bin/env node
/**
 * The fork's own screens must read their copy from the bilingual dictionary (`t()`), never from
 * VS Code's `localize()`.
 *
 *   node dev/audit-fork-localize.mjs
 *
 * WHY THIS IS NOT A STYLE RULE
 *
 * `localize(key, default)` resolves `key` against a language PACK. Packs are published for Code
 * OSS's own keys; no pack in the world carries a key that exists only in this fork. So for every
 * one of these calls the DEFAULT is what ships — to every user, in every locale — and the argument
 * that looks like a fallback is really the only string there is.
 *
 * That produced both halves of the same bug on one screen. A user running the IDE in English read
 * "Ejecutando…" on the plan's Build button and "Razonamiento" over the reasoning menu, because
 * those defaults were written in Spanish. A user running it in Spanish read "Thinking" and
 * "Keep File", because those were written in English. Neither could fix it from Settings: the
 * language switch moves `t()` and the packs, and reaches none of this.
 *
 * `t()` reads the same `platform.language` `localize()` resolves against, and every key carries
 * both languages, so one setting moves the whole interface.
 *
 * WHERE `localize()` IS STILL RIGHT
 *
 * Everywhere else in `vscode/src`. Upstream files keep using it — they are Code OSS's strings and
 * the packs do translate them. This audit only covers the directories the fork owns.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SRC = path.join(root, 'vscode/src/vs');

/** The contributions OpenIDE owns outright. Everything under them is fork copy. */
const OWNED = [
	'workbench/contrib/openideAgent',
	'workbench/contrib/openideSettings',
	'workbench/contrib/openideUpdate',
	'workbench/contrib/openideWelcome',
];

/**
 * A comment may legitimately talk ABOUT `localize()` — several of these files explain why they
 * stopped using it, and one of those explanations is directly above the code that replaced it.
 * Only real calls count, so line comments are stripped before matching.
 */
const CALL = /(^|[^A-Za-z0-9_$.])localize2?\s*\(/;

function walk(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
	});
}

const offenders = [];
for (const owned of OWNED) {
	for (const file of walk(path.join(SRC, owned))) {
		const lines = fs.readFileSync(file, 'utf8').split('\n');
		let inBlockComment = false;
		lines.forEach((raw, index) => {
			let line = raw;
			if (inBlockComment) {
				const end = line.indexOf('*/');
				if (end === -1) { return; }
				line = line.slice(end + 2);
				inBlockComment = false;
			}
			const blockStart = line.indexOf('/*');
			if (blockStart !== -1) {
				const end = line.indexOf('*/', blockStart + 2);
				if (end === -1) { inBlockComment = true; line = line.slice(0, blockStart); }
				else { line = line.slice(0, blockStart) + line.slice(end + 2); }
			}
			const lineComment = line.indexOf('//');
			if (lineComment !== -1) { line = line.slice(0, lineComment); }
			if (CALL.test(line)) {
				offenders.push(`${path.relative(root, file)}:${index + 1}: ${raw.trim().slice(0, 110)}`);
			}
		});
	}
}

if (offenders.length) {
	console.error(`${offenders.length} localize() call(s) in fork-owned code.\n`);
	console.error('These strings ship their default to every locale, because no language pack');
	console.error('carries a key this fork invented. Move them to the bilingual dictionary and');
	console.error("read them with t(): see vscode/src/vs/workbench/contrib/openideAgent/common/openideChatSurfaceStrings.ts.\n");
	for (const offender of offenders) {
		console.error(`  ${offender}`);
	}
	process.exit(1);
}

console.log(`Fork localize(): OK (0 calls across ${OWNED.length} owned contributions)`);
