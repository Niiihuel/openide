/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserAgentPoint, BrowserAgentTarget, BrowserAgentViewport } from './browserAgentEvents.js';

export interface BrowserAgentViewportLayout {
	readonly width: number;
	readonly height: number;
	/** Contain is for letterboxed screenshots. Native follows browser zoom without fitting. */
	readonly fit?: 'contain' | 'fill' | 'native';
	readonly offsetX?: number;
	readonly offsetY?: number;
	/** Additional presentation zoom, independent of the remote browser's zoom. */
	readonly zoomFactor?: number;
}

export interface BrowserAgentRenderedPoint {
	readonly x: number;
	readonly y: number;
}

export interface BrowserAgentRenderedRect extends BrowserAgentRenderedPoint {
	readonly width: number;
	readonly height: number;
}

export interface BrowserAgentViewportTransform {
	readonly contentRect: BrowserAgentRenderedRect;
	readonly scaleX: number;
	readonly scaleY: number;
	point(point: BrowserAgentPoint): BrowserAgentRenderedPoint;
	rect(target: BrowserAgentTarget): BrowserAgentRenderedRect;
}

function positive(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) ? value : 0;
}

/**
 * The single mapping for cursor, targets, ripples, and all other viewport feedback.
 * Device pixels are first divided by the remote device scale factor; normalized
 * coordinates are first expanded to remote CSS pixels. Fitting is applied once,
 * so device scale never double-scales a screenshot or a high-DPI native browser.
 * Resize callers recreate this inexpensive transform; mapping never reads the DOM.
 */
export function createBrowserAgentViewportTransform(viewport: BrowserAgentViewport, layout: BrowserAgentViewportLayout): BrowserAgentViewportTransform {
	const width = positive(viewport.width, 1);
	const height = positive(viewport.height, 1);
	const deviceScaleFactor = positive(viewport.deviceScaleFactor, 1);
	const presentationZoom = positive(layout.zoomFactor, 1);
	const zoom = positive(viewport.zoomFactor, 1) * presentationZoom;
	const layoutWidth = Math.max(0, finite(layout.width));
	const layoutHeight = Math.max(0, finite(layout.height));
	const fit = layout.fit ?? 'contain';
	let scaleX: number;
	let scaleY: number;
	if (fit === 'native') {
		scaleX = scaleY = zoom;
	} else if (fit === 'fill') {
		scaleX = layoutWidth / width * presentationZoom;
		scaleY = layoutHeight / height * presentationZoom;
	} else {
		// Browser zoom is already reflected by the CSS viewport's changed size. In
		// fitted representations it cancels out, rather than scaling coordinates twice.
		scaleX = scaleY = Math.min(layoutWidth / width, layoutHeight / height) * presentationZoom;
	}
	const contentRect = {
		x: finite(layout.offsetX) + (fit === 'native' ? 0 : (layoutWidth - width * scaleX) / 2),
		y: finite(layout.offsetY) + (fit === 'native' ? 0 : (layoutHeight - height * scaleY) / 2),
		width: width * scaleX,
		height: height * scaleY,
	};
	const units = (point: BrowserAgentPoint) => point.space === 'normalized'
		? { x: width, y: height }
		: point.space === 'device' ? { x: 1 / deviceScaleFactor, y: 1 / deviceScaleFactor } : { x: 1, y: 1 };
	const point = (value: BrowserAgentPoint): BrowserAgentRenderedPoint => {
		const unit = units(value);
		return { x: contentRect.x + finite(value.x) * unit.x * scaleX, y: contentRect.y + finite(value.y) * unit.y * scaleY };
	};
	return {
		contentRect,
		scaleX,
		scaleY,
		point,
		rect: target => {
			const unit = units(target);
			return { ...point(target), width: Math.max(0, finite(target.width)) * unit.x * scaleX, height: Math.max(0, finite(target.height)) * unit.y * scaleY };
		},
	};
}
