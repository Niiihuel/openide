/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { $ } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { OpenideEmptyState } from '../../../../browser/openideEmptyState.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	IBrowserEditorWidget,
} from '../browserEditor.js';

/**
 * Welcome placeholder shown in the content area when no URL is loaded; hides
 * as soon as a URL appears and reappears when it's cleared.
 */
export class BrowserWelcomeFeature extends BrowserEditorContribution {

	private readonly _container: HTMLElement;
	private readonly _widget: IBrowserEditorWidget;

	constructor(
		editor: BrowserEditor,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(editor);

		this._container = $('.browser-welcome-container');
		this._register(instantiationService.createInstance(OpenideEmptyState, this._container, {
			title: localize('browser.welcomeTitle', "Browser"),
			description: localize('browser.welcomeSubtitle', "Enter a URL above to get started."),
		}));

		this._widget = { location: BrowserWidgetLocation.ContentArea, element: this._container, order: 50 };
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this._widget];
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this._setVisible(!input.url);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this._setVisible(!model.url);
		store.add(model.onDidNavigate(event => this._setVisible(!event.url)));
	}

	override onModelDetached(): void {
		this._setVisible(true);
	}

	private _setVisible(visible: boolean): void {
		this._container.style.display = visible ? '' : 'none';
	}
}

BrowserEditor.registerContribution(BrowserWelcomeFeature);
