/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../../base/browser/dom.js';
import { toAction } from '../../../../../../base/common/actions.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IClipboardService } from '../../../../../../platform/clipboard/common/clipboardService.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IBrowserViewWorkbenchService } from '../../../../browserView/common/browserView.js';
import { IOpenideChatContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatWebPreview, webPreviewFromTool } from '../../../common/chat/openideChatWebPreview.js';
import { t } from '../../../common/openideStrings.js';
import { OpenideChatContentPart } from '../openideChatContentPart.js';
import { OpenideChatResourceCard } from '../openideChatResourceCard.js';

export class OpenideChatWebPreviewPart extends OpenideChatContentPart {
	readonly domNode: HTMLElement;
	private opening = false;
	constructor(
		private readonly preview: IOpenideChatWebPreview,
		@IBrowserViewWorkbenchService browsers: IBrowserViewWorkbenchService,
		@IOpenerService opener: IOpenerService,
		@IClipboardService clipboard: IClipboardService,
		@IHoverService hover: IHoverService,
		@IContextMenuService menus: IContextMenuService,
		@INotificationService notifications: INotificationService,
	) {
		super();
		const open = async (modal: boolean) => {
			if (this.opening || this._store.isDisposed) { return; }
			this.opening = true;
			try {
				await browsers.openPreview(preview.url, undefined, { targetWindowId: getWindow(this.domNode).vscodeWindowId, modal, reveal: true });
			} catch (error) { notifications.error(error); }
			finally { this.opening = false; }
		};
		const card = this._register(new OpenideChatResourceCard({
			compact: true,
			compactStatus: t('chatSurface.resource.opening'),
			title: preview.title || t('chatSurface.resource.web'),
			description: preview.url,
			icon: Codicon.globe,
			open: () => { void open(false); },
			expand: () => { void open(true); },
			actions: [
				toAction({ id: 'preview.panel', label: t('chatSurface.resource.panel'), class: 'codicon codicon-layout-sidebar-right', run: () => open(false) }),
				toAction({ id: 'preview.full', label: t('chatSurface.resource.full'), class: 'codicon codicon-screen-full', run: () => open(true) }),
				toAction({ id: 'preview.external', label: t('chatSurface.resource.external'), class: 'codicon codicon-link-external', run: async () => { await opener.open(URI.parse(preview.url), { openExternal: true, allowCommands: false }); } }),
				toAction({ id: 'preview.copy', label: t('chatSurface.resource.copy'), class: 'codicon codicon-copy', run: () => clipboard.writeText(preview.url) }),
			],
		}, hover, menus));
		this.domNode = card.domNode;
	}
	hasSameContent(other: IOpenideChatContent): boolean {
		const next = webPreviewFromTool(other);
		return next?.url === this.preview.url && next?.title === this.preview.title;
	}
}
