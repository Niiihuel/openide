/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Runtime-independent actions performed against a browser viewport. Never include typed text. */
export type BrowserAgentAction = 'navigate' | 'move' | 'click' | 'doubleClick' | 'type' | 'keypress' | 'scroll' | 'hover' | 'focus' | 'wait' | 'screenshot' | 'success' | 'error';
export type BrowserAgentSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type BrowserAgentCoordinateSpace = 'normalized' | 'css' | 'device';

/** Dimensions describe the controlled page's viewport in CSS pixels, not its screenshot bitmap. */
export interface BrowserAgentViewport {
	readonly width: number;
	readonly height: number;
	readonly deviceScaleFactor?: number;
	/** Browser zoom applied to CSS coordinates when shown at native size. Defaults to one. */
	readonly zoomFactor?: number;
}

export interface BrowserAgentPoint {
	readonly x: number;
	readonly y: number;
	/** Omitted means CSS pixels relative to the controlled viewport. */
	readonly space?: BrowserAgentCoordinateSpace;
}

export interface BrowserAgentTarget extends BrowserAgentPoint {
	readonly width: number;
	readonly height: number;
	/** Accessible element name, never a selector, element value, or typed text. */
	readonly label?: string;
	readonly sensitive?: boolean;
}

/**
 * Serializable boundary between automation and presentation. A monotonically increasing
 * sequence fences delayed/duplicate updates within a session. Runtime objects must stay
 * on the producer side of this contract.
 */
export interface BrowserAgentEvent {
	readonly sessionId: string;
	/** Existing browser view to which this session is attached. */
	readonly pageId?: string;
	readonly sequence: number;
	readonly timestamp: number;
	readonly action: BrowserAgentAction;
	/** Invocation identity, paired with executionSequence; omit both for a simple synthetic stream. */
	readonly executionId?: string;
	/** Required with executionId. Monotonic invocation ordinal allows constant-space retirement. */
	readonly executionSequence?: number;
	readonly phase?: 'started' | 'updated' | 'completed';
	readonly status?: BrowserAgentSessionStatus;
	/** Permanent lifecycle boundary. Reopening requires a new session ID. */
	readonly closed?: boolean;
	readonly step?: number;
	readonly totalSteps?: number;
	readonly toolCallId?: string;
	readonly url?: string;
	readonly viewport?: BrowserAgentViewport;
	readonly point?: BrowserAgentPoint;
	/** Explicit null clears the previous target; omitted preserves it for related updates. */
	readonly target?: BrowserAgentTarget | null;
	/** Safe action summary only. Never include arguments, selectors, input values, or credentials. */
	readonly description?: string;
	readonly sensitive?: boolean;
	readonly scrollDelta?: { readonly x: number; readonly y: number };
	/** Sanitized error category/summary, never a raw runtime error containing call arguments. */
	readonly error?: string;
}
