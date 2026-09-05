/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatLiveStatus } from '../../common/chat/openideChatLiveStatus.js';
import { OPENIDE_CHAT_SHIMMER_CLASS } from './parts/openideChatActivityRow.js';

/**
 * The turn's live line: one row, one label, and a swap between steps.
 *
 * This is the vanilla equivalent of the React idiom the user asked for —
 *
 *   <AnimatePresence mode="wait">
 *     <motion.span key={status} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
 *                  exit={{opacity:0,y:-4}} transition={{duration:0.18}} />
 *   </AnimatePresence>
 *
 * — and `mode="wait"` is the part that matters: the outgoing step leaves BEFORE the incoming one
 * arrives, so the two never overlap and the row never needs a second line or an absolute position.
 * The label keeps its shimmer across the swap, because the shimmer says "still working" and the
 * swap says "working on something else now"; restarting the sweep on every step would turn a
 * continuous state into a stutter.
 *
 * The animation is WAAPI and not CSS classes on purpose: `mode="wait"` needs to know when the exit
 * finished, and an `animationend` listener has nothing to fire under `prefers-reduced-motion`,
 * where the rule is `animation: none`. Here the reduced-motion branch is an explicit early commit.
 */

const EXIT_MS = 60;
const ENTER_MS = 100;
/** The 4px of the snippet: enough to read as motion, not enough to read as the row jumping. */
const SHIFT_PX = 4;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * How long a step is guaranteed to stay readable.
 *
 * The agent's steps do not arrive at a human pace: a batch of reads settles in a few hundred
 * milliseconds and, without a floor, the line rewrote itself faster than anyone could read it —
 * which is strictly worse than showing nothing, because a label flashing past still costs the eye
 * a trip to it. A step is held for this long and any newer step waits its turn; when several pile
 * up, only the LAST one is shown, so the line stays on the present rather than replaying a queue.
 */
export const OPENIDE_CHAT_STEP_MIN_MS = 150;

/**
 * How long a step is held before the line is allowed to fall back to the generic wait.
 *
 * This is the other half of the flicker, and the one that made "Planning next moves" feel like the
 * only thing the dock ever said: the gap between one call settling and the next one starting is
 * usually shorter than a second, so a line that went generic the moment a step finished spent most
 * of the turn on the filler and flashed the real work past. The last step therefore stays up until
 * the pause is long enough to actually BE a pause — and then the generic wait is honest, because
 * the agent really is between things.
 */
export const OPENIDE_CHAT_IDLE_GRACE_MS = 500;

export interface IOpenideChatStatusLineTiming {
	readonly stepMinMs?: number;
	readonly idleGraceMs?: number;
}

export class OpenideChatStatusLine extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _label: HTMLElement;

	/** What the label reads right now. Empty means the line is not showing anything yet. */
	private _shown = '';
	/** Whether what is on screen is the generic wait rather than a real step. */
	private _shownIsIdle = false;
	/** When the current text was committed, which is what both waits are measured against. */
	private _shownAt = 0;
	/** What it should read next. Differs from `_shown` while a swap is waiting or in flight. */
	private _pending: IOpenideChatLiveStatus | undefined;
	private _busy = false;
	private _animation: Animation | undefined;
	private _disposed = false;

	private readonly _stepMinMs: number;
	private readonly _idleGraceMs: number;
	/**
	 * Fires the swap that is waiting out a minimum. It has to exist: the renderer only calls in
	 * when the CONTENT changed, and a step whose turn came while nothing was arriving would
	 * otherwise sit in `_pending` until the next delta — which, at the end of a turn, is never.
	 */
	private readonly _later: RunOnceScheduler;

	constructor(container: HTMLElement, timing?: IOpenideChatStatusLineTiming) {
		super();
		this._stepMinMs = timing?.stepMinMs ?? OPENIDE_CHAT_STEP_MIN_MS;
		this._idleGraceMs = timing?.idleGraceMs ?? OPENIDE_CHAT_IDLE_GRACE_MS;
		this.domNode = append(container, $('.openide-chat-response-working.hidden'));
		// The text lives in a child: the shimmer clips a gradient to it (`background-clip: text`),
		// and a flex row owns no text of its own to clip against.
		this._label = append(this.domNode, $(`span.openide-chat-response-working-label.${OPENIDE_CHAT_SHIMMER_CLASS}`));
		this._later = this._register(new RunOnceScheduler(() => this._swap(), 0));
		this._register({ dispose: () => { this._disposed = true; this._animation?.cancel(); } });
	}

	/**
	 * Shows `status`, swapping in place once the current text has had its time.
	 *
	 * Called on every render, so it is mostly a no-op: the same status arriving again changes
	 * nothing, and in particular does not restart a wait that is already counting down.
	 */
	setStatus(status: IOpenideChatLiveStatus): void {
		this.domNode.classList.remove('hidden');
		if (status.text === this._pending?.text && status.idle === this._pending.idle) {
			return;
		}
		// Whatever was waiting its turn is stale now: only the newest status is ever shown, so a
		// burst of steps ends on the present instead of replaying a queue.
		this._pending = status;
		this._swap();
	}

	/**
	 * Hides the line and forgets what it said.
	 *
	 * Forgetting is what makes the next appearance ENTER instead of swapping out of a step the user
	 * never saw — the line comes back for a new turn, not for the previous one's last word.
	 */
	hide(): void {
		this.domNode.classList.add('hidden');
		this._animation?.cancel();
		this._animation = undefined;
		this._later.cancel();
		this._busy = false;
		this._shown = '';
		this._shownIsIdle = false;
		this._shownAt = 0;
		this._pending = undefined;
		this._label.textContent = '';
	}

	private _swap(): void {
		if (this._disposed || this._busy || !this._pending || this._pending.text === this._shown) {
			return;
		}
		// Nothing on screen yet: the first thing a turn has to say says it immediately. A wait here
		// would be a wait on an empty line, which is the one case where holding shows nothing.
		if (this._shown) {
			const hold = this._pending.idle && !this._shownIsIdle ? this._idleGraceMs : this._stepMinMs;
			const left = hold - (Date.now() - this._shownAt);
			if (left > 0) {
				this._later.cancel();
				this._later.schedule(left);
				return;
			}
		}
		this._busy = true;
		// Any label that arrived while this swap was running is picked up on the way out, so a burst
		// of steps ends on the newest one instead of queueing a swap per step.
		const done = () => {
			this._busy = false;
			this._swap();
		};
		if (this._reducedMotion()) {
			this._commit();
			done();
			return;
		}
		if (!this._shown) {
			this._commit();
			this._animate([{ opacity: 0, transform: `translateY(${SHIFT_PX}px)` }, { opacity: 1, transform: 'translateY(0)' }], ENTER_MS, done);
			return;
		}
		this._animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: `translateY(-${SHIFT_PX}px)` }], EXIT_MS, () => {
			if (this._disposed) {
				return;
			}
			this._commit();
			this._animate([{ opacity: 0, transform: `translateY(${SHIFT_PX}px)` }, { opacity: 1, transform: 'translateY(0)' }], ENTER_MS, done);
		});
	}

	private _commit(): void {
		this._shown = this._pending?.text ?? '';
		this._shownIsIdle = this._pending?.idle === true;
		this._shownAt = Date.now();
		this._label.textContent = this._shown;
	}

	private _animate(keyframes: Keyframe[], duration: number, onDone: () => void): void {
		// `fill: forwards` keeps a FINISHED animation in the element's effect stack; without this
		// the label would accumulate one per step for the whole turn.
		this._animation?.cancel();
		const animation = this._label.animate(keyframes, { duration, easing: EASING, fill: 'forwards' });
		this._animation = animation;
		animation.onfinish = () => {
			if (this._animation !== animation) { return; }
			this._animation = undefined;
			animation.onfinish = null;
			animation.oncancel = null;
			animation.cancel();
			if (!this._disposed) {
				onDone();
			}
		};
		// A cancelled animation (dispose, or the row being recycled mid-swap) must not leave the
		// swap flagged busy forever: the next `setLabel` would then never reach the DOM.
		animation.oncancel = () => {
			if (this._animation === animation) {
				this._animation = undefined;
			}
		};
	}

	private _reducedMotion(): boolean {
		return getWindow(this.domNode).matchMedia('(prefers-reduced-motion: reduce)').matches;
	}
}
