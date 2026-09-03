/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { OpenideCliSessionEvent } from '../common/openideAgentCliCatalog.js';

/**
 * Reads Claude Code's state through its own hooks, the way Orca does (`hook-settings.ts` +
 * `hook-service.ts`) instead of guessing from terminal output: the CLI runs a command on
 * UserPromptSubmit / PreToolUse / Stop / Notification and pipes a JSON payload
 * (`session_id`, `cwd`, `hook_event_name`, …) to its stdin.
 *
 * Orca receives that payload over a local HTTP port. OpenIDE has no listener process it can
 * count on from the renderer, so the hook command drops the payload as a file under
 * `~/.openide/agent-hooks/claude/` and the file service's watcher picks it up — the same
 * mechanism, one fewer moving part. Files are deleted once read.
 *
 * The hook runs for EVERY Claude Code process on the machine — `~/.claude/settings.json` is
 * global — so it has to know when it is not ours. `OPENIDE_SESSION_ID`, which the dock puts in
 * the PTY's environment, is that signal: without it the hook drains stdin and exits, and with it
 * the id travels in the drop file, so a payload is matched to its conversation by id rather than
 * by guessing from `cwd` (which follows the agent's own `cd`). Before this guard, a week of
 * terminal sessions left thousands of payloads — full tool inputs included — waiting for the next
 * IDE start to replay them into whichever session shared a directory.
 *
 * Installation is idempotent: a hook is recognised by the `.openide/agent-hooks` marker in its
 * command, other hooks in the user's settings are left untouched, and nothing is written when
 * everything is already there. A marker hook whose command is out of date is REPLACED, which is
 * how an installed user gets the guard and the events added since.
 */

export interface IOpenideClaudeHookPayload {
	/** Claude's own session id — what `--resume` takes. */
	readonly sessionId: string;
	readonly cwd: string;
	readonly event: OpenideCliSessionEvent;
	/** The dock session that hosts this CLI, as the launch environment stamped it. */
	readonly openideSessionId: string;
}

const HOOK_DIR = ['.openide', 'agent-hooks', 'claude'];
const MARKER = '.openide/agent-hooks/claude';
/**
 * Present only in the current hook command. An installed marker hook without it is an older
 * revision (no session guard, no StopFailure) and gets rewritten.
 */
const SENTINEL = 'openideSessionId';
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'Notification'] as const;
const POLL_MS = 2000;
/** A drop that cannot be parsed after this long is not half-written, it is garbage. */
const UNPARSABLE_GRACE_MS = 10_000;
/** Deletes in flight at once while clearing a backlog. Bounded so the file service stays usable. */
const DISCARD_BATCH = 64;

function hookCommand(): string {
	// Outside a hosted session the hook still has to DRAIN stdin: a hook that exits without
	// reading is a broken pipe for the CLI writing to it. The drop is wrapped in an envelope that
	// carries the dock session id, written to a `.tmp` and renamed, so the watcher never reads a
	// half-written `.json`. `$$` and the nanosecond clock keep concurrent hooks apart.
	// The name is computed ONCE into `f`: the clock read inline twice would name the `.tmp` and
	// the `mv` target differently, and the rename would fail for every drop.
	const dir = `$HOME/${MARKER}`;
	return `if [ -z "$OPENIDE_SESSION_ID" ]; then cat >/dev/null; exit 0; fi; mkdir -p "${dir}" && f="${dir}/$(date +%s%N)-$$.json" && { printf '{"${SENTINEL}":"%s","payload":' "$OPENIDE_SESSION_ID"; cat; printf '}'; } > "$f.tmp" && mv "$f.tmp" "$f"`;
}

function isOpenideHook(hook: unknown): boolean {
	return !!hook && typeof hook === 'object' && String((hook as { command?: unknown }).command ?? '').includes(MARKER);
}

function isCurrentOpenideHook(hook: unknown): boolean {
	return isOpenideHook(hook) && String((hook as { command: unknown }).command).includes(SENTINEL);
}

function hookListOf(group: unknown): unknown[] {
	return (group && typeof group === 'object' && Array.isArray((group as { hooks?: unknown[] }).hooks)) ? (group as { hooks: unknown[] }).hooks : [];
}

/**
 * Every hook of ours removed from one event's groups, leaving the user's own untouched. A group
 * left with no hooks goes too, rather than staying as an empty shell Claude would still walk.
 */
function withoutOpenideHooks(groups: readonly unknown[]): unknown[] {
	return groups
		.map(group => {
			const list = hookListOf(group);
			if (!list.some(isOpenideHook)) {
				return group;
			}
			const rest = list.filter(hook => !isOpenideHook(hook));
			return rest.length ? { ...(group as Record<string, unknown>), hooks: rest } : undefined;
		})
		.filter((group): group is unknown => group !== undefined);
}

/** Pure: the settings.json object with OpenIDE's hooks merged in, or `undefined` if unchanged. */
export function mergeOpenideClaudeHooks(settings: Record<string, unknown>): Record<string, unknown> | undefined {
	const command = hookCommand();
	const hooks = (settings['hooks'] && typeof settings['hooks'] === 'object' && !Array.isArray(settings['hooks'])) ? { ...(settings['hooks'] as Record<string, unknown>) } : {};
	let changed = false;
	for (const eventName of EVENTS) {
		const existing = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as unknown[])] : [];
		if (existing.some(group => hookListOf(group).some(isCurrentOpenideHook))) {
			continue;
		}
		// Ours but stale: drop it, keeping whatever else the user had in the same group.
		const kept = withoutOpenideHooks(existing);
		const group: Record<string, unknown> = { hooks: [{ type: 'command', command }] };
		if (eventName === 'PreToolUse') {
			group['matcher'] = '*';
		}
		kept.push(group);
		hooks[eventName] = kept;
		changed = true;
	}
	// A hook of ours on an event we no longer register — an older OpenIDE listened to more of
	// them — is not inert: it keeps dropping a payload per event for EVERY Claude on the machine,
	// which is the pile this guard exists to stop. Nothing reads those drops any more (they carry
	// no envelope), so the entry is removed outright.
	for (const eventName of Object.keys(hooks)) {
		if ((EVENTS as readonly string[]).includes(eventName) || !Array.isArray(hooks[eventName])) {
			continue;
		}
		const groups = hooks[eventName] as unknown[];
		if (!groups.some(group => hookListOf(group).some(isOpenideHook))) {
			continue;
		}
		const kept = withoutOpenideHooks(groups);
		// An event left with nothing at all loses its key: an empty array is noise in a file the
		// user reads and edits by hand.
		if (kept.length) {
			hooks[eventName] = kept;
		} else {
			delete hooks[eventName];
		}
		changed = true;
	}
	return changed ? { ...settings, hooks } : undefined;
}

/** Turns a hook payload into the reducer's event. Unknown events are ignored. */
export function claudeHookEventOf(payload: Record<string, unknown>): OpenideCliSessionEvent | undefined {
	switch (payload['hook_event_name']) {
		case 'UserPromptSubmit':
			return { type: 'hook:prompt' };
		case 'PreToolUse':
			return { type: 'hook:tool' };
		case 'Stop':
			return { type: 'hook:stop' };
		case 'StopFailure':
			// The turn died (API error, cut-off). Without this the session stayed `in-progress`
			// forever: once hooked, the output heuristic no longer moves it, so nothing else could.
			return { type: 'hook:stop', failed: true };
		case 'Notification':
			return { type: 'hook:notification' };
		default:
			return undefined;
	}
}

/**
 * Pure: one drop file's text as the payload the dock acts on, or `undefined` when it is not for
 * us. Throws on malformed JSON so the caller can tell "half-written" from "not ours".
 *
 * Not ours: no envelope (a hook older than the guard, or somebody else's file) or an event the
 * reducer does not know. Both are dropped without a match attempt — the whole point is that a
 * payload never reaches a session it cannot prove it belongs to.
 */
export function parseClaudeHookDrop(text: string): IOpenideClaudeHookPayload | undefined {
	const envelope = JSON.parse(text) as Record<string, unknown>;
	const openideSessionId = typeof envelope[SENTINEL] === 'string' ? envelope[SENTINEL] as string : '';
	const payload = envelope['payload'];
	if (!openideSessionId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;
	const event = claudeHookEventOf(record);
	const sessionId = typeof record['session_id'] === 'string' ? record['session_id'] : '';
	const cwd = typeof record['cwd'] === 'string' ? record['cwd'] : '';
	return event && sessionId ? { sessionId, cwd, event, openideSessionId } : undefined;
}

export class OpenideClaudeHooks extends Disposable {

	private readonly _onDidReceive = this._register(new Emitter<IOpenideClaudeHookPayload>());
	readonly onDidReceive: Event<IOpenideClaudeHookPayload> = this._onDidReceive.event;

	private readonly _onDidInstall = this._register(new Emitter<void>());
	/** Fired the one time the hooks are actually written to the user's settings. */
	readonly onDidInstall: Event<void> = this._onDidInstall.event;

	private _installed: Promise<boolean> | undefined;
	private _watching = false;
	private readonly _seen = new Set<string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
	) {
		super();
	}

	private get home(): URI {
		return this.pathService.userHome({ preferLocal: true });
	}

	private get dropDir(): URI {
		return URI.joinPath(this.home, ...HOOK_DIR);
	}

	/**
	 * Registers the hooks in `~/.claude/settings.json` (once) and starts watching the drop
	 * directory. Returns whether hooks are in place — `false` means the heuristic is all there is.
	 */
	ensure(): Promise<boolean> {
		if (!this._installed) {
			this._installed = this._install().catch(() => false);
		}
		void this._watch();
		return this._installed;
	}

	private async _install(): Promise<boolean> {
		const settingsUri = URI.joinPath(this.home, '.claude', 'settings.json');
		let settings: Record<string, unknown> = {};
		try {
			const content = await this.fileService.readFile(settingsUri);
			const parsed = JSON.parse(content.value.toString());
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				settings = parsed;
			}
		} catch {
			// missing or unreadable: start from an empty object, Claude accepts it
		}
		const merged = mergeOpenideClaudeHooks(settings);
		if (!merged) {
			return true;
		}
		await this.fileService.createFolder(URI.joinPath(this.home, '.claude'));
		await this.fileService.writeFile(settingsUri, VSBuffer.fromString(JSON.stringify(merged, null, 2) + '\n'));
		this._onDidInstall.fire();
		return true;
	}

	/**
	 * The drop directory is read two ways: the file watcher when it delivers, and a 2 s poll
	 * while the watch is armed — the non-recursive watcher on a directory under the user's home
	 * proved unreliable in practice (files piled up unread), and a hook that lands 2 s late is
	 * still a hook, while a hook that never lands leaves the session on the heuristic.
	 *
	 * Whatever was already there when the watch started is discarded unread: it was written for
	 * a PTY of a previous window, and every one of those is dead. Replaying it would flip live
	 * sessions through states that happened days ago.
	 */
	private async _watch(): Promise<void> {
		if (this._watching) {
			return;
		}
		this._watching = true;
		const startedAt = Date.now();
		const dir = this.dropDir;
		await this.fileService.createFolder(dir).catch(() => undefined);
		this._register(this.fileService.watch(dir));
		this._register(this.fileService.onDidFilesChange(event => {
			for (const added of event.rawAdded) {
				if (added.path.startsWith(dir.path + '/') && added.path.endsWith('.json')) {
					void this._consume(added);
				}
			}
			// Some watchers report a fresh file as UPDATED rather than ADDED.
			for (const updated of event.rawUpdated) {
				if (updated.path.startsWith(dir.path + '/') && updated.path.endsWith('.json') && event.contains(updated, FileChangeType.UPDATED)) {
					void this._consume(updated);
				}
			}
		}));
		// Only the first sweep needs mtimes, and only it can face a pile: once the guard is
		// installed the directory holds a handful of files at a time. Asking for metadata on
		// every poll would stat every child twice a second for nothing.
		const sweep = async (discardBefore: number): Promise<void> => {
			const existing = await this.fileService.resolve(dir, { resolveMetadata: discardBefore > 0 }).catch(() => undefined);
			const drops = (existing?.children ?? []).filter(child => child.isFile && child.name.endsWith('.json'));
			const stale = discardBefore > 0 ? drops.filter(child => (child.mtime ?? 0) < discardBefore) : [];
			const fresh = stale.length ? drops.filter(child => !stale.includes(child)) : drops;
			// Discarded in bounded batches rather than one await at a time: an install that ran
			// unguarded for a week leaves thousands of files, and walking them serially through
			// the file service stalls the renderer exactly when the user has just opened the
			// agent. Nothing depends on the result, so the batches only bound the concurrency.
			for (let index = 0; index < stale.length; index += DISCARD_BATCH) {
				await Promise.all(stale.slice(index, index + DISCARD_BATCH).map(child => {
					this._seen.add(child.resource.toString());
					return this.fileService.del(child.resource).catch(() => undefined);
				}));
			}
			for (const child of fresh) {
				await this._consume(child.resource);
			}
		};
		await sweep(startedAt);
		const timer = setInterval(() => void sweep(0), POLL_MS);
		this._register(toDisposable(() => clearInterval(timer)));
	}

	private async _consume(file: URI): Promise<void> {
		const key = file.toString();
		if (this._seen.has(key)) {
			return;
		}
		this._seen.add(key);
		let payload: IOpenideClaudeHookPayload | undefined;
		try {
			const content = await this.fileService.readFile(file);
			payload = parseClaudeHookDrop(content.value.toString());
		} catch {
			// Half-written, or gone already. Let the next event or poll try again — unless it has
			// been unparsable for long enough that no writer is coming back for it.
			this._seen.delete(key);
			const stat = await this.fileService.stat(file).catch(() => undefined);
			if (stat && Date.now() - stat.mtime > UNPARSABLE_GRACE_MS) {
				await this.fileService.del(file).catch(() => undefined);
			}
			return;
		}
		await this.fileService.del(file).catch(() => undefined);
		// The key only had to bridge the watcher and the poll seeing the same file; once it is off
		// disk a late event for it fails to read and falls out on its own.
		this._seen.delete(key);
		if (payload) {
			this._onDidReceive.fire(payload);
		}
	}
}
