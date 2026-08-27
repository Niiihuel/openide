#!/usr/bin/env node
/**
 * Two invariants about how OpenIDE's own surfaces get their colours. Both encode
 * bugs that actually shipped and cost real debugging time.
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
 * Not linted here, but the same family — see docs/theming-surfaces.md:
 *   - a raw <input> inside a styled div produces two focus rings, one per owner;
 *   - `opacity` over an already-themed colour disappears in low-contrast themes;
 *   - an upstream colour id used for a surface the fork paints with its own.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** CSS-in-TS files: a template literal whose contents are a stylesheet. */
const cssInTs = [
	'vscode/src/vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.ts',
];

/** Where the `--oi-*` design tokens are declared, and the selector they need. */
const tokenSource = 'vscode/src/vs/workbench/contrib/openideAgent/browser/openideSurfaceCss.ts';
const REQUIRED_SCOPE = '.monaco-workbench';

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
	const close = lines.findIndex((l, i) => i > open && /^\s*`/.test(l));
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

for (const file of cssInTs) { auditBackticks(file); }
auditTokenScope(tokenSource);

if (problems.length) {
	console.error(`audit-surface-tokens: ${problems.length} problem(s)\n`);
	for (const p of problems) { console.error(`  ${p}`); }
	console.error('\nSee docs/theming-surfaces.md.');
	process.exit(1);
}

console.log('audit-surface-tokens: ok');
