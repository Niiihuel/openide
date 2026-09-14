/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatSubagentContent } from '../../common/chat/openideChatContent.js';
import { subagentTaskTitle } from '../../common/openideSubagentTitle.js';
import { t } from '../../common/openideStrings.js';
import { createSubagentAvatar, subagentAvatarKind } from '../openideSubagentAvatar.js';
import { OpenideChatSubagentPart } from './parts/openideChatSubagentPart.js';
import './media/openideSubagents.css';

/** A presentation of adjacent workers. The original parts still own their actions and history. */
export class OpenideChatSubagentGroup extends Disposable {
	readonly node = $<HTMLDetailsElement>('details.openide-chat-work-group.openide-chat-subagent-group');
	private readonly heading = append(this.node, $('summary.openide-chat-work-group-summary'));
	private readonly avatars = append(this.heading, $('span.openide-subagents-summary-icons', { 'aria-hidden': 'true' }));
	private readonly label = append(this.heading, $('span.openide-chat-subagent-group-label'));
	readonly body: HTMLElement;
	private parts: readonly OpenideChatSubagentPart[] = [];
	private readonly icons = new Map<string, { kind: string; node: HTMLImageElement }>();

	constructor() {
		super();
		append(this.heading, $('span.codicon.codicon-chevron-right.openide-chat-work-group-chevron', { 'aria-hidden': 'true' }));
		this.body = append(this.node, $('.openide-chat-work-group-body'));
		this._register(addDisposableListener(this.node, 'toggle', () => this.updateVisibility()));
	}

	update(members: readonly IOpenideChatSubagentContent[], parts: readonly OpenideChatSubagentPart[]): void {
		this.parts = parts;
		this.updateVisibility();
		const titles = members.slice(0, 2).map(member => subagentTaskTitle(member.run?.task ?? member.title, member.title));
		const names = members.length > 2 ? t('chat.subagents.more', titles.join(', '), members.length - 2)
			: titles.length === 2 ? t('chat.subagents.and', titles[0], titles[1]) : titles[0];
		const counts = { running: 0, completed: 0, failed: 0, cancelled: 0 };
		for (const member of members) { counts[member.status]++; }
		const status = [
			counts.running ? t('agentWindow.runningCount', counts.running) : '',
			counts.completed ? t('agentWindow.doneCount', counts.completed) : '',
			counts.failed ? t('chat.subagents.failed', counts.failed) : '',
			counts.cancelled ? t('chat.subagents.cancelled', counts.cancelled) : '',
		].filter(Boolean).join(' · ');
		const text = counts.running === members.length ? t(members.length === 1 ? 'chat.subagents.startedOne' : 'chat.subagents.started', names)
			: counts.completed === members.length ? t(members.length === 1 ? 'chat.subagents.doneOne' : 'chat.subagents.done', names)
				: t('chat.subagents.status', names, status);
		if (this.label.textContent !== text) { this.label.textContent = text; }
		const accessible = t('chat.subagents.status', names, status);
		if (this.heading.getAttribute('aria-label') !== accessible) { this.heading.setAttribute('aria-label', accessible); }

		// Neither timeline deltas nor a second worker arriving recreate already decoded images.
		const visible = members.slice(0, 4);
		const used = new Set(visible.map(member => member.runId));
		for (const [id, icon] of this.icons) {
			if (!used.has(id)) { icon.node.remove(); this.icons.delete(id); }
		}
		for (const [index, member] of visible.entries()) {
			const task = member.run ?? { task: member.title };
			const kind = subagentAvatarKind(task);
			let icon = this.icons.get(member.runId);
			if (!icon || icon.kind !== kind) {
				const node = createSubagentAvatar(task);
				if (icon) { icon.node.replaceWith(node); }
				icon = { kind, node }; this.icons.set(member.runId, icon);
			}
			const anchor = this.avatars.children[index] ?? null;
			if (anchor !== icon.node) { this.avatars.insertBefore(icon.node, anchor); }
		}
	}

	private updateVisibility(): void {
		for (const part of this.parts) { part.setActivityVisible(this.node.open); }
	}

	override dispose(): void { this.node.remove(); this.icons.clear(); this.parts = []; super.dispose(); }
}
