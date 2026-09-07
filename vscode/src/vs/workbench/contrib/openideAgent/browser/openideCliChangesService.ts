/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Observes filesystem changes during hosted CLI turns. Watchers and hooks establish time
 * windows, not authorship. Pre-execution snapshots support explicit selected restoration;
 * late captures remain review-only. Restore validates the current state through the same
 * engine used by native message change sets.
 */

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { FileChangesEvent, FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { OpenideCliId, OpenideCliSessionStatus } from '../common/openideAgentCliCatalog.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { IOpenideAgentRunStateService } from '../common/openideAgentRunState.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { createOpenideRestoreSafety, OpenideRestoreEngine } from './openideRestoreEngine.js';
import { createFileChange } from '../common/openideMessageChanges.js';
import { resolvePathInsideWorkspace } from '../common/openideWorkspacePath.js';
import { extUriBiasedIgnorePathCase, joinPath } from '../../../../base/common/resources.js';
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
	/** An exact earlier snapshot exists; restore still validates the after state and active writers. */
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
 * Turns remain the observation windows. Attribution to a particular writer is unknown.
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
	/** Boundary evidence came from hooks. This does not establish who wrote a file. */
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

/** Snapshot evidence is independent of turn-boundary confidence and writer attribution. */
export interface IOpenideSessionBaseline {
	readonly content: string;
	readonly existed: boolean;
	readonly exact: boolean;
	readonly provenance?: 'pre-execution' | 'pinned-git' | 'observed-late' | 'turn-end';
	readonly capturedAt?: number;
	readonly etag?: string;
	readonly mtime?: number;
}

export interface IOpenideCliRestoreResult {
	readonly status: 'restored' | 'conflict' | 'unavailable' | 'failed';
	readonly reason?: string;
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
	readonly baseCommit: Promise<string | undefined>;
	prepared: boolean;
	gitBytePreserving: boolean;
	existingAtStart?: ReadonlySet<string>;
	preparing?: Promise<void>;
	exited: boolean;
	readonly after: Map<string, IOpenideSessionBaseline>;
	readonly restored: Set<string>;
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
 * Scheme for the left-hand side of a CLI change's diff: its captured session baseline.
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
		@IOpenideNativeServices nativeServices: IOpenideNativeServices,
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ITextModelService textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IOpenideAgentRunStateService private readonly runState: IOpenideAgentRunStateService,
	) {
		super();
		this.host = nativeServices.host;
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
			files: entry.log.sessionFiles().map(file => ({ ...file, exact: entry.baselines.get(file.path)?.exact === true })),
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
	 * this records boundary evidence only. Restoration still waits for the process to exit.
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
				baseCommit: this.host.runGit(session.cwd, ['rev-parse', '--verify', 'HEAD']).then(result => result.ok && /^[a-f0-9]{40,64}$/.test(result.stdout.trim()) ? result.stdout.trim() : undefined, () => undefined),
				prepared: false,
				gitBytePreserving: false,
				exited: false,
				after: new Map(),
				restored: new Set(),
				// Kicked off when the session appears, NOT at the first turn boundary. The agent
				// can write before that boundary's queued git call returns, and a baseline
				// captured while this was still undefined got misfiled as "the session created
				// it" — which paints the whole file as new.
				dirtyAtStart: this.gitStatus(session.cwd, []).then(records => records && new Set(records.flatMap(record => [record.path, ...(record.from ? [record.from] : [])]))),
			};
			this.tracked.set(session.id, entry);
		}
		if (!entry.exited) { this.runState.activeCliSessions.add(session.id); }
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

	/** Awaited before launching the PTY. A bounded budget keeps large dirty trees usable. */
	async prepareSession(session: { readonly id: string; readonly cliId: OpenideCliId; readonly cwd: string; readonly title: string }): Promise<void> {
		this.noteStatus(session, 'needs-input', false);
		const entry = this.tracked.get(session.id);
		if (!entry) { return; }
		entry.exited = false;
		this.runState.activeCliSessions.add(session.id);
		entry.preparing ??= (async () => {
			const dirty = await entry.dirtyAtStart;
			await entry.baseCommit;
			const conversions = await Promise.all([
				this.host.runGit(entry.cwd, ['config', '--get', '--default', 'false', 'core.autocrlf']),
				this.host.runGit(entry.cwd, ['config', '--get', '--default', 'native', 'core.eol']),
				this.host.runGit(entry.cwd, ['config', '--get', '--default', '', 'core.attributesfile']),
			]).catch(() => undefined);
			entry.gitBytePreserving = !!conversions?.every(result => result.ok)
				&& conversions[0].stdout.trim() === 'false' && conversions[1].stdout.trim() === 'native' && !conversions[2].stdout.trim()
				&& !!dirty && ![...dirty].some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'));
			// Include ignored paths before inferring absence: status alone omits existing files.
			const inventory = await Promise.all([
				this.host.runGit(entry.cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
				this.host.runGit(entry.cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']),
			]).catch(() => undefined);
			if (inventory?.every(result => result.ok)) { entry.existingAtStart = new Set(inventory.flatMap(result => result.stdout.split('\0').filter(Boolean))); }
			let remaining = 8 * 1024 * 1024;
			let count = 0;
			if (dirty) {
				for (const path of dirty) {
					if (++count > 128 || remaining <= 0) { break; }
					const snapshot = await this.readSnapshot(entry, path, 'pre-execution');
					if (snapshot) { entry.baselines.set(path, snapshot); remaining -= VSBuffer.fromString(snapshot.content).byteLength; }
				}
			}
			entry.prepared = true;
		})();
		await entry.preparing;
	}

	/** Process exit is stronger evidence of inactivity than output silence. */
	noteExited(sessionId: string): void {
		this.runState.activeCliSessions.delete(sessionId);
		const entry = this.tracked.get(sessionId);
		if (entry) { entry.exited = true; }
	}

	private resource(entry: ITracked, path: string): URI | undefined {
		if (path.trim() !== path || path.includes('\0')) { return undefined; }
		const cwd = URI.file(entry.cwd);
		const resource = resolvePathInsideWorkspace(path, [cwd]);
		return resource && resolvePathInsideWorkspace(resource.fsPath, this.contextService.getWorkspace().folders.map(folder => folder.uri)) ? resource : undefined;
	}

	private async readSnapshot(entry: ITracked, path: string, provenance: IOpenideSessionBaseline['provenance']): Promise<IOpenideSessionBaseline | undefined> {
		const resource = this.resource(entry, path);
		if (!resource || this.workingCopyService.isDirty(resource)) { return undefined; }
		try {
			const stat = await this.fileService.stat(resource);
			if (!stat.isFile || stat.isSymbolicLink || stat.size > 256 * 1024) { return undefined; }
			const file = await this.fileService.readFile(resource, { limits: { size: 256 * 1024 } });
			const content = file.value.toString();
			if (content.includes('\0') || !VSBuffer.fromString(content).equals(file.value)) { return undefined; }
			return { content, existed: true, exact: provenance !== 'observed-late', provenance, capturedAt: Date.now(), etag: file.etag, mtime: file.mtime };
		} catch (error) {
			return toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND
				? { content: '', existed: false, exact: provenance !== 'observed-late', provenance, capturedAt: Date.now() }
				: undefined;
		}
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
			entry.after.clear();
			entry.restored.clear();
			entry.log.begin(Date.now(), entry.hooked);
		} else {
			const closed = entry.log.end(records, Date.now(), ignored);
			if (closed) {
				for (const path of paths) {
					await entry.capturing.get(path);
					const snapshot = await this.readSnapshot(entry, path, 'turn-end');
					if (snapshot) { entry.after.set(path, snapshot); }
				}
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
		await entry.capturing.get(file.path);
		await this.editorService.openEditor({ original: { resource: this.baselineUri(sessionId, file.path) }, modified: { resource: joinPath(URI.file(entry.cwd), file.path) }, options: { pinned: true } });
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
		const content = baseline?.content ?? '';

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
		const before = baseline?.content ?? '';
		let after = '';
		if (file.status !== 'deleted') {
			try {
				after = (await this.fileService.readFile(URI.file(`${entry.cwd}/${file.path}`))).value.toString();
			} catch {
				return undefined;
			}
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
			if (path && baseline && entry.log.sessionFiles().some(file => file.path === path)) {
				hits.push({ sessionId, path, baseline });
			}
		}
		return hits.reverse();
	}

	/** Restores an explicitly selected observed snapshot after validating exact evidence. */
	async rollback(sessionId: string, path: string, selectedSnapshot = false): Promise<IOpenideCliRestoreResult> {
		const entry = this.tracked.get(sessionId);
		if (!entry) { return { status: 'unavailable', reason: 'The session snapshot is no longer available.' }; }
		await entry.queue;
		const baseline = entry.baselines.get(path);
		const after = entry.after.get(path);
		if (!baseline?.exact || !after?.exact) { return { status: 'unavailable', reason: 'Exact before and after snapshots are required.' }; }
		if (entry.restored.has(path)) { return { status: 'unavailable', reason: 'This snapshot has already been restored.' }; }
		// A watcher cannot distinguish a CLI write from a user or another agent's write.
		if (!selectedSnapshot) { return { status: 'conflict', reason: 'These are observed changes. Select snapshot restoration explicitly after reviewing the comparison.' }; }
		const resource = this.resource(entry, path);
		if (!resource) { return { status: 'conflict', reason: 'Path outside the workspace.' }; }
		const active = () => this.runState.hasActiveRuns() || [...this.tracked.values()].some(other => this.relativeTo(other.cwd, resource) && !other.exited);
		if (active()) { return { status: 'conflict', reason: 'An agent may still be writing. Stop the CLI process or wait for the native run to finish.' }; }
		const safety = createOpenideRestoreSafety(this.fileService, this.workingCopyService, this.host);
		const engine = new OpenideRestoreEngine(this.fileService, this.contextService, {
			...safety,
			validateResource: async uri => {
				if (active()) { return 'An agent may still be writing. Stop the CLI process or wait for the native run to finish.'; }
				const reason = await safety.validateResource?.(uri);
				if (reason) { return reason; }
				const current = await this.readSnapshot(entry, path, 'pre-execution');
				return !current || current.existed !== after.existed || current.content !== after.content || (after.etag && current.etag !== after.etag) || (after.mtime && current.mtime !== after.mtime)
					? 'The file changed after the snapshot. Review the current comparison.' : undefined;
			},
		});
		try {
			const operation = !baseline.existed ? 'create' : !after.existed ? 'delete' : 'modify';
			const change = createFileChange(resource.fsPath, operation, baseline.existed ? baseline.content : undefined, after.existed ? after.content : undefined);
			const result = await engine.rollback({ messageId: sessionId, timestamp: Date.now(), state: 'finalized', files: [change] });
			if (result.status === 'reverted') { entry.restored.add(path); this.fireChange(sessionId); return { status: 'restored' }; }
			return { status: result.status === 'unavailable' ? 'unavailable' : 'conflict', reason: result.files.find(file => file.reason)?.reason };
		} catch (error) {
			this.logService.warn('[openide-changes] restore failed', error);
			return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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
		if (!entry || entry.baselines.has(path) || entry.capturing.has(path)) { return; }
		const work = (async () => {
			const [base, dirty] = await Promise.all([entry.baseCommit, entry.dirtyAtStart]);
			if (entry.prepared && entry.existingAtStart && !entry.existingAtStart.has(path)) {
				entry.baselines.set(path, { content: '', existed: false, exact: true, provenance: 'pre-execution', capturedAt: Date.now() }); return;
			}
			if (entry.prepared && dirty && !dirty.has(path) && base) {
				const mode = await this.host.runGit(entry.cwd, ['ls-tree', '-z', base, '--', path]).catch(() => undefined);
				if (mode?.ok && /^(100644|100755) blob /.test(mode.stdout)) {
					const head = await this.host.runGit(entry.cwd, ['show', `${base}:./${path}`, '--']).catch(() => undefined);
					if (head?.ok && head.stdout.length <= 256 * 1024 && !/[\0\ufffd]/.test(head.stdout)) {
						const attributes = await Promise.all([
							this.host.runGit(entry.cwd, ['check-attr', '-z', '--all', '--', path]),
							this.host.runGit(entry.cwd, ['check-attr', `--source=${base}`, '-z', '--all', '--', path]),
						]).catch(() => undefined);
						const conversionAttributes = new Set(['text', 'eol', 'filter', 'working-tree-encoding', 'ident']);
						const unconverted = attributes?.every(result => {
							if (!result.ok) { return false; }
							const fields = result.stdout.split('\0');
							for (let index = 0; index + 2 < fields.length; index += 3) {
								if (conversionAttributes.has(fields[index + 1]) && !['unset', 'unspecified', 'false'].includes(fields[index + 2])) { return false; }
							}
							return true;
						});
						entry.baselines.set(path, { content: head.stdout, existed: true, exact: entry.gitBytePreserving && !!unconverted, provenance: 'pinned-git', capturedAt: Date.now() }); return;
					}
				}
			}
			const snapshot = await this.readSnapshot(entry, path, 'observed-late');
			entry.baselines.set(path, snapshot ?? { content: '', existed: false, exact: false, provenance: 'observed-late' });
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
		for (const [sessionId, entry] of this.tracked) {
			entry.log.touch(path, kind);
			if (entry.log.isOpen) { this.captureBaseline(sessionId, path); }
		}
	}

	private onFilesChanged(event: FileChangesEvent): void {
		// Nothing is open ⇒ this is the user's own work between turns, and the whole point is not
		// to claim it for an agent.
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
					const changedPath = this.relativeTo(entry.cwd, resource);
					if (changedPath) { this.previews.delete(`${sessionId}\0${changedPath}`); }
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
		const root = URI.file(cwd);
		if (!extUriBiasedIgnorePathCase.isEqualOrParent(resource, root)) { return undefined; }
		const relative = extUriBiasedIgnorePathCase.relativePath(root, resource);
		// Our own index and the git directory churn constantly and are nobody's change to review.
		return relative && !relative.startsWith('.git/') && !relative.startsWith('.openide/memory-indexes/') ? relative : undefined;
	}
}
