/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../base/browser/ui/contextview/contextview.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { createMenuContent, createMenuRow, OpenideComposerPopover } from '../../openideAgent/browser/chat/openideComposerMenu.js';
import '../../openideAgent/browser/chat/media/openideChatMenus.css';
import './media/openideSettingsDropdown.css';

export interface IOpenideDropdownOption {
	readonly label: string;
	/** Right-aligned secondary text on the row (a description, a unit). */
	readonly detail?: string;
}

export interface IOpenideDropdownSelectEvent {
	readonly index: number;
}

/** Narrowest the list opens at, so a short current value does not produce a stubby menu. */
const MIN_MENU_WIDTH = 200;

/**
 * The options dropdown of a setting: a trigger that reads as a select, and the product's own
 * popover for the list — the one the chat's mode and model pickers open, with the same inset rows
 * and the trailing check on the current value.
 *
 * It replaces `SelectBox` in Settings. The native widget is a fine control, but its list is a
 * virtualised `List` skinned by the select-box stylesheet: a different container, a different row
 * geometry and a different hover from every other menu in the product, sitting in the surface where
 * the user compares them side by side. The trigger keeps the native widget's contract the rows rely
 * on (`onDidSelect`, `select`, `setEnabled`, `render`), so the callers only changed the class name.
 * Rows are real buttons (`createMenuRow`), so Enter and Space work in the list, and Escape closes
 * it through the context view like every other popover.
 */
export class OpenideSettingsDropdown extends Disposable {

	private readonly _onDidSelect = this._register(new Emitter<IOpenideDropdownSelectEvent>());
	readonly onDidSelect: Event<IOpenideDropdownSelectEvent> = this._onDidSelect.event;

	readonly domNode: HTMLButtonElement;
	private readonly _label: HTMLElement;
	private readonly _popover: OpenideComposerPopover;
	private _selected: number;
	private _enabled = true;

	constructor(
		private readonly _options: readonly IOpenideDropdownOption[],
		selected: number,
		contextViewService: IContextViewService,
		ariaLabel?: string,
	) {
		super();
		this._selected = Math.max(0, Math.min(selected, _options.length - 1));
		this._popover = this._register(new OpenideComposerPopover(contextViewService));

		this.domNode = $('button.openide-settings-dropdown', { type: 'button' }) as HTMLButtonElement;
		this.domNode.setAttribute('aria-haspopup', 'listbox');
		if (ariaLabel) {
			this.domNode.setAttribute('aria-label', ariaLabel);
		}
		this._label = append(this.domNode, $('span.openide-settings-dropdown-label'));
		// The select's up-down glyph. The codicon set has no chevron-up-down (only the fold/unfold
		// pair, which carries a bar), so the mark is two stacked chevrons in one span.
		const chevron = append(this.domNode, $('span.openide-settings-dropdown-chevron', { 'aria-hidden': 'true' }));
		append(chevron, $('span.codicon.codicon-chevron-up'));
		append(chevron, $('span.codicon.codicon-chevron-down'));
		this._paintLabel();

		this._register(addDisposableListener(this.domNode, 'click', () => {
			if (this._enabled) {
				this._open();
			}
		}));
	}

	get selected(): number { return this._selected; }

	render(host: HTMLElement): void {
		host.appendChild(this.domNode);
	}

	/** Moves the current value without firing: the caller is reflecting a change it already knows. */
	select(index: number): void {
		if (index < 0 || index >= this._options.length) {
			return;
		}
		this._selected = index;
		this._paintLabel();
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		this.domNode.disabled = !enabled;
		this.domNode.classList.toggle('disabled', !enabled);
	}

	private _paintLabel(): void {
		this._label.textContent = this._options[this._selected]?.label ?? '';
	}

	private _open(): void {
		this._popover.toggle(this.domNode, {
			className: 'openide-menu-settings-dropdown',
			anchorPosition: AnchorPosition.BELOW,
			anchorAlignment: AnchorAlignment.RIGHT,
			width: Math.max(MIN_MENU_WIDTH, this.domNode.offsetWidth),
			render: (container, store) => {
				const document = container.ownerDocument;
				const content = createMenuContent(document);
				container.appendChild(content);
				this._options.forEach((option, index) => {
					const row = createMenuRow(document, { label: option.label, detail: option.detail, active: index === this._selected });
					store.add(addDisposableListener(row, 'click', () => {
						this._popover.close();
						if (index !== this._selected) {
							this.select(index);
							this._onDidSelect.fire({ index });
						}
						this.domNode.focus();
					}));
					content.appendChild(row);
				});
			},
		});
	}
}
