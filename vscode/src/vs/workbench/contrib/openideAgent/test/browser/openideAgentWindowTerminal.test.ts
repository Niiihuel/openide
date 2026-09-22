/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { ICreateTerminalOptions, ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { TerminalCommandId } from '../../../terminal/common/terminal.js';
import { OpenideAgentWindowTerminal } from '../../browser/openideAgentWindowTerminal.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { IBackgroundTerminalEvent } from '../../common/openideAgentTypes.js';

suite('OpenIDE agent window terminal ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(deferred?: DeferredPromise<ITerminalInstance>, extra?: ITerminalInstance) {
		const changed = store.add(new Emitter<void>());
		const disposed = store.add(new Emitter<ITerminalInstance>());
		const backgroundChanged = store.add(new Emitter<IBackgroundTerminalEvent>());
		const backgroundTerminalInstanceIds: number[] = [];
		const home = mainWindow.document.createElement('div');
		const element = mainWindow.document.createElement('div');
		home.appendChild(element);
		let creates = 0, returns = 0, moves = 0, kills = 0, ended = false;
		const terminal = upcastPartial<ITerminalInstance>({
			instanceId: 1, title: 'shell', icon: { id: 'terminal' }, onDidFocus: Event.None, setParentContextKeyService: () => {}, getCwdResource: async () => undefined, domElement: element, shellLaunchConfig: {}, isVisible: true,
			get isDisposed() { return ended; },
			attachToElement: host => { host.appendChild(element); },
			detachFromElement: () => element.remove(), setVisible: () => {}, layout: () => {}, focus: () => {},
		});
		const foreground = [terminal];
		const instances = [terminal];
		const joined: number[][] = [];
		const launchOptions: (ICreateTerminalOptions | undefined)[] = [];
		const service = upcastPartial<ITerminalService>({
			instances, foregroundInstances: foreground, activeInstance: terminal,
			onDidChangeInstances: changed.event, onAnyInstanceTitleChange: Event.None, onAnyInstanceIconChange: Event.None, onDidDisposeInstance: disposed.event,
			createTerminal: async options => { launchOptions.push(options); creates++; if (extra) { instances.push(extra); foreground.push(extra); return extra; } return deferred ? deferred.p : terminal; },
			moveToBackground: instance => { moves++; foreground.splice(foreground.indexOf(instance), 1); changed.fire(); },
			showBackgroundTerminal: async instance => { returns++; home.appendChild(instance.domElement); foreground.push(instance); changed.fire(); },
			safeDisposeTerminal: async () => { kills++; ended = true; element.remove(); disposed.fire(terminal); },
		});
		const host = mainWindow.document.createElement('div');
		const keybindingChanges = store.add(new Emitter<void>());
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IKeybindingService, upcastPartial<IKeybindingService>({ lookupKeybinding: () => undefined, onDidUpdateKeybindings: keybindingChanges.event }));
		const panel = store.add(new OpenideAgentWindowTerminal(host, () => {}, service, NullHoverService, upcastPartial<ITerminalGroupService>({ getGroupForInstance: () => undefined, joinInstances: instances => { joined.push(instances.map(instance => instance.instanceId)); } }), new MockContextKeyService(), instantiation, upcastPartial<IOpenideAgentService>({ backgroundTerminalInstanceIds, onDidChangeBackgroundTerminal: backgroundChanged.event })));
		return { panel, terminal, element, home, service, foreground, changed, backgroundChanged, backgroundTerminalInstanceIds, joined, launchOptions, keybindingChanges, counts: () => ({ creates, moves, returns, kills }) };
	}

	test('select and close window borrow and return the same terminal without spawning or killing', async () => {
		const f = fixture();
		await f.panel.reveal();
		await f.panel.reveal();
		const inPanel = f.panel.domNode.contains(f.element);
		f.panel.dispose();
		assert.deepStrictEqual({ ...f.counts(), inPanel, returned: f.home.contains(f.element) }, { creates: 0, moves: 1, returns: 1, kills: 0, inPanel: true, returned: true });
	});

	test('hide returns ownership and reopening can reattach the existing process', async () => {
		const f = fixture();
		await f.panel.reveal();
		f.panel.hide();
		await f.panel.reveal();
		assert.deepStrictEqual({ ...f.counts(), active: f.panel.domNode.querySelectorAll('[aria-selected="true"]').length, attached: f.panel.domNode.contains(f.element) }, { creates: 0, moves: 2, returns: 1, kills: 0, active: 1, attached: true });
	});

	test('only registered background tools can borrow a hidden terminal and closing leaves its owner intact', async () => {
		const f = fixture();
		mainWindow.document.body.appendChild(f.home);
		store.add({ dispose: () => f.home.remove() });
		f.terminal.shellLaunchConfig.hideFromUser = true;
		f.foreground.length = 0;
		f.changed.fire();
		await f.panel.reveal(f.terminal.instanceId);
		assert.strictEqual(f.panel.domNode.contains(f.element), false);
		f.backgroundTerminalInstanceIds.push(f.terminal.instanceId);
		f.backgroundChanged.fire({ id: 'tool', command: 'npm run dev', status: 'running' });
		await f.panel.reveal(f.terminal.instanceId);
		assert.strictEqual(f.panel.domNode.contains(f.element), true);
		f.panel.dispose();
		assert.deepStrictEqual({ ...f.counts(), hidden: f.terminal.shellLaunchConfig.hideFromUser, returned: f.home.contains(f.element) }, { creates: 0, moves: 0, returns: 0, kills: 0, hidden: true, returned: true });
	});

	test('terminal disposal removes stale selection without restoring the terminated process', async () => {
		const f = fixture();
		await f.panel.reveal();
		await f.service.safeDisposeTerminal(f.terminal);
		f.panel.hide();
		assert.deepStrictEqual({ ...f.counts(), tabs: f.panel.domNode.querySelectorAll('[role="tab"]').length, empty: !!f.panel.domNode.querySelector('.openide-agent-window-terminal-empty') }, { creates: 0, moves: 1, returns: 0, kills: 1, tabs: 0, empty: true });
	});

	test('replacing the shared empty state releases its keyboard listeners and create action', async () => {
		const f = fixture();
		assert.strictEqual(f.keybindingChanges.hasListeners(), true);
		const replacedButton = f.panel.domNode.querySelector<HTMLButtonElement>('.openide-empty-state-action')!;
		f.panel.hide();
		f.panel.hide();
		replacedButton.click();
		await Promise.resolve();
		assert.strictEqual(f.counts().creates, 0, 'detached empty actions cannot create terminals');
		assert.strictEqual(f.panel.domNode.querySelectorAll('.openide-empty-state').length, 1);
		await f.panel.reveal();
		assert.strictEqual(f.keybindingChanges.hasListeners(), false, 'all replaced keybinding listeners are released when panes attach');
		f.panel.hide();
		assert.strictEqual(f.keybindingChanges.hasListeners(), true);
		f.panel.dispose();
		assert.strictEqual(f.keybindingChanges.hasListeners(), false, 'disposing the panel releases the current empty state');
	});

	test('creation finishing after window closes remains in the IDE', async () => {
		const ready = new DeferredPromise<ITerminalInstance>();
		const f = fixture(ready);
		const first = f.panel.create();
		const second = f.panel.create();
		f.panel.dispose();
		await ready.complete(f.terminal);
		await Promise.all([first, second]);
		assert.deepStrictEqual({ ...f.counts(), inIde: f.home.contains(f.element) }, { creates: 1, moves: 0, returns: 0, kills: 0, inIde: true });
	});
	test('hiding while creation is pending keeps the new terminal in the IDE', async () => {
		const ready = new DeferredPromise<ITerminalInstance>();
		const f = fixture(ready);
		const pending = f.panel.create();
		f.panel.hide();
		await ready.complete(f.terminal);
		await pending;
		assert.deepStrictEqual({ ...f.counts(), inIde: f.home.contains(f.element) }, { creates: 1, moves: 0, returns: 0, kills: 0, inIde: true });
	});

	test('resolved focus and kill commands target the borrowed process; unsupported commands stay native', async () => {
		const f = fixture();
		assert.strictEqual(await f.panel.handleCommand(TerminalCommandId.Focus), true);
		assert.strictEqual(await f.panel.handleCommand('workbench.action.files.save'), false);
		assert.strictEqual(await f.panel.handleCommand(TerminalCommandId.Kill), true);
		assert.deepStrictEqual(f.counts(), { creates: 0, moves: 1, returns: 0, kills: 1 });
	});

	test('split command uses native panes, preserves both processes and restores the split group', async () => {
		const element = mainWindow.document.createElement('div');
		const second = upcastPartial<ITerminalInstance>({
			instanceId: 2, title: 'second', icon: { id: 'terminal' }, domElement: element, shellLaunchConfig: {}, isVisible: true, isDisposed: false,
			onDidFocus: Event.None, setParentContextKeyService: () => {}, attachToElement: host => { host.appendChild(element); }, detachFromElement: () => element.remove(),
			setVisible: () => {}, layout: () => {}, focus: () => {},
		});
		const f = fixture(undefined, second);
		await f.panel.reveal();
		await f.panel.handleCommand(TerminalCommandId.Split);
		assert.strictEqual(f.panel.domNode.querySelectorAll('.terminal-split-pane').length, 2);
		assert.strictEqual(f.panel.domNode.querySelector('[aria-selected="true"]')?.textContent, 'second');
		await f.panel.handleCommand(TerminalCommandId.FocusPreviousPane);
		assert.strictEqual(f.panel.domNode.querySelector('[aria-selected="true"]')?.textContent, 'shell');
		f.panel.hide();
		await Promise.resolve(); await Promise.resolve();
		assert.deepStrictEqual(f.counts(), { creates: 1, moves: 2, returns: 2, kills: 0 });
		assert.deepStrictEqual(f.joined, [[1, 2]]);
		assert.ok(f.home.contains(element) && f.home.contains(f.element));
	});

	test('native New command preserves user keybinding cwd and shell configuration arguments', async () => {
		const f = fixture();
		const config = { executable: '/bin/sh', name: 'Custom profile', env: { OPENIDE_FIXTURE: '1' } };
		await f.panel.handleCommand(TerminalCommandId.New, { cwd: '/tmp/custom-project', config });
		assert.strictEqual(f.launchOptions[0]?.cwd, '/tmp/custom-project');
		assert.strictEqual(f.launchOptions[0]?.config, config);
	});

});
