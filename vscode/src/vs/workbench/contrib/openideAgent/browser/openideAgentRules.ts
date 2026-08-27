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
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export type RuleScope = 'project' | 'global';

export interface IOpenideAgentRule {
	readonly name: string;
	readonly scope: RuleScope;
	readonly description: string;
	readonly uri: URI;
}

const RULE_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;
const RULE_FILE_CAP = 12_000;
const RULE_TOTAL_CAP = 32_000;

export class OpenideAgentRules {

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
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
		return '(regla vacía)';
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
			return `Error: nombre de regla inválido "${name}" (usá kebab-case).`;
		}
		if (!content.trim()) {
			return 'Error: la regla no puede estar vacía.';
		}
		const uri = this.fileUri(scope, name);
		if (!uri) {
			return 'Error: no hay carpeta abierta para guardar una regla de proyecto.';
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

	async buildPromptBlock(): Promise<string> {
		const rules = await this.list();
		if (!rules.length) {
			return '';
		}
		let used = 0;
		const blocks: string[] = [];
		for (const rule of rules) {
			let body = '';
			try { body = (await this.fileService.readFile(rule.uri)).value.toString().trim(); } catch { continue; }
			if (!body) {
				continue;
			}
			if (body.length > RULE_FILE_CAP) {
				body = body.slice(0, RULE_FILE_CAP) + '\n…(regla truncada)';
			}
			if (used + body.length > RULE_TOTAL_CAP) {
				blocks.push('…(presupuesto de Rules agotado; consolidá reglas redundantes)');
				break;
			}
			used += body.length;
			blocks.push(`### ${rule.name} [${rule.scope}]\n${body}`);
		}
		return blocks.length
			? '\n\nRULES OBLIGATORIAS DE OPENIDE (seguí TODAS. Solo podés modificarlas si el usuario lo pidió explícitamente en este turno):\n' + blocks.join('\n\n')
			: '';
	}
}
