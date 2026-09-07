/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { appendOpenideJournal, IOpenideJournalContext } from '../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { IToolApprovalRequest, IToolDefinition, ToolRisk } from './openideAgentTypes.js';
import { isHardlineDeniedCommand } from './openideApprovalPolicy.js';
import { validateToolArguments } from './openideToolGuardrails.js';

export interface IOpenideToolExecution {
	readonly memoryWrite?: boolean;
	readonly runId: string;
	readonly origin: 'native' | 'subagent' | 'external';
	readonly allowedTools?: ReadonlySet<string>;
	readonly allowedRisks?: ReadonlySet<ToolRisk>;
	readonly journal?: IOpenideJournalContext;
	readonly authorize?: (request: IToolApprovalRequest) => Promise<boolean>;
	readonly guard?: (name: string, args: Record<string, unknown>) => Promise<string | undefined>;
}

export interface IOpenideExecutableTool {
	readonly def: IToolDefinition;
	readonly risk: ToolRisk;
	readonly capability?: 'memory';
	approvalInfo?(args: Record<string, unknown>): Omit<IToolApprovalRequest, 'tool' | 'risk'>;
}

export interface IOpenideToolExecutionResult {
	readonly output: string;
	readonly isError: boolean;
}

type Preparation = { args: Record<string, unknown>; error?: undefined } | { error: string; args?: undefined };

/** The dispatch boundary shared by native, nested, subagent and external tool calls. */
export class OpenideToolExecutor {
	constructor(private readonly authorize?: (request: IToolApprovalRequest) => Promise<boolean>) { }

	async prepare(tool: IOpenideExecutableTool, argumentsJson: string, token: CancellationToken, execution?: IOpenideToolExecution): Promise<Preparation> {
		const name = tool.def.name;
		if (token.isCancellationRequested) { return { error: 'Error: tool call cancelled before execution.' }; }
		if (execution?.allowedTools && !execution.allowedTools.has(name)) {
			return { error: `Error: tool outside the execution permissions (${name}).` };
		}
		let parsed: unknown;
		try { parsed = JSON.parse(argumentsJson || '{}'); } catch { return { error: `Error: invalid JSON arguments for ${name}.` }; }
		const errors = validateToolArguments(tool.def.parameters, parsed);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || errors.length) {
			return { error: `Error: invalid arguments for ${name}: ${errors.join('; ') || 'expected an object'}.` };
		}
		const args = parsed as Record<string, unknown>;
		const memoryWrite = execution?.memoryWrite === true && tool.capability === 'memory' && tool.risk === 'write' && args['target'] !== 'user';
		if (execution?.allowedRisks && !execution.allowedRisks.has(tool.risk) && !memoryWrite) { return { error: `Error: tool outside the execution permissions (${name}).` }; }
		const info = tool.approvalInfo?.(args) ?? { title: name };
		// This floor applies even when a caller supplies an approval callback or a nested tool.
		if (isHardlineDeniedCommand(info.command) || tool.risk === 'exec' && isHardlineDeniedCommand(typeof args['command'] === 'string' ? args['command'] : undefined)) {
			return { error: `Error: command blocked by OpenIDE execution policy (${name}).` };
		}
		const blocked = await execution?.guard?.(name, args);
		if (blocked) { return { error: blocked }; }
		if (tool.risk !== 'safe' && !memoryWrite) {
			const authorize = execution?.authorize ?? this.authorize;
			if (!authorize || !await authorize({ ...info, tool: name, risk: tool.risk })) { return { error: `Error: action denied (${name}).` }; }
		}
		if (token.isCancellationRequested) { return { error: 'Error: tool call cancelled before execution.' }; }
		return { args };
	}

	async execute(tool: IOpenideExecutableTool, argumentsJson: string, token: CancellationToken, execution: IOpenideToolExecution | undefined, invoke: (args: Record<string, unknown>) => Promise<string>): Promise<string> {
		return (await this.executeResult(tool, argumentsJson, token, execution, invoke)).output;
	}

	async executeResult(tool: IOpenideExecutableTool, argumentsJson: string, token: CancellationToken, execution: IOpenideToolExecution | undefined, invoke: (args: Record<string, unknown>) => Promise<string>): Promise<IOpenideToolExecutionResult> {
		const prepared = await this.prepare(tool, argumentsJson, token, execution);
		if (prepared.error !== undefined) { return { output: prepared.error, isError: true }; }
		const operationId = generateUuid();
		await appendOpenideJournal(execution?.journal, 'tool/intent', { operationId, name: tool.def.name, arguments: prepared.args, origin: execution?.origin });
		let result: IOpenideToolExecutionResult;
		if (token.isCancellationRequested) { result = { output: 'Error: tool call cancelled before execution.', isError: true }; }
		else {
			try { result = { output: await invoke(prepared.args), isError: false }; }
			catch (error) { result = { output: `Error executing ${tool.def.name}: ${error instanceof Error ? error.message : String(error)}`, isError: true }; }
		}
		// A failed durability barrier propagates; callers must stop rather than attempt another effect.
		await appendOpenideJournal(execution?.journal, 'tool/result', { operationId, name: tool.def.name, result: result.output, isError: result.isError });
		return result;
	}
}
