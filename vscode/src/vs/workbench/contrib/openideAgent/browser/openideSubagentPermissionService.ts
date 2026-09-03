/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — hard subagent permissions. This gate runs before approval/invoke.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISubagentDefinition } from '../common/openideSubagentTypes.js';

export const ISubagentPermissionService = createDecorator<ISubagentPermissionService>('openideSubagentPermissionService');

export interface ISubagentPermissionDecision { readonly allowed: boolean; readonly reason?: string }
export interface ISubagentPermissionService {
	readonly _serviceBrand: undefined;
	allowedTools(definition: ISubagentDefinition, availableTools: readonly string[]): readonly string[];
	checkTool(definition: ISubagentDefinition, toolName: string, risk: 'safe' | 'write' | 'exec' | undefined): ISubagentPermissionDecision;
	validateNesting(definitionId: string, depth: number, ancestors: readonly string[], maxDepth: number): ISubagentPermissionDecision;
}

const FORBIDDEN_READONLY = new Set([
	'write_file', 'edit_file', 'delete_file', 'rename_file', 'run_command',
	'git_commit', 'git_checkpoint', 'git_preflight', 'workflow_configure', 'git_configure',
	'plan_save', 'canvas_write', 'memory', 'skill_save', 'rule_manage', 'codebase_save_priority',
	'browser_set_style', 'browser_type', 'browser_click', 'browser_playwright', 'browser_dialog',
]);

export class SubagentPermissionService implements ISubagentPermissionService {
	declare readonly _serviceBrand: undefined;

	allowedTools(definition: ISubagentDefinition, availableTools: readonly string[]): readonly string[] {
		const configured = new Set(definition.tools);
		return Object.freeze(availableTools.filter(name => (!configured.size || configured.has(name)) && (!definition.readonly || !FORBIDDEN_READONLY.has(name))));
	}

	checkTool(definition: ISubagentDefinition, toolName: string, risk: 'safe' | 'write' | 'exec' | undefined): ISubagentPermissionDecision {
		if (definition.tools.length && !definition.tools.includes(toolName)) { return { allowed: false, reason: `La definición no autoriza ${toolName}.` }; }
		if (definition.readonly && (risk !== 'safe' || FORBIDDEN_READONLY.has(toolName))) { return { allowed: false, reason: `El subagente ${definition.name} es de solo lectura.` }; }
		return { allowed: true };
	}

	validateNesting(definitionId: string, depth: number, ancestors: readonly string[], maxDepth: number): ISubagentPermissionDecision {
		if (depth > maxDepth) { return { allowed: false, reason: `Profundidad máxima ${maxDepth} excedida.` }; }
		if (ancestors.includes(definitionId)) { return { allowed: false, reason: 'La delegación formaría un ciclo.' }; }
		return { allowed: true };
	}
}
