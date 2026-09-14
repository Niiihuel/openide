/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import { $ } from '../../../../base/browser/dom.js';
import { FileAccess } from '../../../../base/common/network.js';
import { classifySubagentTask } from '../common/openideSubagentRouting.js';
import { ISubagentRun } from '../common/openideSubagentTypes.js';

type AvatarTask = Pick<ISubagentRun, 'task'> & Partial<Pick<ISubagentRun, 'profile' | 'routingDecision' | 'readonly'>>;

export function subagentAvatarKind(run: AvatarTask): string {
	const profile = classifySubagentTask({ explicitProfile: run.profile ?? run.routingDecision?.profile, readonly: run.readonly, task: run.task }).profile;
	return profile === 'debug' || profile === 'simple-fix' ? 'debugging' : profile;
}

export function createSubagentAvatar(run: AvatarTask): HTMLImageElement {
	const icon = $<HTMLImageElement>('img.openide-subagent-avatar');
	icon.src = FileAccess.asBrowserUri(`vs/workbench/contrib/openideAgent/browser/chat/media/subagents/${subagentAvatarKind(run)}.png`).toString(true);
	icon.alt = ''; icon.width = 24; icon.height = 24; icon.draggable = false; icon.decoding = 'async';
	return icon;
}
