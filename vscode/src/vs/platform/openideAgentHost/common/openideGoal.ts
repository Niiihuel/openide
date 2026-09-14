/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OpenideGoalStatus = 'active' | 'paused' | 'blocked' | 'interrupted' | 'limit_reached' | 'failed' | 'completed' | 'cancelled';

export interface IOpenideGoal {
	readonly id: string;
	readonly sessionId: string;
	readonly objective: string;
	readonly revision: number;
	readonly version: number;
	readonly status: OpenideGoalStatus;
	readonly reason: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly turns: number;
	readonly maxTurns: number;
	readonly criteria: readonly { readonly id: string; readonly text: string; readonly command?: string; readonly verified: boolean; readonly evidenceIds: readonly string[] }[];
	readonly reports: readonly { readonly id: string; readonly time: number; readonly text: string; readonly revision: number; readonly turn: number }[];
	readonly evidence: readonly { readonly id: string; readonly criterionId: string; readonly summary: string; readonly runId: string; readonly source: 'user' | 'verifier'; readonly revision: number; readonly turn: number; readonly workspaceVersion?: number; readonly command?: string }[];
	readonly runIds: readonly string[];
	readonly planPath?: string;
}

export interface IOpenideGoalCreate {
	readonly sessionId: string;
	readonly objective: string;
	readonly criteria: readonly (string | { readonly text: string; readonly command?: string })[];
	readonly maxTurns?: number;
	readonly planPath?: string;
}

interface IOpenideGoalVersion {
	readonly goalId: string;
	readonly expectedVersion: number;
}

export type IOpenideGoalUpdate = IOpenideGoalVersion & (
	| { readonly action: 'pause' | 'cancel' | 'complete' }
	| { readonly action: 'resume'; readonly maxTurns?: number }
	| { readonly action: 'block' | 'fail' | 'invalidate'; readonly reason: string }
	| { readonly action: 'startTurn'; readonly runId: string }
	| { readonly action: 'report'; readonly text: string }
	| { readonly action: 'revise'; readonly objective: string; readonly criteria: readonly (string | { readonly text: string; readonly command?: string })[] }
);

/** Trusted UI/verifier input only. Never expose this operation as a model-controlled tool. */
export interface IOpenideGoalVerification extends IOpenideGoalVersion {
	readonly criterionId: string;
	readonly summary: string;
	readonly runId: string;
	readonly source: 'user' | 'verifier';
	readonly workspaceVersion?: number;
	readonly command?: string;
}
