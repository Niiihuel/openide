/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OPENIDE_GLYPH_THINKING } from '../../common/openideGlyphs.js';
import { OPENIDE_REASONING_EFFORTS } from '../../common/openideReasoning.js';
import { IModelReasoning } from '../openideModelCatalog.js';
import { OpenideStringKey, t } from '../../common/openideStrings.js';

/**
 * What a reasoning level IS, shared by everything that shows one.
 *
 * The popover that used to live here is gone: the effort is per model now, so it is edited on the
 * model's own row in the picker (`openideChatModelEffort.ts`) and there is no session-wide control
 * left to open. What remains is the vocabulary — the glyph, the label, and which levels a given
 * model will actually honour.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pulled out of the shared constant so the artwork is never transcribed by hand. */
function glyphAttribute(name: string): string {
	return new RegExp(`${name}="([^"]*)"`).exec(OPENIDE_GLYPH_THINKING)?.[1] ?? '';
}

/**
 * The reasoning glyph, built from the same constant the webview inlines.
 *
 * Not re-drawn — the `viewBox` and the path come out of `OPENIDE_GLYPH_THINKING`, because two
 * copies of the artwork drift and the composer and the webview have to be the same picture. Built
 * node by node rather than through `DOMParser.parseFromString`, which the workbench's Trusted
 * Types policy blocks: doing it that way threw inside `renderBody` and took the WHOLE chat view
 * down with it ("Fail to render view workbench.view.openideChat.view"). A real SVG element also
 * keeps `currentColor` following the trigger's colour, the way it does inside the iframe.
 */
export function createThinkingGlyph(document: Document): Element {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'oi-glyph');
	svg.setAttribute('viewBox', glyphAttribute('viewBox'));
	svg.setAttribute('width', '14');
	svg.setAttribute('height', '14');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('fill', 'currentColor');
	path.setAttribute('d', glyphAttribute('d'));
	svg.appendChild(path);
	return svg;
}

/** The level's label in the IDE's language. The list stores keys, so this is where the locale
 *  is applied — once, at the two places that draw a level. */
export function reasoningEffortLabel(value: string): string {
	return t(OPENIDE_REASONING_EFFORTS.find(entry => entry[0] === value)?.[1] ?? OPENIDE_REASONING_EFFORTS[0][1]);
}

/**
 * The level as the composer's model chip wears it.
 *
 * Same word as the menu for every graded level — they are the API's own, and short. The exception
 * is the model's own default, whose menu label is a sentence ("Model default") that ate the model's
 * NAME out of the chip beside it at any ordinary dock width. On the chip it is "Auto": the chip has
 * room for one word, and the menu is where the full phrase belongs.
 */
export function reasoningEffortChipLabel(value: string): string {
	return value ? reasoningEffortLabel(value) : t('chat.effort.auto');
}

/**
 * Levels the ACTIVE model publishes. `undefined` means the registry is cold or silent, and then
 * everything is offered: hiding a level the model does support is worse than showing one it
 * silently clamps.
 */
export function availableReasoningEfforts(published: IModelReasoning | undefined): readonly (readonly [string, OpenideStringKey])[] {
	if (!published) {
		return OPENIDE_REASONING_EFFORTS;
	}
	if (!published.efforts.length) {
		// Toggle-only model: it grades nothing, so on/off is the whole menu.
		return published.toggle ? OPENIDE_REASONING_EFFORTS.filter(entry => entry[0] === '' || entry[0] === 'none') : OPENIDE_REASONING_EFFORTS;
	}
	return OPENIDE_REASONING_EFFORTS.filter(entry => entry[0] === '' || published.efforts.includes(entry[0]) || (entry[0] === 'none' && published.toggle));
}

/** True when the control is worth showing at all — an effort the model ignores is worse than none. */
export function reasoningControlVisible(connected: boolean, published: IModelReasoning | undefined): boolean {
	return connected && !!published && (published.efforts.length > 0 || published.toggle);
}
