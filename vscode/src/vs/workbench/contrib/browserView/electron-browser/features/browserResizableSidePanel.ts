/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Orientation, Sash, SashState } from '../../../../../base/browser/ui/sash/sash.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { BrowserEditor } from '../browserEditor.js';

/** Shared workbench-native shell for right-hand browser tools. */
export class BrowserResizableSidePanel extends Disposable {
	readonly element: HTMLElement;
	private readonly sash: Sash;
	private width: number;
	private startWidth = 0;

	constructor(
		private readonly editor: BrowserEditor,
		className: string,
		private readonly storageKey: string,
		private readonly defaultWidth: number,
		private readonly storageService: IStorageService,
		private readonly minWidth = 260,
	) {
		super();
		this.element = editor.window.document.createElement('section');
		this.element.className = `browser-side-panel ${className} hidden`;
		this.width = this.storageService.getNumber(storageKey, StorageScope.PROFILE, defaultWidth);

		this.sash = this._register(new Sash(this.element, {
			getVerticalSashLeft: () => 0,
			getVerticalSashHeight: () => this.element.offsetHeight,
		}, { orientation: Orientation.VERTICAL, size: 4 }));
		this.sash.state = SashState.Disabled;
		this._register(this.sash.onDidStart(() => this.startWidth = this.width));
		this._register(this.sash.onDidChange(event => {
			this.width = this.clamp(this.startWidth + event.startX - event.currentX);
			this.applyWidth();
			this.editor.layoutBrowserContainer();
		}));
		this._register(this.sash.onDidEnd(() => {
			this.storageService.store(this.storageKey, this.width, StorageScope.PROFILE, StorageTarget.USER);
		}));
		this._register(this.sash.onDidReset(() => {
			this.width = this.clamp(this.defaultWidth);
			this.applyWidth();
			this.storageService.store(this.storageKey, this.width, StorageScope.PROFILE, StorageTarget.USER);
			this.editor.layoutBrowserContainer();
		}));
	}

	get visible(): boolean {
		return !this.element.classList.contains('hidden');
	}

	setVisible(visible: boolean): void {
		this.element.classList.toggle('hidden', !visible);
		this.sash.state = visible ? SashState.Enabled : SashState.Disabled;
		if (visible) {
			this.width = this.clamp(this.width);
			this.applyWidth();
			this.sash.layout();
		}
		this.editor.window.requestAnimationFrame(() => this.editor.layoutBrowserContainer());
	}

	toggle(): void {
		this.setVisible(!this.visible);
	}

	private clamp(width: number): number {
		const parentWidth = this.element.parentElement?.clientWidth ?? this.editor.window.innerWidth;
		const siblingWidth = this.element.parentElement
			? [...this.element.parentElement.querySelectorAll<HTMLElement>('.browser-side-panel:not(.hidden)')]
				.filter(element => element !== this.element)
				.reduce((total, element) => total + element.offsetWidth, 0)
			: 0;
		const maxWidth = Math.max(this.minWidth, parentWidth - siblingWidth - 280);
		return Math.round(Math.min(Math.max(width, this.minWidth), maxWidth));
	}

	private applyWidth(): void {
		this.element.style.width = `${this.width}px`;
		this.element.style.flexBasis = `${this.width}px`;
	}
}
