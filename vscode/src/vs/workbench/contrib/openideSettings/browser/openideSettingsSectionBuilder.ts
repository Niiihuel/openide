/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — composition primitives for the DOM sections of Settings.
 *
 *  Skills, MCP, Rules, Hooks and Commands ALL share the same anatomy: a header with actions,
 *  a list of rows (name + badges + description + actions/toggle) and an empty state. That
 *  anatomy is also the SAME as a native setting row, so this file emits that markup
 *  (`.openide-settings-row` / `-copy` / `-value`) instead of inventing a new one: the pages end
 *  up indistinguishable from the rest of Settings without copying a single CSS rule.
 *
 *  Golden rule so the webview story does not repeat itself: if a section needs a control that
 *  is not here, it gets added here — never loose inside the section.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { openideCheckboxStyles, openideInputBoxStyles, openideSelectBoxStyles } from '../../openideAgent/browser/openideControlStyles.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { plainSettingsQuery } from './openideSettingsSearch.js';

/** Text a block can be found by. The renderer emits it and `pruneSections` consumes it: that way
 *  the search filter is ONE, not seven different copies inside each page. */
const SEARCH_ATTR = 'data-openide-search';

function searchText(parts: readonly (string | undefined)[]): string {
	return parts.filter(part => !!part).join(' ').toLowerCase();
}

export interface ISectionAction {
	readonly label: string;
	/** Codicon name without the `codicon-` prefix. */
	readonly icon?: string;
	readonly primary?: boolean;
	readonly danger?: boolean;
	readonly enabled?: boolean;
	/** Text for the second click on things with no way back. A modal dialog for "delete the index"
	 *  interrupts more than it protects; arming the button protects just as well and does not cover
	 *  the screen. It disarms itself if the user does not confirm. */
	readonly confirm?: string;
	run(): void;
}

/** How long an armed button waits before returning to its normal state. Long enough to read the
 *  new text and decide; short enough that a stale click does not fire by accident later. */
const CONFIRM_TIMEOUT = 4000;

export interface ISectionStatus {
	readonly label: string;
	readonly tone: 'ok' | 'warn' | 'error' | 'neutral';
	/** Replaces the pill with a spinner: the state is being verified, it is not known yet. */
	readonly busy?: boolean;
	readonly title?: string;
}

export interface ISectionFieldSpec {
	readonly label: string;
	readonly description?: string;
	readonly value?: string;
	readonly placeholder?: string;
	readonly mono?: boolean;
	readonly password?: boolean;
	readonly rows?: number;
	change(value: string): void;
}

export interface ISectionKeyValueSpec {
	readonly label: string;
	readonly description?: string;
	readonly rows: { k: string; v: string }[];
	/** The values are secrets: they can be written but not displayed. */
	readonly secret?: boolean;
	readonly addLabel: string;
	/** The stored value that cannot be shown. Typing over it replaces it. */
	readonly mask?: string;
	/** Called when the list's shape changes (add/remove): the section repaints. */
	changed(): void;
}

export interface ISectionToggle {
	readonly checked: boolean;
	readonly title?: string;
	change(on: boolean): void;
}

export interface ISectionRowSpec {
	readonly name: string;
	/** Technical names (skills, MCP servers, commands) use the editor font. */
	readonly mono?: boolean;
	readonly description?: string;
	readonly badges?: readonly string[];
	/** Live state (connected, error, verifying). It goes on the controls side, not the text side:
	 *  it is what is happening now, not part of the name. */
	readonly status?: ISectionStatus;
	/** How someone who does not know our name for it would search. It is added to the name and the
	 *  description when deciding whether the row survives a search filter. */
	readonly keywords?: readonly string[];
	readonly iconActions?: readonly ISectionAction[];
	readonly toggle?: ISectionToggle;
	/** When present, the row expands on click and this callback fills the body. It is invoked on
	 *  every open (fresh content), not just once. */
	readonly expand?: (body: HTMLElement) => void;
	/** Born open. Every page with live state needs it: if repainting closed the row, a
	 *  login a medias o un formulario abierto desaparecen solos cuando llega un evento. */
	readonly open?: boolean;
	/** Reports when it was opened or closed, so the section can remember it. */
	readonly onToggle?: (open: boolean) => void;
}

export class OpenideSectionRenderer {

	constructor(
		private readonly store: DisposableStore,
		/** `SelectBox` renders its list through the context view, so the renderer needs it. */
		private readonly contextViewService: IContextViewService,
	) { }

	/** Block with title/description/actions. Returns the body where rows and fields go. */
	section(parent: HTMLElement, opts: { title: string; description?: string; actions?: readonly ISectionAction[]; keywords?: readonly string[] }): HTMLElement {
		const section = append(parent, $('.openide-settings-section'));
		section.setAttribute(SEARCH_ATTR, searchText([opts.title, opts.description, ...(opts.keywords ?? [])]));
		const head = append(section, $('.openide-settings-section-head'));
		const copy = append(head, $('.openide-settings-section-copy'));
		append(copy, $('.openide-settings-section-title', undefined, opts.title));
		if (opts.description) { append(copy, $('.openide-settings-section-desc', undefined, opts.description)); }
		if (opts.actions?.length) {
			const actions = append(head, $('.openide-settings-section-actions'));
			for (const action of opts.actions) { this.button(actions, action); }
		}
		return append(section, $('.openide-settings-section-body'));
	}

	/** Row with the same anatomy as a native setting. */
	row(parent: HTMLElement, spec: ISectionRowSpec): HTMLElement {
		const row = append(parent, $('.openide-settings-row'));
		row.setAttribute(SEARCH_ATTR, searchText([spec.name, spec.description, ...(spec.badges ?? []), ...(spec.keywords ?? [])]));
		const copy = append(row, $('.openide-settings-copy'));
		const title = append(copy, $('.openide-settings-setting-title'));
		append(title, $(spec.mono ? 'span.openide-settings-mono' : 'span', undefined, spec.name));
		for (const badge of spec.badges ?? []) { append(title, $('span.openide-settings-badge', undefined, badge)); }
		if (spec.description) { append(copy, $('.openide-settings-description', undefined, spec.description)); }

		const value = append(row, $('.openide-settings-value'));
		if (spec.status) { this.status(value, spec.status); }
		for (const action of spec.iconActions ?? []) { this.iconButton(value, action); }
		if (spec.toggle) { this.toggle(value, spec.toggle); }

		if (spec.expand) {
			const chevron = append(value, $('span.codicon.openide-settings-row-chevron'));
			const body = append(row, $('.openide-settings-row-body'));
			row.classList.add('expandable');
			const paint = (open: boolean) => {
				row.classList.toggle('open', open);
				chevron.classList.toggle('codicon-chevron-right', !open);
				chevron.classList.toggle('codicon-chevron-down', open);
				body.textContent = '';
				if (open) { spec.expand!(body); }
			};
			paint(!!spec.open);
			// Click on the row, but NOT on its controls: touching a toggle or an icon button must
			// not also fold/unfold the row.
			this.store.add(addDisposableListener(row, 'click', event => {
				if ((event.target as HTMLElement).closest('.openide-settings-iconbtn, .monaco-custom-toggle, .monaco-button, .openide-settings-row-body')) { return; }
				const open = !row.classList.contains('open');
				paint(open);
				spec.onToggle?.(open);
			}));
		}
		return row;
	}

	empty(parent: HTMLElement, opts: { title: string; description?: string; actions?: readonly ISectionAction[] }): void {
		const empty = append(parent, $('.openide-settings-empty-state'));
		append(empty, $('.openide-settings-empty-title', undefined, opts.title));
		if (opts.description) { append(empty, $('.openide-settings-empty-desc', undefined, opts.description)); }
		if (opts.actions?.length) {
			const actions = append(empty, $('.openide-settings-section-actions'));
			for (const action of opts.actions) { this.button(actions, action); }
		}
	}

	metrics(parent: HTMLElement, entries: readonly { value: string; label: string }[]): void {
		const metrics = append(parent, $('.openide-settings-metrics'));
		for (const entry of entries) {
			const cell = append(metrics, $('.openide-settings-metric'));
			append(cell, $('span.openide-settings-metric-value', undefined, entry.value));
			append(cell, $('span.openide-settings-metric-label', undefined, entry.label));
		}
	}

	/** `<pre>` block for output and previews (a command body, a hook result). */
	pre(parent: HTMLElement, label: string, content: string): void {
		append(parent, $('.openide-settings-pre-label', undefined, label));
		append(parent, $('pre.openide-settings-pre', undefined, content));
	}

	/** Campo etiquetado a ancho completo (textareas de globs, JSON, etc.). */
	field(parent: HTMLElement, label: string, description?: string): HTMLElement {
		const field = append(parent, $('.openide-settings-field'));
		append(field, $('label.openide-settings-field-label', undefined, label));
		if (description) { append(field, $('.openide-settings-section-desc', undefined, description)); }
		return field;
	}

	/**
	 * Native `Button`. Three hand-rolled treatments (default / `.primary` / `.danger`) collapse
	 * into upstream's two — primary and `secondary` — plus a danger tint that upstream has no
	 * variant for. Before this, "Reconnect", "Sign out" and "Use this provider" were three
	 * different CSS recipes on one screen.
	 *
	 * `supportIcons` lets the label carry the codicon inline (`$(refresh)`), so the icon is part of
	 * the button's own layout instead of a `<span>` glued in front of it.
	 */
	button(parent: HTMLElement, action: ISectionAction): Button {
		const button = this.store.add(new Button(parent, {
			...defaultButtonStyles,
			secondary: !action.primary,
			supportIcons: true,
			title: action.label,
		}));
		button.element.classList.add('openide-settings-section-button');
		if (action.danger) { button.element.classList.add('danger'); }
		const text = (label: string) => action.icon ? `$(${action.icon}) ${label}` : label;
		button.label = text(action.label);
		button.enabled = action.enabled !== false;
		if (!action.confirm) {
			this.store.add(button.onDidClick(() => action.run()));
			return button;
		}
		let armed: any;
		const disarm = () => { clearTimeout(armed); armed = undefined; button.label = text(action.label); button.element.classList.remove('armed'); };
		this.store.add(button.onDidClick(() => {
			if (armed) { disarm(); action.run(); return; }
			button.label = text(action.confirm!);
			button.element.classList.add('armed');
			armed = setTimeout(disarm, CONFIRM_TIMEOUT);
		}));
		this.store.add(toDisposable(() => clearTimeout(armed)));
		return button;
	}

	/** Live status pill. Verifying is a state of its own: showing "not connected" while finding out
	 *  asserts something that is not yet known. */
	status(parent: HTMLElement, spec: ISectionStatus): HTMLElement {
		if (spec.busy) {
			const busy = append(parent, $('span.openide-settings-status-pill.busy', { title: spec.title ?? spec.label }));
			append(busy, $('span.codicon.codicon-loading.codicon-modifier-spin'));
			return busy;
		}
		const pill = append(parent, $(`span.openide-settings-status-pill.${spec.tone}`, undefined, spec.label));
		if (spec.title) { pill.title = spec.title; }
		return pill;
	}

	/** Labelled field with its control beside it (name, command, URL…). */
	/**
	 * Native `InputBox`. A raw `<input>` inside a decorated wrapper always draws TWO focus rings —
	 * the wrapper's `:focus-within` border and the input's own outline — and the artisanal
	 * `outline: none` that tries to hide the inner one loses on specificity. `InputBox` is a single
	 * widget that owns its border AND its focus treatment, so the problem cannot occur.
	 */
	input(parent: HTMLElement, spec: ISectionFieldSpec): InputBox {
		const row = append(parent, $('.openide-settings-fieldrow'));
		append(row, $('label.openide-settings-field-label', undefined, spec.label));
		const host = append(row, $('.openide-settings-fieldhost'));
		const input = this.store.add(new InputBox(host, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			placeholder: spec.placeholder ?? '',
			ariaLabel: spec.label,
			type: spec.password ? 'password' : 'text',
		}));
		if (spec.mono) { input.element.classList.add('openide-settings-mono'); }
		input.value = spec.value ?? '';
		this.store.add(input.onDidChange(value => spec.change(value)));
		if (spec.description) { append(parent, $('.openide-settings-field-desc', undefined, spec.description)); }
		return input;
	}

	textarea(parent: HTMLElement, spec: ISectionFieldSpec): InputBox {
		append(parent, $('.openide-settings-field-label', undefined, spec.label));
		if (spec.description) { append(parent, $('.openide-settings-field-desc', undefined, spec.description)); }
		const host = append(parent, $('.openide-settings-fieldhost'));
		// `flexibleHeight` is upstream's multiline mode: it grows with the content instead of
		// pinning `rows`, which is what the hand-rolled `<textarea>` was approximating.
		const area = this.store.add(new InputBox(host, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			placeholder: spec.placeholder ?? '',
			ariaLabel: spec.label,
			flexibleHeight: true,
			flexibleWidth: false,
		}));
		if (spec.mono) { area.element.classList.add('openide-settings-mono'); }
		area.value = spec.value ?? '';
		this.store.add(area.onDidChange(value => spec.change(value)));
		return area;
	}

	/** A choice among a few mutually exclusive options (stdio/HTTP transport). The same control as
	 *  the header's scope tabs: in Settings this already has a shape, no need for another. */
	segmented(parent: HTMLElement, spec: { label: string; options: readonly { id: string; label: string }[]; value: string; change(id: string): void }): HTMLElement {
		const row = append(parent, $('.openide-settings-fieldrow'));
		append(row, $('label.openide-settings-field-label', undefined, spec.label));
		const group = append(row, $('.openide-settings-segmented', { role: 'tablist' }));
		for (const option of spec.options) {
			const button = append(group, $('button.openide-settings-segment', { type: 'button', role: 'tab' }, option.label)) as HTMLButtonElement;
			const active = option.id === spec.value;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', String(active));
			this.store.add(addDisposableListener(button, 'click', () => spec.change(option.id)));
		}
		return group;
	}

	/** List of key/value pairs (env, headers). Secret values can be written but not displayed:
	 *  what is stored arrives masked and is only overwritten if the user types over it. */
	keyValue(parent: HTMLElement, spec: ISectionKeyValueSpec): HTMLElement {
		const box = append(parent, $('.openide-settings-kv'));
		append(box, $('.openide-settings-field-label', undefined, spec.label));
		if (spec.description) { append(box, $('.openide-settings-field-desc', undefined, spec.description)); }
		spec.rows.forEach((entry, index) => {
			const line = append(box, $('.openide-settings-kvrow'));
			const keyHost = append(line, $('.openide-settings-fieldhost'));
			const key = this.store.add(new InputBox(keyHost, undefined, {
				inputBoxStyles: openideInputBoxStyles,
				placeholder: localize('openide.section.kvName', "NAME"),
				ariaLabel: localize('openide.section.kvName', "NAME"),
			}));
			key.element.classList.add('openide-settings-mono');
			key.value = entry.k;
			this.store.add(key.onDidChange(next => { entry.k = next; }));
			const masked = !!spec.mask && entry.v === spec.mask;
			const valueHost = append(line, $('.openide-settings-fieldhost'));
			const value = this.store.add(new InputBox(valueHost, undefined, {
				inputBoxStyles: openideInputBoxStyles,
				type: spec.secret ? 'password' : 'text',
				placeholder: masked ? localize('openide.section.kvMasked', "(saved — type to replace)") : localize('openide.section.kvValue', "value"),
				ariaLabel: localize('openide.section.kvValue', "value"),
			}));
			value.value = masked ? '' : entry.v;
			this.store.add(value.onDidChange(next => { entry.v = next; value.setPlaceHolder(localize('openide.section.kvValue', "value")); }));
			this.iconButton(line, { label: localize('openide.section.kvRemove', "Quitar"), icon: 'close', run: () => { spec.rows.splice(index, 1); spec.changed(); } });
		});
		this.button(box, { label: spec.addLabel, icon: 'add', run: () => { spec.rows.push({ k: '', v: '' }); spec.changed(); } });
		return box;
	}

	/** Options dropdown — native `SelectBox`, the same widget an enum setting uses. */
	select(parent: HTMLElement, spec: { label: string; options: readonly { value: string; label: string }[]; value: string; change(value: string): void }): HTMLElement {
		const row = append(parent, $('.openide-settings-fieldrow'));
		append(row, $('label.openide-settings-field-label', undefined, spec.label));
		const host = append(row, $('.openide-settings-selecthost'));
		const values = spec.options.map(option => option.value);
		const selected = Math.max(0, values.indexOf(spec.value));
		const select = this.store.add(new SelectBox(
			spec.options.map(option => ({ text: option.label })),
			selected,
			this.contextViewService,
			openideSelectBoxStyles,
			{ ariaLabel: spec.label },
		));
		select.render(host);
		this.store.add(select.onDidSelect(event => spec.change(values[event.index])));
		return host;
	}

	/** Framed notice: something the user has to read before continuing (credentials that are not
	 *  stored, a half-finished login, a connection error). It is not a row: it configures nothing. */
	callout(parent: HTMLElement, spec: { tone?: 'warn' | 'error'; icon?: string; title: string; text?: string; actions?: readonly ISectionAction[] }): HTMLElement {
		const box = append(parent, $(`.openide-settings-callout${spec.tone ? '.' + spec.tone : ''}`));
		const title = append(box, $('.openide-settings-callout-title'));
		if (spec.icon) { append(title, $(`span.codicon.codicon-${spec.icon}`)); }
		append(title, $('span', undefined, spec.title));
		if (spec.text) { append(box, $('div', undefined, spec.text)); }
		if (spec.actions?.length) {
			const actions = append(box, $('.openide-settings-section-actions'));
			for (const action of spec.actions) { this.button(actions, action); }
		}
		return box;
	}

	/** A code to read and type somewhere else (an OAuth device-code). */
	code(parent: HTMLElement, spec: { value: string; actions?: readonly ISectionAction[] }): HTMLElement {
		const box = append(parent, $('.openide-settings-code'));
		append(box, $('span.openide-settings-code-value', undefined, spec.value));
		for (const action of spec.actions ?? []) { this.button(box, action); }
		return box;
	}

	/** Progress bar with its reading beside it (a plan's consumption, a provider's quota). */
	progress(parent: HTMLElement, spec: { label: string; detail?: string; percent: number | undefined }): HTMLElement {
		const box = append(parent, $('.openide-settings-progress'));
		const meta = append(box, $('.openide-settings-progress-meta'));
		append(meta, $('span', undefined, spec.label));
		append(meta, $('span.openide-settings-progress-detail', undefined, spec.detail ?? ''));
		const track = append(box, $('.openide-settings-progress-track'));
		const percent = typeof spec.percent === 'number' && isFinite(spec.percent) ? Math.max(0, Math.min(100, spec.percent)) : 0;
		// The colour says how much is left, not how much was used: that is what you decide from at a glance.
		const band = percent >= 90 ? 'critical' : percent >= 75 ? 'warn' : 'ok';
		const fill = append(track, $(`.openide-settings-progress-fill.${band}`));
		fill.style.width = `${percent}%`;
		return box;
	}

	/** Accordion for advanced things: it exists, it does not get in the way, and it opens only when needed. */
	disclosure(parent: HTMLElement, spec: { label: string; open: boolean; toggle(): void }): HTMLElement {
		const button = append(parent, $('button.openide-settings-disclosure', { type: 'button', 'aria-expanded': String(spec.open) })) as HTMLButtonElement;
		append(button, $(`span.codicon.codicon-chevron-${spec.open ? 'down' : 'right'}`));
		append(button, $('span', undefined, spec.label));
		this.store.add(addDisposableListener(button, 'click', () => spec.toggle()));
		return button;
	}

	/** A form's error line. Empty it takes no space: the error appears where it happens. */
	errorLine(parent: HTMLElement, message?: string): HTMLElement {
		return append(parent, $('.openide-settings-errline', undefined, message ?? ''));
	}

	iconButton(parent: HTMLElement, action: ISectionAction): HTMLButtonElement {
		const button = append(parent, $('button.openide-settings-iconbtn', { type: 'button', title: action.label, 'aria-label': action.label })) as HTMLButtonElement;
		append(button, $(`span.codicon.codicon-${action.icon ?? 'gear'}`));
		button.disabled = action.enabled === false;
		this.store.add(addDisposableListener(button, 'click', () => action.run()));
		return button;
	}

	/**
	 * Leaves visible only what matches the search. Called ONCE, from the editor, over what the
	 * section already drew: the pages never learn that a search box exists.
	 *
	 * Reglas, en orden:
	 *  - If it matches a block's header, the whole block stays (searching "Skills" must show the
	 *      skills, not filter its rows by the word "skills").
	 *  - Otherwise the matching rows survive; a block left with none goes away.
	 *  - Anything that declared no searchable text is NOT touched: we prefer showing too much over
	 *      blanking a page because it was not annotated.
	 */
	static prune(container: HTMLElement, query: string): void {
		const plain = plainSettingsQuery(query);
		if (!plain) { return; }
		for (const section of Array.from(container.querySelectorAll<HTMLElement>('.openide-settings-section'))) {
			if ((section.getAttribute(SEARCH_ATTR) ?? '').includes(plain)) { continue; }
			const rows = Array.from(section.querySelectorAll<HTMLElement>(`[${SEARCH_ATTR}]`));
			let sobrevive = 0;
			for (const row of rows) {
				if ((row.getAttribute(SEARCH_ATTR) ?? '').includes(plain)) { sobrevive++; } else { row.remove(); }
			}
			if (rows.length && !sobrevive) { section.remove(); }
		}
		// Loose rows, outside any block: same criterion.
		for (const row of Array.from(container.querySelectorAll<HTMLElement>(`:scope > [${SEARCH_ATTR}]`))) {
			if (!row.classList.contains('openide-settings-section') && !(row.getAttribute(SEARCH_ATTR) ?? '').includes(plain)) { row.remove(); }
		}
	}

	/** Native `Checkbox` — the same widget upstream's own boolean settings use. */
	toggle(parent: HTMLElement, spec: ISectionToggle): HTMLElement {
		const checkbox = this.store.add(new Checkbox(spec.title ?? '', spec.checked, openideCheckboxStyles));
		append(parent, checkbox.domNode);
		this.store.add(checkbox.onChange(() => spec.change(checkbox.checked)));
		return checkbox.domNode;
	}
}
