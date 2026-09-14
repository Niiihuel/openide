/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IStatusbarEntryContainer } from '../../../../browser/parts/statusbar/statusbarPart.js';
import { IStatusbarEntry } from '../../../../services/statusbar/browser/statusbar.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { OpenideAgentWindowStatusbar } from '../../browser/openideAgentWindowStatusbar.js';
import { OpenideChatWidget } from '../../browser/chat/openideChatWidget.js';
import { IChatSessionMeta, OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { IOpenideUsageAccount, IOpenideUsageMonitor, IOpenideUsageSnapshot } from '../../browser/openideUsageMonitor.js';

suite('OpenIDE agent window footer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const changed = store.add(new Emitter<IOpenideUsageSnapshot>());
		const sessions = store.add(new Emitter<void>());
		const entries = new Map<string, IStatusbarEntry>();
		const snapshot: IOpenideUsageSnapshot = { enabled: true, fetching: false, updatedAt: 0, accounts: [
			{ entry: upcastPartial<IOpenideUsageAccount['entry']>({ id: 'openai', label: 'Alpha' }), usage: undefined, staleness: 'expired', fetching: false, failureStreak: 1, alsoFrom: [] },
			{ entry: upcastPartial<IOpenideUsageAccount['entry']>({ id: 'anthropic', label: 'Beta' }), usage: upcastPartial<NonNullable<IOpenideUsageAccount['usage']>>({ windows: [{ usedPercent: 35, label: 'Weekly', limitMinutes: 10080, resetsAt: null, resetDescription: null }] }), staleness: 'fresh', fetching: false, failureStreak: 0, alsoFrom: [] }
		] };
		let cwd = '/project/one';
		let opened = ''; let refreshed = 0;
		const footer = store.add(new OpenideAgentWindowStatusbar(
			upcastPartial<IStatusbarEntryContainer>({ addEntry: (entry, id) => { entries.set(id, entry); return { update: entry => entries.set(id, entry), dispose: () => { entries.delete(id); } }; } }), mainWindow.document,
			upcastPartial<OpenideChatWidget>({ sessionStore: upcastPartial<OpenideChatSessions>({ onDidChange: sessions.event, activeSessionId: () => 'cli', metaOf: () => upcastPartial<IChatSessionMeta>({ id: 'cli', kind: 'cli', cwd }) }) }),
			{ openEnvironment: () => { opened = 'environment'; }, openTerminal: () => { opened = 'terminal'; }, openBrowser: () => { opened = 'browser'; } },
			upcastPartial<IOpenideUsageMonitor>({ onDidChange: changed.event, getSnapshot: () => snapshot, refresh: async () => { refreshed++; } }),
			upcastPartial<IContextViewService>({}), upcastPartial<ICommandService>({}),
			upcastPartial<IWorkspaceContextService>({ getWorkspace: () => ({ id: 'workspace', folders: [] }), onDidChangeWorkspaceFolders: Event.None }),
			upcastPartial<ITerminalService>({ onDidChangeInstances: Event.None, instances: [upcastPartial<ITerminalInstance>({ isDisposed: false, shellLaunchConfig: {} }), upcastPartial<ITerminalInstance>({ isDisposed: false, shellLaunchConfig: { hideFromUser: true } })] })
		));
		return { footer, entries, changed, snapshot, sessions, navigate: () => { cwd = '/other/two'; sessions.fire(); }, opened: () => opened, refreshed: () => refreshed };
	}
	test('shows each account independently without borrowing quota for unknown accounts', () => {
		const f = fixture();
		const roster = f.entries.get('openide.agent.usage')!;
		assert.ok(roster.ariaLabel.includes('Alpha: —'));
		// Very narrow runners only display one account; it must still expose overflow.
		const content = roster.content as HTMLElement;
		assert.ok(content.textContent!.includes('35%') || content.textContent!.includes('+1'));
	});
	test('routes native footer commands and tracks selected CLI environment', async () => {
		const f = fixture();
		assert.ok(f.entries.get('openide.agent.footer.environment')!.ariaLabel.includes('one'));
		const roster = f.entries.get('openide.agent.usage')!.content;
		f.navigate();
		assert.strictEqual(f.entries.get('openide.agent.usage')!.content, roster, 'native content node survives updates');
		assert.ok(f.entries.get('openide.agent.footer.environment')!.ariaLabel.includes('two'));
		assert.strictEqual(f.entries.get('openide.agent.footer.terminal')!.text, '$(terminal) 1');
		for (const action of ['environment', 'terminal', 'browser', 'refresh']) {
			const command = f.entries.get(`openide.agent.footer.${action}`)!.command as string;
			await CommandsRegistry.getCommand(command)!.handler(upcastPartial<ServicesAccessor>({}));
			if (action !== 'refresh') { assert.strictEqual(f.opened(), action); }
		}
		assert.strictEqual(f.refreshed(), 1);
		const command = f.entries.get('openide.agent.footer.browser')!.command as string;
		f.footer.dispose();
		assert.strictEqual(f.entries.size, 0);
		assert.strictEqual(CommandsRegistry.getCommand(command), undefined);
	});
});
