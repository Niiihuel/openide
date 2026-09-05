/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { concatSamples, encodeWav, WAV_SAMPLE_RATE } from '../../common/openideVoiceWav.js';

const text = (bytes: Uint8Array, offset: number, length: number) =>
	String.fromCharCode(...bytes.subarray(offset, offset + length));

suite('OpenIDE voice WAV', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('the header is a WAV a decoder will accept', () => {
		const bytes = encodeWav(new Float32Array(16000), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		assert.strictEqual(text(bytes, 0, 4), 'RIFF');
		assert.strictEqual(text(bytes, 8, 4), 'WAVE');
		assert.strictEqual(text(bytes, 12, 4), 'fmt ');
		assert.strictEqual(text(bytes, 36, 4), 'data');
		assert.strictEqual(view.getUint32(16, true), 16, 'PCM fmt chunk size');
		assert.strictEqual(view.getUint16(20, true), 1, 'format 1 = PCM');
		assert.strictEqual(view.getUint16(22, true), 1, 'mono');
		assert.strictEqual(view.getUint32(24, true), WAV_SAMPLE_RATE);
		assert.strictEqual(view.getUint32(28, true), WAV_SAMPLE_RATE * 2, 'byte rate = rate * blockAlign');
		assert.strictEqual(view.getUint16(32, true), 2, 'block align, 16 bit mono');
		assert.strictEqual(view.getUint16(34, true), 16, 'bits per sample');
		// The two sizes in the header have to agree with the buffer, or a decoder reads past the end
		// and the provider gets truncated audio -- which comes back as "I could not hear anything".
		assert.strictEqual(view.getUint32(40, true), bytes.length - 44, 'data chunk size');
		assert.strictEqual(view.getUint32(4, true), bytes.length - 8, 'RIFF size');
	});

	test('resampling lands on the target rate', () => {
		// One second at 48 kHz has to come out as one second at 16 kHz: 16000 samples, 2 bytes each.
		const bytes = encodeWav(new Float32Array(48000), 48000);
		assert.strictEqual(bytes.length - 44, WAV_SAMPLE_RATE * 2);
		// Already at the target rate: nothing is dropped.
		const same = encodeWav(new Float32Array(WAV_SAMPLE_RATE), WAV_SAMPLE_RATE);
		assert.strictEqual(same.length - 44, WAV_SAMPLE_RATE * 2);
	});

	test('full-scale samples do not wrap around', () => {
		// The bug this guards: scaling the positive peak by 0x8000 overflows Int16 and +1.0 comes
		// back as -32768, so the loudest part of a phrase is where the audio inverts.
		const bytes = encodeWav(new Float32Array([1, -1, 1, -1]), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		assert.strictEqual(view.getInt16(44, true), 32767);
		assert.strictEqual(view.getInt16(46, true), -32768);
	});

	test('out-of-range and NaN samples are clamped, not wrapped', () => {
		const bytes = encodeWav(new Float32Array([4, -4, NaN]), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		assert.strictEqual(view.getInt16(44, true), 32767);
		assert.strictEqual(view.getInt16(46, true), -32768);
		assert.strictEqual(view.getInt16(48, true), 0, 'NaN is silence, not noise');
	});

	test('an empty capture still produces a valid file', () => {
		const bytes = encodeWav(new Float32Array(0), WAV_SAMPLE_RATE);
		assert.strictEqual(text(bytes, 0, 4), 'RIFF');
		assert.strictEqual(bytes.length >= 44, true);
	});

	test('blocks join in order', () => {
		const merged = concatSamples([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])]);
		assert.deepStrictEqual([...merged], [1, 2, 3]);
		assert.strictEqual(concatSamples([]).length, 0);
	});
});
