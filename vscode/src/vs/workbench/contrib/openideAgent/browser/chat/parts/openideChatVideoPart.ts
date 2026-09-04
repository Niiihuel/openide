/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { IOpenideChatContent, IOpenideChatVideoContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { formatFlowTime } from '../../../common/openideBrowserRecorder.js';
import { bytesToBlob } from '../../openideFlowVideo.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { setupChatTooltip } from '../openideChatHover.js';
import '../media/openideChatVideo.css';

export const OPENIDE_CHAT_VIDEO_CLASS = 'openide-chat-video-card';

/**
 * A recorded browser flow, inline: the video with its own controls, and under it one thumbnail
 * per step that seeks to that moment. The "Enlarge" control opens the SAME full-screen modal
 * the screenshots and the diagrams use, with the video playing in it.
 *
 * The transcript stores paths, not pixels (openideAgentTypes.ts, `IPersistedFlowVideo`): the
 * files are read from disk when the card mounts and handed to the elements as blob: URLs, which
 * the workbench CSP allows for both `media-src` and `img-src`. A restored session therefore gets
 * its recordings back — unlike a screenshot, whose base64 is not persisted — and a recording the
 * user deleted shows a one-line notice instead of a broken player.
 */
export class OpenideChatVideoPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private _content: IOpenideChatVideoContent;
	private readonly _body: HTMLElement;
	private readonly _steps: HTMLElement;
	private readonly _findings: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _meta: HTMLElement;
	private _video: HTMLVideoElement | undefined;
	private _videoUrl: string | undefined;
	private _posterUrl: string | undefined;
	private readonly _thumbUrls: string[] = [];
	private _generation = 0;

	constructor(
		content: IOpenideChatVideoContent,
		_context: IOpenideChatContentPartContext,
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_VIDEO_CLASS}`);

		const head = append(this.domNode, $('div.openide-chat-video-head'));
		append(head, $('span.codicon.codicon-device-camera-video'));
		this._title = append(head, $('span.openide-chat-video-title'));
		this._meta = append(head, $('span.openide-chat-video-meta'));
		const actions = append(head, $('span.openide-chat-video-actions'));
		const folder = append(actions, $('button.openide-chat-video-iconbtn', { type: 'button' })) as HTMLButtonElement;
		append(folder, $('span.codicon.codicon-folder-opened'));
		this._register(setupChatTooltip(_hoverService, folder, () => t('chat.video.openFolder')));
		this._register(addDisposableListener(folder, 'click', () => this._openFolder()));
		const enlarge = append(actions, $('button.openide-chat-video-iconbtn', { type: 'button' })) as HTMLButtonElement;
		append(enlarge, $('span.codicon.codicon-screen-full'));
		this._register(setupChatTooltip(_hoverService, enlarge, () => t('chat.part.enlarge')));
		this._register(addDisposableListener(enlarge, 'click', () => this._openFullscreen()));

		this._body = append(this.domNode, $('div.openide-chat-video-body'));
		this._findings = append(this.domNode, $('div.openide-chat-video-findings'));
		this._steps = append(this.domNode, $('div.openide-chat-video-steps'));

		this._render();
	}

	private _render(): void {
		const video = this._content.video;
		// "Recording · demo form" on the left, the numbers on the right: the label is what the user
		// asked for, the duration and the step count are the receipt.
		this._title.textContent = video.label && video.label !== 'flow' ? `${t('chat.video.title')} · ${video.label}` : t('chat.video.title');
		this._meta.textContent = `${formatFlowTime(video.durationMs)} · ${t('chat.video.steps', video.steps.length)}`;
		void this._load();
	}

	/** Reads the files and builds the player. A newer render invalidates an older, slower load. */
	private async _load(): Promise<void> {
		const generation = ++this._generation;
		this._revokeAll();
		clearNode(this._body);
		this._paintFindings();
		clearNode(this._steps);
		const video = this._content.video;

		const poster = await this._blobUrl(video.sheetPath, 'image/jpeg');
		const source = video.videoPath ? await this._blobUrl(video.videoPath, 'video/webm') : undefined;
		if (generation !== this._generation || this._store.isDisposed) {
			return;
		}
		this._posterUrl = poster;
		this._videoUrl = source;

		if (!poster && !source) {
			append(this._body, $('div.openide-chat-video-notice', undefined, t('chat.video.missing')));
			this._onDidChangeHeight.fire();
			return;
		}

		if (source) {
			const player = append(this._body, $('video.openide-chat-video-player')) as HTMLVideoElement;
			player.src = source;
			if (poster) {
				player.poster = poster;
			}
			player.controls = true;
			player.muted = true;
			player.loop = true;
			player.playsInline = true;
			player.preload = 'metadata';
			this._register(addDisposableListener(player, 'loadedmetadata', () => this._onDidChangeHeight.fire()));
			this._video = player;
		} else {
			// No video on this build: the sheet stands in, with the reason underneath.
			const image = append(this._body, $('img.openide-chat-video-sheet')) as HTMLImageElement;
			image.src = poster!;
			image.alt = '';
			this._register(addDisposableListener(image, 'load', () => this._onDidChangeHeight.fire()));
			append(this._body, $('div.openide-chat-video-notice', undefined, t('chat.video.noVideo')));
		}

		// One thumbnail per step. Clicking seeks: the frame IS the moment, so the thumbnail is
		// the natural scrubber for a flow — better than guessing a second on the timeline.
		for (let index = 0; index < video.steps.length; index++) {
			const step = video.steps[index];
			const url = await this._blobUrl(step.file, 'image/jpeg');
			if (generation !== this._generation || this._store.isDisposed) {
				return;
			}
			if (!url) {
				continue;
			}
			const button = append(this._steps, $('button.openide-chat-video-step', { type: 'button' })) as HTMLButtonElement;
			const thumb = append(button, $('img')) as HTMLImageElement;
			thumb.src = url;
			thumb.alt = '';
			const caption = append(button, $('span.openide-chat-video-step-caption'));
			caption.textContent = `${index + 1} · ${formatFlowTime(step.t)}`;
			const describe = () => t('chat.video.seek', index + 1, step.label ? `${step.kind} · ${step.label}` : step.kind);
			this._register(setupChatTooltip(this._hoverService, button, describe));
			this._register(addDisposableListener(button, 'click', () => this._seek(step.t)));
		}
		this._onDidChangeHeight.fire();
	}

	/**
	 * The measured problems, as buttons that seek. This is the whole reason the recorder measures
	 * anything: a reviewer handed ninety seconds of video does not find a 400 ms stall, and does
	 * not have to — the tape already knows when it happened, so the card offers the second.
	 *
	 * Page findings have no timestamp (they describe the state at the end, not a moment), so they
	 * are listed without a seek rather than sent to an arbitrary time.
	 */
	private _paintFindings(): void {
		clearNode(this._findings);
		const video = this._content.video;
		const motion = video.findings ?? [];
		const page = video.lint ?? [];
		this._findings.classList.toggle('hidden', !motion.length && !page.length);
		if (!motion.length && !page.length) {
			return;
		}
		for (const finding of motion) {
			const chip = append(this._findings, $('button.openide-chat-video-finding', { type: 'button' })) as HTMLButtonElement;
			append(chip, $('span.codicon.codicon-warning'));
			append(chip, $('span', undefined, `${formatFlowTime(finding.t)} · ${finding.kind}`));
			this._register(setupChatTooltip(this._hoverService, chip, () => finding.detail));
			this._register(addDisposableListener(chip, 'click', () => this._seek(finding.t)));
		}
		for (const finding of page) {
			const chip = append(this._findings, $('span.openide-chat-video-finding.static'));
			append(chip, $('span.codicon.codicon-eye'));
			append(chip, $('span', undefined, finding.kind));
			this._register(setupChatTooltip(this._hoverService, chip, () => `${finding.selector}\n${finding.detail}`));
		}
	}

	private _seek(t: number): void {
		if (!this._video) {
			return;
		}
		this._video.currentTime = Math.max(0, t / 1000);
		void this._video.play().catch(() => { /* autoplay policy: the frame is shown anyway */ });
	}

	private async _blobUrl(path: string, type: string): Promise<string | undefined> {
		if (!path) {
			return undefined;
		}
		try {
			const content = await this._fileService.readFile(URI.file(path));
			const url = URL.createObjectURL(bytesToBlob(content.value.buffer, type));
			this._thumbUrls.push(url);
			return url;
		} catch {
			return undefined;
		}
	}

	private _revokeAll(): void {
		for (const url of this._thumbUrls) {
			URL.revokeObjectURL(url);
		}
		this._thumbUrls.length = 0;
		this._video = undefined;
		this._videoUrl = undefined;
		this._posterUrl = undefined;
	}

	private _openFullscreen(): void {
		if (!this._videoUrl && !this._posterUrl) {
			return;
		}
		const payload = this._videoUrl
			? { kind: 'video', uri: this._videoUrl, poster: this._posterUrl }
			: { kind: 'image', uri: this._posterUrl, alt: t('chat.video.title') };
		this._commandService.executeCommand('openide.diagram.fullscreen', payload, `${t('chat.video.title')}${this._content.video.label ? ` · ${this._content.video.label}` : ''}`)
			.then(undefined, () => {
				// The modal failed to open; the inline player is still there.
			});
	}

	private _openFolder(): void {
		const dir = this._content.video.dir;
		if (!dir) {
			return;
		}
		// The workbench's own "Reveal in File Explorer/Finder": it goes through the native host, so
		// it opens the OS file manager on the folder rather than asking the opener to guess.
		this._commandService.executeCommand('revealFileInOS', URI.file(dir))
			.then(undefined, () => this._openerService.open(URI.file(dir), { openExternal: true }).catch(() => { }));
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'video')
			&& other.callId === this._content.callId
			&& other.video.videoPath === this._content.video.videoPath
			&& other.video.sheetPath === this._content.video.sheetPath;
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'video') || other.callId !== this._content.callId) {
			return false;
		}
		this._content = other;
		this._render();
		return true;
	}

	override dispose(): void {
		this._revokeAll();
		super.dispose();
	}
}
