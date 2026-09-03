/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentMode, IChatCapabilityMention, isSlashVisibleCapability } from '../openideAgentTypes.js';
import { OpenideStringKey, t } from '../openideStrings.js';

/**
 * IDE-specific workflow commands. They resolve before the Markdown commands so the safe flow does
 * not depend on every workspace copying template prompts.
 *
 * Moved out of `openideChatView.ts` so the native composer (the `/` menu) and the native controller
 * (the expansion at send time) read the same table the webview host did.
 */
export interface INativeWorkflowCommand {
	readonly slug: string;
	/** Translation keys, not text: `t()` is read at call time so the menu follows the IDE language.
	 *  Typed keys rather than an interpolated `chat.slash.${slug}` so a typo is a build error. */
	readonly descriptionKey: OpenideStringKey;
	readonly hintKey?: OpenideStringKey;
	readonly mode?: AgentMode;
	/**
	 * The prompt sent to the model. NOT translated: it is written for the model, and its wording is
	 * tuned against the model, not read by anyone in the UI.
	 */
	readonly instruction: string;
}

/**
 * What the `/` menu prints for a builtin command, in the IDE's language.
 *
 * Resolved through a call and never stored on the table: `t()` baked into a module-level const
 * would freeze whatever `openide.language` was at import time. The descriptions and the argument
 * hints used to be hardcoded Spanish whatever the setting said.
 */
export function nativeCommandDescription(command: { descriptionKey: OpenideStringKey }): string {
	return t(command.descriptionKey);
}

export function nativeCommandHint(command: { hintKey?: OpenideStringKey }): string {
	return command.hintKey ? t(command.hintKey) : '';
}

export const NATIVE_WORKFLOW_COMMANDS: readonly INativeWorkflowCommand[] = [
	{ slug: 'agent', descriptionKey: 'chat.slash.agent', hintKey: 'chat.slash.agent.hint', mode: 'agent', instruction: 'Implementá la siguiente tarea con el workflow seguro de OpenIDE:' },
	{ slug: 'plan', descriptionKey: 'chat.slash.plan', hintKey: 'chat.slash.plan.hint', mode: 'plan', instruction: 'Prepará un plan completo para la siguiente tarea:' },
	{ slug: 'ask', descriptionKey: 'chat.slash.ask', hintKey: 'chat.slash.ask.hint', mode: 'ask', instruction: 'Investigá y respondé la siguiente consulta sin editar archivos:' },
	{ slug: 'debug', descriptionKey: 'chat.slash.debug', hintKey: 'chat.slash.debug.hint', mode: 'debug', instruction: 'Reproducí, aislá la causa raíz y corregí el siguiente fallo con una validación de regresión:' },
	{ slug: 'review', descriptionKey: 'chat.slash.review', hintKey: 'chat.slash.review.hint', instruction: 'Ejecutá review_changes sobre los archivos modificados relevantes. Si hay hallazgos bloqueantes, corregilos y repetí la revisión.' },
	{ slug: 'verify', descriptionKey: 'chat.slash.verify', hintKey: 'chat.slash.verify.hint', instruction: 'Verificá los cambios: diagnósticos, pruebas pertinentes y git_preflight. No propongas commit si algo falla.' },
	{ slug: 'status', descriptionKey: 'chat.slash.status', instruction: 'Ejecutá git_status y resumí el siguiente paso seguro del workflow.' },
	{ slug: 'commit', descriptionKey: 'chat.slash.commit', hintKey: 'chat.slash.commit.hint', instruction: 'Prepará un commit atómico: identificá archivos explícitos, ejecutá review_changes, git_preflight y solo entonces proponé git_commit para aprobación. Nunca hagas push.' },
	{ slug: 'workflow', descriptionKey: 'chat.slash.workflow', hintKey: 'chat.slash.workflow.hint', instruction: 'Explicá o configurá el workflow nativo de OpenIDE usando workflow_configure si hay preferencias concretas.' },
];

/** `/compact` is local: it never reaches the model as a turn. */
export const COMPACT_COMMAND = { slug: 'compact', descriptionKey: 'chat.slash.compact' } as const;

/** One row of the composer's `/` menu. Same shape the webview received in `commandSuggest`. */
export interface IOpenideChatSlashSuggestion {
	readonly kind: IChatCapabilityMention['kind'] | 'mcp' | 'tool';
	readonly name: string;
	readonly description: string;
	/** Argument hint shown after the name (`<tarea>`), commands only. */
	readonly hint?: string;
	readonly risk?: 'safe' | 'write' | 'exec';
}

/** One row of the composer's `@` menu. */
export interface IOpenideChatFileSuggestion {
	/** Workspace-relative path. */
	readonly path: string;
	/** File icon theme classes (`getIconClasses`), space-separated. */
	readonly iconClasses: string;
}

/**
 * What the composer asks its host for. The widget implements it over `OpenideAgentCommands` and
 * `IOpenideAgentService`; the composer never touches either for suggestions, so the menus can be
 * unit-tested against a stub.
 */
export interface IOpenideChatSuggestSources {
	queryFiles(query: string): Promise<readonly IOpenideChatFileSuggestion[]>;
	queryCommands(query: string): Promise<readonly IOpenideChatSlashSuggestion[]>;
}

interface IScannedCommand {
	readonly slug: string;
	readonly description: string;
	readonly argumentHint: string;
}

interface ICapabilityLike {
	readonly kind: IOpenideChatSlashSuggestion['kind'];
	readonly name: string;
	readonly description: string;
	readonly risk?: 'safe' | 'write' | 'exec';
}

/**
 * Builds the `/` menu rows: explicit skills first, then the native workflow commands plus
 * `/compact`, then the workspace's Markdown commands. Same order and same filters as the webview
 * host's `commandQuery` (openideChatView.ts): builtin/MCP tools stay out — they are the model's to
 * pick, not the user's.
 */
export function buildOpenideChatSlashSuggestions(
	query: string,
	commands: readonly IScannedCommand[],
	capabilities: readonly ICapabilityLike[],
): IOpenideChatSlashSuggestion[] {
	const q = query.toLowerCase();
	const matches = (name: string, description: string) => !q || name.toLowerCase().startsWith(q) || name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
	const commandItems: IOpenideChatSlashSuggestion[] = commands
		.filter(c => c.slug !== COMPACT_COMMAND.slug)
		.filter(c => !NATIVE_WORKFLOW_COMMANDS.some(native => native.slug === c.slug))
		.filter(c => matches(c.slug, c.description))
		.map(c => ({ kind: 'command', name: c.slug, description: c.description, hint: c.argumentHint }));
	const builtinItems: IOpenideChatSlashSuggestion[] = [
		// The description is resolved BEFORE matching, so typing "plan" in English finds the command
		// by the words actually on screen rather than by a Spanish string nobody can see.
		...NATIVE_WORKFLOW_COMMANDS
			.map(command => ({ command, description: nativeCommandDescription(command) }))
			.filter(({ command, description }) => matches(command.slug, description))
			.map(({ command, description }) => ({ kind: 'command' as const, name: command.slug, description, hint: nativeCommandHint(command) })),
		...(matches(COMPACT_COMMAND.slug, nativeCommandDescription(COMPACT_COMMAND))
			? [{ kind: 'command' as const, name: COMPACT_COMMAND.slug, description: nativeCommandDescription(COMPACT_COMMAND) }]
			: []),
	];
	const capabilityItems: IOpenideChatSlashSuggestion[] = capabilities
		.filter(c => isSlashVisibleCapability(c.kind as IChatCapabilityMention['kind']))
		.filter(c => matches(c.name, c.description))
		.map(c => ({ kind: c.kind, name: c.name, description: c.description, risk: c.risk }));
	return [...capabilityItems, ...builtinItems, ...commandItems];
}
