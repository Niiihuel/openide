/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section appended BELOW the native rows of a Settings category.
 *
 *  For what the configuration schema CANNOT express: editors with their own validation, live
 *  diagnostics, and surfaces that are not configuration at all (skills and MCP servers are
 *  files on disk). This is NOT a webview — it renders into the workbench DOM and reuses the
 *  Settings CSS, so it inherits theme, typography and focus without copying anything.
 *
 *  Anything that IS a config key must be registered via `registerConfiguration` and rendered as
 *  a native row (search, per-scope reset, policy indicator): the section declares in
 *  `ownedSettings` only the keys it draws itself, so they are not rendered twice.
 *
 *  Para construir el contenido usar `OpenideSectionRenderer` (openideSettingsSectionBuilder):
 *  emits the SAME row anatomy as the native list. That is what stops every page from
 *  reinventing its own buttons and switches — exactly how the webviews drifted apart.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IOpenideSettingsNavigationEntry } from '../common/openideSettingsTypes.js';

export interface IOpenideSettingsSectionContext {
	/** Scope selected in the header tabs. File-backed pages use it to choose between the
	 *  workspace directory and the user-global one. */
	readonly scope: 'user' | 'workspace';
	/** Header search text, already normalized. Empty = no filter. */
	readonly query: string;
	/** Navigation id being rendered. Equals the section's own category on its index page, or one
	 *  of its `navigationChildren` when the user drilled into a sub-page.
	 *  Optional because several sections re-render themselves with a context of their own and
	 *  have no sub-pages to distinguish; absent means "the section's index page". */
	readonly category?: string;
	/** Navigates the editor to another page. A section with sub-pages needs it so its index can
	 *  link into them; without it the index would be a list nobody can follow. */
	readonly navigate?: (category: string) => void;
}

export interface IOpenideSettingsSection extends IDisposable {
	/** Keys this section renders itself: they are hidden from the native list. */
	readonly ownedSettings: readonly string[];
	/**
	 * Sub-pages this section contributes under its own category, if any.
	 *
	 * A section owns a list the schema cannot express, and some of those lists are long enough
	 * that stacking every entry on one page stops being readable — the providers page put ten
	 * expandable blocks in a single scroll, so reaching the last one meant scrolling past every
	 * account form above it. Declaring children here turns each entry into its own page, and the
	 * breadcrumb makes the nesting legible.
	 *
	 * The list is dynamic (a provider can be added in settings), so it is read on every nav
	 * render and the section fires `onDidChangeNavigation` when it changes.
	 */
	readonly navigationChildren?: readonly IOpenideSettingsNavigationEntry[];
	readonly onDidChangeNavigation?: Event<void>;
	/** Repaints inside `container`. Called on every editor render: must be idempotent. */
	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void;
}
