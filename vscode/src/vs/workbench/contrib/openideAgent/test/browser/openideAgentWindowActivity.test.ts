/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { OpenideChatController } from '../../browser/chat/openideChatController.js';
import { OpenideChatWidget } from '../../browser/chat/openideChatWidget.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { agentConversationSources, OpenideAgentWindowActivity } from '../../browser/openideAgentWindowActivity.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { ISubagentOrchestrationService } from '../../browser/openideSubagentOrchestrationService.js';
import { IBackgroundTerminalEvent, IChatMessage } from '../../common/openideAgentTypes.js';
import { ISubagentRun, SubagentRunEvent } from '../../common/openideSubagentTypes.js';

suite('OpenIDE agent window activity', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const navigation = store.add(new Emitter<void>()), runsChanged = store.add(new Emitter<SubagentRunEvent>()), terminalsChanged = store.add(new Emitter<void>());
		const backgroundChanged = store.add(new Emitter<IBackgroundTerminalEvent>());
		const backgroundTerminalInstanceIds: number[] = [];
		let selected = 'one';
		const messages = new Map<string, IChatMessage[]>([['one', [{ role: 'user', content: 'Review', snippets: [{ path: 'one.ts', startLine: 1, endLine: 2, text: 'first' }] }]], ['two', [{ role: 'user', content: 'https://example.com/docs', images: [{ mimeType: 'image/png', data: '', assetUri: 'file:///project/image.png' }] }]]]);
		const instances: ITerminalInstance[] = [], runs: ISubagentRun[] = [], stopped: number[] = [], opened: string[] = [], browsers: string[] = [], focused: (number | undefined)[] = [], sessionsOpened: string[] = [];
		const parent = mainWindow.document.createElement('div');
		const activity = store.add(new OpenideAgentWindowActivity(parent,
			upcastPartial<OpenideChatWidget>({ onDidChangeNavigation: navigation.event,
				controller: upcastPartial<OpenideChatController>({ onDidChangeItems: Event.None, subagentSessionOf: id => `session-${id}` }),
				sessionStore: upcastPartial<OpenideChatSessions>({ onDidChange: Event.None, listAll: () => [], linkSubagentParent: () => {}, activeSessionId: () => selected, metaOf: () => undefined, messagesOf: id => messages.get(id ?? '') ?? [] }),
				openSession: id => { sessionsOpened.push(id); },
			}),
			{ openSubagents: () => sessionsOpened.push('subagents'), openTerminal: id => focused.push(id), openResource: uri => opened.push(uri.toString()), openBrowser: url => browsers.push(url), addSource: () => {} },
			upcastPartial<ISubagentOrchestrationService>({ onDidChangeRun: runsChanged.event, getRunsForParent: id => runs.filter(run => run.parentConversationId === id) }),
			upcastPartial<ITerminalService>({ instances, onDidChangeInstances: terminalsChanged.event, safeDisposeTerminal: async instance => { stopped.push(instance.instanceId); } }),
			upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'project', folders: [{ uri: URI.file('/project'), name: 'project', index: 0, toResource: path => URI.file('/project/' + path) }] }) }),
			NullHoverService,
			upcastPartial<IOpenideAgentService>({ backgroundTerminalInstanceIds, onDidChangeBackgroundTerminal: backgroundChanged.event })));
		const section = (name: string) => parent.querySelector<HTMLElement>(`[data-activity="${name}"]`)!;
		return { parent, activity, section, messages, instances, runs, runsChanged, terminalsChanged, backgroundChanged, backgroundTerminalInstanceIds, opened, browsers, focused, stopped, sessionsOpened, navigate: async () => { selected = 'two'; navigation.fire(); await timeout(100); } };
	}

	test('sources follow selection, deduplicate user context, and preserve shared openers', async () => {
		const f = fixture();
		f.section('sources').querySelector<HTMLButtonElement>('.openide-agent-window-section-body button')!.click();
		assert.deepStrictEqual(f.opened, ['file:///project/one.ts']);
		await f.navigate();
		const buttons = f.section('sources').querySelectorAll<HTMLButtonElement>('.openide-agent-window-section-body button');
		buttons[0].click(); buttons[1].click();
		assert.deepStrictEqual(f.browsers, ['https://example.com/docs']);
		assert.deepStrictEqual(f.opened, ['file:///project/one.ts', 'file:///project/image.png']);
		assert.strictEqual(f.section('sources').querySelectorAll('img').length, 1);
		assert.ok(!f.section('sources').textContent!.includes('one.ts'));
		const sources = agentConversationSources([{ role: 'assistant', content: 'https://ignored.example' }, { role: 'user', hidden: true, content: 'https://hidden.example' }, { role: 'user', content: 'https://one.example https://one.example.' }]);
		assert.deepStrictEqual(sources.map(source => source.resource.toString()), ['https://one.example/']);
	});

	test('process focus and safe stop target only the selected visible instance', async () => {
		const f = fixture();
		f.instances.push(upcastPartial<ITerminalInstance>({ instanceId: 7, title: 'Dev server', shellLaunchConfig: {}, onTitleChanged: Event.None }), upcastPartial<ITerminalInstance>({ instanceId: 8, title: 'Hosted CLI', shellLaunchConfig: { hideFromUser: true }, onTitleChanged: Event.None }));
		f.terminalsChanged.fire();
		const entry = f.section('processes').querySelector<HTMLElement>('[data-terminal-id="7"]')!;
		entry.querySelector<HTMLButtonElement>('button')!.click();
		const actions = entry.querySelectorAll<HTMLButtonElement>('.openide-context-activity-actions button');
		assert.strictEqual(actions.length, 1);
		assert.ok(actions[0].querySelector('.codicon-trash'));
		actions[0].click();
		assert.deepStrictEqual({ focused: f.focused, stopped: f.stopped, hidden: f.section('processes').textContent!.includes('Hosted CLI') }, { focused: [7], stopped: [7], hidden: false });
	});

	test('subagent summary opens the list and includes only the selected conversation', async () => {
		const f = fixture();
		const run = upcastPartial<ISubagentRun>({ runId: 'run-one', parentConversationId: 'one', definitionName: 'Reviewer', status: 'running', task: 'Review changes' });
		f.runs.push(run, upcastPartial<ISubagentRun>({ runId: 'other', parentConversationId: 'two', definitionName: 'Other run', status: 'running', task: 'Other task' }));
		f.runsChanged.fire({ type: 'created', run }); await timeout(100);
		const summary = f.section('subagents').querySelector<HTMLButtonElement>('.openide-subagents-summary')!;
		assert.strictEqual(summary.querySelectorAll('img').length, 1);
		assert.strictEqual(f.section('subagents').querySelectorAll('.oi-spinner').length, 0);
		summary.click();
		assert.deepStrictEqual(f.sessionsOpened, ['subagents']);
		await f.navigate();
		assert.strictEqual(summary.querySelectorAll('img').length, 1);
	});

	test('background tools remain discoverable and scoped without exposing hidden CLI terminals', async () => {
		const f = fixture();
		for (const [id, owner] of [[1, 'one'], [2, 'two'], [3, 'one']] as const) {
			f.instances.push(upcastPartial<ITerminalInstance>({ instanceId: id, title: `Background ${id}`, shellLaunchConfig: { hideFromUser: true, env: { OPENIDE_CONVERSATION_ID: owner } }, onTitleChanged: Event.None }));
		}
		f.terminalsChanged.fire();
		const visible = () => [...f.section('processes').querySelectorAll<HTMLElement>('[data-terminal-id]')].map(row => row.dataset.terminalId);
		assert.deepStrictEqual(visible(), []);
		f.backgroundTerminalInstanceIds.push(1, 2);
		f.backgroundChanged.fire({ id: 'tool', command: 'npm run dev', status: 'running' });
		f.section('processes').querySelector<HTMLButtonElement>('[data-terminal-id="1"] button')!.click();
		assert.deepStrictEqual({ visible: visible(), focused: f.focused }, { visible: ['1'], focused: [1] });
		await f.navigate();
		assert.deepStrictEqual(visible(), ['2']);
		f.backgroundTerminalInstanceIds.length = 0;
		f.backgroundChanged.fire({ id: 'tool', command: 'npm run dev', status: 'exited' });
		assert.deepStrictEqual(visible(), []);
	});

	test('conversation terminals stay scoped while unowned workspace terminals remain shared', async () => {
		const f = fixture();
		for (const [id, owner] of [[1, 'one'], [2, 'two'], [3, undefined]] as const) {
			f.instances.push(upcastPartial<ITerminalInstance>({ instanceId: id, title: `Terminal ${id}`, shellLaunchConfig: { env: owner ? { OPENIDE_CONVERSATION_ID: owner } : undefined }, onTitleChanged: Event.None }));
		}
		f.terminalsChanged.fire();
		const visible = () => [...f.section('processes').querySelectorAll<HTMLElement>('[data-terminal-id]')].map(row => row.dataset.terminalId);
		assert.deepStrictEqual(visible(), ['1', '3']);
		await f.navigate();
		assert.deepStrictEqual(visible(), ['2', '3']);
	});

	test('streaming progress preserves summary icons while counts reflect status changes', async () => {
		const f = fixture();
		const first = upcastPartial<ISubagentRun>({ runId: 'first', parentConversationId: 'one', definitionName: 'Reviewer', status: 'running', task: 'Review changes' });
		const second = upcastPartial<ISubagentRun>({ runId: 'second', parentConversationId: 'one', definitionName: 'Explorer', status: 'running', task: 'Inspect files' });
		f.runs.push(first, second); f.activity.refresh();
		const summary = f.section('subagents').querySelector<HTMLButtonElement>('.openide-subagents-summary')!;
		const icons = [...summary.querySelectorAll('img')];
		const before = summary.textContent;
		f.runs[1] = { ...second, status: 'completed' };
		for (let index = 0; index < 20; index++) { f.runsChanged.fire({ type: 'created', run: f.runs[1] }); }
		await timeout(100);
		assert.strictEqual(f.section('subagents').querySelector('.openide-subagents-summary'), summary);
		assert.deepStrictEqual([...summary.querySelectorAll('img')], icons);
		assert.notStrictEqual(summary.textContent, before);
		f.runs.length = 0; f.activity.refresh();
		assert.strictEqual(summary.hidden, true);
	});

	test('large source lists expand without losing collapsed section state or unchanged DOM', () => {
		const f = fixture();
		f.messages.set('one', [{ role: 'user', content: Array.from({ length: 8 }, (_, index) => `https://example.com/${index}`).join(' ') }]); f.activity.refresh();
		const section = f.section('sources');
		assert.strictEqual(section.querySelectorAll('.openide-agent-window-section-body > .openide-agent-window-context-row').length, 3);
		const original = section.querySelector('.openide-agent-window-section-body button'); f.activity.refresh();
		assert.strictEqual(section.querySelector('.openide-agent-window-section-body button'), original);
		section.querySelector<HTMLButtonElement>('.openide-context-activity-more')!.click();
		assert.strictEqual(section.querySelectorAll('.openide-agent-window-section-body > .openide-agent-window-context-row').length, 8);
		section.querySelector<HTMLButtonElement>('.openide-context-activity-toggle')!.click(); f.activity.refresh();
		assert.strictEqual(section.querySelector<HTMLElement>('.openide-agent-window-section-body')!.hidden, true);
	});
});
