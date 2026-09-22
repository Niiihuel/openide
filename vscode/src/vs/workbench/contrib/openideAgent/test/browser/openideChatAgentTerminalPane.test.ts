/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IOpenideAgentHostService } from '../../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideCodexGoalConnection, IOpenideCodexGoalEvent } from '../../../../../platform/openideAgentHost/common/openideCodexGoal.js';
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
		instantiation.stub(IFileDialogService, { showOpenDialog: async () => undefined });
		const goalEvents = store.add(new Emitter<IOpenideCodexGoalEvent>());
		const host: Partial<IOpenideAgentHostService> = {
			onDidChangeCodexGoal: goalEvents.event,
			codexGoalPrepare: async () => { prepares++; return deferred ? deferred.p : { endpoint: 'unix:///fixture', threadId: 'thread' }; },
			codexGoalDispose: async id => { closed.push(id); },
		};
		instantiation.stub(IOpenideNativeServices, { available: true, host: host as IOpenideAgentHostService });
		instantiation.stub(IOpenideIdeServerService, { onDidChangeIntegration: Event.None, mcpEndpointFor: async () => undefined, launchEnvironment: () => ({}), integrationState: () => 'configured', discoveryStatus: { toolCount: 0 } });
		const pane = store.add(instantiation.createInstance(OpenideChatAgentTerminalPane, mainWindow.document.createElement('div')));
		return { pane, closed, agent, goalEvents, counts: () => ({ prepares, terminals }) };
	}

	function pasteTerminal(send: (text: string, execute: boolean, bracketed?: boolean) => Promise<void>, bracketedPaste = true, onExit: ITerminalInstance['onExit'] = Event.None): ITerminalInstance {
		return new class extends mock<ITerminalInstance>() {
			override xterm = { raw: { modes: { bracketedPasteMode: bracketedPaste } } } as ITerminalInstance['xterm'];
			override onData = Event.None;
			override onDidInputData = Event.None;
			override onExit = onExit;
			override attachToElement(): void { }
			override detachFromElement(): void { }
			override setVisible(): void { }
			override focus(): void { }
			override layout(): void { }
			override dispose(): void { }
			override sendText(text: string, execute: boolean, bracketed?: boolean): Promise<void> { return send(text, execute, bracketed); }
		};
	}

	test('an early failed resume preserves the conversation instead of launching a fresh provider session', async () => {
		const exits = store.add(new Emitter<number>());
		const f = fixture(undefined, pasteTerminal(async () => {}, true, exits.event));
		await f.pane.open({ ...session, providerSessionId: 'existing-provider-session' });
		exits.fire(1);
		await timeout(0);
		assert.deepStrictEqual({ terminals: f.counts().terminals, status: f.pane.statusOf(session.id), draftAccepted: f.pane.stagePrompt(session.id, 'message') }, { terminals: 1, status: 'failed', draftAccepted: false });
		assert.ok(f.pane.domNode.querySelector('.openide-chat-agent-terminal-relaunch'));
	});

	test('a CLI without bracketed paste cannot receive multiline Enter presses', async () => {
		let sends = 0;
		const f = fixture(undefined, pasteTerminal(async () => { sends++; }, false));
		await f.pane.open(session);
		f.pane.stagePrompt(session.id, 'Line one\nline two');
		f.pane.domNode.querySelector<HTMLButtonElement>('.openide-cli-composer-actions .primary')!.click();
		await timeout(0);
		assert.deepStrictEqual({ sends, draft: f.pane.domNode.querySelector('textarea')!.value, explained: !!f.pane.domNode.querySelector('.openide-cli-composer-error')!.textContent }, { sends: 0, draft: 'Line one\nline two', explained: true });
	});

	test('CLI drafts are isolated by conversation and explicit paste never submits', async () => {
		const sent: { text: string; execute: boolean; bracketed?: boolean }[] = [];
		const f = fixture(undefined, pasteTerminal(async (text, execute, bracketed) => { sent.push({ text, execute, bracketed }); }));
		await f.pane.open(session);
		f.pane.stagePrompt(session.id, 'First draft');
		f.pane.stagePrompt(session.id, 'Review comment');
		await f.pane.open({ ...session, id: 'second' });
		f.pane.stagePrompt('second', 'Second draft');
		f.pane.show(session.id);
		const input = f.pane.domNode.querySelector('textarea')!;
		assert.strictEqual(input.value, 'First draft\n\nReview comment');
		assert.strictEqual(sent.length, 0);
		f.pane.domNode.querySelector<HTMLButtonElement>('.openide-cli-composer-actions .primary')!.click();
		await timeout(0);
		assert.deepStrictEqual(sent, [{ text: 'First draft\n\nReview comment', execute: false, bracketed: true }]);
		assert.strictEqual(input.value, '');
		f.pane.show('second');
		assert.strictEqual(f.pane.domNode.querySelector('textarea')!.value, 'Second draft');
	});

	test('review context staged while a provider connects survives into its composer', async () => {
		const ready = new DeferredPromise<IOpenideCodexGoalConnection>();
		const f = fixture(ready, pasteTerminal(async () => {}));
		const opening = f.pane.open(session);
		assert.strictEqual(f.pane.stagePrompt(session.id, 'Review the selected changes'), true);
		await ready.complete({ endpoint: 'unix:///fixture', threadId: 'thread' });
		await opening;
		assert.strictEqual(f.pane.domNode.querySelector('textarea')!.value, 'Review the selected changes');
	});

	test('a rejected paste preserves the draft and later context appended during a paste is retained', async () => {
		let reject = true;
		const ready = new DeferredPromise<void>();
		const f = fixture(undefined, pasteTerminal(async () => { if (reject) { throw new Error('PTY not ready'); } await ready.p; }));
		await f.pane.open(session);
		f.pane.stagePrompt(session.id, 'Keep this');
		const paste = f.pane.domNode.querySelector<HTMLButtonElement>('.openide-cli-composer-actions .primary')!;
		paste.click(); await timeout(0);
		assert.strictEqual(f.pane.domNode.querySelector('textarea')!.value, 'Keep this');
		assert.ok(f.pane.domNode.querySelector('.openide-cli-composer-error')!.textContent);
		reject = false; paste.click();
		f.pane.stagePrompt(session.id, 'Appended while pasting');
		await ready.complete(); await timeout(0);
		assert.strictEqual(f.pane.domNode.querySelector('textarea')!.value, 'Keep this\n\nAppended while pasting');
	});

	test('native control events update status independently of process lifetime and disconnect loses certainty', async () => {
		const f = fixture(undefined, pasteTerminal(async () => {}));
		await f.pane.open(session);
		assert.strictEqual(f.pane.statusOf(session.id), 'unknown');
		f.goalEvents.fire({ sessionId: 'foreign', kind: 'activity', status: 'in-progress' });
		assert.strictEqual(f.pane.statusOf(session.id), 'unknown');
		f.goalEvents.fire({ sessionId: session.id, kind: 'activity', status: 'needs-input', waitingReason: 'permission' });
		assert.deepStrictEqual(f.pane.runtimeOf(session.id), { lifecycle: 'running', status: 'needs-input', source: 'control', waitingReason: 'permission' });
		f.goalEvents.fire({ sessionId: session.id, kind: 'activity', status: 'completed' });
		assert.strictEqual(f.pane.runtimeOf(session.id)?.lifecycle, 'running');
		f.goalEvents.fire({ sessionId: session.id, kind: 'disconnected', reason: 'closed' });
		assert.strictEqual(f.pane.statusOf(session.id), 'unknown');
	});

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
