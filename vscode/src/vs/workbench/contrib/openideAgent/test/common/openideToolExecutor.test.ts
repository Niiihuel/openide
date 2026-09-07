/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideExecutableTool, IOpenideToolExecution, OpenideToolExecutor } from '../../common/openideToolExecutor.js';

suite('OpenIDE shared tool executor', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const tool: IOpenideExecutableTool = { def: { name: 'write_file', description: '', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, risk: 'write' };
	const execution: IOpenideToolExecution = { runId: 'test', origin: 'native', authorize: async () => true };

	test('invalid arguments and missing approval never reach the effect', async () => {
		const executor = new OpenideToolExecutor(); let effects = 0;
		for (const args of ['null', '[]', '{', '{}', '{"path":2}']) { assert.match(await executor.execute(tool, args, CancellationToken.None, execution, async () => { effects++; return ''; }), /^Error:/); }
		assert.match(await executor.execute(tool, '{"path":"a"}', CancellationToken.None, undefined, async () => { effects++; return ''; }), /denied/);
		assert.strictEqual(effects, 0);
	});

	test('hardline commands cannot be approved by any entry point', async () => {
		const executor = new OpenideToolExecutor(async () => true); let effects = 0;
		const command: IOpenideExecutableTool = { def: { name: 'run_command', description: '', parameters: { type: 'object' } }, risk: 'exec' };
		for (const origin of ['native', 'subagent', 'external'] as const) {
			assert.match(await executor.execute(command, '{"command":"rm -rf /"}', CancellationToken.None, { ...execution, origin }, async () => { effects++; return ''; }), /blocked/);
		}
		assert.strictEqual(effects, 0);
	});

	test('nested calls retain parent allowlist and cannot widen risk', async () => {
		const executor = new OpenideToolExecutor(async () => true); let effects = 0;
		const context: IOpenideToolExecution = { ...execution, allowedTools: new Set(['wrapper', 'write_file']), allowedRisks: new Set(['safe']) };
		const wrapper: IOpenideExecutableTool = { def: { name: 'wrapper', description: '', parameters: { type: 'object' } }, risk: 'safe' };
		assert.match(await executor.execute(wrapper, '{}', CancellationToken.None, context, () => executor.execute(tool, '{"path":"a"}', CancellationToken.None, context, async () => { effects++; return ''; })), /permissions/);
		assert.strictEqual(effects, 0);
	});

	test('cancellation while approval is open prevents execution', async () => {
		const source = disposables.add(new CancellationTokenSource()); let effects = 0;
		const executor = new OpenideToolExecutor(async () => { source.cancel(); return true; });
		assert.match(await executor.execute(tool, '{"path":"a"}', source.token, undefined, async () => { effects++; return ''; }), /cancelled/);
		assert.strictEqual(effects, 0);
	});

	test('intent durability failure prevents effects even after approval', async () => {
		let effects = 0;
		const context = { ...execution, journal: { runId: 'test', journal: { append: async () => { throw new Error('disk full'); } } } };
		await assert.rejects(new OpenideToolExecutor().execute(tool, '{"path":"a"}', CancellationToken.None, context, async () => { effects++; return ''; }), /disk full/);
		assert.strictEqual(effects, 0);
	});

	test('cancellation during checkpoint records cancellation without dispatching', async () => {
		const source = disposables.add(new CancellationTokenSource()); const events: string[] = [];
		const context = { ...execution, journal: { runId: 'test', journal: { append: async (event: { kind: string }) => { events.push(event.kind); source.cancel(); } } } };
		const result = await new OpenideToolExecutor().execute(tool, '{"path":"a"}', source.token, context, async () => { events.push('effect'); return ''; });
		assert.match(result, /cancelled/);
		assert.deepStrictEqual(events, ['tool/intent', 'tool/result']);
	});

	test('result checkpoint failure propagates after effect instead of allowing continuation', async () => {
		const events: string[] = [];
		const context = { ...execution, journal: { runId: 'test', journal: { append: async (event: { kind: string }) => { events.push(event.kind); if (event.kind === 'tool/result') { throw new Error('fsync failed'); } } } } };
		await assert.rejects(new OpenideToolExecutor().execute(tool, '{"path":"a"}', CancellationToken.None, context, async () => { events.push('effect'); return 'saved'; }), /fsync failed/);
		assert.deepStrictEqual(events, ['tool/intent', 'effect', 'tool/result']);
	});

	test('protected instruction guard applies to nested writable subagents', async () => {
		const context = { ...execution, origin: 'subagent' as const, guard: async () => 'Error: protected Rules' };
		assert.match(await new OpenideToolExecutor().execute(tool, '{"path":"RULES.md"}', CancellationToken.None, context, async () => { throw new Error('must not execute'); }), /protected Rules/);
	});
	test('typed results preserve explicit failures without interpreting ordinary error prose', async () => {
		const executor = new OpenideToolExecutor();
		const denied = await executor.executeResult(tool, '{}', CancellationToken.None, execution, async () => 'unreachable');
		const thrown = await executor.executeResult(tool, '{"path":"a"}', CancellationToken.None, execution, async () => { throw new Error('fixture'); });
		const prose = await executor.executeResult(tool, '{"path":"a"}', CancellationToken.None, execution, async () => 'Error: is a literal string in this source file.');
		assert.deepStrictEqual([denied.isError, thrown.isError, prose.isError], [true, true, false]);
	});

});
