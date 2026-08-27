/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the widgets of the visual style editor.
 *
 *  One control per `StyleControlKind` in `common/openideStyleModel.ts`, each one a small class with
 *  the same shape: it takes a value, it renders something a person can manipulate, and it fires
 *  `onDidChange` with the CSS value the property should take. The panel knows nothing about how a
 *  colour or a length is edited — it reads the catalog and asks for the matching control — so
 *  adding a property is an entry in the catalog, never a new branch in the panel.
 *
 *  Everything here is written for this fork: the reference tools in refs/ are Apache-2.0 and are
 *  read as INTERACTION references only. The pieces that are not ours are the workbench's own
 *  (`SelectBox`, `InputBox`, codicons), which are MIT and already part of this tree.
 *
 *  On the colour control specifically: it is a swatch that opens a popover with the value as text,
 *  a row of swatches taken from the element itself, and the OS picker behind `input[type=color]`.
 *  A native input alone would have been fewer lines and worse — it cannot express `rgba()`, and
 *  every colour on a real page has an alpha.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { formatLength, IStylePropertyDef, parseLength } from '../common/openideStyleModel.js';
import { t } from '../common/openideStrings.js';

export interface IStyleControl {
	readonly onDidChange: Event<string>;
	/** Re-renders from a value the panel owns (an undo, a new pick, a reset). */
	setValue(value: string): void;
	readonly element: HTMLElement;
}

abstract class StyleControlBase extends Disposable implements IStyleControl {
	protected readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange = this._onDidChange.event;
	abstract readonly element: HTMLElement;
	abstract setValue(value: string): void;
}

/**
 * A number with a unit. The number is a real `input[type=number]`, so the keyboard's arrows and the
 * scroll wheel step it — that is most of what "editable, not plain text" means for a padding.
 */
export class StyleLengthControl extends StyleControlBase {

	readonly element: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly unit: HTMLSelectElement;
	/** Kept verbatim so `auto` / `calc(…)` survive a round trip through the control. */
	private keyword: string | undefined;

	constructor(def: IStylePropertyDef) {
		super();
		this.element = $('.openide-style-control.openide-style-length');
		this.input = append(this.element, $('input.openide-style-number', { type: 'number', 'aria-label': t('style.value') })) as HTMLInputElement;
		if (def.min !== undefined) { this.input.min = String(def.min); }
		if (def.max !== undefined) { this.input.max = String(def.max); }
		this.input.step = String(def.step ?? 1);
		this.unit = append(this.element, $('select.openide-style-unit', { 'aria-label': t('style.unit') })) as HTMLSelectElement;
		for (const unit of def.units ?? ['px']) {
			append(this.unit, $('option', { value: unit }, unit));
		}
		this._register(addDisposableListener(this.input, 'input', () => this.emit()));
		this._register(addDisposableListener(this.unit, 'change', () => this.emit()));
	}

	private emit(): void {
		const amount = Number(this.input.value);
		if (this.input.value.trim() === '' || !Number.isFinite(amount)) {
			// Emptying the field means "leave it to the stylesheet", not "zero".
			this._onDidChange.fire(this.keyword ?? '');
			return;
		}
		this.keyword = undefined;
		this._onDidChange.fire(formatLength(amount, this.unit.value));
	}

	setValue(value: string): void {
		const parsed = parseLength(value);
		if (parsed) {
			this.keyword = undefined;
			this.input.value = String(parsed.amount);
			// A unit the catalog does not offer still has to be shown, or changing an unrelated
			// property would silently rewrite this one.
			if (![...this.unit.options].some(option => option.value === parsed.unit)) {
				append(this.unit, $('option', { value: parsed.unit }, parsed.unit));
			}
			this.unit.value = parsed.unit;
			this.element.classList.remove('keyword');
			this.input.title = '';
			return;
		}
		// `auto`, `normal`, `calc(...)`: shown as a badge instead of being forced into the stepper.
		this.keyword = value;
		this.input.value = '';
		this.input.placeholder = value || '—';
		this.input.title = value;
		this.element.classList.toggle('keyword', !!value);
	}
}

/** A plain unitless number: opacity, line-height. */
export class StyleNumberControl extends StyleControlBase {

	readonly element: HTMLElement;
	private readonly input: HTMLInputElement;

	constructor(def: IStylePropertyDef) {
		super();
		this.element = $('.openide-style-control.openide-style-numeric');
		this.input = append(this.element, $('input.openide-style-number', { type: 'number', 'aria-label': t('style.value') })) as HTMLInputElement;
		if (def.min !== undefined) { this.input.min = String(def.min); }
		if (def.max !== undefined) { this.input.max = String(def.max); }
		this.input.step = String(def.step ?? 1);
		this._register(addDisposableListener(this.input, 'input', () => this._onDidChange.fire(this.input.value.trim())));
	}

	setValue(value: string): void {
		const amount = Number(String(value ?? '').trim());
		this.input.value = Number.isFinite(amount) ? String(amount) : '';
		this.input.placeholder = Number.isFinite(amount) ? '' : (value || '—');
		this.input.title = Number.isFinite(amount) ? '' : String(value ?? '');
	}
}

/** One of a fixed set of keywords. */
export class StyleChoiceControl extends StyleControlBase {

	readonly element: HTMLElement;
	private readonly select: HTMLSelectElement;

	constructor(private readonly def: IStylePropertyDef) {
		super();
		this.element = $('.openide-style-control.openide-style-choice');
		this.select = append(this.element, $('select.openide-style-select', { 'aria-label': t('style.value') })) as HTMLSelectElement;
		for (const choice of def.choices ?? []) {
			append(this.select, $('option', { value: choice }, choice));
		}
		this._register(addDisposableListener(this.select, 'change', () => this._onDidChange.fire(this.select.value)));
	}

	setValue(value: string): void {
		const current = String(value ?? '').trim();
		// The computed value can be a keyword the catalog does not list (`display: table-cell`).
		// Adding it keeps the control honest about what the element actually is.
		if (current && !(this.def.choices ?? []).includes(current) && ![...this.select.options].some(option => option.value === current)) {
			this.select.insertBefore($('option', { value: current }, current), this.select.firstChild);
		}
		this.select.value = current;
	}
}

/** The escape hatch: box-shadow, transform, font-family. */
export class StyleTextControl extends StyleControlBase {

	readonly element: HTMLElement;
	private readonly input: HTMLInputElement;

	constructor() {
		super();
		this.element = $('.openide-style-control.openide-style-text');
		this.input = append(this.element, $('input.openide-style-input', { type: 'text', spellcheck: 'false', 'aria-label': t('style.value') })) as HTMLInputElement;
		this._register(addDisposableListener(this.input, 'input', () => this._onDidChange.fire(this.input.value.trim())));
	}

	setValue(value: string): void {
		this.input.value = String(value ?? '');
		this.input.title = this.input.value;
	}
}

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, .5)` / `#rrggbb[aa]` → the `#rrggbb` an OS picker understands. */
export function colorToHex(value: string): string | undefined {
	const raw = String(value ?? '').trim().toLowerCase();
	const hex = /^#([0-9a-f]{3,8})$/.exec(raw);
	if (hex) {
		const digits = hex[1];
		if (digits.length === 3) { return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`; }
		if (digits.length >= 6) { return `#${digits.slice(0, 6)}`; }
		return undefined;
	}
	const rgb = /^rgba?\(([^)]+)\)$/.exec(raw);
	if (!rgb) { return undefined; }
	const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
	if (parts.length < 3 || parts.slice(0, 3).some(part => !Number.isFinite(part))) { return undefined; }
	const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
	return `#${channel(parts[0])}${channel(parts[1])}${channel(parts[2])}`;
}

/** The alpha of an `rgba()`, so switching colour through the OS picker does not drop transparency. */
export function colorAlpha(value: string): number {
	const rgb = /^rgba?\(([^)]+)\)$/.exec(String(value ?? '').trim().toLowerCase());
	if (!rgb) { return 1; }
	const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
	return parts.length >= 4 && Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1;
}

export function hexWithAlpha(hex: string, alpha: number): string {
	const match = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!match || alpha >= 1) { return hex; }
	const digits = match[1];
	const channel = (index: number) => parseInt(digits.slice(index * 2, index * 2 + 2), 16);
	return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${Math.round(alpha * 100) / 100})`;
}

/**
 * A colour: the swatch shows it, the field states it exactly (the only way to write `rgba()` or a
 * variable), and the OS picker behind the swatch is there for choosing rather than typing. The
 * alpha slider is separate because a colour picker that silently drops alpha is worse than none.
 */
export class StyleColorControl extends StyleControlBase {

	readonly element: HTMLElement;
	private readonly swatch: HTMLInputElement;
	private readonly field: HTMLInputElement;
	private readonly alpha: HTMLInputElement;
	private current = '';

	constructor() {
		super();
		this.element = $('.openide-style-control.openide-style-color');
		// `input[type=color]` IS the OS picker — the workbench has no standalone colour widget, and
		// reimplementing a hue/saturation canvas would be a worse picker than the platform's.
		this.swatch = append(this.element, $('input.openide-style-swatch', { type: 'color', 'aria-label': t('style.pickColor') })) as HTMLInputElement;
		this.field = append(this.element, $('input.openide-style-input.openide-style-colorvalue', { type: 'text', spellcheck: 'false', 'aria-label': t('style.value') })) as HTMLInputElement;
		this.alpha = append(this.element, $('input.openide-style-alpha', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': t('style.alpha') })) as HTMLInputElement;

		this._register(addDisposableListener(this.swatch, 'input', () => {
			// Keep whatever alpha the element already had: picking a hue is not a request for opacity.
			this.current = hexWithAlpha(this.swatch.value, Number(this.alpha.value));
			this.field.value = this.current;
			this._onDidChange.fire(this.current);
		}));
		this._register(addDisposableListener(this.field, 'input', () => {
			this.current = this.field.value.trim();
			this.syncSwatch(this.current);
			this._onDidChange.fire(this.current);
		}));
		this._register(addDisposableListener(this.alpha, 'input', () => {
			const hex = colorToHex(this.current) ?? this.swatch.value;
			this.current = hexWithAlpha(hex, Number(this.alpha.value));
			this.field.value = this.current;
			this._onDidChange.fire(this.current);
		}));
	}

	private syncSwatch(value: string): void {
		const hex = colorToHex(value);
		if (hex) { this.swatch.value = hex; }
		this.alpha.value = String(colorAlpha(value));
		// `transparent`, `currentColor` and CSS variables have no swatch; say so instead of lying
		// with a black square.
		this.element.classList.toggle('unresolved', !hex);
	}

	setValue(value: string): void {
		this.current = String(value ?? '').trim();
		this.field.value = this.current;
		this.field.title = this.current;
		this.syncSwatch(this.current);
	}
}

export function createStyleControl(def: IStylePropertyDef): IStyleControl & Disposable {
	switch (def.control) {
		case 'color': return new StyleColorControl();
		case 'length': return new StyleLengthControl(def);
		case 'number': return new StyleNumberControl(def);
		case 'choice': return new StyleChoiceControl(def);
		case 'text': return new StyleTextControl();
	}
}
