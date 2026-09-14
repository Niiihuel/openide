/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../dom.js';
import { Disposable, IDisposable, toDisposable } from '../../../common/lifecycle.js';

/** Theme-configured motion for native context views. Layout and focus remain with ContextView. */
export class ContextViewMotion extends Disposable {
	private animation: Animation | undefined;
	private measuredEffect: AnimationEffect | null = null;
	private measuredBounds: DOMRect | undefined;
	private bounds: DOMRect | undefined;
	private observer: ResizeObserver | undefined;
	private scheduledLayout = 0;
	private scheduledWindow: Window | undefined;
	private preferenceListener: IDisposable | undefined;
	private active = false;

	constructor(private readonly element: HTMLElement, private readonly layout: () => void) { super(); }

	private duration(kind: 'morph' | 'enter' | 'exit'): number {
		const window = getWindow(this.element);
		if (this.element.closest('.monaco-reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return 0; }
		const property = kind === 'morph' ? '--vscode-context-view-motion-duration' : `--vscode-context-view-motion-${kind}-duration`;
		const value = window.getComputedStyle(this.element).getPropertyValue(property).trim();
		return Math.max(0, Math.min(400, (parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000)));
	}

	get enabled(): boolean { return this.duration('morph') > 0; }
	get exitDuration(): number { return this.duration('exit'); }

	/** Suspend our effect during native measurement, without restarting it on redundant layouts. */
	beforeLayout(): void {
		if (this.animation?.effect) {
			this.measuredBounds = this.element.getBoundingClientRect();
			this.measuredEffect = this.animation.effect;
			this.animation.effect = null;
		}
	}

	private cancelAnimation(): void {
		this.animation?.cancel();
		this.element.classList.remove('context-view-shared-animating');
		this.animation = undefined;
		this.measuredEffect = null;
		this.measuredBounds = undefined;
	}

	afterLayout(): void {
		const previous = this.bounds;
		const visual = this.measuredBounds ?? previous;
		const current = this.element.getBoundingClientRect();
		this.bounds = current;
		if (!this.active || !previous || !this.enabled) { this.cancelAnimation(); return; }
		if (Math.abs(previous.width - current.width) < 0.5 && Math.abs(previous.height - current.height) < 0.5) {
			if (this.animation && this.measuredEffect && Math.abs(previous.left - current.left) < 0.5 && Math.abs(previous.top - current.top) < 0.5) {
				this.animation.effect = this.measuredEffect;
				this.measuredEffect = null;
				this.measuredBounds = undefined;
			} else { this.cancelAnimation(); }
			return;
		}
		this.cancelAnimation();
		const dimensions = (rect: DOMRect): Keyframe => ({ minWidth: `${rect.width}px`, maxWidth: `${rect.width}px`, width: `${rect.width}px`, height: `${rect.height}px` });
		this.animate([
			{ ...dimensions(visual!), transform: `translate(${visual!.left - current.left}px, ${visual!.top - current.top}px)` },
			{ ...dimensions(current), transform: 'translate(0, 0)' },
		], this.duration('morph'));
	}

	open(): void {
		this.active = true;
		if (!this.enabled) { return; }
		const preference = getWindow(this.element).matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => { if (preference.matches) { this.cancelAnimation(); } };
		preference.addEventListener('change', update);
		this.preferenceListener = toDisposable(() => preference.removeEventListener('change', update));
		this.element.classList.add('context-view-shared-motion');
		this.element.style.transformOrigin = this.element.classList.contains('top') ? 'bottom center' : 'top center';
		this.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'scale(1)' }], this.duration('enter'));
		this.observer = new ResizeObserver(() => this.scheduleLayout());
		this.observer.observe(this.element);
	}

	private animate(frames: Keyframe[], duration: number): void {
		if (!duration) { return; }
		const easing = getWindow(this.element).getComputedStyle(this.element).getPropertyValue('--vscode-context-view-motion-easing').trim() || 'ease-out';
		this.element.classList.add('context-view-shared-animating');
		const animation = this.element.animate(frames, { duration, easing });
		this.animation = animation;
		animation.onfinish = () => {
			if (this.animation !== animation) { return; }
			this.element.classList.remove('context-view-shared-animating');
			this.animation = undefined;
			this.scheduleLayout();
		};
	}

	private scheduleLayout(): void {
		if (!this.active || this.animation || this.scheduledLayout) { return; }
		const current = this.element.getBoundingClientRect();
		if (this.bounds && Math.abs(current.width - this.bounds.width) < 0.5 && Math.abs(current.height - this.bounds.height) < 0.5) { return; }
		this.scheduledWindow = getWindow(this.element);
		this.scheduledLayout = this.scheduledWindow.requestAnimationFrame(() => {
			this.scheduledLayout = 0;
			this.scheduledWindow = undefined;
			if (this.active) { this.layout(); }
		});
	}

	/** Freeze the visual frame before cancellation so rapid close never flashes or jumps size. */
	prepareClose(): void {
		const style = getWindow(this.element).getComputedStyle(this.element);
		for (const property of closeProperties) {
			this.element.style.setProperty(`--vscode-context-view-motion-close-${property}`, style.getPropertyValue(property));
		}
	}

	finishClose(): void {
		for (const property of closeProperties) { this.element.style.removeProperty(`--vscode-context-view-motion-close-${property}`); }
	}

	/** Called synchronously on hide, including replacement, before the host's exit timer. */
	reset(): void {
		this.active = false;
		this.cancelAnimation();
		this.bounds = undefined;
		this.observer?.disconnect(); this.observer = undefined;
		this.scheduledWindow?.cancelAnimationFrame(this.scheduledLayout); this.scheduledLayout = 0; this.scheduledWindow = undefined;
		this.preferenceListener?.dispose(); this.preferenceListener = undefined;
		this.element.style.removeProperty('transform-origin');
	}

	override dispose(): void { this.reset(); this.finishClose(); super.dispose(); }
}

const closeProperties = ['opacity', 'transform', 'transform-origin', 'min-width', 'max-width', 'width', 'height'] as const;

/** Included in both the normal and shadow context-view roots. */
export const CONTEXT_VIEW_SHARED_MOTION_CSS = `
/* Native shared host motion: opt-in through theme variables, no framework or duplicate overlay. */
.context-view.context-view-shared-motion,
.context-view.context-view-shared-motion > .monaco-scrollable-element {
	animation: none !important;
}
/* Keep scrollbar geometry, but reveal its paint only once the frame has settled. */
.context-view.context-view-shared-animating::-webkit-scrollbar-thumb,
.context-view.context-view-shared-animating *::-webkit-scrollbar-thumb { background: transparent !important; }
.context-view.context-view-shared-animating .monaco-scrollable-element > .scrollbar { opacity: 0 !important; }
.context-view.context-view-shared-motion.context-view-shared-closing {
	animation: context-view-shared-close var(--vscode-context-view-close-animation-duration) var(--vscode-context-view-motion-easing, ease-out) both !important;
	pointer-events: none;
	transform: var(--vscode-context-view-motion-close-transform, none) !important;
	transform-origin: var(--vscode-context-view-motion-close-transform-origin, center) !important;
	min-width: var(--vscode-context-view-motion-close-min-width) !important;
	max-width: var(--vscode-context-view-motion-close-max-width) !important;
	width: var(--vscode-context-view-motion-close-width) !important;
	height: var(--vscode-context-view-motion-close-height) !important;
}
@keyframes context-view-shared-close {
	from { opacity: var(--vscode-context-view-motion-close-opacity, 1); }
	to { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
	.context-view.context-view-shared-motion.context-view-shared-closing { animation: none !important; }
}
`;
