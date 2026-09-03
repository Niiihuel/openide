/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentMode, IChatMessage } from './openideAgentTypes.js';

/**
 * Rewinds only the triage response (`suggest_mode`) and leaves the original request as the last
 * message. Reusing a history that ends in tool_result makes some providers wait for another
 * user turn, which breaks the silent transition.
 */
export function rewindForSilentModeTransition(messages: IChatMessage[], mode: AgentMode): IChatMessage | undefined {
	let userIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === 'user') {
			userIndex = index;
			break;
		}
	}
	if (userIndex < 0) {
		return undefined;
	}
	const user = messages[userIndex];
	messages.splice(userIndex + 1);
	user.executionMode = mode;
	return user;
}
