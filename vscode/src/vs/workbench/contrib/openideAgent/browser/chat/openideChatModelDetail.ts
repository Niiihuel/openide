/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IOpenidePickerGroup, IOpenidePickerModel } from '../openideAgentService.js';

/** Delay before the panel appears, so sweeping the list with ↑↓ does not flash a card per row. */
const DETAIL_DELAY = 260;
const DETAIL_GAP = 8;
const DETAIL_PADDING = 8;

/** Viewport rect of the row being described. */
export interface IDetailAnchor {
	readonly top: number;
	readonly height: number;
}

function detailRow(document: Document, key: string, value: string): HTMLElement {
	const row = document.createElement('div');
	row.className = 'openide-mp-detail-row';
	const keyElement = document.createElement('span');
	keyElement.className = 'openide-mp-detail-key';
	keyElement.textContent = key;
	const valueElement = document.createElement('span');
	valueElement.className = 'openide-mp-detail-val';
	valueElement.textContent = value;
	row.append(keyElement, valueElement);
	return row;
}

/**
 * The side panel of the model picker.
 *
 * A sibling of the popover rather than a child: the menu is `overflow: hidden`, so a card rendered
 * inside it would be clipped by exactly the amount that makes it useful. It is positioned in
 * viewport coordinates because the chat lives in the right dock, where "to the right of the
 * popover" is frequently off-screen and the card has to flip.
 */
export class OpenideChatModelDetail extends Disposable {

	private _element: HTMLElement | undefined;
	private _timer: number | undefined;
	/** Kept beside the handle: the timer can be armed before the panel's element exists, and in an
	 *  auxiliary window `clearTimeout` has to be called on the same window that scheduled it. */
	private _timerWindow: Window | undefined;
	/** The panel only appears after a real interaction: opening the popover does not show it. */
	private _armed = false;

	arm(): void {
		this._armed = true;
	}

	disarm(): void {
		this._armed = false;
		this.hide();
	}

	/** Re-targets instantly once the panel is up; only the first show waits out the delay.
	 *  `anchor` is a viewport rect and not an element because the rows are virtualized: the DOM
	 *  node of the focused row can be recycled before the delay elapses. */
	schedule(host: HTMLElement, anchor: IDetailAnchor, group: IOpenidePickerGroup, model: IOpenidePickerModel): void {
		this._clearTimer();
		if (!this._armed) {
			this.hide();
			return;
		}
		if (this._element && !this._element.hidden) {
			this._show(host, anchor, group, model);
			return;
		}
		this._timerWindow = getWindow(host);
		this._timer = this._timerWindow.setTimeout(() => {
			this._timer = undefined;
			this._show(host, anchor, group, model);
		}, DETAIL_DELAY);
	}

	private _show(host: HTMLElement, anchor: IDetailAnchor, group: IOpenidePickerGroup, model: IOpenidePickerModel): void {
		const document = host.ownerDocument;
		if (!this._element) {
			this._element = document.createElement('div');
			this._element.className = 'openide-mp-detail';
			// Inside `.monaco-workbench` and NOT on `document.body`: the theme publishes every
			// `--vscode-*` custom property on that element (workbenchThemeService scopes the
			// generated rule to `.monaco-workbench`, which is a DIV inside the body, not the body).
			// Parented to the body the panel inherited none of them, so its background fell back to
			// `transparent` and the editor showed through it.
			(host.closest('.monaco-workbench') ?? document.body).appendChild(this._element);
		}
		const element = this._element;
		clearNode(element);
		// The exact id the provider is called with lives in the header: it is the one thing the
		// row's friendly name hides, and the panel replaced the native tooltip that used to carry it.
		const head = document.createElement('div');
		head.className = 'openide-mp-detail-head';
		const name = document.createElement('div');
		name.className = 'openide-mp-detail-name';
		name.textContent = model.name;
		const id = document.createElement('div');
		id.className = 'openide-mp-detail-id';
		id.textContent = `${group.label} · ${model.id}`;
		head.append(name, id);
		element.appendChild(head);
		const capabilities: string[] = [];
		if (model.toolCall) { capabilities.push(localize('openide.chat.model.tools', "Uso de herramientas")); }
		if (model.reasoning) { capabilities.push(localize('openide.chat.model.reasoning', "Razonamiento")); }
		if (capabilities.length) { element.appendChild(detailRow(document, localize('openide.chat.model.capabilities', "Capacidades"), capabilities.join(', '))); }
		if (model.input.length) { element.appendChild(detailRow(document, localize('openide.chat.model.input', "Entrada"), model.input.join(', '))); }
		if (model.output.length) { element.appendChild(detailRow(document, localize('openide.chat.model.output', "Salida"), model.output.join(', '))); }
		// Subscriptions and local runtimes publish no price: an "In — · Out —" row would read as
		// "free", so the row is omitted entirely.
		if (model.hasCost) { element.appendChild(detailRow(document, localize('openide.chat.model.cost', "Costo ($/1M tokens)"), `In ${model.costIn} · Out ${model.costOut}`)); }
		element.hidden = element.childElementCount <= 1;
		if (!element.hidden) {
			this._place(host, anchor, element);
		}
	}

	/** Centres on the ROW, not on the popover: a card bottom-aligned to the menu floated away from
	 *  the model it describes and the eye had to travel to connect them. */
	private _place(host: HTMLElement, anchor: IDetailAnchor, element: HTMLElement): void {
		const window = getWindow(host);
		const hostRect = host.getBoundingClientRect();
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		let left = hostRect.right + DETAIL_GAP;
		if (left + width > window.innerWidth - DETAIL_PADDING) {
			left = hostRect.left - DETAIL_GAP - width;
		}
		left = Math.max(DETAIL_PADDING, Math.min(left, window.innerWidth - width - DETAIL_PADDING));
		let top = anchor.top + (anchor.height / 2) - (height / 2);
		top = Math.max(DETAIL_PADDING, Math.min(top, window.innerHeight - height - DETAIL_PADDING));
		element.style.left = `${left}px`;
		element.style.top = `${top}px`;
	}

	hide(): void {
		this._clearTimer();
		if (this._element) {
			this._element.hidden = true;
		}
	}

	private _clearTimer(): void {
		if (this._timer !== undefined) {
			this._timerWindow?.clearTimeout(this._timer);
		}
		this._timer = undefined;
	}

	override dispose(): void {
		this._clearTimer();
		this._element?.remove();
		this._element = undefined;
		super.dispose();
	}
}
