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
 * Installation is idempotent: a hook is recognised by the `.openide/agent-hooks` marker in its
 * command, other hooks in the user's settings are left untouched, and nothing is written when
 * everything is already there.
 */

export interface IOpenideClaudeHookPayload {
	readonly sessionId: string;
	readonly cwd: string;
	readonly event: OpenideCliSessionEvent;
}

const HOOK_DIR = ['.openide', 'agent-hooks', 'claude'];
const MARKER = '.openide/agent-hooks/claude';
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification'] as const;
const POLL_MS = 2000;

function hookCommand(): string {
	// `$$` and the nanosecond clock keep concurrent hooks from clobbering each other.
	return `mkdir -p "$HOME/${MARKER}" && cat > "$HOME/${MARKER}/$(date +%s%N)-$$.json"`;
}

/** Pure: the settings.json object with OpenIDE's hooks merged in, or `undefined` if unchanged. */
export function mergeOpenideClaudeHooks(settings: Record<string, unknown>): Record<string, unknown> | undefined {
	const command = hookCommand();
	const hooks = (settings['hooks'] && typeof settings['hooks'] === 'object' && !Array.isArray(settings['hooks'])) ? { ...(settings['hooks'] as Record<string, unknown>) } : {};
	let changed = false;
	for (const eventName of EVENTS) {
		const existing = Array.isArray(hooks[eventName]) ? [...(hooks[eventName] as unknown[])] : [];
		const present = existing.some(group => {
			const list = (group && typeof group === 'object' && Array.isArray((group as { hooks?: unknown[] }).hooks)) ? (group as { hooks: unknown[] }).hooks : [];
			return list.some(hook => hook && typeof hook === 'object' && String((hook as { command?: unknown }).command ?? '').includes(MARKER));
		});
		if (present) {
			continue;
		}
		const group: Record<string, unknown> = { hooks: [{ type: 'command', command }] };
		if (eventName === 'PreToolUse') {
			group['matcher'] = '*';
		}
		existing.push(group);
		hooks[eventName] = existing;
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
		case 'Notification':
			return { type: 'hook:notification' };
		default:
			return undefined;
	}
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
	 */
	private async _watch(): Promise<void> {
		if (this._watching) {
			return;
		}
		this._watching = true;
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
		const sweep = async (): Promise<void> => {
			const existing = await this.fileService.resolve(dir).catch(() => undefined);
			for (const child of existing?.children ?? []) {
				if (child.isFile && child.name.endsWith('.json')) {
					await this._consume(child.resource);
				}
			}
		};
		// Payloads dropped while the IDE was not looking, then the poll.
		await sweep();
		const timer = setInterval(() => void sweep(), POLL_MS);
		this._register(toDisposable(() => clearInterval(timer)));
	}

	private async _consume(file: URI): Promise<void> {
		const key = file.toString();
		if (this._seen.has(key)) {
			return;
		}
		this._seen.add(key);
		try {
			const content = await this.fileService.readFile(file);
			const payload = JSON.parse(content.value.toString()) as Record<string, unknown>;
			const event = claudeHookEventOf(payload);
			const sessionId = typeof payload['session_id'] === 'string' ? payload['session_id'] : '';
			const cwd = typeof payload['cwd'] === 'string' ? payload['cwd'] : '';
			if (event && sessionId) {
				this._onDidReceive.fire({ sessionId, cwd, event });
			}
		} catch {
			// a half-written file: the UPDATED event that follows re-reads it
			this._seen.delete(key);
			return;
		}
		await this.fileService.del(file).catch(() => undefined);
	}
}
