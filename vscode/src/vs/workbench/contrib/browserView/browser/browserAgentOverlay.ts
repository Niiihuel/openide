/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow, addDisposableListener } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { BrowserAgentEvent, BrowserAgentPoint } from '../../../../platform/browserView/common/browserAgentEvents.js';
import { BrowserAgentSessionModel, BrowserAgentSessionState } from '../../../../platform/browserView/common/browserAgentSessionModel.js';
import { BrowserAgentRenderedPoint, BrowserAgentRenderedRect, createBrowserAgentViewportTransform } from '../../../../platform/browserView/common/browserAgentCoordinates.js';
import { BrowserAgentCursorMotion } from './browserAgentCursorMotion.js';
import './media/browserAgentOverlay.css';

interface Motion<T> { from: T; to: T; started: number; duration: number }

export interface BrowserAgentOverlayOptions {
	readonly reducedMotion?: boolean;
	/** Tests and non-layout hosts can supply dimensions directly through layout(). */
	readonly observeResize?: boolean;
}

/** Native presentation of a runtime-independent session. It never sees a Playwright object. */
export class BrowserAgentOverlay extends Disposable {
	readonly domNode: HTMLElement;
	private readonly cursor: HTMLElement;
	private readonly cursorGlyph: HTMLElement;
	private readonly target: HTMLElement;
	private readonly hud: HTMLElement;
	private readonly label: HTMLElement;
	private readonly counter: HTMLElement;
	private readonly scroll: HTMLElement;
	private readonly trails: HTMLElement[];
	private readonly ripples: HTMLElement[];
	private readonly animations = new Set<Animation>();
	private readonly window;
	private readonly media;
	private width = 0;
	private height = 0;
	private frame: number | undefined;
	private cursorPosition: BrowserAgentRenderedPoint | undefined;
	private targetPosition: BrowserAgentRenderedRect | undefined;
	private readonly cursorMotion = new BrowserAgentCursorMotion();
	private readonly cursorHistory: { point: BrowserAgentRenderedPoint; time: number }[] = [];
	private targetMotion: Motion<BrowserAgentRenderedRect> | undefined;
	private lastTarget: BrowserAgentRenderedRect | undefined;
	private readonly pendingClicks: { point: BrowserAgentPoint; double: boolean; sequence: number }[] = [];
	private readonly pendingActions: BrowserAgentSessionState[] = [];
	private presentation: BrowserAgentSessionState;
	private presentedAt: number | undefined;
	private lastSequence = -1;
	private nextRipple = 0;
	private visible = true;
	private readonly settle = this._register(new RunOnceScheduler(() => {
		this.domNode.classList.add('settled');
		this.hud.setAttribute('aria-live', 'off');
	}, 1600));

	constructor(parent: HTMLElement, private readonly model: BrowserAgentSessionModel, private readonly options: BrowserAgentOverlayOptions = {}) {
		super();
		this.presentation = model.state;
		this.window = getWindow(parent);
		this.media = this.window.matchMedia('(prefers-reduced-motion: reduce)');
		this.domNode = append(parent, $('.browser-agent-overlay', { 'data-session-id': model.sessionId }));
		const targets = append(this.domNode, $('.browser-agent-target-layer', { 'aria-hidden': 'true' }));
		this.target = append(targets, $('.browser-agent-target'));
		const effects = append(this.domNode, $('.browser-agent-effects-layer', { 'aria-hidden': 'true' }));
		this.ripples = [append(effects, $('.browser-agent-ripple')), append(effects, $('.browser-agent-ripple'))];
		this.scroll = append(effects, $('.browser-agent-scroll'));
		const cursors = append(this.domNode, $('.browser-agent-cursor-layer', { 'aria-hidden': 'true' }));
		this.trails = [append(cursors, $('.browser-agent-trail')), append(cursors, $('.browser-agent-trail'))];
		for (const trail of this.trails) { append(trail, $('.browser-agent-cursor-glyph')); trail.hidden = true; }
		this.cursor = append(cursors, $('.browser-agent-cursor'));
		this.cursorGlyph = append(this.cursor, $('.browser-agent-cursor-glyph'));
		this.cursor.hidden = true;
		this.hud = append(this.domNode, $('.browser-agent-hud', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
		append(this.hud, $('span.browser-agent-status-icon', { 'aria-hidden': 'true' }));
		this.label = append(this.hud, $('span.browser-agent-label'));
		this.label.textContent = localize('browser.agent.waiting', "Waiting for page");
		this.counter = append(this.hud, $('span.browser-agent-step'));
		this._register(model.onDidChange(state => this.update(state)));
		this._register(addDisposableListener(this.media, 'change', () => {
			if (this.reducedMotion) { this.cancelEffects(); }
			this.schedule();
		}));
		if (options.observeResize !== false) {
			const observer = new this.window.ResizeObserver(entries => {
				const size = entries[0]?.contentRect;
				if (size) { this.layout(size.width, size.height); }
			});
			observer.observe(parent);
			this._register(toDisposable(() => observer.disconnect()));
		}
		this._register(toDisposable(() => {
			if (this.frame !== undefined) { this.window.cancelAnimationFrame(this.frame); }
			this.cancelEffects(); this.pendingClicks.length = this.pendingActions.length = 0; this.domNode.remove();
		}));
		this.update(model.state);
	}

	private get reducedMotion(): boolean { return this.options.reducedMotion ?? this.media.matches; }

	layout(width: number, height: number): void {
		if (this.width === width && this.height === height) { return; }
		this.width = Math.max(0, width); this.height = Math.max(0, height);
		// Resize is a coordinate change, not a new pointer movement. Remap the same logical point.
		this.cursorMotion.reset(); this.targetMotion = undefined;
		this.cursorHistory.length = 0;
		this.cursorPosition = undefined;
		this.targetPosition = this.lastTarget = undefined;
		this.schedule();
	}

	setVisible(visible: boolean): void {
		this.visible = visible; this.domNode.hidden = !visible || this.model.state.closed || this.model.state.cancelled;
		if (visible) { this.schedule(); }
		else {
			if (this.frame !== undefined) { this.window.cancelAnimationFrame(this.frame); this.frame = undefined; }
			this.cancelEffects();
		}
	}

	private update(state: BrowserAgentSessionState): void {
		this.domNode.hidden = !this.visible || state.closed || state.cancelled;
		if (state.closed || state.cancelled) {
			this.settle.cancel(); this.pendingClicks.length = this.pendingActions.length = 0;
			if (this.frame !== undefined) { this.window.cancelAnimationFrame(this.frame); this.frame = undefined; }
			this.cancelEffects();
			return;
		}
		const event = state.currentAction;
		const previous = (this.pendingActions.at(-1) ?? this.presentation).currentAction;
		// Geometry/progress updates belong to the same visible action. Raw mouse events can
		// be coalesced, but distinct actions must get a painted frame even in a fast tool batch.
		const sameAction = previous && event && (previous.sequence === event.sequence
			|| previous.action === event.action && (event.action === 'move'
				|| previous.step === event.step && previous.toolCallId === event.toolCallId && previous.executionId === event.executionId && event.phase !== 'started'));
		if (!previous || !event || !this.visible) {
			this.pendingActions.length = 0;
			this.present(state, true);
		} else if (sameAction) {
			if (this.pendingActions.length) { this.pendingActions[this.pendingActions.length - 1] = state; }
			else { this.present(state, false); }
		} else {
			this.pendingActions.push(state);
		}
		this.schedule();
	}

	private present(state: BrowserAgentSessionState, nextAction: boolean): void {
		this.presentation = state;
		if (nextAction) { this.presentedAt = undefined; }
		this.domNode.dataset.status = state.status;
		const event = state.currentAction;
		if (event && event.sequence !== this.lastSequence) {
			this.lastSequence = event.sequence;
			this.domNode.dataset.sequence = String(event.sequence);
			this.domNode.dataset.action = event.action;
			this.domNode.classList.remove('settled');
			this.hud.setAttribute('aria-live', event.action === 'move' ? 'off' : 'polite');
			this.label.textContent = browserAgentActionLabel(event);
			this.counter.textContent = event.step === undefined ? '' : event.totalSteps ? `${event.step} / ${event.totalSteps}` : String(event.step);
			// The runtime may auto-scroll before clicking. Pulse at its final viewport
			// coordinates once the click has actually happened, never on geometry updates.
			if ((event.action === 'click' || event.action === 'doubleClick') && (event.phase === undefined || event.phase === 'completed') && state.cursor) {
				this.pendingClicks.push({ point: state.cursor, double: event.action === 'doubleClick', sequence: event.sequence });
				if (this.pendingClicks.length > 4) { this.pendingClicks.shift(); }
			}
			this.settle.cancel();
			if (event.phase === 'completed' || state.status === 'completed' || state.status === 'error') { this.settle.schedule(state.status === 'error' ? 2800 : 1600); }
		}
	}

	private schedule(): void {
		if (this.frame !== undefined || this._store.isDisposed || !this.visible || this.model.state.closed || this.model.state.cancelled) { return; }
		this.frame = this.window.requestAnimationFrame(time => { this.frame = undefined; this.render(time); });
	}

	private render(time: number): void {
		// Pace presentation only. Playwright runs independently and never waits for animation.
		// Dense batches shorten the dwell; every non-move action still receives its own frame.
		const dwell = this.presentation.currentAction?.action === 'move' ? 0 : this.pendingActions.length > 3 ? 80 : 160;
		if (this.pendingActions.length && !this.cursorMotion.active && !this.pendingClicks.length && this.presentedAt !== undefined && time - this.presentedAt >= dwell) {
			this.present(this.pendingActions.shift()!, true);
		}
		this.presentedAt ??= time;
		const state = this.presentation;
		if (!state.viewport || !this.width || !this.height) {
			if (this.pendingActions.length) { this.schedule(); }
			return;
		}
		const transform = createBrowserAgentViewportTransform(state.viewport, { width: this.width, height: this.height });
		// A fast runtime can finish a click and start the next move before the cursor arrives.
		// Keep completed clicks as bounded waypoints, so their feedback happens at the pointer.
		const point: BrowserAgentPoint = this.pendingClicks[0]?.point ?? state.cursor ?? { x: .5, y: .5, space: 'normalized' };
		const destination = transform.point(point);
		this.cursor.hidden = false;
		this.cursorMotion.moveTo(destination, time, this.reducedMotion);
		this.cursorPosition = this.cursorMotion.sample(time)!;
		this.place(this.cursor, this.cursorPosition);
		this.renderTrails(time);
		const box = state.target ? transform.rect(state.target) : undefined;
		this.target.hidden = !box;
		this.target.dataset.state = state.status === 'error' ? 'error' : state.status === 'completed' || state.currentAction?.phase === 'completed' ? 'success' : 'active';
		if (box && (!this.lastTarget || Object.keys(box).some(key => box[key as keyof typeof box] !== this.lastTarget![key as keyof typeof box]))) {
			this.targetMotion = { from: this.targetPosition ?? box, to: box, started: time, duration: this.reducedMotion ? 0 : 160 };
			this.lastTarget = box;
		}
		if (this.targetMotion) {
			const motion = this.targetMotion; const progress = this.progress(motion, time);
			this.targetPosition = { ...this.mix(motion.from, motion.to, progress), width: motion.from.width + (motion.to.width - motion.from.width) * progress, height: motion.from.height + (motion.to.height - motion.from.height) * progress };
			this.place(this.target, this.targetPosition);
			this.target.style.width = `${this.targetPosition.width}px`; this.target.style.height = `${this.targetPosition.height}px`;
			if (progress >= 1) { this.targetMotion = undefined; }
		}
		if (!this.cursorMotion.active && this.pendingClicks.length) {
			const click = this.pendingClicks.shift()!;
			if (!this.reducedMotion) { this.pulse(transform.point(click.point), click.double); }
			this.domNode.dataset.lastClick = String(click.sequence);
			// Continue toward a following click/latest pointer on the next frame, even when the
			// model has already gone quiet. No artificial delays are introduced in Playwright.
			this.schedule();
		}
		const scrolling = state.currentAction?.action === 'scroll';
		this.scroll.hidden = !scrolling || !this.cursorPosition;
		if (scrolling && this.cursorPosition) {
			const delta = state.currentAction?.scrollDelta;
			this.scroll.textContent = Math.abs(delta?.x ?? 0) > Math.abs(delta?.y ?? 0) ? ((delta?.x ?? 0) > 0 ? '→' : '←') : ((delta?.y ?? 0) > 0 ? '↓' : '↑');
			this.place(this.scroll, { x: this.cursorPosition.x + 20, y: this.cursorPosition.y });
		}
		if (this.cursorMotion.active || this.targetMotion || this.pendingActions.length) { this.schedule(); }
	}

	private renderTrails(time: number): void {
		if (this.reducedMotion || !this.cursorMotion.active || !this.cursorPosition) {
			this.cursorHistory.length = 0;
			for (const trail of this.trails) { trail.hidden = true; }
			return;
		}
		this.cursorHistory.push({ point: this.cursorPosition, time });
		while (this.cursorHistory.length > 12 || this.cursorHistory[0]?.time < time - 100) { this.cursorHistory.shift(); }
		this.trails.forEach((trail, index) => {
			const previous = this.cursorHistory.findLast(sample => sample.time <= time - (index + 1) * 24);
			trail.hidden = !previous || Math.hypot(previous.point.x - this.cursorPosition!.x, previous.point.y - this.cursorPosition!.y) < 2;
			if (previous) { this.place(trail, previous.point); }
		});
	}

	private cancelEffects(): void {
		for (const animation of this.animations) { animation.cancel(); }
		this.animations.clear();
		this.cursorHistory.length = 0;
		for (const trail of this.trails) { trail.hidden = true; }
	}

	private progress(motion: Motion<BrowserAgentRenderedPoint>, time: number): number {
		const t = this.reducedMotion || !motion.duration ? 1 : Math.min(1, Math.max(0, (time - motion.started) / motion.duration));
		return 1 - Math.pow(1 - t, 3);
	}
	private mix(from: BrowserAgentRenderedPoint, to: BrowserAgentRenderedPoint, progress: number): BrowserAgentRenderedPoint {
		return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
	}
	private place(element: HTMLElement, point: BrowserAgentRenderedPoint): void { element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`; }
	private pulse(point: BrowserAgentRenderedPoint, double: boolean): void {
		// The glyph presses around its hotspot; the wrapper remains at the actual click point.
		for (const animation of this.cursorGlyph.getAnimations()) { animation.cancel(); this.animations.delete(animation); }
		const press = this.cursorGlyph.animate([
			{ transform: 'scale(1)' }, { transform: 'scale(.88)', offset: .35 }, { transform: 'scale(1)' },
		], { duration: double ? 260 : 180, easing: 'cubic-bezier(.2,.7,.2,1)' });
		this.animations.add(press);
		void press.finished.then(() => this.animations.delete(press), () => this.animations.delete(press));
		for (let index = 0; index < (double ? 2 : 1); index++) {
			const ripple = this.ripples[this.nextRipple++ % this.ripples.length];
			for (const animation of ripple.getAnimations()) { animation.cancel(); this.animations.delete(animation); }
			const position = `translate3d(${point.x}px, ${point.y}px, 0)`;
			const animation = ripple.animate([
				{ transform: `${position} scale(.2)`, opacity: .8 },
				{ transform: `${position} scale(1.4)`, opacity: 0 },
			], { duration: 420, delay: index * 100, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'none' });
			this.animations.add(animation);
			void animation.finished.then(() => this.animations.delete(animation), () => this.animations.delete(animation));
		}
	}
}

/** Typed values and raw runtime errors are deliberately never used as presentation strings. */
export function browserAgentActionLabel(event: BrowserAgentEvent): string {
	const name = event.sensitive || event.target?.sensitive ? '' : event.target?.label?.slice(0, 80);
	switch (event.action) {
		case 'navigate': {
			let url = '';
			try { const parsed = new URL(event.url ?? ''); url = parsed.host + parsed.pathname; } catch { /* No untrusted URL text in the HUD. */ }
			return url ? localize('browser.agent.openingURL', "Opening {0}…", url) : localize('browser.agent.opening', "Opening page…");
		}
		case 'click': case 'doubleClick': return name ? localize('browser.agent.clickingTarget', 'Clicking "{0}"', name) : localize('browser.agent.clicking', "Clicking");
		case 'type': return name ? localize('browser.agent.typingTarget', 'Typing in "{0}"', name) : localize('browser.agent.typing', "Typing…");
		case 'keypress': return localize('browser.agent.keypress', "Pressing a key");
		case 'scroll': return (event.scrollDelta?.y ?? 0) < 0 ? localize('browser.agent.scrollUp', "Scrolling up") : localize('browser.agent.scrollDown', "Scrolling down");
		case 'wait': return localize('browser.agent.waiting', "Waiting for page");
		case 'screenshot': return localize('browser.agent.checking', "Checking result");
		case 'error': return name ? localize('browser.agent.errorTarget', 'Could not interact with "{0}"', name) : localize('browser.agent.error', "Browser action failed");
		case 'success': return localize('browser.agent.completed', "Action completed");
		case 'hover': case 'focus': return name ? localize('browser.agent.target', 'Targeting "{0}"', name) : localize('browser.agent.focusing', "Focusing element");
		default: return localize('browser.agent.moving', "Moving pointer");
	}
}
