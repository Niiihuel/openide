/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import { $, append } from '../../../../base/browser/dom.js';
import { FileAccess } from '../../../../base/common/network.js';
import { classifySubagentTask } from '../common/openideSubagentRouting.js';
import { ISubagentRun } from '../common/openideSubagentTypes.js';

type AvatarTask = Pick<ISubagentRun, 'task'> & Partial<Pick<ISubagentRun, 'profile' | 'routingDecision' | 'readonly'>>;

export function subagentAvatarKind(run: AvatarTask): string {
	const profile = classifySubagentTask({ explicitProfile: run.profile ?? run.routingDecision?.profile, readonly: run.readonly, task: run.task }).profile;
	return profile === 'debug' || profile === 'simple-fix' ? 'debugging' : profile;
}

const fallbackGlyph: Record<string, string> = {
	debugging: 'debug-alt',
	general: 'sparkle',
	implementation: 'tools',
	planning: 'checklist',
	research: 'search',
	review: 'inspect',
};

/**
 * The packaged illustration is decorative. The native codicon beneath it is deliberately kept in
 * the DOM: a missing or late asset must never turn into Chromium's broken-image placeholder.
 */
export function createSubagentAvatar(run: AvatarTask): HTMLElement {
	const kind = subagentAvatarKind(run);
	const icon = $(`span.openide-subagent-avatar.openide-subagent-avatar-${kind}`, { 'aria-hidden': 'true' });
	append(icon, $(`span.codicon.codicon-${fallbackGlyph[kind] ?? 'sparkle'}.openide-subagent-avatar-fallback`));
	const image = append(icon, $<HTMLImageElement>('img.openide-subagent-avatar-image'));
	image.alt = ''; image.width = 24; image.height = 24; image.draggable = false; image.decoding = 'async';
	image.addEventListener('load', () => icon.classList.add('openide-subagent-avatar-loaded'), { once: true });
	image.addEventListener('error', () => image.remove(), { once: true });
	image.src = FileAccess.asBrowserUri(`vs/workbench/contrib/openideAgent/browser/chat/media/subagents/${kind}.png`).toString(true);
	return icon;
}
