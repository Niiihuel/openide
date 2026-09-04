/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — a minimal WebM (Matroska) muxer for one VP8/VP9 video track.
 *
 *  WebCodecs encodes frames but does not put them in a file; the product ships no ffmpeg and
 *  bundling a muxer library for one track with no audio is more code than writing the subset of
 *  EBML this needs. Everything is buffered (a recording is bounded, see openideBrowserRecorder),
 *  so every element is written with its exact size — no unknown-size segments, no live patching —
 *  and Cues at the end let `<video>` seek without scanning.
 *
 *  Layout: EBML header · Segment { Info · Tracks · Cluster* · Cues }. Clusters start on key
 *  frames and are capped at ~5 s because SimpleBlock timecodes are 16-bit offsets from the
 *  cluster's own timecode.
 *--------------------------------------------------------------------------------------------*/

export interface IWebmChunk {
	/** Encoded frame bytes as WebCodecs hands them out. */
	readonly data: Uint8Array;
	/** Presentation time in milliseconds. */
	readonly timeMs: number;
	readonly keyFrame: boolean;
}

export interface IWebmOptions {
	readonly codec: 'vp8' | 'vp9';
	readonly width: number;
	readonly height: number;
	readonly durationMs: number;
}

// EBML element IDs (already including their class bits), as they appear on the wire.
const ID = {
	EBML: 0x1A45DFA3,
	EBMLVersion: 0x4286,
	EBMLReadVersion: 0x42F7,
	EBMLMaxIDLength: 0x42F2,
	EBMLMaxSizeLength: 0x42F3,
	DocType: 0x4282,
	DocTypeVersion: 0x4287,
	DocTypeReadVersion: 0x4285,
	Segment: 0x18538067,
	Info: 0x1549A966,
	TimecodeScale: 0x2AD7B1,
	Duration: 0x4489,
	MuxingApp: 0x4D80,
	WritingApp: 0x5741,
	Tracks: 0x1654AE6B,
	TrackEntry: 0xAE,
	TrackNumber: 0xD7,
	TrackUID: 0x73C5,
	TrackType: 0x83,
	FlagLacing: 0x9C,
	CodecID: 0x86,
	Video: 0xE0,
	PixelWidth: 0xB0,
	PixelHeight: 0xBA,
	Cluster: 0x1F43B675,
	Timecode: 0xE7,
	SimpleBlock: 0xA3,
	Cues: 0x1C53BB6B,
	CuePoint: 0xBB,
	CueTime: 0xB3,
	CueTrackPositions: 0xB7,
	CueTrack: 0xF7,
	CueClusterPosition: 0xF1,
} as const;

const CLUSTER_MAX_MS = 5000;

function idBytes(id: number): Uint8Array {
	const out: number[] = [];
	let value = id;
	while (value > 0) {
		out.unshift(value & 0xFF);
		value = Math.floor(value / 256);
	}
	return Uint8Array.from(out);
}

/** EBML variable-size integer for a data size: as many bytes as the value needs. */
function sizeVint(size: number): Uint8Array {
	let length = 1;
	while (size >= Math.pow(2, 7 * length) - 1 && length < 8) {
		length++;
	}
	const out = new Uint8Array(length);
	let value = size;
	for (let i = length - 1; i >= 0; i--) {
		out[i] = value & 0xFF;
		value = Math.floor(value / 256);
	}
	out[0] |= 0x80 >> (length - 1);
	return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function element(id: number, payload: Uint8Array): Uint8Array {
	return concat([idBytes(id), sizeVint(payload.length), payload]);
}

function uintPayload(value: number): Uint8Array {
	const out: number[] = [];
	let v = Math.max(0, Math.floor(value));
	do {
		out.unshift(v & 0xFF);
		v = Math.floor(v / 256);
	} while (v > 0);
	return Uint8Array.from(out);
}

function uint(id: number, value: number): Uint8Array {
	return element(id, uintPayload(value));
}

function float64(id: number, value: number): Uint8Array {
	const buffer = new ArrayBuffer(8);
	new DataView(buffer).setFloat64(0, value, false);
	return element(id, new Uint8Array(buffer));
}

function ascii(id: number, value: string): Uint8Array {
	const bytes = new Uint8Array(value.length);
	for (let i = 0; i < value.length; i++) {
		bytes[i] = value.charCodeAt(i) & 0x7F;
	}
	return element(id, bytes);
}

function simpleBlock(chunk: IWebmChunk, clusterTimeMs: number): Uint8Array {
	const relative = Math.max(-32768, Math.min(32767, Math.round(chunk.timeMs - clusterTimeMs)));
	const head = new Uint8Array(4);
	head[0] = 0x81; // track number 1, as a vint
	head[1] = (relative >> 8) & 0xFF;
	head[2] = relative & 0xFF;
	head[3] = chunk.keyFrame ? 0x80 : 0x00;
	return element(ID.SimpleBlock, concat([head, chunk.data]));
}

/**
 * Muxes the chunks into a complete WebM file. Chunks must be in presentation order and the
 * first one must be a key frame (WebCodecs guarantees it when asked for one on the first frame).
 */
export function muxWebm(chunks: readonly IWebmChunk[], options: IWebmOptions): Uint8Array {
	const header = element(ID.EBML, concat([
		uint(ID.EBMLVersion, 1),
		uint(ID.EBMLReadVersion, 1),
		uint(ID.EBMLMaxIDLength, 4),
		uint(ID.EBMLMaxSizeLength, 8),
		ascii(ID.DocType, 'webm'),
		uint(ID.DocTypeVersion, 4),
		uint(ID.DocTypeReadVersion, 2),
	]));

	const info = element(ID.Info, concat([
		uint(ID.TimecodeScale, 1_000_000), // 1 ms
		float64(ID.Duration, Math.max(1, options.durationMs)),
		ascii(ID.MuxingApp, 'OpenIDE'),
		ascii(ID.WritingApp, 'OpenIDE'),
	]));

	const tracks = element(ID.Tracks, element(ID.TrackEntry, concat([
		uint(ID.TrackNumber, 1),
		uint(ID.TrackUID, 1),
		uint(ID.TrackType, 1), // video
		uint(ID.FlagLacing, 0),
		ascii(ID.CodecID, options.codec === 'vp9' ? 'V_VP9' : 'V_VP8'),
		element(ID.Video, concat([
			uint(ID.PixelWidth, options.width),
			uint(ID.PixelHeight, options.height),
		])),
	])));

	// Clusters: a new one on every key frame past the cap, so seeking lands on decodable data.
	const clusters: { bytes: Uint8Array; timeMs: number }[] = [];
	let current: { timeMs: number; blocks: Uint8Array[] } | undefined;
	for (const chunk of chunks) {
		const needsNew = !current || (chunk.keyFrame && chunk.timeMs - current.timeMs >= CLUSTER_MAX_MS) || chunk.timeMs - current.timeMs > 32000;
		if (needsNew) {
			if (current) {
				clusters.push({ bytes: element(ID.Cluster, concat([uint(ID.Timecode, current.timeMs), ...current.blocks])), timeMs: current.timeMs });
			}
			current = { timeMs: Math.round(chunk.timeMs), blocks: [] };
		}
		current!.blocks.push(simpleBlock(chunk, current!.timeMs));
	}
	if (current) {
		clusters.push({ bytes: element(ID.Cluster, concat([uint(ID.Timecode, current.timeMs), ...current.blocks])), timeMs: current.timeMs });
	}

	// Cue positions are offsets from the first byte of the Segment's payload.
	let position = info.length + tracks.length;
	const cuePoints: Uint8Array[] = [];
	for (const cluster of clusters) {
		cuePoints.push(element(ID.CuePoint, concat([
			uint(ID.CueTime, cluster.timeMs),
			element(ID.CueTrackPositions, concat([
				uint(ID.CueTrack, 1),
				uint(ID.CueClusterPosition, position),
			])),
		])));
		position += cluster.bytes.length;
	}
	const cues = element(ID.Cues, concat(cuePoints));

	const segment = element(ID.Segment, concat([info, tracks, ...clusters.map(cluster => cluster.bytes), cues]));
	return concat([header, segment]);
}
