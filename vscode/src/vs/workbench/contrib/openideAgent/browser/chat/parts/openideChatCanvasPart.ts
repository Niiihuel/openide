/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IOpenideChatCanvasContent, IOpenideChatContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatCanvas.css';

export const OPENIDE_CHAT_CANVAS_CLASS = 'openide-chat-canvas-card';

/**
 * "Canvas" card: the agent wrote a `.openide/canvases/*.canvas.tsx` and this is the way in.
 *
 * Ported from the webview's `renderCanvasCard` (openideChatHtml.ts:3930-3941) and its `.canvas-*`
 * styles (:483-487). The button does what the host did for the webview's `canvasOpen` message
 * (openideChatView.ts:1098-1100): `openide.canvas.open` with the workspace-relative path, which
 * forces OUR canvas editor instead of the text editor the path would otherwise resolve to.
 *
 * The head says "Canvas creado" / "Canvas actualizado" for a card built from the LIVE event, and
 * plain "Canvas" for a restored one. That is not a hedge: `restoreCanvas`
 * (openideChatTranscriptTools.ts:137-143) reads a persisted tool call, and nothing on disk records
 * whether the file already existed. Saying "creado" about a canvas that was updated is worse than
 * not saying, so the distinction is drawn only where it is actually known.
 */
export class OpenideChatCanvasPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatCanvasContent;
	private readonly _heading: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _path: HTMLElement;

	constructor(
		content: IOpenideChatCanvasContent,
		_context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_CANVAS_CLASS}`);

		const head = append(this.domNode, $('div.openide-chat-canvas-head'));
		append(head, $('span.codicon.codicon-layout'));
		this._heading = append(head, $('span'));

		this._title = append(this.domNode, $('div.openide-chat-canvas-title'));
		this._path = append(this.domNode, $('div.openide-chat-canvas-path'));

		const open = append(this.domNode, $('button.openide-chat-canvas-open')) as HTMLButtonElement;
		open.type = 'button';
		open.textContent = 'Abrir';
		this._register(addDisposableListener(open, 'click', () => this._open()));

		this._render();
	}

	private _render(): void {
		// openideChatHtml.ts:3934 — `created === false` is "actualizado"; anything else is "creado".
		// Here `undefined` is a third case (restored, unknowable) and falls back to the bare noun.
		this._heading.textContent = this._content.created === undefined
			? 'Canvas'
			: this._content.created ? 'Canvas creado' : 'Canvas actualizado';
		// The title the model chose is preferred, and the file name is the fallback — same order as
		// the webview's `m.title || basename(path)`.
		this._title.textContent = this._content.title || basename(this._content.resource ?? '');
		const path = this._content.resource ?? '';
		this._path.textContent = path;
		this._path.title = path;
		// A canvas with no resolved path has nothing to open and no path to print: hide the line
		// rather than leave an empty row that looks like a rendering bug.
		this._path.classList.toggle('hidden', !path);
	}

	private _open(): void {
		const path = this._content.resource;
		if (!path) {
			return;
		}
		this._commandService.executeCommand('openide.canvas.open', path).then(undefined, () => {
			// Canvas deleted or renamed since the turn ran. The card keeps saying what happened; an
			// error toast for a file the user can find in the explorer is noise.
		});
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'canvas')
			&& other.canvasId === this._content.canvasId
			&& other.title === this._content.title
			&& other.created === this._content.created
			&& other.resource === this._content.resource;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		// Only the SAME canvas may be absorbed: a second `canvas_write` is its own row in the
		// transcript, exactly as the webview appended a second card.
		if (!isOpenideChatContentOfKind(other, 'canvas') || other.canvasId !== this._content.canvasId) {
			return false;
		}
		this._content = other;
		this._render();
		return true;
	}
}

/** Last path segment. Trailing slashes cannot occur here — the path always names a `.canvas.tsx`. */
function basename(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? path : path.slice(index + 1);
}
