/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../../base/browser/dom.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IOpenideChatContent, IOpenideChatScreenshotContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatScreenshot.css';

export const OPENIDE_CHAT_SHOT_CLASS = 'openide-chat-shot-card';

/**
 * A browser screenshot, inline.
 *
 * Ported from the webview's `renderScreenshot` (openideChatHtml.ts:3081-3095) and its `.shot-*`
 * styles (:1239-1244): a header row and a clickable thumbnail capped at 260px, because a full page
 * capture at natural size would be several screens of chat on its own.
 *
 * Clicking opens the SAME full-screen modal the diagrams use rather than the webview's home-made
 * lightbox: it already has zoom, pan and fit, its CSP allows `img-src data:`, and it is the only
 * viewer the native chat has. The webview needed its own because it could not open an editor.
 *
 * The base64 is NOT persisted (openideChatHtml.ts:3079-3080), so this row only ever appears in a
 * live turn — a restored conversation has no screenshot content to render.
 */
export class OpenideChatScreenshotPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _image: HTMLImageElement;

	private _content: IOpenideChatScreenshotContent;

	constructor(
		content: IOpenideChatScreenshotContent,
		_context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_SHOT_CLASS}`);

		const head = append(this.domNode, $('div.openide-chat-shot-head'));
		append(head, $('span.codicon.codicon-device-camera'));
		const label = append(head, $('span'));
		label.textContent = 'Captura';

		const body = append(this.domNode, $('button.openide-chat-shot-body')) as HTMLButtonElement;
		body.type = 'button';
		body.title = 'Ampliar';
		this._image = append(body, $('img')) as HTMLImageElement;
		this._image.alt = 'Captura de pantalla';
		// The thumbnail is decorative until it loads, and the list measured the row before that
		// happened: without this the card stays at the height of an empty box.
		this._register(addDisposableListener(this._image, 'load', () => this._onDidChangeHeight.fire()));
		this._register(addDisposableListener(body, 'click', () => this._openFullscreen()));

		this._render();
	}

	private _render(): void {
		const uri = screenshotDataUri(this._content);
		this._image.src = uri;
		// `renderScreenshot` bails on `!m.data` before it builds anything, and this is the same bail:
		// an empty card would be a bordered box with a broken-image glyph in it.
		this.domNode.classList.toggle('hidden', !uri);
	}

	private _openFullscreen(): void {
		const uri = screenshotDataUri(this._content);
		if (!uri) {
			return;
		}
		// A typed payload: the viewer sets `img.src` itself, so `mimeType`/`data` from the tool's
		// output can never become markup.
		this._commandService.executeCommand('openide.diagram.fullscreen', { kind: 'image', uri, alt: 'Captura de pantalla' }, 'Captura')
			.then(undefined, () => {
				// The modal failed to open; the thumbnail is still on screen.
			});
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'screenshot')
			&& other.callId === this._content.callId
			&& other.image.data === this._content.image.data
			&& other.image.mimeType === this._content.image.mimeType;
	}

	/**
	 * Absorbs a new capture from the same call.
	 *
	 * `applyOpenideChatScreenshot` pushes one content per `screenshot` event, so in practice the data
	 * never changes under a mounted part — but hydration rewrites `data` in place elsewhere in the
	 * chat, and swapping an `src` is cheaper and less disruptive than rebuilding the row.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'screenshot') || other.callId !== this._content.callId) {
			return false;
		}
		this._content = other;
		this._render();
		return true;
	}
}

/** Image mime types only: the tag is an `<img>`, and anything else is a mislabelled payload. */
const SAFE_MIME = /^image\/[a-z0-9.+-]+$/i;

/** Base64's alphabet plus the whitespace some encoders wrap lines with. */
const SAFE_BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/**
 * The `data:` URI, or the empty string when the payload does not look like one.
 *
 * Empty is a real outcome: an image whose base64 was stripped on persist arrives with `data: ''`,
 * and an `<img>` with an empty `src` paints the broken-image glyph — `_render` hides the card.
 */
function screenshotDataUri(content: IOpenideChatScreenshotContent): string {
	const { mimeType, data } = content.image;
	if (!data || !SAFE_BASE64.test(data)) {
		return '';
	}
	const mime = SAFE_MIME.test(mimeType) ? mimeType : 'image/png';
	return `data:${mime};base64,${data}`;
}
