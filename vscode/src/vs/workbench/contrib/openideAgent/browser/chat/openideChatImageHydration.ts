/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64 } from '../../../../../base/common/buffer.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IChatImage, IChatMessage } from '../../common/openideAgentTypes.js';

/**
 * Reads the attachments of a restored conversation back from disk.
 *
 * `OpenideChatSessions.persist` strips the base64 of every image it managed to write as an asset
 * (browser/openideChatSessions.ts:158-161), so a thread loaded from storage carries `data: ''` and
 * an `assetUri`. The request bubble skips images with no data on purpose — an `<img>` with an empty
 * `src` paints the broken-image glyph — so without this step every attachment silently disappears
 * on reload. The webview view has done this since forever (`hydrateConversationImages`,
 * browser/openideChatView.ts:1704-1717); the native chat simply never had an equivalent.
 *
 * The messages are mutated IN PLACE, exactly like the webview view does, because they are the
 * store's own objects: hydrating the copy would make the next restore pay for the same reads again.
 */
export async function hydrateOpenideChatImages(fileService: IFileService, messages: readonly IChatMessage[]): Promise<boolean> {
	let hydrated = false;
	for (const message of messages) {
		if (!needsChatImageHydration(message.images)) {
			continue;
		}
		const images = await hydrateChatImages(fileService, message.images!);
		// Only a read that actually landed is worth a repaint: when the assets are gone every
		// image comes back untouched and rebuilding the transcript would paint the same thing.
		hydrated ||= images.some((image, index) => image !== message.images![index]);
		message.images = images;
	}
	return hydrated;
}

/** True when at least one image lost its base64 to `persist` and can be read back from its asset. */
export function needsChatImageHydration(images: readonly IChatImage[] | undefined): boolean {
	return !!images?.some(image => !image.data && !!image.assetUri);
}

/**
 * Reads the assets of ONE list of images, returning a new array.
 *
 * Split out of `hydrateOpenideChatImages` because the transcript is no longer the only consumer:
 * the composer restores attachments straight from a transcript item (editing a turn, a rollback,
 * a rejected send) and those carry `data: ''` just the same. An image whose asset cannot be read
 * comes back unchanged, so the caller decides whether to keep it or drop it.
 */
export async function hydrateChatImages(fileService: IFileService, images: readonly IChatImage[]): Promise<IChatImage[]> {
	return Promise.all(images.map(async image => {
		if (image.data || !image.assetUri) {
			return image;
		}
		try {
			const file = await fileService.readFile(URI.parse(image.assetUri));
			return { ...image, data: encodeBase64(file.value) };
		} catch {
			// A deleted or unreadable asset must not take the whole transcript down: the message
			// still restores, just without its thumbnail.
			return image;
		}
	}));
}

/**
 * Stores a turn's attachments outside `state.vscdb`, as the webview host's `persistChatImages`
 * does (browser/openideChatView.ts): the message keeps a durable `assetUri` and the base64 stays
 * in memory only while the window is open. Falls back to the in-memory copy file by file, so a
 * folder that cannot be created never costs the user their image — the store keeps the base64
 * when there is no `assetUri`.
 */
export async function persistOpenideChatImages(fileService: IFileService, folder: URI, messageId: string, images: readonly IChatImage[]): Promise<IChatImage[]> {
	if (!images.length) {
		return [];
	}
	try {
		await fileService.createFolder(folder);
	} catch {
		return images.map(image => ({ ...image }));
	}
	return Promise.all(images.map(async (image, index) => {
		if (image.assetUri || !image.data) {
			return { ...image };
		}
		const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice('image/'.length);
		const resource = joinPath(folder, `${messageId}-${index}.${extension}`);
		try {
			await fileService.writeFile(resource, decodeBase64(image.data), { atomic: { postfix: '.openide-chat-image' } });
			return { ...image, assetUri: resource.toString() };
		} catch {
			return { ...image };
		}
	}));
}
