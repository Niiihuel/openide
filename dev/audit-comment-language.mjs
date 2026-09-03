#!/usr/bin/env node
/**
 * Fails when OpenIDE-owned source gains Spanish comments.
 *
 * OpenIDE's contributor-facing language is English. This is a ratchet, not a
 * wall: files that still carry untranslated comments are listed in
 * dev/comment-language-allowlist.json with the number of lines pending. A file
 * may never exceed its budget, so the debt can only shrink.
 *
 *   node dev/audit-comment-language.mjs            check (used by CI)
 *   node dev/audit-comment-language.mjs --update   rewrite the allowlist
 *   node dev/audit-comment-language.mjs --list <path>   show pending lines
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSpanish } from './spanish-text.mjs';

const root = process.cwd();
const allowlistPath = 'dev/comment-language-allowlist.json';

/**
 * Everything the product is built from.
 *
 * This used to be a hand-kept list of OpenIDE-owned directories, and files were only read when the
 * BASENAME carried an `openide` prefix. That rule has an obvious hole, and the tree fell into it:
 * a fork's changes mostly land inside upstream-named files -- gettingStarted.contribution.ts,
 * browserInspectorFeature.ts, layout.ts -- and 121 Spanish comment lines across 20 such files sat
 * outside the audit while it reported OK. CONTRIBUTING promises English everywhere; a scope
 * narrower than the promise is a fence with a gap next to it.
 *
 * Scanning upstream's own sources costs nothing: they are already English, and the detector needs
 * three Spanish function words on one line before it says anything. Whole-tree sweeps confirm it --
 * 6511 files under vscode/src, zero flagged.
 */
const scanRoots = [
	'vscode/src',
	'vscode/build',
	'vscode/extensions',
	// The repository's own tooling and pipelines. They are read by anyone who wants to contribute,
	// which makes them the FIRST thing a newcomer meets.
	'dev',
	'.github',
	'vscode/resources',
];
const scanFiles = [];
/** Vendored code and build output: neither is written here, and both are enormous. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'out', 'dist', '.git']);

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/** Shell and YAML comment with `#`. Kept apart from COMMENT_LINE because `#` also starts a
 *  private field in TS (`#count = 0`), and reading that as prose would flag real code. */
const HASH_COMMENT_LINE = /^\s*#/;
const HASH_COMMENT_EXTENSIONS = /\.(sh|yml|yaml)$/;


function walk(relative, out) {
	const absolute = path.join(root, relative);
	if (!fs.existsSync(absolute)) { return; }
	const stat = fs.statSync(absolute);
	if (stat.isDirectory()) {
		if (SKIP_DIRECTORIES.has(path.basename(relative))) { return; }
		for (const name of fs.readdirSync(absolute).sort()) { walk(path.join(relative, name), out); }
		return;
	}
	// Not just `.ts`: the build scripts and the workflows are read by anyone who wants to
	// contribute, which makes them the FIRST thing a newcomer meets.
	if (!/\.(ts|mjs|js|sh|yml|yaml)$/.test(relative)) { return; }
	const normalized = relative.replaceAll('\\', '/');
	const lines = fs.readFileSync(absolute, 'utf8').split('\n');
	const hits = [];
	lines.forEach((line, i) => {
		const isComment = HASH_COMMENT_EXTENSIONS.test(normalized) ? HASH_COMMENT_LINE.test(line) : COMMENT_LINE.test(line);
		if (isComment && isSpanish(line)) { hits.push({ line: i + 1, text: line.trim() }); }
	});
	if (hits.length) { out.set(normalized, hits); }
}

function scan() {
	const found = new Map();
	for (const r of [...scanRoots, ...scanFiles]) { walk(r, found); }
	return found;
}

const found = scan();
const args = process.argv.slice(2);

if (args[0] === '--list') {
	const target = args[1];
	for (const [file, hits] of found) {
		if (target && !file.includes(target)) { continue; }
		for (const h of hits) { console.log(`${file}:${h.line}: ${h.text}`); }
	}
	process.exit(0);
}

if (args[0] === '--update') {
	const pending = [...found].sort((a, b) => b[1].length - a[1].length)
		.map(([file, hits]) => ({ path: file, pending: hits.length }));
	const total = pending.reduce((sum, e) => sum + e.pending, 0);
	fs.writeFileSync(path.join(root, allowlistPath), JSON.stringify({
		comment: 'Files with comments still awaiting translation to English. This is a ratchet: a file may never exceed its budget. Lower the numbers as you translate, and drop the entry when it reaches zero. Regenerate with: node dev/audit-comment-language.mjs --update',
		totalPending: total,
		pending,
	}, null, 2) + '\n', 'utf8');
	console.log(`Allowlist updated: ${total} lines pending across ${pending.length} files.`);
	process.exit(0);
}

const config = JSON.parse(fs.readFileSync(path.join(root, allowlistPath), 'utf8'));
const budget = new Map(config.pending.map(e => [e.path, e.pending]));

const regressions = [];
const shrunk = [];
for (const [file, hits] of found) {
	const allowed = budget.get(file) ?? 0;
	if (hits.length > allowed) {
		regressions.push({ file, allowed, actual: hits.length, samples: hits.slice(0, 3) });
	} else if (hits.length < allowed) {
		shrunk.push({ file, allowed, actual: hits.length });
	}
}
for (const [file, allowed] of budget) {
	if (!found.has(file) && allowed > 0) { shrunk.push({ file, allowed, actual: 0 }); }
}

if (regressions.length) {
	console.error('Spanish comments beyond the allowed budget.\n');
	console.error('OpenIDE source is documented in English. Translate these, or if you are');
	console.error('working through the backlog, run: node dev/audit-comment-language.mjs --update\n');
	for (const r of regressions) {
		console.error(`  ${r.file} — ${r.actual} found, ${r.allowed} allowed`);
		for (const s of r.samples) { console.error(`      L${s.line}: ${s.text.slice(0, 100)}`); }
	}
	process.exit(1);
}

const total = [...found.values()].reduce((sum, hits) => sum + hits.length, 0);
if (shrunk.length) {
	console.log('Debt shrank — tighten the allowlist with: node dev/audit-comment-language.mjs --update\n');
	for (const s of shrunk.slice(0, 10)) { console.log(`  ${s.file}: ${s.allowed} → ${s.actual}`); }
	if (shrunk.length > 10) { console.log(`  …and ${shrunk.length - 10} more`); }
	console.log('');
}
console.log(`Comment language: OK (${total} lines pending translation across ${found.size} files)`);
