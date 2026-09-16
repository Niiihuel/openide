/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';

interface MotionSurface {
	readonly element: HTMLElement;
	readonly parent?: HTMLElement;
	readonly exitContainer?: HTMLElement;
	readonly direction?: number;
}
interface SurfaceFrame {
	readonly bounds: DOMRect;
	readonly display: string;
	readonly opacity: number;
	readonly visible: boolean;
}

/** Keeps exiting panels mounted over the final layout. Only transform and opacity interpolate. */
export class OpenideAgentWindowMotion extends Disposable {
	private readonly animations: Animation[] = [];
	private readonly exits = new Map<HTMLElement, () => void>();

	constructor(private readonly targetWindow: Window, private readonly surfaces: readonly MotionSurface[], private readonly settled: () => void) { super(); }

	isExiting(host: HTMLElement): boolean { return this.exits.has(host); }

	finish(): void {
		for (const animation of this.animations.splice(0)) { animation.onfinish = null; animation.cancel(); }
		for (const cleanup of this.exits.values()) { cleanup(); }
		this.exits.clear();
		this.settled();
	}

	private read(surface: MotionSurface): SurfaceFrame {
		const bounds = surface.element.getBoundingClientRect();
		const style = this.targetWindow.getComputedStyle(surface.element);
		return { bounds, display: style.display, visible: bounds.width > 0 && bounds.height > 0, opacity: Number(style.opacity) };
	}

	/** Returns whether surfaces are still moving and native editor content must remain hidden. */
	run(change: () => void, animate: boolean): boolean {
		const before = animate ? this.surfaces.map(surface => this.read(surface)) : [];
		this.finish();
		change();
		if (!animate) { return false; }
		const after = this.surfaces.map(surface => this.read(surface));
		for (let i = 0; i < this.surfaces.length; i++) {
			const surface = this.surfaces[i], previous = before[i], next = after[i];
			if (!previous.visible || next.visible) { continue; }
			const host = surface.element;
			const hidden = host.hidden;
			const inert = host.inert;
			const style = host.getAttribute('style');
			const originalParent = host.parentElement!;
			const nextSibling = host.nextSibling;
			const parent = surface.exitContainer ?? originalParent;
			// An exiting child must escape ancestors whose final layout clips its old bounds.
			if (parent !== originalParent) { parent.appendChild(host); }
			const parentBounds = parent.getBoundingClientRect();
			// Retain the original size, including a native editor's viewport, until the fade ends.
			host.hidden = false;
			host.classList.add('openide-agent-motion-exit');
			host.style.cssText += `;position:absolute;left:${previous.bounds.left - parentBounds.left}px;top:${previous.bounds.top - parentBounds.top}px;width:${previous.bounds.width}px;height:${previous.bounds.height}px;right:auto;bottom:auto;`;
			host.style.setProperty('display', previous.display, 'important');
			host.inert = true;
			this.exits.set(host, () => {
				if (parent !== originalParent) { originalParent.insertBefore(host, nextSibling); }
				host.hidden = hidden;
				host.inert = inert;
				host.classList.remove('openide-agent-motion-exit');
				if (style === null) { host.removeAttribute('style'); } else { host.setAttribute('style', style); }
			});
		}
		const finalFrames = this.surfaces.map(surface => this.read(surface));
		const timing: KeyframeAnimationOptions = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' };
		for (let i = 0; i < this.surfaces.length; i++) {
			const surface = this.surfaces[i], previous = before[i], next = finalFrames[i];
			if (!next.visible) { continue; }
			const closing = previous.visible && !after[i].visible;
			let x = previous.visible ? previous.bounds.left - next.bounds.left : (surface.direction ?? 0) * 18;
			let scale = previous.visible ? previous.bounds.width / next.bounds.width : 1;
			// Child FLIP must compensate for its parent's transform, instead of applying it twice.
			const parentIndex = this.surfaces.findIndex(candidate => candidate.element === surface.parent);
			if (!(closing && surface.exitContainer) && parentIndex >= 0 && before[parentIndex].visible && finalFrames[parentIndex].visible) {
				const oldParent = before[parentIndex].bounds, newParent = finalFrames[parentIndex].bounds;
				const parentScale = oldParent.width / newParent.width;
				x = previous.visible ? (previous.bounds.left - oldParent.left) / parentScale - (next.bounds.left - newParent.left) : x;
				scale /= parentScale;
			}
			const opacity = previous.visible ? previous.opacity : 0;
			if (Math.abs(x) < 0.5 && Math.abs(scale - 1) < 0.001 && opacity === 1 && !closing) { continue; }
			const animation = surface.element.animate([
				{ transform: `translateX(${x}px) scaleX(${scale})`, transformOrigin: '0 0', opacity },
				{ transform: closing ? `translateX(${(surface.direction ?? 0) * 18}px)` : 'none', transformOrigin: '0 0', opacity: closing ? 0 : 1 },
			], timing);
			animation.id = 'openide-agent-layout';
			this.animations.push(animation);
		}
		const last = this.animations.at(-1);
		if (last) { last.onfinish = () => this.finish(); return true; }
		this.finish();
		return false;
	}

	override dispose(): void { this.finish(); super.dispose(); }
}
