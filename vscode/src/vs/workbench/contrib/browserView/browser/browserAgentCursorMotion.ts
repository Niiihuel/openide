/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserAgentRenderedPoint } from '../../../../platform/browserView/common/browserAgentCoordinates.js';

/** Presentation-only, critically damped motion. Retargeting preserves position and velocity. */
export class BrowserAgentCursorMotion {
	private position: BrowserAgentRenderedPoint | undefined;
	private destination: BrowserAgentRenderedPoint | undefined;
	private velocity: BrowserAgentRenderedPoint = { x: 0, y: 0 };
	private timestamp = 0;
	private frequency = .03;
	private moving = false;

	get active(): boolean { return this.moving; }

	reset(): void {
		this.position = this.destination = undefined;
		this.velocity = { x: 0, y: 0 };
		this.moving = false;
	}

	moveTo(destination: BrowserAgentRenderedPoint, time: number, immediate = false): void {
		if (immediate || !this.position) {
			this.position = this.destination = { ...destination };
			this.velocity = { x: 0, y: 0 };
			this.timestamp = time;
			this.moving = false;
			return;
		}
		if (destination.x === this.destination?.x && destination.y === this.destination?.y) { return; }
		// Advance the old trajectory before changing its destination. Restarting an ease-out
		// at each mouse event would discard momentum and visibly stutter on dense streams.
		const current = this.sample(time)!;
		const distance = Math.hypot(destination.x - current.x, destination.y - current.y);
		this.frequency = 1 / Math.min(42, Math.max(26, 26 + distance * .018));
		this.destination = { ...destination };
		this.timestamp = time;
		this.moving = true;
	}

	sample(time: number): BrowserAgentRenderedPoint | undefined {
		if (!this.position || !this.destination || !this.moving) { return this.position; }
		const elapsed = Math.max(0, time - this.timestamp);
		const decay = Math.exp(-this.frequency * elapsed);
		const axis = (position: number, destination: number, velocity: number) => {
			const offset = position - destination;
			const momentum = velocity + this.frequency * offset;
			return { position: destination + (offset + momentum * elapsed) * decay, velocity: (velocity - this.frequency * momentum * elapsed) * decay };
		};
		const x = axis(this.position.x, this.destination.x, this.velocity.x);
		const y = axis(this.position.y, this.destination.y, this.velocity.y);
		this.position = { x: x.position, y: y.position };
		this.velocity = { x: x.velocity, y: y.velocity };
		this.timestamp = Math.max(this.timestamp, time);
		if (Math.hypot(this.destination.x - x.position, this.destination.y - y.position) < .15 && Math.hypot(x.velocity, y.velocity) < .008) {
			this.position = this.destination;
			this.velocity = { x: 0, y: 0 };
			this.moving = false;
		}
		return this.position;
	}
}
