/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — deterministic subagent budgets and review proportional to risk.
 *--------------------------------------------------------------------------------------------*/

import { SubagentTaskProfile } from './openideSubagentRouting.js';

export interface ISubagentExecutionBudget {
	readonly maxIterations: number;
	readonly maxToolCalls: number;
	readonly maxOutputTokens: number;
	readonly automaticContextTokens: number;
	readonly automaticContextNodes: number;
	readonly toolResultChars: number;
}

export interface IReviewWorkload {
	readonly changedLines: number;
	readonly risk: 'standard' | 'high';
	readonly reasons: readonly string[];
}

const REVIEW_BUDGET: ISubagentExecutionBudget = Object.freeze({
	maxIterations: 8,
	maxToolCalls: 8,
	maxOutputTokens: 3_000,
	automaticContextTokens: 1_500,
	automaticContextNodes: 12,
	toolResultChars: 12_000,
});

const RESEARCH_BUDGET: ISubagentExecutionBudget = Object.freeze({
	maxIterations: 12,
	maxToolCalls: 12,
	maxOutputTokens: 4_000,
	automaticContextTokens: 3_000,
	automaticContextNodes: 18,
	toolResultChars: 18_000,
});

const DEBUG_BUDGET: ISubagentExecutionBudget = Object.freeze({
	maxIterations: 14,
	maxToolCalls: 16,
	maxOutputTokens: 4_500,
	automaticContextTokens: 3_500,
	automaticContextNodes: 20,
	toolResultChars: 20_000,
});

const IMPLEMENTATION_BUDGET: ISubagentExecutionBudget = Object.freeze({
	maxIterations: 24,
	maxToolCalls: 30,
	maxOutputTokens: 6_000,
	automaticContextTokens: 4_000,
	automaticContextNodes: 20,
	toolResultChars: 24_000,
});

export function resolveSubagentExecutionBudget(profile: SubagentTaskProfile, writable: boolean): ISubagentExecutionBudget {
	if (profile === 'review') { return REVIEW_BUDGET; }
	if (profile === 'debug') { return DEBUG_BUDGET; }
	if (writable || profile === 'implementation' || profile === 'simple-fix') { return IMPLEMENTATION_BUDGET; }
	return RESEARCH_BUDGET;
}

const HIGH_RISK_PATH = /(?:^|\/)(?:auth|security|crypto|payment|billing|permission|migration|schema|database|storage|provider|protocol)(?:\/|\.|$)/i;
const HIGH_RISK_DIFF = /(?:password|credential|secret|token|authorization|permission|encrypt|decrypt|migration|schema|transaction|concurren|race condition)/i;

export function assessReviewWorkload(files: readonly string[], diff: string): IReviewWorkload {
	const changedLines = diff.split('\n').filter(line => (/^[+-]/.test(line) && !/^---|^\+\+\+/.test(line))).length;
	const reasons: string[] = [];
	if (files.length >= 5) { reasons.push(`${files.length} archivos`); }
	if (changedLines >= 300) { reasons.push(`${changedLines} líneas cambiadas`); }
	if (files.some(path => HIGH_RISK_PATH.test(path))) { reasons.push('paths sensibles'); }
	if (HIGH_RISK_DIFF.test(diff)) { reasons.push('contratos sensibles'); }
	return { changedLines, risk: reasons.length ? 'high' : 'standard', reasons };
}

/** Integrated review uses a single independent context; extra reviewers are delegated
 *  explicitly, and only when they bring genuinely different angles. */
export function resolveReviewerCount(_mode: 'agent' | 'debug', _configured: number, _workload: IReviewWorkload): number {
	return 1;
}
