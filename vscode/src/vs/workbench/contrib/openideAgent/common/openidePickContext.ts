/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBrowserPickResult } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { IChatImage } from './openideAgentTypes.js';

/**
 * What a Pick & Polish selection contributes to the next turn.
 *
 * Lifted out of `openideChatView.ts:625-637`, where it was inline in the webview host's
 * subscription and therefore reachable by exactly one of the two chat renderers. The prose below
 * is a PROMPT: it tells the agent which flow to follow for the element the user pointed at, and a
 * second, drifting copy written for the native chat would mean the same click produces different
 * agent behaviour depending on a rendering setting.
 */
export interface IOpenidePickAttachment {
	/** What the chip shows. */
	readonly selector: string;
	/** Appended to the turn's `context`, never to the system prompt. */
	readonly context: string;
	/** The element's screenshot, when the pick could capture one. Travels as a normal attachment. */
	readonly image?: IChatImage;
}

/**
 * A Design Mode pick comes from a canvas, not from an app in the browser: there the browser tools
 * do not apply and the change is made by editing the `.canvas.tsx`.
 */
function isCanvasPick(pageUrl: string): boolean {
	return /\.canvas\.tsx$/.test(pageUrl);
}

/** The prose handed to the agent. Exported for the tests; callers want `toOpenidePickAttachment`. */
export function buildOpenidePickContext(pick: IBrowserPickResult): string {
	const styles = pick.styles ? `\nEstilos computados relevantes:\n${pick.styles}` : '';
	if (isCanvasPick(pick.pageUrl)) {
		return `\n\n[Design Mode — elemento seleccionado por el usuario en el canvas]\nCanvas: ${pick.pageUrl}\nSelector: ${pick.selector}\nHTML renderizado:\n${pick.html}${styles}\nFlujo sugerido: ubicá en el archivo del canvas el componente que produce ese HTML (buscá por el texto o el className del elemento) y editalo con edit_file. El canvas se recompila y recarga solo al guardar.`;
	}
	return `\n\n[Pick & Polish — elemento seleccionado por el usuario en su app local]\nPágina: ${pick.pageUrl}\nSelector: ${pick.selector}\nHTML:\n${pick.html}${styles}\nFlujo sugerido: aplicá el cambio EN VIVO primero (browser_navigate a la página, browser_set_style sobre el selector, browser_screenshot para validar el antes/después) y después llevalo al CÓDIGO FUENTE (ubicá el componente con search_text por clase/texto/testid y editá con edit_file).`;
}

export function toOpenidePickAttachment(pick: IBrowserPickResult): IOpenidePickAttachment {
	return {
		selector: pick.selector,
		context: buildOpenidePickContext(pick),
		// The in-page pick carries no screenshot: its rect is relative to the preview iframe and
		// cannot be captured cleanly from outside.
		image: pick.screenshotBase64 ? { mimeType: 'image/jpeg', data: pick.screenshotBase64 } : undefined,
	};
}
