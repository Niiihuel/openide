/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Motion and particle recipes adapted from chatgpt-model-selector by Zanwei Guo.
 *  Copyright (c) 2026 Zanwei Guo
 *  Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *  and associated documentation files (the "Software"), to deal in the Software without
 *  restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *  distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *  Software is furnished to do so, subject to the following conditions:
 *  The above copyright notice and this permission notice shall be included in all copies or
 *  substantial portions of the Software.
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 *  BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *  NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *  DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *--------------------------------------------------------------------------------------------*/

import { createOpenideElement } from '../openideDom.js';
import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';

/** Runtime boundary for deterministic lifecycle checks without replacing browser globals. */
export interface IOpenideEffortSliderRuntime {
	readonly reducedMotion: boolean;
	readonly hidden: boolean;
	requestFrame(callback: FrameRequestCallback): number;
	cancelFrame(handle: number): void;
	onDidChangeMotion(listener: () => void): IDisposable;
	onDidChangeVisibility(listener: () => void): IDisposable;
}

function createSliderRuntime(host: HTMLElement): IOpenideEffortSliderRuntime {
	const window = getWindow(host);
	const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
	return {
		get reducedMotion() { return preference.matches; },
		get hidden() { return host.ownerDocument.hidden; },
		requestFrame: callback => window.requestAnimationFrame(callback),
		cancelFrame: handle => window.cancelAnimationFrame(handle),
		onDidChangeMotion: listener => {
			preference.addEventListener('change', listener);
			return toDisposable(() => preference.removeEventListener('change', listener));
		},
		onDidChangeVisibility: listener => addDisposableListener(host.ownerDocument, 'visibilitychange', listener),
	};
}

interface ISpark { x: number; y: number; r: number; phase: number; twinkle: number; flow: number }
interface IBurst { x: number; y: number; vx: number; vy: number; size: number; age: number; ttl: number }

/** Bounded native counterpart of the approved selector. Effects never own the persisted value. */
export class OpenideChatEffortSlider extends Disposable {
	readonly input: HTMLInputElement;
	private readonly _window: Window;
	private readonly _runtime: IOpenideEffortSliderRuntime;
	private readonly _fill: HTMLElement;
	private readonly _knob: HTMLElement;
	private readonly _spark: HTMLCanvasElement;
	private readonly _burst: HTMLCanvasElement;
	private readonly _effects: HTMLElement;
	private readonly _effectsHost: HTMLElement;
	private _sparks: ISpark[] = [];
	private _bursts: IBurst[] = [];
	private _raf = 0;
	private _lastFrame = 0;
	private _lastBurst = -Infinity;
	private _snapTimer = 0;
	private _pulse: Animation | undefined;
	private _width = 0;
	private _dpr = 1;
	private _index: number;
	private _committed: number;
	private _pos: number;
	private _pointer: number | undefined;
	private _rect: DOMRect | undefined;
	private _disposed = false;
	private _fastMode = false;

	constructor(
		private readonly host: HTMLElement,
		readonly levels: readonly string[],
		selected: number,
		label: string,
		private readonly celebrateMaximum: boolean,
		private readonly onPreview: (index: number) => void,
		private readonly onCommit: (index: number) => void,
		private readonly onHover: (hovering: boolean) => void,
		runtime?: IOpenideEffortSliderRuntime,
	) {
		super();
		this._window = getWindow(host);
		this._runtime = runtime ?? createSliderRuntime(host);
		this._index = this._committed = selected;
		this._pos = selected / Math.max(1, levels.length - 1);
		const make = (className: string) => { const node = createOpenideElement(host.ownerDocument, 'div'); node.className = className; return node; };
		const track = make('openide-mp-slider-track');
		this._fill = make('openide-mp-slider-fill');
		this._spark = createOpenideElement(host.ownerDocument, 'canvas');
		this._spark.className = 'openide-mp-slider-sparkles';
		this._spark.setAttribute('aria-hidden', 'true');
		this._fill.append(this._spark);
		const ticks = make('openide-mp-slider-ticks');
		for (let index = 0; index < levels.length; index++) {
			const tick = make('openide-mp-slider-tick');
			tick.style.left = `calc(15px + (100% - 30px) * ${index / Math.max(1, levels.length - 1)})`;
			ticks.append(tick);
		}
		track.append(this._fill, ticks);
		this._knob = make('openide-mp-slider-knob');
		this._burst = createOpenideElement(host.ownerDocument, 'canvas');
		this._burst.className = 'openide-mp-slider-burst';
		this._burst.setAttribute('aria-hidden', 'true');
		// An inset effects layer clips visual overflow inside the panel without contributing a
		// larger scrollable rectangle. The particles can still fly above the slider into its header.
		this._effects = make('openide-mp-slider-effects');
		this._effectsHost = host.parentElement?.classList.contains('openide-mp-effort-panel') ? host.parentElement : host;
		this._effects.append(this._burst);
		this._effectsHost.append(this._effects);
		this._register(toDisposable(() => this._effects.remove()));
		this.input = createOpenideElement(host.ownerDocument, 'input');
		this.input.type = 'range'; this.input.min = '0'; this.input.max = String(levels.length - 1); this.input.step = '1';
		this.input.className = 'openide-mp-effort-slider'; this.input.setAttribute('aria-label', label);
		host.append(track, this._knob, this.input);
		this._register(addDisposableListener(host.ownerDocument, 'keydown', event => {
			if (event.key === 'Tab') { host.classList.add('is-keyboard-focus'); }
		}));
		this._register(addDisposableListener(this.input, 'keydown', () => host.classList.add('is-keyboard-focus')));
		this._register(addDisposableListener(this.input, 'blur', () => host.classList.remove('is-keyboard-focus')));
		this._register(addDisposableListener(this.input, 'input', () => this._preview(Number(this.input.value), false)));
		this._register(addDisposableListener(this.input, 'change', () => this._commit(false)));
		this._register(addDisposableListener(this.input, 'pointerenter', () => onHover(true)));
		this._register(addDisposableListener(this.input, 'pointerleave', () => { if (this._pointer === undefined) { onHover(false); } }));
		this._register(addDisposableListener(this.input, 'pointerdown', event => this._start(event)));
		this._register(addDisposableListener(this.input, 'pointermove', event => { if (event.pointerId === this._pointer) { this._drag(event); } }));
		this._register(addDisposableListener(this.input, 'pointerup', event => this._release(event, false)));
		this._register(addDisposableListener(this.input, 'pointercancel', event => this._release(event, true)));
		this._register(addDisposableListener(this.input, 'lostpointercapture', event => this._release(event, true)));
		this._register(this._runtime.onDidChangeVisibility(() => this._syncMotion()));
		this._register(this._runtime.onDidChangeMotion(() => this._syncMotion()));
		const observer = new (getWindow(host).ResizeObserver)(() => this._resize());
		observer.observe(host);
		this._register(toDisposable(() => observer.disconnect()));
		this._resize();
		this._preview(selected, false);
		this._syncMotion();
	}

	/** Synchronize a saved setting without replacing the input or committing it a second time. */
	setSelected(index: number): void {
		if (this._disposed) { return; }
		this._stopSnap();
		const pointer = this._pointer;
		this._pointer = undefined;
		this._rect = undefined;
		this.host.classList.remove('is-dragging');
		if (pointer !== undefined && this.input.hasPointerCapture(pointer)) { this.input.releasePointerCapture(pointer); }
		this._preview(index, false);
		this._committed = this._index;
	}

	setFastMode(enabled: boolean): void {
		if (this._fastMode === enabled) { return; }
		this._fastMode = enabled;
		this.host.classList.toggle('is-fast', enabled);
		this._syncMotion(false);
	}

	private get _showSparkles(): boolean { return this._fastMode || (this.celebrateMaximum && this._index === this.levels.length - 1); }

	private _start(event: PointerEvent): void {
		if (this._pointer !== undefined || event.button !== 0) { return; }
		event.preventDefault();
		this.host.classList.remove('is-keyboard-focus');
		this._stopSnap();
		this.input.focus({ preventScroll: true });
		this._pointer = event.pointerId;
		this._rect = this.host.getBoundingClientRect();
		try { this.input.setPointerCapture(event.pointerId); } catch { /* detached input */ }
		this.host.classList.add('is-dragging');
		this.onHover(true);
		this._drag(event);
	}

	private _drag(event: PointerEvent): void {
		if (!this._rect?.width || this._width <= 30) { return; }
		const fraction = (event.clientX - this._rect.left) / this._rect.width;
		this._pos = Math.max(0, Math.min(1, (fraction * this._width - 15) / (this._width - 30)));
		this._preview(Math.round(this._pos * (this.levels.length - 1)), true);
	}

	private _release(event: PointerEvent, cancel: boolean): void {
		if (event.pointerId !== this._pointer) { return; }
		this._pointer = undefined;
		this._rect = undefined;
		this.host.classList.remove('is-dragging');
		if (this.input.hasPointerCapture(event.pointerId)) { this.input.releasePointerCapture(event.pointerId); }
		if (cancel) { this._preview(this._committed, false); }
		else { this._commit(true); }
		this.onHover(this.input.matches(':hover'));
	}

	private _preview(index: number, continuous: boolean): void {
		const hadSparkles = this._showSparkles;
		this._index = Math.max(0, Math.min(this.levels.length - 1, index));
		if (!continuous) { this._pos = this._index / Math.max(1, this.levels.length - 1); }
		this.input.value = String(this._index);
		this.input.setAttribute('aria-valuetext', this.levels[this._index]);
		this.host.classList.toggle('is-maximum', this.celebrateMaximum && this._index === this.levels.length - 1);
		this._position();
		this.onPreview(this._index);
		if (hadSparkles !== this._showSparkles) { this._syncMotion(false); }
	}

	private _position(): void {
		const center = 15 + this._pos * Math.max(0, this._width - 30);
		this._knob.style.left = `${center}px`;
		this._fill.style.width = `${center + 15}px`;
	}

	private _commit(snap: boolean): void {
		const changed = this._committed !== this._index;
		const celebrate = changed && this.celebrateMaximum && this._index === this.levels.length - 1;
		this._committed = this._index;
		this._stopSnap();
		if (snap && !this._runtime.reducedMotion) { this.host.classList.add('is-snapping'); }
		this._preview(this._index, false);
		if (changed) { this.onCommit(this._index); }
		if (snap && !this._runtime.reducedMotion) {
			this._snapTimer = this._window.setTimeout(() => { this._snapTimer = 0; this.host.classList.remove('is-snapping'); if (celebrate) { this._celebrate(); } }, 380);
		} else if (celebrate) { this._celebrate(); }
	}

	private _stopSnap(): void {
		this._window.clearTimeout(this._snapTimer); this._snapTimer = 0;
		this.host.classList.remove('is-snapping');
	}

	private _resize(): void {
		const width = Math.min(480, this.host.clientWidth);
		const dpr = Math.min(2, this._window.devicePixelRatio || 1);
		if (!width || (width === this._width && dpr === this._dpr)) { return; }
		this._width = width; this._dpr = dpr;
		this._burst.style.left = `${(this._effectsHost === this.host ? 0 : this.host.offsetLeft) - 32}px`;
		this._burst.style.top = `${(this._effectsHost === this.host ? 0 : this.host.offsetTop) - 40}px`;
		for (const [canvas, w, h] of [[this._spark, width, 28], [this._burst, width + 64, 116]] as const) {
			canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
			canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
		}
		this._sparks = Array.from({ length: Math.min(24, Math.max(6, Math.round(width / 24))) }, () => ({ x: Math.random() * width, y: 4 + Math.random() * 20, r: 0.8 + Math.random() * 0.9, phase: Math.random() * Math.PI * 2, twinkle: 2.5 + Math.random() * 4.5, flow: 85 + Math.random() * 50 }));
		this._position();
		if (this._runtime.reducedMotion) { this._draw(this._window.performance.now(), 0); }
	}

	private _celebrate(): void {
		const now = this._window.performance.now();
		if (this._disposed || this._runtime.reducedMotion || this._runtime.hidden || now - this._lastBurst < 350 || this._index !== this.levels.length - 1) { return; }
		this._lastBurst = now;
		const center = 47 + this._pos * Math.max(0, this._width - 30);
		this._bursts = Array.from({ length: 14 }, (_, index) => {
			const angle = index / 14 * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
			const speed = 105 + Math.random() * 45;
			return { x: center + Math.cos(angle) * 15, y: 58 + Math.sin(angle) * 15, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 25, size: 4.5 + Math.random(), age: 0, ttl: 0.2 + Math.random() * 0.08 };
		});
		this._pulse?.cancel();
		this._pulse = this._knob.animate([{ scale: '1' }, { scale: '1.05' }, { scale: '1' }], { duration: 180, easing: 'ease-out' });
		if (!this._raf) { this._lastFrame = now; this._raf = this._runtime.requestFrame(time => this._tick(time)); }
	}

	private _syncMotion(reset = true): void {
		this._runtime.cancelFrame(this._raf); this._raf = 0;
		if (reset) { this._bursts = []; this._pulse?.cancel(); this._stopSnap(); }
		if (this._disposed || this._runtime.hidden) { return; }
		this._lastFrame = this._window.performance.now();
		this._draw(this._lastFrame, 0);
		if ((this._showSparkles || this._bursts.length > 0) && !this._runtime.reducedMotion) { this._raf = this._runtime.requestFrame(time => this._tick(time)); }
	}

	private _tick(time: number): void {
		this._raf = 0;
		if ((!this._showSparkles && !this._bursts.length) || this._disposed || this._runtime.hidden || this._runtime.reducedMotion) { return; }
		this._draw(time, Math.min(0.032, Math.max(0, (time - this._lastFrame) / 1000)));
		this._lastFrame = time;
		if (this._showSparkles || this._bursts.length) { this._raf = this._runtime.requestFrame(next => this._tick(next)); }
	}

	private _draw(time: number, dt: number): void {
		const ctx = this._spark.getContext('2d');
		if (ctx) {
			ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0); ctx.clearRect(0, 0, this._width, 28); ctx.fillStyle = '#fff';
			for (const particle of this._showSparkles ? this._sparks : []) {
				particle.x -= particle.flow * dt;
				if (particle.x < -3) { particle.x += this._width + 6; }
				const intensity = 0.5 + 0.5 * Math.sin(time / 1000 * particle.twinkle + particle.phase);
				ctx.globalAlpha = 0.06 + 0.74 * intensity * intensity; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2); ctx.fill();
			}
			ctx.globalAlpha = 1;
		}
		const burst = this._burst.getContext('2d');
		if (!burst) { return; }
		burst.setTransform(this._dpr, 0, 0, this._dpr, 0, 0); burst.clearRect(0, 0, this._width + 64, 116); burst.fillStyle = '#c9b0f0';
		this._bursts = this._bursts.filter(particle => {
			particle.age += dt;
			if (particle.age >= particle.ttl) { return false; }
			const damp = Math.exp(-6 * dt); particle.vx *= damp; particle.vy = particle.vy * damp - 20 * dt;
			particle.x += particle.vx * dt; particle.y += particle.vy * dt;
			burst.globalAlpha = Math.pow(1 - particle.age / particle.ttl, 1.5); burst.beginPath(); burst.arc(particle.x, particle.y, particle.size / 2, 0, Math.PI * 2); burst.fill();
			return true;
		});
		burst.globalAlpha = 1;
	}

	override dispose(): void {
		this._disposed = true;
		this._runtime.cancelFrame(this._raf); this._raf = 0;
		this._stopSnap(); this._pulse?.cancel();
		const pointer = this._pointer; this._pointer = undefined;
		if (pointer !== undefined && this.input.hasPointerCapture(pointer)) { this.input.releasePointerCapture(pointer); }
		this._sparks = []; this._bursts = [];
		this._spark.width = this._spark.height = this._burst.width = this._burst.height = 0;
		super.dispose();
	}
}
