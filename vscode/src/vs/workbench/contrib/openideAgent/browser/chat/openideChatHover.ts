/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { onDidChangeOpenideLanguage } from '../../common/openideStrings.js';

/**
 * The dock's tooltip: the WORKBENCH hover widget, never the operating system's.
 *
 * Every icon in this dock used to carry a plain `title=` attribute, so the tip that came up was the
 * OS one — a different font, a different delay, a different corner, drawn outside the window and
 * unthemed. Everything else in the IDE (the title bar, the panel toolbars, the tabs) goes through
 * `IHoverService`, so the chat was the one surface that looked like it belonged to another program.
 *
 * `setupDelayedHover` and not the deprecated `setupManagedHover`: the managed hover HOLDS the text
 * it was built with and has to be `update()`d whenever that text changes, which here is constantly
 * — the strings follow the IDE language, the header repaints its tab strip wholesale, and the
 * mic/send/zen buttons rewrite their own label on every state change. The delayed hover resolves
 * its options AT HOVER TIME, so the factory below is always reading the current text and there is
 * nothing left to keep in sync.
 *
 * The text is a FACTORY and never a captured string, which is the whole point: `t('key')` read at
 * hover time follows a language change with no repaint, and a label that depends on state (busy,
 * recording, collapsed) reads the state at the moment the pointer stops.
 */

/**
 * Related chrome shares a group so moving along a row shows the next tip instantly instead of
 * re-serving the delay per button, the way a real toolbar behaves.
 */
export const OPENIDE_CHAT_HOVER_GROUP = 'openide.chat.chrome';

export interface IOpenideChatTooltipOptions {
	/** Header chrome points down, the composer points up. Falls back if there is no room. */
	readonly position?: HoverPosition;
	/**
	 * Anchors the tip at the POINTER instead of at the element's left edge.
	 *
	 * For a button the element IS the target and anchoring to it is right. For a full-width row in
	 * the transcript it is not: the tip landed at the row's own corner, which in a 280px dock reads
	 * as belonging to whatever sits above the thing being pointed at — the user pointed at one step
	 * and the tip came up over the one before it. At the pointer there is nothing to misread.
	 */
	readonly atMouse?: boolean;
	/**
	 * Whether the text is also the element's accessible name. True for controls; false for a plain
	 * `span` that reveals data it already shows in full (a path, a command), where `aria-label` is
	 * both ignored by screen readers and a duplicate of the text node.
	 */
	readonly aria?: boolean;
}

export interface IOpenideChatTooltip extends IDisposable {
	/** Re-reads the text after the state behind it changed, so `aria-label` follows the tooltip. */
	update(): void;
}

/**
 * Shows `element`'s tooltip as the workbench's own hover, and keeps its accessible name on the same
 * string. The returned disposable removes the listeners, so it belongs to the store that owns the
 * element — a per-repaint store for anything rebuilt on render.
 */
export function setupChatTooltip(hoverService: IHoverService, element: HTMLElement, text: () => string, options?: IOpenideChatTooltipOptions): IOpenideChatTooltip {
	const store = new DisposableStore();
	const aria = options?.aria !== false;
	const update = () => {
		if (aria) {
			element.setAttribute('aria-label', text());
		}
	};
	update();
	if (aria) {
		// A language change repaints nothing on its own, and the accessible name would otherwise be
		// the one string in the dock left in the old language. Only named controls subscribe: the
		// data reveals (a path, a command) are both the most numerous and the least translatable.
		store.add(onDidChangeOpenideLanguage(update));
	}
	// An empty string is how the hover service is told there is nothing to show (`_createHover`
	// returns early on it), which is what makes a text factory able to decline per hover.
	const appearance = { showPointer: true, compact: true };
	if (options?.atMouse) {
		// This overload owns the position: it derives the target from the mouse event, so passing
		// one would be a second opinion about where the tip goes.
		store.add(hoverService.setupDelayedHoverAtMouse(element, () => ({ content: text(), appearance }), { groupId: OPENIDE_CHAT_HOVER_GROUP }));
	} else {
		store.add(hoverService.setupDelayedHover(element, () => ({
			content: text(),
			position: { hoverPosition: options?.position ?? HoverPosition.ABOVE },
			appearance,
		}), { groupId: OPENIDE_CHAT_HOVER_GROUP }));
	}
	return { dispose: () => store.dispose(), update };
}

/**
 * Whether `element` is actually clipping its text.
 *
 * The reveal tooltips exist for ONE reason: a row truncates with an ellipsis and the tail of a path
 * is the half that identifies it. A tip that repeats a line the user can already read in full is
 * not a tip, it is a rectangle over the next row — which is exactly what a bare `batch_read` did.
 * `+ 1` because `scrollWidth`/`clientWidth` are rounded and a fitting line can differ by a pixel.
 */
export function isOpenideChatTextClipped(element: HTMLElement): boolean {
	return element.scrollWidth > element.clientWidth + 1;
}
