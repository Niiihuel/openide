/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Shared orientation for MCP initialization, lifecycle hooks and intent-based help. */
export const OPENIDE_CAPABILITY_CATALOG = [
	{ id: 'browser', prefix: 'openide_browser_', purpose: "Inspect and drive the user's live browser in OpenIDE for UI bugs and visual checks.", guidance: 'Use screenshots for appearance; visual checks measure defects. Record short flows for motion: start, actions, stop; inspect the contact sheet and findings before concluding.', requires: 'An available OpenIDE browser; allowed hosts and client permissions still apply.' },
	{ id: 'map', prefix: 'openide_project_map_', purpose: 'Find architecture, dependencies and change impact in Project Map.', guidance: 'Query the derived graph before broad source searches. Verify stale evidence against source; the graph is not authored memory.', requires: 'A workspace with its code index enabled.' },
	{ id: 'memory', prefix: 'openide_memory', purpose: 'Recall prior decisions and save durable knowledge shared across IDE and CLI sessions.', guidance: 'Search, then get relevant notes. Before updating, get the current revision/hash. Save durable topics as canonical .openide/memory/notes/*.md; use session_summary for handoffs. MEMORY.md is the compatibility overview. Only a successful save receipt proves persistence; external agents own checkpoint timing.', requires: 'A trusted workspace; writing must be enabled. Forget only on an explicit user request.' },
	{ id: 'plans', prefix: 'openide_plan_', purpose: 'Prepare a plan the user can edit and review in OpenIDE.', guidance: 'plan_save blocks for a decision. Execute the returned edited plan only when approved; a discarded plan authorizes no execution.', requires: 'A workspace and a user decision.' },
	{ id: 'editor', prefix: '', purpose: 'Read live editor selection and language diagnostics.', guidance: 'Use getCurrentSelection, getOpenEditors and getDiagnostics for editor context.', requires: 'The corresponding compatibility tool must be listed.' },
] as const;

export const OPENIDE_CAPABILITY_INSTRUCTIONS = 'OpenIDE connects this workspace to its live browser, code graph, shared Markdown memory, editor diagnostics and editable plan review. For UI bugs, inspect the current browser; for architecture or change impact, query Project Map and verify stale evidence against source. For prior decisions, memory_search then memory_get; for durable findings, memory_save after checking revision/hash. Notes in .openide/memory/notes/*.md are canonical; MEMORY.md is the compatibility overview; session_summary is a handoff. External agents own checkpoint timing: only a successful save receipt proves persistence. plan_save waits for the user: execute the returned edited plan only if approved. Use openide_capabilities for family guidance and available tool names. Client prefixes vary: use the names exposed by your client. Workspace scope, host restrictions and tool permissions still apply.';

/** Registration is observable; runtime prerequisites must still be checked by the actual tool. */
export function openideCapabilityHelp(tools: readonly string[], family?: string): object {
	return {
		version: 1,
		families: OPENIDE_CAPABILITY_CATALOG.filter(entry => !family || entry.id === family).map(entry => {
			const names = tools.filter(name => entry.prefix ? name.startsWith(entry.prefix) : ['getCurrentSelection', 'getLatestSelection', 'getOpenEditors', 'getDiagnostics'].includes(name));
			return { ...entry, availability: names.length ? 'registered; runtime prerequisites apply' : 'not registered', tools: names };
		}),
	};
}
