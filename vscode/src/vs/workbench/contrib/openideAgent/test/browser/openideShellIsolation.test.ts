/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IOpenideProcessIsolationRequest } from '../../../../../platform/openideAgentHost/common/openideProcessIsolation.js';
import { ICommandDetectionCapability, ITerminalCommand } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { OpenideToolRegistry } from '../../browser/openideTools.js';

type Dependencies = ConstructorParameters<typeof OpenideToolRegistry>;
suite('OpenIDE integrated shell isolation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(unavailable = false, onRegister?: () => void) {
		const requests: IOpenideProcessIsolationRequest[] = [];
		const terminals: { cwd: URI; sent: string[]; disposed: boolean }[] = [];
		const configuration = new TestConfigurationService({ openide: { agent: { processIsolation: 'required', processIsolationNetwork: 'deny' } } });
		const registry = store.add(new OpenideToolRegistry(
			{} as Dependencies[0], { getWorkspace: () => ({ folders: [{ uri: URI.file('/main') }] }) } as unknown as Dependencies[1],
			{} as Dependencies[2], {} as Dependencies[3],
			{ createTerminal: async (options: { config: { cwd: URI; isTransient: boolean } }) => {
				assert.strictEqual(options.config.isTransient, true);
				const entry = { cwd: options.config.cwd, sent: [] as string[], disposed: false }; terminals.push(entry);
				const finished = store.add(new Emitter<ITerminalCommand>());
				const detection = { onCommandFinished: finished.event, onCommandExecuted: Event.None } as ICommandDetectionCapability;
				return { processReady: Promise.resolve(), persistentProcessId: terminals.length, processId: 100 + terminals.length, get isDisposed() { return entry.disposed; }, dispose: () => { entry.disposed = true; },
					capabilities: { get: () => detection }, onData: Event.None, onExit: Event.None,
					sendText: (command: string) => { entry.sent.push(command); queueMicrotask(() => finished.fire({ getOutput: () => 'captured', exitCode: 0 } as ITerminalCommand)); },
				} as unknown as ITerminalInstance;
			}, showBackgroundTerminal: async () => undefined, setActiveInstance: () => undefined } as unknown as Dependencies[4],
			{} as Dependencies[5], {} as Dependencies[6], {} as Dependencies[7], {} as Dependencies[8],
			{ registerAgentTerminal: async () => { onRegister?.(); }, prepareIsolatedProcess: async (request: IOpenideProcessIsolationRequest) => {
				requests.push(request);
				if (unavailable) { throw new Error('Required process isolation is unavailable'); }
				return { executable: '/bwrap', args: ['--', ...request.args], cwd: request.cwd, status: { mode: 'required', state: 'confined', backend: 'bubblewrap' } };
			} } as unknown as Dependencies[9], configuration,
		));
		return { registry, requests, terminals };
	}

	test('required failure creates no terminal and sends no unconfined payload', async () => {
		const { registry, requests, terminals } = fixture(true);
		await assert.rejects(registry.runShellCaptured('touch outside', CancellationToken.None, 100, 'child', URI.file('/lease')), /unavailable/);
		assert.strictEqual(requests.length, 1);
		assert.strictEqual(terminals.length, 0);
	});

	test('foreground keeps shell capture, quotes argv and replaces a terminal when its lease changes', async () => {
		const { registry, requests, terminals } = fixture();
		const payload = "echo 'quoted'; $(touch outside)";
		assert.deepStrictEqual(await registry.runShellCaptured(payload, CancellationToken.None, 100, 'child', URI.file('/lease-a')), { output: 'captured', exitCode: 0 });
		await registry.runShellCaptured('pwd', CancellationToken.None, 100, 'child', URI.file('/lease-b'));
		assert.deepStrictEqual(requests.map(request => request.cwd), [URI.file('/lease-a').fsPath, URI.file('/lease-b').fsPath]);
		assert.strictEqual(requests[0].args[3], payload);
		assert.ok(terminals[0].sent[0].startsWith("'/bwrap' '--' '--noprofile' '--norc' '-c' '"));
		assert.strictEqual(terminals[0].disposed, true);
		assert.strictEqual(terminals[1].cwd.toString(), URI.file('/lease-b').toString());
		registry.dispose();
		assert.strictEqual(terminals[1].disposed, true);
		await assert.rejects(registry.runShellCaptured('pwd', CancellationToken.None), /disconnected/);
	});

	test('persistent dock commands stay scoped to their conversation and terminate with their owner', async () => {
		const { registry, terminals } = fixture();
		const run = (conversationId: string, root: string) => registry.getTool('run_command')!.invoke({ command: 'npm run dev', background_persistent: true }, CancellationToken.None, { conversationId, workspaceRoot: URI.file(root) });
		await run('a', '/lease-a');
		await run('b', '/lease-b');
		assert.strictEqual(terminals[0].disposed, false);
		await run('a', '/lease-a');
		assert.strictEqual(terminals[0].disposed, true);
		assert.strictEqual(terminals[1].disposed, false);
		assert.strictEqual(terminals[2].disposed, false);
		registry.dispose();
		assert.ok(terminals.every(terminal => terminal.disposed));
	});


	test('cancellation during native registration sends no foreground or background payload', async () => {
		for (const background of [false, true]) {
			const cancellation = store.add(new CancellationTokenSource());
			const { registry, terminals } = fixture(false, () => cancellation.cancel());
			await registry.getTool('run_command')!.invoke({ command: 'npm run dev', background_persistent: background }, cancellation.token, { conversationId: 'child', workspaceRoot: URI.file('/lease') });
			assert.strictEqual(terminals.length, 1);
			assert.deepStrictEqual(terminals[0].sent, []);
			assert.strictEqual(terminals[0].disposed, true);
		}
	});

});
