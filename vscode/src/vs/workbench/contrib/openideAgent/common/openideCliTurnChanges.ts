/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — what an external CLI changed, grouped by conversation turn.
 *
 *  OpenIDE already knows what its OWN agent changed: its tools write through the registry, so
 *  every edit lands in a changeset keyed by messageId. An external CLI writes with its own
 *  tools and tells us nothing — deliberately, because exposing `write_file` over MCP would let
 *  a tool skip OpenIDE's approval. So the file list has to come from somewhere the CLI does not
 *  control: git.
 *
 *  ── Why turns are free ─────────────────────────────────────────────────────────────────────
 *  The expensive-looking half turns out to be already built. `reduceOpenideCliStatus` enters
 *  `in-progress` on Claude's UserPromptSubmit hook and, for CLIs with no hooks, on the output
 *  heuristic; it leaves on Stop, on quiet, or on exit. Those transitions ARE the turn
 *  boundaries: collect what changed between them and every CLI gets per-turn attribution —
 *  exact where hooks exist, approximate where they do not.
 *
 *  That is also why this does not use Claude's PostToolUse: a per-tool hook would be precise for
 *  one CLI and unavailable for the rest, whereas the pair above already covers all of them.
 *
 *  ── Why the file list comes from the WATCHER and the kind from git ─────────────────────────
 *  The first version compared `git status` before and after a turn. It cannot work, and the way
 *  it fails is silent: editing a file does not change its porcelain code. An untracked file is
 *  `??` before and after the edit; a modified one is ` M` before and after the second edit. So a
 *  status-code diff sees only STATE TRANSITIONS, and an agent that keeps working on a file it
 *  already touched produces an empty turn — which reads as "the agent changed nothing".
 *
 *  So the workspace file watcher says WHICH paths changed inside the window, and a git status
 *  scoped to just those paths says WHAT KIND each change is. It is also far cheaper: a whole-tree
 *  status in a real repo runs to megabytes, and this asks about a handful of files.
 *
 *  ── What it cannot know ────────────────────────────────────────────────────────────────────
 *  A turn's changes are "what changed in the working tree while the agent was working". If the
 *  user edits a file by hand during that window, it lands in the turn. That is stated in the
 *  model rather than hidden, so a surface can say "durante este turno" instead of claiming the
 *  agent did it. Isolating a session in its own worktree is the only way to make it exact, and
 *  that is a workflow decision, not something this file can fix.
 *--------------------------------------------------------------------------------------------*/

/** A file's fate within a turn, as git reports it. */
export type OpenideTurnFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface IOpenideTurnFile {
	/** Workspace-relative path, exactly as git printed it. */
	readonly path: string;
	readonly status: OpenideTurnFileStatus;
	/** Previous path, for a rename. */
	readonly from?: string;
}

/** One `git status --porcelain -z` record: the two-letter code and the path it applies to. */
export interface IPorcelainRecord {
	readonly xy: string;
	readonly path: string;
	/** Origin of a rename or copy, which git prints as a second field. */
	readonly from?: string;
}

/**
 * Parses `git status --porcelain -z`.
 *
 * `-z` and a real parser rather than splitting lines: without it git quotes and escapes any path
 * with a space, a quote or a non-ASCII byte, so `src/naïve.ts` comes back mangled and never
 * matches the file it names. With `-z` the paths are raw, but a rename or copy emits its ORIGIN
 * as a second NUL-separated field — reading that origin as its own record would invent a status
 * code out of the first two bytes of a path.
 */
export function parsePorcelainZ(stdout: string): IPorcelainRecord[] {
	const fields = stdout.split('\0');
	const records: IPorcelainRecord[] = [];
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];
		// The trailing NUL leaves a final empty field, and a record is always `XY<space><path>`,
		// so anything shorter cannot be one.
		if (field.length < 4) {
			continue;
		}
		const xy = field.slice(0, 2);
		const path = field.slice(3);
		if (xy.includes('R') || xy.includes('C')) {
			records.push({ xy, path, from: fields[index + 1] });
			index++; // consume the origin
			continue;
		}
		records.push({ xy, path });
	}
	return records;
}

/** The status a porcelain code means for our purposes. */
export function turnFileStatusOf(xy: string): OpenideTurnFileStatus {
	if (xy === '??') {
		return 'untracked';
	}
	if (xy.includes('R') || xy.includes('C')) {
		return 'renamed';
	}
	if (xy.includes('D')) {
		return 'deleted';
	}
	if (xy.includes('A')) {
		return 'added';
	}
	return 'modified';
}

/**
 * What a session is doing right now, for the surfaces that show it.
 *
 * Richer than the CLI status vocabulary on purpose. `needs-input` says the agent is waiting; it
 * cannot say whether anybody is answering. `typing` is about the HUMAN, and without it a
 * conversation being answered right now looks identical to one abandoned an hour ago.
 */
export type OpenideCliActivity = 'working' | 'typing' | 'waiting' | 'done' | 'failed';

/**
 * Folds the agent's status and the user's keystrokes into one state.
 *
 * The agent wins when it is working: keystrokes while it produces output are the user queueing
 * the next message, not a conversation waiting on them.
 */
export function cliActivityOf(status: string, typing: boolean): OpenideCliActivity {
	if (status === 'in-progress') {
		return 'working';
	}
	if (status === 'failed') {
		return 'failed';
	}
	if (typing) {
		return 'typing';
	}
	return status === 'needs-input' ? 'waiting' : 'done';
}

/** What the workspace watcher saw happen to a path. */
export type OpenideTouchKind = 'added' | 'updated' | 'deleted';

/** Paths the watcher reported inside a turn, with the newest verdict per path. */
export type OpenideTouchedPaths = ReadonlyMap<string, OpenideTouchKind>;

/** Ceiling on paths remembered per turn; a build or an install can touch thousands. */
export const MAX_TOUCHED_PER_TURN = 500;

/**
 * The turn's file list: the watcher says which paths, git says what kind.
 *
 * A path git no longer reports is one that ended the turn matching HEAD. The watcher saw it
 * change, so something happened — the agent wrote it and reverted it, or committed it. It is
 * dropped rather than shown: a row that opens an identical diff spends the reader's attention
 * for nothing. The exception is a path the watcher saw DELETED that git does not mention, which
 * is an untracked file that is simply gone: git has nothing to say about it and it is still news.
 */
export function turnFilesFromWatch(touched: OpenideTouchedPaths, records: readonly IPorcelainRecord[]): IOpenideTurnFile[] {
	const byPath = new Map(records.map(record => [record.path, record]));
	const files: IOpenideTurnFile[] = [];
	for (const [path, kind] of touched) {
		const record = byPath.get(path);
		if (record) {
			files.push({ path, status: turnFileStatusOf(record.xy), from: record.from });
			continue;
		}
		if (kind === 'deleted') {
			files.push({ path, status: 'deleted' });
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

// ---- Turns ------------------------------------------------------------------------------------

export interface IOpenideCliTurn {
	readonly id: string;
	readonly sessionId: string;
	/** 1-based position in the conversation, for a label a human can follow. */
	readonly ordinal: number;
	readonly startedAt: number;
	/** Undefined while the turn is still running. */
	readonly endedAt?: number;
	readonly files: readonly IOpenideTurnFile[];
	/**
	 * The turn boundary came from the CLI's own hooks rather than from the output heuristic.
	 *
	 * Surfaced because it changes what the list is worth: hooked turns are exactly the agent's
	 * work, heuristic ones are "what changed while it looked busy". A view that presents both the
	 * same way is overstating one of them.
	 */
	readonly hooked: boolean;
	/** The turn touched more paths than we remember, so the list is a prefix. */
	readonly truncated?: boolean;
}

/** Turn bookkeeping for one session. Pure: the caller supplies snapshots and the clock. */
export class OpenideCliTurnLog {

	private readonly turns: IOpenideCliTurn[] = [];
	private open: { readonly turn: IOpenideCliTurn; readonly touched: Map<string, OpenideTouchKind> } | undefined;

	constructor(private readonly sessionId: string) { }

	get all(): readonly IOpenideCliTurn[] {
		return this.turns;
	}

	get isOpen(): boolean {
		return !!this.open;
	}

	/**
	 * A turn started. Re-opening while one is already open is ignored rather than nesting: the
	 * status reducer can re-enter `in-progress` mid-turn (a tool hook after a prompt hook), and
	 * treating that as a new turn would split one exchange into several.
	 */
	begin(at: number, hooked: boolean): void {
		if (this.open) {
			return;
		}
		const turn: IOpenideCliTurn = {
			id: `${this.sessionId}:${this.turns.length + 1}`,
			sessionId: this.sessionId,
			ordinal: this.turns.length + 1,
			startedAt: at,
			files: [],
			hooked,
		};
		this.turns.push(turn);
		this.open = { turn, touched: new Map() };
	}

	/**
	 * The watcher saw a path change. Ignored when no turn is open: a change outside a turn is the
	 * user's own work, and claiming it for the agent is the mistake this whole file exists to
	 * avoid.
	 *
	 * The newest verdict per path wins, except that a path first seen as ADDED stays added even
	 * if later writes report as updates: it did not exist when the turn opened.
	 */
	touch(path: string, kind: OpenideTouchKind): void {
		const open = this.open;
		if (!open || (!open.touched.has(path) && open.touched.size >= MAX_TOUCHED_PER_TURN)) {
			return;
		}
		const previous = open.touched.get(path);
		if (previous === 'added' && kind === 'deleted') {
			// Created and removed inside the same turn: scratch the agent wrote and cleaned up
			// after itself. It left no trace on disk, there is nothing to review and nothing to
			// roll back, so it is dropped rather than reported as a deletion — which is what made
			// an agent's own temp files show up as `D` rows for files that never existed.
			open.touched.delete(path);
			return;
		}
		open.touched.set(path, previous === 'added' && kind === 'updated' ? 'added' : kind);
	}

	/** Paths the open turn has seen, for the scoped git status that closes it. */
	touchedPaths(): readonly string[] {
		return this.open ? [...this.open.touched.keys()] : [];
	}

	/** A turn ended. Returns the closed turn, or undefined when none was open. */
	end(records: readonly IPorcelainRecord[], at: number): IOpenideCliTurn | undefined {
		const open = this.open;
		if (!open) {
			return undefined;
		}
		this.open = undefined;
		const closed: IOpenideCliTurn = {
			...open.turn,
			endedAt: at,
			files: turnFilesFromWatch(open.touched, records),
			truncated: open.touched.size >= MAX_TOUCHED_PER_TURN,
		};
		this.turns[this.turns.length - 1] = closed;
		return closed;
	}

	/** Every file the session touched, newest turn first, without repeating a path. */
	sessionFiles(): IOpenideTurnFile[] {
		const seen = new Set<string>();
		const files: IOpenideTurnFile[] = [];
		for (let index = this.turns.length - 1; index >= 0; index--) {
			for (const file of this.turns[index].files) {
				if (!seen.has(file.path)) {
					seen.add(file.path);
					files.push(file);
				}
			}
		}
		return files;
	}
}

/**
 * Whether a status transition opens a turn, closes one, or means nothing.
 *
 * The vocabulary is `reduceOpenideCliStatus`'s, on purpose: turn boundaries and the status dot
 * must never disagree about whether the agent is working, and they cannot if they are the same
 * transition read twice.
 */
export function turnBoundaryOf(previous: string, next: string): 'begin' | 'end' | undefined {
	if (previous === next) {
		return undefined;
	}
	if (next === 'in-progress') {
		return 'begin';
	}
	return previous === 'in-progress' ? 'end' : undefined;
}
