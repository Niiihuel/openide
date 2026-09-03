/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import './media/openideSettingsToggle.css';

/**
 * The on/off switch of a boolean setting.
 *
 * Why this is not upstream's `Checkbox` (docs/theming-surfaces.md, rule 4 says to prefer the native
 * widget): that widget IS a checkbox — a square box with a tick — and Settings, like the rest of
 * the product's surfaces and the editors it is measured against, shows a switch. What rule 4
 * protects is not the widget's name but its shape: ONE element that owns its border and its focus
 * ring, so nothing around it draws a second one. This control keeps exactly that: a single
 * `<button role="switch">` that paints its own track, knob and focus outline, with no wrapper
 * taking part. Being a real button, Space and Enter toggle it without a key handler, and
 * `aria-checked` carries the state to the reader.
 *
 * Only the knob's `transform` animates: painting the track colour or the size on every tick is
 * what made the old hand-rolled switch flicker under a theme change.
 */
export class OpenideSettingsToggle extends Disposable {

	private readonly _onChange = this._register(new Emitter<boolean>());
	readonly onChange: Event<boolean> = this._onChange.event;

	readonly domNode: HTMLButtonElement;
	private _checked: boolean;
	private _enabled = true;

	constructor(ariaLabel: string, checked: boolean) {
		super();
		this._checked = checked;
		this.domNode = $('button.openide-settings-toggle', { type: 'button', role: 'switch' }) as HTMLButtonElement;
		if (ariaLabel) {
			this.domNode.setAttribute('aria-label', ariaLabel);
		}
		append(this.domNode, $('span.openide-settings-toggle-knob'));
		this._paint();
		// A button already turns Space and Enter into a click, so one listener covers pointer and
		// keyboard alike.
		this._register(addDisposableListener(this.domNode, 'click', () => {
			if (!this._enabled) {
				return;
			}
			this.checked = !this._checked;
			this._onChange.fire(this._checked);
		}));
	}

	get checked(): boolean { return this._checked; }

	/** Reflects a value the caller already knows; does not fire. */
	set checked(value: boolean) {
		this._checked = value;
		this._paint();
	}

	enable(): void { this.setEnabled(true); }
	disable(): void { this.setEnabled(false); }

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		this.domNode.disabled = !enabled;
	}

	private _paint(): void {
		this.domNode.setAttribute('aria-checked', String(this._checked));
		this.domNode.classList.toggle('checked', this._checked);
	}
}
