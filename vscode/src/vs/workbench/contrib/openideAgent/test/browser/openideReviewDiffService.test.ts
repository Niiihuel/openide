/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { linesDiffComputers } from '../../../../../editor/common/diff/linesDiffComputers.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IDocumentDiff } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { OpenideReviewDiffService } from '../../browser/openideReviewDiffService.js';

suite('OpenIDE review worker diff', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function create() {
		const models = new Map<string, ITextModel>();
		const pending: { complete: () => Promise<void>; fail: () => Promise<void>; incomplete: () => Promise<void> }[] = [];
		let calls = 0;
		const service = store.add(new OpenideReviewDiffService(new class extends mock<IEditorWorkerService>() {
			override computeDiff: IEditorWorkerService['computeDiff'] = async (original, modified, options, algorithm) => {
				calls++;
				assert.strictEqual(algorithm, 'advanced');
				assert.strictEqual(options.ignoreTrimWhitespace, false);
				const before = models.get(original.toString())!.getLinesContent();
				const after = models.get(modified.toString())!.getLinesContent();
				const result: IDocumentDiff = { ...linesDiffComputers.getDefault().computeDiff(before, after, options), identical: before.join('\n') === after.join('\n'), quitEarly: false };
				const gate = new DeferredPromise<IDocumentDiff>();
				pending.push({ complete: () => gate.complete(result), fail: () => gate.error(new Error('Worker failed')), incomplete: () => gate.complete({ ...result, quitEarly: true }) });
				return gate.p;
			};
		}(), new class extends mock<IModelService>() {
			override createModel: IModelService['createModel'] = (value, _language, resource) => {
				const model = createTextModel(value, null, undefined, resource);
				models.set(model.uri.toString(), model);
				return model;
			};
		}()));
		const model = store.add(createTextModel('new\nunchanged\n'));
		models.set(model.uri.toString(), model);
		return { service, model, pending, calls: () => calls, liveSnapshots: () => [...models.values()].filter(m => m !== model && !m.isDisposed()).length };
	}

	test('both surfaces share an in-flight diff and cache the exact model version', async () => {
		const h = create();
		const first = store.add(h.service.acquire(h.model, 'old\nunchanged\n'));
		const second = store.add(h.service.acquire(h.model, 'old\nunchanged\n'));
		const a = first.object.compute(CancellationToken.None), b = second.object.compute(CancellationToken.None);
		await h.pending.shift()!.complete();
		const result = await a;
		assert.strictEqual(await b, result);
		assert.strictEqual(await second.object.compute(CancellationToken.None), result);
		assert.deepStrictEqual({ calls: h.calls(), hunks: result?.changes.length }, { calls: 1, hunks: 1 });
		first.dispose();
		assert.strictEqual(h.liveSnapshots(), 1);
		second.dispose();
		assert.strictEqual(h.liveSnapshots(), 0);
	});

	test('obsolete active and queued versions cannot publish or reach the worker', async () => {
		const h = create();
		const diff = store.add(h.service.acquire(h.model, 'old\nunchanged\n'));
		const old = diff.object.compute(CancellationToken.None);
		h.model.setValue('second');
		const superseded = diff.object.compute(CancellationToken.None);
		h.model.setValue('third');
		const latest = diff.object.compute(CancellationToken.None);
		await h.pending.shift()!.complete();
		assert.strictEqual(await old, undefined);
		assert.strictEqual(await superseded, undefined);
		await h.pending.shift()!.complete();
		assert.deepStrictEqual({ calls: h.calls(), version: (await latest)?.version }, { calls: 2, version: h.model.getVersionId() });
	});

	test('one cancelled consumer does not cancel a shared diff', async () => {
		const h = create();
		const diff = store.add(h.service.acquire(h.model, 'old'));
		const token = store.add(new CancellationTokenSource());
		const cancelled = diff.object.compute(token.token);
		const visible = diff.object.compute(CancellationToken.None);
		token.cancel();
		assert.strictEqual(await cancelled, undefined);
		await h.pending.shift()!.complete();
		assert.ok(await visible);
		assert.strictEqual(h.calls(), 1);
	});

	test('released rows and disposed models discard pending work and release snapshots', async () => {
		const h = create();
		const first = store.add(h.service.acquire(h.model, 'old'));
		const second = store.add(h.service.acquire(h.model, 'other baseline'));
		const running = first.object.compute(CancellationToken.None), queued = second.object.compute(CancellationToken.None);
		second.dispose(); h.model.dispose();
		await h.pending.shift()!.complete();
		assert.deepStrictEqual(await Promise.all([running, queued]), [undefined, undefined]);
		assert.deepStrictEqual({ calls: h.calls(), snapshots: h.liveSnapshots() }, { calls: 1, snapshots: 0 });
	});

	test('incomplete or failed workers never resolve a file as clean, and can retry', async () => {
		const h = create();
		const diff = store.add(h.service.acquire(h.model, 'old'));
		const incomplete = diff.object.compute(CancellationToken.None);
		await h.pending.shift()!.incomplete();
		assert.strictEqual(await incomplete, undefined);
		const failed = diff.object.compute(CancellationToken.None);
		const rejected = assert.rejects(failed, /Worker failed/);
		await h.pending.shift()!.fail(); await rejected;
		const retry = diff.object.compute(CancellationToken.None);
		await h.pending.shift()!.complete();
		assert.ok((await retry)?.changes.length);
	});

	test('created and empty files never invent a removed line or call the worker', async () => {
		const h = create();
		const diff = store.add(h.service.acquire(h.model, ''));
		assert.deepStrictEqual((await diff.object.compute(CancellationToken.None))?.changes.map(c => [c.original.length, c.modified.length]), [[0, 3]]);
		h.model.setValue('');
		assert.deepStrictEqual((await diff.object.compute(CancellationToken.None))?.changes, []);
		assert.strictEqual(h.calls(), 0);
	});

	test('snapshot counts and bounded previews share one computation and release temporary models', async () => {
		const h = create();
		const after = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n');
		const summary = h.service.summarize('before', after, CancellationToken.None, 120);
		await h.pending.shift()!.complete();
		const result = await summary;
		assert.deepStrictEqual({ added: result?.added, removed: result?.removed, rows: result?.lines.length, calls: h.calls(), snapshots: h.liveSnapshots() }, { added: 10000, removed: 1, rows: 120, calls: 1, snapshots: 0 });
	});

	test('creation and deletion summaries retain Git newline counts', async () => {
		const h = create();
		assert.deepStrictEqual(await h.service.summarize('', 'one\r\ntwo\r\n', CancellationToken.None), { added: 2, removed: 0, lines: [] });
		assert.deepStrictEqual(await h.service.summarize('one\n', '', CancellationToken.None), { added: 0, removed: 1, lines: [] });
		assert.strictEqual(h.liveSnapshots(), 0);
	});
});
