/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IOpenideReviewDiffService } from '../../browser/openideReviewDiffService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ISCMService } from '../../../scm/common/scm.js';
import { OpenideChatController } from '../../browser/chat/openideChatController.js';
import { OpenideChatWidget } from '../../browser/chat/openideChatWidget.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideAgentWindowContext } from '../../browser/openideAgentWindowContext.js';
import { IChatSessionMeta, OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { IOpenideCliChangesSession, OpenideCliChangesService } from '../../browser/openideCliChangesService.js';

suite('OpenIDE agent window context', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const navigation = store.add(new Emitter<void>());
		const diffChanged = store.add(new Emitter<{path: string; added: number; removed: number}>());
		const cliChanged = store.add(new Emitter<string>());
		const diffs: {path: string; added: number; removed: number}[] = [];
		const cliSessions: IOpenideCliChangesSession[] = [];
		const reviews: string[] = [];
		let diffReads = 0;
		let cli = false;
		const parent = mainWindow.document.createElement('div');
		const source = upcastPartial<OpenideChatWidget>({
			onDidChangeNavigation: navigation.event,
			controller: upcastPartial<OpenideChatController>({onDidChangeItems: Event.None}),
			sessionStore: upcastPartial<OpenideChatSessions>({onDidChange: Event.None, changesOf: () => { diffReads++; return diffs.map((file, index) => ({ id: String(index), uri: `file://${file.path}`, before: 'old\n'.repeat(file.removed), after: 'new\n'.repeat(file.added), deleted: false })); }, activeSessionId: () => cli ? 'cli' : 'native', metaOf: () => upcastPartial<IChatSessionMeta>({id: cli ? 'cli' : 'native', kind: cli ? 'cli' : 'native'})})
		});
		class SectionStub extends Disposable { refresh() {} }
		store.add(new OpenideAgentWindowContext(parent, source, {
			review: (id, files, open) => { if (open) { reviews.push(...files.map(file => `${id}:${file.path}`)); } },
			openTerminal: () => {}, createTerminal: () => {}, openFiles: () => {}, openProject: () => {}, openResource: () => {},
			openChanges: path => { reviews.push(path!); }, openCliChanges: (id,file) => { reviews.push(`${id}:${file.path}`); }, openComparison: async () => {}
		}, upcastPartial<IOpenideAgentService>({onDidChangeFileDiff: diffChanged.event, pendingFileDiffs: id => { assert.strictEqual(id, 'native', 'pending edits must be queried by conversation'); return []; }}),
		upcastPartial<ISCMService>({repositories: [], onDidAddRepository: Event.None, onDidRemoveRepository: Event.None}),
		upcastPartial<IWorkspaceContextService>({getWorkspace: () => ({id: 'project', folders: []}), onDidChangeWorkspaceFolders: Event.None}),
		NullHoverService, upcastPartial<OpenideCliChangesService>({onDidChange: cliChanged.event, sessions: () => cliSessions, preview: async () => ({ added: 2, removed: 1, lines: [], created: false })}),
		upcastPartial<IInstantiationService>({createInstance: (() => new SectionStub()) as IInstantiationService['createInstance']}),
		upcastPartial<ITextModelService>({}), upcastPartial<IModelService>({getModels: () => [], onModelAdded: Event.None, createModel: value => createTextModel(value)}), upcastPartial<IOpenideReviewDiffService>({ acquire: (model, before) => ({ dispose: () => {}, object: { compute: async () => ({ version: model.getVersionId(), changes: linesDiffComputers.getDefault().computeDiff(before.split('\n'), model.getLinesContent(), { ignoreTrimWhitespace: false, maxComputationTimeMs: 100, computeMoves: false }).changes }) } }) })));
		return {parent,diffs,diffChanged,cliSessions,reviews,diffReads: () => diffReads,toCli: async () => {cli=true; navigation.fire(); await timeout(150);}};
	}
	test('CLI changes stay isolated from native changes and open with selected session', async () => {
		const f=fixture(); f.diffs.push({path:'/native.ts',added:1,removed:0});
		f.cliSessions.push(upcastPartial<IOpenideCliChangesSession>({sessionId:'cli',cwd:'/project',files:[{path:'cli.ts',status:'modified',exact:true}]}));
		await f.toCli();
		f.parent.querySelector<HTMLButtonElement>('.openide-agent-window-changes-heading button')!.click();
		assert.deepStrictEqual(f.reviews,['cli:cli.ts']);
		assert.ok(!f.parent.textContent!.includes('native.ts'));
		assert.strictEqual(f.parent.querySelector('.openide-agent-window-changes-totals')!.textContent, '+2−1');
	});
	test('the compact Changes row opens all files without adding another list to Environment', async () => {
		const f = fixture();
		for (let i = 0; i < 124; i++) { f.diffs.push({ path: `/project/file${i}.ts`, added: i, removed: 0 }); }
		f.diffChanged.fire(f.diffs[0]); await timeout(150);
		assert.strictEqual(f.parent.querySelector('.openide-agent-window-changes-body'), null);
		f.parent.querySelector<HTMLButtonElement>('.openide-agent-window-review-summary')!.click();
		assert.strictEqual(f.reviews.length, 124);
		assert.strictEqual(f.reviews[123], 'native:/project/file123.ts');
	});
	test('totals track live changes and empty conversations cannot open another session’s changes', async () => {
		const f = fixture(); f.diffs.push({path:'/project/alpha.ts',added:1,removed:0},{path:'/project/beta.ts',added:2,removed:1}); f.diffChanged.fire(f.diffs[0]); await timeout(150);
		assert.strictEqual(f.parent.querySelector('.openide-agent-window-changes-totals')!.textContent, '+3−1');
		f.diffs[0].added = 4; f.diffChanged.fire(f.diffs[0]); await timeout(150);
		assert.strictEqual(f.parent.querySelector('.openide-agent-window-changes-totals')!.textContent, '+6−1');
		await f.toCli();
		assert.strictEqual(f.parent.querySelector<HTMLButtonElement>('.openide-agent-window-review-summary')!.disabled, true);
	});
	test('a burst of file changes refreshes the shared review only once', async () => {
		const f = fixture();
		const before = f.diffReads();
		for (let i = 0; i < 400; i++) {
			const file = { path: `/project/file${i}.ts`, added: i, removed: 0 };
			f.diffs.push(file); f.diffChanged.fire(file);
		}
		await timeout(150);
		assert.strictEqual(f.diffReads() - before, 1);
		f.parent.querySelector<HTMLButtonElement>('.openide-agent-window-review-summary')!.click();
		assert.strictEqual(f.reviews.length, 400);
	});

});
