/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { t } from '../openideStrings.js';
import { OpenideChatToolState } from './openideChatContent.js';
import { basenameForChat, getOpenideToolMeta, toolDetailFor } from './openideChatToolMeta.js';

type AuthoringKind = 'skill' | 'rule' | 'memory' | 'subagent' | 'mcp' | 'hook' | 'mcpTool';
type AuthoringOperation = 'load' | 'save' | 'update' | 'delete' | 'run';

export interface IOpenideChatToolPresentation {
	readonly verb: string;
	readonly detail: string;
	readonly icon: string;
	readonly authoring?: AuthoringKind;
}

const authoringIcons: Record<AuthoringKind, string> = {
	skill: 'book', rule: 'law', memory: 'database', subagent: 'organization',
	mcp: 'plug', hook: 'debug-disconnect', mcpTool: 'plug',
};

/** Only completed identifying fields are read from streamed arguments, never the authored body. */
function argument(argumentsJson: string | undefined, key: string): string {
	return toolDetailFor({ icon: '', verb: '', done: '', key }, argumentsJson);
}

function authoring(kind: AuthoringKind, operation: AuthoringOperation, state: OpenideChatToolState, detail: string): IOpenideChatToolPresentation {
	return {
		verb: t(`chatSurface.tool.authoring.${operation}.${state}`, t(`chatSurface.tool.authoring.${kind}`)),
		detail,
		icon: authoringIcons[kind],
		authoring: kind,
	};
}

/** Known instruction/configuration paths; ordinary source files retain their normal file labels. */
function authoringFile(path: string): AuthoringKind | undefined {
	const normalized = path.replace(/\\/g, '/').replace(/\s+L\d+(?:-\d+)?$/, '');
	if (/(?:^|\/)skills\/[^/]+\/SKILL\.md$/i.test(normalized)) { return 'skill'; }
	if (/(?:^|\/)(?:\.openide|\.agents|\.cursor|openideAgent)\/rules\/[^/]+\.mdc?$/i.test(normalized)) { return 'rule'; }
	if (/(?:^|\/)(?:\.openide|\.agents|\.cursor|\.claude|openideAgent)\/hooks\.json$/i.test(normalized)) { return 'hook'; }
	if (/(?:^|\/)(?:\.openide|\.vscode|\.cursor|openideAgent)\/mcp\.json$/i.test(normalized) || /(?:^|\/)\.mcp\.json$/i.test(normalized)) { return 'mcp'; }
	return undefined;
}

/** Shared by live status and the settled diff card. The outcome comes from a real diff, not prose. */
export function openideChatAuthoringFileLabel(path: string, state: 'running' | 'created' | 'updated'): string | undefined {
	const kind = authoringFile(path);
	if (!kind) { return undefined; }
	const noun = t(`chatSurface.tool.authoring.${kind}`);
	if (state === 'created') { return t('chatSurface.tool.authoring.created', noun); }
	return t(`chatSurface.tool.authoring.update.${state === 'running' ? 'running' : 'success'}`, noun);
}

/** An operation has a running, successful, failed or cancelled label; failures never claim a write. */
export function openideChatToolPresentation(name: string, argumentsJson: string | undefined, state: OpenideChatToolState): IOpenideChatToolPresentation {
	const target = (key: string) => argument(argumentsJson, key);
	if (name === 'skill_view' || name === 'skill_save') {
		return authoring('skill', name === 'skill_view' ? 'load' : 'save', state, target('name'));
	}
	if (name === 'rule_manage') {
		const scope = target('scope');
		const detail = [target('name'), scope === 'project' || scope === 'global' ? t(`chatSurface.tool.authoring.${scope}`) : ''].filter(Boolean).join(' · ');
		return authoring('rule', target('action') === 'delete' ? 'delete' : 'save', state, detail);
	}
	if (name === 'subagent_save') { return authoring('subagent', 'save', state, target('name')); }
	if (name === 'memory') {
		const scope = target('target');
		return authoring('memory', target('action') === 'remove' ? 'delete' : 'update', state,
			scope === 'project' ? t('chatSurface.tool.authoring.project') : scope === 'user' ? t('chatSurface.tool.authoring.global') : '');
	}
	if (name === 'mcp_call' || name.startsWith('mcp_')) {
		return authoring('mcpTool', 'run', state, name === 'mcp_call' ? target('tool') : name);
	}
	if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'delete_file') {
		const path = target('path');
		const kind = authoringFile(path);
		if (kind) { return authoring(kind, name === 'read_file' ? 'load' : name === 'delete_file' ? 'delete' : name === 'write_file' ? 'save' : 'update', state, basenameForChat(path)); }
	}
	const meta = getOpenideToolMeta(name);
	const verb = state === 'running' ? meta.verb : state === 'success' ? meta.done || meta.verb
		: t(state === 'error' ? 'chatSurface.tool.failedAction' : 'chatSurface.tool.cancelledAction', meta.verb || name);
	return { verb, detail: toolDetailFor(meta, argumentsJson), icon: meta.icon };
}
