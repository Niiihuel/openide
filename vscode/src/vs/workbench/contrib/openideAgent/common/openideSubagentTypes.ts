/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — contratos comunes de subagentes. Las definiciones son snapshots inmutables de
 *  Markdown; runs carry their own identity and never share mutable state with the parent.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ISubagentRoutingAttempt, ISubagentRoutingDecision, SubagentTaskProfile } from './openideSubagentRouting.js';

export type SubagentScope = 'workspace' | 'user' | 'imported';
export type SubagentRunStatus = 'queued' | 'starting' | 'planning' | 'searching' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type SubagentDeliveryState = 'pending' | 'delivered';

export interface ISubagentAttemptLease {
	readonly attemptId: string;
	readonly generation: number;
	readonly workerId: string;
	readonly acquiredAt: number;
	readonly heartbeatAt: number;
	readonly expiresAt: number;
}

export interface ISubagentDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** Legacy model, or an explicit `provider/model` target. */
	readonly model: string;
	readonly profile?: SubagentTaskProfile;
	readonly readonly: boolean;
	readonly isBackground: boolean;
	readonly tools: readonly string[];
	readonly systemPrompt: string;
	readonly resource: URI;
	readonly scope: SubagentScope;
	readonly version: number;
}

export interface ISubagentDefinitionDiagnostic {
	readonly severity: 'error' | 'warning';
	readonly message: string;
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

export interface IParsedSubagentDefinition {
	readonly definition?: ISubagentDefinition;
	readonly diagnostics: readonly ISubagentDefinitionDiagnostic[];
	readonly frontmatterStart: number;
	readonly frontmatterEnd: number;
}

export interface ISubagentContextSelection {
	readonly files?: readonly string[];
	readonly symbols?: readonly string[];
	readonly diagnostics?: boolean;
	readonly selection?: string;
}

export interface ISubagentResult {
	readonly summary: string;
	readonly findings?: readonly unknown[];
	readonly changedFiles?: readonly string[];
	readonly artifacts?: readonly string[];
	readonly warnings?: readonly string[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ISubagentRunMetrics {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly toolCalls: number;
	readonly filesRead: number;
	readonly filesModified: number;
	readonly searches: number;
	readonly errors: number;
	readonly cancellations: number;
	readonly routingAttempts: number;
	readonly fallbacks: number;
	readonly timeToFirstEventMs?: number;
}

export type SubagentTimelineEventType = 'status' | 'progress' | 'toolStart' | 'toolResult' | 'permissionDenied' | 'result' | 'error';

export interface ISubagentTimelineEvent {
	readonly sequence: number;
	readonly timestamp: number;
	readonly type: SubagentTimelineEventType;
	readonly message?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly argumentsJson?: string;
	readonly isError?: boolean;
	readonly path?: string;
}

export interface ISubagentRun {
	readonly runId: string;
	readonly definitionId: string;
	readonly definitionVersion: number;
	readonly definitionName: string;
	readonly parentConversationId: string;
	readonly parentMessageId: string;
	readonly parentRunId?: string;
	readonly depth: number;
	readonly task: string;
	readonly status: SubagentRunStatus;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly completedAt?: number;
	readonly model: string;
	readonly providerId?: string;
	readonly profile?: SubagentTaskProfile;
	readonly routingDecision?: ISubagentRoutingDecision;
	readonly routingAttempts?: readonly ISubagentRoutingAttempt[];
	readonly readonly: boolean;
	readonly background: boolean;
	readonly progress?: string;
	readonly result?: ISubagentResult;
	readonly error?: string;
	readonly metrics: ISubagentRunMetrics;
	readonly timeline: readonly ISubagentTimelineEvent[];
	readonly childRunIds: readonly string[];
	readonly deliveryState: SubagentDeliveryState;
	readonly changeSetId?: string;
	readonly workspaceUri?: string;
	readonly generation: number;
	readonly activeLease?: ISubagentAttemptLease;
	readonly attemptCount: number;
}

export interface ICreateSubagentRunOptions {
	readonly definition: ISubagentDefinition;
	readonly parentConversationId: string;
	readonly parentMessageId: string;
	readonly parentRunId?: string;
	readonly depth?: number;
	readonly ancestorDefinitionIds?: readonly string[];
	readonly task: string;
	readonly context?: ISubagentContextSelection;
	readonly background?: boolean;
	readonly model?: string;
}

export type SubagentRunEvent =
	| { readonly type: 'created'; readonly run: ISubagentRun }
	| { readonly type: 'changed'; readonly run: ISubagentRun }
	| { readonly type: 'timeline'; readonly runId: string; readonly event: ISubagentTimelineEvent }
	| { readonly type: 'completed'; readonly run: ISubagentRun }
	| { readonly type: 'failed'; readonly run: ISubagentRun }
	| { readonly type: 'cancelled'; readonly run: ISubagentRun };

export const EMPTY_SUBAGENT_METRICS: ISubagentRunMetrics = Object.freeze({
	inputTokens: 0,
	outputTokens: 0,
	toolCalls: 0,
	filesRead: 0,
	filesModified: 0,
	searches: 0,
	errors: 0,
	cancellations: 0,
	routingAttempts: 0,
	fallbacks: 0,
});

export function isTerminalSubagentStatus(status: SubagentRunStatus): boolean {
	return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

export function cloneSubagentDefinition(definition: ISubagentDefinition): ISubagentDefinition {
	return Object.freeze({ ...definition, tools: Object.freeze([...definition.tools]) });
}

function deepCloneFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object') { return value; }
	const clone: any = Array.isArray(value) ? value.map(deepCloneFreeze) : Object.fromEntries(Object.entries(value as any).map(([key, item]) => [key, deepCloneFreeze(item)]));
	return Object.freeze(clone) as T;
}

export function cloneSubagentRun(run: ISubagentRun): ISubagentRun {
	return deepCloneFreeze(run);
}
