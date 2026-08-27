/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — /comandos del composer (prompts markdown reutilizables, estilo Claude Code).
 *  Each command is a `commands/<slug>.md` with minimal YAML frontmatter (description +
 *  argument-hint) and a body that travels to the model EXPANDED: $ARGUMENTS = everything typed
 *  after the slug; $1..$9 = individual arguments (split respecting quotes, shlexSplit); with no
 *  placeholders and with args ⇒ they are appended as "Additional instruction" (no-placeholder fallback).
 *  Dos scopes con precedencia proyecto > global: `.openide/commands/` pisa por slug a
 *  `userRoamingDataHome/openideAgent/commands/` (same layout as skills/mcp). The history
 *  stores {displayText, modelText}: the UI/titles show what was typed, the model sees the
 *  expansion — memory is never poisoned with expanded bodies.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { shlexSplit } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';

export interface ISlashCommand {
	readonly slug: string;
	readonly description: string;
	readonly argumentHint: string;
	readonly filePath: URI;
	readonly scope: 'project' | 'global';
}

/** Valid slug = the same kebab-case NAME_RE as skills (file name without `.md`). */
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;
/** Composer invocation: `/slug` alone, or `/slug free args` (args may be multi-line). */
const INVOKE_RE = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/;
/** Only the head of each .md is read to build the menu index (skills style). */
const INDEX_HEAD_CHARS = 4000;
/** Cap on the description in the suggestions menu. */
const INDEX_DESC_CAP = 200;
/** Ceiling of listed commands (menu budget; beyond that the user types the slug anyway). */
const MAX_COMMANDS = 100;

/** Edit distance with early exit (for the "did you mean /y?"). */
function editDistance(a: string, b: string, cap: number): number {
	if (Math.abs(a.length - b.length) > cap) {
		return cap + 1;
	}
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
}

export class OpenideAgentCommands extends Disposable {

	/** Scan cache, tied to the mtime of both dirs (key) and additionally invalidated by a watcher
	 *  (a dir's mtime does NOT change when an existing .md is EDITED — only on create/delete). */
	private cache: { key: string; items: ISlashCommand[] } | undefined;
	private readonly watchedDirs = new Map<string, URI>();

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
	) {
		super();
		this._register(this.fileService.onDidFilesChange(e => {
			for (const dir of this.watchedDirs.values()) {
				if (e.affects(dir)) {
					this.cache = undefined;
					return;
				}
			}
		}));
	}

	/** Dirs in merge order: global first, project afterwards (overriding by slug). */
	private dirs(): { uri: URI; scope: 'project' | 'global' }[] {
		const out: { uri: URI; scope: 'project' | 'global' }[] = [
			{ uri: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'commands'), scope: 'global' },
		];
		const folder = this.contextService.getWorkspace().folders[0];
		if (folder) {
			out.push({ uri: joinPath(folder.uri, '.openide', 'commands'), scope: 'project' });
		}
		return out;
	}

	private watchDir(uri: URI): void {
		const key = uri.toString();
		if (!this.watchedDirs.has(key)) {
			this.watchedDirs.set(key, uri);
			this._register(this.fileService.watch(uri));
		}
	}

	/** Frontmatter YAML plano key:value (mismo parser tolerante de openideAgentSkills). */
	private parseFrontmatter(content: string): { description?: string; hint?: string } {
		if (!content.startsWith('---')) {
			return {};
		}
		const end = content.indexOf('\n---', 3);
		if (end < 0) {
			return {};
		}
		const out: { description?: string; hint?: string } = {};
		for (const line of content.slice(3, end).split('\n')) {
			const m = line.match(/^(description|argument-hint):\s*(.+?)\s*$/);
			if (m) {
				out[m[1] === 'description' ? 'description' : 'hint'] = m[2].replace(/^['"]|['"]$/g, '');
			}
		}
		return out;
	}

	/** The .md body without the frontmatter (when there is none, it is the whole content). */
	private bodyOf(content: string): string {
		if (!content.startsWith('---')) {
			return content;
		}
		const end = content.indexOf('\n---', 3);
		if (end < 0) {
			return content;
		}
		const nl = content.indexOf('\n', end + 1);
		return nl < 0 ? '' : content.slice(nl + 1);
	}

	/** Lista los comandos disponibles (merge global+proyecto, precedencia proyecto). */
	async scan(): Promise<ISlashCommand[]> {
		const dirs = this.dirs();
		const key = (await Promise.all(dirs.map(async d => {
			try {
				return String((await this.fileService.stat(d.uri)).mtime ?? 0);
			} catch {
				return '0'; // sin directorio todavía
			}
		}))).join(':');
		if (this.cache && this.cache.key === key) {
			return this.cache.items;
		}
		const bySlug = new Map<string, ISlashCommand>();
		for (const dir of dirs) { // global primero: el proyecto pisa por slug
			this.watchDir(dir.uri);
			let children;
			try {
				children = (await this.fileService.resolve(dir.uri)).children ?? [];
			} catch {
				continue; // sin directorio de comandos todavía
			}
			for (const child of children) {
				if (child.isDirectory || !child.name.endsWith('.md')) {
					continue;
				}
				const slug = child.name.slice(0, -3);
				if (!NAME_RE.test(slug)) {
					continue; // nombre inválido: se skipea silencioso (igual que skills)
				}
				try {
					const head = (await this.fileService.readFile(child.resource)).value.toString().slice(0, INDEX_HEAD_CHARS);
					const fm = this.parseFrontmatter(head);
					bySlug.set(slug, {
						slug,
						description: (fm.description ?? '').slice(0, INDEX_DESC_CAP),
						argumentHint: fm.hint ?? '',
						filePath: child.resource,
						scope: dir.scope,
					});
				} catch {
					// .md ilegible: se ignora, el resto sigue
				}
				if (bySlug.size >= MAX_COMMANDS) {
					break;
				}
			}
		}
		const items = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
		this.cache = { key, items };
		return items;
	}

	/** Is the composer text a /command invocation? (sync, regex only — the caller checks the slug's
	 *  existence via expand, so it can suggest the closest one). */
	resolve(inputText: string): { slug: string; args: string } | undefined {
		const m = String(inputText ?? '').trim().match(INVOKE_RE);
		return m ? { slug: m[1], args: (m[2] ?? '').trim() } : undefined;
	}

	/** Expands a /command: displayText = what was typed (UI/history/titles), modelText = the
	 *  .md body interpolated (what the model sees). undefined when the slug does not exist. */
	async expand(slug: string, args: string): Promise<{ displayText: string; modelText: string } | undefined> {
		const cmd = (await this.scan()).find(c => c.slug === slug);
		if (!cmd) {
			return undefined;
		}
		let body: string;
		try {
			body = this.bodyOf((await this.fileService.readFile(cmd.filePath)).value.toString()).trim();
		} catch {
			return undefined; // borrado entre el scan y el send
		}
		const argStr = args.trim();
		const parts = shlexSplit(argStr);
		let modelText: string;
		if (/\$ARGUMENTS|\$[1-9]/.test(body)) {
			modelText = body.replace(/\$ARGUMENTS|\$([1-9])/g, (_m, n) => n ? (parts[Number(n) - 1] ?? '') : argStr);
		} else {
			// no placeholders: the args are appended at the end (fallback with limits independent of the model)
			modelText = argStr ? `${body}\n\nInstrucción adicional: ${argStr}` : body;
		}
		return { displayText: `/${slug}${argStr ? ` ${argStr}` : ''}`, modelText };
	}

	/** Slug closest to an unknown one (prefix first, then edit distance ≤ 2). */
	async closest(slug: string): Promise<string | undefined> {
		const items = await this.scan();
		const prefix = items.find(c => c.slug.startsWith(slug));
		if (prefix) {
			return prefix.slug;
		}
		let best: string | undefined;
		let bestD = 3;
		for (const c of items) {
			const d = editDistance(slug, c.slug, 2);
			if (d < bestD) {
				bestD = d;
				best = c.slug;
			}
		}
		return best;
	}

	/** Creates a new command's template (in the project when a folder is open) and returns its
	 *  URI so it can be opened in an editor. If it already exists, it returns it without overwriting. */
	async create(slug: string): Promise<URI | undefined> {
		if (!NAME_RE.test(slug)) {
			return undefined;
		}
		const dirs = this.dirs();
		const target = dirs.find(d => d.scope === 'project') ?? dirs[0];
		const uri = joinPath(target.uri, `${slug}.md`);
		if (!(await this.fileService.exists(uri))) {
			const template = `---\ndescription: Qué hace este comando (aparece en el menú del /)\nargument-hint: [args]\n---\n\nInstrucciones para el agente. $ARGUMENTS interpola todo lo tipeado tras /${slug}; $1..$9 los argumentos sueltos (comillas respetadas).\n`;
			await this.fileService.writeFile(uri, VSBuffer.fromString(template));
		}
		this.cache = undefined;
		return uri;
	}

	/** Deletes a command's .md (the one in the scope with precedence, i.e. the one in use). */
	async delete(slug: string): Promise<boolean> {
		const cmd = (await this.scan()).find(c => c.slug === slug);
		if (!cmd) {
			return false;
		}
		try {
			await this.fileService.del(cmd.filePath);
		} catch {
			return false;
		}
		this.cache = undefined;
		return true;
	}
}
