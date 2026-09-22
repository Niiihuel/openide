/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IDelayedHoverOptions } from '../../../../../base/browser/ui/hover/hover.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { t } from '../../common/openideStrings.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideChatSessionsPane, sessionProjectContext } from '../../browser/chat/openideChatSessionsPane.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { createSubagentAvatar } from '../../browser/openideSubagentAvatar.js';
import { ISubagentRunService } from '../../browser/openideSubagentRunService.js';
import { ISubagentRun, SubagentRunEvent } from '../../common/openideSubagentTypes.js';
import { IChatSessionMeta, OpenideChatSessions } from '../../browser/openideChatSessions.js';

suite('OpenIDE Chat Sessions Pane', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(count = 2) {
		const records: IChatSessionMeta[] = Array.from({length: count}, (_, index) => ['First session', 'Second session'][index] ?? `Session ${index}`).map((title, index) => ({
			id: String(index), title, updatedAt: Date.now() - index * 1000, archived: false, hasError: false, forked: false, kind: 'native',
		}));
		const archived: string[] = [];
		const opened: string[] = [];
		const tabs: string[] = [];
		const sessions: Partial<OpenideChatSessions> = {
			listAll: () => records,
			activeSessionId: () => '0',
			openTabs: () => tabs.map(id => records.find(record => record.id === id)!),
			archive: id => { archived.push(id); records.find(record => record.id === id)!.archived = true; },
			unarchive: id => { records.find(record => record.id === id)!.archived = false; },
			setPinned: (id, pinned) => { records.find(record => record.id === id)!.pinned = pinned; },
			rename: (id, title) => { records.find(record => record.id === id)!.title = title; },
			markRead: id => { records.find(record => record.id === id)!.unread = false; },
		};
		const host = mainWindow.document.createElement('div');
		host.style.cssText = 'position:relative;width:320px;height:800px';
		mainWindow.document.body.appendChild(host);
		store.add(toDisposable(() => host.remove()));
		const previews = new Map<HTMLElement, () => IDelayedHoverOptions>();
		const hoverService: IHoverService = { ...NullHoverService, setupDelayedHover: (target, factory) => {
			previews.set(target, () => typeof factory === 'function' ? factory() : factory);
			return toDisposable(() => previews.delete(target));
		} };
		const workspace = upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'test', folders: [], transient: false }), onDidChangeWorkspaceFolders: Event.None });
		let menu: HTMLElement | undefined;
		const context = upcastPartial<IContextViewService>({
			showContextView: delegate => {
				menu = mainWindow.document.createElement('div'); host.appendChild(menu);
				const content = delegate.render(menu) as IDisposable;
				const node = menu;
				return { close: () => { content.dispose(); node.remove(); delegate.onHide?.(); menu = undefined; } };
			},
			getContextViewElement: () => menu!,
		});
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IKeybindingService, new MockKeybindingService());
		const runs = new Map<string, ISubagentRun>();
		const runEvents = store.add(new Emitter<SubagentRunEvent>());
		const lookups: string[] = [];
		const runService = upcastPartial<ISubagentRunService>({ onDidChangeRun: runEvents.event, get: id => { lookups.push(id); return runs.get(id); } });
		const commands = upcastPartial<ICommandService>({ executeCommand: async () => undefined });
		const pane = store.add(new OpenideChatSessionsPane(host, sessions as OpenideChatSessions, async () => false, instantiation, commands, context, hoverService, workspace, runService));
		store.add(pane.onDidOpenSession(id => opened.push(id)));
		pane.setOpen(true);
		pane.layout(320, 0);
		return { host, pane, archived, opened, records, previews, runs, runEvents, lookups, tabs };
	}

	test('specialists are nested under their parent and open separately from the main conversation', () => {
		const { host, pane, records, opened } = create();
		records.push({ ...records[0], id: 'child', title: 'Specialist', forked: true, subagentRunId: 'run', parentSessionId: '0' });
		const specialists: string[] = [];
		store.add(pane.onDidOpenSubagent(id => specialists.push(id)));
		pane.setCompact(true);
		assert.strictEqual(host.querySelector('[data-session-id="child"]'), null);
		assert.strictEqual(host.querySelector('.openide-chat-sessions-group-count')?.textContent, '2');
		host.querySelector<HTMLButtonElement>('[data-parent-session-id="0"] button')!.click();
		host.querySelector<HTMLButtonElement>('[data-subagent-session-id="child"]')!.click();
		assert.deepStrictEqual(opened, ['0']);
		assert.deepStrictEqual(specialists, ['child']);
	});

	test('disclosures preserve sibling identity and focus while lazily mounting visible children', () => {
		const { host, pane, records, lookups } = create();
		records.push({ ...records[0], id: 'child', title: 'Worker', subagentRunId: 'run', parentSessionId: '0' });
		pane.setCompact(true);
		const project = host.querySelector<HTMLButtonElement>('[data-project-id="no-project"]')!;
		const row = host.querySelector('[data-session-id="0"]');
		const toggle = host.querySelector<HTMLButtonElement>('.openide-chat-sessions-children-toggle')!;
		assert.deepStrictEqual(lookups, []);
		toggle.focus(); toggle.click();
		const child = host.querySelector('[data-subagent-session-id="child"]')!;
		assert.ok(child);
		toggle.click();
		assert.strictEqual(host.querySelector('[data-subagent-session-id="child"]'), null);
		toggle.click(); pane.render();
		assert.strictEqual(host.querySelector('[data-session-id="0"]'), row);
		assert.ok(host.querySelector('[data-subagent-session-id="child"]'));
		assert.strictEqual(host.ownerDocument.activeElement, toggle);
		project.click(); project.click();
		assert.ok(host.querySelector('[data-session-id="0"]'));
		assert.deepStrictEqual(lookups, ['run']);
	});

	test('worker avatars match the run profile, survive streaming, and update without rebuilding the sidebar', () => {
		const { host, pane, records, runs, runEvents, lookups } = create();
		const run = upcastPartial<ISubagentRun>({ runId: 'run', task: 'Inspect controls', profile: 'research', readonly: true });
		runs.set(run.runId, run);
		records.push({ ...records[0], id: 'child', title: 'My renamed specialist', subagentRunId: run.runId, parentSessionId: '0', status: 'in-progress' });
		pane.setCompact(true);
		assert.deepStrictEqual(lookups, [], 'collapsed branches never load run history');
		host.querySelector<HTMLButtonElement>('[data-parent-session-id="0"] button')!.click();
		const button = host.querySelector<HTMLButtonElement>('[data-subagent-session-id="child"]')!;
		const avatar = button.querySelector<HTMLElement>('.openide-subagent-avatar')!;
		const icon = avatar.querySelector<HTMLImageElement>('img')!;
		assert.strictEqual(icon.src, createSubagentAvatar(run).querySelector<HTMLImageElement>('img')!.src);
		assert.ok(button.querySelector('.oi-spinner'), 'activity remains a separate indicator');
		assert.strictEqual(button.firstElementChild, avatar);
		for (let index = 0; index < 50; index++) { runEvents.fire({ type: 'changed', run: { ...run, progress: `Step ${index}` } }); pane.render(); }
		assert.strictEqual(host.querySelector('[data-subagent-session-id="child"]'), button);
		assert.strictEqual(button.querySelector('.openide-subagent-avatar'), avatar);
		assert.deepStrictEqual(lookups, ['run']);
		const rerouted = { ...run, profile: 'review' as const };
		runEvents.fire({ type: 'changed', run: rerouted });
		assert.strictEqual(host.querySelector('[data-subagent-session-id="child"]'), button);
		assert.strictEqual(button.querySelector<HTMLImageElement>('.openide-subagent-avatar img')!.src, createSubagentAvatar(rerouted).querySelector<HTMLImageElement>('img')!.src);
		records[2].status = 'completed'; pane.render();
		assert.strictEqual(host.querySelector('[data-subagent-session-id="child"] img')?.getAttribute('src'), createSubagentAvatar(rerouted).querySelector('img')?.getAttribute('src'));
		assert.strictEqual(host.querySelector('[data-subagent-session-id="child"] .oi-spinner'), null);
		assert.deepStrictEqual(lookups, ['run'], 'status repaint reuses avatar metadata');
	});

	test('archive keyboard activation never bubbles into opening the conversation', () => {
		const { host, archived, opened } = create();
		const row = host.querySelector<HTMLElement>('[data-session-id="0"]')!;
		const primary = row.querySelector<HTMLButtonElement>('.openide-chat-sessions-open')!;
		const archive = row.querySelector('.codicon-archive')!.parentElement as HTMLButtonElement;
		assert.strictEqual(primary.querySelector('[role="button"], button'), null);
		primary.focus(); // Keyboard focus reveals the row actions before tabbing into them.
		archive.focus();
		archive.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual(opened, []);
		archive.click();
		assert.deepStrictEqual(archived, ['0']);
		assert.deepStrictEqual(opened, []);
		assert.strictEqual(mainWindow.document.activeElement, host.querySelector('[data-session-id="1"] .openide-chat-sessions-open'));
	});

	test('repainting an active row keeps keyboard focus without opening or changing search', () => {
		const { host, pane, opened, records } = create();
		const primary = host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-open')!;
		assert.ok(primary.classList.contains('selected'));
		assert.strictEqual(primary.getAttribute('aria-current'), 'true');
		primary.focus();
		records[0].title = 'Updated title';
		records[0].status = 'in-progress';
		pane.render();
		const replacement = host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-open')!;
		assert.strictEqual(replacement, primary, 'status and title update the existing primary control');
		assert.ok(replacement.querySelector('.oi-spinner'));
		assert.strictEqual(host.querySelector('.openide-chat-session-dot'), null);
		assert.strictEqual(mainWindow.document.activeElement, replacement);
		assert.deepStrictEqual(opened, []);
		replacement.click();
		assert.deepStrictEqual(opened, ['0']);
		records[0].status = 'completed';
		pane.render();
		assert.strictEqual(host.querySelector('.oi-spinner'), null);
	});

	test('filtering retains the native search field, its value and focus; IME Escape does not dismiss', () => {
		const { host, pane } = create();
		const search = host.querySelector<HTMLInputElement>('.openide-chat-sessions-search input')!;
		search.focus();
		search.value = 'Second';
		search.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(host.querySelector('.openide-chat-sessions-search input'), search);
		assert.strictEqual(mainWindow.document.activeElement, search);
		assert.strictEqual(search.value, 'Second');
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 1);
		search.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
		assert.strictEqual(pane.isOpen, true);
	});
	test('compact agent mode hides search, resets its filter and preserves the IDE default', () => {
		const { host, pane } = create();
		const head = host.querySelector<HTMLElement>('.openide-chat-sessions-head')!;
		const search = host.querySelector<HTMLInputElement>('.openide-chat-sessions-search input')!;
		assert.strictEqual(head.hidden, false);
		search.value = 'Second';
		search.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 1);
		pane.setCompact(true);
		assert.strictEqual(head.hidden, true);
		assert.strictEqual(search.value, '');
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 2);
		pane.setCompact(false);
		assert.strictEqual(head.hidden, false);
	});

	test('uses known project folders without misattributing native multi-root history', () => {
		const { records } = create();
		const folders = [{ name: 'App', uri: URI.file('/work/app') }, { name: 'Package', uri: URI.file('/work/app/packages/site') }];
		assert.strictEqual(sessionProjectContext({ ...records[0], kind: 'cli', cwd: '/work/app/packages/site/src' }, folders).label, 'Package');
		assert.strictEqual(sessionProjectContext(records[0], folders).id, 'no-project');
		assert.strictEqual(sessionProjectContext(records[0], [folders[0]]).label, 'App');
		assert.strictEqual(sessionProjectContext({ ...records[0], kind: 'cli', cwd: '/work/app-other' }, folders).path, '/work/app-other');
	});

	test('one native preview reveals context and no-op refresh keeps its target', () => {
		const { host, pane, previews, records } = create();
		const row = host.querySelector<HTMLElement>('[data-session-id="0"]')!;
		const primary = row.querySelector<HTMLButtonElement>('.openide-chat-sessions-open')!;
		const preview = previews.get(primary)!();
		assert.ok(preview.content instanceof mainWindow.HTMLElement);
		assert.ok((preview.content as HTMLElement).textContent?.includes(records[0].title));
		assert.ok((preview.content as HTMLElement).querySelector('.openide-chat-session-preview-context'));
		assert.strictEqual(preview.persistence?.hideOnHover, false);
		assert.strictEqual(row.querySelector('[title]'), null);
		assert.strictEqual(row.querySelector('.openide-chat-sessions-row-meta'), null);
		pane.render();
		assert.strictEqual(host.querySelector('[data-session-id="0"] .openide-chat-sessions-open'), primary);
	});

	test('search matches working directory and does not invent pin actions', () => {
		const { host, pane, records } = create();
		records[1].kind = 'cli';
		records[1].cwd = '/work/project-two';
		pane.render();
		const search = host.querySelector<HTMLInputElement>('.openide-chat-sessions-search input')!;
		search.value = 'project-two';
		search.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 1);
		assert.strictEqual(host.querySelector('.openide-chat-sessions-row')?.getAttribute('data-session-id'), '1');
		assert.strictEqual(host.querySelector('.codicon-pin'), null);
	});

	test('compact groups keep pins separate and expose all history with collapsed archives', () => {
		const { host, pane, records } = create(10);
		records[9].pinned = true; records[9].empty = true; records[8].archived = true;
		pane.setCompact(true);
		const groups = () => Array.from(host.querySelectorAll<HTMLElement>('[data-project-id]'));
		assert.deepStrictEqual(groups().map(group => group.dataset.projectId), ['pinned', 'no-project', 'archived']);
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 9);
		assert.ok(host.querySelector('[data-session-id="9"]'));
		assert.strictEqual(host.querySelector('[data-session-id="8"]'), null);
		groups().find(group => group.dataset.projectId === 'no-project')!.click();
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 1);
		assert.strictEqual(groups().find(group => group.dataset.projectId === 'no-project')!.getAttribute('aria-expanded'), 'false');
		groups().find(group => group.dataset.projectId === 'archived')!.click();
		assert.ok(host.querySelector('[data-session-id="8"]'));
		groups().find(group => group.dataset.projectId === 'no-project')!.click();
		pane.setCompact(false);
		assert.strictEqual(host.querySelectorAll('.openide-chat-sessions-row').length, 9, 'IDE keeps its complete non-archived history');
	});

	test('compact menu pins and renames without opening; Escape cancels rename', async () => {
		const { host, pane, records, opened } = create();
		pane.setCompact(true);
		const menu = () => host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-row-actions button')!.click();
		const pick = async (label: string) => {
			Array.from(host.querySelectorAll<HTMLButtonElement>('.openide-menu-row')).find(button => button.textContent === label)!.click();
			await Promise.resolve(); await Promise.resolve();
		};
		menu(); await pick(t('sessions.action.pin'));
		assert.strictEqual(records[0].pinned, true);
		assert.strictEqual(host.querySelector('[data-project-id]')?.getAttribute('data-project-id'), 'pinned');
		menu(); await pick(t('sessions.action.rename'));
		let input = host.querySelector<HTMLInputElement>('.openide-chat-sessions-rename input')!;
		input.value = 'A renamed conversation'; input.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		const originalInput = input; input.setSelectionRange(2, 7);
		records[0].status = 'in-progress'; pane.render();
		input = host.querySelector<HTMLInputElement>('.openide-chat-sessions-rename input')!;
		assert.strictEqual(input, originalInput, 'streaming preserves the input itself');
		assert.deepStrictEqual([input.selectionStart, input.selectionEnd], [2, 7]);
		assert.strictEqual(input.value, 'A renamed conversation', 'status update preserves edit draft');
		input.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.strictEqual(records[0].title, 'A renamed conversation');
		menu(); await pick(t('sessions.action.rename'));
		input = host.querySelector<HTMLInputElement>('.openide-chat-sessions-rename input')!;
		input.value = 'Discard this'; input.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		input.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.strictEqual(records[0].title, 'A renamed conversation');
		assert.deepStrictEqual(opened, []);
	});

	test('compact unread marker yields to running spinner and mark read updates the store', async () => {
		const { host, pane, records } = create();
		records[0].unread = true; pane.setCompact(true);
		assert.ok(host.querySelector('[data-session-id="0"] .openide-chat-sessions-unread'));
		records[0].status = 'in-progress'; pane.render();
		assert.ok(host.querySelector('[data-session-id="0"] .oi-spinner'));
		assert.strictEqual(host.querySelector('[data-session-id="0"] .openide-chat-sessions-unread'), null);
		records[0].status = 'completed'; pane.render();
		host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-row-actions button')!.click();
		Array.from(host.querySelectorAll<HTMLButtonElement>('.openide-menu-row')).find(button => button.textContent === t('sessions.action.markRead'))!.click();
		await Promise.resolve(); await Promise.resolve();
		assert.strictEqual(records[0].unread, false);
		assert.strictEqual(host.querySelector('.openide-chat-sessions-unread'), null);
	});


	test('open conversations are grouped by tab membership independently of running status', () => {
		const { host, pane, records, tabs } = create(4);
		tabs.push('1', '0'); records[0].status = 'completed'; records[2].status = 'in-progress';
		pane.setCompact(true);
		const group = host.querySelector('[data-project-id="opened"]')!;
		assert.strictEqual(group.querySelector('.openide-chat-sessions-group-count')!.textContent, '2');
		const ids = () => Array.from(host.querySelectorAll<HTMLElement>('[data-session-id]')).map(row => row.dataset.sessionId);
		assert.deepStrictEqual(ids(), ['1', '0', '2', '3']);
		records[1].status = 'in-progress'; pane.render();
		assert.strictEqual(host.querySelector('[data-project-id="opened"]'), group);
		assert.deepStrictEqual(ids(), ['1', '0', '2', '3']);
	});

	test('one thousand conversations have bounded DOM and keyboard access to the final history row', () => {
		const { host, pane, records } = create(1000);
		pane.setCompact(true);
		const rows = () => host.querySelectorAll('.openide-chat-sessions-row').length;
		assert.ok(rows() > 0 && rows() < 25, `mounted ${rows()} rows for a thousand sessions`);
		const first = host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-open')!;
		first.focus(); first.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		const last = host.querySelector<HTMLButtonElement>('[data-session-id="999"] .openide-chat-sessions-open')!;
		assert.ok(last, 'End reveals history beyond the viewport');
		assert.strictEqual(mainWindow.document.activeElement, last);
		assert.ok(rows() < 25);
		records[999].status = 'in-progress'; records[999].title = 'Streaming last session'; pane.render();
		assert.strictEqual(host.querySelector('[data-session-id="999"] .openide-chat-sessions-open'), last);
		assert.strictEqual(mainWindow.document.activeElement, last);
		assert.strictEqual(host.querySelector('[data-session-id="0"]'), null);
		last.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		assert.ok(host.querySelector('[data-session-id="0"]'));
	});

	test('streaming updates preserve an open actions menu and its focused item', () => {
		const { host, pane, records } = create(); pane.setCompact(true);
		const trigger = host.querySelector<HTMLButtonElement>('[data-session-id="0"] .openide-chat-sessions-row-actions button')!;
		trigger.click();
		const item = host.querySelector<HTMLButtonElement>('.openide-menu-row')!; item.focus();
		records[0] = { ...records[0], status: 'in-progress', title: 'New title' }; pane.render();
		assert.strictEqual(host.querySelector('[data-session-id="0"] .openide-chat-sessions-row-actions button'), trigger);
		assert.strictEqual(host.querySelector('.openide-menu-row'), item);
		assert.strictEqual(mainWindow.document.activeElement, item);
	});

});
