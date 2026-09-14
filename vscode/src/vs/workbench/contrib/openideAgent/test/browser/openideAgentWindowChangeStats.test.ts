/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { TextFileOperationError, TextFileOperationResult } from '../../../../services/textfile/common/textfiles.js';
import { ISCMResource, ISCMResourceGroup } from '../../../scm/common/scm.js';
import { collectAgentWindowSCMComparisons, resolveAgentWindowChangeStats, sumAgentWindowChangeStats } from '../../browser/openideAgentWindowChangeStats.js';

import { IOpenideReviewDiffService } from '../../browser/openideReviewDiffService.js';
import { countDiff } from '../../common/openideDiffPreview.js';

suite('Agent window Changes statistics', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const diffs = upcastPartial<IOpenideReviewDiffService>({ summarize: async (before, after) => ({ ...countDiff(before, after), lines: [] }) });
	const file = URI.file('/fixture/a.ts'), head = file.with({ scheme: 'git', query: 'HEAD' }), index = file.with({ scheme: 'git', query: 'index' });
	const resource = (original: URI | undefined, modified: URI | undefined) => upcastPartial<ISCMResource>({ sourceUri: file, multiDiffEditorOriginalUri: original, multiDiffEditorModifiedUri: modified });
	const group = (id: string, resources: ISCMResource[]) => upcastPartial<ISCMResourceGroup>({ id, resources });
	function models(values: Map<string, string>) {
		let disposed = 0;
		const service = upcastPartial<ITextModelService>({ createModelReference: (async (uri: URI) => {
			const value = values.get(uri.toString()); if (value === undefined) { throw new Error('Not a text model'); }
			return { object: upcastPartial<IResolvedTextEditorModel>({ textEditorModel: upcastPartial<ITextModel>({ getValue: () => value }) }), dispose: () => { disposed++; } };
		}) as ITextModelService['createModelReference'] });
		return { service, get disposed() { return disposed; } };
	}
	test('composes staged and working comparisons without counting the path twice', () => {
		const staged = resource(head, index), working = resource(index, file);
		const result = collectAgentWindowSCMComparisons([group('workingTree', [working]), group('index', [staged])]);
		assert.deepStrictEqual(result, [{ resource: working, original: head, modified: file }]);
	});
	test('staged addition subsequently edited still starts from an empty original', () => {
		assert.strictEqual(collectAgentWindowSCMComparisons([group('index', [resource(undefined, index)]), group('workingTree', [resource(index, file)])])[0].original, undefined);
	});
	test('totals include complete line changes and never treat unresolved files as zero', async () => {
		const mock = models(new Map([[head.toString(), 'old\nstable\n'], [file.toString(), 'new\nstable\nadded\n']]));
		const stats = await resolveAgentWindowChangeStats({ original: head, modified: file }, mock.service, CancellationToken.None, diffs);
		assert.deepStrictEqual(stats, { added: 2, removed: 1 }); assert.strictEqual(mock.disposed, 2);
		assert.deepStrictEqual(sumAgentWindowChangeStats([stats!, { added: 3, removed: 4 }]), { added: 5, removed: 5 });
		assert.strictEqual(sumAgentWindowChangeStats([stats!, {}]), undefined);
	});
	test('added and deleted resources resolve only their existing side', async () => {
		const mock = models(new Map([[file.toString(), 'one\ntwo\n']]));
		assert.deepStrictEqual(await resolveAgentWindowChangeStats({ original: undefined, modified: file }, mock.service, CancellationToken.None, diffs), { added: 2, removed: 0 });
		assert.deepStrictEqual(await resolveAgentWindowChangeStats({ original: file, modified: undefined }, mock.service, CancellationToken.None, diffs), { added: 0, removed: 2 });
		assert.strictEqual(mock.disposed, 2);
	});
	test('confirmed binary assets do not suppress known text totals or pretend to have text lines', async () => {
		const mock = models(new Map([[head.toString(), 'before']]));
		const service = upcastPartial<ITextModelService>({ createModelReference: uri => uri.toString() === file.toString()
			? Promise.reject(new TextFileOperationError('Binary resource', TextFileOperationResult.FILE_IS_BINARY))
			: mock.service.createModelReference(uri) });
		const binary = await resolveAgentWindowChangeStats({ original: head, modified: file }, service, CancellationToken.None, diffs);
		assert.deepStrictEqual(binary, { added: 0, removed: 0, binary: true });
		assert.strictEqual(mock.disposed, 1);
		assert.deepStrictEqual(sumAgentWindowChangeStats([{ added: 12, removed: 3 }, binary!]), { added: 12, removed: 3 });
		assert.strictEqual(sumAgentWindowChangeStats([{ added: 12, removed: 3 }, {}]), undefined, 'unknown errors remain unavailable');
	});
	test('cancellation and binary/unavailable resources never publish invented counts', async () => {
		const token = store.add(new CancellationTokenSource()); token.cancel();
		const mock = models(new Map());
		assert.strictEqual(await resolveAgentWindowChangeStats({ original: head, modified: file }, mock.service, token.token, diffs), undefined);
		assert.strictEqual(await resolveAgentWindowChangeStats({ original: undefined, modified: file }, mock.service, CancellationToken.None, diffs), undefined);
		assert.strictEqual(mock.disposed, 0);
	});
});
