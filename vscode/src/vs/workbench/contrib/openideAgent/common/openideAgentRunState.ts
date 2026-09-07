/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IOpenideAgentRunStateService = createDecorator<IOpenideAgentRunStateService>('openideAgentRunState');

/** Shared workbench run state; restore consumers can inspect it without constructing the harness. */
export interface IOpenideAgentRunStateService {
	readonly _serviceBrand: undefined;
	readonly runsInFlightByProvider: Map<string, number>;
	readonly activeCliSessions: Set<string>;
	hasActiveRuns(): boolean;
}

export class OpenideAgentRunStateService implements IOpenideAgentRunStateService {
	declare readonly _serviceBrand: undefined;
	readonly runsInFlightByProvider = new Map<string, number>();
	readonly activeCliSessions = new Set<string>();
	hasActiveRuns(): boolean {
		return this.activeCliSessions.size > 0 || [...this.runsInFlightByProvider.values()].some(count => count > 0);
	}
}
