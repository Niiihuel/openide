/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from './../../common/openideStrings.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatContent, IOpenideChatSubagentContent } from '../../common/chat/openideChatContent.js';
import { webPreviewFromTool } from '../../common/chat/openideChatWebPreview.js';
import { IOpenideChatContentPart } from './openideChatContentPart.js';
import { OpenideChatSubagentGroup } from './openideChatSubagentGroup.js';
import { OpenideChatSubagentPart } from './parts/openideChatSubagentPart.js';
import './media/openideChatActivityGroups.css';

type ActivityKind = 'commands' | 'files' | 'browser' | 'tools';

/** Only settled, successful work can be folded. Failures and interactive work stay visible. */
function activityKind(content: IOpenideChatContent): ActivityKind | undefined {
	switch (content.kind) {
		case 'terminal': return content.state === 'exited' && (content.exitCode === undefined || content.exitCode === 0) ? 'commands' : undefined;
		case 'explore': return content.isComplete && content.entries.every(entry => entry.state === 'success') ? 'files' : undefined;
		case 'tool': return content.state === 'success' && !webPreviewFromTool(content) ? (content.name.startsWith('browser_') ? 'browser' : 'tools') : undefined;
		default: return undefined;
	}
}

function summary(kinds: ReadonlySet<ActivityKind>): { label: string; icon: string } {
	const work = new Set(kinds);
	if (work.size === 2 && work.has('files') && work.has('commands')) { return { label: t('openide.activity.readRan'), icon: 'search' }; }
	if (work.size > 1) { return { label: t('openide.activity.completed'), icon: 'checklist' }; }
	switch ([...work][0]) {
		case 'commands': return { label: t('openide.activity.ran'), icon: 'terminal' };
		case 'files': return { label: t('openide.activity.read'), icon: 'search' };
		case 'browser': return { label: t('openide.activity.browser'), icon: 'globe' };
		default: return { label: t('openide.activity.tools'), icon: 'tools' };
	}
}

interface IActivityGroup {
	readonly node: HTMLDetailsElement;
	readonly body: HTMLElement;
	readonly label: HTMLElement;
	readonly icon: HTMLElement;
}

/** Presentation only: retains the actual content parts, their selection and disclosure state. */
export class OpenideChatActivityGroups extends Disposable {
	private readonly groups = new Map<number, IActivityGroup>();
	private readonly subagents = new Map<number, OpenideChatSubagentGroup>();

	constructor(private readonly host: HTMLElement) { super(); }

	render(content: readonly IOpenideChatContent[], parts: readonly IOpenideChatContentPart[], expanded: boolean, complete: boolean): void {
		const kindAt = (index: number) => !complete && index === content.length - 1 ? undefined : activityKind(content[index]);
		const used = new Set<number>();
		const usedSubagents = new Set<number>();
		let anchor: ChildNode | null = this.host.firstChild;
		const place = (node: HTMLElement) => {
			if (node !== anchor) { this.host.insertBefore(node, anchor); }
			anchor = node.nextSibling;
		};
		for (let i = 0; i < content.length;) {
			const entry = content[i];
			const following = content[i + 1];
			const envelope = entry.kind === 'delegation' && following?.kind === 'subagent' && following.parentId === entry.delegationId ? entry : undefined;
			const first = envelope ? following : entry;
			if (first.kind === 'subagent') {
				const start = i;
				if (envelope) { i++; }
				const members: IOpenideChatSubagentContent[] = [];
				const children: OpenideChatSubagentPart[] = [];
				while (i < content.length) {
					const member = content[i];
					if (member.kind !== 'subagent' || member.parentId !== first.parentId) { break; }
					members.push(member);
					const part = parts[i++];
					if (part instanceof OpenideChatSubagentPart) { children.push(part); }
				}
				let group = this.subagents.get(start);
				if (!group) { group = new OpenideChatSubagentGroup(); this.subagents.set(start, group); }
				usedSubagents.add(start);
				group.update(members, children);
				place(group.node);
				let child = group.body.firstChild;
				for (let j = start; j < i; j++) {
					const node = parts[j]?.domNode;
					if (!node) { continue; }
					if (child !== node) { group.body.insertBefore(node, child); }
					child = node.nextSibling;
				}
				anchor = group.node.nextSibling;
				continue;
			}
			const kind = kindAt(i);
			if (!kind) {
				const node = parts[i++]?.domNode;
				if (node) { place(node); }
				continue;
			}
			const start = i;
			const kinds = new Set<ActivityKind>();
			while (i < content.length) {
				const next = kindAt(i);
				if (!next) { break; }
				kinds.add(next);
				i++;
			}
			used.add(start);
			let group = this.groups.get(start);
			if (!group) {
				const node = $('details.openide-chat-work-group') as HTMLDetailsElement;
				node.open = expanded;
				const heading = append(node, $('summary.openide-chat-work-group-summary'));
				const icon = append(heading, $('span.codicon', { 'aria-hidden': 'true' }));
				const label = append(heading, $('span'));
				append(heading, $('span.codicon.codicon-chevron-right.openide-chat-work-group-chevron', { 'aria-hidden': 'true' }));
				group = { node, icon, label, body: append(node, $('.openide-chat-work-group-body')) };
				this.groups.set(start, group);
			}
			const text = summary(kinds);
			if (group.label.textContent !== text.label) { group.label.textContent = text.label; }
			group.icon.className = `codicon codicon-${text.icon}`;
			place(group.node);
			let child = group.body.firstChild;
			for (let j = start; j < i; j++) {
				const node = parts[j]?.domNode;
				if (!node) { continue; }
				if (child !== node) { group.body.insertBefore(node, child); }
				child = node.nextSibling;
			}
			anchor = group.node.nextSibling;
		}
		for (const [index, group] of this.subagents) {
			if (!usedSubagents.has(index)) { group.dispose(); this.subagents.delete(index); }
		}
		for (const [index, group] of this.groups) {
			if (!used.has(index)) { group.node.remove(); this.groups.delete(index); }
		}
	}

	clear(): void {
		for (const group of this.subagents.values()) { group.dispose(); }
		this.subagents.clear();
		for (const group of this.groups.values()) { group.node.remove(); }
		this.groups.clear();
	}

	override dispose(): void { this.clear(); super.dispose(); }
}
