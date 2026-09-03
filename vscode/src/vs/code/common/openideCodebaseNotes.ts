/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — `.openide/MEMORY.md` as part of the graph.
 *
 *  Until now OpenIDE had two places for durable knowledge: the graph, derived from the code, and
 *  a flat markdown file injected whole into the system prompt. Two destinations means an agent
 *  has to choose where a fact goes and a reader has to consult both — and a memory that must be
 *  read in full, every session, before it is useful is a memory that stops being read.
 *
 *  The per-file shape of the index is not the obstacle here, it is the answer: MEMORY.md IS a
 *  file, so it indexes like any other source. Its entries become `note` nodes with the
 *  `authored` provider, and the file stays exactly where it was — in the repo, editable by hand,
 *  diffable in a pull request. `pruneStale` then does the right thing on its own: delete the
 *  file and its notes go with it.
 *
 *  The point of the exercise is the EDGES. A note that merely exists is the markdown file again,
 *  in a more expensive form. A note wired to the entity it is about comes back from the same
 *  query that returns the entity, already trimmed to that query's token budget.
 *
 *  ── Why linking is a separate pass ─────────────────────────────────────────────────────────
 *  A provider only ever sees ONE file, and an edge needs its target's node id, which encodes the
 *  target's own uri. So the provider records what each note MENTIONS and stops there; the pass
 *  below runs once the whole graph is known and turns a mention into an edge only when it
 *  resolves to exactly one node. An ambiguous name yields no edge at all: an invented edge in a
 *  graph people navigate is worse than a missing one, because nothing about it looks wrong.
 *--------------------------------------------------------------------------------------------*/

import { ICodebaseMemoryEdge, ICodebaseMemoryNode, makeEvidence, makeNodeId } from './openideCodebaseMemoryTypes.js';

/** Workspace-relative path of the shared memory. */
export const CODEBASE_NOTES_PATH = '.openide/MEMORY.md';

/** Longest a note's display name gets; the whole entry still lives in `documentation`. */
const NAME_CAP = 80;

/** Ceiling on notes taken from one file, so a runaway memory cannot flood the graph. */
const MAX_NOTES = 500;

/** Key under which a note carries what it mentions, until the link pass resolves it. */
export const NOTE_MENTIONS_KEY = 'mentions';

/**
 * How hard the link pass tries to connect a note to the code.
 *
 * `explicit` is the default and the safe one: only what the writer marked. `identifiers` also
 * reads bare code-looking words, which is what makes notes written BEFORE any of this existed
 * connect to anything at all — at the cost of the occasional wrong edge. `off` keeps the notes
 * in the graph as free-standing facts, still returned by a query, just not wired to entities.
 */
export type NoteLinkingMode = 'explicit' | 'identifiers' | 'off';

export const DEFAULT_NOTE_LINKING: NoteLinkingMode = 'explicit';

/** Settings that govern the notes half of the graph. */
export const CODEBASE_NOTES_ENABLED_SETTING = 'openide.memory.notes.enabled';
export const CODEBASE_NOTES_LINKING_SETTING = 'openide.memory.notes.linking';
export const CODEBASE_NOTES_MAX_CHARS_SETTING = 'openide.memory.notes.maxChars';

/** Reads the setting, falling back rather than trusting whatever is in the JSON. */
export function noteLinkingFromSetting(value: unknown): NoteLinkingMode {
	return value === 'identifiers' || value === 'off' || value === 'explicit' ? value : DEFAULT_NOTE_LINKING;
}

/**
 * A bare word worth trying to resolve under `identifiers`.
 *
 * Deliberately narrow: it has to LOOK like code (camelCase, PascalCase, snake_case or a dotted
 * path) and be long enough that a common Spanish or English word does not qualify. Even then it
 * still has to resolve to exactly one node, so this widens what is attempted, never what is
 * accepted.
 */
export function looksLikeIdentifier(word: string): boolean {
	if (word.length < 5 || /\s/.test(word)) {
		return false;
	}
	return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(word)
		&& (/[a-z][A-Z]/.test(word) || /_/.test(word) || /\./.test(word) || /^[A-Z][a-z]+[A-Z]/.test(word));
}

/** Bare identifiers in an entry, for `identifiers` mode. Marked mentions are handled elsewhere. */
export function extractBareIdentifiers(text: string): string[] {
	// Anything already inside backticks or brackets was handled as an explicit mention; stripping
	// it here keeps one mention from being counted twice under two different rules.
	const stripped = text.replace(/`[^`\n]*`/g, ' ').replace(/\[\[[^\]\n]*\]\]/g, ' ');
	const found = new Set<string>();
	for (const match of stripped.matchAll(/[A-Za-z_$][\w$.]*/g)) {
		if (looksLikeIdentifier(match[0])) {
			found.add(match[0]);
		}
	}
	return [...found];
}

export function isCodebaseNotesUri(uri: string): boolean {
	return uri.endsWith(`/${CODEBASE_NOTES_PATH}`);
}

/** Workspace root of a notes uri (`<root>/.openide/MEMORY.md` gives `<root>`), or undefined. */
export function notesWorkspaceRoot(uri: string): string | undefined {
	const suffix = `/${CODEBASE_NOTES_PATH}`;
	return uri.endsWith(suffix) ? uri.slice(0, -suffix.length) : undefined;
}

export interface ICodebaseNoteEntry {
	/** Full text of the entry, without its bullet. */
	readonly text: string;
	/** 1-based line where the entry starts. */
	readonly line: number;
	/** Nearest heading above it, when there is one — it is the entry's topic. */
	readonly section?: string;
	/** Verbatim mentions found in the entry, to be resolved later. */
	readonly mentions: readonly string[];
}

/**
 * Reads MEMORY.md into entries.
 *
 * One bullet is one note; an indented continuation line belongs to the bullet above it, because
 * a wrapped sentence split into two notes would be two half-facts. Anything that is not a bullet
 * (prose, headings) is not a note — headings are kept as the section of the notes beneath them.
 */
export function parseCodebaseNotes(content: string): ICodebaseNoteEntry[] {
	const entries: ICodebaseNoteEntry[] = [];
	const lines = content.split(/\r?\n/);
	let section: string | undefined;
	let current: { text: string; line: number; section?: string } | undefined;

	const flush = () => {
		if (!current) {
			return;
		}
		const text = current.text.trim();
		if (text && entries.length < MAX_NOTES) {
			entries.push({ text, line: current.line, section: current.section, mentions: extractNoteMentions(text) });
		}
		current = undefined;
	};

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index];
		const heading = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(raw);
		if (heading) {
			flush();
			section = heading[1];
			continue;
		}
		const bullet = /^\s{0,3}[-*+]\s+(.*)$/.exec(raw);
		if (bullet) {
			flush();
			current = { text: bullet[1], line: index + 1, section };
			continue;
		}
		if (current && /^\s+\S/.test(raw)) {
			current.text += ` ${raw.trim()}`;
			continue;
		}
		flush();
	}
	flush();
	return entries;
}

/**
 * What an entry points at: backticked or wiki-style mentions only.
 *
 * Deliberately NOT every capitalised word. Fuzzy matching over prose is how a note about "the
 * User flow" ends up wired to an unrelated `User` class, and a wrong edge is invisible once it
 * is in the graph. If the writer wanted a link, they marked it.
 */
export function extractNoteMentions(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/`([^`\n]{1,200})`/g)) {
		const value = match[1].trim();
		if (value) {
			found.add(value);
		}
	}
	for (const match of text.matchAll(/\[\[([^\]\n]{1,200})\]\]/g)) {
		const value = match[1].trim();
		if (value) {
			found.add(value);
		}
	}
	return [...found];
}

/** A mention that looks like a path rather than a symbol. */
export function isPathMention(mention: string): boolean {
	return /[/\\]/.test(mention) && /\.[A-Za-z0-9]{1,10}$/.test(mention) && !/\s/.test(mention);
}

/** Short, stable label for an entry. */
function noteName(text: string): string {
	const flat = text.replace(/`/g, '').replace(/\s+/g, ' ').trim();
	return flat.length > NAME_CAP ? `${flat.slice(0, NAME_CAP - 1)}…` : flat;
}

export interface ICodebaseNotesExtraction {
	readonly nodes: readonly ICodebaseMemoryNode[];
	readonly edges: readonly ICodebaseMemoryEdge[];
}

/**
 * Turns MEMORY.md into note nodes plus the CONTAINS edges from the file.
 *
 * ANNOTATES edges are NOT emitted here: this only sees one file, and a mention cannot become an
 * edge until the whole graph is known. The mentions ride along in `metadata` until then.
 */
export function extractCodebaseNotes(workspaceKey: string, uri: string, content: string): ICodebaseNotesExtraction {
	const evidence = makeEvidence('authored');
	const nodes: ICodebaseMemoryNode[] = [];
	const edges: ICodebaseMemoryEdge[] = [];
	const fileNodeId = makeNodeId(workspaceKey, uri, 'file', uri);
	nodes.push({ id: fileNodeId, kind: 'file', name: 'MEMORY.md', uri, evidence, degree: 0 });

	for (const entry of parseCodebaseNotes(content)) {
		// The line is part of the id, so editing one entry does not renumber the others' identity
		// the way an ordinal would.
		const id = makeNodeId(workspaceKey, uri, 'note', entry.text.slice(0, 120), entry.line);
		nodes.push({
			id,
			kind: 'note',
			name: noteName(entry.text),
			qualifiedName: entry.section ? `${entry.section} · ${noteName(entry.text)}` : undefined,
			uri,
			range: { startLine: entry.line, startColumn: 0, endLine: entry.line, endColumn: 0 },
			documentation: entry.text,
			evidence,
			degree: 0,
			metadata: { [NOTE_MENTIONS_KEY]: entry.mentions, section: entry.section },
		});
		edges.push({ source: fileNodeId, target: id, type: 'CONTAINS', evidence });
	}
	return { nodes, edges };
}

/**
 * Resolves every note's mentions against the finished graph, emitting ANNOTATES edges.
 *
 * Runs once the whole node set exists, and refuses to guess:
 *   - a path mention must match a node whose uri ends with it;
 *   - a symbol mention must match exactly ONE node by name or qualified name;
 *   - anything ambiguous or unresolved yields nothing.
 *
 * Returns only the new edges, so the caller can append them and keep dedup in one place.
 */
export function linkCodebaseNotes(nodes: readonly ICodebaseMemoryNode[], mode: NoteLinkingMode = DEFAULT_NOTE_LINKING): ICodebaseMemoryEdge[] {
	if (mode === 'off') {
		return [];
	}
	const notes = nodes.filter(node => node.kind === 'note');
	if (!notes.length) {
		return [];
	}
	// The root comes from the notes file itself rather than from the caller: it is the one uri
	// here whose shape is known, and a caller passing the wrong root would silently stop every
	// path mention from resolving.
	const workspaceRoot = notesWorkspaceRoot(notes[0].uri);
	const byName = new Map<string, ICodebaseMemoryNode[]>();
	const byUri = new Map<string, ICodebaseMemoryNode>();
	for (const node of nodes) {
		if (node.kind === 'note') {
			continue; // a note annotating another note is not a relation anybody asked for
		}
		if (node.kind === 'file') {
			byUri.set(node.uri, node);
		}
		// A node is indexed under both its name and its qualified name, and for most entities
		// those are the same string. Pushing it twice would make every single-match symbol look
		// ambiguous, so a name maps to DISTINCT nodes, not to occurrences.
		for (const key of new Set([node.name, node.qualifiedName])) {
			if (!key) {
				continue;
			}
			const list = byName.get(key) ?? [];
			if (!list.some(candidate => candidate.id === node.id)) {
				list.push(node);
			}
			byName.set(key, list);
		}
	}

	const evidence = makeEvidence('authored');
	const edges: ICodebaseMemoryEdge[] = [];
	const seen = new Set<string>();
	for (const note of notes) {
		const marked = note.metadata?.[NOTE_MENTIONS_KEY];
		const mentions: string[] = Array.isArray(marked) ? marked.map(String) : [];
		if (mode === 'identifiers') {
			mentions.push(...extractBareIdentifiers(note.documentation ?? note.name));
		}
		for (const raw of mentions) {
			const mention = String(raw);
			const target = isPathMention(mention)
				? resolvePathMention(mention, byUri, workspaceRoot)
				: resolveSymbolMention(mention, byName);
			if (!target || target.id === note.id) {
				continue;
			}
			const key = `${note.id} ${target.id}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			edges.push({ source: note.id, target: target.id, type: 'ANNOTATES', evidence });
		}
	}
	return edges;
}

function resolvePathMention(mention: string, byUri: ReadonlyMap<string, ICodebaseMemoryNode>, workspaceRoot?: string): ICodebaseMemoryNode | undefined {
	const clean = mention.replace(/^\.\//, '').replace(/^\/+/, '');
	if (workspaceRoot) {
		const direct = byUri.get(`${workspaceRoot}/${clean}`);
		if (direct) {
			return direct;
		}
	}
	// Without a root (or with a partial path) fall back to a unique suffix match: `foo/bar.ts`
	// naming exactly one file is still unambiguous, and demanding the full path from the repo
	// root would make the feature useless for anyone writing notes by hand.
	const matches: ICodebaseMemoryNode[] = [];
	for (const [uri, node] of byUri) {
		if (uri.endsWith(`/${clean}`)) {
			matches.push(node);
			if (matches.length > 1) {
				return undefined;
			}
		}
	}
	return matches[0];
}

function resolveSymbolMention(mention: string, byName: ReadonlyMap<string, ICodebaseMemoryNode[]>): ICodebaseMemoryNode | undefined {
	const matches = byName.get(mention);
	if (!matches || matches.length !== 1) {
		return undefined; // unknown, or ambiguous: either way, no edge
	}
	return matches[0];
}
