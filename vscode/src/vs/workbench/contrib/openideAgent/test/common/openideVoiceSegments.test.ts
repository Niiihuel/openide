/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { blockRms, DEFAULT_SEGMENTER_OPTIONS, joinTranscriptions, SegmentDecision, VoiceSegmenter } from '../../common/openideVoiceSegments.js';

const BLOCK_MS = 100;
const LOUD = 0.05;
const QUIET = 0.001;

/** Feeds `ms` of one level and returns every decision it produced. */
function feed(segmenter: VoiceSegmenter, level: number, ms: number): SegmentDecision[] {
	const decisions: SegmentDecision[] = [];
	for (let elapsed = 0; elapsed < ms; elapsed += BLOCK_MS) {
		decisions.push(segmenter.push(level, BLOCK_MS));
	}
	return decisions;
}

suite('OpenIDE voice segmenter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('silence before the first word is discarded, not buffered', () => {
		const segmenter = new VoiceSegmenter();
		const decisions = feed(segmenter, QUIET, 2000);
		assert.strictEqual(decisions.every(d => d === 'discard'), true);
	});

	test('a phrase followed by a pause is cut exactly once', () => {
		const segmenter = new VoiceSegmenter();
		assert.strictEqual(feed(segmenter, LOUD, 1500).every(d => d === 'continue'), true);
		const pause = feed(segmenter, QUIET, 1000);
		assert.strictEqual(pause.filter(d => d === 'cut').length, 1, 'exactly one cut');
		// After the cut the state machine is back at the beginning: the rest of the pause is
		// leading silence for the NEXT segment, which is discarded rather than buffered.
		assert.strictEqual(pause[pause.length - 1], 'discard');
	});

	test('a pause shorter than the threshold does not cut', () => {
		const segmenter = new VoiceSegmenter();
		feed(segmenter, LOUD, 1000);
		const decisions = feed(segmenter, QUIET, DEFAULT_SEGMENTER_OPTIONS.silenceMs - 200);
		assert.strictEqual(decisions.includes('cut'), false, 'a breath is not the end of a phrase');
	});

	test('three phrases with pauses produce three cuts', () => {
		const segmenter = new VoiceSegmenter();
		let cuts = 0;
		for (let i = 0; i < 3; i++) {
			cuts += feed(segmenter, LOUD, 1200).filter(d => d === 'cut').length;
			cuts += feed(segmenter, QUIET, 900).filter(d => d === 'cut').length;
		}
		assert.strictEqual(cuts, 3);
	});

	test('a noise too short to be speech is dropped instead of transcribed', () => {
		// A cough, a chair, a door: loud, but below `minSpeechMs`. Sending it would pay for a
		// request whose honest answer is "no speech", and paste whatever the model says about that.
		const segmenter = new VoiceSegmenter();
		feed(segmenter, LOUD, 200);
		const decisions = feed(segmenter, QUIET, 1000);
		assert.strictEqual(decisions.includes('cut'), false);
		assert.strictEqual(decisions.includes('discard'), true);
	});

	test('someone who never pauses is still cut, so latency stays bounded', () => {
		const segmenter = new VoiceSegmenter();
		const decisions = feed(segmenter, LOUD, DEFAULT_SEGMENTER_OPTIONS.maxSegmentMs + 500);
		assert.strictEqual(decisions.filter(d => d === 'cut').length, 1);
	});

	test('hasSpeech reports whether a final flush is worth a request', () => {
		const segmenter = new VoiceSegmenter();
		assert.strictEqual(segmenter.hasSpeech, false);
		feed(segmenter, LOUD, 200);
		assert.strictEqual(segmenter.hasSpeech, false, '200ms is under minSpeechMs');
		feed(segmenter, LOUD, 400);
		assert.strictEqual(segmenter.hasSpeech, true);
	});

	test('restart clears the state between recordings', () => {
		const segmenter = new VoiceSegmenter();
		feed(segmenter, LOUD, 1000);
		segmenter.restart();
		assert.strictEqual(segmenter.hasSpeech, false);
		assert.strictEqual(segmenter.push(QUIET, BLOCK_MS), 'discard', 'a new recording starts at leading silence');
	});

	test('rms is the level of the block, not its loudest sample', () => {
		assert.strictEqual(blockRms(new Float32Array(0)), 0);
		assert.strictEqual(blockRms(new Float32Array([0, 0, 0])), 0);
		assert.strictEqual(blockRms(new Float32Array([1, 1, 1])), 1);
		// A single full-scale click in an otherwise silent block reads as 0.1, not as the 1.0 a
		// peak rule would report. It is still above the speech threshold, and it is SUPPOSED to be:
		// what keeps a cough or a door from becoming a request is `minSpeechMs` (the test above),
		// not the level rule. Trying to make the threshold reject clicks would have to sit above
		// quiet speech, and losing the first word of a sentence is the more visible failure.
		const click = new Float32Array(100);
		click[50] = 1;
		assert.strictEqual(Math.abs(blockRms(click) - 0.1) < 1e-9, true);
	});

	test('pieces are joined without inheriting their own spacing', () => {
		assert.strictEqual(joinTranscriptions(['Hola.', ' Como estas.']), 'Hola. Como estas.');
		// An empty answer is a segment the model heard nothing in; it must not leave a double space.
		assert.strictEqual(joinTranscriptions(['Hola.', '', '  ', 'Chau.']), 'Hola. Chau.');
		assert.strictEqual(joinTranscriptions([]), '');
	});
});
