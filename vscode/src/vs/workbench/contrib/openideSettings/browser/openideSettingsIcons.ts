/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — category icons for the Settings sidebar and page headers.
 *
 *  Apple's System Settings convention: every category is identified by a white glyph on a small
 *  tinted rounded square. The glyphs come from ONE vendored set (Bootstrap Icons — see
 *  openideBootstrapIcons.ts, the same family the product icon theme uses): a single 16×16 grid and
 *  one drawing discipline, so no chip
 *  reads rounder, wider or lighter than its neighbours — which is exactly what the previous
 *  codicon mix could not guarantee. The tint carries meaning by GROUP; the palette is six hues
 *  normalized in OKLCH to the same perceived lightness and saturation.
 *
 *  The map lives here, next to the shell that consumes it, and NOT in settingsLayout.ts: the TOC
 *  is shared data upstream patches touch, and an icon is presentation.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { appendBootstrapIcon, BootstrapIconName } from './openideBootstrapIcons.js';
import './media/openideSettingsIcons.css';

/** Six editorial tints. Fixed values with theme-blending done in CSS: the chip must stay legible
 *  under any theme, which is exactly why it does not derive from theme accent colors. */
export type OpenideSettingsTint = 'blue' | 'violet' | 'green' | 'orange' | 'teal' | 'gray';

interface IOpenideSettingsIcon {
	readonly icon: BootstrapIconName;
	readonly tint: OpenideSettingsTint;
}

const ICONS: ReadonlyMap<string, IOpenideSettingsIcon> = new Map<string, IOpenideSettingsIcon>([
	// Home / meta
	['home', { icon: 'house', tint: 'gray' }],
	['commonlyUsed', { icon: 'star', tint: 'orange' }],

	// Agent surfaces
	['openideAgent/providers', { icon: 'plug', tint: 'blue' }],
	['openideAgent/chat', { icon: 'chat-square-dots', tint: 'blue' }],
	['openideAgent/voice', { icon: 'mic', tint: 'orange' }],
	['openideAgent/context', { icon: 'database', tint: 'teal' }],
	['openideAgent/skills', { icon: 'stars', tint: 'violet' }],
	['openideAgent/mcp', { icon: 'hdd-rack', tint: 'teal' }],
	['openideAgent/rules', { icon: 'book', tint: 'gray' }],
	['openideAgent/hooks', { icon: 'lightning-charge', tint: 'violet' }],
	['openideAgent/commands', { icon: 'slash-lg', tint: 'gray' }],
	['openideAgent/quickCommands', { icon: 'terminal', tint: 'orange' }],
	['openideAgent/subagents', { icon: 'robot', tint: 'green' }],
	['openideAgent/projectMap', { icon: 'diagram-3', tint: 'green' }],
	['openideAgent/notifications', { icon: 'bell', tint: 'orange' }],
	['openideAgent/browser', { icon: 'globe', tint: 'blue' }],
	['openideAgent/advanced', { icon: 'sliders', tint: 'gray' }],

	// Core workbench areas (upstream TOC ids)
	['editor', { icon: 'pencil', tint: 'blue' }],
	['workbench', { icon: 'layout-sidebar', tint: 'violet' }],
	['workbench/language', { icon: 'translate', tint: 'teal' }],
	['window', { icon: 'window', tint: 'teal' }],
	['features', { icon: 'sliders2', tint: 'green' }],
	['application', { icon: 'display', tint: 'gray' }],
	['security', { icon: 'shield-lock', tint: 'orange' }],
	['extensions', { icon: 'stack', tint: 'violet' }],

	// TOC children — one DISTINCT glyph per entry, chosen by what the page is about. Without
	// these, every child inherited its parent's icon and the sidebar read as rows of repeats.
	// Text Editor
	['editor/cursor', { icon: 'cursor', tint: 'blue' }],
	['editor/find', { icon: 'search', tint: 'blue' }],
	['editor/font', { icon: 'fonts', tint: 'blue' }],
	['editor/format', { icon: 'text-paragraph', tint: 'blue' }],
	['editor/diffEditor', { icon: 'arrow-left-right', tint: 'blue' }],
	['editor/multiDiffEditor', { icon: 'files', tint: 'blue' }],
	['editor/minimap', { icon: 'pip', tint: 'blue' }],
	['editor/suggestions', { icon: 'lightbulb', tint: 'blue' }],
	['editor/files', { icon: 'floppy', tint: 'blue' }],
	// Workbench
	['workbench/appearance', { icon: 'palette', tint: 'violet' }],
	['workbench/breadcrumbs', { icon: 'signpost-split', tint: 'violet' }],
	['workbench/editor', { icon: 'layout-three-columns', tint: 'violet' }],
	['workbench/settings', { icon: 'wrench', tint: 'violet' }],
	['workbench/zenmode', { icon: 'bullseye', tint: 'violet' }],
	['workbench/screencastmode', { icon: 'record-circle', tint: 'violet' }],
	// Window
	['window/newWindow', { icon: 'plus-circle', tint: 'teal' }],
	// Features
	['features/accessibilitySignals', { icon: 'volume-up', tint: 'green' }],
	['features/accessibility', { icon: 'eye', tint: 'green' }],
	['features/explorer', { icon: 'folder2-open', tint: 'green' }],
	['features/search', { icon: 'search', tint: 'green' }],
	['features/debug', { icon: 'bug', tint: 'green' }],
	['features/testing', { icon: 'flask', tint: 'green' }],
	['features/scm', { icon: 'git', tint: 'green' }],
	['features/extensions', { icon: 'box-seam', tint: 'green' }],
	['features/terminal', { icon: 'terminal', tint: 'green' }],
	['features/task', { icon: 'list-check', tint: 'green' }],
	['features/problems', { icon: 'exclamation-circle', tint: 'green' }],
	['features/output', { icon: 'file-earmark-text', tint: 'green' }],
	['features/comments', { icon: 'chat', tint: 'green' }],
	['features/remote', { icon: 'cloud', tint: 'green' }],
	['features/timeline', { icon: 'clock-history', tint: 'green' }],
	['features/notebook', { icon: 'journal-code', tint: 'green' }],
	['features/mergeEditor', { icon: 'git', tint: 'green' }],
	['features/issueReporter', { icon: 'clipboard', tint: 'green' }],
	// Application
	['application/http', { icon: 'plug', tint: 'gray' }],
	['application/keyboard', { icon: 'command', tint: 'gray' }],
	['application/update', { icon: 'cloud-arrow-down', tint: 'gray' }],
	['application/telemetry', { icon: 'bar-chart', tint: 'gray' }],
	['application/settingsSync', { icon: 'arrow-clockwise', tint: 'gray' }],
	['application/network', { icon: 'share', tint: 'gray' }],
	['application/experimental', { icon: 'rocket-takeoff', tint: 'gray' }],
	['application/other', { icon: 'three-dots', tint: 'gray' }],
	// Security
	['security/workspace', { icon: 'shield-check', tint: 'orange' }],
]);

const FALLBACK: IOpenideSettingsIcon = { icon: 'sliders', tint: 'gray' };

/** Extension categories are synthesized per extension id and share one identity. */
function resolve(id: string): IOpenideSettingsIcon {
	const exact = ICONS.get(id);
	if (exact) {
		return exact;
	}
	if (id.startsWith('extension:') || id.startsWith('extensions/')) {
		return { icon: 'stack', tint: 'violet' };
	}
	// A sub-page inherits its parent's identity (openideAgent/providers/openai → providers).
	const slash = id.lastIndexOf('/');
	if (slash > 0) {
		return resolve(id.slice(0, slash));
	}
	return FALLBACK;
}

/**
 * Appends the tinted icon chip for a category. `large` is the page-header variant (28px);
 * the default is the sidebar size (20px). Purely decorative: the accessible name is always the
 * adjacent label, so the chip is hidden from the tree.
 */
export function appendOpenideSettingsIcon(parent: HTMLElement, id: string, large = false): HTMLElement {
	const icon = resolve(id);
	const chip = append(parent, $(`span.openide-settings-navicon.tint-${icon.tint}${large ? '.large' : ''}`, { 'aria-hidden': 'true' }));
	// Flat glyphs read best near the codicon's own 16px; the boxed-chip era used 13px because
	// the glyph sat inside a tinted square that needed breathing room.
	appendBootstrapIcon(chip, icon.icon, large ? 20 : 16);
	return chip;
}
