/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';
import { ISubagentRunStorageService } from '../../browser/openideSubagentRunStorageService.js';
import { SubagentRunService } from '../../browser/openideSubagentRunService.js';

class MemoryRunStorage implements ISubagentRunStorageService {
	declare readonly _serviceBrand: undefined;
	private readonly data = new Map<string, ISubagentRun>();
	list(): readonly ISubagentRun[] { return [...this.data.values()]; }
	get(runId: string): ISubagentRun | undefined { return this.data.get(runId); }
	save(run: ISubagentRun): void { this.data.set(run.runId, run); }
	remove(runId: string): void { this.data.delete(runId); }
}

suite('OpenIDE subagent run leases', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	function createService() {
		const service = new SubagentRunService(new MemoryRunStorage(), new TestConfigurationService()); disposables.add(service);
		const controller = service.create({ definition: { id: 'reviewer', name: 'reviewer', description: '', model: 'default', readonly: true, isBackground: false, tools: [], systemPrompt: '', resource: URI.file('/reviewer.md'), scope: 'workspace', version: 1 }, parentConversationId: 'chat', parentMessageId: 'msg', task: 'review' });
		return { service, runId: controller.run.runId };
	}

	test('new attempt invalidates completions and events from the previous lease', () => {
		const { service, runId } = createService();
		const first = service.acquireLease(runId, 'worker-a')!;
		const second = service.acquireLease(runId, 'worker-b')!;
		assert.strictEqual(service.isLeaseCurrent(runId, first), false);
		assert.strictEqual(service.isLeaseCurrent(runId, second), true);
		service.complete(runId, { summary: 'stale' }, first);
		assert.notStrictEqual(service.get(runId)?.status, 'completed');
		service.complete(runId, { summary: 'current' }, second);
		assert.strictEqual(service.get(runId)?.result?.summary, 'current');
	});

	test('heartbeat extends only the current lease', () => {
		const { service, runId } = createService();
		const lease = service.acquireLease(runId, 'worker')!;
		assert.strictEqual(service.renewLease(runId, lease, 120_000), true);
		const renewed = service.get(runId)?.activeLease;
		assert.ok(renewed && renewed.expiresAt >= lease.expiresAt);
		assert.strictEqual(service.renewLease(runId, { ...lease, attemptId: 'stale' }), false);
	});

	test('terminal transitions clear lease authority', () => {
		const { service, runId } = createService();
		const lease = service.acquireLease(runId, 'worker')!;
		service.cancel(runId);
		assert.strictEqual(service.get(runId)?.activeLease, undefined);
		assert.strictEqual(service.isLeaseCurrent(runId, lease), false);
	});
});
