/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — which of OpenIDE's own tools an EXTERNAL agent is allowed to call, and under what
 *  name. Pure, so the decision can be argued with in a test instead of in a review.
 *
 *  ── Why an allowlist and not a risk filter ─────────────────────────────────────────────────
 *  A risk filter reads better and is wrong here. `browser_navigate` is `exec` and is the whole
 *  point of the feature; `read_file` is `safe` and is pure waste, because every CLI already has
 *  one and each duplicate spends prompt budget the agent could have used on something only
 *  OpenIDE can do. What decides is not danger, it is: does the CLI already have this?
 *
 *  ── The approval gap, stated plainly ───────────────────────────────────────────────────────
 *  A tool called through this door does NOT pass OpenIDE's approval flow (openideApproval.ts).
 *  The only gate is the CLI's own MCP permission prompt. That is acceptable for the browser
 *  family — it drives a browser against hosts already restricted by
 *  `openide.agent.browserAllowedHosts` — and NOT acceptable for anything that writes files or
 *  runs shell commands, which is why no such family appears below and why adding one has to
 *  wait for the approval bridge rather than for someone to widen the list.
 *--------------------------------------------------------------------------------------------*/

/** Namespace every OpenIDE tool carries on the wire, so ours can never collide with a compat one. */
export const OPENIDE_EXTERNAL_TOOL_PREFIX = 'openide_';

/**
 * Tool-name prefixes offered to external agents.
 *
 * One entry today. It is a list rather than a constant because the next families — the diagram
 * engine, the project map — are already written and only need their approval story settled.
 */
export const OPENIDE_EXTERNAL_TOOL_FAMILIES: readonly string[] = [
	'browser_',
];

/**
 * Individual tools offered on top of the families above.
 *
 * `project_map_query` is capability: OpenIDE keeps the codebase graph incrementally, so "what
 * breaks if I touch this" is milliseconds here and twenty tool calls for a CLI that greps from
 * cold every session.
 *
 * `plan_save` is the opposite — surface, not capability. The model can write a plan perfectly
 * well; what it has nowhere to put it is a plan a human can EDIT and hand back. The call parks
 * until somebody decides (see openideIdePlanReview.ts), which is the only way a signal travels
 * from the IDE to a CLI at all.
 */
export const OPENIDE_EXTERNAL_TOOLS: readonly string[] = [
	'project_map_query',
	'plan_save',
	'memory',
];

/**
 * Two different memories live in OpenIDE, and only one of them is anybody's to write.
 *
 * `.openide/MEMORY.md` is AUTHORED: durable facts about this repo, in the repo, read by every
 * CLI and by the user's own harness. Keeping it current is the whole point of opening it up —
 * a fact written once there is a fact no future session has to rediscover.
 *
 * The codebase graph is DERIVED: it is rebuilt from the index, so anything an agent wrote into
 * it would be silently erased on the next pass. The same goes for the Project Map's learning
 * signal, which its own service keeps out of `.openide/` precisely because it is regenerable.
 * Those two stay read-only through `project_map_query`, and that is not a limitation to lift
 * later — writing to a derived store is just a way to lose the write.
 */
const MEMORY_TOOL = 'memory';

/**
 * Tools that do not answer until a human acts. The transport must hold their JSON-RPC id open
 * and — the part that matters — settle it if the window closes first.
 */
export const OPENIDE_EXTERNAL_BLOCKING_TOOLS: readonly string[] = [
	'plan_save',
];

/**
 * Families that must NEVER cross this door, whatever else changes.
 *
 * Belt and braces against a future family prefix that happens to match one of these: an external
 * agent reaching `write_file` or `run_command` with no approval would be handing it the user's
 * disk, and `mcp_` would proxy somebody else's server through ours for no reason at all.
 */
const NEVER_EXPOSED: readonly string[] = [
	'write_file', 'edit_file', 'delete_file', 'rename_file', 'run_command', 'terminal_send',
	'mcp_', 'ask_user', 'update_todos',
];

/**
 * Context prepended to a tool's description for an EXTERNAL agent.
 *
 * The native descriptions say "la vista previa nativa de OpenIDE", which OpenIDE's own agent
 * understands and Claude does not. Without this, a CLI that can already shell out to Playwright
 * has no reason to pick ours, and will reasonably spawn its own headless browser — which shows
 * it a page the user is not looking at, with none of the state the user just produced by hand.
 * The one thing worth saying is the thing they cannot get elsewhere: it is THE window on screen.
 */
const EXTERNAL_CONTEXT: readonly { readonly match: (name: string) => boolean; readonly text: string }[] = [
	{
		// Before the generic browser entry: `find` takes the first match, and a CLI needs to be
		// TOLD when a recording beats a screenshot — nothing in its own toolbox records anything.
		match: name => name.startsWith('browser_record_'),
		text: 'Records the browser the user has open in OpenIDE, as VIDEO, while you drive it (browser_record_start → your actions → browser_record_stop). A screenshot shows a state; a recording shows the transition, and it is the only way to judge an animation, a hover, a modal sliding in, a list re-sorting, a loading sequence or any flow of two or more steps.\n\nIt does not just record: it MEASURES. The result carries a list of motion findings, each with the exact millisecond to look at — an animation that stalled mid-flight, a single frame that flashed and reverted, motion that never came to rest, a layout that shifted with no click to explain it, an action that changed nothing on screen. It also carries what the page said about itself at the end: clipped text, broken images, contrast below WCAG AA, overlapping or undersized controls. Read those two lists FIRST and use them to aim; they turn "review this video" into "look at 00:04.2". A finding is a place to look, not a verdict — the video says whether it is a bug.\n\nYou get flow.webm (hand the path to a model or CLI that accepts video), sheet.jpg (every step tiled in ONE image, attached as an image: look at it before concluding) and frames/ (one JPEG per step). Every browser_click/type/navigate becomes a step; browser_record_mark names a moment no tool produced. One flow per recording, short.',
	},
	{
		// Also before the generic entry: measuring a page is the one browser capability a CLI has
		// no equivalent for, and the least guessable from a name.
		match: name => name === 'browser_check_visual',
		text: 'Measures the page the user has open for the visual defects a screenshot contains but no reader can reliably judge: text cut by an overflow with no ellipsis, images that loaded no pixels, text below the WCAG AA contrast ratio against the colour actually behind it, controls under 24x24, controls overlapping each other, a document wider than its viewport. Every finding carries a selector, a rectangle and the number that failed. Use it ALONGSIDE browser_screenshot, never instead of it: this answers "is that text clipped, is that contrast 2.9:1", and the picture answers "does this look right".',
	},
	{
		match: name => name.startsWith('browser_'),
		text: 'Drives the browser the user has OPEN inside OpenIDE, with their session, their login and their current state — not a fresh instance and not headless. Prefer it over launching your own browser: it is the only way to see what the user is actually looking at.',
	},
	{
		match: name => name === 'project_map_query',
		text: 'Queries the codebase graph OpenIDE keeps incrementally up to date (modules, dependencies, the blast radius of a change). Answer from this before rebuilding it by hand with searches: it is one call here and many greps otherwise.',
	},
	{
		match: name => name === MEMORY_TOOL,
		text: 'Shared memory for THIS repository (.openide/MEMORY.md), read by every session, by the other CLIs and by the user\'s own harness. Maintain it: when you learn something durable — a convention, an architectural decision, a gotcha that cost you — write it here instead of leaving the next session to rediscover it. Read with openide_memory_read first so you do not duplicate, and consolidate old entries rather than piling on. Do NOT store passing state or single-turn detail.',
	},
	{
		match: name => name === 'plan_save',
		text: 'BLOCKING: saves the plan, opens it in OpenIDE\'s plan editor and does NOT answer until the user has reviewed it. The reply carries the plan as it stands AFTER their edits — run that one, not the one you sent. If they discard it, run nothing.',
	},
];

/** The description an external agent reads for one of our tools. */
export function externalToolDescription(name: string, description: string): string {
	const context = EXTERNAL_CONTEXT.find(entry => entry.match(name));
	return context ? `${context.text}\n\n${description}` : description;
}

/** The name an OpenIDE tool answers to on the external wire. */
export function externalToolName(name: string): string {
	return `${OPENIDE_EXTERNAL_TOOL_PREFIX}${name}`;
}

/** The internal name behind an external one, or undefined when it is not one of ours. */
export function internalToolName(external: string): string | undefined {
	return external.startsWith(OPENIDE_EXTERNAL_TOOL_PREFIX)
		? external.slice(OPENIDE_EXTERNAL_TOOL_PREFIX.length)
		: undefined;
}

/** Whether an OpenIDE tool is offered to external agents. */
export function isExposedToExternalAgents(name: string): boolean {
	if (NEVER_EXPOSED.some(blocked => name === blocked || name.startsWith(blocked))) {
		return false;
	}
	return OPENIDE_EXTERNAL_TOOL_FAMILIES.some(family => name.startsWith(family))
		|| OPENIDE_EXTERNAL_TOOLS.includes(name);
}

/**
 * Arguments an external call is forced to, whatever it asked for.
 *
 * `memory` takes a target, and only the project one is shared knowledge about the repo. The user
 * target is a global file of personal preferences that has nothing to do with this workspace, so
 * an external agent does not get to rewrite it: the blast radius is the user's whole setup and
 * the benefit is zero.
 */
export function constrainExternalToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
	if (name === MEMORY_TOOL) {
		return { ...args, target: 'project' };
	}
	return args;
}

/** Whether the tool parks until a person answers. */
export function isBlockingExternalTool(name: string): boolean {
	return OPENIDE_EXTERNAL_BLOCKING_TOOLS.includes(name);
}
