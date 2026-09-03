/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — persistent agentic memory (with a stable format: MEMORY.md + USER.md).
 *  Two scopes: 'project' (<workspace>/.openide/MEMORY.md — project conventions, decisions and
 *  gotchas) and 'user' (global in the profile — stable user preferences). Both are
 *  injected into the system prompt as a snapshot and the model mutates them with the `memory` tool.
 *--------------------------------------------------------------------------------------------*/

import { CODEBASE_NOTES_MAX_CHARS_SETTING } from '../../../../code/common/openideCodebaseNotes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export type MemoryTarget = 'project' | 'user';

export interface IAgentMemorySnapshot {
	readonly project?: string;
	readonly user?: string;
}

/** Per-file cap when injecting into the system prompt (the file on disk may be longer). */
const INJECT_CAP_CHARS = 6000;

/** Store limit per target (char-based, model-independent). When exceeded,
 *  the tool returns a CONSOLIDATE instruction (replace/remove of old entries) instead
 *  of growing without bound — memory is a budget, not a log.
 *
 *  The project limit is a DEFAULT now, not a law: it was sized to inject the whole file into a
 *  prompt, and since the notes live in the graph a query trims for itself. Raising it still costs
 *  prompt budget for OpenIDE's own agent, which is why it is a setting and not simply a bigger
 *  number. The user target keeps its ceiling: it is global preferences, and it is injected whole
 *  in every workspace. */
const STORE_LIMIT_CHARS: Record<MemoryTarget, number> = { project: 3000, user: 1500 };

export class OpenideAgentMemory {

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
		private readonly configurationService?: IConfigurationService,
	) { }

	/** The project ceiling, from settings; the user one is not configurable on purpose. */
	private limitFor(target: MemoryTarget): number {
		if (target !== 'project') {
			return STORE_LIMIT_CHARS.user;
		}
		const configured = Number(this.configurationService?.getValue(CODEBASE_NOTES_MAX_CHARS_SETTING));
		return Number.isFinite(configured) && configured > 0 ? configured : STORE_LIMIT_CHARS.project;
	}

	private uriFor(target: MemoryTarget): URI | undefined {
		if (target === 'user') {
			return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'USER.md');
		}
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'MEMORY.md') : undefined;
	}

	private async read(target: MemoryTarget): Promise<string> {
		const uri = this.uriFor(target);
		if (!uri) {
			return '';
		}
		try {
			return (await this.fileService.readFile(uri)).value.toString();
		} catch {
			return ''; // todavía no existe
		}
	}

	/** Snapshot for injecting into the system prompt (capped; frozen at run start). */
	async load(): Promise<IAgentMemorySnapshot> {
		// The injection cap follows the store limit when that is raised: leaving it at 6000 would
		// let a user set a 20k memory and then silently feed the model the first 6k of it.
		const injectCap = Math.max(INJECT_CAP_CHARS, this.limitFor('project'));
		const cap = (s: string) => s.length > injectCap ? s.slice(0, injectCap) + '\n…(memory truncated — consolidate or clear old entries)' : s;
		const [project, user] = await Promise.all([this.read('project'), this.read('user')]);
		return {
			project: project.trim() ? cap(project.trim()) : undefined,
			user: user.trim() ? cap(user.trim()) : undefined,
		};
	}

	/** Mutates a memory file. Returns the result message for the model. */
	async mutate(target: MemoryTarget, action: 'add' | 'replace' | 'remove', text: string, oldText: string): Promise<string> {
		const uri = this.uriFor(target);
		if (!uri) {
			return 'Error: no folder is open (project memory needs a workspace).';
		}
		const current = await this.read(target);
		let updated: string;
		switch (action) {
			case 'add': {
				if (!text.trim()) {
					return 'Error: empty text.';
				}
				if (current.includes(text.trim())) {
					return 'Error: that entry is already in memory (duplicate).';
				}
				const entry = text.trim().startsWith('-') ? text.trim() : `- ${text.trim()}`;
				updated = current.trim() ? `${current.replace(/\s+$/, '')}\n${entry}\n` : `${entry}\n`;
				break;
			}
			case 'replace': {
				if (!oldText || !current.includes(oldText)) {
					return 'Error: old_text was not found in memory.';
				}
				updated = current.replace(oldText, text);
				break;
			}
			case 'remove': {
				if (!oldText || !current.includes(oldText)) {
					return 'Error: old_text was not found in memory.';
				}
				updated = current.replace(oldText, '').replace(/\n{3,}/g, '\n\n');
				break;
			}
			default:
				return `Error: action desconocida "${action}".`;
		}
		const limit = this.limitFor(target);
		if (action === 'add' && updated.length > limit) {
			return `Error: memory "${target}" would exceed its limit (${updated.length}/${limit} chars). Consolidate first: use replace/remove to merge or drop older, less valuable entries, and only then add the new one.`;
		}
		await this.fileService.writeFile(uri, VSBuffer.fromString(updated));
		return `OK: ${target === 'project' ? 'project' : 'user'} memory updated (${action}).`;
	}
}
