/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { createCodeEditorServices } from '../../../../../editor/test/browser/testCodeEditor.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IEditorPane } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { OpenideDiffSnapshotProvider } from '../../browser/openideDiffSnapshot.js';
import { IOpenideReviewDiffService, IOpenideReviewDiffResult } from '../../browser/openideReviewDiffService.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { OpenideEditReview } from '../../browser/openideEditReview.js';

suite('OpenIDE EditReview follow', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(opening?: Promise<void>, holdDiffs = false) {
		const content = Array.from({ length: 500 }, (_, i) => `const value${i} = ${i};`).join('\n');
		const model = store.add(createTextModel(content));
		const host = document.body.appendChild(document.createElement('div'));
		store.add(toDisposable(() => host.remove()));
		const editorServices = createCodeEditorServices(store);
		const editor = store.add(editorServices.createInstance(CodeEditorWidget, host, {}, { contributions: [] }));
		editor.setModel(model);
		const instantiation = workbenchInstantiationService(undefined, store);
		let reloads = 0;
		const pending: { result: IOpenideReviewDiffResult; gate: DeferredPromise<IOpenideReviewDiffResult> }[] = [];
		instantiation.stub(IOpenideReviewDiffService, upcastPartial<IOpenideReviewDiffService>({ acquire: (model, baseline) => ({
			object: { compute: async () => {
				const result = { version: model.getVersionId(), changes: linesDiffComputers.getDefault().computeDiff(baseline.split('\n'), model.getLinesContent(), { ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false }).changes };
				if (!holdDiffs) { return result; }
				const gate = new DeferredPromise<IOpenideReviewDiffResult>(); pending.push({ result, gate });
				return gate.p;
			} },
			dispose: () => {},
		}) }));
		instantiation.stub(IEditorService, new class extends mock<IEditorService>() {
			override onDidActiveEditorChange = Event.None;
			override async openEditor() { await opening; return undefined; }
		});
		instantiation.stub(ICodeEditorService, new class extends mock<ICodeEditorService>() {
			override getFocusedCodeEditor = () => editor;
			override getActiveCodeEditor = () => editor;
			override listCodeEditors = () => [editor];
		});
		instantiation.stub(ITextFileService, new class extends mock<ITextFileService>() {
			override async save() { return model.uri; }
			override files = new class extends mock<ITextFileEditorModelManager>() {
				override get = () => undefined;
				override async resolve(): Promise<never> { reloads++; throw new Error('Test keeps the current in-memory model'); }
			};
		});
		const snapshot = instantiation.createInstance(OpenideDiffSnapshotProvider);
		snapshot.setBaselineOnce('test.ts', 'const oldValue = 0;', true);
		const review = store.add(instantiation.createInstance(OpenideEditReview, snapshot, {
			resolveUri: () => model.uri,
			revertFile: async () => {}, keepFile: async () => {}, notifyCounts: () => {},
		}));
		return { review, model, content, snapshot, host, editorServices, reloads: () => reloads,
			finishDiffs: async () => { for (const { result, gate } of pending.splice(0)) { await gate.complete(result); } await timeout(0); },
		};
	}

	test('scoped review decorates the requested pane when the IDE shows the same file', async () => {
		const h = create();
		const targetHost = document.body.appendChild(document.createElement('div'));
		store.add(toDisposable(() => targetHost.remove()));
		const targetEditor = store.add(h.editorServices.createInstance(CodeEditorWidget, targetHost, {}, { contributions: [] }));
		targetEditor.setModel(h.model);
		const pane = upcastPartial<IEditorPane>({ getControl: () => targetEditor });
		let opened = 0;
		const target = new class extends mock<IEditorService>() {
			override openEditor = (async () => { opened++; return pane; }) as IEditorService['openEditor'];
		};
		await h.review.openReview('test.ts', false, undefined, target);
		assert.deepStrictEqual({ opened, target: targetHost.querySelectorAll('.openide-review-header').length, primary: h.host.querySelectorAll('.openide-review-header').length }, { opened: 1, target: 1, primary: 0 });
	});

	test('large edits stay completely visible and finish without a character-by-character delay', async () => {
		const h = create();
		const started = performance.now();
		const following = h.review.openReview('test.ts', true, { startLine: 1, endLine: 500 });
		await timeout(0);
		assert.deepStrictEqual({ content: h.model.getValue(), hidden: h.model.getAllDecorations().some(decoration => decoration.options.inlineClassName?.includes('typewriter-hidden')) }, { content: h.content, hidden: false });
		await following;
		assert.ok(performance.now() - started < 1500, 'a 500-line edit must not replay seconds of simulated typing');
		assert.ok(h.snapshot.pendingPaths().includes('test.ts'), 'animation completion must preserve the pending review');
	});

	test('Zen off clears the transient highlight and keeps the persistent review', async () => {
		const h = create();
		const following = h.review.openReview('test.ts', true, { startLine: 1, endLine: 500 });
		await timeout(0);
		h.review.stopFollowing();
		assert.deepStrictEqual({ transient: h.model.getAllDecorations().some(decoration => decoration.options.description === 'openide-agent-edit-flash'), pending: h.snapshot.pendingPaths().includes('test.ts'), content: h.model.getValue() }, { transient: false, pending: true, content: h.content });
		await following;
	});

	test('Keep and Undo never use pending or stale hunk mappings', async () => {
		const h = create(undefined, true);
		await h.review.openReview('test.ts', false);
		h.review.runAction('undoBlock');
		assert.strictEqual(h.model.getValue(), h.content, 'initial pending diff cannot undo anything');
		await h.finishDiffs();
		h.model.setValue('a fresh edit');
		const baseline = h.snapshot.getBaseline('test.ts');
		h.review.runAction('undoBlock'); h.review.runAction('keepBlock');
		assert.deepStrictEqual({ text: h.model.getValue(), baseline: h.snapshot.getBaseline('test.ts') }, { text: 'a fresh edit', baseline });
		await timeout(150);
		h.model.setValue('a newer edit');
		await h.finishDiffs();
		assert.strictEqual(h.host.querySelector('.openide-review-block')?.getAttribute('aria-busy'), 'true', 'late diff cannot enable stale actions');
		await timeout(150); await h.finishDiffs();
		assert.strictEqual(h.host.querySelector('.openide-review-block')?.getAttribute('aria-busy'), 'false');
		h.review.runAction('keepBlock');
		assert.strictEqual(h.snapshot.getBaseline('test.ts'), 'a newer edit', 'a current hunk can be kept');
		await h.finishDiffs();
		assert.ok(!h.snapshot.pendingPaths().includes('test.ts'));
	});

	test('cancellation while opening an editor never starts a late reload or animation', async () => {
		const opening = new DeferredPromise<void>();
		const h = create(opening.p);
		const cancellation = new CancellationTokenSource();
		try {
			const following = h.review.openReview('test.ts', true, { startLine: 1, endLine: 500, token: cancellation.token });
			cancellation.cancel();
			await opening.complete();
			await following;
			assert.strictEqual(h.reloads(), 0);
		} finally { cancellation.dispose(); }
	});
});
