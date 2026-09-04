/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — recording of a browser flow as video, from the same native preview the user sees.
 *
 *  A screenshot shows a state; it cannot show a transition. Animations, hover states, a modal
 *  sliding in, a list re-sorting — a multimodal model handed one picture per step has to guess
 *  what happened in between, and that is precisely the part a UI bug lives in. The recorder
 *  captures the preview as a stream while the agent operates it, and hands back BOTH a video (for
 *  the models that take one) and a strip of key frames, one per action (for the ones that only
 *  take images), so any CLI in the path can look at the whole flow.
 *
 *  ── Where it runs ─────────────────────────────────────────────────────────────────────────
 *  The screencast comes over CDP (`Page.startScreencast`): the preview is a BrowserView driven
 *  through a CDP transport, not a Playwright context, so `recordVideo` — which is decided when a
 *  context is created — is not available. The runtime below is serialized with `toString()` and
 *  evaluated by the Playwright service against the persistent `page`, the same way the cursor
 *  overlay is evaluated inside the page. It runs in a `vm` context with NO Node globals: no
 *  `Buffer`, no `fs`, no `setTimeout`. Frames therefore stay in memory, on the `page` object
 *  itself (a property survives between invocations because the Page is the same instance), and
 *  are pulled out in batches when the recording stops. The size is bounded by `maxSeconds` and by
 *  a byte cap, not by hope.
 *
 *  Encoding to WebM happens in the workbench renderer (browser/openideFlowVideo.ts), which has
 *  WebCodecs; this file stays pure so it can be unit-tested and so the layer checker is happy.
 *--------------------------------------------------------------------------------------------*/

/** Property on the Playwright `page` that holds the recorder between invocations. */
export const OPENIDE_RECORDER_KEY = '__openideFlowRecorder';

/** One captured frame: JPEG, base64, stamped relative to the start of the recording. */
export interface IFlowFrame {
	/** Milliseconds since the recording started (wall clock at receipt, same clock as the marks). */
	readonly t: number;
	/** Base64 JPEG, no `data:` prefix. */
	readonly data: string;
	readonly width: number;
	readonly height: number;
}

/** A moment worth a picture: an action the agent took, or a mark it set on purpose. */
export interface IFlowMark {
	readonly t: number;
	readonly label: string;
	/** 'click' | 'type' | 'navigate' | 'mark' | 'start' | 'end' — free-form on purpose, the strip only prints it. */
	readonly kind: string;
}

export interface IRecorderStartOptions {
	readonly fps: number;
	readonly quality: number;
	readonly maxWidth: number;
	readonly maxHeight: number;
	readonly maxSeconds: number;
	readonly label: string;
}

export interface IRecorderStatus {
	readonly active: boolean;
	readonly id: string;
	readonly label: string;
	readonly frames: number;
	readonly marks: readonly IFlowMark[];
	readonly elapsedMs: number;
	readonly width: number;
	readonly height: number;
	/** Set once the byte cap or `maxSeconds` stopped the capture on its own. */
	readonly truncated: boolean;
}

/** Hard ceiling on what a recording may hold in memory, whatever the settings say. */
export const RECORDER_MAX_BYTES = 96 * 1024 * 1024;

/**
 * The recorder runtime: `(page, command, options)`, the shape `invokeFunctionRaw` spreads its
 * arguments into; returns plain JSON.
 *
 * Written as ONE function so `toString()` captures everything it needs; it must not reference
 * anything from module scope (the vm context does not have it). Every command is idempotent
 * enough to be retried: `start` on an active recorder reports it instead of starting a second
 * screencast, `stop` on a stopped one just answers.
 */
export async function openideRecorderRuntime(page: any, command: unknown, options?: unknown): Promise<unknown> {
	const KEY = '__openideFlowRecorder';
	const MAX_BYTES = 96 * 1024 * 1024;
	const cmd = String(command ?? '');
	const opts = (options ?? {}) as any;
	const existing = page[KEY] as any;

	const status = (rec: any) => ({
		active: !!rec && rec.active,
		id: rec ? rec.id : '',
		label: rec ? rec.label : '',
		frames: rec ? rec.frames.length : 0,
		marks: rec ? rec.marks.slice() : [],
		elapsedMs: rec ? (rec.stoppedAt || Date.now()) - rec.startedAt : 0,
		width: rec ? rec.width : 0,
		height: rec ? rec.height : 0,
		truncated: !!rec && rec.truncated,
	});

	if (cmd === 'status') {
		return status(existing);
	}

	if (cmd === 'start') {
		if (existing && existing.active) {
			return { ...status(existing), alreadyActive: true };
		}
		const fps = Math.max(2, Math.min(30, Number(opts.fps) || 12));
		const quality = Math.max(30, Math.min(95, Number(opts.quality) || 70));
		const maxSeconds = Math.max(5, Math.min(300, Number(opts.maxSeconds) || 90));
		const maxWidth = Math.max(320, Math.min(2560, Number(opts.maxWidth) || 1280));
		const maxHeight = Math.max(240, Math.min(1600, Number(opts.maxHeight) || 900));
		const minGapMs = Math.floor(1000 / fps) - 4;
		const maxFrames = fps * maxSeconds;
		const rec: any = {
			id: 'rec-' + Date.now().toString(36),
			label: String(opts.label || ''),
			active: true,
			startedAt: Date.now(),
			stoppedAt: 0,
			frames: [] as any[],
			marks: [] as any[],
			bytes: 0,
			width: 0,
			height: 0,
			truncated: false,
			session: null as any,
			lastT: -1e9,
		};
		const session = await page.context().newCDPSession(page);
		rec.session = session;
		const stopCapture = async () => {
			if (!rec.active) { return; }
			rec.active = false;
			rec.stoppedAt = Date.now();
			try { await session.send('Page.stopScreencast'); } catch (e) { /* the page may be gone */ }
			try { await session.detach(); } catch (e) { /* idem */ }
		};
		rec.stop = stopCapture;
		session.on('Page.screencastFrame', (event: any) => {
			// Every frame is acknowledged, kept or not: without the ack the browser stops sending.
			session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => { });
			if (!rec.active) { return; }
			const t = Date.now() - rec.startedAt;
			if (t - rec.lastT < minGapMs) { return; }
			const data = String(event.data || '');
			// Base64 is 4/3 of the bytes; close enough for a cap.
			const size = Math.floor(data.length * 0.75);
			if (rec.bytes + size > MAX_BYTES || rec.frames.length >= maxFrames || t > maxSeconds * 1000) {
				rec.truncated = true;
				void stopCapture();
				return;
			}
			rec.lastT = t;
			rec.bytes += size;
			const meta = event.metadata || {};
			rec.width = Number(meta.deviceWidth) || rec.width;
			rec.height = Number(meta.deviceHeight) || rec.height;
			rec.frames.push({ t: t, data: data, width: rec.width, height: rec.height });
		});
		page[KEY] = rec;
		await session.send('Page.startScreencast', {
			format: 'jpeg',
			quality: quality,
			maxWidth: maxWidth,
			maxHeight: maxHeight,
			// The compositor runs at up to 60 fps; asking for every Nth frame keeps the traffic
			// near the target rate. The gap check above catches whatever slips through.
			everyNthFrame: Math.max(1, Math.round(60 / fps)),
		});
		rec.marks.push({ t: 0, label: rec.label || 'start', kind: 'start' });
		return status(rec);
	}

	if (!existing) {
		throw new Error('No recording on this page. Call browser_record_start first.');
	}

	if (cmd === 'mark') {
		const label = String(opts.label || '').slice(0, 120);
		const kind = String(opts.kind || 'mark');
		if (existing.active) {
			existing.marks.push({ t: Date.now() - existing.startedAt, label: label, kind: kind });
		}
		return status(existing);
	}

	if (cmd === 'stop') {
		if (existing.active) {
			// The last thing the user did deserves to land on the tape before it stops.
			existing.marks.push({ t: Date.now() - existing.startedAt, label: 'end', kind: 'end' });
			await existing.stop();
		}
		return status(existing);
	}

	if (cmd === 'take') {
		// Batched retrieval: one giant IPC reply for a two-minute recording is the one thing that
		// can still hurt after the byte cap. `from`/`count` are frame indices.
		const from = Math.max(0, Number(opts.from) || 0);
		const count = Math.max(1, Math.min(120, Number(opts.count) || 40));
		return { frames: existing.frames.slice(from, from + count), total: existing.frames.length };
	}

	if (cmd === 'discard') {
		if (existing.active) { await existing.stop(); }
		delete page[KEY];
		return { discarded: true };
	}

	throw new Error('Unknown recorder command: ' + cmd);
}

/** The function source ready for `invokeFunctionRaw`: `(page, args) => ...`. */
export function recorderRuntimeSource(): string {
	return openideRecorderRuntime.toString();
}

// ---- Key frames ---------------------------------------------------------------------------

export interface IKeyFrame {
	readonly index: number;
	readonly frame: IFlowFrame;
	readonly mark: IFlowMark;
}

/**
 * One frame per mark: the first frame captured at or after `mark.t + settleMs`, so the picture
 * shows the page AFTER the action landed (a click's frame taken at the click shows the button
 * being pressed, not what it opened). Falls back to the closest frame before it when the
 * recording stopped first. Marks that resolve to the same frame collapse into one, keeping the
 * later label — two actions inside one frame period are one picture, not two identical ones.
 */
export function pickKeyFrames(frames: readonly IFlowFrame[], marks: readonly IFlowMark[], settleMs: number): IKeyFrame[] {
	if (!frames.length) {
		return [];
	}
	const out: IKeyFrame[] = [];
	for (const mark of marks) {
		const target = mark.t + (mark.kind === 'start' || mark.kind === 'end' ? 0 : settleMs);
		let index = frames.findIndex(frame => frame.t >= target);
		if (index < 0) {
			index = frames.length - 1;
		}
		const previous = out[out.length - 1];
		if (previous && previous.index === index) {
			out[out.length - 1] = { index, frame: frames[index], mark };
			continue;
		}
		out.push({ index, frame: frames[index], mark });
	}
	return out;
}

// ---- Result marker ------------------------------------------------------------------------

/** Prefix of the video marker in tool results (interpreted by the run loop, like the screenshot one). */
export const VIDEO_MARKER = '[[openide-video:';

/** What `browser_record_stop` hands back, embedded in its text result. */
export interface IFlowVideoResult {
	readonly id: string;
	readonly label: string;
	/** Absolute paths, so any CLI in the path can pick the files up. */
	readonly dir: string;
	readonly videoPath: string;
	readonly sheetPath: string;
	readonly manifestPath: string;
	readonly durationMs: number;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly frameCount: number;
	readonly truncated: boolean;
	/** The contact sheet, for the model and the chat card. */
	readonly sheet: { readonly mimeType: string; readonly data: string };
	/** The key frames, in order; `data` only for the first `framesToModel` of them. */
	readonly keyFrames: readonly { readonly file: string; readonly t: number; readonly label: string; readonly kind: string; readonly data?: string }[];
	/**
	 * What the tape measured about the MOTION — a stall, a flash, an action that changed nothing.
	 * Each one carries the millisecond to look at, which is what turns "review this video" into
	 * "look at 00:04.2". Empty when nothing was found, absent on a build with no OffscreenCanvas.
	 */
	readonly findings?: readonly { readonly kind: string; readonly t: number; readonly durationMs?: number; readonly detail: string; readonly severity: number }[];
	/** What the page measured about ITSELF at the end of the flow: clipped text, contrast, overlap. */
	readonly lint?: readonly { readonly kind: string; readonly selector: string; readonly detail: string; readonly severity: number }[];
}

export function videoMarker(result: IFlowVideoResult, note: string): string {
	return `${VIDEO_MARKER}${JSON.stringify(result)}]]\n${note}`;
}

export function parseVideoMarker(out: string): { video: IFlowVideoResult; note: string } | undefined {
	if (!out.startsWith(VIDEO_MARKER)) {
		return undefined;
	}
	const end = out.indexOf(']]\n');
	if (end < 0) {
		return undefined;
	}
	try {
		const video = JSON.parse(out.slice(VIDEO_MARKER.length, end)) as IFlowVideoResult;
		if (!video || typeof video.videoPath !== 'string') {
			return undefined;
		}
		return { video, note: out.slice(end + 3).trim() || 'Flow recorded.' };
	} catch {
		return undefined;
	}
}

/** `00:01.2` — the timestamp printed on the strip and in the step list. */
export function formatFlowTime(ms: number): string {
	const total = Math.max(0, ms) / 1000;
	const minutes = Math.floor(total / 60);
	const seconds = total - minutes * 60;
	return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** File-name-safe slug for a label, with diacritics folded: `Naïve Menu` → `naive-menu`. */
export function flowSlug(text: string, fallback = 'flow'): string {
	const slug = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return slug || fallback;
}
