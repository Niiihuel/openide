/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IOpenideAgentService, IOpenidePickerGroup, IOpenidePickerModel } from '../openideAgentService.js';
import { availableReasoningEfforts } from './openideChatReasoning.js';
import { createMenuRow, createMenuSection } from './openideComposerMenu.js';
import { t } from '../../common/openideStrings.js';

const FLYOUT_GAP = 6;
const FLYOUT_PADDING = 8;

/**
 * The effort of ONE model, edited where that model lives.
 *
 * Cursor hangs this off the model row's "Edit", and that is the whole reason the composer no
 * longer carries an effort chip of its own: the level belongs to a model, so it is edited on the
 * model, and the control row gets one less thing to overflow with.
 *
 * A floating element rather than a second popover. `OpenideComposerPopover` goes through the
 * context view service, which holds ONE view at a time — opening this as a popover would close the
 * model picker it is anchored inside, taking its own anchor with it. So it is positioned in
 * viewport coordinates against the button, exactly like the model detail card (`openideChatModelDetail.ts`),
 * and parented to `.monaco-workbench` because that is the element the theme's custom properties
 * are published on.
 */
export class OpenideChatModelEffort extends Disposable {

	private _element: HTMLElement | undefined;
	private readonly _open = this._register(new DisposableStore());

	constructor(
		private readonly agentService: IOpenideAgentService,
		private readonly onDidChangeEffort: () => void,
	) {
		super();
	}

	get isOpen(): boolean {
		return !!this._element && !this._element.hidden;
	}

	/** `anchor` is the Edit button that opened it; the card is placed beside that button's row. */
	open(host: HTMLElement, anchor: HTMLElement, group: IOpenidePickerGroup, model: IOpenidePickerModel): void {
		const document = host.ownerDocument;
		this._open.clear();
		if (!this._element) {
			this._element = document.createElement('div');
			this._element.className = 'openide-mp-effort-flyout';
			(host.closest('.monaco-workbench') ?? document.body).appendChild(this._element);
		}
		const element = this._element;
		element.hidden = false;
		clearNode(element);
		element.appendChild(createMenuSection(document, t('chatSurface.effort.section')));
		const current = this.agentService.getReasoningEffort(group.id, model.id);
		// The group the picker loaded already carries what this model accepts; asking the catalog
		// again would be a second answer to the same question, free to disagree with the row.
		const levels = availableReasoningEfforts({ efforts: model.efforts, toggle: model.toggle });
		for (const [value, labelKey] of levels) {
			const row = createMenuRow(document, { label: t(labelKey), active: value === current });
			this._open.add(addDisposableListener(row, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.hide();
				void this.agentService.setReasoningEffort(value, group.id, model.id);
				this.onDidChangeEffort();
			}));
			// The click below is what selects a MODEL: swallowed here so editing a level never
			// doubles as choosing the row it hangs off.
			this._open.add(addDisposableListener(row, 'mousedown', event => event.stopPropagation()));
			element.appendChild(row);
		}

		const window = getWindow(host);
		// Capture, and on the window rather than the card: the popover's own rows stop propagation,
		// so a bubbling listener would never hear the click that should dismiss this.
		this._open.add(addDisposableListener(window, 'mousedown', (event: MouseEvent) => {
			if (!element.contains(event.target as Node) && event.target !== anchor) { this.hide(); }
		}, true));
		this._open.add(addDisposableListener(window, 'keydown', (event: KeyboardEvent) => {
			if (new StandardKeyboardEvent(event).equals(KeyCode.Escape)) {
				// Stopped: otherwise the same Escape closes the model picker underneath, and one
				// key press dismisses two surfaces.
				event.preventDefault();
				event.stopPropagation();
				this.hide();
			}
		}, true));

		this._place(host, anchor, element);
	}

	/**
	 * Beside the POPOVER, level with the row that opened it.
	 *
	 * Off the button it landed on top of the list it came from, hiding the models under the levels.
	 * The horizontal placement is the detail card's, verbatim (`openideChatModelDetail.ts`): clear
	 * the menu, flip to the other side when that would run off-screen. Which side it takes is then
	 * the same side the detail card takes, so the two never argue about the strip of screen next to
	 * the popover — the chat lives in the right dock, where that is usually the left one.
	 */
	private _place(host: HTMLElement, anchor: HTMLElement, element: HTMLElement): void {
		const window = getWindow(anchor);
		const hostRect = host.getBoundingClientRect();
		const rect = anchor.getBoundingClientRect();
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		let left = hostRect.right + FLYOUT_GAP;
		if (left + width > window.innerWidth - FLYOUT_PADDING) {
			left = hostRect.left - FLYOUT_GAP - width;
		}
		left = Math.max(FLYOUT_PADDING, Math.min(left, window.innerWidth - width - FLYOUT_PADDING));
		// Level with the row, not centred on it: the list is what the eye is on, and the first
		// level should read on the same line as the model it belongs to.
		let top = rect.top - 4;
		top = Math.max(FLYOUT_PADDING, Math.min(top, window.innerHeight - height - FLYOUT_PADDING));
		element.style.left = `${left}px`;
		element.style.top = `${top}px`;
	}

	hide(): void {
		this._open.clear();
		if (this._element) {
			this._element.hidden = true;
		}
	}

	override dispose(): void {
		this._element?.remove();
		this._element = undefined;
		super.dispose();
	}
}
