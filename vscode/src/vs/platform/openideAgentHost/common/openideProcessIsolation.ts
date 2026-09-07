/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OpenideProcessIsolationMode = 'off' | 'required';
export interface IOpenideProcessIsolationRequest {
	readonly mode: OpenideProcessIsolationMode;
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly workspaceRoot: string;
	readonly readonly?: boolean;
	readonly network: 'deny' | 'allow';
}
export interface IOpenideProcessIsolationStatus {
	readonly available: boolean;
	readonly backend: 'bubblewrap' | 'none';
	readonly reason?: string;
}
export interface IOpenidePreparedProcess {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly status: { readonly mode: OpenideProcessIsolationMode; readonly state: 'off' | 'confined'; readonly backend: 'bubblewrap' | 'none' };
}
export interface IOpenideSubagentWorktree {
	readonly runId: string;
	readonly path: string;
	readonly baseCommit: string;
}
export interface IOpenideSubagentWorktreeApplyResult {
	readonly changedPaths: readonly string[];
}

/** The outer terminal receives only quoted argv; the agent command stays an inner-shell argument. */
export function openidePreparedProcessCommand(process: IOpenidePreparedProcess): string {
	return [process.executable, ...process.args].map(value => `'${value.replace(/'/g, `'\\''`)}'`).join(' ');
}

export interface IOpenideAgentTerminalRegistration {
	readonly terminalId: number;
	readonly processId: number;
	readonly conversationId: string;
	readonly workspaceRoot: string;
}
