#!/usr/bin/env node
/**
 * Three invariants about how OpenIDE's own surfaces get their colours and shapes. All
 * encode bugs that actually shipped and cost real debugging time.
 *
 *   node dev/audit-surface-tokens.mjs
 *
 * A. CSS-in-TS carries no backticks inside its comments.
 *
 *    `openideSurfaceCss.ts` is a TypeScript template literal holding CSS. A
 *    backtick anywhere inside it — including inside a /* *\/ comment, where it
 *    reads as harmless quoting — closes the literal. The parser then fails
 *    somewhere else entirely: the two times this happened the reported errors
 *    were four to eight lines away from the damage, once inside an unrelated
 *    scrollbar block. Nothing about the message points at the real cause, which
 *    is why it cost two separate debugging sessions.
 *
 * B. The `--oi-*` tokens are declared where the theme variables live.
 *
 *    The workbench defines `--vscode-*` on `.monaco-workbench`, NOT on `:root`.
 *    Every `--oi-*` token derives from one of them, so declaring the block on
 *    `:root` alone made each token resolve to "invalid at computed-value time"
 *    and compute to nothing on every native surface — the chat dock, Settings,
 *    the plan editor, the Project Map. They had been running on the per-rule
 *    fallbacks instead of on the design system, silently, for months: each rule
 *    still had a plausible fallback, so nothing looked broken enough to report,
 *    it just looked slightly off in themes that happened to disagree with the
 *    fallback. Inside a webview `.monaco-workbench` does not exist and `:root`
 *    is what applies, so the selector has to carry both.
 *
 * C. Radii, neutral hairlines and shadows come from the --oi-* scale.
 *
 *    Before the scale existed the fork carried eight corner radii (3/4/5/6/8/9/10/12px), the
 *    SAME upstream token with two different fallbacks (`--vscode-cornerRadius-medium` was 4px
 *    in two places and 6px in thirteen), 26 distinct alphas of rgba(128, 128, 128, a) and six
 *    shadow recipes. None of it was wrong on its own; together it meant two cards next to each
 *    other never quite matched, and nobody could say which one was right. Every own
 *    stylesheet, plus the two CSS-in-TS literals, must therefore:
 *      (a) write `border-radius` (and `border-*-radius`) with `--oi-radius-*`, never a px
 *          literal above 2px and never `var(--vscode-cornerRadius-*)` directly;
 *      (b) never spell rgba(128, 128, 128, a) — the alphas live in the token block;
 *      (c) never put a literal rgba(0, 0, 0, a) into a `box-shadow` — that is `--oi-shadow*`.
 *    Upstream's own `var(--vscode-shadow-*, …)` / `var(--vscode-*-shadow, …)` fallbacks are
 *    allowed: those are valid theme tokens, not recipes of ours.
 *
 * Not linted here, but the same family — see docs/theming-surfaces.md:
 *   - a raw <input> inside a styled div produces two focus rings, one per owner;
 *   - `opacity` over an already-themed colour disappears in low-contrast themes;
 *   - an upstream colour id used for a surface the fork paints with its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

/** CSS-in-TS files: a template literal whose contents are a stylesheet. */
const cssInTs = [
	'vscode/src/vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.ts',
];

/** Where the `--oi-*` design tokens are declared, and the selector they need. */
const tokenSource = 'vscode/src/vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.ts';
const REQUIRED_SCOPE = '.monaco-workbench';

/** Roots holding the fork's own stylesheets, all of which rule C covers. */
const ownStyleRoots = [
	'vscode/src/vs/workbench/contrib',
	'vscode/src/vs/platform',
];
/** Second CSS-in-TS literal, covered by rule C (not by A: it declares no --oi-* tokens). */
const diagramCssInTs = 'vscode/src/vs/workbench/contrib/openideAgent/browser/openideDiagramCss.ts';

const problems = [];

/** A. No backticks inside the comments of a CSS-in-TS literal. */
function auditBackticks(relative) {
	const absolute = path.join(root, relative);
	if (!fs.existsSync(absolute)) {
		problems.push(`${relative}: missing (moved? update dev/audit-surface-tokens.mjs)`);
		return;
	}
	const lines = fs.readFileSync(absolute, 'utf8').split('\n');
	// Only INSIDE the literal. The file header is ordinary TypeScript comment text
	// and its backticks are fine — flagging those was the audit's own first bug.
	const open = lines.findIndex(l => /=\s*`/.test(l));
	if (open < 0) { return; }
	// The literal closes on a line that is ONLY the backtick and the semicolon. Matching any
	// line that STARTS with a backtick let a comment line such as "   `scrollbar-color: auto`
	// is load-bearing" pass for the close, so the scan stopped right before the very backtick
	// it exists to catch (2026-09-02: the audit said ok and tsc failed four lines later).
	const close = lines.findIndex((l, i) => i > open && /^\s*`;?\s*$/.test(l));
	const end = close < 0 ? lines.length : close;
	let inComment = false;
	for (let i = open + 1; i < end; i++) {
		const line = lines[i];
		const opens = line.includes('/*');
		const closes = line.includes('*/');
		const isComment = inComment || opens || /^\s*(\/\/|\*)/.test(line);
		if (isComment && line.includes('`')) {
			problems.push(`${relative}:${i + 1}: backtick inside a comment in the literal - it closes it\n    ${line.trim()}`);
		}
		if (opens && !closes) { inComment = true; }
		if (closes) { inComment = false; }
	}
}

/** B. The token block is declared under a selector that also carries `--vscode-*`. */
function auditTokenScope(relative) {
	const absolute = path.join(root, relative);
	if (!fs.existsSync(absolute)) {
		problems.push(`${relative}: missing (moved? update dev/audit-surface-tokens.mjs)`);
		return;
	}
	const source = fs.readFileSync(absolute, 'utf8');
	// The declaration block is the first selector that defines an `--oi-*` token.
	const match = source.match(/^([^\n{]*)\{[^}]*--oi-[a-z-]+\s*:/ms);
	if (!match) {
		problems.push(`${relative}: found no block declaring --oi-* tokens`);
		return;
	}
	const selector = match[1].split('\n').filter(l => !l.trim().startsWith('/*') && !l.trim().startsWith('*')).join(' ').trim();
	if (!selector.includes(REQUIRED_SCOPE)) {
		problems.push(
			`${relative}: --oi-* tokens are declared on "${selector}", which does not include ${REQUIRED_SCOPE}.\n` +
			`    The theme's --vscode-* variables do NOT live on :root; without ${REQUIRED_SCOPE} every token\n` +
			`    computes to nothing on native surfaces and the rules run on their fallbacks.`
		);
	}
}

/** Replace comment text with spaces so positions and line numbers survive. */
function blankComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

/** Strip every `var(--vscode-…)` (balanced parentheses) from a value: those are upstream tokens. */
function stripUpstreamVars(value) {
	let out = '';
	let i = 0;
	while (i < value.length) {
		const at = value.indexOf('var(--vscode-', i);
		if (at < 0) { out += value.slice(i); break; }
		out += value.slice(i, at);
		let depth = 0;
		let j = at;
		for (; j < value.length; j++) {
			if (value[j] === '(') { depth++; }
			else if (value[j] === ')' && --depth === 0) { j++; break; }
		}
		i = j;
	}
	return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * C. Radii, hairlines and shadows are written with the --oi-* scale. Pure: takes the source so
 * a test can feed it fixtures. `tokenBlock` marks the file that DECLARES the tokens: there the
 * rgba(128, 128, 128, a) definitions and the shadow recipes are the point, not a violation.
 */
export function auditScaleSource(relative, source, { tokenBlock = false } = {}) {
	const found = [];
	let code = blankComments(source);
	if (tokenBlock) {
		// Only the token block is exempt from (b); the rules below it are ordinary CSS.
		const open = code.indexOf(':root, .monaco-workbench {');
		const close = open < 0 ? -1 : code.indexOf('\n}\n', open);
		if (open >= 0 && close >= 0) {
			code = code.slice(0, open) + code.slice(open, close).replace(/[^\n]/g, ' ') + code.slice(close);
		}
	}
	// (a) border-radius on the scale.
	for (const m of code.matchAll(/border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;}]*)/g)) {
		const value = m[1];
		const line = lineOf(code, m.index);
		if (/var\(--vscode-cornerRadius-(?!xSmall)/.test(value)) {
			found.push(`${relative}:${line}: rule C(a): border-radius reads a --vscode-cornerRadius-* token directly; use --oi-radius-sm/md/lg/circle\n    ${m[0].trim()}`);
			continue;
		}
		const px = [...value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1])).filter(n => n > 2);
		if (px.length) {
			found.push(`${relative}:${line}: rule C(a): border-radius with a px literal (${px.join(', ')}px); use --oi-radius-sm (3-4px), -md (5-6px), -lg (8-12px) or -circle\n    ${m[0].trim()}`);
		}
	}
	// (b) the neutral grey is spelled once, in the token block.
	for (const m of code.matchAll(/rgba\(\s*128\s*,\s*128\s*,\s*128\s*,\s*([\d.]+)\s*\)/g)) {
		found.push(`${relative}:${lineOf(code, m.index)}: rule C(b): rgba(128, 128, 128, ${m[1]}) outside the token block; use --oi-tint-1/2/3, --oi-border-soft, --oi-border or --oi-border-strong`);
	}
	// (c) shadows are the three recipes, not literals. The declaring file is exempt as a whole.
	if (!tokenBlock) {
		for (const m of code.matchAll(/box-shadow\s*:\s*([^;}]*)/g)) {
			if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(stripUpstreamVars(m[1]))) {
				found.push(`${relative}:${lineOf(code, m.index)}: rule C(c): box-shadow with a literal rgba(0, 0, 0, a); use --oi-shadow-sm, --oi-shadow or --oi-shadow-lg\n    ${m[0].trim()}`);
			}
		}
	}
	return found;
}

/** Every .css under an openide* directory of the own roots, plus the two CSS-in-TS literals. */
function ownStylesheets() {
	const out = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); }
			else if (entry.name.endsWith('.css')) { out.push(path.relative(root, full)); }
		}
	};
	for (const base of ownStyleRoots) {
		const absolute = path.join(root, base);
		if (!fs.existsSync(absolute)) { continue; }
		for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name.startsWith('openide')) { walk(path.join(absolute, entry.name)); }
		}
	}
	return out.concat(cssInTs, diagramCssInTs);
}

function auditScale() {
	for (const relative of ownStylesheets()) {
		const absolute = path.join(root, relative);
		if (!fs.existsSync(absolute)) {
			problems.push(`${relative}: missing (moved? update dev/audit-surface-tokens.mjs)`);
			continue;
		}
		problems.push(...auditScaleSource(relative, fs.readFileSync(absolute, 'utf8'), { tokenBlock: relative === tokenSource }));
	}
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	for (const file of cssInTs) { auditBackticks(file); }
	auditTokenScope(tokenSource);
	auditScale();

	if (problems.length) {
		console.error(`audit-surface-tokens: ${problems.length} problem(s)\n`);
		for (const p of problems) { console.error(`  ${p}`); }
		console.error('\nSee docs/theming-surfaces.md.');
		process.exit(1);
	}

	console.log('audit-surface-tokens: ok');
}
