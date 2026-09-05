/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — where to cut a dictation so it can be transcribed while it is still being spoken.
 *
 *  Dictation used to be one take: record, stop, send the whole WAV, paste. Nothing appeared until
 *  the user stopped talking, which for a long sentence is a long time staring at an empty box.
 *
 *  There is no streaming to lean on. Transcription here is a chat completion carrying an
 *  `input_audio` part, and a chat completion is a request with a beginning and an end -- you
 *  cannot feed it a growing buffer. So "live" has to be built out of small complete requests, and
 *  the only question is where to end each one.
 *
 *  ── Why pauses, and not a clock ────────────────────────────────────────────────────────────
 *  A fixed interval cuts mid-word. The two halves are then transcribed by a model that never hears
 *  the whole word, and no amount of stitching afterwards recovers it -- "settings" arriving as
 *  "set" + "things" is worse than waiting. A pause is where a speaker has already finished
 *  something, so cutting there costs nothing: each request holds a whole phrase, and the text lands
 *  in the composer roughly when the speaker would expect it to.
 *
 *  Sending the audio SO FAR on each tick instead (cumulative) would keep the context but re-bill
 *  everything already transcribed on every tick -- quadratic in the length of the dictation, for a
 *  result that also keeps rewriting itself on screen.
 *
 *  This module decides only WHEN to cut, from energy and time. No DOM, no audio API, no clock of
 *  its own: the caller reports what it measured, which is what makes the rule testable.
 *--------------------------------------------------------------------------------------------*/

export interface IVoiceSegmenterOptions {
	/**
	 * RMS above which a block counts as speech.
	 *
	 * Room tone on a laptop microphone sits around 0.002-0.008 RMS; speech is an order of magnitude
	 * above that. The value is deliberately closer to the noise than to the speech: a threshold too
	 * high clips the quiet start of a sentence, and losing the first word is far more visible than
	 * sending a slightly longer segment.
	 */
	readonly speechThreshold: number;
	/** Silence this long AFTER speech closes the segment. */
	readonly silenceMs: number;
	/** Below this, a segment is not worth a request: a cough, a chair, a door. */
	readonly minSpeechMs: number;
	/**
	 * Hard cut for someone who does not pause.
	 *
	 * Without it a fluent speaker gets the old behaviour back -- one enormous request at the end --
	 * which is the exact problem this exists to solve. The cut lands mid-phrase, which is the price
	 * of not having waited two minutes.
	 */
	readonly maxSegmentMs: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: IVoiceSegmenterOptions = {
	speechThreshold: 0.012,
	silenceMs: 700,
	minSpeechMs: 400,
	maxSegmentMs: 15_000,
};

/** What the caller should do with the audio it has buffered. */
export type SegmentDecision =
	/** Keep buffering. */
	| 'continue'
	/** Cut here: transcribe what is buffered, then start a new segment. */
	| 'cut'
	/** Nothing but silence so far: drop the buffer instead of paying to transcribe a quiet room. */
	| 'discard';

/**
 * The cut rule, as a state machine over blocks of audio.
 *
 * Fed one block at a time with its RMS and its duration. Reports whether the buffer the caller is
 * holding should be sent, dropped, or kept growing.
 */
export class VoiceSegmenter {

	private speechMs = 0;
	private silenceMs = 0;
	private segmentMs = 0;
	/** Silence before the first word is not part of anything and is not worth carrying. */
	private started = false;

	constructor(private readonly options: IVoiceSegmenterOptions = DEFAULT_SEGMENTER_OPTIONS) { }

	/** True once this segment has heard speech. The caller uses it to decide whether a final flush
	 *  at stop time is worth a request. */
	get hasSpeech(): boolean {
		return this.speechMs >= this.options.minSpeechMs;
	}

	push(rms: number, blockMs: number): SegmentDecision {
		const speech = rms >= this.options.speechThreshold;
		if (!this.started) {
			if (!speech) {
				// Leading silence: report `discard` so the caller drops it. Keeping it would put a
				// second of room tone at the head of every segment and pay for it.
				return 'discard';
			}
			this.started = true;
		}

		this.segmentMs += blockMs;
		if (speech) {
			this.speechMs += blockMs;
			this.silenceMs = 0;
		} else {
			this.silenceMs += blockMs;
		}

		if (this.segmentMs >= this.options.maxSegmentMs) {
			return this.close();
		}
		// A pause only ends a segment that has something in it. Otherwise a throat-clear followed by
		// thinking time would fire a request carrying nothing anyone said.
		if (this.silenceMs >= this.options.silenceMs) {
			return this.hasSpeech ? this.close() : this.reset('discard');
		}
		return 'continue';
	}

	/** Ends the current segment and starts the next. */
	private close(): SegmentDecision {
		return this.reset('cut');
	}

	private reset(decision: SegmentDecision): SegmentDecision {
		this.speechMs = 0;
		this.silenceMs = 0;
		this.segmentMs = 0;
		this.started = false;
		return decision;
	}

	/** Starts over, for a new recording. */
	restart(): void {
		this.reset('continue');
	}
}

/**
 * Root mean square of a block of samples: how loud it is, in one number.
 *
 * Not the peak: a single click would read as speech and open a segment for a sound nobody made.
 */
export function blockRms(samples: Float32Array): number {
	if (!samples.length) {
		return 0;
	}
	let sum = 0;
	for (let i = 0; i < samples.length; i++) {
		sum += samples[i] * samples[i];
	}
	return Math.sqrt(sum / samples.length);
}

/**
 * Joins what came back from separate requests.
 *
 * Each segment is transcribed on its own, so the model punctuates each as if it were the whole
 * utterance. Gluing them with a plain space produces "Hola. Como estas." out of two takes, which
 * is what a person dictating in phrases would expect -- but only if the pieces do not bring their
 * own spacing, and only if an empty answer (a segment the model heard nothing in) does not leave a
 * double space behind.
 */
export function joinTranscriptions(pieces: readonly string[]): string {
	return pieces.map(piece => piece.trim()).filter(Boolean).join(' ');
}
