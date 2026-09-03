/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideSettingsNavigationEntry } from './openideSettingsTypes.js';

/** The slice of a settings item the navigation needs to decide where — and whether — it shows. */
export interface IOpenideSettingRef {
	readonly key: string;
	readonly groupId: string;
	readonly extensionId?: string;
	/** `extensionInfo.displayName`: the name the user knows the extension by. */
	readonly extensionLabel?: string;
}

/**
 * Whether a setting is something the user can navigate to and edit.
 *
 * Extensions ship `configurationDefaults` — `[typescript]: { editor.wordWrap: … }` — and the
 * preferences model surfaces every one of them as a setting in a `defaultOverrides` group whose
 * category label is, literally, "defaultOverrides". They are not settings: they are per-language
 * overrides the extension applies on the user's behalf, with no name, no description and no
 * editor. The sidebar showed one "defaultOverrides" row per extension that had them.
 */
export function isOpenideNavigableSetting(ref: IOpenideSettingRef): boolean {
	return !ref.key.startsWith('[') && ref.groupId !== 'defaultOverrides';
}

/** `publisher.some-extension-name` → `Some extension name`, for extensions without a displayName. */
export function humanizeExtensionId(id: string): string {
	const tail = id.split('.').pop() || id;
	const words = tail.replace(/[-_]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/**
 * One "Extensions" node with a sub-page per extension that contributes real settings, labelled
 * by the extension's display name. Undefined when nothing qualifies, so the group does not appear.
 */
export function buildOpenideExtensionsNavigation(refs: readonly IOpenideSettingRef[], label: string): IOpenideSettingsNavigationEntry | undefined {
	const byExtension = new Map<string, string>();
	for (const ref of refs) {
		if (!ref.extensionId || !isOpenideNavigableSetting(ref)) {
			continue;
		}
		const existing = byExtension.get(ref.extensionId);
		// A displayName from any of the extension's settings beats a humanized id.
		if (!existing || (ref.extensionLabel && existing === humanizeExtensionId(ref.extensionId))) {
			byExtension.set(ref.extensionId, ref.extensionLabel || humanizeExtensionId(ref.extensionId));
		}
	}
	if (!byExtension.size) {
		return undefined;
	}
	return {
		id: 'extensions',
		label,
		children: [...byExtension]
			.sort((a, b) => a[1].localeCompare(b[1]))
			.map(([id, name]) => ({ id: `extensions/${id}`, label: name, settings: [`@ext:${id}`] })),
	};
}

/** A navigation label the user can read: not empty, not a raw identifier such as `defaultOverrides`. */
export function isReadableNavigationLabel(label: string): boolean {
	const trimmed = label.trim();
	if (!trimmed) {
		return false;
	}
	// camelCase / dotted / bracketed identifiers are what leaked before; real labels have a space,
	// a capital initial or are a single plain word.
	if (/^\[.*\]$/.test(trimmed) || trimmed.includes('.') || /^[a-z]+[A-Z]/.test(trimmed)) {
		return false;
	}
	return true;
}
