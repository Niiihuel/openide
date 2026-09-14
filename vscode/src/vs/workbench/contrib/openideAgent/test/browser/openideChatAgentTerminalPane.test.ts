/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IOpenideAgentHostService } from '../../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideCodexGoalConnection } from '../../../../../platform/openideAgentHost/common/openideCodexGoal.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { OpenideChatAgentTerminalPane } from '../../browser/chat/parts/openideChatAgentTerminalPane.js';
import { IChatSessionMeta } from '../../browser/openideChatSessions.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { IOpenideCliChangesService } from '../../browser/openideCliChangesService.js';
import { IOpenideIdeServerService } from '../../browser/openideIdeServerService.js';
import { IOpenideNativeServices } from '../../common/openideNativeServices.js';

suite('OpenIDE Codex terminal startup ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const session: IChatSessionMeta = { id: 'session', title: 'Codex', kind: 'cli', cliId: 'codex', cwd: '/fixture', updatedAt: 1, archived: false, hasError: false, forked: false };
	function fixture(deferred?: DeferredPromise<IOpenideCodexGoalConnection>, terminal?: ITerminalInstance) {
		const closed: string[] = [];
		let prepares = 0, terminals = 0;
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(ITerminalService, { createTerminal: async () => { terminals++; if (terminal) { return terminal; } throw new Error('terminal startup failed'); } });
		const agent = { resolveExecutable: async (_binary: string): Promise<string | undefined> => '/fixture/codex' };
		instantiation.stub(IOpenideAgentService, agent);
		instantiation.stub(IOpenideCliChangesService, { prepareSession: async () => {}, noteExited: () => {} });
		instantiation.stub(IFileService, {});
		instantiation.stub(IPathService, {});
		instantiation.stub(IDialogService, {});
		const host: Partial<IOpenideAgentHostService> = {
			onDidChangeCodexGoal: Event.None,
			codexGoalPrepare: async () => { prepares++; return deferred ? deferred.p : { endpoint: 'unix:///fixture', threadId: 'thread' }; },
			codexGoalDispose: async id => { closed.push(id); },
		};
		instantiation.stub(IOpenideNativeServices, { available: true, host: host as IOpenideAgentHostService });
		instantiation.stub(IOpenideIdeServerService, { onDidChangeIntegration: Event.None, mcpEndpointFor: async () => undefined, launchEnvironment: () => ({}), integrationState: () => 'configured', discoveryStatus: { toolCount: 0 } });
		const pane = store.add(instantiation.createInstance(OpenideChatAgentTerminalPane, mainWindow.document.createElement('div')));
		return { pane, closed, agent, counts: () => ({ prepares, terminals }) };
	}

	test('moving a running terminal reattaches the same PTY and never launches another', async () => {
		const element = mainWindow.document.createElement('div');
		let attached = 0, detached = 0, disposed = 0, focused = 0;
		const terminal = new class extends mock<ITerminalInstance>() {
			override onData = Event.None;
			override onDidInputData = Event.None;
			override onExit = Event.None;
			override attachToElement(host: HTMLElement): void { attached++; host.appendChild(element); }
			override detachFromElement(): void { detached++; element.remove(); }
			override setVisible(): void { }
			override focus(): void { focused++; }
			override layout(): void { }
			override dispose(): void { disposed++; }
		};
		const f = fixture(undefined, terminal);
		await f.pane.open(session);
		const original = f.pane.domNode.parentElement!;
		const companion = mainWindow.document.createElement('div');
		f.pane.moveTo(companion);
		f.pane.moveTo(companion);
		const beforeReturn = focused;
		f.pane.moveTo(original, false);
		assert.strictEqual(focused, beforeReturn, 'closing a companion must not focus the IDE terminal');
		assert.deepStrictEqual({ ...f.counts(), attached, detached, disposed, returned: original.contains(element) }, { prepares: 1, terminals: 1, attached: 3, detached: 2, disposed: 0, returned: true });
	});

	test('closing while Codex prepares revokes the owner and cannot create a terminal later', async () => {
		const ready = new DeferredPromise<IOpenideCodexGoalConnection>();
		const f = fixture(ready);
		const opening = f.pane.open(session);
		await timeout(0);
		f.pane.close(session.id);
		await ready.complete({ endpoint: 'unix:///fixture', threadId: 'thread' });
		await opening;
		assert.ok(f.closed.includes(session.id));
		assert.deepStrictEqual(f.counts(), { prepares: 1, terminals: 0 });
		assert.strictEqual(f.pane.has(session.id), false);
	});

	test('a terminal startup rejection disposes the prepared Codex owner', async () => {
		const f = fixture();
		await assert.rejects(f.pane.open(session), /terminal startup failed/);
		assert.deepStrictEqual(f.closed, [session.id]);
		assert.strictEqual(f.pane.supportsGoal(session.id), false);
	});

	test('concurrent opens share one preparation and one terminal creation', async () => {
		const f = fixture();
		const first = f.pane.open(session);
		const second = f.pane.open(session);
		assert.strictEqual(first, second);
		await assert.rejects(first, /terminal startup failed/);
		assert.deepStrictEqual(f.counts(), { prepares: 1, terminals: 1 });
	});
	test('PATH resolution failure settles the session instead of leaving its spinner running', async () => {
		const f = fixture();
		const statuses: string[] = [];
		store.add(f.pane.onDidChangeStatus(event => statuses.push(event.status)));
		f.agent.resolveExecutable = async () => { throw new Error('login shell unavailable'); };
		await assert.rejects(f.pane.open(session), /login shell unavailable/);
		assert.deepStrictEqual(statuses, ['failed']);
		assert.match(f.pane.domNode.textContent ?? '', /login shell unavailable/);
		assert.strictEqual(f.pane.has(session.id), false);
	});

	test('late missing executable does not replace the visible conversation', async () => {
		const ready = new DeferredPromise<string | undefined>();
		const f = fixture();
		f.agent.resolveExecutable = () => ready.p;
		const opening = f.pane.open(session);
		f.pane.show('other-session');
		f.pane.domNode.textContent = 'Other conversation';
		await ready.complete(undefined);
		await opening;
		assert.strictEqual(f.pane.domNode.textContent, 'Other conversation');
	});

	test('closing before a failing probe settles suppresses stale errors', async () => {
		const ready = new DeferredPromise<string | undefined>();
		const f = fixture();
		const statuses: string[] = [];
		store.add(f.pane.onDidChangeStatus(event => statuses.push(event.status)));
		f.agent.resolveExecutable = () => ready.p;
		const opening = f.pane.open(session);
		f.pane.close(session.id);
		await ready.error(new Error('probe failed after close'));
		await opening;
		assert.deepStrictEqual(statuses, []);
	});

});
