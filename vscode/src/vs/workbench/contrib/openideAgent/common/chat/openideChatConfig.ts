/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the chat's own configuration keys (`openide.chat.*`) and their pure resolvers.
 *
 *  The keys are declared in `openideAgent.contribution.ts` and consumed by the native chat's
 *  widget, renderer, parts and composer. The resolvers live here — in `common`, DOM-free — so the
 *  clamping/normalization each consumer applies is a single testable contract instead of eight
 *  ad-hoc `getValue() ?? default` sites drifting apart (the settings contract test fails on that).
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_CHAT_FONT_SIZE_KEY = 'openide.chat.fontSize';
export const OPENIDE_CHAT_DENSITY_KEY = 'openide.chat.density';
export const OPENIDE_CHAT_THINKING_OPEN_KEY = 'openide.chat.thinking.defaultOpen';
export const OPENIDE_CHAT_TOOLS_EXPANDED_KEY = 'openide.chat.tools.defaultExpanded';
export const OPENIDE_CHAT_WORKING_INDICATOR_KEY = 'openide.chat.workingIndicator';
export const OPENIDE_CHAT_CLAMP_LINES_KEY = 'openide.chat.userMessage.clampLines';
export const OPENIDE_CHAT_AUTO_SCROLL_KEY = 'openide.chat.autoScroll';
export const OPENIDE_CHAT_QUEUE_ENABLED_KEY = 'openide.chat.queue.enabled';

export type OpenideChatDensity = 'comfortable' | 'compact';
export type OpenideChatAutoScroll = 'always' | 'whenAtBottom';

/** Schema bounds for the transcript font. Mirrors the declaration; the resolver enforces them. */
export const OPENIDE_CHAT_FONT_SIZE_DEFAULT = 13;
const FONT_SIZE_MIN = 11;
const FONT_SIZE_MAX = 18;

export const OPENIDE_CHAT_CLAMP_LINES_DEFAULT = 3;
const CLAMP_LINES_MAX = 12;

/** Base font size of the transcript, clamped to the schema's range. */
export function resolveChatFontSize(value: unknown): number {
	const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : OPENIDE_CHAT_FONT_SIZE_DEFAULT;
	return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
}

export function resolveChatDensity(value: unknown): OpenideChatDensity {
	return value === 'compact' ? 'compact' : 'comfortable';
}

/**
 * Lines the user bubble shows before clamping. `0` disables the clamp entirely — the webview never
 * offered that, and long pasted prompts were unreadable behind a 3-line window.
 */
export function resolveChatClampLines(value: unknown): number {
	const lines = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : OPENIDE_CHAT_CLAMP_LINES_DEFAULT;
	return Math.min(CLAMP_LINES_MAX, Math.max(0, lines));
}

export function resolveChatAutoScroll(value: unknown): OpenideChatAutoScroll {
	return value === 'always' ? 'always' : 'whenAtBottom';
}
