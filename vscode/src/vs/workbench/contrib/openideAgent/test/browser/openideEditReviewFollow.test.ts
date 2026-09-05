/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { createCodeEditorServices } from '../../../../../editor/test/browser/testCodeEditor.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileEditorModelManager, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { OpenideDiffSnapshotProvider } from '../../browser/openideDiffSnapshot.js';
import { OpenideEditReview } from '../../browser/openideEditReview.js';

suite('OpenIDE EditReview follow', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(opening?: Promise<void>) {
		const content = Array.from({ length: 500 }, (_, i) => `const value${i} = ${i};`).join('\n');
		const model = store.add(createTextModel(content));
		const host = document.body.appendChild(document.createElement('div'));
		store.add(toDisposable(() => host.remove()));
		const editorServices = createCodeEditorServices(store);
		const editor = store.add(editorServices.createInstance(CodeEditorWidget, host, {}, { contributions: [] }));
		editor.setModel(model);
		const instantiation = workbenchInstantiationService(undefined, store);
		let reloads = 0;
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
		return { review, model, content, snapshot, reloads: () => reloads };
	}

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
