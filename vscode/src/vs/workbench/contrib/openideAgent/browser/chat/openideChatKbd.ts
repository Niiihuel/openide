/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../base/common/platform.js';

/** The Enter key as Cursor prints it in its buttons. One glyph everywhere, never `↩` in one place and `↵` in another. */
export const ENTER_GLYPH = '⏎';

/** The primary-action shortcut of a card: Cmd+Enter on macOS, Ctrl+Enter elsewhere. */
export const PRIMARY_ENTER_HINT = isMacintosh ? `⌘${ENTER_GLYPH}` : `Ctrl+${ENTER_GLYPH}`;

/**
 * Appends the shortcut hint of a button, in the shared `.oi-kbd` skin (openideSurfaceCss.ts).
 * Callers add nothing else: the class owns size, tone and spacing so the hints match everywhere.
 */
export function appendKbd(parent: HTMLElement, hint: string): HTMLElement {
	const kbd = append(parent, $('span.oi-kbd'));
	kbd.textContent = hint;
	return kbd;
}
