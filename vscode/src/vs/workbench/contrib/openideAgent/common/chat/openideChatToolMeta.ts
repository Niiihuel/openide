/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Catalog of the built-in tools: codicon, verb, past-tense wording and which argument names the
 * target of the call.
 *
 * Lifted from `TOOL_META` in browser/openideChatHtml.ts:1621-1659. There it lives inside the
 * webview's JavaScript **string**, so no module could import it and no test could reach it. That
 * unreachability is precisely why the native transcript paints a bullet and the word "reasoning"
 * where the user expects an icon and a verb: the icons were never missing, they were unimportable.
 * Everything here is pure data plus string helpers so the reducer, the content parts and the
 * subagent cards all read the same table.
 *
 * It started as a transcription and is now the source of truth: the entries the webview's table
 * never had (`terminal_send`, `delete_file`, `rename_file`, `web_search`, `web_fetch`) are only
 * here. In the webview those calls fall back to their raw tool name as the verb, which is the
 * fallback `getOpenideToolMeta` still applies to MCP and dynamic tools — for a BUILT-IN tool it is
 * just a gap, and the gap is not worth reopening in a file that is being deleted.
 */

export interface IOpenideToolMeta {
	/** Codicon id, without the `codicon-` prefix. */
	readonly icon: string;
	/** Present tense, shown while the call is running. */
	readonly verb: string;
	/** Past tense, shown once the call settles. */
	readonly done: string;
	/** Argument that identifies the target. Empty when the call has nothing worth showing. */
	readonly key: string;
	/**
	 * Declared by the webview table but never read by it. Kept so this file stays a faithful copy
	 * of the source of truth instead of a lossy transcription.
	 */
	readonly base?: boolean;
	/** Folds into the collapsible "Exploring" block instead of getting its own row. */
	readonly explore?: boolean;
	readonly exploreKind?: OpenideChatExploreKind;
	/** True when the RESULT is a span of file lines, so the row may be rewritten with the real
	 *  range. The arguments only carry what was requested, which is often not what came back. */
	readonly lineSpan?: boolean;
	/** Renders its detail as a command (monospace), not as a path. */
	readonly cmd?: boolean;
}

export type OpenideChatExploreKind = 'file' | 'search' | 'other';

export const OPENIDE_TOOL_META: Readonly<Record<string, IOpenideToolMeta>> = {
	read_file: { icon: 'file', verb: 'Read', done: 'Read', key: 'path', base: true, explore: true, exploreKind: 'file', lineSpan: true },
	list_files: { icon: 'folder', verb: 'Listed', done: 'Listed', key: 'path', explore: true, exploreKind: 'search' },
	search_text: { icon: 'search', verb: 'Searched', done: 'Searched', key: 'query', explore: true, exploreKind: 'search' },
	find_files: { icon: 'files', verb: 'Searched files', done: 'Searched files', key: 'pattern', explore: true, exploreKind: 'search' },
	get_diagnostics: { icon: 'warning', verb: 'Checked', done: 'Checked', key: 'path', base: true, explore: true, exploreKind: 'file' },
	codebase_search: { icon: 'symbol-key', verb: 'Searched symbols', done: 'Searched symbols', key: 'query', explore: true, exploreKind: 'search' },
	codebase_explore: { icon: 'references', verb: 'Explored symbol', done: 'Explored symbol', key: 'query', explore: true, exploreKind: 'search' },
	codebase_callers: { icon: 'type-hierarchy', verb: 'Checked callers', done: 'Checked callers', key: 'symbol', explore: true, exploreKind: 'search' },
	write_file: { icon: 'file', verb: 'Writing', done: 'Wrote', key: 'path', base: true },
	edit_file: { icon: 'file', verb: 'Editing', done: 'Edited', key: 'path', base: true },
	delete_file: { icon: 'trash', verb: 'Deleting', done: 'Deleted', key: 'path', base: true },
	// The destination is what the user cares about, and it is the path the row can be clicked to.
	rename_file: { icon: 'file-symlink-file', verb: 'Moving', done: 'Moved', key: 'to', base: true },
	run_command: { icon: 'terminal', verb: 'Running', done: 'Ran', key: 'command', cmd: true },
	// `terminal_send` answers an interactive prompt: the payload can be a password, so it has no
	// key and the row never shows what was typed (same reason its approvalInfo hides it).
	terminal_send: { icon: 'terminal', verb: 'Answering prompt', done: 'Answered prompt', key: '' },
	update_todos: { icon: 'checklist', verb: 'Updating todos', done: 'Updated todos', key: '' },
	ask_user: { icon: 'question', verb: 'Asking', done: 'Asked', key: 'question' },
	memory: { icon: 'database', verb: 'Updating memory', done: 'Updated memory', key: '' },
	skill_view: { icon: 'book', verb: 'Loading skill', done: 'Loaded skill', key: 'name' },
	skill_save: { icon: 'book', verb: 'Saving skill', done: 'Saved skill', key: 'name' },
	plan_save: { icon: 'checklist', verb: 'Saving plan', done: 'Saved plan', key: 'title' },
	git_status: { icon: 'git-commit', verb: 'Checking git', done: 'Checked git', key: '' },
	git_preflight: { icon: 'shield', verb: 'Checking commit', done: 'Commit checked', key: 'message' },
	git_commit: { icon: 'git-commit', verb: 'Committing', done: 'Committed', key: 'message' },
	git_checkpoint: { icon: 'git-commit', verb: 'Committing', done: 'Committed', key: 'message' },
	review_changes: { icon: 'shield', verb: 'Reviewing', done: 'Reviewed', key: '' },
	delegate_task: { icon: 'run-all', verb: 'Delegating', done: 'Delegated', key: '' },
	// Web research is deliberately NOT an explore tool: folding it into the "Exploring" group
	// would hide which sources the answer is citing, which is the one thing worth seeing.
	web_search: { icon: 'search', verb: 'Searching the web', done: 'Searched the web', key: 'query' },
	web_fetch: { icon: 'link', verb: 'Fetching', done: 'Fetched', key: 'url' },
	browser_open: { icon: 'globe', verb: 'Opening preview', done: 'Opened preview', key: 'url' },
	browser_navigate: { icon: 'globe', verb: 'Navigating', done: 'Navigated', key: 'url' },
	browser_snapshot: { icon: 'list-tree', verb: 'Reading snapshot', done: 'Read snapshot', key: '' },
	browser_screenshot: { icon: 'device-camera', verb: 'Capturing', done: 'Captured', key: 'selector' },
	browser_read_dom: { icon: 'code', verb: 'Reading DOM', done: 'Read DOM', key: 'selector' },
	browser_console: { icon: 'terminal', verb: 'Reading console', done: 'Read console', key: '' },
	browser_click: { icon: 'inspect', verb: 'Clicking', done: 'Clicked', key: 'selector' },
	browser_type: { icon: 'edit', verb: 'Typing', done: 'Typed', key: 'selector' },
	browser_evaluate: { icon: 'code', verb: 'Evaluating JS', done: 'Evaluated', key: 'expression' },
	browser_set_style: { icon: 'paintcan', verb: 'Applying styles', done: 'Applied styles', key: 'selector' },
	browser_playwright: { icon: 'run', verb: 'Running Playwright', done: 'Ran Playwright', key: 'code' },
	browser_dialog: { icon: 'comment-discussion', verb: 'Handling dialog', done: 'Handled dialog', key: '' },
};

/**
 * MCP servers and dynamic integrations are open-ended, so the catalog can never be complete. An
 * unknown tool keeps its raw name as the verb: showing `mcp_github_create_issue` is honest, while
 * a generic "Running tool" hides which integration is actually touching the user's machine.
 */
export function getOpenideToolMeta(name: string): IOpenideToolMeta {
	const known = OPENIDE_TOOL_META[name];
	if (known) { return known; }
	return { icon: toolVisualKind(name).icon, verb: name, done: name, key: '' };
}

export interface IOpenideToolVisualKind {
	readonly id: 'mcp' | 'skill' | 'tool';
	readonly label: string;
	readonly icon: string;
}

/** Prefix-based family of a call. Drives the badge and the fallback icon. */
export function toolVisualKind(name: string): IOpenideToolVisualKind {
	const value = String(name ?? '');
	if (value.startsWith('mcp_')) { return { id: 'mcp', label: 'MCP', icon: 'plug' }; }
	if (value.startsWith('skill_')) { return { id: 'skill', label: 'Skill', icon: 'book' }; }
	return { id: 'tool', label: 'Tool', icon: 'tools' };
}

export function isOpenideExploreTool(name: string): boolean {
	return getOpenideToolMeta(name).explore === true;
}

export function openideExploreKind(name: string): OpenideChatExploreKind {
	return getOpenideToolMeta(name).exploreKind ?? 'other';
}

/** Parsed arguments, or `undefined` when the JSON is still half-written (`toolCallDelta`). */
export function tryParseToolArguments(argumentsJson: string | undefined): Record<string, unknown> | undefined {
	if (!argumentsJson) { return undefined; }
	try {
		const parsed: unknown = JSON.parse(argumentsJson);
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

/** Same as `tryParseToolArguments` but total, for callers that only read optional fields. */
export function parseToolArguments(argumentsJson: string | undefined): Record<string, unknown> {
	return tryParseToolArguments(argumentsJson) ?? {};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Human-readable target of a call: the path, query, command… named by `meta.key`.
 *
 * The regex fallback is not defensive programming: `toolCallDelta` streams INCOMPLETE JSON, so
 * `JSON.parse` fails on exactly the frames where showing the target matters most (the model is
 * still typing the path). Without it the row reads "Editing" with no file for several seconds.
 */
export function toolDetailFor(meta: IOpenideToolMeta, argumentsJson: string | undefined): string {
	if (!meta.key || !argumentsJson) { return ''; }
	const parsed = tryParseToolArguments(argumentsJson);
	let value: unknown = parsed?.[meta.key];
	if (!parsed) {
		const match = new RegExp(`"${escapeRegExp(meta.key)}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(argumentsJson);
		value = match ? match[1].replace(/\\"/g, '"') : undefined;
	}
	if (value === undefined || value === null) { return ''; }
	const text = String(value);
	if (meta.key === 'path' && parsed) {
		// The FULL workspace-relative path is returned on purpose: openDiff and resolveUri need it.
		// Only the label shortens it, and doing that here broke docs/DESIGN.md into DESIGN.md.
		const start = parsed['start_line'];
		const end = parsed['end_line'];
		const offset = parsed['offset'];
		if (start !== undefined && start !== null) { return `${text} L${start}${end !== undefined && end !== null ? `-${end}` : ''}`; }
		if (offset !== undefined && offset !== null) { return `${text} L${offset}`; }
	}
	return text;
}

const TRAILING_SEPARATORS = /[\\/]+$/;

/** Last path segment. Kept here so the reducer never needs `vs/base` path helpers in common/. */
export function basenameForChat(path: string): string {
	const value = String(path ?? '').replace(TRAILING_SEPARATORS, '');
	const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
	return index >= 0 ? value.slice(index + 1) : value;
}

const LINE_RANGE_SUFFIX = /\s+L\d+(?:-\d+)?$/;

/**
 * Activity reads as one compact sentence, so a path collapses to its basename while the `Lx-y`
 * range stays attached. Queries and globs are already short and travel unchanged.
 */
export function compactExploreDetail(meta: IOpenideToolMeta, detail: string): string {
	const value = String(detail ?? '');
	if (!value || meta.key !== 'path') { return value; }
	const match = LINE_RANGE_SUFFIX.exec(value);
	const range = match ? match[0] : '';
	const path = range ? value.slice(0, value.length - range.length) : value;
	return basenameForChat(path) + range;
}

function resultLineCount(result: string): number {
	// `…` and not a literal `…`: esbuild rewrites non-ASCII inside STRINGS to escapes, but not
	// inside regex literals, so this one character survived into the minified bundle and the release
	// build refused it — VS Code forbids non-ASCII in minified output because it slows loading. The
	// check only runs in `vscode-min-prepack`, so `npm run compile` never saw it.
	const value = String(result ?? '').replace(/\n?\u2026\(truncado\)$/, '');
	return value ? value.split(/\r?\n/).length : 0;
}

/**
 * Rewrites an explore target with the range the tool ACTUALLY returned.
 *
 * Eligibility comes from `meta.lineSpan`, never from a hardcoded tool name: hardcoding it locked
 * the enrichment to `read_file` no matter what the catalog declared, and let the row drift out of
 * sync with every other tool.
 */
export function lineSpanTarget(meta: IOpenideToolMeta, argumentsJson: string | undefined, resultText: string): string | undefined {
	if (!meta.lineSpan || !meta.key) { return undefined; }
	const args = parseToolArguments(argumentsJson);
	const path = String(args[meta.key] ?? '').replace(LINE_RANGE_SUFFIX, '');
	const count = resultLineCount(resultText);
	if (!path || !count || /^Error:/.test(String(resultText ?? ''))) { return undefined; }
	const requested = Number(args['start_line']);
	const start = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;
	const end = start + count - 1;
	return `${basenameForChat(path)} L${start}${end !== start ? `-${end}` : ''}`;
}

/** `.openide/plans/*.md` on either separator. */
const PLAN_PATH = /(^|[\\/])\.openide[\\/]plans[\\/][^\\/]+\.md$/i;

export function isOpenidePlanPath(path: string): boolean {
	return PLAN_PATH.test(String(path ?? ''));
}

/**
 * Which content kind a tool call becomes.
 *
 * `silent` is not "dropped": those tools already own a richer representation in the transcript
 * (`update_todos` → the todos snapshot, `ask_user` → the stepper, background commands → the
 * terminals tray). Emitting a generic row on top of them is the duplication the webview avoids.
 */
export type OpenideChatToolRoute = 'silent' | 'delegation' | 'terminal' | 'edit' | 'planUpdate' | 'explore' | 'tool';

export function routeToolCall(name: string, argumentsJson: string | undefined): OpenideChatToolRoute {
	if (name === 'update_todos' || name === 'ask_user') { return 'silent'; }
	if (name === 'delegate_task' || name === 'review_changes') { return 'delegation'; }
	if (name === 'run_command') {
		const args = tryParseToolArguments(argumentsJson);
		if (!args || !args['command']) { return 'tool'; }
		// Background commands live in the dock tray, with no inline card and no stdin line.
		return args['background'] || args['background_persistent'] ? 'silent' : 'terminal';
	}
	if (name === 'edit_file' || name === 'write_file') {
		const path = toolDetailFor(getOpenideToolMeta(name), argumentsJson).replace(LINE_RANGE_SUFFIX, '');
		// The agent ticks plan checkboxes with edit_file; rendering that diff floods the chat with
		// raw markdown while the plan editor already shows the same thing, animated and in context.
		return isOpenidePlanPath(path) ? 'planUpdate' : 'edit';
	}
	return isOpenideExploreTool(name) ? 'explore' : 'tool';
}
