/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM controls for setting values. Complex schemas deliberately fall back to JSON.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { openideInputBoxStyles } from '../../openideAgent/browser/openideControlStyles.js';
import { IOpenideSettingItem } from '../common/openideSettingsTypes.js';
import { SettingValueType } from '../../../services/preferences/common/preferences.js';
import { t } from '../../openideAgent/common/openideStrings.js';

/**
 * The ⓘ next to a setting title (OpenChamber's info-hint convention): explanatory prose never
 * renders in the row — it would make every page a wall of text — and lives behind a small hint
 * that opens on hover AND on click, so it also works on touch. The content goes through the
 * workbench hover service: themed, positioned, and torn down with the row.
 */
export function appendSettingsInfoHint(hoverService: IHoverService, store: DisposableStore, parent: HTMLElement, content: string): HTMLElement {
	const hint = append(parent, $('button.openide-settings-hint', { type: 'button', 'aria-label': t('settings.item.moreInfo') }));
	append(hint, $('span.codicon.codicon-info'));
	const hover = store.add(hoverService.setupManagedHover(getDefaultHoverDelegate('element'), hint, content));
	hint.addEventListener('click', event => {
		event.stopPropagation();
		hover.show(true);
	});
	return hint;
}

import { OpenideSettingsDropdown } from './openideSettingsDropdown.js';
import { OpenideSettingsToggle } from './openideSettingsToggle.js';
export interface IOpenideSettingControl {
	readonly element: HTMLElement;
	readonly onChange?: (listener: (value: unknown) => void) => void;
	/** A setting editable only in another scope is shown read-only. Each widget disables itself its
	 *  own way — `<input>.disabled`, `OpenideSettingsDropdown.setEnabled`, `Button.enabled` — so the row asks the
	 *  control instead of guessing from the DOM. */
	readonly setEnabled?: (enabled: boolean) => void;
}

/**
 * The control for one setting row.
 *
 * Text and numbers are upstream's `InputBox`, the JSON fallback upstream's `Button`: hand-rolled
 * copies of those drifted from their theming, focus rings and high-contrast handling. The two
 * controls that are the product's own — the dropdown and the switch — each keep the shape rule 4
 * of docs/theming-surfaces.md protects (one element, one border, one focus ring) and say in their
 * own file why the native widget was not the right one. The widgets are disposables, so the
 * caller passes the store that owns the row.
 */
export function createSettingControl(item: IOpenideSettingItem, openJson: () => void, store: DisposableStore, contextViewService: IContextViewService): IOpenideSettingControl {
	const value = item.value.targetValue !== undefined ? item.value.targetValue : item.value.effective;
	if (item.type === SettingValueType.Boolean) {
		// A switch, not upstream's `Checkbox`: see openideSettingsToggle.ts for why that departs
		// from the native-widget rule and what it keeps of it.
		const toggle = store.add(new OpenideSettingsToggle(item.label, !!value));
		return {
			element: toggle.domNode,
			onChange: listener => store.add(toggle.onChange(checked => listener(checked))),
			setEnabled: enabled => toggle.setEnabled(enabled),
		};
	}
	if (item.type === SettingValueType.Enum) {
		const candidates = (item.setting.enum || []).map(String);
		// Labels only, as Cursor: the enum descriptions made every row a sentence and the menu as
		// wide as the page. They stay reachable through the row's hint.
		const options = candidates.map((candidate, index) => ({
			label: item.setting.enumItemLabels?.[index] || candidate,
		}));
		const selected = Math.max(0, candidates.indexOf(String(value)));
		// The product's popover, not `SelectBox`: see openideSettingsDropdown.ts for why.
		const select = store.add(new OpenideSettingsDropdown(options, selected, contextViewService, item.label));
		const host = $('.openide-settings-selecthost');
		select.render(host);
		return {
			element: host,
			onChange: listener => store.add(select.onDidSelect(event => listener(candidates[event.index]))),
			setEnabled: enabled => select.setEnabled(enabled),
		};
	}
	if (item.type === SettingValueType.String || item.type === SettingValueType.MultilineString || item.type === SettingValueType.Integer || item.type === SettingValueType.Number || item.type === SettingValueType.NullableInteger || item.type === SettingValueType.NullableNumber) {
		const numeric = item.type === SettingValueType.Integer || item.type === SettingValueType.Number || item.type === SettingValueType.NullableInteger || item.type === SettingValueType.NullableNumber;
		const host = $('.openide-settings-inputhost');
		const input = store.add(new InputBox(host, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			ariaLabel: item.label,
			type: numeric ? 'number' : 'text',
			flexibleHeight: item.type === SettingValueType.MultilineString,
			flexibleWidth: false,
		}));
		input.value = value === undefined || value === null ? '' : String(value);
		return {
			element: host,
			onChange: listener => store.add(input.onDidChange(raw => listener(numeric ? (raw === '' ? null : Number(raw)) : raw))),
			setEnabled: enabled => enabled ? input.enable() : input.disable(),
		};
	}
	// Schemas with no honest widget (objects, arrays of objects) keep sending the user to the JSON.
	const host = $('.openide-settings-jsonhost');
	const button = store.add(new Button(host, { ...defaultButtonStyles, secondary: true, title: t('settings.item.editJson') }));
	// Same primitive as every section button (openideSettingsSectionBuilder.ts): the widget paints
	// its colours inline, `.oi-btn` gives it the product's height, padding and radius.
	button.element.classList.add('oi-btn');
	button.label = t('settings.item.editJson');
	store.add(button.onDidClick(openJson));
	return { element: host, setEnabled: enabled => button.enabled = enabled };
}
