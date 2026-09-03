/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — AST-QUALITY codebase graph reusing VS Code's native LANGUAGE SERVERS
 *  (tsserver, pylance, etc. — the ones already running). Instead of the heuristic regex indexer,
 *  this layer queries workspace symbols (the language server index), document symbols (outline),
 *  y call hierarchy (callers/callees cross-file). Multi-lenguaje, on-demand, sin bundlear TS.
 *
 *  Everything runs with a timeout: if the language server is COLD (still indexing) we return empty
 *  or degraded results, we NEVER hang the agent. Always flat POJOs — no mutable references.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { DocumentSymbol, SymbolKind } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { OutlineModel } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { getWorkspaceSymbols } from '../../search/common/search.js';
import { CodebaseMemoryNodeKind } from '../../../../code/common/openideCodebaseMemoryTypes.js';
import { CallHierarchyItem, CallHierarchyModel } from '../../callHierarchy/common/callHierarchy.js';

export const IOpenideCodebaseGraph = createDecorator<IOpenideCodebaseGraph>('openideCodebaseGraph');

/** A located symbol (search result) — a flat POJO. */
export interface SymbolHit {
	name: string;
	container: string;
	kindLabel: string;
	path: string;
	line: number;
}

/** An outline symbol with its range. */
export interface OutlineSymbol {
	/** Readable label (UI). Do NOT use it to derive the graph kind: use `kind`. */
	kindLabel: string;
	kind: CodebaseMemoryNodeKind;
	name: string;
	detail: string;
	startLine: number;
	endLine: number;
}

export interface OutlineResult {
	path: string;
	symbols: OutlineSymbol[];
	/** Source del archivo (numerado) si es chico; undefined si es grande. */
	source?: string;
}

/** Lightweight reference to another symbol (caller/callee). */
export interface RelatedRef {
	name: string;
	path: string;
	line: number;
}

/** Full detail of a symbol: verbatim code + callers + callees. */
export interface SymbolDetailHit {
	path: string;
	line: number;
	kindLabel: string;
	name: string;
	signature: string;
	source: string;
	callers: RelatedRef[];
	callees: RelatedRef[];
}

export interface CallersHit {
	path: string;
	line: number;
	name: string;
	related: RelatedRef[];
}

export interface IOpenideCodebaseGraph {
	readonly _serviceBrand: undefined;
	/** Project-wide symbol search by name (language server index). */
	search(query: string, limit?: number): Promise<SymbolHit[]>;
	/** Precise outline of a file (+ source when it is small). */
	outline(pathOrUri: string): Promise<OutlineResult | undefined>;
	/** Symbol detail: verbatim code + callers + callees. */
	symbolDetail(name: string, file?: string): Promise<{ hits: SymbolDetailHit[] }>;
	/** Who CALLS (or is called by) a symbol — precise call hierarchy. */
	callers(name: string, direction?: 'callers' | 'callees', limit?: number): Promise<{ hits: CallersHit[] }>;
}

/** Global per-operation timeout: if the language server is cold we return degraded results. */
const OP_TIMEOUT_MS = 8000;
const SOURCE_LINE_CAP = 120;
const OUTLINE_SOURCE_CAP = 400;

/** Language server SymbolKind → graph taxonomy. A DIRECT enum mapping: deriving it from the
 *  UI label made everything fall through to 'type', and since the kind feeds makeNodeId, every
 *  symbol ended up duplicated (one from the regex, a ghost one from the LS). */
export function nodeKindFromSymbolKind(kind: SymbolKind): CodebaseMemoryNodeKind {
	switch (kind) {
		case SymbolKind.File: return 'file';
		case SymbolKind.Module: return 'module';
		case SymbolKind.Namespace: return 'namespace';
		case SymbolKind.Package: return 'package';
		case SymbolKind.Class: return 'class';
		case SymbolKind.Method: return 'method';
		case SymbolKind.Property: return 'property';
		case SymbolKind.Field: return 'field';
		case SymbolKind.Constructor: return 'constructor';
		case SymbolKind.Enum: return 'enum';
		case SymbolKind.Interface: return 'interface';
		case SymbolKind.Function: return 'function';
		case SymbolKind.Variable: return 'variable';
		case SymbolKind.Constant: return 'constant';
		case SymbolKind.Struct: return 'class';
		case SymbolKind.EnumMember: return 'constant';
		default: return 'type';
	}
}

/** Readable labels per SymbolKind (minimal). */
function kindLabel(kind: SymbolKind): string {
	switch (kind) {
		case SymbolKind.File: return 'archivo';
		case SymbolKind.Module: return 'módulo';
		case SymbolKind.Namespace: return 'namespace';
		case SymbolKind.Package: return 'paquete';
		case SymbolKind.Class: return 'clase';
		case SymbolKind.Method: return 'método';
		case SymbolKind.Property: return 'propiedad';
		case SymbolKind.Field: return 'campo';
		case SymbolKind.Constructor: return 'constructor';
		case SymbolKind.Enum: return 'enum';
		case SymbolKind.Interface: return 'interface';
		case SymbolKind.Function: return 'función';
		case SymbolKind.Variable: return 'variable';
		case SymbolKind.Constant: return 'constante';
		case SymbolKind.Struct: return 'struct';
		case SymbolKind.EnumMember: return 'enum-member';
		case SymbolKind.TypeParameter: return 'type-param';
		default: return 'símbolo';
	}
}

export class OpenideCodebaseGraph extends Disposable implements IOpenideCodebaseGraph {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILanguageFeaturesService private readonly languageFeatures: ILanguageFeaturesService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
	) {
		super();
	}

	// ---- helpers ----

	/** Runs with a timeout; on hang/cancel/exception it returns the fallback (degraded). */
	private async guard<T>(work: (token: CancellationToken) => Promise<T>, fallback: T): Promise<T> {
		const cts = new CancellationTokenSource();
		try {
			const res = await raceTimeout(
				work(cts.token).catch(() => fallback),
				OP_TIMEOUT_MS,
				() => cts.cancel(),
			);
			return res === undefined ? fallback : res;
		} catch {
			return fallback;
		} finally {
			cts.dispose();
		}
	}

	/** Workspace-relative path (for display), or the fsPath when it falls outside. */
	private relPath(uri: URI): string {
		const folder = this.contextService.getWorkspace().folders.find(f => uri.path.startsWith(f.uri.path));
		if (folder) {
			const rel = uri.path.slice(folder.uri.path.length).replace(/^\/+/, '');
			return rel || uri.path;
		}
		return uri.fsPath;
	}

	/** Resuelve un path (relativo → workspace folder) o un URI string a URI. */
	private resolveUri(pathOrUri: string): URI | undefined {
		const p = (pathOrUri ?? '').trim();
		if (!p) { return undefined; }
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
			try { return URI.parse(p); } catch { return undefined; }
		}
		const folders = this.contextService.getWorkspace().folders;
		if (!folders.length) { return undefined; }
		// If it already carries some folder's prefix we leave it, otherwise we hang it off the first one.
		const clean = p.replace(/^\.\//, '').replace(/^\/+/, '');
		return URI.joinPath(folders[0].uri, clean);
	}

	/** Opens the text model, runs fn, and always releases the reference. */
	private async withModel<T>(uri: URI, fn: (model: ITextModel) => Promise<T>, fallback: T): Promise<T> {
		let ref;
		try {
			ref = await this.textModelService.createModelReference(uri);
		} catch {
			return fallback;
		}
		try {
			return await fn(ref.object.textEditorModel);
		} catch {
			return fallback;
		} finally {
			ref.dispose();
		}
	}

	/** Reads a model's document symbols (flattened). Empty when there is no provider. */
	private async documentSymbols(model: ITextModel, token: CancellationToken): Promise<DocumentSymbol[]> {
		const outline = await OutlineModel.create(this.languageFeatures.documentSymbolProvider, model, token);
		return outline.asListOfDocumentSymbols();
	}

	/** Verbatim source of a range, numbered with the REAL line number, capped. */
	private numberedSource(model: ITextModel, startLine: number, endLine: number, cap: number): string {
		const last = Math.min(endLine, model.getLineCount());
		const stop = Math.min(last, startLine + cap - 1);
		const width = String(stop).length;
		const out: string[] = [];
		for (let ln = startLine; ln <= stop; ln++) {
			out.push(`${String(ln).padStart(width, ' ')}  ${model.getLineContent(ln)}`);
		}
		if (last > stop) {
			out.push(`… (+${last - stop} líneas más — abrí el archivo si necesitás el resto)`);
		}
		return out.join('\n');
	}

	/**
	 * Resolves a symbol by name (via workspace symbols) to concrete locations.
	 * It prioritizes an EXACT name match; filters by file when given; the position is the start of
	 * the symbol's range (enough for call hierarchy). Deduped by uri+line, capped at `max`.
	 */
	private async resolveSymbolLocations(name: string, file: string | undefined, max: number, token: CancellationToken): Promise<{ uri: URI; position: IPosition; range: IRange; kind: SymbolKind }[]> {
		const n = (name ?? '').trim();
		if (!n) { return []; }
		const items = await getWorkspaceSymbols(n, token);
		if (!items.length) { return []; }
		const lower = n.toLowerCase();
		const fileLower = file ? file.toLowerCase() : undefined;
		const exact = items.filter(i => i.symbol.name.toLowerCase() === lower);
		const pool = (exact.length ? exact : items).filter(i => {
			if (!fileLower) { return true; }
			return this.relPath(i.symbol.location.uri).toLowerCase().includes(fileLower) || i.symbol.location.uri.path.toLowerCase().includes(fileLower);
		});
		const out: { uri: URI; position: IPosition; range: IRange; kind: SymbolKind }[] = [];
		const seen = new Set<string>();
		for (const it of pool) {
			const loc = it.symbol.location;
			const key = `${loc.uri.toString()}#${loc.range.startLineNumber}`;
			if (seen.has(key)) { continue; }
			seen.add(key);
			out.push({
				uri: loc.uri,
				position: { lineNumber: loc.range.startLineNumber, column: loc.range.startColumn },
				range: loc.range,
				kind: it.symbol.kind,
			});
			if (out.length >= max) { break; }
		}
		return out;
	}

	/** Finds the document symbol matching name + line (to get the body's range). */
	private matchSymbol(symbols: DocumentSymbol[], name: string, line: number): DocumentSymbol | undefined {
		const lower = name.toLowerCase();
		let best: DocumentSymbol | undefined;
		let bestDist = Number.MAX_SAFE_INTEGER;
		for (const s of symbols) {
			if (s.name.toLowerCase() !== lower) { continue; }
			const dist = Math.abs(s.selectionRange.startLineNumber - line);
			if (dist < bestDist) { best = s; bestDist = dist; }
		}
		return best;
	}

	/** Mapea un CallHierarchyItem a una referencia liviana. */
	private toRef(item: CallHierarchyItem): RelatedRef {
		return { name: item.name, path: this.relPath(item.uri), line: item.selectionRange?.startLineNumber ?? item.range.startLineNumber };
	}

	// ---- API ----

	async search(query: string, limit: number = 15): Promise<SymbolHit[]> {
		const q = (query ?? '').trim();
		if (!q) { return []; }
		return this.guard(async token => {
			const items = await getWorkspaceSymbols(q, token);
			if (!items.length) { return []; }
			const lower = q.toLowerCase();
			// rank: exacto(3) > prefijo(2) > substring(1) > resto(0); estable dentro de cada nivel.
			const scored = items.map(it => {
				const nm = it.symbol.name.toLowerCase();
				const score = nm === lower ? 3 : nm.startsWith(lower) ? 2 : nm.includes(lower) ? 1 : 0;
				return { it, score };
			});
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, Math.max(1, limit)).map(({ it }): SymbolHit => ({
				name: it.symbol.name,
				container: it.symbol.containerName ?? '',
				kindLabel: kindLabel(it.symbol.kind),
				path: this.relPath(it.symbol.location.uri),
				line: it.symbol.location.range.startLineNumber,
			}));
		}, []);
	}

	async outline(pathOrUri: string): Promise<OutlineResult | undefined> {
		const uri = this.resolveUri(pathOrUri);
		if (!uri) { return undefined; }
		return this.guard(async token => {
			return this.withModel<OutlineResult | undefined>(uri, async model => {
				const syms = await this.documentSymbols(model, token);
				const symbols: OutlineSymbol[] = syms.map(s => ({
					kindLabel: kindLabel(s.kind),
					kind: nodeKindFromSymbolKind(s.kind),
					name: s.name,
					detail: s.detail ?? '',
					startLine: s.range.startLineNumber,
					endLine: s.range.endLineNumber,
				}));
				const lineCount = model.getLineCount();
				const source = lineCount <= OUTLINE_SOURCE_CAP
					? this.numberedSource(model, 1, lineCount, OUTLINE_SOURCE_CAP)
					: undefined;
				return { path: this.relPath(uri), symbols, source };
			}, undefined);
		}, undefined);
	}

	async symbolDetail(name: string, file?: string): Promise<{ hits: SymbolDetailHit[] }> {
		const n = (name ?? '').trim();
		if (!n) { return { hits: [] }; }
		return this.guard(async token => {
			const locs = await this.resolveSymbolLocations(n, file, 3, token);
			const hits: SymbolDetailHit[] = [];
			for (const loc of locs) {
				const hit = await this.withModel<SymbolDetailHit | undefined>(loc.uri, async model => {
					const syms = await this.documentSymbols(model, token);
					const match = this.matchSymbol(syms, n, loc.position.lineNumber);
					const range = match ? match.range : loc.range;
					const selection = match ? match.selectionRange : loc.range;
					const kind = match ? match.kind : loc.kind;
					const source = this.numberedSource(model, range.startLineNumber, range.endLineNumber, SOURCE_LINE_CAP);
					// signature = the first non-empty line of the body (trimmed).
					const firstLine = model.getLineContent(selection.startLineNumber).trim();
					const signature = firstLine.length > 200 ? firstLine.slice(0, 197) + '…' : firstLine;
					// call hierarchy on the selectionRange (the name's position).
					const callers = await this.resolveCalls(model, { lineNumber: selection.startLineNumber, column: selection.startColumn }, 'callers', 15, token);
					const callees = await this.resolveCalls(model, { lineNumber: selection.startLineNumber, column: selection.startColumn }, 'callees', 15, token);
					return {
						path: this.relPath(loc.uri),
						line: selection.startLineNumber,
						kindLabel: kindLabel(kind),
						name: match?.name ?? n,
						signature,
						source,
						callers,
						callees,
					};
				}, undefined);
				if (hit) { hits.push(hit); }
			}
			return { hits };
		}, { hits: [] });
	}

	async callers(name: string, direction: 'callers' | 'callees' = 'callers', limit: number = 20): Promise<{ hits: CallersHit[] }> {
		const n = (name ?? '').trim();
		if (!n) { return { hits: [] }; }
		return this.guard(async token => {
			const locs = await this.resolveSymbolLocations(n, undefined, 3, token);
			const hits: CallersHit[] = [];
			for (const loc of locs) {
				const hit = await this.withModel<CallersHit | undefined>(loc.uri, async model => {
					const syms = await this.documentSymbols(model, token);
					const match = this.matchSymbol(syms, n, loc.position.lineNumber);
					const selection = match ? match.selectionRange : loc.range;
					const related = await this.resolveCalls(model, { lineNumber: selection.startLineNumber, column: selection.startColumn }, direction, limit, token);
					return {
						path: this.relPath(loc.uri),
						line: selection.startLineNumber,
						name: match?.name ?? n,
						related,
					};
				}, undefined);
				if (hit) { hits.push(hit); }
			}
			return { hits };
		}, { hits: [] });
	}

	/** Resolves incoming (callers) or outgoing (callees) at a given position. */
	private async resolveCalls(model: ITextModel, position: IPosition, direction: 'callers' | 'callees', limit: number, token: CancellationToken): Promise<RelatedRef[]> {
		let ch: CallHierarchyModel | undefined;
		try {
			ch = await CallHierarchyModel.create(model, position, token);
		} catch {
			return [];
		}
		if (!ch) { return []; }
		try {
			if (direction === 'callers') {
				const incoming = await ch.resolveIncomingCalls(ch.root, token);
				return incoming.slice(0, limit).map(c => this.toRef(c.from));
			}
			const outgoing = await ch.resolveOutgoingCalls(ch.root, token);
			return outgoing.slice(0, limit).map(c => this.toRef(c.to));
		} catch {
			return [];
		} finally {
			ch.dispose();
		}
	}
}

registerSingleton(IOpenideCodebaseGraph, OpenideCodebaseGraph, InstantiationType.Delayed);
