/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { BrowserViewCommandId, IBrowserViewRect } from '../../../../../platform/browserView/common/browserView.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, CONTEXT_BROWSER_HAS_ERROR, CONTEXT_BROWSER_HAS_URL } from '../browserEditor.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionCategory, BrowserActionGroup } from '../browserViewActions.js';

class BrowserScreenshotContribution extends BrowserEditorContribution {
	private pickingArea = false;

	constructor(
		editor: BrowserEditor,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(editor);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidPickArea(rect => {
			if (!this.pickingArea) { return; }
			this.pickingArea = false;
			if (rect) { void this.captureSelection(model, rect); }
		}));
	}

	override onModelDetached(): void {
		this.pickingArea = false;
	}

	async takeScreenshot(): Promise<void> {
		const model = this.editor.model;
		if (model) {
			await this.save(await model.captureScreenshot({ format: 'png' }), 'viewport');
		}
	}

	captureArea(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}
		this.editor.ensureBrowserFocus();
		this.pickingArea = true;
		void model.toggleAreaSelection(true);
	}

	private async captureSelection(model: IBrowserViewModel, rect: IBrowserViewRect): Promise<void> {
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}
		await this.save(await model.captureScreenshot({ format: 'png', pageRect: rect, awaitNextPaint: true }), 'area');
	}

	private async save(buffer: VSBuffer, kind: 'viewport' | 'area'): Promise<void> {
		const defaultFolder = await this.fileDialogService.defaultFilePath(Schemas.file);
		const host = (() => {
			try { return new URL(this.editor.model?.url ?? '').hostname; } catch { return 'page'; }
		})();
		const destination = await this.fileDialogService.showSaveDialog({
			availableFileSystems: [Schemas.file],
			title: localize('browser.saveScreenshot', "Save Browser Screenshot"),
			saveLabel: localize('browser.saveScreenshotButton', "Save"),
			defaultUri: joinPath(defaultFolder, `${host || 'page'}-${kind}-${Date.now()}.png`),
			filters: [{ name: 'PNG', extensions: ['png'] }]
		});
		if (destination) {
			await this.fileService.writeFile(destination, buffer);
		}
	}
}

BrowserEditor.registerContribution(BrowserScreenshotContribution);

class TakeScreenshotAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.TakeScreenshot,
			title: localize2('browser.takeScreenshotAction', 'Take Screenshot'),
			category: BrowserActionCategory,
			icon: Codicon.deviceCamera,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL),
			menu: { id: MenuId.BrowserActionsToolbar, group: BrowserActionGroup.Page, order: 1 }
		});
	}

	async run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (browserEditor instanceof BrowserEditor) {
			await browserEditor.getContribution(BrowserScreenshotContribution)?.takeScreenshot();
		}
	}
}

class CaptureAreaScreenshotAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.CaptureAreaScreenshot,
			title: localize2('browser.captureAreaScreenshotAction', 'Capture Area Screenshot'),
			category: BrowserActionCategory,
			icon: Codicon.screenFull,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, CONTEXT_BROWSER_HAS_ERROR.negate()),
			menu: { id: MenuId.BrowserActionsToolbar, group: BrowserActionGroup.Page, order: 2 }
		});
	}

	run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): void {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserScreenshotContribution)?.captureArea();
		}
	}
}

registerAction2(TakeScreenshotAction);
registerAction2(CaptureAreaScreenshotAction);
