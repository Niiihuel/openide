/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputHideEvent, IQuickInputService, QuickInputHideReason, IQuickPick, IQuickPickDidAcceptEvent, IQuickPickItem, IQuickWidget } from '../../../../../platform/quickinput/common/quickInput.js';
import { IResourceMultiDiffEditorInput } from '../../../../common/editor.js';
import { ISCMHistoryProvider } from '../../../scm/common/history.js';
import { ISCMInput, ISCMProvider, ISCMRepository, ISCMResource, ISCMResourceGroup } from '../../../scm/common/scm.js';
import { OpenideAgentWindowGit } from '../../browser/openideAgentWindowGit.js';

suite('OpenIDE agent window native Git actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		const accept = store.add(new Emitter<IQuickPickDidAcceptEvent>());
		const hide = store.add(new Emitter<IQuickInputHideEvent>());
		const changeValue = store.add(new Emitter<string>());
		const changeResources = store.add(new Emitter<void>());
		const picker = upcastPartial<IQuickPick<IQuickPickItem>>({
			items: [], selectedItems: [], value: '', busy: false,
			onDidAccept: accept.event, onDidHide: hide.event, onDidChangeValue: changeValue.event,
			show() { }, hide() { hide.fire({ reason: QuickInputHideReason.Other }); }, dispose() { },
		});
		const formHide = store.add(new Emitter<IQuickInputHideEvent>());
		const form = upcastPartial<IQuickWidget>({ busy: false, onDidHide: formHide.event, show() {}, hide() { formHide.fire({ reason: QuickInputHideReason.Other }); }, dispose() {} });
		const commands: { id: string; args: unknown[] }[] = [];
		const comparisons: IResourceMultiDiffEditorInput[] = [];
		const info: string[] = [];
		const root = URI.file('/controlled-test-repository');
		const current = { id: 'refs/heads/main', name: 'main', revision: 'current-sha' };
		const base = { id: 'refs/remotes/origin/base', name: 'origin/base', revision: 'base-sha' };
		const diffCalls: [string, string | undefined][] = [];
		const originalUri = URI.from({ scheme: 'git', path: '/controlled-test-repository/a.ts', query: 'base-sha' });
		const modifiedUri = originalUri.with({ query: 'current-sha' });
		const history = upcastPartial<ISCMHistoryProvider>({
			historyItemRef: constObservable(current),
			provideHistoryItemRefs: async () => [current, base],
			provideHistoryItemChanges: async (id, parent) => { diffCalls.push([id, parent]); return [{ uri: root.with({ path: root.path + '/a.ts' }), originalUri, modifiedUri }]; },
		});
		const groups: ISCMResourceGroup[] = [
			upcastPartial<ISCMResourceGroup>({ id: 'index', resources: [upcastPartial<ISCMResource>({})] }),
			upcastPartial<ISCMResourceGroup>({ id: 'workingTree', resources: [upcastPartial<ISCMResource>({}), upcastPartial<ISCMResource>({})] }),
		];
		let draft = '';
		const repository = upcastPartial<ISCMRepository>({
			id: 'repo',
			provider: upcastPartial<ISCMProvider>({ providerId: 'git', rootUri: root, name: 'Test project', groups, historyProvider: constObservable(history), onDidChangeResources: changeResources.event, onDidChangeResourceGroups: Event.None }),
			input: upcastPartial<ISCMInput>({ get value() { return draft; }, setValue(value) { draft = value; }, onDidChange: Event.None, validateInput: async () => undefined }),
		});
		const helper = store.add(new OpenideAgentWindowGit($('div'), {
			getRepository: () => repository,
			openComparison: async input => { comparisons.push(input); },
		}, upcastPartial<IQuickInputService>({ createQuickPick: (() => picker) as IQuickInputService['createQuickPick'], createQuickWidget: () => form }),
		upcastPartial<ICommandService>({ executeCommand: (async (id: string, ...args: unknown[]) => { commands.push({ id, args }); }) as ICommandService['executeCommand'] }),
		upcastPartial<INotificationService>({ info: message => info.push(String(message)), error: error => { throw error; } })));
		return { helper, picker, form, repository, groups, commands, comparisons, diffCalls, root, base, originalUri, modifiedUri, info, get draft() { return draft; }, type(value: string) { const input = (form.widget as HTMLElement).querySelector<HTMLTextAreaElement>('textarea')!; input.value = value; input.dispatchEvent(new InputEvent('input')); }, click(label: string) { const button = Array.from((form.widget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label)!; assert.ok(button, label); button.click(); }, accept(label: string) { picker.selectedItems = [picker.items.find(item => item.label === label)!]; accept.fire({ inBackground: false }); } };
	}

	test('choosing a remote branch uses native tracking checkout with the selected repository', async () => {
		const state = setup();
		await state.helper.showBranches();
		assert.deepStrictEqual(state.commands, [], 'opening the picker is read-only');
		state.accept('origin/base');
		assert.deepStrictEqual(state.commands, [{ id: 'git.graph.checkout', args: [state.root, { references: [state.base] }, state.base.id] }]);
	});

	test('comparison preserves native Git virtual URIs and directs multi-diff to the owner callback', async () => {
		const state = setup();
		await state.helper.showCompare();
		state.click('origin/base');
		assert.deepStrictEqual(state.diffCalls, [], 'selecting a base is read-only');
		state.click('Review differences');
		await Promise.resolve(); await Promise.resolve();
		assert.deepStrictEqual(state.diffCalls, [['current-sha', 'base-sha']]);
		assert.strictEqual(state.comparisons[0].resources?.[0].original.resource, state.originalUri);
		assert.strictEqual(state.comparisons[0].resources?.[0].modified.resource, state.modifiedUri);
		assert.deepStrictEqual(state.commands, [], 'comparison never changes branches or commits');
	});

	test('commit requires a message, shares the SCM draft and uses the staged command', async () => {
		const state = setup();
		state.helper.showCommit();
		assert.ok((state.form.widget as HTMLElement).textContent?.includes('1 staged'));
		state.click('Commit staged changes');
		assert.deepStrictEqual(state.commands, []);
		assert.ok((state.form.widget as HTMLElement).querySelector<HTMLButtonElement>('[data-action=commit]')?.disabled);
		state.type('Fix routing');
		assert.strictEqual(state.draft, 'Fix routing');
		state.click('Commit staged changes');
		await Promise.resolve(); await Promise.resolve();
		assert.deepStrictEqual(state.commands, [{ id: 'git.commitStaged', args: [state.root] }]);
	});

	test('commit all stays atomic in native Git and push is a separate explicit action', async () => {
		const all = setup();
		all.helper.showCommit();
		all.type('Review all changes');
		all.click('All changes');
		all.click('Stage changes and commit');
		await Promise.resolve(); await Promise.resolve();
		assert.deepStrictEqual(all.commands.map(command => command.id), ['git.commitAll']);
		const push = setup();
		push.helper.showCommit();
		push.click('Push commits');
		await Promise.resolve();
		assert.deepStrictEqual(push.commands.map(command => command.id), ['git.push']);
	});

	test('a dismissed commit form cannot execute after asynchronous validation', async () => {
		const state = setup();
		let resolve!: (value: undefined) => void;
		state.repository.input.validateInput = () => new Promise(done => { resolve = done; });
		state.helper.showCommit(); state.type('Late validation'); state.click('Commit staged changes');
		state.form.hide(); resolve(undefined);
		await Promise.resolve(); await Promise.resolve();
		assert.deepStrictEqual(state.commands, []);
	});

	test('conflicts disable commit while preserving the draft and independent push', () => {
		const state = setup();
		state.groups.push(upcastPartial<ISCMResourceGroup>({ id: 'merge', resources: [upcastPartial<ISCMResource>({})] }));
		state.helper.showCommit(); state.type('Resolve merge'); state.click('Commit staged changes');
		assert.deepStrictEqual(state.commands, []);
		assert.ok((state.form.widget as HTMLElement).textContent?.includes('Resolve 1 conflicts'));
		assert.strictEqual(state.draft, 'Resolve merge');
	});
});
