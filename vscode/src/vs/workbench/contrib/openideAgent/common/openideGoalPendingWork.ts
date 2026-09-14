/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IOpenideGoalBackgroundWork {
	readonly conversationId: string;
	readonly command: string;
	readonly running: boolean;
	readonly disposed: boolean;
}

/** Until users can declare auxiliary services, a live owned process cannot certify goal completion. */
export function openideGoalPendingBackgroundReason(sessionId: string, work: readonly IOpenideGoalBackgroundWork[]): string | undefined {
	if (!sessionId) { return undefined; }
	const pending = work.filter(item => item.conversationId === sessionId && item.running && !item.disposed);
	if (!pending.length) { return undefined; }
	const commands = pending.slice(0, 3).map(item => item.command.replace(/\s+/g, ' ').slice(0, 120)).join('; ');
	return `Goal completion is waiting for ${pending.length} background command(s): ${commands}. Stop or finish these processes before resuming the goal. Live development servers also require this review; OpenIDE does not assume they are unrelated to the goal.`;
}
