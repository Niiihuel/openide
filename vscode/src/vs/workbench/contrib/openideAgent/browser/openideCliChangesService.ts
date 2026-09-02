/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — what each hosted CLI changed, session by session and turn by turn.
 *
 *  The dock knows when an agent starts and stops working: `reduceOpenideCliStatus` already
 *  derives that from Claude's hooks and, for CLIs without them, from the output heuristic. This
 *  turns those transitions into change sets — snapshot the working tree when a turn opens, diff
 *  when it closes — so a CLI that never told us anything still produces a reviewable list.
 *
 *  The alternative was exposing OpenIDE's write tools over MCP and reading the edits from there.
 *  That was rejected: a tool crossing that door skips OpenIDE's approval. git asks the CLI for
 *  nothing, works for every one of them equally, and cannot be wrong about what is on disk.
 *
 *  ── What a turn's list actually means ──────────────────────────────────────────────────────
 *  "What changed in the working tree while the agent was working" — the user's own edits during
 *  that window included. The model says so rather than hiding it, and `hooked` records whether
 *  the boundary came from the CLI's own hooks or from the heuristic, so a surface can present an
 *  exact list differently from an approximate one instead of overstating both.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { FileChangesEvent, IFileService } from '../../../../platform/files/common/files.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IOpenideAgentHostService, OPENIDE_AGENT_HOST_CHANNEL } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { OpenideCliId, OpenideCliSessionStatus } from '../common/openideAgentCliCatalog.js';
import { buildDiffPreview, countDiff, OpenideDiffLine } from '../common/openideDiffPreview.js';
import {
	IOpenideCliTurn,
	IOpenideTurnFile,
	IPorcelainRecord,
	cliActivityOf,
	OpenideCliActivity,
	OpenideCliTurnLog,
	OpenideTouchKind,
	parsePorcelainZ,
	pathspecBatches,
	turnBoundaryOf,
} from '../common/openideCliTurnChanges.js';

export const IOpenideCliChangesService = createDecorator<OpenideCliChangesService>('openideCliChangesService');

/** A changed file, plus whether the repo can say what it looked like before. */
export interface IOpenideCliChangedFile extends IOpenideTurnFile {
	/** There is a real "before" on record, so the diff is meaningful and rollback is safe. */
	readonly exact: boolean;
}

/**
 * A session as the Changes view shows it: ONE group per conversation, with everything that
 * conversation touched.
 *
 * Session-scoped and not turn-scoped, which is also how VS Code splits it: its panel reads
 * `getDiffsForFilesInSession` while `getDiffsForFilesInRequest` feeds the per-turn summary
 * INLINE in the transcript. For a hosted CLI that inline view already exists — it is the agent's
 * own TUI, printing its diff as it works — so repeating it here only fragmented the one thing
 * the panel is for: what this conversation did to the repo, in one list.
 *
 * Turns remain the mechanism underneath: they are how a change gets attributed to the agent
 * rather than to the user typing between turns. They just stopped being the presentation.
 */
export interface IOpenideCliChangesSession {
	readonly sessionId: string;
	readonly cliId: OpenideCliId;
	readonly title: string;
	readonly cwd: string;
	/** Everything the conversation touched, most recently changed first, one row per path. */
	readonly files: readonly IOpenideCliChangedFile[];
	/** What the conversation is doing right now. */
	readonly activity: OpenideCliActivity;
	/** A turn is running right now, so the list is not final. */
	readonly working: boolean;
	/** Boundaries came from the CLI's own hooks, so the list is exact rather than inferred. */
	readonly hooked: boolean;
	/** Some turn touched more paths than we keep, so the list is a prefix. */
	readonly truncated: boolean;
	/** How many exchanges this conversation has had, for the group's subtitle. */
	readonly turnCount: number;
}

export interface IOpenideCliTurnFinished {
	readonly sessionId: string;
	readonly cliId: OpenideCliId;
	readonly title: string;
	/** How many files that reply left changed. */
	readonly files: number;
	readonly failed: boolean;
}

/**
 * A file as it stood before this conversation touched it — what a diff compares against and what
 * a rollback restores.
 *
 * `exact` says whether the repo actually records that "before".
 *
 * It does whenever the file is in HEAD, and also when the session CREATED it — an empty baseline
 * is exactly right there. What the repo cannot answer for is a file that was already sitting in
 * the tree untracked when the conversation began: git has never seen it, so there is no earlier
 * version anywhere.
 *
 * For a file git has never seen, OpenIDE takes its OWN snapshot the first time the conversation
 * touches it. That is one write late — whatever the agent's FIRST edit changed is baked in and
 * will not appear — but every edit after it is exact, which is the difference between a useful
 * diff and a wall of green. It matters more than it sounds: in a repo that tracks almost nothing
 * (this fork commits ten files under `vscode/src`) HEAD is never available, and this is the only
 * baseline there is.
 *
 * `exact` says which of the two it is, and nothing pretends otherwise: an inexact baseline shows
 * a warning in the list and a different tooltip on undo.
 */
export interface IOpenideSessionBaseline {
	readonly content: string;
	/** The file existed at that point. False ⇒ the session created it, and rollback deletes it. */
	readonly existed: boolean;
	readonly exact: boolean;
}

/**
 * A file's change as the sidebar shows it inline: the SAME compact diff the transcript's edit
 * card carries (`buildDiffPreview`), so a change reads identically whether it is met in the chat
 * or in Agent Changes. Computed on demand from the session's baseline and the file on disk.
 */
export interface IOpenideCliChangePreview {
	readonly lines: readonly OpenideDiffLine[];
	readonly added: number;
	readonly removed: number;
	/** The session created the file: the diff is all additions and the row says `nuevo`. */
	readonly created: boolean;
}

interface ITracked {
	readonly log: OpenideCliTurnLog;
	readonly cliId: OpenideCliId;
	readonly cwd: string;
	title: string;
	status: OpenideCliSessionStatus;
	typing: boolean;
	hooked: boolean;
	/** Serialises git per session: two boundaries in a row must not race each other's snapshot. */
	queue: Promise<void>;
	/**
	 * Paths already dirty when the conversation began, captured once.
	 *
	 * It is the whole point of the distinction: a path missing from this set was clean, so HEAD
	 * is exactly what it looked like before the agent arrived.
	 *
	 * Resolves to `undefined` when git could not answer (timed out, output over the cap, not a
	 * repo). That is UNKNOWN, not "nothing was dirty": treating a failed status as an empty set
	 * filed every pre-existing untracked file as "the session created it", and the undo button
	 * then deleted files the agent had merely edited.
	 */
	readonly dirtyAtStart: Promise<ReadonlySet<string> | undefined>;
	/** Baseline per path, resolved once, the first time the session touches it. */
	readonly baselines: Map<string, IOpenideSessionBaseline>;
	/** In-flight baseline captures, so two events for one path do not both read it. */
	readonly capturing: Map<string, Promise<void>>;
}

/**
 * `git status` SCOPED to the paths the watcher reported, untracked included.
 *
 * Scoped and not whole-tree: a real repo answers the unscoped question with megabytes — 2.6 MB
 * and 27k records in this one — and running that on every turn boundary would be pure waste when
 * the question is about a handful of files. `--` separates the pathspec from anything git might
 * read as a revision.
 */
function statusArgs(paths: readonly string[]): string[] {
	// `--ignored=matching` only when scoped: it makes git NAME the touched paths the repo ignores
	// (`!!`), so a build's output is dropped instead of listed as untracked. On the whole tree it
	// would return every ignored file in the project — `.next/` alone is thousands — and blow
	// through the host's output cap, which reports as a failed status.
	return paths.length
		? ['status', '--porcelain', '-z', '--untracked-files=all', '--ignored=matching', '--', ...paths]
		: ['status', '--porcelain', '-z', '--untracked-files=all'];
}

/**
 * Scheme for the left-hand side of a CLI change's diff: the file as HEAD has it.
 *
 * Its own scheme and not the agent's `openide-diff`: that one holds the session baselines the
 * inline review keeps and marks pending on, and borrowing it would have this view quietly
 * mutating the state of a review the user is in the middle of.
 */
export const OPENIDE_CLI_CHANGES_SCHEME = 'openide-cli-changes';

export class OpenideCliChangesService extends Disposable {

	declare readonly _serviceBrand: undefined;

	private readonly host: IOpenideAgentHostService;
	private readonly tracked = new Map<string, ITracked>();
	/**
	 * Inline previews, keyed by session and path. A preview reads the file and diffs it, and the
	 * view repaints on every event, so without this each event would re-read every expanded
	 * file. Dropped wholesale whenever a session changes or a tracked file is written: the two
	 * moments a preview can go stale.
	 */
	private readonly previews = new Map<string, Promise<IOpenideCliChangePreview | undefined>>();

	private readonly _onDidChange = this._register(new Emitter<string>());
	/** A session's turns changed. Carries the session id. */
	readonly onDidChange: Event<string> = this._onDidChange.event;

	private readonly _onDidFinishTurn = this._register(new Emitter<IOpenideCliTurnFinished>());
	/**
	 * An agent finished a reply. The moment worth notifying about: a CLI runs unattended in a
	 * pane the user may not be looking at, and the whole reason to host it in the IDE is that the
	 * IDE can tell them it is done.
	 */
	readonly onDidFinishTurn: Event<IOpenideCliTurnFinished> = this._onDidFinishTurn.event;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ITextModelService textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
	) {
		super();
		this.host = ProxyChannel.toService<IOpenideAgentHostService>(mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL));
		this._register(textModelService.registerTextModelContentProvider(OPENIDE_CLI_CHANGES_SCHEME, this));
		this._register(fileService.onDidFilesChange(event => this.onFilesChanged(event)));
	}

	private fireChange(sessionId: string): void {
		this.previews.clear();
		this._onDidChange.fire(sessionId);
	}

	sessions(): readonly IOpenideCliChangesSession[] {
		return [...this.tracked].map(([sessionId, entry]) => ({
			sessionId,
			cliId: entry.cliId,
			title: entry.title,
			cwd: entry.cwd,
			files: entry.log.sessionFiles().map(file => ({ ...file, exact: entry.baselines.get(file.path)?.exact !== false })),
			activity: cliActivityOf(entry.status, entry.typing),
			working: entry.log.isOpen,
			hooked: entry.hooked,
			truncated: entry.log.all.some(turn => turn.truncated),
			turnCount: entry.log.all.length,
		}));
	}

	turnsOf(sessionId: string): readonly IOpenideCliTurn[] {
		return this.tracked.get(sessionId)?.log.all ?? [];
	}

	/** Drops a session's history — it was deleted, or the user cleared it. */
	forget(sessionId: string): void {
		if (this.tracked.delete(sessionId)) {
			this.fireChange(sessionId);
		}
	}

	/**
	 * The dock reporting a CLI's status. The only entry point: turn boundaries and the status dot
	 * read the SAME transition, so they can never disagree about whether the agent is working.
	 *
	 * `hooked` is the session's, not the event's: once a CLI has reported through its own hooks,
	 * every later boundary of that session is trustworthy even if this particular one came from
	 * the heuristic.
	 */
	noteStatus(session: { readonly id: string; readonly cliId: OpenideCliId; readonly cwd: string; readonly title: string }, status: OpenideCliSessionStatus, hooked: boolean): void {
		if (!session.cwd) {
			return; // nothing to run git in
		}
		let entry = this.tracked.get(session.id);
		if (!entry) {
			entry = {
				log: new OpenideCliTurnLog(session.id),
				cliId: session.cliId,
				cwd: session.cwd,
				title: session.title,
				// Seeded as the opposite of whatever arrives first, so the first report is a
				// boundary: a session adopted mid-turn still gets its first list.
				status: status === 'in-progress' ? 'needs-input' : 'in-progress',
				typing: false,
				hooked,
				queue: Promise.resolve(),
				baselines: new Map(),
				capturing: new Map(),
				// Kicked off when the session appears, NOT at the first turn boundary. The agent
				// can write before that boundary's queued git call returns, and a baseline
				// captured while this was still undefined got misfiled as "the session created
				// it" — which paints the whole file as new.
				dirtyAtStart: this.gitStatus(session.cwd, []).then(records => records && new Set(records.map(record => record.path))),
			};
			this.tracked.set(session.id, entry);
		}
		entry.title = session.title;
		entry.hooked ||= hooked;
		const boundary = turnBoundaryOf(entry.status, status);
		entry.status = status;
		if (!boundary) {
			return;
		}
		// Queued per session: `begin` must read the tree BEFORE `end` reads it again, and two
		// boundaries arriving close together would otherwise interleave their git calls and
		// attribute a turn's files to the wrong turn.
		entry.queue = entry.queue.then(() => this.applyBoundary(session.id, boundary)).catch(error => {
			this.logService.warn('[openide-changes] boundary failed', error);
		});
	}

	/** The user is typing into this session's TUI. */
	noteTyping(sessionId: string, typing: boolean): void {
		const entry = this.tracked.get(sessionId);
		if (!entry || entry.typing === typing) {
			return;
		}
		entry.typing = typing;
		this.fireChange(sessionId);
	}

	private async applyBoundary(sessionId: string, boundary: 'begin' | 'end'): Promise<void> {
		const entry = this.tracked.get(sessionId);
		if (!entry) {
			return;
		}
		// Opening needs no git at all: the turn starts empty and the watcher fills it. A failed
		// status at the close is passed through as such: the log then falls back to the watcher's
		// own verdicts rather than reporting a turn that changed nothing.
		const paths = boundary === 'end' ? entry.log.touchedPaths() : [];
		const [records, ignored] = paths.length ? await Promise.all([this.gitStatus(entry.cwd, paths), this.gitIgnored(entry.cwd, paths)]) : [[], undefined];
		if (boundary === 'begin') {
			entry.log.begin(Date.now(), entry.hooked);
		} else {
			const closed = entry.log.end(records, Date.now(), ignored);
			if (closed) {
				this._onDidFinishTurn.fire({
					sessionId,
					cliId: entry.cliId,
					title: entry.title,
					files: closed.files.length,
					failed: entry.status === 'failed',
				});
			}
		}
		this.fireChange(sessionId);
	}

	/**
	 * Opens a file's change for review in the editor.
	 *
	 * The "before" is the SESSION baseline, not HEAD. That is the whole difference between "this
	 * reply changed one line" and "this whole file is new": a file the conversation edited but did
	 * not create has a real before, and comparing against HEAD threw it away and painted the
	 * entire file green.
	 *
	 * A deleted file has no right side, so it opens as its baseline alone: a diff against nothing
	 * renders an empty pane and tells the reader less than the file they lost.
	 */
	async openDiff(sessionId: string, file: IOpenideTurnFile): Promise<void> {
		const entry = this.tracked.get(sessionId);
		if (!entry) {
			return;
		}
		if (file.status === 'deleted') {
			await this.editorService.openEditor({ resource: this.baselineUri(sessionId, file.path), options: { pinned: true } });
			return;
		}
		// The harness's own inline review — the file in the NORMAL editor with the blocks painted
		// and Undo/Keep — not the side-by-side diff editor: one way of reading a change, whether
		// the local agent or a hosted CLI made it. The session's baseline is what it compares
		// against; without one (the capture is still in flight, or never happened) the review
		// falls back to HEAD on its own.
		await entry.capturing.get(file.path);
		const baseline = entry.baselines.get(file.path);
		await this.agentService.reviewExternalChange(`${entry.cwd}/${file.path}`, baseline ? { content: baseline.content, existed: baseline.existed } : undefined);
	}

	/** The URI our content provider answers with the session's baseline for that path. */
	private baselineUri(sessionId: string, path: string): URI {
		return URI.from({ scheme: OPENIDE_CLI_CHANGES_SCHEME, path: `/${path}`, query: encodeURIComponent(sessionId) });
	}

	/** Serves the baseline side of a diff. Registered as a text model content provider. */
	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this.modelService.getModel(resource);
		if (existing) {
			return existing;
		}
		const sessionId = decodeURIComponent(resource.query);
		const path = resource.path.replace(/^\//, '');
		const entry = this.tracked.get(sessionId);
		const baseline = entry?.baselines.get(path);
		let content = baseline?.content ?? '';
		if (entry && baseline && !baseline.exact) {
			// Our snapshot landed after the only write there was, so it is identical to the file and
			// the diff would render completely empty — the user opens a file the agent just
			// rewrote and is shown no change at all. Falling back to an empty left side says "all
			// of this", which is at least true, instead of "nothing", which is not.
			try {
				const current = (await this.fileService.readFile(URI.file(`${entry.cwd}/${path}`))).value.toString();
				if (current === content) {
					content = '';
				}
			} catch {
				// Unreadable right now: the stored baseline is the best there is.
			}
		}
		// Language guessed from the URI path, so the left pane highlights like the right one; a
		// diff where one side is plain text reads as if half the file changed.
		return this.modelService.createModel(content, this.languageService.createByFilepathOrFirstLine(URI.file(path)), resource);
	}

	/** The baseline for a path, if the session has one. */
	baselineOf(sessionId: string, path: string): IOpenideSessionBaseline | undefined {
		return this.tracked.get(sessionId)?.baselines.get(path);
	}

	/**
	 * The inline diff of one changed file, as the view mounts it under the row.
	 *
	 * `undefined` when there is nothing to compare against — the session is gone, or the file
	 * cannot be read right now. The row then keeps its status letter and says so, instead of
	 * showing an empty block that reads as "no change".
	 */
	preview(sessionId: string, file: IOpenideTurnFile): Promise<IOpenideCliChangePreview | undefined> {
		const key = `${sessionId}\0${file.path}`;
		let pending = this.previews.get(key);
		if (!pending) {
			pending = this.computePreview(sessionId, file).catch(error => {
				this.logService.warn('[openide-changes] preview failed', error);
				return undefined;
			});
			this.previews.set(key, pending);
		}
		return pending;
	}

	private async computePreview(sessionId: string, file: IOpenideTurnFile): Promise<IOpenideCliChangePreview | undefined> {
		const entry = this.tracked.get(sessionId);
		if (!entry) {
			return undefined;
		}
		// The baseline capture is fire-and-forget off the watcher; a preview asked for in the same
		// tick would otherwise diff against nothing and paint the whole file green.
		await entry.capturing.get(file.path);
		const baseline = entry.baselines.get(file.path);
		let before = baseline?.content ?? '';
		let after = '';
		if (file.status !== 'deleted') {
			try {
				after = (await this.fileService.readFile(URI.file(`${entry.cwd}/${file.path}`))).value.toString();
			} catch {
				return undefined;
			}
		}
		if (baseline && !baseline.exact && before === after) {
			// Same call as `provideTextContent`: our own snapshot landed after the only write there
			// was, so "all of this" is at least true where "nothing changed" is not.
			before = '';
		}
		const counts = countDiff(before, after);
		// The sidebar has no 120-line cap to honour — that one keeps a persisted transcript small.
		// Still bounded: a generated file of thousands of lines is scrolled in the editor, not here.
		return { lines: buildDiffPreview(before, after, 400), added: counts.added, removed: counts.removed, created: baseline ? !baseline.existed : false };
	}

	/** Every session that has a baseline for this absolute file path, newest first. */
	sessionsTouching(resource: URI): { readonly sessionId: string; readonly path: string; readonly baseline: IOpenideSessionBaseline }[] {
		const hits: { sessionId: string; path: string; baseline: IOpenideSessionBaseline }[] = [];
		for (const [sessionId, entry] of this.tracked) {
			const path = this.relativeTo(entry.cwd, resource);
			const baseline = path ? entry.baselines.get(path) : undefined;
			if (path && baseline) {
				hits.push({ sessionId, path, baseline });
			}
		}
		return hits.reverse();
	}

	/**
	 * Puts a file back the way it was before this conversation touched it.
	 *
	 * A baseline that did not exist means the session created the file, so restoring it means
	 * DELETING it — writing an empty file instead would leave a lie on disk that looks like work.
	 */
	async rollback(sessionId: string, path: string): Promise<boolean> {
		const entry = this.tracked.get(sessionId);
		const baseline = entry?.baselines.get(path);
		if (!entry || !baseline) {
			return false;
		}
		// Never restore an EMPTY baseline over a file that existed: that deletes something the
		// session did not create, and it would look like the undo worked. Refused at the source as
		// well as in the UI, because a guard that only lives in a button is one keybinding away
		// from being bypassed. An inexact baseline WITH content is allowed — it undoes all but the
		// agent's first edit, and the button says so.
		if (!baseline.existed && !baseline.exact) {
			return false;
		}
		const resource = URI.file(`${entry.cwd}/${path}`);
		try {
			if (baseline.existed) {
				await this.fileService.writeFile(resource, VSBuffer.fromString(baseline.content));
			} else {
				await this.fileService.del(resource);
			}
			return true;
		} catch (error) {
			this.logService.warn('[openide-changes] rollback failed', error);
			return false;
		}
	}

	/**
	 * Resolves a path's baseline the first time the session sees it.
	 *
	 * Fire-and-forget on purpose: it runs off a watcher event, and making the watcher await a git
	 * call would let a burst of writes queue up behind the disk.
	 */
	private captureBaseline(sessionId: string, path: string): void {
		const entry = this.tracked.get(sessionId);
		if (!entry || entry.baselines.has(path) || entry.capturing.has(path)) {
			return;
		}
		// Already sitting in the tree, untracked, when the conversation began ⇒ nothing anywhere
		// records what it looked like. Anything else HEAD can answer, or the session created it.
		const resource = URI.file(`${entry.cwd}/${path}`);
		// Read FIRST, before awaiting anything. This is the snapshot's whole value: every
		// millisecond spent on a git round-trip first is another write the agent can land, and the
		// snapshot was coming back equal to the file — which rendered an empty diff.
		const snapshot = this.fileService.readFile(resource).then(file => file.value.toString(), () => undefined);
		const head = this.host.runGit(entry.cwd, ['show', `HEAD:${path}`, '--']).catch(() => undefined);
		const work = (async () => {
			// `--` separates the pathspec from anything git might read as a revision, so a file
			// called `HEAD` cannot change what is being asked for.
			const fromHead = await head;
			if (fromHead?.ok) {
				entry.baselines.set(path, { content: fromHead.stdout, existed: true, exact: true });
				return;
			}
			const dirtyAtStart = await entry.dirtyAtStart;
			if (dirtyAtStart && !dirtyAtStart.has(path)) {
				// Not in HEAD and not in the tree when the conversation began: the session made it,
				// so an empty baseline is exactly right.
				entry.baselines.set(path, { content: '', existed: false, exact: true });
				return;
			}
			// Either git has no record of it, or git could not say what the tree looked like when
			// the conversation began. In both cases our own snapshot is the only "before" there
			// is, and it is marked inexact: the undo restores it instead of deleting the file,
			// because "the session created this" is not something we can claim.
			const content = await snapshot;
			entry.baselines.set(path, content !== undefined
				? { content, existed: true, exact: false }
				: { content: '', existed: false, exact: false });
		})().finally(() => entry.capturing.delete(path));
		entry.capturing.set(path, work);
	}

	/**
	 * The touched paths the repo ignores, by `git check-ignore`. It answers for a path that no
	 * longer exists too, which `status` never does — and a rebuilt `.next/` is mostly deletions.
	 * Exit code 1 means "none of these", so a failed call and an empty answer both come back as
	 * an empty set: an ignored path shown is a nuisance, a real change hidden would be a lie.
	 */
	private async gitIgnored(cwd: string, paths: readonly string[]): Promise<ReadonlySet<string>> {
		const ignored = new Set<string>();
		for (const batch of pathspecBatches(paths)) {
			// `-z` needs `--stdin`, which the host does not offer; `core.quotePath=false` keeps a path
			// with a non-ASCII byte from coming back escaped and never matching the one asked about.
			const result = await this.host.runGit(cwd, ['-c', 'core.quotePath=false', 'check-ignore', '--no-index', '--', ...batch]).catch(() => undefined);
			if (!result?.ok) {
				continue;
			}
			for (const path of result.stdout.split('\n')) {
				if (path) {
					ignored.add(path);
				}
			}
		}
		return ignored;
	}

	/**
	 * Status for a bounded set of paths. An empty answer is a real answer — every path ended the
	 * turn matching HEAD — and a failure is `undefined`, so the two never look the same to a caller.
	 */
	private async gitStatus(cwd: string, paths: readonly string[]): Promise<IPorcelainRecord[] | undefined> {
		// In batches: the host caps a git call at 64 argv entries, and one call per touched path
		// would be as wrong the other way. All-or-nothing across the batches, for the same reason
		// a truncated status is refused — half a list reads as the whole list.
		const batches = paths.length ? pathspecBatches(paths) : [[]];
		const records: IPorcelainRecord[] = [];
		for (const batch of batches) {
			const result = await this.host.runGit(cwd, statusArgs(batch)).catch(() => undefined);
			if (!result?.ok) {
				this.logService.warn(`[openide-changes] git status failed in ${cwd} (${paths.length} path(s), batch of ${batch.length}); the tree state is unknown`);
				return undefined;
			}
			records.push(...parsePorcelainZ(result.stdout));
		}
		return records;
	}


	/**
	 * The workspace watcher reporting a write. Routed to every session with an OPEN turn: two
	 * agents working at once both did something in that window, and deciding which one on
	 * timing alone would be a guess presented as a fact.
	 */
	noteFileChange(path: string, kind: OpenideTouchKind): void {
		for (const entry of this.tracked.values()) {
			entry.log.touch(path, kind);
		}
	}

	private onFilesChanged(event: FileChangesEvent): void {
		// Nothing is open ⇒ this is the user's own work between turns, and the whole point is not
		// to claim it for an agent.
		if (![...this.tracked.values()].some(entry => entry.log.isOpen)) {
			return;
		}
		const batches: readonly [readonly URI[], OpenideTouchKind][] = [
			[event.rawAdded, 'added'],
			[event.rawUpdated, 'updated'],
			[event.rawDeleted, 'deleted'],
		];
		for (const [resources, kind] of batches) {
			for (const resource of resources) {
				if (resource.scheme !== Schemas.file) {
					continue;
				}
				for (const [sessionId, entry] of this.tracked) {
					// Only a session with an OPEN turn is working: a baseline captured for an idle one
					// would credit it with a file it never touched, and the undo control would then
					// name the wrong conversation.
					if (!entry.log.isOpen) {
						continue;
					}
					const relative = this.relativeTo(entry.cwd, resource);
					if (relative) {
						entry.log.touch(relative, kind);
						this.captureBaseline(sessionId, relative);
						// The file just changed under an expanded row: its preview is stale now,
						// not at the next turn boundary.
						this.previews.delete(`${sessionId}\0${relative}`);
					}
				}
			}
		}
	}

	/**
	 * The path as git will name it: relative to the session's cwd, `/` separated.
	 *
	 * A file outside that cwd belongs to another repo, and asking git about it either errors or —
	 * worse — silently answers about a path that happens to match inside this one.
	 */
	private relativeTo(cwd: string, resource: URI): string | undefined {
		const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
		const path = resource.fsPath;
		if (!path.startsWith(base)) {
			return undefined;
		}
		const relative = path.slice(base.length);
		// Our own index and the git directory churn constantly and are nobody's change to review.
		return relative && !relative.startsWith('.git/') && !relative.startsWith('.openide/memory-indexes/') ? relative : undefined;
	}
}
