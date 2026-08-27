/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — what a style editor can edit, as data.
 *
 *  Pick & Polish used to hand the picked element's styles to the model as ONE STRING: 21 declarations
 *  joined with newlines, built for an LLM to read. Nothing could edit it, because a blob of text has
 *  no properties — only a shape a person can read. Every change therefore had to go through the
 *  agent, which is a round trip, an approval dialog and a guess for something as direct as nudging a
 *  padding.
 *
 *  So the properties become a CATALOG: each one knows its group, its control (a colour, a length, a
 *  choice among keywords), its unit and its range. The panel renders itself from this — a new
 *  property is one entry here, not a new widget — and the same catalog is what parses the computed
 *  values coming back from the page and what emits the CSS to apply.
 *
 *  This module is PURE (no DOM, no services) so the parsing and the diffing are unit-testable; the
 *  widgets live in browser/openideStylePanel.ts.
 *--------------------------------------------------------------------------------------------*/

/** How a value is edited. The panel maps one control kind to one widget. */
export type StyleControlKind =
	/** A colour: swatch + picker + hex/rgba field. */
	| 'color'
	/** A number with a unit (px, rem, %, …): stepper + unit menu. */
	| 'length'
	/** A unitless number (opacity, font-weight, line-height, z-index). */
	| 'number'
	/** One of a fixed set of keywords: a segmented control or a dropdown. */
	| 'choice'
	/** Free text, the escape hatch (box-shadow, transform, font-family). */
	| 'text';

export interface IStylePropertyDef {
	/** The CSS property, exactly as it is written in a declaration. */
	readonly id: string;
	/** Short label for the control. Localised at render time by the panel. */
	readonly labelKey: string;
	readonly group: StyleGroupId;
	readonly control: StyleControlKind;
	/** For `choice`: the keywords offered, in the order they should appear. */
	readonly choices?: readonly string[];
	/** For `length`: the units offered; the first is the default when the user types a bare number. */
	readonly units?: readonly string[];
	/** For `length` / `number`: the stepper's bounds and increment. */
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	/** Rendered as one row of four (top/right/bottom/left) instead of four separate rows. */
	readonly side?: 'top' | 'right' | 'bottom' | 'left';
	/** The shorthand a set of `side` properties belongs to, which is what groups them into a row. */
	readonly box?: 'padding' | 'margin' | 'border-width' | 'border-radius';
}

export type StyleGroupId = 'layout' | 'spacing' | 'typography' | 'colors' | 'border' | 'effects';

export interface IStyleGroupDef {
	readonly id: StyleGroupId;
	readonly labelKey: string;
	/** Codicon id for the group header. */
	readonly icon: string;
}

export const OPENIDE_STYLE_GROUPS: readonly IStyleGroupDef[] = [
	{ id: 'layout', labelKey: 'style.group.layout', icon: 'layout' },
	{ id: 'spacing', labelKey: 'style.group.spacing', icon: 'combine' },
	{ id: 'typography', labelKey: 'style.group.typography', icon: 'text-size' },
	{ id: 'colors', labelKey: 'style.group.colors', icon: 'symbol-color' },
	{ id: 'border', labelKey: 'style.group.border', icon: 'primitive-square' },
	{ id: 'effects', labelKey: 'style.group.effects', icon: 'sparkle' },
];

const LENGTH_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw'] as const;

/**
 * The editable surface. Longhands, NOT shorthands, wherever a shorthand would collapse four
 * independently useful numbers into one string the user then has to parse by eye — that is the
 * difference between a padding you can nudge on one side and a padding you have to retype.
 */
export const OPENIDE_STYLE_PROPERTIES: readonly IStylePropertyDef[] = [
	// ---- layout
	{ id: 'display', labelKey: 'style.display', group: 'layout', control: 'choice', choices: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none'] },
	{ id: 'flex-direction', labelKey: 'style.flexDirection', group: 'layout', control: 'choice', choices: ['row', 'row-reverse', 'column', 'column-reverse'] },
	{ id: 'justify-content', labelKey: 'style.justifyContent', group: 'layout', control: 'choice', choices: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] },
	{ id: 'align-items', labelKey: 'style.alignItems', group: 'layout', control: 'choice', choices: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] },
	{ id: 'gap', labelKey: 'style.gap', group: 'layout', control: 'length', units: LENGTH_UNITS, min: 0, step: 1 },
	{ id: 'position', labelKey: 'style.position', group: 'layout', control: 'choice', choices: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
	{ id: 'width', labelKey: 'style.width', group: 'layout', control: 'length', units: LENGTH_UNITS, min: 0, step: 1 },
	{ id: 'height', labelKey: 'style.height', group: 'layout', control: 'length', units: LENGTH_UNITS, min: 0, step: 1 },

	// ---- spacing (the box model, one control per side)
	{ id: 'padding-top', labelKey: 'style.paddingTop', group: 'spacing', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'top', box: 'padding' },
	{ id: 'padding-right', labelKey: 'style.paddingRight', group: 'spacing', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'right', box: 'padding' },
	{ id: 'padding-bottom', labelKey: 'style.paddingBottom', group: 'spacing', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'bottom', box: 'padding' },
	{ id: 'padding-left', labelKey: 'style.paddingLeft', group: 'spacing', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'left', box: 'padding' },
	{ id: 'margin-top', labelKey: 'style.marginTop', group: 'spacing', control: 'length', units: LENGTH_UNITS, step: 1, side: 'top', box: 'margin' },
	{ id: 'margin-right', labelKey: 'style.marginRight', group: 'spacing', control: 'length', units: LENGTH_UNITS, step: 1, side: 'right', box: 'margin' },
	{ id: 'margin-bottom', labelKey: 'style.marginBottom', group: 'spacing', control: 'length', units: LENGTH_UNITS, step: 1, side: 'bottom', box: 'margin' },
	{ id: 'margin-left', labelKey: 'style.marginLeft', group: 'spacing', control: 'length', units: LENGTH_UNITS, step: 1, side: 'left', box: 'margin' },

	// ---- typography
	{ id: 'font-family', labelKey: 'style.fontFamily', group: 'typography', control: 'text' },
	{ id: 'font-size', labelKey: 'style.fontSize', group: 'typography', control: 'length', units: LENGTH_UNITS, min: 0, step: 1 },
	{ id: 'font-weight', labelKey: 'style.fontWeight', group: 'typography', control: 'choice', choices: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
	{ id: 'line-height', labelKey: 'style.lineHeight', group: 'typography', control: 'number', min: 0, step: 0.1 },
	{ id: 'letter-spacing', labelKey: 'style.letterSpacing', group: 'typography', control: 'length', units: LENGTH_UNITS, step: 0.1 },
	{ id: 'text-align', labelKey: 'style.textAlign', group: 'typography', control: 'choice', choices: ['left', 'center', 'right', 'justify'] },
	{ id: 'text-transform', labelKey: 'style.textTransform', group: 'typography', control: 'choice', choices: ['none', 'uppercase', 'lowercase', 'capitalize'] },

	// ---- colors
	{ id: 'color', labelKey: 'style.color', group: 'colors', control: 'color' },
	{ id: 'background-color', labelKey: 'style.backgroundColor', group: 'colors', control: 'color' },

	// ---- border
	{ id: 'border-top-width', labelKey: 'style.borderTopWidth', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'top', box: 'border-width' },
	{ id: 'border-right-width', labelKey: 'style.borderRightWidth', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'right', box: 'border-width' },
	{ id: 'border-bottom-width', labelKey: 'style.borderBottomWidth', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'bottom', box: 'border-width' },
	{ id: 'border-left-width', labelKey: 'style.borderLeftWidth', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'left', box: 'border-width' },
	{ id: 'border-style', labelKey: 'style.borderStyle', group: 'border', control: 'choice', choices: ['none', 'solid', 'dashed', 'dotted', 'double'] },
	{ id: 'border-color', labelKey: 'style.borderColor', group: 'border', control: 'color' },
	{ id: 'border-top-left-radius', labelKey: 'style.radiusTopLeft', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'top', box: 'border-radius' },
	{ id: 'border-top-right-radius', labelKey: 'style.radiusTopRight', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'right', box: 'border-radius' },
	{ id: 'border-bottom-right-radius', labelKey: 'style.radiusBottomRight', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'bottom', box: 'border-radius' },
	{ id: 'border-bottom-left-radius', labelKey: 'style.radiusBottomLeft', group: 'border', control: 'length', units: LENGTH_UNITS, min: 0, step: 1, side: 'left', box: 'border-radius' },

	// ---- effects
	{ id: 'opacity', labelKey: 'style.opacity', group: 'effects', control: 'number', min: 0, max: 1, step: 0.05 },
	{ id: 'box-shadow', labelKey: 'style.boxShadow', group: 'effects', control: 'text' },
	{ id: 'transform', labelKey: 'style.transform', group: 'effects', control: 'text' },
	{ id: 'overflow', labelKey: 'style.overflow', group: 'effects', control: 'choice', choices: ['visible', 'hidden', 'scroll', 'auto'] },
];

/** Every property the picker should read off the element, for the in-page capture script. */
export const OPENIDE_STYLE_CAPTURE_PROPS: readonly string[] = OPENIDE_STYLE_PROPERTIES.map(property => property.id);

export function styleProperty(id: string): IStylePropertyDef | undefined {
	return OPENIDE_STYLE_PROPERTIES.find(property => property.id === id);
}

export function stylePropertiesOf(group: StyleGroupId): readonly IStylePropertyDef[] {
	return OPENIDE_STYLE_PROPERTIES.filter(property => property.group === group);
}

/**
 * Parses the picker's `styles` payload — `"prop: value;"` per line — into a map.
 *
 * Tolerant on purpose: it is produced by a script injected into somebody else's page, so a value
 * containing a colon (`background-image: url(http://…)`) or a missing trailing semicolon must not
 * lose the declaration. Splitting on the FIRST colon only is what makes that work.
 */
export function parseComputedStyles(raw: string): Map<string, string> {
	const styles = new Map<string, string>();
	for (const line of String(raw ?? '').split('\n')) {
		const declaration = line.trim().replace(/;$/, '');
		if (!declaration) { continue; }
		const colon = declaration.indexOf(':');
		if (colon <= 0) { continue; }
		const property = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration.slice(colon + 1).trim();
		if (property) { styles.set(property, value); }
	}
	return styles;
}

export interface ILengthValue {
	readonly amount: number;
	readonly unit: string;
}

/**
 * Splits `"12.5px"` into its number and its unit. `auto`, `normal`, `inherit` and friends have no
 * number, and the panel has to keep showing them as-is rather than turning them into 0.
 */
export function parseLength(value: string | undefined): ILengthValue | undefined {
	const match = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(String(value ?? '').trim());
	if (!match) { return undefined; }
	const amount = Number(match[1]);
	return Number.isFinite(amount) ? { amount, unit: match[2] || 'px' } : undefined;
}

export function formatLength(amount: number, unit: string): string {
	// Trailing zeros read as noise on a control the user is dragging: 1.5px, not 1.50px.
	const rounded = Math.round(amount * 1000) / 1000;
	return `${rounded}${unit}`;
}

/**
 * The CSS to apply: ONLY what the user actually changed.
 *
 * Emitting the whole computed set would be wrong twice over — it would pin 40 properties the user
 * never touched (so the element stops inheriting and stops responding to its own stylesheet), and
 * it would make the change impossible to read when it is later carried into the source.
 */
export function styleDiffCss(original: ReadonlyMap<string, string>, edited: ReadonlyMap<string, string>): string {
	const declarations: string[] = [];
	for (const [property, value] of edited) {
		const before = original.get(property);
		if (before !== undefined && normalizeValue(before) === normalizeValue(value)) { continue; }
		if (!String(value ?? '').trim()) { continue; }
		declarations.push(`${property}: ${value}`);
	}
	return declarations.join('; ');
}

/** `rgb(0, 0, 0)` and `rgb(0,0,0)` are the same value; whitespace must not read as an edit. */
function normalizeValue(value: string): string {
	return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',');
}

/** Whether the two style maps differ at all — drives the panel's "reset" affordance. */
export function hasStyleEdits(original: ReadonlyMap<string, string>, edited: ReadonlyMap<string, string>): boolean {
	return styleDiffCss(original, edited).length > 0;
}
