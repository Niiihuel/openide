/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, getActiveWindow } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { BrowserViewWorkbenchService } from '../../electron-browser/browserViewWorkbenchService.js';

suite('Browser preview focus', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('companion preview uses its scoped editor and rejects a closed presentation', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(INativeWorkbenchEnvironmentService, { userHome: URI.file('/test-home') });
		instantiation.stub(IWorkspaceTrustManagementService, 'getTrustedUris', () => []);
		instantiation.stub(IWorkspaceTrustEnablementService, { isWorkspaceTrustEnabled: () => true });
		instantiation.stub(IPlaywrightService, { onDidChangeActivity: Event.None } as IPlaywrightService);
		let primaryOpens = 0;
		let companionOpens = 0;
		instantiation.stub(IEditorService, new class extends mock<IEditorService>() {
			override async openEditor() { primaryOpens++; return undefined; }
		});
		const target = new class extends mock<IEditorService>() {
			override async openEditor() { companionOpens++; return undefined; }
		};
		const channel: IChannel = { listen: () => Event.None, call: async <T>(command: string) => (command === 'getBrowserViews' ? [] : undefined) as T };
		instantiation.stub(IMainProcessService, new class extends mock<IMainProcessService>() { override getChannel(): IChannel { return channel; } });
		const service = store.add(instantiation.createInstance(BrowserViewWorkbenchService));
		const input = store.add(service.getOrCreatePreview('http://localhost:3000'));
		const targetWindowId = getActiveWindow().vscodeWindowId + 100;
		const registration = store.add(service.registerPreviewEditorTarget(targetWindowId, async () => target));
		assert.strictEqual(await service.openPreview(undefined, undefined, { targetWindowId }), input);
		registration.dispose();
		await assert.rejects(service.openPreview(undefined, undefined, { targetWindowId }), /preview window has closed/);
		const pending = new DeferredPromise<IEditorService>();
		const closing = store.add(service.registerPreviewEditorTarget(targetWindowId, () => pending.p));
		const lateOpen = service.openPreview(undefined, undefined, { targetWindowId });
		closing.dispose();
		await pending.complete(target);
		await lateOpen;
		assert.deepStrictEqual({ primaryOpens, companionOpens }, { primaryOpens: 0, companionOpens: 1 });
	});

	for (const preserveFocus of [true, false]) {
		test(preserveFocus ? 'automation keeps the draft selection while navigating and following' : 'manual preview opening still focuses the editor', async () => {
			const host = document.body.appendChild($('div'));
			store.add(toDisposable(() => host.remove()));
			const composer = host.appendChild(document.createElement('textarea'));
			const browser = host.appendChild(document.createElement('button'));
			composer.value = 'Continue writing here';
			composer.focus();
			composer.setSelectionRange(4, 9);
			const instantiation = workbenchInstantiationService(undefined, store);
			instantiation.stub(INativeWorkbenchEnvironmentService, { userHome: URI.file('/test-home') });
			instantiation.stub(IWorkspaceTrustManagementService, 'getTrustedUris', () => []);
			instantiation.stub(IWorkspaceTrustEnablementService, { isWorkspaceTrustEnabled: () => true });
			instantiation.stub(IPlaywrightService, { onDidChangeActivity: Event.None } as IPlaywrightService);
			const opens: (IEditorOptions | undefined)[] = [];
			instantiation.stub(IEditorService, new class extends mock<IEditorService>() {
				override async openEditor(_input: unknown, optionsOrGroup?: unknown): Promise<undefined> {
					const options = optionsOrGroup as IEditorOptions | undefined;
					opens.push(options);
					if (!options?.preserveFocus) { browser.focus(); }
					return undefined;
				}
			});
			const channel: IChannel = { listen: () => Event.None, call: async <T>(command: string) => (command === 'getBrowserViews' ? [] : undefined) as T };
			instantiation.stub(IMainProcessService, new class extends mock<IMainProcessService>() { override getChannel(): IChannel { return channel; } });
			const service = store.add(instantiation.createInstance(BrowserViewWorkbenchService));
			const options = preserveFocus ? { preserveFocus: true } : undefined;
			const input = await service.openPreview('http://localhost:3000', undefined, options);
			store.add(input);
			assert.strictEqual(await service.openPreview(undefined, undefined, options), input);
			assert.strictEqual(opens.length, 2);
			assert.ok(opens.every(open => !!open?.preserveFocus === preserveFocus));
			assert.strictEqual(document.activeElement, preserveFocus ? composer : browser);
			assert.deepStrictEqual([composer.value, composer.selectionStart, composer.selectionEnd], ['Continue writing here', 4, 9]);
		});
	}
});
