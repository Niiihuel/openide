/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — installs the shared surface CSS into the workbench document.
 *
 *  The webviews inline `OPENIDE_SURFACE_CSS` themselves; the native surfaces cannot, because a
 *  `.css` file and a TypeScript string are different loaders. This bridges that: the same text
 *  the chat inlines is appended once to <head>, so Settings uses the very tokens and primitives
 *  the webviews use instead of its own copy.
 *
 *  Idempotent, so any surface can ask for it without coordinating who calls first.
 *
 *  It lives next to `openideSurfaceCss.ts` and not in `openideSettings/` any more: the native
 *  chat needs the very same tokens, and a chat that had to import its stylesheet installer from
 *  the Settings contrib would make the dependency point the opposite way to the ownership.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { OPENIDE_SURFACE_CSS } from './openideSurfaceCss.js';

let installed = false;

export function applyOpenideSurfaceCss(): void {
	if (installed) {
		return;
	}
	installed = true;
	// Never removed: the tokens outlive whichever editor happened to ask for them first.
	createStyleSheet(undefined, style => {
		style.id = 'openide-surface-css';
		style.textContent = OPENIDE_SURFACE_CSS;
	});
}
