/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { OPENIDE_GLYPH_THINKING } from '../../common/openideGlyphs.js';
import { OPENIDE_REASONING_EFFORTS } from '../../common/openideReasoning.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { IModelReasoning } from '../openideModelCatalog.js';
import { createMenuContent, createMenuRow, createMenuSection, OpenideComposerPopover } from './openideComposerMenu.js';

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

export function reasoningEffortLabel(value: string): string {
	return OPENIDE_REASONING_EFFORTS.find(entry => entry[0] === value)?.[1] ?? OPENIDE_REASONING_EFFORTS[0][1];
}

/**
 * Levels the ACTIVE model publishes. `undefined` means the registry is cold or silent, and then
 * everything is offered: hiding a level the model does support is worse than showing one it
 * silently clamps.
 */
export function availableReasoningEfforts(published: IModelReasoning | undefined): readonly (readonly [string, string])[] {
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

/** Effort popover: one flat list, no submenu. The effort is session-wide, not per model. */
export class OpenideChatEffortPicker extends Disposable {

	private readonly _popover: OpenideComposerPopover;
	private _published: IModelReasoning | undefined;

	constructor(
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		private readonly onDidChangeEffort: () => void,
	) {
		super();
		this._popover = this._register(new OpenideComposerPopover(contextViewService));
	}

	setPublishedReasoning(published: IModelReasoning | undefined): void {
		this._published = published;
	}

	get options(): readonly (readonly [string, string])[] {
		return availableReasoningEfforts(this._published);
	}

	toggle(anchor: HTMLElement): void {
		this._popover.toggle(anchor, {
			className: 'openide-menu-effort',
			render: (container, store) => {
				const document = container.ownerDocument;
				const content = createMenuContent(document);
				container.appendChild(content);
				content.appendChild(createMenuSection(document, localize('openide.chat.effort.section', "Razonamiento")));
				const current = this.agentService.getReasoningEffort() || '';
				for (const [value, label] of this.options) {
					// No fallback glyph on the inactive rows: the webview leaves the slot empty so the
					// checked one is the only mark the eye has to find.
					const row = createMenuRow(document, { icon: value === current ? 'check' : undefined, label });
					store.add(addDisposableListener(row, 'click', () => {
						this._popover.close();
						void this.agentService.setReasoningEffort(value);
						this.onDidChangeEffort();
					}));
					content.appendChild(row);
				}
			},
		});
	}

	close(): void {
		this._popover.close();
	}
}
