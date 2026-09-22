/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { BrowserAgentSessionModel } from '../../../../platform/browserView/common/browserAgentSessionModel.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IBrowserAgentSessionService = createDecorator<IBrowserAgentSessionService>('browserAgentSessionService');

/** Workbench ownership and tool-call links. Presentation consumes the neutral models only. */
export interface IBrowserAgentSessionService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSession: Event<BrowserAgentSessionModel>;
	sessionForPage(pageId: string): BrowserAgentSessionModel | undefined;
	sessionForToolCall(toolCallId: string): BrowserAgentSessionModel | undefined;
	getSession(sessionId: string): BrowserAgentSessionModel | undefined;
}
