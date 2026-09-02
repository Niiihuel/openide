/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IOpenideProjectMapLearningService } from '../../browser/openideProjectMapLearningService.js';
import { ISubagentOrchestrationService } from '../../browser/openideSubagentOrchestrationService.js';

export interface IOpenideChatControllerHostStubs {
	/** `recordOutcome` calls, in order. */
	readonly learning: { ids: readonly string[]; signal: string }[];
	/** Message ids `hasContext` answers true for. */
	readonly contextIds: Set<string>;
	readonly delivered: string[];
	readonly fireRun: (event: unknown) => void;
}

/**
 * The host services `OpenideChatController` needs beyond the agent service: workspace identity
 * (image folder), the learning signal, and the persistent subagent orchestration. All inert, so a
 * test that does not care about them never sees them.
 */
export function stubOpenideChatControllerHostServices(instantiationService: TestInstantiationService, store: Pick<DisposableStore, 'add'>): IOpenideChatControllerHostStubs {
	const learning: IOpenideChatControllerHostStubs['learning'] = [];
	const contextIds = new Set<string>();
	const delivered: string[] = [];
	const onDidChangeRun = store.add(new Emitter<unknown>());
	instantiationService.stub(IWorkspaceContextService, { getWorkspace: () => ({ id: 'ws' }) } as unknown as IWorkspaceContextService);
	instantiationService.stub(IWorkbenchEnvironmentService, { workspaceStorageHome: URI.file('/tmp/ws-storage') } as unknown as IWorkbenchEnvironmentService);
	instantiationService.stub(IOpenideProjectMapLearningService, {
		hasContext: (id: string) => contextIds.has(id),
		recordOutcome: (ids: readonly string[], signal: string) => { learning.push({ ids, signal }); },
	} as unknown as IOpenideProjectMapLearningService);
	instantiationService.stub(ISubagentOrchestrationService, {
		onDidChangeRun: onDidChangeRun.event,
		markDelivered: (runId: string) => { delivered.push(runId); },
		// The restore asks the store which specialists this conversation delegated. Empty here: a
		// test that wants restored cards seeds them through the transcript, not through the stub.
		getRunsForParent: () => [],
	} as unknown as ISubagentOrchestrationService);
	return { learning, contextIds, delivered, fireRun: event => onDidChangeRun.fire(event) };
}
