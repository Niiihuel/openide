/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatDiagramContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { renderOpenideDiagram } from '../../diagrams/openideDiagramRender.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import '../media/openideChatDiagram.css';

export const OPENIDE_CHAT_DIAGRAM_CLASS = 'openide-chat-diagram';

/**
 * A ```mermaid fence, drawn.
 *
 * Ported from the webview's `buildDiagramOrCodeHtml` / `renderDiagramResult`
 *. Everything that makes the picture lives in browser/diagrams/ —
 * this part is only the row: the frame, the full-screen button and the code fallback.
 *
 * The one thing it does NOT copy is the webview's round trip. There, parsing runs in the extension
 * host and the fence shows a "generating" placeholder until the spec comes back over `postMessage`;
 * here the engine is a plain import (common/diagrams/openideDiagramEngine.ts) that runs in the same
 * frame, so there is nothing to wait for and no placeholder to show.
 */
export class OpenideChatDiagramPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatDiagramContent;

	constructor(
		content: IOpenideChatDiagramContent,
		_context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_DIAGRAM_CLASS}`);
		this._render();
	}

	private _render(): void {
		// The button is rebuilt with the picture, so its listener has to go with the old one: this is
		// what the late-disposable store is for. Registering on `this` instead would pile up one dead
		// listener per re-render for the lifetime of the row.
		this.clearLateDisposables();
		clearNode(this.domNode);

		const render = renderOpenideDiagram(this.domNode.ownerDocument, this._content.source);
		if (!render) {
			this._renderFallback();
			return;
		}
		this.domNode.appendChild(render.domNode);

		if (!render.svg) {
			return;
		}
		// Only a diagram that IS one `<svg>` gets the full-screen affordance; the viewer re-renders
		// the SOURCE with this same engine, so nothing rendered ever travels as markup.
		const source = this._content.source;
		const button = $('button.openide-diagram-full') as HTMLButtonElement;
		button.type = 'button';
		// Late disposable, like the click listener: the button is rebuilt with the picture.
		this.addDisposable(setupChatTooltip(this._hoverService, button, () => t('plan.diagram.fullscreen')));
		append(button, $('span.codicon.codicon-screen-full'));
		// Prepended, not appended: it is absolutely positioned and must not be the last child of the
		// scroll box, or it would count towards the scrolled width.
		render.domNode.insertBefore(button, render.domNode.firstChild);

		this.addDisposable(addDisposableListener(button, 'click', () => {
			this._commandService.executeCommand('openide.diagram.fullscreen', { kind: 'source', source }, 'Diagrama')
				.then(undefined, () => {
					// The modal failed to open. The diagram is already on screen at its natural size,
					// so there is nothing to tell the user that they cannot already see.
				});
		}));
	}

	/**
	 * Not a diagram after all: show the source.
	 *
	 * `buildDiagramOrCodeHtml` falls back to a code block for exactly this case, and it must stay a
	 * fallback and not an error — the parsers are hand-written and cover a subset of mermaid, so
	 * "unsupported" is an ordinary outcome the reader can still act on by reading the source.
	 */
	private _renderFallback(): void {
		const wrap = append(this.domNode, $('div.openide-chat-diagram-code'));
		const pre = append(wrap, $('pre'));
		pre.textContent = this._content.source;
	}

	/**
	 * Compares the SOURCE, not the rendered picture.
	 *
	 * Re-parsing and re-laying out a graph is the most expensive thing any part does, and a response
	 * that is still streaming re-renders its rows on every delta; without this the diagram would be
	 * rebuilt dozens of times and flicker through each one.
	 */
	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'diagram')
			&& other.source === this._content.source
			&& other.syntax === this._content.syntax;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'diagram')) {
			return false;
		}
		this._content = other;
		this._render();
		// The new picture is almost never the same size as the old one, and the list measured the old.
		this._onDidChangeHeight.fire();
		return true;
	}
}
