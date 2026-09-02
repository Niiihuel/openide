/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the manipulable controls of the CSS inspector.
 *
 *  The inspector edits a property with a text field unless it is an enumeration (a select) or a
 *  colour (a swatch). That is a fine floor and a poor ceiling: a padding typed as `12px` is still
 *  text, and text is the thing this panel exists NOT to be. These are the three controls that turn
 *  the rest into direct manipulation, and they are the ones the fork's own style editor had —
 *  folded in here so there is ONE surface for "point at an element and change it", not two.
 *
 *   - LENGTH: a real `input[type=number]` plus the workbench's own dropdown for the unit, so the
 *     keyboard arrows and the wheel step a margin and the unit list looks like the IDE rather than
 *     like Chromium. Keywords (`auto`, `calc(…)`, `inherit`) survive a round trip untouched.
 *   - RANGE: a slider for the properties whose whole domain is 0..1 (`opacity`), where dragging is
 *     the only honest gesture.
 *   - SEGMENTED: the short enumerations where every option has an obvious glyph (`text-align`,
 *     `flex-direction`). A four-option dropdown costs two clicks to say something a row of four
 *     buttons says at a glance.
 *
 *  Interaction reference: VvvebJs (`CssUnitInput`, `RangeInput`, `RadioButtonInput`), read and not
 *  copied — it is Apache-2.0 and this tree is MIT. What IS reused is the workbench's own DOM
 *  helpers and codicons, which are already MIT and already here.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { OpenideSettingsDropdown } from '../../../openideSettings/browser/openideSettingsDropdown.js';

/** What a control needs from the panel to open the workbench's own dropdown instead of the OS one. */
export interface IOpenideControlHost {
	readonly contextViewService: IContextViewService;
	/** Cleared on every repaint of the panel: the widgets belong to the render, not to the feature. */
	readonly store: DisposableStore;
}

/** A property whose value is a number with a unit, and the units worth offering for it. */
interface ILengthSpec {
	readonly units: readonly string[];
	readonly step?: number;
	readonly min?: number;
}

const SIZE_UNITS = ['px', '%', 'rem', 'em', 'vh', 'vw'] as const;
const SPACING_UNITS = ['px', 'rem', 'em', '%'] as const;

/**
 * Which properties get the number+unit control.
 *
 * Longhands only: a `padding` shorthand is four independently editable numbers collapsed into one
 * string, and collapsing them is exactly what makes a text field the wrong control. The shorthands
 * stay on the text input, where a person can still write `10px 4px`.
 */
const LENGTH_PROPERTIES: Readonly<Record<string, ILengthSpec>> = {
	width: { units: SIZE_UNITS }, height: { units: SIZE_UNITS },
	'min-width': { units: SIZE_UNITS }, 'max-width': { units: SIZE_UNITS },
	'min-height': { units: SIZE_UNITS }, 'max-height': { units: SIZE_UNITS },
	top: { units: SIZE_UNITS }, right: { units: SIZE_UNITS }, bottom: { units: SIZE_UNITS }, left: { units: SIZE_UNITS },
	gap: { units: SPACING_UNITS, min: 0 },
	'margin-top': { units: SPACING_UNITS }, 'margin-right': { units: SPACING_UNITS },
	'margin-bottom': { units: SPACING_UNITS }, 'margin-left': { units: SPACING_UNITS },
	'padding-top': { units: SPACING_UNITS, min: 0 }, 'padding-right': { units: SPACING_UNITS, min: 0 },
	'padding-bottom': { units: SPACING_UNITS, min: 0 }, 'padding-left': { units: SPACING_UNITS, min: 0 },
	'font-size': { units: ['px', 'rem', 'em', '%'], min: 0, step: 0.5 },
	'line-height': { units: ['', 'px', 'rem', 'em', '%'], min: 0, step: 0.1 },
	'letter-spacing': { units: ['px', 'em', 'rem'], step: 0.1 },
	'border-radius': { units: SPACING_UNITS, min: 0 },
	'border-top-left-radius': { units: SPACING_UNITS, min: 0 }, 'border-top-right-radius': { units: SPACING_UNITS, min: 0 },
	'border-bottom-right-radius': { units: SPACING_UNITS, min: 0 }, 'border-bottom-left-radius': { units: SPACING_UNITS, min: 0 },
	'border-width': { units: ['px', 'rem', 'em'], min: 0 },
	'border-top-width': { units: ['px', 'rem', 'em'], min: 0 }, 'border-right-width': { units: ['px', 'rem', 'em'], min: 0 },
	'border-bottom-width': { units: ['px', 'rem', 'em'], min: 0 }, 'border-left-width': { units: ['px', 'rem', 'em'], min: 0 },
	'z-index': { units: [''], step: 1 },
	'flex-grow': { units: [''], min: 0, step: 1 }, 'flex-shrink': { units: [''], min: 0, step: 1 },
};

/** Properties whose entire domain is 0..1: a slider says that, a text field does not. */
const RANGE_PROPERTIES: Readonly<Record<string, { readonly max: number; readonly step: number }>> = {
	opacity: { max: 1, step: 0.01 },
};

/** Short enumerations where each option has an unmistakable glyph. */
const SEGMENTED_PROPERTIES: Readonly<Record<string, ReadonlyArray<{ readonly value: string; readonly icon: string; readonly label: string }>>> = {
	'text-align': [
		{ value: 'left', icon: 'codicon-list-flat', label: localize('openide.inspector.alignLeft', "left") },
		{ value: 'center', icon: 'codicon-list-selection', label: localize('openide.inspector.alignCenter', "center") },
		{ value: 'right', icon: 'codicon-list-ordered', label: localize('openide.inspector.alignRight', "right") },
		{ value: 'justify', icon: 'codicon-list-tree', label: localize('openide.inspector.alignJustify', "justify") },
	],
	'flex-direction': [
		{ value: 'row', icon: 'codicon-arrow-right', label: 'row' },
		{ value: 'column', icon: 'codicon-arrow-down', label: 'column' },
		{ value: 'row-reverse', icon: 'codicon-arrow-left', label: 'row-reverse' },
		{ value: 'column-reverse', icon: 'codicon-arrow-up', label: 'column-reverse' },
	],
};

/** `12.5px` → `{ amount: 12.5, unit: 'px' }`; a keyword or an expression → undefined. */
export function parseCssLength(value: string): { amount: number; unit: string } | undefined {
	const match = /^\s*(-?\d*\.?\d+)\s*([a-z%]*)\s*$/i.exec(value ?? '');
	if (!match) {
		return undefined;
	}
	const amount = Number(match[1]);
	return Number.isFinite(amount) ? { amount, unit: match[2] ?? '' } : undefined;
}

/** Trailing zeros are noise in a CSS value: `12.50px` is `12.5px`. */
export function formatCssLength(amount: number, unit: string): string {
	return `${Number(amount.toFixed(3))}${unit}`;
}

/**
 * The control this property deserves, or undefined to leave it to the inspector's own branches
 * (colour swatch, select, text). Every control reports through `onChange` with the CSS value the
 * property should take, so the caller applies it exactly as it applies a typed one.
 */
export function createOpenideStyleControl(property: string, value: string, onChange: (value: string) => void, host: IOpenideControlHost): { element: HTMLElement; dispose(): void } | undefined {
	const range = RANGE_PROPERTIES[property];
	if (range) {
		return createRangeControl(value, range, onChange);
	}
	const segments = SEGMENTED_PROPERTIES[property];
	if (segments) {
		return createSegmentedControl(property, value, segments, onChange);
	}
	const length = LENGTH_PROPERTIES[property];
	if (length) {
		return createLengthControl(value, length, onChange, host);
	}
	return undefined;
}

/**
 * Number and unit as ONE control, the way the reference builder joins them (`input-group.css-unit`):
 * the number takes the room, the unit sits against it sharing the same frame, and the border is on
 * the pair — two separate boxes read as two fields for one value.
 *
 * The keyword the page already had (`auto`, `normal`, a `calc`) is an OPTION IN THE UNIT LIST, not
 * a ghost placeholder: choosing it hides the number and the control says `auto`, choosing a unit
 * brings the number back. That is the reference's `.input-group.auto` behaviour, and it is what
 * makes "this side has no number" something you can both read and set.
 */
function createLengthControl(value: string, spec: ILengthSpec, onChange: (value: string) => void, host: IOpenideControlHost): { element: HTMLElement; dispose(): void } {
	const element = $('.openide-inspector-length');
	const parsed = parseCssLength(value);
	const keyword = parsed ? undefined : value.trim();
	const input = append(element, $<HTMLInputElement>('input.openide-inspector-number', { type: 'number' }));
	input.value = parsed ? String(parsed.amount) : '';
	input.step = String(spec.step ?? 1);
	if (spec.min !== undefined) { input.min = String(spec.min); }
	input.ariaLabel = localize('openide.inspector.value', "value");

	const options = [...spec.units];
	if (parsed && !options.includes(parsed.unit)) {
		options.push(parsed.unit);
	}
	if (keyword) {
		options.push(keyword);
	}
	const selected = Math.max(0, options.indexOf(keyword ?? parsed?.unit ?? spec.units[0]));
	// The product's own dropdown (the Settings trigger over the shared popover), not a bare
	// `<select>`: a raw select opens Chromium's white OS popup in the middle of a dark panel, and the
	// workbench's SelectBox opens a list skinned unlike every other menu in the IDE.
	const unit = host.store.add(new OpenideSettingsDropdown(
		options.map(text => ({ label: text || '—' })),
		selected,
		host.contextViewService,
		localize('openide.inspector.unit', "unit"),
	));
	const unitHost = append(element, $('.openide-inspector-unit'));
	unit.render(unitHost);

	let current = options[selected] ?? '';
	const isKeyword = () => !!keyword && current === keyword;
	element.classList.toggle('keyword', isKeyword());

	const emit = () => {
		if (isKeyword()) {
			onChange(keyword!);
			return;
		}
		const amount = Number(input.value);
		if (input.value.trim() === '' || !Number.isFinite(amount)) {
			return; // a unit chosen with no number yet is not a value: wait for the number
		}
		onChange(formatCssLength(amount, current));
	};
	const listeners = [
		addDisposableListener(input, 'change', emit),
		unit.onDidSelect(event => {
			current = options[event.index] ?? '';
			element.classList.toggle('keyword', isKeyword());
			if (!isKeyword() && !input.value.trim()) {
				input.focus();
				return;
			}
			emit();
		}),
	];
	return { element, dispose: () => disposeAll(listeners) };
}

function createRangeControl(value: string, spec: { max: number; step: number }, onChange: (value: string) => void): { element: HTMLElement; dispose(): void } {
	const element = $('.openide-inspector-range');
	const current = Number.parseFloat(value);
	const slider = append(element, $<HTMLInputElement>('input.openide-inspector-slider', { type: 'range' }));
	slider.min = '0';
	slider.max = String(spec.max);
	slider.step = String(spec.step);
	slider.value = String(Number.isFinite(current) ? current : spec.max);
	slider.ariaLabel = localize('openide.inspector.value', "value");
	const readout = append(element, $('span.openide-inspector-readout'));
	readout.textContent = slider.value;
	const listeners = [
		// `input`, not `change`: dragging a slider you cannot see the result of is a text field with
		// extra steps.
		addDisposableListener(slider, 'input', () => {
			readout.textContent = slider.value;
			onChange(slider.value);
		}),
	];
	return { element, dispose: () => disposeAll(listeners) };
}

function createSegmentedControl(property: string, value: string, segments: ReadonlyArray<{ value: string; icon: string; label: string }>, onChange: (value: string) => void): { element: HTMLElement; dispose(): void } {
	// The product's segmented control (`.oi-segmented`), with a glyph per segment instead of a word.
	const element = $('.oi-segmented.openide-inspector-segmented', { role: 'radiogroup' });
	const listeners: IDisposable[] = [];
	const buttons: HTMLButtonElement[] = [];
	for (const segment of segments) {
		const button = append(element, $<HTMLButtonElement>('button.oi-segment.openide-inspector-segment', { type: 'button' }));
		button.title = `${property}: ${segment.value}`;
		button.ariaLabel = button.title;
		button.classList.toggle('active', value.trim() === segment.value);
		append(button, $(`span.codicon.${segment.icon}`));
		buttons.push(button);
		listeners.push(addDisposableListener(button, 'click', () => {
			for (const other of buttons) { other.classList.remove('active'); }
			button.classList.add('active');
			onChange(segment.value);
		}));
	}
	return { element, dispose: () => disposeAll(listeners) };
}

/** The eight longhands the box model owns. The `margin` / `padding` shorthands are not among them. */
export const OPENIDE_BOX_MODEL_PROPERTIES: readonly string[] = [
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
];

/**
 * The box model, as a box.
 *
 * Eight rows of `padding-left: 12px` are eight readings of a thing that is one shape. Chrome's
 * DevTools, Figma and VvvebJs's `GridLayoutInput` all draw it instead, and they draw it the same
 * way because the drawing IS the explanation: the margin is outside, the padding is inside, and
 * which side you are editing is where the field is, not what the label says.
 *
 * Each field keeps the unit the page already had for that side (`px` when it had none to keep),
 * so editing a `%` padding does not silently convert it. A side whose value is not a plain length
 * (`auto`, a `calc`) shows it as the placeholder and stays empty until a number is typed — the same
 * contract as the length control above.
 */
export function createOpenideBoxModel(styles: Readonly<Record<string, string>>, onChange: (property: string, value: string) => void): { element: HTMLElement; dispose(): void } {
	const element = $('.openide-inspector-boxmodel');
	const listeners: IDisposable[] = [];
	const marginBox = append(element, $('.openide-inspector-box.openide-inspector-box-margin'));
	append(marginBox, $('span.openide-inspector-box-label', undefined, 'margin'));
	const paddingBox = append(marginBox, $('.openide-inspector-box.openide-inspector-box-padding'));
	append(paddingBox, $('span.openide-inspector-box-label', undefined, 'padding'));
	append(paddingBox, $('.openide-inspector-box-content'));

	const field = (box: HTMLElement, property: string, side: string) => {
		const raw = (styles[property] ?? '').trim();
		const parsed = parseCssLength(raw);
		const input = append(box, $<HTMLInputElement>(`input.openide-inspector-box-field.openide-inspector-box-${side}`, { type: 'number' }));
		input.value = parsed ? String(parsed.amount) : '';
		input.placeholder = parsed ? '' : (raw || '0');
		input.ariaLabel = property;
		input.title = property;
		listeners.push(addDisposableListener(input, 'change', () => {
			const amount = Number(input.value);
			if (input.value.trim() === '' || !Number.isFinite(amount)) {
				// Emptied on purpose: hand the side back to the stylesheet.
				onChange(property, '');
				return;
			}
			onChange(property, formatCssLength(amount, parsed?.unit || 'px'));
		}));
	};
	for (const side of ['top', 'right', 'bottom', 'left']) {
		field(marginBox, `margin-${side}`, side);
		field(paddingBox, `padding-${side}`, side);
	}
	return { element, dispose: () => disposeAll(listeners) };
}

function disposeAll(listeners: readonly IDisposable[]): void {
	toDisposable(() => { for (const listener of listeners) { listener.dispose(); } }).dispose();
}
