#!/usr/bin/env node
/**
 * Fails when model-facing text stops being English.
 *
 *   node dev/audit-prompt-language.mjs
 *
 * OpenIDE has two audiences and they read different languages.
 *
 * The USER reads the workbench, and those strings live in the bilingual dictionary
 * (`openideStrings.ts` / `openideSettingsStrings.ts`), where `t()` picks es or en from the IDE
 * locale. Spanish belongs there.
 *
 * The MODEL reads the system prompt, the mode suffixes, every tool `description` in the schema,
 * and every string a tool returns as its result. That surface is English, and not as a style
 * preference: instruction-following and tool selection are measurably better in the language the
 * models were predominantly trained to follow instructions in, and it is what every serious
 * harness does -- deepseek-harness, a Chinese-origin project, ships an English system prompt and
 * localises only its documentation.
 *
 * The prompt keeps working for Spanish-speaking users because it says so explicitly: its LANGUAGE
 * section tells the model to reply in whatever language the user writes in. English instructions,
 * any-language conversation.
 *
 * COVERAGE HAS TWO TIERS, because the surface is bigger than one pass could clear.
 *
 * Tier 1, zero tolerance: the tool schema files and the prompt regions. These are clean and must
 * stay clean.
 *
 * Tier 2, a shrinking budget: the services that implement tools and return their results
 * (`openideGitFlow`, `openideAgentSkills`, `openideWebResearch`, …). Their results are read by the
 * model exactly like a tool description is, and 418 of their strings were still Spanish when this
 * audit was written. Budgets live in `dev/prompt-language-allowlist.json`; a file may never exceed
 * its budget, so the debt can only shrink. Lower a number as you translate, drop the entry at zero.
 * Regenerate with `--update` ONLY to record real progress, never to make a failure go away.
 *
 * This audit is a ratchet on the files below: model-facing text may not read as Spanish. It shares
 * its detector with `audit-comment-language.mjs` (`dev/spanish-text.mjs`), using the stricter
 * string variant -- an accent, an unmistakable word, or three common ones. Checking only for
 * accented characters was not enough: it read "Cancela solo el subagente indicado." as English.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSpanishString } from './spanish-text.mjs';

const root = process.cwd();

/** Files whose strings are read by the model, not by the user. */
const MODEL_FACING = [
	'vscode/src/vs/workbench/contrib/openideAgent/browser/openideTools.ts',
	'vscode/src/vs/workbench/contrib/openideAgent/browser/openideBrowserTools.ts',
];

/** Regions inside mixed files: [file, startMarker, endMarker]. */
const MODEL_FACING_REGIONS = [
	['vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts',
		'const OUTPUT_CONTINUATION_PROMPT', 'const MODE_PROMPTS'],
	['vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts',
		'const MODE_PROMPTS', '\n};'],
	['vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts',
		'const MESSAGE_REFUSALS', '\n};'],
	// Tool schemas declared outside the tool files. Missing these is how the first version of this
	// audit passed while `delegate_to_subagent` and `suggest_mode` still described themselves in
	// Spanish to the model.
	['vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts',
		'const SUBAGENT_TOOL_DEFS', '\n];'],
	['vscode/src/vs/workbench/contrib/openideAgent/browser/openideAgentService.ts',
		'const SUGGEST_MODE_TOOL_DEF', '\n};'],
];

/**
 * Services that implement tools: what they return lands in the model's context as a tool result.
 * Covered on a budget rather than at zero, because they were not translated in one pass.
 */
const RATCHET_FILES = [
	'openideAgentService.ts', 'openideAgentSkills.ts', 'openideGitFlow.ts', 'openideCanvasRuntime.ts',
	'openideMessageChangeSetService.ts', 'openideOAuth.ts', 'openideUsageService.ts',
	'openideAgentHooks.ts', 'openideWebResearch.ts', 'openideAgentMcp.ts', 'openideAgentMemory.ts',
	'openideCanvasService.ts', 'openideAgentRules.ts', 'openideCodebaseMemoryService.ts',
].map(name => `vscode/src/vs/workbench/contrib/openideAgent/browser/${name}`);

const allowlistPath = 'dev/prompt-language-allowlist.json';

/**
 * Lines that look Spanish but must stay that way, identified by a substring.
 *
 * `approvalInfo:` is a user-facing approval card, so it belongs to the dictionary, not to English.
 * `requestsMutation` is not a message at all: it is a regex of verb stems matched against the
 * USER's own prose to detect an edit request, and it carries Spanish and English stems side by
 * side (`modific|edit|actualiz|…|write|update|change`). Translating it would delete half its
 * coverage.
 */
const ALLOWED = new Set(['approvalInfo:', 'const requestsMutation']);

const problems = [];

function scan(label, text, offsetLine, file) {
	text.split('\n').forEach((rawLine, i) => {
		// Comments are governed by audit-comment-language.mjs. Strip them first, or a trailing
		// `// interceptada en openideAgentService` makes an English string look Spanish.
		const line = rawLine.replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, ' ').replace(/\/\/.*$/, '');
		if (!isSpanishString(line)) { return; }
		if ([...ALLOWED].some(a => line.includes(a))) { return; }
		const trimmed = rawLine.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { return; }
		problems.push(`${file}:${offsetLine + i + 1} (${label})\n      ${line.trim().slice(0, 110)}`);
	});
}

for (const file of MODEL_FACING) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs)) { problems.push(`${file}: missing`); continue; }
	scan('tool schema/result', fs.readFileSync(abs, 'utf8'), 0, file);
}

for (const [file, start, end] of MODEL_FACING_REGIONS) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs)) { problems.push(`${file}: missing`); continue; }
	const src = fs.readFileSync(abs, 'utf8');
	const from = src.indexOf(start);
	if (from === -1) { problems.push(`${file}: marker ${JSON.stringify(start)} not found — this audit no longer covers what it claims to`); continue; }
	const to = src.indexOf(end, from + start.length);
	if (to === -1) { problems.push(`${file}: end marker for ${JSON.stringify(start)} not found`); continue; }
	scan(start, src.slice(from, to), src.slice(0, from).split('\n').length - 1, file);
}

// Tier 2: count per file and compare against the recorded budget.
const counts = {};
for (const file of RATCHET_FILES) {
	const abs = path.join(root, file);
	if (!fs.existsSync(abs)) { continue; }
	let n = 0;
	for (const rawLine of fs.readFileSync(abs, 'utf8').split('\n')) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue; }
		const line = rawLine.replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, ' ').replace(/\/\/.*$/, '');
		if ([...ALLOWED].some(a => line.includes(a))) { continue; }
		if (isSpanishString(line)) { n++; }
	}
	if (n) { counts[file] = n; }
}

if (process.argv.includes('--update')) {
	fs.writeFileSync(path.join(root, allowlistPath), JSON.stringify({
		comment: 'Model-facing strings still awaiting translation to English, per file. A ratchet: a file may never exceed its budget. Lower the numbers as you translate, drop the entry at zero. Regenerate with: node dev/audit-prompt-language.mjs --update. NOTE on openideCanvasRuntime.ts: its remaining strings are NOT ordinary debt. That module is serialised with Function.prototype.toString() and injected into the canvas webview (openideCanvasHtml.ts), so it cannot import t() -- a call would throw in the iframe, and openideCanvasRuntime.test.ts pins that it stays self-contained. Localising them needs a strings payload on globalThis.__openideCanvasState, which is a design change, not a translation.',
		totalPending: Object.values(counts).reduce((a, b) => a + b, 0),
		files: counts,
	}, null, '\t') + '\n');
	console.log(`Allowlist rewritten: ${Object.values(counts).reduce((a, b) => a + b, 0)} pending across ${Object.keys(counts).length} files.`);
	process.exit(0);
}

const budgets = JSON.parse(fs.readFileSync(path.join(root, allowlistPath), 'utf8')).files ?? {};
for (const [file, n] of Object.entries(counts)) {
	const budget = budgets[file] ?? 0;
	if (n > budget) {
		problems.push(`${file} — ${n} model-facing Spanish strings, budget ${budget}.\n`
			+ '    This file returns tool results to the model. Translate the new ones, or lower the\n'
			+ '    budget only after actually translating: node dev/audit-prompt-language.mjs --update');
	}
}
const pending = Object.values(counts).reduce((a, b) => a + b, 0);

if (problems.length) {
	console.error(`audit-prompt-language: ${problems.length} problem(s)\n`);
	console.error('  Model-facing text must be English. The user-facing half of the product is not:');
	console.error('  UI strings belong in openideStrings.ts, where t() serves es and en.\n');
	for (const problem of problems) { console.error(`  ${problem}`); }
	process.exit(1);
}
console.log(`Prompt language: OK (${MODEL_FACING.length} files and ${MODEL_FACING_REGIONS.length} regions at zero; ${pending} still pending in ${Object.keys(counts).length} tool services)`);
