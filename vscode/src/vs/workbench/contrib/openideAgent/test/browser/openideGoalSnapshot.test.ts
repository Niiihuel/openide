/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { OPENIDE_GOAL_SNAPSHOT_SCHEME, OpenideGoalSnapshotService } from '../../browser/openideGoalSnapshot.js';

suite('OpenIDE Goal readonly snapshots', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('both diff resources resolve to readonly editor models and preserve their distinct contents', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(IFileService, 'readFile', async (resource: URI) => ({ value: VSBuffer.fromString(resource.path.endsWith('.before.txt') ? 'before' : 'after') }));
		const provider = store.add(instantiation.createInstance(OpenideGoalSnapshotService));
		const original = provider.resource('goal-id', 'file.before.txt', 'src/file.ts', 'before');
		const modified = provider.resource('goal-id', 'file.after.txt', 'src/file.ts', 'after');
		const models = [];
		for (const resource of [original, modified]) {
			await provider.provideTextContent(resource);
			const input = store.add(instantiation.createInstance(TextResourceEditorInput, resource, undefined, undefined, undefined, undefined));
			const model = store.add(await input.resolve());
			models.push({ scheme: resource.scheme, readonly: model.isReadonly(), text: model.textEditorModel?.getValue() });
		}
		assert.deepStrictEqual(models, [
			{ scheme: OPENIDE_GOAL_SNAPSHOT_SCHEME, readonly: true, text: 'before' },
			{ scheme: OPENIDE_GOAL_SNAPSHOT_SCHEME, readonly: true, text: 'after' },
		]);
	});

	test('refuses replaced snapshots and private-path traversal rather than showing different contents', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		let reads = 0;
		instantiation.stub(IFileService, 'readFile', async () => { reads++; return { value: VSBuffer.fromString('changed after selection') }; });
		const provider = store.add(instantiation.createInstance(OpenideGoalSnapshotService));
		const resource = provider.resource('goal-id', 'file.after.txt', 'src/file.ts', 'selected content');
		await assert.rejects(provider.provideTextContent(resource), /snapshot changed/);
		const reference = JSON.parse(resource.query);
		await assert.rejects(provider.provideTextContent(resource.with({ query: JSON.stringify({ ...reference, fileName: '../../secret.after.txt' }) })), /Invalid goal snapshot/);
		assert.strictEqual(reads, 1);
	});
});
