/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentMode, IChatCapabilityMention, isSlashVisibleCapability } from '../openideAgentTypes.js';

/**
 * IDE-specific workflow commands. They resolve before the Markdown commands so the safe flow does
 * not depend on every workspace copying template prompts.
 *
 * Moved out of `openideChatView.ts` so the native composer (the `/` menu) and the native controller
 * (the expansion at send time) read the same table the webview host did.
 */
export interface INativeWorkflowCommand {
	readonly slug: string;
	readonly description: string;
	readonly hint: string;
	readonly mode?: AgentMode;
	readonly instruction: string;
}

export const NATIVE_WORKFLOW_COMMANDS: readonly INativeWorkflowCommand[] = [
	{ slug: 'agent', description: 'Ejecuta la tarea en modo Agent', hint: '[tarea]', mode: 'agent', instruction: 'Implementá la siguiente tarea con el workflow seguro de OpenIDE:' },
	{ slug: 'plan', description: 'Crea un plan de implementación revisable', hint: '<tarea>', mode: 'plan', instruction: 'Prepará un plan completo para la siguiente tarea:' },
	{ slug: 'ask', description: 'Investiga y responde sin editar', hint: '<consulta>', mode: 'ask', instruction: 'Investigá y respondé la siguiente consulta sin editar archivos:' },
	{ slug: 'debug', description: 'Diagnostica y corrige desde evidencia', hint: '<fallo o síntoma>', mode: 'debug', instruction: 'Reproducí, aislá la causa raíz y corregí el siguiente fallo con una validación de regresión:' },
	{ slug: 'review', description: 'Revisa cambios con un subagente independiente', hint: '<archivos o foco>', instruction: 'Ejecutá review_changes sobre los archivos modificados relevantes. Si hay hallazgos bloqueantes, corregilos y repetí la revisión.' },
	{ slug: 'verify', description: 'Valida cambios antes de integrar', hint: '[foco]', instruction: 'Verificá los cambios: diagnósticos, pruebas pertinentes y git_preflight. No propongas commit si algo falla.' },
	{ slug: 'status', description: 'Muestra el estado y siguiente paso del workflow', hint: '', instruction: 'Ejecutá git_status y resumí el siguiente paso seguro del workflow.' },
	{ slug: 'commit', description: 'Prepara un commit atómico y seguro', hint: '<mensaje>', instruction: 'Prepará un commit atómico: identificá archivos explícitos, ejecutá review_changes, git_preflight y solo entonces proponé git_commit para aprobación. Nunca hagas push.' },
	{ slug: 'workflow', description: 'Explica o configura la política de revisión y commits', hint: '[preferencias]', instruction: 'Explicá o configurá el workflow nativo de OpenIDE usando workflow_configure si hay preferencias concretas.' },
];

/** `/compact` is local: it never reaches the model as a turn. */
export const COMPACT_COMMAND = {
	slug: 'compact',
	description: 'Resume la conversación anterior y libera espacio de contexto sin iniciar un turno del modelo.',
} as const;

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
		...NATIVE_WORKFLOW_COMMANDS
			.filter(command => matches(command.slug, command.description))
			.map(command => ({ kind: 'command' as const, name: command.slug, description: command.description, hint: command.hint })),
		...(matches(COMPACT_COMMAND.slug, COMPACT_COMMAND.description)
			? [{ kind: 'command' as const, name: COMPACT_COMMAND.slug, description: COMPACT_COMMAND.description }]
			: []),
	];
	const capabilityItems: IOpenideChatSlashSuggestion[] = capabilities
		.filter(c => isSlashVisibleCapability(c.kind as IChatCapabilityMention['kind']))
		.filter(c => matches(c.name, c.description))
		.map(c => ({ kind: c.kind, name: c.name, description: c.description, risk: c.risk }));
	return [...capabilityItems, ...builtinItems, ...commandItems];
}
