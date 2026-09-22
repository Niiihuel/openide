/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { BrowserAgentEvent, BrowserAgentPoint, BrowserAgentSessionStatus, BrowserAgentTarget, BrowserAgentViewport } from './browserAgentEvents.js';

export interface BrowserAgentSessionState {
	readonly sessionId: string;
	readonly status: BrowserAgentSessionStatus;
	readonly url: string;
	readonly viewport: BrowserAgentViewport | undefined;
	readonly cursor: BrowserAgentPoint | undefined;
	readonly target: BrowserAgentTarget | undefined;
	readonly currentAction: BrowserAgentEvent | undefined;
	/** Bounded action history for feedback/recent steps; this is not a chat transcript. */
	readonly previousSteps: readonly BrowserAgentEvent[];
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly startedAt: number | undefined;
	readonly completedAt: number | undefined;
	readonly cancelled: boolean;
	readonly closed: boolean;
}

function validViewport(viewport: BrowserAgentViewport): boolean {
	return Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0
		&& (viewport.deviceScaleFactor === undefined || Number.isFinite(viewport.deviceScaleFactor) && viewport.deviceScaleFactor > 0)
		&& (viewport.zoomFactor === undefined || Number.isFinite(viewport.zoomFactor) && viewport.zoomFactor > 0);
}

function validPoint(point: BrowserAgentPoint): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * The model owns no runtime objects, DOM, animations, or timers. Its events are safe
 * snapshots: callers can retain them without subsequent events mutating their values.
 */
export class BrowserAgentSessionModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<BrowserAgentSessionState>());
	readonly onDidChange = this._onDidChange.event;
	private lastSequence = -1;
	private activeExecutionId: string | undefined;
	private activeExecutionSequence = -1;
	private _state: BrowserAgentSessionState;

	constructor(readonly sessionId: string, createdAt = Date.now(), private readonly historyLimit = 40) {
		super();
		this._state = {
			sessionId, status: 'idle', url: '', viewport: undefined, cursor: undefined, target: undefined,
			currentAction: undefined, previousSteps: [], createdAt, updatedAt: createdAt,
			startedAt: undefined, completedAt: undefined, cancelled: false, closed: false,
		};
	}

	get state(): BrowserAgentSessionState { return this._state; }

	/** Returns false for another session, stale/invalid input, or a fenced closed/cancelled session. */
	acceptEvent(incoming: BrowserAgentEvent): boolean {
		if (this._state.closed || this._state.cancelled || incoming.sessionId !== this.sessionId
			|| !Number.isSafeInteger(incoming.sequence) || incoming.sequence <= this.lastSequence
			|| incoming.executionId !== undefined && incoming.executionSequence === undefined
			|| incoming.executionSequence !== undefined && (!Number.isSafeInteger(incoming.executionSequence) || incoming.executionSequence < 0 || !incoming.executionId)
			|| !Number.isFinite(incoming.timestamp)
			|| incoming.viewport && !validViewport(incoming.viewport)
			|| incoming.point && !validPoint(incoming.point)
			|| incoming.target && (!validPoint(incoming.target) || !Number.isFinite(incoming.target.width) || incoming.target.width < 0 || !Number.isFinite(incoming.target.height) || incoming.target.height < 0)) {
			return false;
		}
		if (incoming.executionId && incoming.executionSequence !== undefined) {
			if (incoming.executionSequence < this.activeExecutionSequence
				|| incoming.executionSequence === this.activeExecutionSequence && incoming.executionId !== this.activeExecutionId
				|| incoming.executionId !== this.activeExecutionId && this.activeExecutionId && incoming.phase !== 'started' && !incoming.closed) {
				return false;
			}
			this.activeExecutionSequence = incoming.executionSequence;
			this.activeExecutionId = incoming.executionId;
		}
		const sensitive = incoming.sensitive || incoming.target?.sensitive
			|| incoming.target === undefined && (incoming.action === 'type' || incoming.action === 'keypress') && this._state.target?.sensitive;
		const event: BrowserAgentEvent = {
			...incoming,
			viewport: incoming.viewport ? { ...incoming.viewport } : undefined,
			point: incoming.point ? { ...incoming.point } : undefined,
			target: incoming.target ? { ...incoming.target, label: sensitive ? undefined : incoming.target.label } : incoming.target,
			scrollDelta: incoming.scrollDelta ? { ...incoming.scrollDelta } : undefined,
			description: sensitive ? undefined : incoming.description,
			error: sensitive ? undefined : incoming.error,
			sensitive: sensitive || undefined,
		};
		this.lastSequence = incoming.sequence;
		const previous = this._state.currentAction;
		const sameStep = previous && (event.step !== undefined && previous.step !== undefined
			? event.step === previous.step && event.toolCallId === previous.toolCallId
			: event.action === previous.action && event.phase !== 'started');
		let previousSteps = this._state.previousSteps;
		if (previous && !sameStep && previous.action !== 'move') {
			previousSteps = [...previousSteps, previous].slice(-Math.max(1, this.historyLimit));
		}
		const terminal = event.action === 'success' || event.action === 'error';
		const status = event.closed ? (event.status === 'error' || event.action === 'error' ? 'error' : 'completed')
			: event.status ?? (event.action === 'error' ? 'error' : event.action === 'success' ? 'completed'
				: this._state.status === 'paused' ? 'paused' : 'running');
		let target = event.closed || event.target === null || event.action === 'navigate' && event.phase === 'started' ? undefined : event.target ?? this._state.target;
		if (target && sensitive) {
			target = { ...target, sensitive: true, label: undefined };
		}
		const completedAt = terminal || status === 'completed' || status === 'error' || event.closed
			? (event.phase === 'updated' && status === this._state.status ? this._state.completedAt : undefined) ?? event.timestamp
			: undefined;
		this.update({
			...this._state,
			status,
			url: event.url ?? this._state.url,
			viewport: event.viewport ?? this._state.viewport,
			cursor: event.point ?? this._state.cursor,
			target,
			currentAction: event.closed ? undefined : event,
			previousSteps: event.closed ? [] : previousSteps,
			updatedAt: Math.max(this._state.updatedAt, event.timestamp),
			startedAt: this._state.startedAt ?? event.timestamp,
			completedAt,
			closed: event.closed ?? false,
		});
		return true;
	}

	/** A runtime pause preserves the logical cursor and target for a subsequent resume. */
	pause(timestamp = Date.now()): void {
		if (!this._state.closed && !this._state.cancelled && this._state.status === 'running') {
			this.setStatus('paused', timestamp);
		}
	}

	resume(timestamp = Date.now()): void {
		if (!this._state.closed && !this._state.cancelled && this._state.status === 'paused') {
			this.setStatus('running', timestamp);
		}
	}

	/** Cancelling permanently fences this execution; a subsequent execution gets a new session ID. */
	cancel(timestamp = Date.now()): void {
		if (!this._state.closed && !this._state.cancelled) {
			this.update({ ...this._state, status: 'idle', cancelled: true, currentAction: undefined, target: undefined, updatedAt: Math.max(timestamp, this._state.updatedAt), completedAt: timestamp });
		}
	}

	/** Keeps a small final snapshot for closed-session fencing; transient history is released. */
	close(timestamp = Date.now()): void {
		if (!this._state.closed) {
			this.update({ ...this._state, status: this._state.status === 'error' ? 'error' : 'completed', closed: true, currentAction: undefined, previousSteps: [], target: undefined, updatedAt: Math.max(timestamp, this._state.updatedAt), completedAt: this._state.completedAt ?? timestamp });
		}
	}

	setStatus(status: BrowserAgentSessionStatus, timestamp = Date.now()): void {
		if (!this._state.closed && !this._state.cancelled && this._state.status !== status) {
			this.update({ ...this._state, status, updatedAt: Math.max(timestamp, this._state.updatedAt), completedAt: status === 'completed' || status === 'error' ? timestamp : undefined });
		}
	}

	private update(state: BrowserAgentSessionState): void {
		this._state = state;
		this._onDidChange.fire(state);
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}
