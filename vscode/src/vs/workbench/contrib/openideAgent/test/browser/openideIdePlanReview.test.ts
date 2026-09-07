/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService, Workspace, WorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { OpenideIdePlanReview } from '../../browser/openideIdePlanReview.js';

suite('OpenIDE IDE plan review ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function service(read: () => Promise<string> = async () => 'approved contents') {
		const files = new class extends mock<IFileService>() {
			override readonly onDidFilesChange = Event.None;
			override watch() { return Disposable.None; }
			override async readFile(): Promise<IFileContent> { return { value: VSBuffer.fromString(await read()) } as IFileContent; }
		};
		const context = new class extends mock<IWorkspaceContextService>() {
			override getWorkspace() { return new Workspace('review', [new WorkspaceFolder({ uri: URI.file('/workspace'), name: 'workspace', index: 0 })], false, null, () => false); }
		};
		const notifications = new class extends mock<INotificationService>() {
			override prompt(): INotificationHandle { return new class extends mock<INotificationHandle>() { override close(): void { } }; }
		};
		return store.add(new OpenideIdePlanReview(files, context, notifications, new NullLogService()));
	}

	test('cancelling one owner rejects its review while the other owner remains pending', async () => {
		const a = service(); const b = service(); const token = store.add(new CancellationTokenSource());
		const first = a.awaitDecision('.openide/plans/shared.md', 'plan', token.token);
		const second = b.awaitDecision('.openide/plans/shared.md', 'plan');
		token.cancel();
		assert.strictEqual((await first).reason, 'gone');
		assert.deepStrictEqual(b.pendingPlans, ['.openide/plans/shared.md']);
		await b.approve('.openide/plans/shared.md');
		assert.deepStrictEqual(await second, { approved: true, markdown: 'approved contents', reason: 'approved' });
	});

	test('an old approval completing after cancellation cannot approve a replacement review', async () => {
		let release!: (value: string) => void;
		const review = service(() => new Promise(resolve => { release = resolve; }));
		const token = store.add(new CancellationTokenSource());
		const first = review.awaitDecision('.openide/plans/shared.md', 'first', token.token);
		const approval = review.approve('.openide/plans/shared.md');
		token.cancel();
		const replacement = review.awaitDecision('.openide/plans/shared.md', 'replacement');
		release('old bytes'); await approval;
		assert.strictEqual((await first).reason, 'gone');
		assert.deepStrictEqual(review.pendingPlans, ['.openide/plans/shared.md']);
		review.reject('.openide/plans/shared.md');
		assert.strictEqual((await replacement).reason, 'rejected');
	});
	test('a late already-cancelled call cannot dismiss the live replacement review', async () => {
		const review = service(); const cancelled = store.add(new CancellationTokenSource()); cancelled.cancel();
		const live = review.awaitDecision('.openide/plans/shared.md', 'live');
		const stale = await review.awaitDecision('.openide/plans/shared.md', 'stale', cancelled.token);
		assert.strictEqual(stale.reason, 'gone');
		assert.deepStrictEqual(review.pendingPlans, ['.openide/plans/shared.md']);
		await review.approve('.openide/plans/shared.md');
		assert.strictEqual((await live).reason, 'approved');
	});

});
