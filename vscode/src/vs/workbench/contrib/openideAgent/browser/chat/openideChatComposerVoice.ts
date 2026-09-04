/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideAgentService, IVoiceCapability } from '../openideAgentService.js';
import { t } from '../../common/openideStrings.js';

export type VoiceState = 'idle' | 'starting' | 'recording' | 'busy';

/** The webview's host cut the recording here, and the limit belongs to the capture, not the UI. */
const MAX_RECORDING_MS = 10 * 60 * 1000;
const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const WAV_SAMPLE_RATE = 16000;

interface IRecording {
	readonly recorder: MediaRecorder;
	readonly stream: MediaStream;
	readonly chunks: Blob[];
	readonly capability: IVoiceCapability;
	readonly timeout: number;
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

	constructor(
		private readonly agentService: IOpenideAgentService,
		private readonly targetWindow: Window,
		private readonly onDidChangeState: (state: VoiceState) => void,
		private readonly onDidTranscribe: (text: string) => void,
		private readonly onDidFail: (message: string) => void,
	) {
		super();
	}

	get capability(): IVoiceCapability { return this._capability; }
	get state(): VoiceState { return this._state; }

	async refreshCapability(): Promise<void> {
		try {
			this._capability = await this.agentService.getVoiceCapability();
		} catch {
			this._capability = { available: false };
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

	private _setState(state: VoiceState): void {
		this._state = state;
		this.onDidChangeState(state);
	}

	private async _start(): Promise<void> {
		const generation = ++this._generation;
		this._setState('starting');
		let pending: MediaStream | undefined;
		try {
			const capability = await this.agentService.getVoiceCapability();
			this._capability = capability;
			if (!capability.available || !capability.providerId || !capability.model) {
				throw new Error(capability.reason ?? t('chatSurface.voice.unsupported'));
			}
			if (!navigator.mediaDevices?.getUserMedia) {
				throw new Error(t('chat.voice.noCapture'));
			}
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			pending = stream;
			if (generation !== this._generation) {
				stream.getTracks().forEach(track => track.stop());
				return;
			}
			const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
			const chunks: Blob[] = [];
			recorder.ondataavailable = event => { if (event.data?.size) { chunks.push(event.data); } };
			// Timesliced: without it a crash before `stop()` loses the whole take.
			recorder.start(1000);
			const timeout = this.targetWindow.setTimeout(() => void this._stop(), MAX_RECORDING_MS);
			this._recording = { recorder, stream, chunks, capability, timeout };
			pending = undefined;
			recorder.onerror = () => { if (this._recording?.recorder === recorder) { void this._stop(); } };
			const track = stream.getAudioTracks()[0];
			if (track) {
				// Unplugging the microphone ends the take instead of leaving the UI recording nothing.
				track.onended = () => { if (this._recording?.stream === stream) { void this._stop(); } };
			}
			this._setState('recording');
			if (this._holdReleased) { this._holdReleased = false; void this._stop(); return; }
		} catch (error) {
			pending?.getTracks().forEach(track => track.stop());
			this._setState('idle');
			this.onDidFail(`${t('chatSurface.voice.startFailed')}: ${error instanceof Error ? error.message : String(error)}`);
		}
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
		try {
			await new Promise<void>(resolve => {
				if (recording.recorder.state === 'inactive') { resolve(); return; }
				// Bounded wait: a recorder that never fires `stop` would hang the composer forever.
				const fallback = this.targetWindow.setTimeout(resolve, 2000);
				recording.recorder.addEventListener('stop', () => { this.targetWindow.clearTimeout(fallback); resolve(); }, { once: true });
				try { recording.recorder.stop(); } catch { this.targetWindow.clearTimeout(fallback); resolve(); }
			});
			recording.stream.getTracks().forEach(track => track.stop());
			const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || 'audio/webm' });
			if (!blob.size) {
				throw new Error(t('chat.voice.empty'));
			}
			if (blob.size > MAX_BLOB_BYTES) {
				throw new Error(t('chat.voice.tooBig'));
			}
			const wav = await this._encodeWavBase64(blob);
			const text = await this.agentService.transcribeAudio(wav, recording.capability.providerId, recording.capability.model);
			if (generation === this._generation) { this.onDidTranscribe(text); }
		} catch (error) {
			recording.stream.getTracks().forEach(track => track.stop());
			if (generation === this._generation) {
				this.onDidFail(`${t('chatSurface.voice.label')}: ${error instanceof Error ? error.message : String(error)}`);
			}
		} finally {
			if (generation === this._generation) { this._setState('idle'); }
		}
	}

	/** WAV 16k mono PCM16, the format the transcription models accept. Decoded at the device's own
	 *  rate — forcing 16 kHz on the AudioContext produces silence on some devices — and resampled
	 *  here so the result is deterministic. */
	private async _encodeWavBase64(blob: Blob): Promise<string> {
		const raw = await blob.arrayBuffer();
		const context = new AudioContext();
		let audio: AudioBuffer;
		try {
			audio = await context.decodeAudioData(raw);
		} finally {
			context.close().catch(() => { /* best effort */ });
		}
		const ratio = audio.sampleRate / WAV_SAMPLE_RATE;
		const sampleCount = Math.max(1, Math.floor(audio.length / ratio));
		const pcm = new Int16Array(sampleCount);
		const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
		for (let i = 0; i < sampleCount; i++) {
			const position = i * ratio;
			const left = Math.min(audio.length - 1, Math.floor(position));
			const right = Math.min(audio.length - 1, left + 1);
			let leftMix = 0;
			let rightMix = 0;
			for (const channel of channels) { leftMix += channel[left]; rightMix += channel[right]; }
			const fraction = position - left;
			const sample = (leftMix + (rightMix - leftMix) * fraction) / channels.length;
			const clamped = Math.max(-1, Math.min(1, sample));
			pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
		}
		const bytes = new Uint8Array(44 + pcm.byteLength);
		const view = new DataView(bytes.buffer);
		const writeString = (offset: number, value: string): void => {
			for (let i = 0; i < value.length; i++) { bytes[offset + i] = value.charCodeAt(i); }
		};
		writeString(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); writeString(8, 'WAVE');
		writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
		view.setUint32(24, WAV_SAMPLE_RATE, true); view.setUint32(28, WAV_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
		writeString(36, 'data'); view.setUint32(40, pcm.byteLength, true);
		bytes.set(new Uint8Array(pcm.buffer), 44);
		// Chunked: `String.fromCharCode` with a spread blows the stack on a multi-megabyte take.
		let binary = '';
		for (let i = 0; i < bytes.length; i += 0x8000) {
			binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
		}
		return btoa(binary);
	}

	override dispose(): void {
		this._generation++;
		const recording = this._recording;
		this._recording = undefined;
		if (recording) {
			this.targetWindow.clearTimeout(recording.timeout);
			try { recording.recorder.stop(); } catch { /* the stream is stopped below regardless */ }
			recording.stream.getTracks().forEach(track => track.stop());
		}
		super.dispose();
	}
}
