/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../../base/common/actions.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { streamToBuffer } from '../../../../base/common/buffer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IMarkdownRendererService, openLinkFromMarkdown } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { asTextOrError, IRequestService, isSuccess } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ShowCurrentReleaseNotesActionId } from '../common/update.js';
import { IParsedUpdateInfoInput, parseUpdateInfoInput } from '../common/updateInfoParser.js';
import { getUpdateInfoUrl, isMajorMinorVersionChange } from '../common/updateUtils.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import './media/postUpdateWidget.css';

const LAST_KNOWN_VERSION_KEY = 'postUpdateWidget/lastKnownVersion';

/** Ceiling for a banner clip. A few seconds of muted, cover-cropped 16:5 footage is well under it. */
const MAX_BANNER_VIDEO_BYTES = 12 * 1024 * 1024;

interface ILastKnownVersion {
	readonly version: string;
	readonly commit: string | undefined;
	readonly timestamp: number;
}

/**
 * Displays post-update call-to-action widget after a version change is detected.
 */
export class PostUpdateWidgetContribution extends Disposable implements IWorkbenchContribution {

	private static idCounter = 0;

	constructor(
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHostService private readonly hostService: IHostService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();

		if (isWeb) {
			return; // Electron only
		}

		this._register(CommandsRegistry.registerCommand('_update.showUpdateInfo', (_accessor, markdown?: string) => this.showUpdateInfo(markdown)));
		void this.tryShowOnStartup();
	}

	private async tryShowOnStartup() {
		if (!await this.hostService.hadLastFocus()) {
			return;
		}

		if (!this.detectVersionChange()) {
			return;
		}

		if (this.configurationService.getValue<boolean>('update.showPostInstallInfo') === false) {
			return;
		}

		await this.showUpdateInfo();
	}

	private async showUpdateInfo(markdown?: string) {
		const info = await this.getUpdateInfo(markdown);
		if (!info) {
			return;
		}

		const contentDisposables = new DisposableStore();
		const target = this.layoutService.mainContainer;
		const { clientWidth } = target;
		const maxWidth = 420;
		const x = Math.max(clientWidth - maxWidth - 80, 16);

		this.hoverService.showInstantHover({
			content: this.buildContent(info, contentDisposables),
			target: {
				targetElements: [target],
				x,
				y: 40,
				dispose: () => contentDisposables.dispose()
			},
			additionalClasses: ['post-update-widget-hover'],
			persistence: { sticky: true },
			appearance: { showPointer: false, compact: true, maxHeightRatio: 1 },
			trapFocus: true,
		}, true);
	}

	private async getUpdateInfo(input?: string | null): Promise<IParsedUpdateInfoInput | undefined> {
		if (!input) {
			try {
				const url = getUpdateInfoUrl(this.productService.version);
				const context = await this.requestService.request({ url, callSite: 'postUpdateWidget' }, CancellationToken.None);
				input = await asTextOrError(context);
			} catch { }
		}

		if (!input) {
			return undefined;
		}

		let info = parseUpdateInfoInput(input);
		if (!info?.buttons?.length) {
			info = {
				...info, buttons: [{
					label: localize('postUpdate.releaseNotes', "Release Notes"),
					commandId: ShowCurrentReleaseNotesActionId,
					args: [this.productService.version],
					style: 'secondary'
				}]
			};
		}

		return info;
	}

	/**
	 * Puts a short clip in the banner, when the note asked for one.
	 *
	 * NOT `video.src = url`. The workbench document's CSP is `media-src 'self' blob:`, so a remote
	 * URL on a media element is refused, silently, with no error anywhere -- the banner would just
	 * stay empty and nobody would know why. It is fetched through the request service (which already
	 * carries this window's proxy and certificate handling, and is what fetches the note itself) and
	 * handed to the element as a blob. The renderer therefore never reaches the network for media on
	 * its own: the one thing it can play is a buffer the app already inspected.
	 *
	 * Everything here degrades to "no video": a rejected URL, a failed request, a body over the cap,
	 * a content type that is not video, a hover closed mid-download. In each case the banner keeps
	 * whatever it already had -- the poster, the note's image, or the derived default. A clip is an
	 * embellishment on a card that has to read fine without it.
	 */
	private attachBannerVideo(banner: HTMLElement, url: string | undefined, disposables: DisposableStore): void {
		const safeUrl = sanitizeBannerVideoUrl(url);
		if (!safeUrl) {
			return;
		}

		// Reduced motion means "do not put moving pictures on my screen". The poster (or the plain
		// banner) already says everything this card needs to say, so the clip is simply not fetched
		// -- downloading megabytes to then not play them would be the worst of both.
		if (this.accessibilityService.isMotionReduced()) {
			return;
		}

		const cts = new CancellationTokenSource();
		disposables.add(toDisposable(() => cts.dispose(true)));

		(async () => {
			let objectUrl: string | undefined;
			try {
				const context = await this.requestService.request({ url: safeUrl, callSite: 'postUpdateWidget.bannerVideo' }, cts.token);
				if (!isSuccess(context)) {
					return;
				}
				const type = context.res.headers['content-type'];
				if (typeof type === 'string' && !/^video\//i.test(type)) {
					return;
				}
				const buffer = await streamToBuffer(context.stream);
				// A banner clip is a few seconds of muted video. The cap is what separates that from
				// a note pointing the updater at a file large enough to matter, on a card the user
				// did not ask for and cannot see loading.
				if (buffer.byteLength > MAX_BANNER_VIDEO_BYTES) {
					return;
				}
				if (cts.token.isCancellationRequested || !banner.isConnected) {
					return;
				}

				// The `as Uint8Array<ArrayBuffer>` is the repo's convention for handing a VSBuffer's
				// bytes to a DOM API (dom.ts:1689, chatImageUtils.ts:28): `BlobPart` demands a plain
				// ArrayBuffer and the buffer's type parameter is the wider ArrayBufferLike.
				const blob = new Blob([buffer.buffer as Uint8Array<ArrayBuffer>], { type: typeof type === 'string' ? type : 'video/mp4' });
				objectUrl = URL.createObjectURL(blob);
				const revoke = objectUrl;
				disposables.add(toDisposable(() => URL.revokeObjectURL(revoke)));

				const video = dom.append(banner, dom.$('video.banner-video')) as HTMLVideoElement;
				video.muted = true;          // an autoplaying clip with sound is never acceptable, and
				video.autoplay = true;       // a browser refuses to autoplay one that is not muted
				video.loop = true;
				video.playsInline = true;
				video.controls = false;
				video.setAttribute('aria-hidden', 'true');
				video.src = objectUrl;
				// The mark is a watermark for the DEFAULT banner; over the note's own footage it is
				// somebody else's logo stamped on the picture.
				banner.classList.add('has-image');
				// Autoplay can still be refused by policy. Nothing to recover: the poster underneath
				// is already the right thing to show.
				video.play().catch(() => undefined);
			} catch {
				// Same outcome as every other failure above: the banner keeps what it had.
			}
		})();
	}

	private buildContent(info: IParsedUpdateInfoInput, disposables: DisposableStore): HTMLElement {
		const { markdown, buttons, bannerImageUrl, bannerVideoUrl, bannerPosterUrl, badge, title, features } = info;
		const container = dom.$('.post-update-widget');
		const titleId = `post-update-widget-title-${PostUpdateWidgetContribution.idCounter++}`;
		container.setAttribute('role', 'dialog');
		container.setAttribute('aria-labelledby', titleId);
		// Escape-to-dismiss is handled by the hover widget itself (HoverWidget listens for Escape
		// on its container and disposes the hover).

		// Banner (decorative). Default is a CSS gradient; an image from the markdown frontmatter overrides it.
		const banner = dom.append(container, dom.$('.banner'));
		banner.setAttribute('aria-hidden', 'true');
		// A poster stands in for a clip while it loads, and replaces it outright under reduced
		// motion -- so it is resolved before the image and wins over it for the same slot.
		const safeBannerUrl = sanitizeBannerImageUrl(bannerPosterUrl) ?? sanitizeBannerImageUrl(bannerImageUrl);
		if (safeBannerUrl) {
			// Use setProperty + JSON.stringify to safely quote the URL inside CSS without breaking out.
			banner.style.setProperty('background-image', `url(${JSON.stringify(safeBannerUrl)})`);
			// The default banner paints the product mark in a ::after layer, which an inline
			// background-image does not replace. Without this the logo stays stamped over the
			// note's own art.
			banner.classList.add('has-image');
		}
		this.attachBannerVideo(banner, bannerVideoUrl, disposables);

		// Close button is a sibling of the banner so it isn't a focusable descendant of an aria-hidden region.
		const closeButton = dom.append(container, dom.$('button.banner-close')) as HTMLButtonElement;
		closeButton.setAttribute('aria-label', localize('postUpdate.close', "Close"));
		const closeIcon = dom.append(closeButton, dom.$(ThemeIcon.asCSSSelector(Codicon.close)));
		closeIcon.setAttribute('aria-hidden', 'true');
		disposables.add(dom.addDisposableListener(closeButton, 'click', () => {
			this.hoverService.hideHover(true);
		}));

		// Body
		const body = dom.append(container, dom.$('.body'));

		// Badge
		if (badge) {
			const badgeEl = dom.append(body, dom.$('.badge'));
			badgeEl.textContent = badge;
		}

		// Title
		const titleEl = dom.append(body, dom.$('.title'));
		titleEl.id = titleId;
		titleEl.textContent = title ?? localize('postUpdate.title', "New in {0}", this.productService.version);

		// Features (preferred) or markdown body
		if (features?.length) {
			const list = dom.append(body, dom.$('.features'));
			list.setAttribute('role', 'list');
			for (const feature of features) {
				const row = dom.append(list, dom.$('.feature'));
				row.setAttribute('role', 'listitem');
				const iconEl = dom.append(row, dom.$('.feature-icon'));
				const iconId = feature.icon ?? Codicon.sparkle.id;
				const themeIcon = ThemeIcon.fromId(iconId);
				iconEl.classList.add(...ThemeIcon.asClassNameArray(themeIcon));
				iconEl.setAttribute('aria-hidden', 'true');
				const text = dom.append(row, dom.$('.feature-text'));
				const featureTitle = dom.append(text, dom.$('.feature-title'));
				featureTitle.textContent = feature.title;
				const featureDescription = dom.append(text, dom.$('.feature-description'));
				// Render description as markdown so it can include inline links and emphasis.
				const rendered = disposables.add(this.markdownRendererService.render(
					new MarkdownString(feature.description, {
						isTrusted: true,
						supportThemeIcons: true,
					}),
					{
						actionHandler: (link, mdStr) => {
							openLinkFromMarkdown(this.openerService, link, mdStr.isTrusted);
							this.hoverService.hideHover(true);
						},
					}));
				featureDescription.appendChild(rendered.element);
			}
		} else if (markdown) {
			const markdownContainer = dom.append(body, dom.$('.update-markdown'));
			const rendered = disposables.add(this.markdownRendererService.render(
				new MarkdownString(markdown, {
					isTrusted: true,
					supportHtml: true,
					supportThemeIcons: true,
				}),
				{
					actionHandler: (link, mdStr) => {
						openLinkFromMarkdown(this.openerService, link, mdStr.isTrusted);
						this.hoverService.hideHover(true);
					},
				}));
			markdownContainer.appendChild(rendered.element);
		}

		// Buttons
		if (buttons?.length) {
			const buttonBar = dom.append(body, dom.$('.button-bar'));
			const isSingleButton = buttons.length === 1;
			let seenSecondary = false;

			for (const { label, style, commandId, args } of buttons) {
				const button = dom.append(buttonBar, dom.$('button')) as HTMLButtonElement;
				button.textContent = label;

				if (style === 'secondary') {
					button.classList.add('update-button-secondary');
					if (!seenSecondary && buttons.length > 1) {
						button.classList.add('update-button-leading-secondary');
						seenSecondary = true;
					}
				} else {
					button.classList.add('update-button-primary');
				}

				if (isSingleButton) {
					button.classList.add('update-button-full-width');
				}

				disposables.add(dom.addDisposableListener(button, 'click', () => {
					this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>(
						'workbenchActionExecuted',
						{ id: commandId, from: 'postUpdateWidget' }
					);

					void this.commandService.executeCommand(commandId, ...(args ?? []));
					this.hoverService.hideHover(true);
				}));
			}
		}

		return container;
	}

	private detectVersionChange(): boolean {
		let from: ILastKnownVersion | undefined;
		try {
			from = this.storageService.getObject(LAST_KNOWN_VERSION_KEY, StorageScope.APPLICATION);
		} catch { }

		const to: ILastKnownVersion = {
			version: this.productService.version,
			commit: this.productService.commit,
			timestamp: Date.now(),
		};

		if (from?.commit === to.commit) {
			return false;
		}

		this.storageService.store(LAST_KNOWN_VERSION_KEY, JSON.stringify(to), StorageScope.APPLICATION, StorageTarget.MACHINE);

		if (from) {
			return isMajorMinorVersionChange(from.version, to.version);
		}

		return false;
	}
}

/**
 * Validates a banner video URL from update info.
 *
 * `https:` only -- deliberately narrower than the image rule, which also takes `data:`. A data URI
 * is base64, so a clip embedded that way would be a third larger than the file AND would sit inside
 * the note, where it would be downloaded on every check whether or not the card is ever shown.
 */
function sanitizeBannerVideoUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const uri = URI.parse(value, true);
		if (uri.scheme === 'https') {
			return uri.toString(true);
		}
	} catch {
		// fall through
	}
	return undefined;
}

/**
 * Validates a banner image URL from update info. Only `https:` and `data:image/*` schemes are
 * allowed to prevent CSS-injection or unexpected protocol handlers being invoked from the markdown payload.
 */
function sanitizeBannerImageUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const uri = URI.parse(value, true);
		if (uri.scheme === 'https') {
			return uri.toString(true);
		}
		if (uri.scheme === 'data' && /^image\//i.test(uri.path)) {
			return uri.toString(true);
		}
	} catch {
		// fall through
	}
	return undefined;
}
