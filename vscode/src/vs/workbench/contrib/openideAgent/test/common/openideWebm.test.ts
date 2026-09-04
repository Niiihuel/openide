/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWebmChunk, muxWebm } from '../../common/openideWebm.js';

/** A tiny EBML reader: enough to walk the top-level structure the muxer must produce. */
function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number } {
	const first = bytes[offset];
	let length = 1;
	let mask = 0x80;
	while (length <= 8 && !(first & mask)) {
		mask >>= 1;
		length++;
	}
	let value = keepMarker ? first : (first & (mask - 1));
	for (let i = 1; i < length; i++) {
		value = value * 256 + bytes[offset + i];
	}
	return { value, length };
}

function walk(bytes: Uint8Array, start: number, end: number): { id: number; elementStart: number; payloadStart: number; size: number }[] {
	const out: { id: number; elementStart: number; payloadStart: number; size: number }[] = [];
	let offset = start;
	while (offset < end) {
		const id = readVint(bytes, offset, true);
		const size = readVint(bytes, offset + id.length, false);
		const payloadStart = offset + id.length + size.length;
		out.push({ id: id.value, elementStart: offset, payloadStart, size: size.value });
		offset = payloadStart + size.value;
	}
	return out;
}

suite('OpenIDE WebM muxer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const chunks: IWebmChunk[] = [
		{ data: Uint8Array.from([1, 2, 3]), timeMs: 0, keyFrame: true },
		{ data: Uint8Array.from([4, 5]), timeMs: 83, keyFrame: false },
		{ data: Uint8Array.from([6]), timeMs: 166, keyFrame: false },
		// Past the cluster cap on a key frame: a new cluster starts here.
		{ data: Uint8Array.from([7, 8, 9, 10]), timeMs: 6000, keyFrame: true },
		{ data: Uint8Array.from([11]), timeMs: 6083, keyFrame: false },
	];

	test('the file is an EBML header followed by one Segment, with exact sizes', () => {
		const file = muxWebm(chunks, { codec: 'vp9', width: 640, height: 480, durationMs: 6166 });
		const top = walk(file, 0, file.length);
		assert.deepStrictEqual(top.map(element => element.id), [0x1A45DFA3, 0x18538067]);
		// No unknown-size element anywhere: the last element ends exactly at the end of the file.
		const last = top[top.length - 1];
		assert.strictEqual(last.payloadStart + last.size, file.length);
	});

	test('the header says webm and the track is VP9 at the given size', () => {
		const file = muxWebm(chunks, { codec: 'vp9', width: 640, height: 480, durationMs: 6166 });
		const [header, segment] = walk(file, 0, file.length);
		const headerChildren = walk(file, header.payloadStart, header.payloadStart + header.size);
		const docType = headerChildren.find(element => element.id === 0x4282)!;
		assert.strictEqual(String.fromCharCode(...file.subarray(docType.payloadStart, docType.payloadStart + docType.size)), 'webm');

		const segmentChildren = walk(file, segment.payloadStart, segment.payloadStart + segment.size);
		assert.deepStrictEqual(segmentChildren.map(element => element.id), [0x1549A966, 0x1654AE6B, 0x1F43B675, 0x1F43B675, 0x1C53BB6B], 'Info, Tracks, two Clusters, Cues');

		const tracks = segmentChildren[1];
		const entry = walk(file, tracks.payloadStart, tracks.payloadStart + tracks.size)[0];
		const entryChildren = walk(file, entry.payloadStart, entry.payloadStart + entry.size);
		const codec = entryChildren.find(element => element.id === 0x86)!;
		assert.strictEqual(String.fromCharCode(...file.subarray(codec.payloadStart, codec.payloadStart + codec.size)), 'V_VP9');
		const video = entryChildren.find(element => element.id === 0xE0)!;
		const videoChildren = walk(file, video.payloadStart, video.payloadStart + video.size);
		const width = videoChildren.find(element => element.id === 0xB0)!;
		assert.strictEqual(file[width.payloadStart] * 256 + file[width.payloadStart + 1], 640);
	});

	test('blocks carry the track, the relative time and the key flag, and cues point at the clusters', () => {
		const file = muxWebm(chunks, { codec: 'vp8', width: 320, height: 240, durationMs: 6166 });
		const [, segment] = walk(file, 0, file.length);
		const children = walk(file, segment.payloadStart, segment.payloadStart + segment.size);
		const clusters = children.filter(element => element.id === 0x1F43B675);
		assert.strictEqual(clusters.length, 2);

		const second = walk(file, clusters[1].payloadStart, clusters[1].payloadStart + clusters[1].size);
		const timecode = second.find(element => element.id === 0xE7)!;
		assert.strictEqual(file[timecode.payloadStart] * 256 + file[timecode.payloadStart + 1], 6000);
		const blocks = second.filter(element => element.id === 0xA3);
		assert.strictEqual(blocks.length, 2);
		// SimpleBlock: track vint 0x81, int16 relative time, flags, then the frame bytes.
		const keyBlock = file.subarray(blocks[0].payloadStart, blocks[0].payloadStart + blocks[0].size);
		assert.deepStrictEqual(Array.from(keyBlock), [0x81, 0, 0, 0x80, 7, 8, 9, 10]);
		const deltaBlock = file.subarray(blocks[1].payloadStart, blocks[1].payloadStart + blocks[1].size);
		assert.deepStrictEqual(Array.from(deltaBlock), [0x81, 0, 83, 0x00, 11]);

		const cues = children.find(element => element.id === 0x1C53BB6B)!;
		const points = walk(file, cues.payloadStart, cues.payloadStart + cues.size);
		assert.strictEqual(points.length, 2);
		const positions = points.map(point => {
			const inner = walk(file, point.payloadStart, point.payloadStart + point.size);
			const trackPositions = inner.find(element => element.id === 0xB7)!;
			const position = walk(file, trackPositions.payloadStart, trackPositions.payloadStart + trackPositions.size).find(element => element.id === 0xF1)!;
			let value = 0;
			for (let i = 0; i < position.size; i++) {
				value = value * 256 + file[position.payloadStart + i];
			}
			return value;
		});
		// Cue positions are offsets from the Segment payload to the Cluster element.
		assert.deepStrictEqual(positions, clusters.map(cluster => cluster.elementStart - segment.payloadStart));
	});
});
