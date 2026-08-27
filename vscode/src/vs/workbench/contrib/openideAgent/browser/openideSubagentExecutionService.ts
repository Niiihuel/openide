/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — isolated execution facade. The provider backend is installed from the main
 *  service to reuse protocols/auth without sharing the parent loop's mutable state.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISubagentContextSelection, ISubagentDefinition, ISubagentResult, ISubagentTimelineEvent } from '../common/openideSubagentTypes.js';
import { ISubagentRoutingTarget, SubagentTaskProfile } from '../common/openideSubagentRouting.js';

export interface ISubagentExecutionRequest {
	readonly runId: string;
	readonly definition: ISubagentDefinition;
	readonly task: string;
	readonly model?: string;
	readonly target?: ISubagentRoutingTarget;
	readonly profile: SubagentTaskProfile;
	readonly context?: ISubagentContextSelection;
	readonly token: CancellationToken;
	readonly onExecutionState: (state: { emittedOutput?: boolean; producedSideEffects?: boolean }) => void;
	readonly onEvent: (event: Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'>) => void;
	readonly onUsage: (usage: { inputTokens?: number; outputTokens?: number }) => void;
}

export type SubagentExecutionBackend = (request: ISubagentExecutionRequest) => Promise<ISubagentResult>;

export const ISubagentExecutionService = createDecorator<ISubagentExecutionService>('openideSubagentExecutionService');

export interface ISubagentExecutionService {
	readonly _serviceBrand: undefined;
	setBackend(backend: SubagentExecutionBackend): void;
	execute(request: ISubagentExecutionRequest): Promise<ISubagentResult>;
}

export class SubagentExecutionService implements ISubagentExecutionService {
	declare readonly _serviceBrand: undefined;
	private backend: SubagentExecutionBackend | undefined;
	setBackend(backend: SubagentExecutionBackend): void { this.backend = backend; }
	execute(request: ISubagentExecutionRequest): Promise<ISubagentResult> {
		if (!this.backend) { throw new Error('El runtime de subagentes todavía no está disponible.'); }
		return this.backend(request);
	}
}
