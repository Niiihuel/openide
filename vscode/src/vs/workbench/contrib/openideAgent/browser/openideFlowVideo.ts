/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — turns the recorder's JPEG frames into a WebM and a contact sheet.
 *
 *  This is the only part of the recording that needs a browser: WebCodecs for the encode and a
 *  canvas for the sheet. Both are here in the workbench renderer, which is why the frames travel
 *  from the Playwright process to this side instead of being encoded where they were captured.
 *
 *  The video is variable frame rate on purpose. A screencast only emits when something painted,
 *  so a page that sits still for two seconds produced no frames — and the right video for that is
 *  one where the last frame simply stays, which VFR gives for free. Padding with duplicates would
 *  cost bytes to say nothing.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../../base/common/buffer.js';
import { IFlowFrame, IKeyFrame, formatFlowTime } from '../common/openideBrowserRecorder.js';
import { IFrameSignature } from '../common/openideVisualAnalysis.js';
import { IWebmChunk, muxWebm } from '../common/openideWebm.js';

export interface IEncodedFlow {
	readonly webm: Uint8Array;
	readonly codec: 'vp8' | 'vp9';
	readonly width: number;
	readonly height: number;
	readonly durationMs: number;
}

/** JPEG bytes out of a recorder frame. */
export function frameBytes(frame: IFlowFrame): Uint8Array {
	return decodeBase64(frame.data).buffer;
}

/**
 * A Blob over a copy of the bytes. The copy is deliberate: `BlobPart` wants a view over a real
 * `ArrayBuffer`, and what `VSBuffer` hands out is typed over `ArrayBufferLike` — a fresh
 * `Uint8Array` is the cheapest thing that satisfies both the type and the runtime.
 */
export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
	return new Blob([new Uint8Array(bytes)], { type });
}

/** Key frames at most every this often: seeking lands close, the file stays small. */
const KEY_FRAME_INTERVAL_MS = 2000;

/** Both dimensions even: VP8/VP9 4:2:0 subsampling wants it, and some players refuse odd sizes. */
function evenDimension(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

async function pickCodec(width: number, height: number): Promise<{ codec: 'vp9' | 'vp8'; config: VideoEncoderConfig } | undefined> {
	if (typeof VideoEncoder === 'undefined') {
		return undefined;
	}
	const candidates: { codec: 'vp9' | 'vp8'; id: string }[] = [
		{ codec: 'vp9', id: 'vp09.00.10.08' },
		{ codec: 'vp8', id: 'vp8' },
	];
	for (const candidate of candidates) {
		const config: VideoEncoderConfig = { codec: candidate.id, width, height, latencyMode: 'quality' };
		try {
			const support = await VideoEncoder.isConfigSupported(config);
			if (support.supported) {
				return { codec: candidate.codec, config };
			}
		} catch {
			// An unknown codec string throws on some builds; the next candidate may not.
		}
	}
	return undefined;
}

/**
 * Encodes the frames into a WebM. Frames are decoded one at a time (a two-minute recording
 * decoded up front would be hundreds of bitmaps in memory), scaled to the size of the first one
 * when a navigation changed the viewport mid-way, and handed to the encoder with their own
 * timestamps.
 */
export async function encodeFlowWebm(frames: readonly IFlowFrame[], fps: number): Promise<IEncodedFlow> {
	if (!frames.length) {
		throw new Error('No frames were captured.');
	}
	const first = await createImageBitmap(bytesToBlob(frameBytes(frames[0]), 'image/jpeg'));
	const width = evenDimension(first.width);
	const height = evenDimension(first.height);
	first.close();

	const picked = await pickCodec(width, height);
	if (!picked) {
		throw new Error('This build cannot encode video (WebCodecs VP8/VP9 unavailable).');
	}

	const chunks: IWebmChunk[] = [];
	let encodeError: Error | undefined;
	const encoder = new VideoEncoder({
		output: chunk => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			chunks.push({ data, timeMs: chunk.timestamp / 1000, keyFrame: chunk.type === 'key' });
		},
		error: error => { encodeError = error; },
	});
	// Roughly 0.1 bit per pixel per frame: crisp UI text at 1280×800 / 12 fps lands near 1 Mbps.
	const bitrate = Math.max(400_000, Math.min(6_000_000, Math.round(width * height * fps * 0.1)));
	encoder.configure({ ...picked.config, bitrate, framerate: fps });

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	const framePeriodMs = Math.round(1000 / Math.max(1, fps));
	let lastKeyAt = -Infinity;
	let lastT = -1;
	try {
		for (let i = 0; i < frames.length; i++) {
			const frame = frames[i];
			// Timestamps must strictly increase: two frames stamped inside the same millisecond
			// (a burst after a navigation) are nudged apart rather than dropped.
			const t = Math.max(frame.t, lastT + 1);
			lastT = t;
			const next = frames[i + 1];
			const duration = Math.max(1, (next ? Math.max(next.t, t + 1) : t + framePeriodMs) - t);
			const bitmap = await createImageBitmap(bytesToBlob(frameBytes(frame), 'image/jpeg'));
			let source: ImageBitmap | OffscreenCanvas = bitmap;
			if ((bitmap.width !== width || bitmap.height !== height) && context) {
				context.drawImage(bitmap, 0, 0, width, height);
				source = canvas;
			}
			const videoFrame = new VideoFrame(source, { timestamp: t * 1000, duration: duration * 1000 });
			const keyFrame = t - lastKeyAt >= KEY_FRAME_INTERVAL_MS;
			if (keyFrame) {
				lastKeyAt = t;
			}
			encoder.encode(videoFrame, { keyFrame });
			videoFrame.close();
			bitmap.close();
			// Back-pressure: the encoder queues internally; let it drain rather than pile up.
			while (encoder.encodeQueueSize > 6) {
				await new Promise(resolve => setTimeout(resolve, 4));
			}
			if (encodeError) {
				throw encodeError;
			}
		}
		await encoder.flush();
	} finally {
		try { encoder.close(); } catch { /* already closed on error */ }
	}
	if (encodeError) {
		throw encodeError;
	}
	chunks.sort((a, b) => a.timeMs - b.timeMs);
	const durationMs = Math.round(lastT + framePeriodMs);
	return { webm: muxWebm(chunks, { codec: picked.codec, width, height, durationMs }), codec: picked.codec, width, height, durationMs };
}

// ---- Frame signatures ----------------------------------------------------------------------

/** The grid every frame is reduced to. 32x18 is 576 cells: coarse enough to ignore JPEG noise and
 *  text antialiasing, fine enough to tell a spinner in a corner from the whole page repainting. */
const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 18;

/** Above this, signatures are computed on an even sample. 900 frames is 75 s of a 12 fps capture;
 *  past it the decode starts to cost more than the answer is worth, and the answer does not
 *  improve — every finding here is about stretches of time, not about individual frames. */
const SIGNATURE_MAX_FRAMES = 900;

/** Decodes in small batches: a thousand `createImageBitmap` calls at once will exhaust the
 *  decoder's queue on a machine that is also running the encode. */
const SIGNATURE_BATCH = 8;

/**
 * A frame reduced to a luma grid, for `analyseFlow`.
 *
 * The resize is asked of `createImageBitmap` rather than done on the canvas: the decoder can scale
 * while it decodes, which is the difference between decoding a 1280x800 JPEG and decoding a
 * thumbnail. It is the only reason measuring a whole recording is affordable at all.
 */
async function signatureOf(frame: IFlowFrame, ctx: OffscreenCanvasRenderingContext2D): Promise<IFrameSignature> {
	const bitmap = await createImageBitmap(bytesToBlob(frameBytes(frame), 'image/jpeg'), {
		resizeWidth: SIGNATURE_WIDTH,
		resizeHeight: SIGNATURE_HEIGHT,
		resizeQuality: 'low',
	});
	ctx.drawImage(bitmap, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
	bitmap.close();
	const { data } = ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
	const cells = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
	for (let i = 0; i < cells.length; i++) {
		const p = i * 4;
		// Rec. 709 luma. Colour is not what any of the motion checks ask about, and one channel
		// per cell is four times less to compare.
		cells[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) | 0;
	}
	return { t: frame.t, gw: SIGNATURE_WIDTH, gh: SIGNATURE_HEIGHT, cells };
}

/** Signatures for a recording, in time order. Returns [] when the platform has no OffscreenCanvas
 *  — the video and the sheet still ship; only the measurements are missing. */
export async function frameSignatures(frames: readonly IFlowFrame[]): Promise<IFrameSignature[]> {
	if (typeof OffscreenCanvas === 'undefined' || frames.length < 3) {
		return [];
	}
	const sampled = thin(frames, SIGNATURE_MAX_FRAMES);
	const canvas = new OffscreenCanvas(SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) {
		return [];
	}
	const out: IFrameSignature[] = [];
	for (let i = 0; i < sampled.length; i += SIGNATURE_BATCH) {
		const batch = sampled.slice(i, i + SIGNATURE_BATCH);
		// Sequential inside the batch: they share one canvas, and a shared canvas cannot be drawn
		// into concurrently. The batching is there to keep the loop yielding, not to parallelise.
		for (const frame of batch) {
			try {
				out.push(await signatureOf(frame, ctx));
			} catch {
				// A corrupt frame is one missing measurement, not a failed recording.
			}
		}
	}
	return out;
}

// ---- Contact sheet -------------------------------------------------------------------------

/** Above this many pictures the sheet stops being readable; the frames are thinned evenly. */
const SHEET_MAX_TILES = 12;

export interface IContactSheetOptions {
	readonly title: string;
	readonly durationMs: number;
}

/**
 * The strip: the key frames tiled on a dark ground, each with its step number, time and label.
 * One picture that tells the whole flow — the cheapest thing to hand a model that reads images
 * and not video, and the poster the chat card shows before the video plays.
 */
export async function renderContactSheet(keyFrames: readonly IKeyFrame[], options: IContactSheetOptions): Promise<Uint8Array> {
	const tiles = thin(keyFrames, SHEET_MAX_TILES);
	if (!tiles.length) {
		throw new Error('No key frames to lay out.');
	}
	const sample = await createImageBitmap(bytesToBlob(frameBytes(tiles[0].frame), 'image/jpeg'));
	const aspect = sample.width / Math.max(1, sample.height);
	sample.close();

	const landscape = aspect >= 1.2;
	const columns = tiles.length === 1 ? 1 : landscape ? 2 : 3;
	const tileWidth = landscape ? 560 : 380;
	const tileHeight = Math.round(tileWidth / aspect);
	const caption = 30;
	const gap = 14;
	const pad = 18;
	const header = 42;
	const rows = Math.ceil(tiles.length / columns);
	const width = pad * 2 + columns * tileWidth + (columns - 1) * gap;
	const height = pad * 2 + header + rows * (tileHeight + caption) + (rows - 1) * gap;

	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('No 2D context for the contact sheet.');
	}
	const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
	ctx.fillStyle = '#111214';
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = '#f2f3f5';
	ctx.font = `600 16px ${font}`;
	ctx.textBaseline = 'middle';
	ctx.fillText(options.title, pad, pad + header / 2 - 4);
	ctx.fillStyle = '#9a9ba1';
	ctx.font = `13px ${font}`;
	const meta = `${tiles.length} steps · ${formatFlowTime(options.durationMs)}`;
	ctx.fillText(meta, width - pad - ctx.measureText(meta).width, pad + header / 2 - 4);

	for (let i = 0; i < tiles.length; i++) {
		const tile = tiles[i];
		const column = i % columns;
		const row = Math.floor(i / columns);
		const x = pad + column * (tileWidth + gap);
		const y = pad + header + row * (tileHeight + caption + gap);
		const bitmap = await createImageBitmap(bytesToBlob(frameBytes(tile.frame), 'image/jpeg'));
		ctx.fillStyle = '#000';
		ctx.fillRect(x, y, tileWidth, tileHeight);
		ctx.drawImage(bitmap, x, y, tileWidth, tileHeight);
		bitmap.close();
		ctx.strokeStyle = 'rgba(255,255,255,.12)';
		ctx.lineWidth = 1;
		ctx.strokeRect(x + .5, y + .5, tileWidth - 1, tileHeight - 1);
		// Caption: "3 · 00:04.2 · Click · Save button"
		const badge = String(i + 1);
		ctx.font = `600 12px ${font}`;
		const badgeWidth = Math.max(20, ctx.measureText(badge).width + 12);
		ctx.fillStyle = '#e8e8ea';
		roundRect(ctx, x, y + tileHeight + 7, badgeWidth, 18, 5);
		ctx.fill();
		ctx.fillStyle = '#111214';
		ctx.fillText(badge, x + 6, y + tileHeight + 16);
		ctx.fillStyle = '#d6d7db';
		ctx.font = `12.5px ${font}`;
		const label = `${formatFlowTime(tile.mark.t)} · ${describeMark(tile.mark.kind, tile.mark.label)}`;
		ctx.fillText(ellipsize(ctx, label, tileWidth - badgeWidth - 10), x + badgeWidth + 8, y + tileHeight + 16);
	}

	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.84 });
	return new Uint8Array(await blob.arrayBuffer());
}

function describeMark(kind: string, label: string): string {
	switch (kind) {
		case 'start': return label && label !== 'start' ? `Start · ${label}` : 'Start';
		case 'end': return 'End';
		case 'click': return `Click · ${label || 'element'}`;
		case 'type': return `Type · ${label || 'field'}`;
		case 'navigate': return `Navigate · ${label || ''}`.trim();
		default: return label || kind;
	}
}

function ellipsize(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) {
		return text;
	}
	let cut = text;
	while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
		cut = cut.slice(0, -1);
	}
	return cut + '…';
}

function roundRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/** Keeps the first and last, and spreads the rest evenly, so a long flow still reads start to end. */
export function thin<T>(items: readonly T[], max: number): T[] {
	if (items.length <= max) {
		return items.slice();
	}
	const out: T[] = [];
	for (let i = 0; i < max; i++) {
		out.push(items[Math.round(i * (items.length - 1) / (max - 1))]);
	}
	return out;
}
