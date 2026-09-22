/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService, IModalEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService, IEditorsChangeEvent } from '../../../../services/editor/common/editorService.js';
import { OpenideAgentWindowEditors } from '../../browser/openideAgentWindowEditors.js';

suite('OpenIDE agent window editors', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('closing an expanded view leaves the docked editor and its tabs in place', async () => {
		const input = upcastPartial<EditorInput>({});
		const group = upcastPartial<IEditorGroup>({ focus: () => undefined });
		const dockEmbedding: unknown[] = [];
		const dockAdded = store.add(new Emitter<IEditorGroup>());
		const dockRemoved = store.add(new Emitter<IEditorGroup>());
		const dockDisposing = store.add(new Emitter<void>());
		const modalDisposing = store.add(new Emitter<void>());
		const dock = upcastPartial<IModalEditorPart>({
			modalElement: document.createElement('div'), embedded: true, activeGroup: group, groups: [group],
			setEmbeddedContainer: (host: unknown) => { dockEmbedding.push(host); },
			setEmbeddedVisible: () => undefined,
			onDidAddGroup: dockAdded.event, onDidRemoveGroup: dockRemoved.event, onWillDispose: dockDisposing.event,
			close: async () => { dockDisposing.fire(); return true; },
		});
		let modalClosed = false;
		const modal = upcastPartial<IModalEditorPart>({
			modalElement: document.createElement('div'), embedded: false, activeGroup: group, groups: [group],
			onWillDispose: modalDisposing.event,
			requestClose: async () => { modalClosed = true; modalDisposing.fire(); return true; },
			close: async () => { modalClosed = true; modalDisposing.fire(); return true; },
		});
		const editorsChanged = store.add(new Emitter<IEditorsChangeEvent>());
		const activeChanged = store.add(new Emitter<void>());
		const openedInModal: EditorInput[] = [];
		const dockService = upcastPartial<IEditorService>({
			editors: [input], activeEditor: input,
			onDidEditorsChange: editorsChanged.event, onDidActiveEditorChange: activeChanged.event,
		});
		const modalService = upcastPartial<IEditorService>({ openEditor: (async (editor: EditorInput) => { openedInModal.push(editor); return undefined; }) as IEditorService['openEditor'] });
		let creations = 0;
		const groups = upcastPartial<IEditorGroupsService>({ createModalEditorPart: async () => ++creations === 1 ? dock : modal });
		const service = upcastPartial<IEditorService>({ createScoped: (part: IModalEditorPart) => part === dock ? dockService : modalService });
		const auxiliary = upcastPartial<IAuxiliaryWindowService>({ getWindow: () => undefined });
		const editors = store.add(new OpenideAgentWindowEditors(999, groups, service, auxiliary));
		const host = document.createElement('div');
		editors.configureDock(host, () => undefined);
		await editors.getEditorService();
		await editors.showModal();
		assert.deepStrictEqual(openedInModal, [input]);
		assert.deepStrictEqual(dockEmbedding, [host], 'expanding must not detach the dock into a modal');
		assert.strictEqual(editors.isModal, true);
		await editors.dock();
		assert.strictEqual(modalClosed, true);
		assert.strictEqual(editors.isModal, false);
		assert.deepStrictEqual(editors.tabs, [input]);
		assert.deepStrictEqual(dockEmbedding, [host], 'dismissing the modal must not remount the dock');
	});
});
