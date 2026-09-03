/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IChatImage } from '../../common/openideAgentTypes.js';
import { t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';
import { hydrateChatImages, needsChatImageHydration } from './openideChatImageHydration.js';
import { createCodicon } from './openideComposerMenu.js';

/** The formats the file dialog accepts, exactly as the webview's `<input accept>` lists them. */
export const ATTACH_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const ATTACH_MIME = /^image\/(png|jpeg|gif|webp)$/;
/** Six is the webview's ceiling; more than that stops being context and starts being an album. */
export const ATTACH_LIMIT = 6;

/**
 * Reads one picked file into the in-memory shape `IChatMessage.images` carries.
 *
 * Exported because the composer is no longer the only surface that accepts an image: the `ask_user`
 * card takes them too, and a second copy of "is it an image, read it as base64, strip the data:
 * prefix" is how the two would end up disagreeing about which formats are allowed.
 */
export async function readChatImage(file: File): Promise<IChatImage | undefined> {
	if (!ATTACH_MIME.test(file.type)) {
		return undefined;
	}
	const url = await new Promise<string>(resolve => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => resolve('');
		reader.readAsDataURL(file);
	});
	const comma = url.indexOf(',');
	return comma < 0 ? undefined : { mimeType: file.type, data: url.slice(comma + 1) };
}

/**
 * Image attachments of the composer: the strip of thumbnails plus the reading of the files.
 *
 * Images are held in memory as base64, which is what `IChatMessage.images` carries. Durable copies
 * (`persistChatImages`) belong to the turn that is actually sent, not to the composer.
 */
export class OpenideChatComposerAttachments extends Disposable {

	private readonly _strip: HTMLElement;
	private readonly _input: HTMLInputElement;
	/** Cleared on every paint: the chips are thrown away and rebuilt, and their listeners with them. */
	private readonly _chipStore = this._register(new DisposableStore());
	private _images: IChatImage[] = [];
	/** Bumped by every mutation, so a hydration that comes back late knows the strip moved on. */
	private _generation = 0;

	get images(): readonly IChatImage[] { return this._images; }
	get isEmpty(): boolean { return this._images.length === 0; }
	get inputElement(): HTMLInputElement { return this._input; }

	constructor(
		strip: HTMLElement,
		inputHost: HTMLElement,
		private readonly hoverService: IHoverService,
		private readonly fileService: IFileService,
		/** Re-evaluates the send/mic slot: attachments alone are enough to make a turn sendable. */
		private readonly onDidChange: () => void,
	) {
		super();
		this._strip = strip;
		this._strip.hidden = true;
		this._input = append(inputHost, inputHost.ownerDocument.createElement('input'));
		this._input.type = 'file';
		this._input.accept = ATTACH_ACCEPT;
		this._input.multiple = true;
		this._input.style.display = 'none';
		this._register(addDisposableListener(this._input, 'change', () => {
			for (const file of Array.from(this._input.files ?? [])) { void this.addFile(file); }
			// Cleared so choosing the SAME file twice in a row still fires `change`.
			this._input.value = '';
		}));
	}

	/**
	 * Puts back the images of a turn. Replaces rather than appends: the composer cleared the strip
	 * when it handed the turn over, so there is nothing to merge with.
	 *
	 * The images may come from a RESTORED transcript, in which case `persist` has already stripped
	 * their base64 (openideChatSessions.ts:203) and only an `assetUri` is left. Those are read back
	 * here: painting them as-is put `src="data:image/png;base64,"` on the chip — the broken-image
	 * glyph — and submitting them sent the provider an attachment with no bytes in it.
	 */
	restore(images: readonly IChatImage[]): void {
		if (!images.length && !this._images.length) {
			return;
		}
		this._images = [...images];
		const generation = ++this._generation;
		this._render();
		if (needsChatImageHydration(this._images)) {
			void this._hydrate(generation);
		}
	}

	/**
	 * Fills in the base64 of the restored attachments and repaints.
	 *
	 * An image whose asset is gone is DROPPED rather than kept as a blank chip: it can no longer be
	 * shown nor sent, and leaving it in would put an unusable attachment in the next turn. This is
	 * the same call the request bubble makes when it filters on `image.data`
	 * (openideChatRequestBubble.ts:105).
	 */
	private async _hydrate(generation: number): Promise<void> {
		const hydrated = await hydrateChatImages(this.fileService, this._images);
		// The user removed a chip, sent the turn or restored another one while the assets were being
		// read: this result belongs to a strip that no longer exists.
		if (generation !== this._generation) {
			return;
		}
		this._images = hydrated.filter(image => !!image.data);
		this._render();
	}

	/** Opens the native file dialog. The button lives in the input row, not here. */
	pick(): void {
		this._input.click();
	}

	/** Returns true when the paste carried images, so the caller can swallow the event. */
	addFromDataTransfer(data: DataTransfer | null): boolean {
		let captured = false;
		for (const item of Array.from(data?.items ?? [])) {
			if (item.kind !== 'file' || !item.type.startsWith('image/')) { continue; }
			const file = item.getAsFile();
			if (file) { captured = true; void this.addFile(file); }
		}
		return captured;
	}

	async addFile(file: File): Promise<void> {
		if (this._images.length >= ATTACH_LIMIT) {
			return;
		}
		const image = await readChatImage(file);
		if (!image) {
			return;
		}
		this._images.push(image);
		this._generation++;
		this._render();
	}

	clear(): void {
		if (!this._images.length) {
			return;
		}
		this._images = [];
		this._generation++;
		this._render();
	}

	private _render(): void {
		const document = this._strip.ownerDocument;
		this._chipStore.clear();
		clearNode(this._strip);
		this._strip.hidden = !this._images.length;
		this._images.forEach((image, index) => {
			const chip = append(this._strip, document.createElement('div'));
			chip.className = 'openide-attach-chip';
			// While the asset is being read there is nothing to show: an `<img>` with an empty src
			// paints the broken-image glyph, so the chip stays an empty frame until the bytes land.
			chip.classList.toggle('pending', !image.data);
			if (image.data) {
				const thumbnail = append(chip, document.createElement('img'));
				thumbnail.src = `data:${image.mimeType};base64,${image.data}`;
			}
			const remove = append(chip, document.createElement('button'));
			remove.type = 'button';
			remove.className = 'openide-attach-remove';
			this._chipStore.add(setupChatTooltip(this.hoverService, remove, () => t('chat.attach.remove')));
			remove.appendChild(createCodicon(document, 'close'));
			// Re-rendered from the array rather than removing the node: the indices of the chips
			// after this one shift, and stale closures would delete the wrong image next time.
			this._chipStore.add(addDisposableListener(remove, 'click', () => {
				this._images.splice(index, 1);
				this._generation++;
				this._render();
			}));
		});
		this.onDidChange();
	}
}
