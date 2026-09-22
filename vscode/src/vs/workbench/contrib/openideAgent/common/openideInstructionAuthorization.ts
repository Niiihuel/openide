/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MemoryCaptureMode } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { IAskQuestion, IChatMessage } from './openideAgentTypes.js';
import { parseOpenideChatAskAnswers } from './chat/openideChatReducerTools.js';

type Scope = 'project' | 'global';
type Permission = 'ruleSave' | 'ruleDelete' | 'memorySave' | 'memoryDelete';

function humanText(text: string): string {
	return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
		.replace(/^\s*>.*$/gm, '').replace(/"[^"]*"|\u201c[^\u201d]*\u201d|\u00ab[^\u00bb]*\u00bb/g, '')
		.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function ruleScope(toolName: string, args: Readonly<Record<string, unknown>>): Scope | undefined {
	if (toolName === 'rule_manage') { return args['scope'] === 'global' ? 'global' : 'project'; }
	const value = toolName === 'run_command' ? args['command'] : toolName === 'write_file' || toolName === 'edit_file' ? args['path'] : undefined;
	if (typeof value !== 'string') { return undefined; }
	if (/openideAgent[\\/]rules(?:[\\/]|\b)/i.test(value)) { return 'global'; }
	return /\.openide[\\/]rules(?:[\\/]|\b)/i.test(value) ? 'project' : undefined;
}

export function isProtectedRuleMutation(toolName: string, args: Readonly<Record<string, unknown>>): boolean {
	return ruleScope(toolName, args) !== undefined;
}

/** Per-turn intent from human input only. Model messages, retrieved context and tool output cannot grant it. */
export class OpenideInstructionAuthorization {
	private readonly permissions = new Map<Permission, Set<Scope>>();

	constructor(messages: readonly IChatMessage[]) {
		const message = [...messages].reverse().find(message => message.role === 'user' && !message.hidden && !message.compaction);
		if (message) { this.acceptText(message.displayText ?? message.content); }
	}

	/** Called only for the answer delivered by the pending UI request, never by parsing a tool result. */
	acceptUserAnswer(text: string, questions: readonly IAskQuestion[]): void {
		const answers = parseOpenideChatAskAnswers(questions.length, text);
		for (let index = 0; index < questions.length; index++) {
			const answer = answers[index] ?? '';
			const normalized = humanText(answer).trim();
			if (/^(?:si|yes|ok|okay|confirmo|confirm|adelante|proceed)[.!\s]*$/.test(normalized)) {
				// A bare affirmation only authorizes the concrete action asked in this UI question.
				this.acceptText(questions[index].question);
			} else if (/^(?:no|cancel|cancelar|rechazar)[.!\s]*$/.test(normalized)) {
				this.acceptText(questions[index].question, true);
			} else {
				this.acceptText(answer);
			}
		}
	}

	private acceptText(input: string, revoke = false): void {
		const text = humanText(input);
		const global = /\b(?:global\w*|perfil|profile|todos los proyectos|all projects)\b/.test(text);
		const project = /\b(?:proyecto|project|repositorio|repository|repo|workspace)\b/.test(text) && !global;
		const scope: Scope = global ? 'global' : 'project';
		const rules = /\b(?:reglas?|rules?)\b|\.openide[\\/]rules/.test(text);
		const memory = /\b(?:memoria|memory|remember\w*|recuerd\w*|recorda\w*|forget\w*|olvid\w*)\b/.test(text);
		const remember = /\b(?:remember|recuerda\w*|recuerdes|recorda\w*)\b/.test(text);
		const save = /\b(?:modific\w*|edit\w*|actualiz\w*|cambi\w*|crea\w*|agreg\w*|anad\w*|integra\w*|incorpora\w*|configur\w*|defin\w*|establec\w*|guard\w*|reescrib\w*|write|update|change|add|save|integrat\w*|set\s+up)\b/.test(text);
		const remove = /\b(?:elimin\w*|borr\w*|quit\w*|olvid\w*|delet\w*|remov\w*|forget\w*)\b/.test(text);
		const negated = revoke || /\b(?:no|nunca|not|never|don't|do not)\s+(?:(?:quiero|quieras|want|to|que|you|lo|las|los|la|a|debes?)\s+){0,4}(?:modific|edit|actualiz|cambi|crea|agreg|anad|integra|incorpora|configur|defin|establec|guard|reescrib|write|update|change|add|save|integrat|elimin|borr|quit|olvid|delet|remov|forget|remember|record|recuerd)\w*/.test(text);
		const preference = /\b(?:prefier\w*|prefer\w*|siempre|always|nunca|never|from now on|a partir de ahora|en adelante)\b/.test(text)
			|| /\b(?:usa\w*|utiliz\w*|use|quiero|want)\b[\s\S]*\b(?:todos|todas|all|cada|every)\b/.test(text);
		const set = (permission: Permission, target: Scope) => {
			let scopes = this.permissions.get(permission);
			if (!scopes) { scopes = new Set(); this.permissions.set(permission, scopes); }
			if (negated) { scopes.delete(target); } else { scopes.add(target); }
		};
		if (rules && save) { set('ruleSave', scope); }
		if (rules && remove) { set('ruleDelete', scope); }
		if (!remove && (memory && (save || remember) || preference && !rules)) {
			set('memorySave', project ? 'project' : 'global');
			if (!global && !project) { set('memorySave', 'project'); }
		}
		if (memory && remove) { set('memoryDelete', scope); }
	}

	denial(name: string, args: Readonly<Record<string, unknown>>, captureMode: MemoryCaptureMode): string | undefined {
		const scope = ruleScope(name, args);
		if (scope) {
			const deleting = args['action'] === 'delete' || name === 'run_command' && /\b(?:rm|del|remove-item)\b/i.test(String(args['command']));
			if (!this.permissions.get(deleting ? 'ruleDelete' : 'ruleSave')?.has(scope)) {
				return `Error: modifying ${scope} rules requires an explicit user request or confirmation for this operation.`;
			}
		}
		const writesMemory = name === 'memory' || name === 'memory_save' || name === 'memory_session_summary' || name === 'memory_forget';
		if (!writesMemory) { return undefined; }
		if (captureMode === 'off') { return 'Error: memory capture is disabled.'; }
		const target: Scope = name === 'memory' && args['target'] === 'user' ? 'global' : 'project';
		if (name === 'memory_forget' || name === 'memory' && args['action'] === 'remove') {
			if (!this.permissions.get('memoryDelete')?.has(target)) { return `Error: forgetting ${target} memory requires an explicit user request or confirmation for this operation.`; }
		} else if ((target === 'global' || captureMode === 'manual') && !this.permissions.get('memorySave')?.has(target)) {
			return `Error: saving ${target} memory requires an explicit user preference, remember request or confirmation for this operation.`;
		}
		return undefined;
	}
}
