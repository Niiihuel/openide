/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { BrowserViewCommandId } from '../../../../../platform/browserView/common/browserView.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, BROWSER_EDITOR_ACTIVE, BrowserActionCategory, CONTEXT_BROWSER_HAS_ERROR, CONTEXT_BROWSER_HAS_URL } from '../browserEditor.js';
import { BrowserResizableSidePanel } from './browserResizableSidePanel.js';

const CONTEXT_BROWSER_DEVTOOLS_VISIBLE = new RawContextKey<boolean>('browserDevToolsVisible', false, localize('browser.devToolsVisible', "Whether Chromium DevTools are docked in the integrated browser"));

/**
 * Reserves a workbench-owned, resizable split for Chromium's real DevTools frontend.
 * The actual surface is a native WebContentsView created in the main process; the host
 * element is intentionally empty and only supplies its layout bounds.
 */
export class BrowserDevToolsContribution extends BrowserEditorContribution {
	private readonly panel: BrowserResizableSidePanel;
	private readonly host = $('.browser-devtools-host');
	private readonly visibleContext: IContextKey<boolean>;
	private model: IBrowserViewModel | undefined;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService storageService: IStorageService,
	) {
		super(editor);
		this.panel = this._register(new BrowserResizableSidePanel(editor, 'browser-devtools-panel', 'browser.devTools.width', 520, storageService, 320));
		this.panel.element.appendChild(this.host);
		this.visibleContext = CONTEXT_BROWSER_DEVTOOLS_VISIBLE.bindTo(contextKeyService);
	}

	override get sidePanelElements(): readonly HTMLElement[] {
		return [this.panel.element];
	}

	override get devToolsElement(): HTMLElement {
		return this.host;
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.model = model;
		this.syncVisibility(model.isDevToolsOpen);
		store.add(model.onDidChangeDevToolsState(event => this.syncVisibility(event.isDevToolsOpen)));
	}

	override onModelDetached(): void {
		this.model = undefined;
		this.syncVisibility(false);
	}

	toggleVisible(): void {
		const model = this.model ?? this.editor.model;
		if (!model) {
			return;
		}

		const nextVisible = !model.isDevToolsOpen;
		this.syncVisibility(nextVisible);
		// Layout the native host before opening DevTools so the first rendered frame is docked.
		this.editor.window.requestAnimationFrame(() => {
			this.editor.layoutBrowserContainer();
			if (model.isDevToolsOpen !== nextVisible) {
				void model.toggleDevTools();
			}
		});
	}

	private syncVisibility(visible: boolean): void {
		this.panel.setVisible(visible);
		this.visibleContext.set(visible);
	}
}

BrowserEditor.registerContribution(BrowserDevToolsContribution);

class ToggleBrowserDevToolsAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.ToggleDevTools,
			title: localize2('browser.toggleDevToolsAction', 'Toggle Browser DevTools'),
			category: BrowserActionCategory,
			icon: Codicon.developerTools,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, CONTEXT_BROWSER_HAS_ERROR.negate()),
			toggled: CONTEXT_BROWSER_DEVTOOLS_VISIBLE,
			menu: { id: MenuId.BrowserActionsToolbar, group: 'actions', order: 3 },
			keybinding: { weight: KeybindingWeight.WorkbenchContrib, primary: KeyCode.F12 },
		});
	}

	run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): void {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserDevToolsContribution)?.toggleVisible();
		}
	}
}

registerAction2(ToggleBrowserDevToolsAction);
