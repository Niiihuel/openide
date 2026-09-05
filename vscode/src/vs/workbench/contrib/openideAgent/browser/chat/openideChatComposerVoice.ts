/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IOpenideAgentService, IVoiceCapability } from '../openideAgentService.js';
import { t } from '../../common/openideStrings.js';
import { blockRms, joinTranscriptions, VoiceSegmenter } from '../../common/openideVoiceSegments.js';
import { concatSamples, encodeWavBase64 } from '../../common/openideVoiceWav.js';

export type VoiceState = 'idle' | 'starting' | 'recording' | 'busy';

/** The webview's host cut the recording here, and the limit belongs to the capture, not the UI. */
const MAX_RECORDING_MS = 10 * 60 * 1000;
/**
 * Samples the capture will hold before it refuses to grow.
 *
 * Ten minutes of 48 kHz mono is ~115 MB of Float32, and the old byte cap protected against exactly
 * that. It matters less now that phrases leave the buffer as they are transcribed, but a microphone
 * left open in a noisy room never cuts, and that is the case the cap is for.
 */
const MAX_BUFFERED_SAMPLES = 48000 * 60 * 2;
/** ScriptProcessor block. 4096 frames is ~85 ms at 48 kHz: fine enough to place a pause, coarse
 *  enough that the callback is not a hot loop. */
const CAPTURE_BLOCK = 4096;

interface IVoiceCapture {
	getUserMedia(): Promise<MediaStream>;
	createContext(): AudioContext;
}

interface IRecording {
	readonly stream: MediaStream;
	readonly context: AudioContext;
	readonly source: MediaStreamAudioSourceNode;
	readonly processor: ScriptProcessorNode;
	readonly capability: IVoiceCapability;
	readonly timeout: number;
	/** Samples of the phrase being spoken right now, cleared at every cut. */
	blocks: Float32Array[];
	buffered: number;
}

/**
 * Dictation for the native composer.
 *
 * Capture lives here rather than in the view pane because the native chat is workbench DOM: unlike
 * the webview — an isolated document with no microphone permission — it can call `getUserMedia`
 * itself, so the audio never has to cross a `postMessage` boundary. The service still does the
 * transcription; this only produces the WAV it expects.
 */
export class OpenideChatComposerVoice extends Disposable {

	private _capability: IVoiceCapability = { available: false };
	private _state: VoiceState = 'idle';
	private _recording: IRecording | undefined;
	/** Hold-to-talk: the button was released while the recorder was still starting. */
	private _holdReleased = false;
	/** Invalidates in-flight work when the composer is disposed or a newer session started. */
	private _generation = 0;
	private readonly _segmenter = new VoiceSegmenter();
	/** Phrases transcribed in this take, in the order they were spoken. */
	private _pieces: string[] = [];
	/** Serialises the transcription requests so the composer receives them in order. */
	private _queue: Promise<void> = Promise.resolve();
	/** Set when a phrase failed to transcribe. Without it the empty-take error below fires on top
	 *  of the real reason and the user is told "no audio" when the truth was a rejected request. */
	private _failed = false;
	private _capabilityGeneration = 0;
	private readonly _requests = this._register(new MutableDisposable<CancellationTokenSource>());

	constructor(
		private readonly agentService: Pick<IOpenideAgentService, 'getVoiceCapability' | 'transcribeAudio'>,
		private readonly accessibilitySignalService: Pick<IAccessibilitySignalService, 'playSignal'>,
		private readonly targetWindow: Window,
		private readonly onDidChangeState: (state: VoiceState) => void,
		private readonly onDidTranscribe: (text: string) => void,
		private readonly onDidFail: (message: string) => void,
		private readonly onDidChangeLevel: (level: number) => void = () => {},
		private readonly capture: IVoiceCapture = {
			getUserMedia: () => {
				if (!targetWindow.navigator.mediaDevices?.getUserMedia) {
					return Promise.reject(new Error(t('chat.voice.noCapture')));
				}
				return targetWindow.navigator.mediaDevices.getUserMedia({ audio: true });
			},
			createContext: () => new AudioContext(),
		},
	) {
		super();
	}

	get capability(): IVoiceCapability { return this._capability; }
	get state(): VoiceState { return this._state; }

	async refreshCapability(): Promise<void> {
		const generation = ++this._capabilityGeneration;
		try {
			const capability = await this.agentService.getVoiceCapability();
			if (generation === this._capabilityGeneration) { this._capability = capability; }
		} catch {
			if (generation === this._capabilityGeneration) { this._capability = { available: false }; }
		}
	}

	/** One button, two meanings: press to record, press again to stop and transcribe. */
	toggle(): void {
		if (this._state === 'busy' || this._state === 'starting') {
			return;
		}
		if (this._state === 'recording') {
			void this._stop();
			return;
		}
		if (!this._capability.available) {
			return;
		}
		this._holdReleased = false;
		void this._start();
	}

	/**
	 * Hold-to-talk (the removed chat webview): pointer down starts, pointer up/leave/cancel stops.
	 * Split from `toggle` because a release while the recorder is still `starting` must not be
	 * read as "press again", which would leave it recording with nobody holding the button.
	 */
	beginHold(): boolean {
		if (!this._capability.available || this._state !== 'idle') {
			return false;
		}
		this._holdReleased = false;
		void this._start();
		return true;
	}

	endHold(): void {
		this._holdReleased = true;
		if (this._state === 'recording') {
			void this._stop();
		}
	}

	/**
	 * The one funnel every transition goes through, and therefore where the microphone is announced.
	 *
	 * Upstream plays these two on its speech session boundaries
	 * (`SpeechAccessibilitySignalContribution`), and the reason applies here unchanged: recording is
	 * otherwise signalled by a colour on a 20px button, so someone who does not see it has no way to
	 * know the microphone is live. Of all the states this composer has, that is the one that keeps
	 * doing something after the user has looked away.
	 *
	 * The edges are guarded rather than fired on every call: `starting` -> `recording` -> `busy` is
	 * one recording, and the pair should be one start and one stop, not one per repaint.
	 */
	private _setState(state: VoiceState): void {
		const previous = this._state;
		this._state = state;
		if (state === 'recording' && previous !== 'recording') {
			this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceRecordingStarted);
		} else if (previous === 'recording' && state !== 'recording') {
			this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceRecordingStopped);
		}
		this.onDidChangeState(state);
	}

	private async _start(): Promise<void> {
		const generation = ++this._generation;
		this._requests.value?.cancel();
		this._requests.value = new CancellationTokenSource();
		this._setState('starting');
		let pending: MediaStream | undefined;
		let pendingContext: AudioContext | undefined;
		try {
			const capability = await this.agentService.getVoiceCapability();
			if (generation !== this._generation) { return; }
			this._capability = capability;
			if (!capability.available || !capability.providerId || !capability.model) {
				throw new Error(capability.reason ?? t('chatSurface.voice.unsupported'));
			}
			const stream = await this.capture.getUserMedia();
			pending = stream;
			if (generation !== this._generation) {
				stream.getTracks().forEach(track => track.stop());
				return;
			}

			// Web Audio rather than `MediaRecorder`. The recorder writes a webm/opus container whose
			// blocks are not independently decodable, so a phrase could only be cut out of it by
			// stopping and restarting the recorder -- losing the milliseconds around every cut, which
			// is where the words are. Raw samples can be cut anywhere.
			const context = pendingContext = this.capture.createContext();
			await context.resume();
			if (generation !== this._generation) {
				stream.getTracks().forEach(track => track.stop());
				void context.close().catch(() => {});
				return;
			}
			const source = context.createMediaStreamSource(stream);
			const processor = context.createScriptProcessor(CAPTURE_BLOCK, 1, 1);
			// A ScriptProcessor only runs while it is connected to the graph's destination, and its
			// output buffer is left untouched (silent) -- routing it through a muted gain instead
			// would be the same silence with one more node. Deprecated, and still the only capture
			// node that needs no module URL: `audioWorklet.addModule` fetches a script, which the
			// workbench CSP refuses.
			processor.onaudioprocess = event => this._onBlock(event.inputBuffer.getChannelData(0), context.sampleRate, generation);
			source.connect(processor);
			processor.connect(context.destination);

			const timeout = this.targetWindow.setTimeout(() => void this._stop(), MAX_RECORDING_MS);
			this._segmenter.restart();
			this._pieces = [];
			this._failed = false;
			this._queue = Promise.resolve();
			this._recording = { stream, context, source, processor, capability, timeout, blocks: [], buffered: 0 };
			pending = undefined;
			pendingContext = undefined;
			const track = stream.getAudioTracks()[0];
			if (track) {
				// Unplugging the microphone ends the take instead of leaving the UI recording nothing.
				track.onended = () => { if (this._recording?.stream === stream) { void this._stop(); } };
			}
			this._setState('recording');
			if (this._holdReleased) { this._holdReleased = false; void this._stop(); return; }
		} catch (error) {
			pending?.getTracks().forEach(track => track.stop());
			void pendingContext?.close().catch(() => {});
			if (generation !== this._generation) { return; }
			this._setState('idle');
			const name = error instanceof Error ? error.name : '';
			const detail = name === 'NotAllowedError' ? t('chatSurface.voice.permissionDenied')
				: name === 'NotFoundError' ? t('chatSurface.voice.noMicrophone')
					: name === 'NotReadableError' ? t('chatSurface.voice.deviceBusy')
						: error instanceof Error ? error.message : String(error);
			this.onDidFail(`${t('chatSurface.voice.startFailed')}: ${detail}`);
		}
	}

	/**
	 * One block of captured audio: buffer it, and ask the segmenter whether the phrase ended.
	 *
	 * This is the whole of "live": the phrase that just finished is transcribed while the next one
	 * is still being spoken, so text lands in the composer at the pace someone talks instead of all
	 * at once when they stop.
	 */
	private _onBlock(block: Float32Array, sampleRate: number, generation: number): void {
		const recording = this._recording;
		if (!recording || generation !== this._generation) {
			return;
		}
		const blockMs = (block.length / sampleRate) * 1000;
		const rms = blockRms(block);
		this.onDidChangeLevel(Math.min(1, rms * 8));
		const decision = this._segmenter.push(rms, blockMs);
		if (decision === 'discard') {
			// Silence before anyone spoke, or a noise too short to be speech. Dropping it here is
			// what keeps a quiet room from being uploaded and billed.
			recording.blocks = [];
			recording.buffered = 0;
			return;
		}
		// `getChannelData` hands back a view the audio thread reuses on the next block: without the
		// copy every buffered block would end up holding the same, latest audio.
		recording.blocks.push(new Float32Array(block));
		recording.buffered += block.length;
		if (decision === 'cut' || recording.buffered >= MAX_BUFFERED_SAMPLES) {
			const samples = concatSamples(recording.blocks);
			recording.blocks = [];
			recording.buffered = 0;
			this._enqueue(samples, sampleRate, recording.capability, generation);
		}
	}

	/**
	 * Transcribes one phrase, in order.
	 *
	 * Serialised through a promise chain rather than fired in parallel: two requests started
	 * together come back in whatever order the provider answers, and dictation that arrives with
	 * its clauses swapped is worse than dictation that arrives a second later.
	 */
	private _enqueue(samples: Float32Array, sampleRate: number, capability: IVoiceCapability, generation: number): void {
		this._queue = this._queue.then(async () => {
			if (generation !== this._generation || !samples.length) {
				return;
			}
			try {
				const wav = encodeWavBase64(samples, sampleRate);
				const text = await this.agentService.transcribeAudio(wav, capability.providerId, capability.model, this._requests.value?.token ?? CancellationToken.None);
				if (generation !== this._generation) {
					return;
				}
				const piece = text.trim();
				if (piece) {
					this._pieces.push(piece);
					this.onDidTranscribe(piece);
				}
			} catch (error) {
				if (generation === this._generation) {
					this._failed = true;
					this.onDidFail(`${t('chatSurface.voice.label')}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		});
	}

	private async _stop(): Promise<void> {
		const recording = this._recording;
		if (!recording || this._state === 'busy') {
			return;
		}
		this._recording = undefined;
		const generation = this._generation;
		this.targetWindow.clearTimeout(recording.timeout);
		this._setState('busy');
		this.onDidChangeLevel(0);
		try {
			// Tear the graph down BEFORE the flush: `onaudioprocess` keeps firing while the context
			// is alive, and a block arriving after the last phrase was queued would open a segment
			// nobody is going to close.
			recording.processor.onaudioprocess = null;
			recording.source.disconnect();
			recording.processor.disconnect();
			recording.stream.getTracks().forEach(track => track.stop());
			const sampleRate = recording.context.sampleRate;
			await recording.context.close().catch(() => { /* best effort */ });

			// The last phrase has no pause after it -- the user stopped instead. It is flushed only
			// when it holds speech: releasing the button during silence would otherwise pay for a
			// request whose only possible answer is that there was nothing to hear.
			if (recording.blocks.length && this._segmenter.hasSpeech) {
				this._enqueue(concatSamples(recording.blocks), sampleRate, recording.capability, generation);
			}
			recording.blocks = [];
			await this._queue;
			// "Nothing was recorded" is only true when nothing FAILED either. A phrase that was
			// rejected by the provider already said why, and repeating it as an empty take would
			// replace an actionable reason with a wrong one.
			if (generation === this._generation && !this._pieces.length && !this._failed) {
				throw new Error(t('chat.voice.empty'));
			}
		} catch (error) {
			if (generation === this._generation) {
				this.onDidFail(`${t('chatSurface.voice.label')}: ${error instanceof Error ? error.message : String(error)}`);
			}
		} finally {
			if (generation === this._generation) { this._setState('idle'); }
		}
	}

	/** Everything this take has transcribed so far, joined the way a reader expects. Kept for the
	 *  caller that wants the take as one string rather than the pieces it arrived in. */
	get transcript(): string {
		return joinTranscriptions(this._pieces);
	}

	/** Releases capture immediately and ignores pending transcription results. */
	cancel(): void {
		++this._generation;
		this._requests.value?.cancel();
		this._requests.clear();
		++this._capabilityGeneration;
		this._holdReleased = false;
		const recording = this._recording;
		this._recording = undefined;
		if (recording) {
			this.targetWindow.clearTimeout(recording.timeout);
			recording.processor.onaudioprocess = null;
			recording.source.disconnect();
			recording.processor.disconnect();
			recording.stream.getTracks().forEach(track => track.stop());
			recording.blocks = [];
			void recording.context.close().catch(() => {});
		}
		this._queue = Promise.resolve();
		this.onDidChangeLevel(0);
		this._setState('idle');
	}

	override dispose(): void {
		this.cancel();
		super.dispose();
	}

}
