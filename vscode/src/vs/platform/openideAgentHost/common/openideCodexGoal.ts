/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IOpenideCodexGoalPrepare {
	readonly sessionId: string;
	readonly executable: string;
	readonly cwd: string;
	readonly configurationArgs: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly providerSessionId?: string;
}
export interface IOpenideCodexGoalConnection {
	readonly endpoint: string;
	readonly threadId: string;
}
export interface IOpenideCodexGoalResult { readonly report: string; readonly error?: string; readonly stop?: boolean }
export type IOpenideCodexGoalEvent =
	| { readonly sessionId: string; readonly kind: 'activity'; readonly status: 'in-progress' | 'completed' | 'failed' | 'needs-input'; readonly waitingReason?: 'permission' | 'question' }
	| { readonly sessionId: string; readonly kind: 'manualTurn' | 'disconnected' | 'providerGoal'; readonly reason: string }
	| { readonly sessionId: string; readonly kind: 'approval'; readonly approvalId: string; readonly title: string; readonly detail: string };
