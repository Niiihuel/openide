/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — persistent agent rules. Each rule is an always-active Markdown file:
 *
 *    proyecto  <workspace>/.openide/rules/<name>.md
 *    global    <userData>/openideAgent/rules/<name>.md
 *
 *  Unlike Skills there is no matching and no on-demand loading: the full snapshot enters the
 *  system prompt at the start of every turn. A project rule with the same name replaces the
 *  global one. The authorization for the agent to edit them is enforced in openideAgentService,
 *  where the user request that triggered the tool call is still available.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { basename,dirname,joinPath,relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { AgentInstructionFileType,IPromptsService } from '../../chat/common/promptSyntax/service/promptsService.js';

export type RuleScope = 'project' | 'global';

export interface IOpenideAgentRule {
	readonly name: string;
	readonly scope: RuleScope;
	readonly description: string;
	readonly uri: URI;
}

const RULE_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;
const RULE_FILE_CAP = 12_000;
const RULE_TOTAL_CAP = 32 * 1024;

interface IAgentInstructionSource {
	readonly uri: URI;
	readonly label: string;
	readonly scope: RuleScope;
}

export class OpenideAgentRules {

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
		private readonly promptsService?: IPromptsService,
		private readonly workspaceTrust?: IWorkspaceTrustManagementService,
		private readonly userHome?: URI,
	) { }

	root(scope: RuleScope): URI | undefined {
		if (scope === 'global') {
			return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'rules');
		}
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'rules') : undefined;
	}

	fileUri(scope: RuleScope, name: string): URI | undefined {
		const root = this.root(scope);
		return root && RULE_NAME_RE.test(name) ? joinPath(root, `${name}.md`) : undefined;
	}

	private description(content: string): string {
		for (const raw of content.split(/\r?\n/)) {
			const line = raw.trim().replace(/^#+\s*/, '').replace(/^[-*]\s*/, '');
			if (line) {
				return line.slice(0, 240);
			}
		}
		return '(empty rule)';
	}

	private async scanScope(scope: RuleScope): Promise<IOpenideAgentRule[]> {
		const root = this.root(scope);
		if (!root) {
			return [];
		}
		try {
			const resolved = await this.fileService.resolve(root);
			const out: IOpenideAgentRule[] = [];
			for (const child of resolved.children ?? []) {
				if (child.isDirectory || !child.name.toLowerCase().endsWith('.md')) {
					continue;
				}
				const name = child.name.slice(0, -3);
				if (!RULE_NAME_RE.test(name)) {
					continue;
				}
				let content = '';
				try { content = (await this.fileService.readFile(child.resource)).value.toString(); } catch { /* skip unreadable body */ }
				out.push({ name, scope, description: this.description(content), uri: child.resource });
			}
			return out.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			return [];
		}
	}

	async listAll(): Promise<IOpenideAgentRule[]> {
		const [globalRules, projectRules] = await Promise.all([this.scanScope('global'), this.scanScope('project')]);
		return [...globalRules, ...projectRules].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
	}

	/** Project replaces Global when both define the same name. */
	async list(): Promise<IOpenideAgentRule[]> {
		const all = await this.listAll();
		const globalRules = all.filter(rule => rule.scope === 'global');
		const projectRules = all.filter(rule => rule.scope === 'project');
		const byName = new Map(globalRules.map(rule => [rule.name, rule]));
		for (const rule of projectRules) {
			byName.set(rule.name, rule);
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	async save(scope: RuleScope, name: string, content: string): Promise<string> {
		if (!RULE_NAME_RE.test(name)) {
			return `Error: invalid rule name "${name}" (use kebab-case).`;
		}
		if (!content.trim()) {
			return 'Error: the rule cannot be empty.';
		}
		const uri = this.fileUri(scope, name);
		if (!uri) {
			return 'Error: no folder is open to save a project rule into.';
		}
		await this.fileService.writeFile(uri, VSBuffer.fromString(content.trimEnd() + '\n'));
		return `OK: regla ${scope} "${name}" guardada.`;
	}

	async delete(scope: RuleScope, name: string): Promise<boolean> {
		const uri = this.fileUri(scope, name);
		if (!uri || !(await this.fileService.exists(uri))) {
			return false;
		}
		await this.fileService.del(uri);
		return true;
	}

	private async firstNonEmpty(root: URI, names: readonly string[]): Promise<URI | undefined> {
		for (const name of names) {
			const candidate = joinPath(root, name);
			try {
				if ((await this.fileService.readFile(candidate)).value.toString().trim()) {
					return candidate;
				}
			} catch { /* continue to the lower-precedence file */ }
		}
		return undefined;
	}

	/**
	 * Resolve the standard instruction files without ever modifying them. Codex's global
	 * AGENTS.override.md/AGENTS.md convention is added to the workbench-wide discovery service.
	 * Trust is enforced here before asking that service for workspace and parent-repository files.
	 */
	private async agentInstructionSources(): Promise<IAgentInstructionSource[]> {
		const result: IAgentInstructionSource[] = [];
		const seen = new Set<string>();
		const add = (uri: URI, label: string, scope: RuleScope) => {
			const key = uri.toString();
			if (!seen.has(key)) {
				seen.add(key);
				result.push({ uri, label, scope });
			}
		};

		if (this.userHome) {
			const global = await this.firstNonEmpty(joinPath(this.userHome, '.codex'), ['AGENTS.override.md', 'AGENTS.md']);
			if (global) {
				add(global, `~/.codex/${basename(global)}`, 'global');
			}
		}

		if (this.workspaceTrust && !this.workspaceTrust.isWorkspaceTrusted()) {
			return result;
		}

		let discovered: URI[] = [];
		if (this.promptsService) {
			try {
				discovered = (await this.promptsService.listAgentInstructions(CancellationToken.None))
					.filter(file => file.type === AgentInstructionFileType.agentsMd)
					.map(file => file.uri);
			} catch {
				// Fall through to workspace-root discovery below.
			}
		}

		if (!discovered.length) {
			for (const folder of this.contextService.getWorkspace().folders) {
				const instruction = await this.firstNonEmpty(folder.uri, ['AGENTS.override.md', 'AGENTS.md']);
				if (instruction) {
					discovered.push(instruction);
				}
			}
		}

		for (const uri of discovered.sort((a, b) => a.toString().localeCompare(b.toString()))) {
			const root = dirname(uri);
			const selected = await this.firstNonEmpty(root, ['AGENTS.override.md', basename(uri)]);
			if (!selected) {
				continue;
			}
			const folder = this.contextService.getWorkspaceFolder(selected);
			const relative = folder ? relativePath(folder.uri, selected) : undefined;
			add(selected, folder ? `${folder.name}/${relative ?? basename(selected)}` : selected.path, 'project');
		}
		return result;
	}

	async buildPromptBlock(): Promise<string> {
		const [allRules, instructions] = await Promise.all([this.list(), this.agentInstructionSources()]);
		const rules = this.workspaceTrust && !this.workspaceTrust.isWorkspaceTrusted()
			? allRules.filter(rule => rule.scope === 'global')
			: allRules;
		if (!rules.length && !instructions.length) {
			return '';
		}
		let used = 0;
		let exhausted = false;
		const ruleBlocks: string[] = [];
		const instructionBlocks: string[] = [];
		const readBody = async (uri: URI, truncatedLabel: string): Promise<string | undefined> => {
			let body = '';
			try { body = (await this.fileService.readFile(uri)).value.toString().trim(); } catch { return undefined; }
			if (!body) {
				return undefined;
			}
			if (body.length > RULE_FILE_CAP) {
				body = body.slice(0, RULE_FILE_CAP) + `\n…(${truncatedLabel} truncated)`;
			}
			const bodyBytes = VSBuffer.fromString(body).byteLength;
			if (used + bodyBytes > RULE_TOTAL_CAP) {
				exhausted = true;
				return undefined;
			}
			used += bodyBytes;
			return body;
		};
		// Reserve the bounded budget for the interoperable AGENTS.md contract first;
		// legacy OpenIDE rules are still rendered before it so project guidance stays last.
		for (const instruction of instructions) {
			const body = await readBody(instruction.uri, 'AGENTS.md');
			if (exhausted) {
				break;
			}
			if (body) {
				instructionBlocks.push(`### ${instruction.label} [${instruction.scope}]\n${body}`);
			}
		}
		if (!exhausted) {
			for (const rule of rules) {
				const body = await readBody(rule.uri, 'rule');
				if (exhausted) {
					break;
				}
				if (body) {
					ruleBlocks.push(`### ${rule.name} [${rule.scope}]\n${body}`);
				}
			}
		}
		const sections: string[] = [];
		if (ruleBlocks.length) {
			sections.push('MANDATORY OPENIDE RULES (follow ALL of them. You may only change them if the user asked for it explicitly in this turn):\n' + ruleBlocks.join('\n\n'));
		}
		if (instructionBlocks.length) {
			sections.push('AGENTS.MD INSTRUCTIONS (global first, project entries later; the current user request prevails. Do not edit these files unless explicitly asked):\n' + instructionBlocks.join('\n\n'));
		}
		if (exhausted) {
			sections.push('…(Instruction budget exhausted; consolidate redundant rules and AGENTS.md files)');
		}
		return sections.length ? '\n\n' + sections.join('\n\n') : '';
	}
}
