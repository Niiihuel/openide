/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — samples to WAV, the format transcription models take.
 *
 *  Lifted out of the composer's voice class when dictation stopped being one take. The encoder
 *  used to start from a `Blob` and decode it, which only works when the audio has already been
 *  written by a `MediaRecorder`; live dictation cuts phrases out of a running capture and holds
 *  raw samples, never a file. What both paths share is this: PCM in, WAV out.
 *
 *  Pure, so the header can be tested without a microphone. A wrong header is invisible locally --
 *  the bytes go out, the provider decodes nothing, and the model answers as if there had been no
 *  audio at all, which reads exactly like "the model refused".
 *--------------------------------------------------------------------------------------------*/

/** What the transcription endpoints accept, and small enough that a phrase is a few tens of KB. */
export const WAV_SAMPLE_RATE = 16000;

/**
 * Linear resample to 16 kHz mono and encode as PCM16 WAV.
 *
 * Linear interpolation rather than a windowed filter: the input is speech at 44.1 or 48 kHz and
 * the target is 16 kHz, so the aliasing this leaves is above the band the model listens to, and a
 * proper resampler would be a page of code guarding a difference nobody can hear in a transcript.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
	const ratio = Math.max(1e-6, sampleRate / WAV_SAMPLE_RATE);
	const count = Math.max(1, Math.floor(samples.length / ratio));
	const pcm = new Int16Array(count);
	// Read through a guard rather than clamping the interpolated value afterwards. A non-finite
	// sample poisons its NEIGHBOUR as well: `(NaN - x) * 0` is still NaN, so a single bad sample
	// silenced the good one before it even when the interpolation weight was zero. A hardware
	// glitch is one sample of noise; it should not be two of silence.
	const at = (index: number): number => {
		const value = samples[index];
		return Number.isFinite(value) ? value : 0;
	};
	for (let i = 0; i < count; i++) {
		const position = i * ratio;
		const left = Math.min(samples.length - 1, Math.floor(position));
		const right = Math.min(samples.length - 1, left + 1);
		const fraction = position - left;
		const start = at(left);
		const sample = start + (at(right) - start) * fraction;
		const clamped = Math.max(-1, Math.min(1, sample));
		// Asymmetric on purpose: Int16 runs -32768..32767, so scaling both directions by 32767
		// wastes a step and scaling both by 32768 clips the positive peak to -32768.
		pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
	}

	const bytes = new Uint8Array(44 + pcm.byteLength);
	const view = new DataView(bytes.buffer);
	const writeString = (offset: number, value: string): void => {
		for (let i = 0; i < value.length; i++) { bytes[offset + i] = value.charCodeAt(i); }
	};
	writeString(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); writeString(8, 'WAVE');
	writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
	view.setUint32(24, WAV_SAMPLE_RATE, true); view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true); view.setUint16(34, 16, true);
	writeString(36, 'data'); view.setUint32(40, pcm.byteLength, true);
	bytes.set(new Uint8Array(pcm.buffer), 44);
	return bytes;
}

/** Base64 of the WAV, which is how the provider wants it inside the JSON body. */
export function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
	const bytes = encodeWav(samples, sampleRate);
	// Chunked: `String.fromCharCode(...bytes)` on a few seconds of audio is tens of thousands of
	// arguments in one spread and throws "Maximum call stack size exceeded" -- on the longer takes
	// only, which is the worst way to find out.
	let binary = '';
	const CHUNK = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}
	return btoa(binary);
}

/** Joins the blocks a capture accumulated into the one buffer the encoder takes. */
export function concatSamples(blocks: readonly Float32Array[]): Float32Array {
	let total = 0;
	for (const block of blocks) { total += block.length; }
	const merged = new Float32Array(total);
	let offset = 0;
	for (const block of blocks) { merged.set(block, offset); offset += block.length; }
	return merged;
}
