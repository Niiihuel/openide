/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — codebase PRIORITIES: permanent user rules with a scope.
 *  The user states a convention ("always X", "never Y", "from now on Z") and it is stored
 *  in <workspace>/.openide/codegraph/priorities.json. When the agent explores the codebase, the
 *  priorities whose scope matches (touched paths / query keywords) are injected automatically
 *  into the response — the model honours them without the user having to repeat them.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export type PriorityLevel = 'critical' | 'high' | 'normal';

export interface CodebasePriority {
	id: string;
	text: string;
	level: PriorityLevel;
	scope: { paths: string[]; keywords: string[] };
	createdAt: number;
}

export interface ISavePriority {
	text: string;
	level?: PriorityLevel;
	paths?: string[];
	keywords?: string[];
}

export const IOpenideCodebasePriorities = createDecorator<IOpenideCodebasePriorities>('openideCodebasePriorities');

export interface IOpenideCodebasePriorities {
	readonly _serviceBrand: undefined;
	/** Guarda (o actualiza, dedupe por text) una regla permanente. */
	save(input: ISavePriority): Promise<CodebasePriority | undefined>;
	/** Returns the priorities whose scope matches the query / the touched files. */
	match(query: string, touchedFiles: string[]): Promise<CodebasePriority[]>;
	/** Renders a text block for injecting into the agent's response. */
	render(priorities: CodebasePriority[]): string;
}

const LEVEL_ORDER: Record<PriorityLevel, number> = { critical: 0, high: 1, normal: 2 };
const MATCH_CAP = 6;

export class OpenideCodebasePriorities extends Disposable implements IOpenideCodebasePriorities {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
	) {
		super();
	}

	/** <workspace>/.openide/codegraph/priorities.json — undefined si no hay carpeta abierta. */
	private storeUri(): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder) { return undefined; }
		return URI.joinPath(folder.uri, '.openide', 'codegraph', 'priorities.json');
	}

	private async load(): Promise<CodebasePriority[]> {
		const uri = this.storeUri();
		if (!uri) { return []; }
		try {
			const raw = (await this.fileService.readFile(uri)).value.toString();
			const parsed = JSON.parse(raw);
			const arr = Array.isArray(parsed?.priorities) ? parsed.priorities : [];
			// saneamos: descartamos entradas rotas.
			return arr.filter((p: any) => p && typeof p.text === 'string' && p.text.trim()).map((p: any): CodebasePriority => ({
				id: String(p.id ?? Date.now().toString(36)),
				text: String(p.text),
				level: (p.level === 'critical' || p.level === 'normal') ? p.level : 'high',
				scope: {
					paths: Array.isArray(p.scope?.paths) ? p.scope.paths.map((s: any) => String(s)) : [],
					keywords: Array.isArray(p.scope?.keywords) ? p.scope.keywords.map((s: any) => String(s)) : [],
				},
				createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
			}));
		} catch {
			return [];
		}
	}

	private async persist(priorities: CodebasePriority[]): Promise<void> {
		const uri = this.storeUri();
		if (!uri) { return; }
		const doc = JSON.stringify({ priorities }, null, 2);
		await this.fileService.writeFile(uri, VSBuffer.fromString(doc + '\n'));
	}

	async save(input: ISavePriority): Promise<CodebasePriority | undefined> {
		const text = (input.text ?? '').trim();
		if (!text) { return undefined; }
		if (!this.storeUri()) { return undefined; }
		const level: PriorityLevel = input.level && LEVEL_ORDER[input.level] !== undefined ? input.level : 'high';
		const paths = (input.paths ?? []).map(s => String(s).trim()).filter(Boolean);
		const keywords = (input.keywords ?? []).map(s => String(s).trim()).filter(Boolean);
		const list = await this.load();
		// dedupe por text (case-insensitive) → update in-place.
		const lower = text.toLowerCase();
		const existing = list.find(p => p.text.toLowerCase() === lower);
		let saved: CodebasePriority;
		if (existing) {
			existing.level = level;
			existing.scope = { paths, keywords };
			saved = existing;
		} else {
			saved = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, level, scope: { paths, keywords }, createdAt: Date.now() };
			list.push(saved);
		}
		await this.persist(list);
		return saved;
	}

	async match(query: string, touchedFiles: string[]): Promise<CodebasePriority[]> {
		const list = await this.load();
		if (!list.length) { return []; }
		const q = (query ?? '').toLowerCase();
		const tokens = new Set(q.split(/[^a-z0-9_]+/i).filter(Boolean));
		const files = (touchedFiles ?? []).map(f => (f ?? '').toLowerCase()).filter(Boolean);
		const hits = list.filter(p => {
			const { paths, keywords } = p.scope;
			// empty scope ⇒ a project-wide rule, it always applies.
			if (!paths.length && !keywords.length) { return true; }
			// some path fragment is contained in some touched file.
			if (paths.some(frag => { const f = frag.toLowerCase(); return files.some(file => file.includes(f)); })) { return true; }
			// some keyword appears in the query (exact token or substring).
			if (keywords.some(kw => { const k = kw.toLowerCase(); return tokens.has(k) || q.includes(k); })) { return true; }
			return false;
		});
		hits.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.createdAt - a.createdAt);
		return hits.slice(0, MATCH_CAP);
	}

	render(priorities: CodebasePriority[]): string {
		if (!priorities.length) { return ''; }
		const lines = ['== PRIORIDADES DEL PROYECTO (reglas del usuario — respetalas) =='];
		for (const p of priorities) {
			lines.push(`[${p.level.toUpperCase()}] ${p.text}`);
		}
		return lines.join('\n');
	}
}

registerSingleton(IOpenideCodebasePriorities, OpenideCodebasePriorities, InstantiationType.Delayed);
