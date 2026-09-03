/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — chat conversation store (tabs + history). Persisted in IStorageService
 *  (scope WORKSPACE: las conversaciones pertenecen al proyecto). Modelo compacto:
 *  - `sessions`: every persisted conversation (with an `archived` flag).
 *  - `openTabIds`: the ones open as a tab in the strip (a subset of the non-archived).
 *  - `activeId`: the active conversation.
 *  Closing a tab removes it from the strip but keeps it in history; archiving removes it from the
 *  strip and moves it to the Archived section; deleting removes it for good.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IChatMessage, IContextBreakdown, IMessageChangeSet } from '../common/openideAgentTypes.js';
import { isOpenideCliId, isOpenideCliSessionStatus, OpenideCliId, OpenideCliSessionStatus } from '../common/openideAgentCliCatalog.js';

/** `native` = the IDE's own harness (a transcript); `cli` = an external agent in a terminal. */
export type OpenideChatSessionKind = 'native' | 'cli';

export interface IChatSessionMeta {
	/** True when the session has no user turns yet: history hides it, closing its tab deletes it. */
	empty?: boolean;
	readonly id: string;
	title: string;
	updatedAt: number;
	archived: boolean;
	hasError: boolean;
	/** Born as a fork of another session (the UI marks it with the repo-forked codicon). */
	forked: boolean;
	/**
	 * Set on a specialist's mirror session: which subagent run it transcribes.
	 *
	 * Persisted so the link survives a reload. Without it the binding lived only in
	 * `OpenideChatSessionEffects._mirrors`, an in-memory Map, and every restored specialist row
	 * offered to open a chat the window could no longer find.
	 */
	subagentRunId?: string;
	kind: OpenideChatSessionKind;
	/** For `cli` sessions: which agent (catalog id). */
	cliId?: OpenideCliId;
	/** VS Code's `ChatSessionStatus`. Native sessions carry it too so the pane can show a live turn. */
	status?: OpenideCliSessionStatus;
	/** Working directory the CLI was launched in (relative to nothing: an absolute fs path). */
	cwd?: string;
	/** The CLI's own session id, for `--resume`. */
	providerSessionId?: string;
	/** Changed state while it was not the active tab; cleared when opened. */
	unread?: boolean;
}

/** Last context usage reported by the provider for a conversation. Persisted alongside the
 *  thread so the native indicator does not falsely drop to zero when OpenIDE restarts. */
export interface IChatSessionUsage {
	input: number;
	output: number;
	used: number;
	limit: number;
	breakdown?: IContextBreakdown;
}

export interface IChatSession extends IChatSessionMeta {
	/** Title the user set by hand. While present, `save()` never re-derives the title — the same
	 *  contract as VS Code's `ChatModel.customTitle` (chatModel.ts:2683-2694). */
	customTitle?: string;
	messages: IChatMessage[];
	/** Durable source for rollback. It lives outside the transcript so it survives compaction. */
	changeSetsByMessageId: Record<string, IMessageChangeSet>;
	usage?: IChatSessionUsage;
}

interface IPersisted {
	sessions: IChatSession[];
	openTabIds: string[];
	activeId?: string;
}

const STORAGE_KEY = 'openide.chat.sessions.v1';
const MAX_SESSIONS = 200;
const TITLE_MAX = 48;
const MAX_CHANGE_SET_CHARS = 16_000_000;

function normalizeChangeSets(value: unknown, messages: IChatMessage[]): Record<string, IMessageChangeSet> {
	const result: Record<string, IMessageChangeSet> = {};
	let total = 0;
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		for (const [messageId, candidate] of Object.entries(value as Record<string, unknown>)) {
			if (!candidate || typeof candidate !== 'object') { continue; }
			const set = candidate as Partial<IMessageChangeSet>;
			if (set.messageId !== messageId || !Array.isArray(set.files) || !['open', 'finalized', 'cancelled', 'unavailable'].includes(String(set.state))) { continue; }
			const encoded = JSON.stringify(set);
			total += encoded.length;
			if (total > MAX_CHANGE_SET_CHARS) {
				result[messageId] = { messageId, timestamp: Number(set.timestamp) || 0, state: 'unavailable', files: [], unavailableReason: 'El change set excede el límite seguro de persistencia.' };
				continue;
			}
			const restored = JSON.parse(encoded) as IMessageChangeSet;
			result[messageId] = restored.state === 'open' ? { ...restored, state: 'cancelled' } : restored;
		}
	}
	// Fail-safe migration: old checkpoints have neither after-state nor patch.
	for (const message of messages) {
		if (!message.messageId || !message.rollbackFiles?.length || result[message.messageId]) { continue; }
		result[message.messageId] = {
			messageId: message.messageId,
			timestamp: 0,
			state: 'unavailable',
			files: message.rollbackFiles.map(checkpoint => ({ uri: checkpoint.path, operation: checkpoint.existed ? 'modify' : 'create', beforeContent: checkpoint.content })),
			unavailableReason: 'Checkpoint creado por una versión anterior: falta el estado posterior y no puede revertirse sin riesgo.',
		};
	}
	return result;
}

function normalizeUsage(value: unknown): IChatSessionUsage | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const source = value as Partial<IChatSessionUsage>;
	const number = (candidate: unknown): number => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : 0;
	const usage = {
		input: number(source.input),
		output: number(source.output),
		used: number(source.used),
		limit: number(source.limit),
		breakdown: source.breakdown && typeof source.breakdown === 'object' ? {
			system: number(source.breakdown.system),
			memory: number(source.breakdown.memory),
			skills: number(source.breakdown.skills),
			tools: number(source.breakdown.tools),
			mcp: number(source.breakdown.mcp),
			mentions: number(source.breakdown.mentions),
			images: number(source.breakdown.images),
			subagents: number(source.breakdown.subagents),
			conversation: number(source.breakdown.conversation),
		} : undefined,
	};
	return usage.input || usage.output || usage.used || usage.limit ? usage : undefined;
}

export class OpenideChatSessions {

	private readonly sessions = new Map<string, IChatSession>();
	/** Global session order (most recent first by updatedAt). */
	private order: string[] = [];
	private openTabIds: string[] = [];
	private activeId: string | undefined;

	constructor(private readonly storageService: IStorageService) {
		this.load();
	}

	private load(): void {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) { return; }
		try {
			const p: IPersisted = JSON.parse(raw);
			for (const s of p.sessions || []) {
				if (!s || typeof s.id !== 'string') { continue; }
				this.sessions.set(s.id, {
					id: s.id,
					title: s.title || 'Nuevo chat',
					customTitle: typeof s.customTitle === 'string' && s.customTitle ? s.customTitle : undefined,
					updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
					archived: !!s.archived,
					hasError: !!s.hasError,
					forked: !!s.forked,
					subagentRunId: typeof s.subagentRunId === 'string' && s.subagentRunId ? s.subagentRunId : undefined,
					kind: s.kind === 'cli' && isOpenideCliId(s.cliId) ? 'cli' : 'native',
					cliId: s.kind === 'cli' && isOpenideCliId(s.cliId) ? s.cliId : undefined,
					// A CLI that was running when the window closed is not running any more.
					status: isOpenideCliSessionStatus(s.status) ? (s.status === 'in-progress' ? 'completed' : s.status) : undefined,
					cwd: typeof s.cwd === 'string' && s.cwd ? s.cwd : undefined,
					providerSessionId: typeof s.providerSessionId === 'string' && s.providerSessionId ? s.providerSessionId : undefined,
					unread: !!s.unread,
					messages: Array.isArray(s.messages) ? s.messages : [],
					changeSetsByMessageId: normalizeChangeSets(s.changeSetsByMessageId, Array.isArray(s.messages) ? s.messages : []),
					usage: normalizeUsage(s.usage),
				});
				this.order.push(s.id);
			}
			this.openTabIds = (p.openTabIds || []).filter(id => this.sessions.has(id) && !this.sessions.get(id)!.archived);
			this.activeId = p.activeId && this.sessions.has(p.activeId) ? p.activeId : undefined;
		} catch {
			// corrupt index → start clean
		}
	}

	private persist(): void {
		// The binary lives in workspaceStorage. In state.vscdb we only store mime + assetUri;
		// old images, or ones whose write failed, keep base64 as a fallback so they are not lost.
		const sessions = this.order
			.map(id => this.sessions.get(id))
			.filter((s): s is IChatSession => !!s)
			.map(s => ({
				...s,
				messages: s.messages.map(m => !m.images?.length ? m : {
					...m,
					images: m.images.map(image => image.assetUri ? { ...image, data: '' } : image),
				}),
			}));
		const data: IPersisted = { sessions, openTabIds: this.openTabIds, activeId: this.activeId };
		this.storageService.store(STORAGE_KEY, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private toMeta(s: IChatSession): IChatSessionMeta {
		return { id: s.id, title: s.title, updatedAt: s.updatedAt, archived: s.archived, hasError: s.hasError, forked: s.forked, empty: this.isEmptySession(s), kind: s.kind, cliId: s.cliId, status: s.status, cwd: s.cwd, providerSessionId: s.providerSessionId, unread: s.unread };
	}

	/** No user turns and no name the user chose: nothing worth keeping or listing. A CLI session
	 *  is never empty — its content lives in the agent's own transcript, not in `messages`. */
	private isEmptySession(s: IChatSession): boolean {
		return s.kind === 'native' && !s.customTitle && !s.messages.some(message => message.role === 'user');
	}

	kindOf(id: string | undefined): OpenideChatSessionKind | undefined {
		return id ? this.sessions.get(id)?.kind : undefined;
	}

	metaOf(id: string | undefined): IChatSessionMeta | undefined {
		const s = id ? this.sessions.get(id) : undefined;
		return s ? this.toMeta(s) : undefined;
	}

	/**
	 * A session hosting an external agent in a terminal. Always a NEW tab: `create()` reuses an
	 * empty native session, but a terminal is never empty.
	 */
	createCli(cliId: OpenideCliId, title: string, cwd: string | undefined, providerSessionId?: string): string {
		const id = generateUuid();
		const now = Date.now();
		this.sessions.set(id, {
			id, title, updatedAt: now, archived: false, hasError: false, forked: false,
			kind: 'cli', cliId, status: 'in-progress', cwd, providerSessionId,
			messages: [], changeSetsByMessageId: {},
		});
		this.order.unshift(id);
		this.openTabIds.push(id);
		this.activeId = id;
		this.prune();
		this.persist();
		return id;
	}

	/** Status change from the host. Marks unread when the session is not the active one. */
	setStatus(id: string, status: OpenideCliSessionStatus): boolean {
		const s = this.sessions.get(id);
		if (!s || s.status === status) { return false; }
		s.status = status;
		s.hasError = status === 'failed';
		s.updatedAt = Date.now();
		if (this.activeId !== id && (status === 'needs-input' || status === 'completed' || status === 'failed')) {
			s.unread = true;
		}
		this.touch(id);
		this.persist();
		return true;
	}

	setProviderSession(id: string, providerSessionId: string): void {
		const s = this.sessions.get(id);
		if (!s || s.providerSessionId === providerSessionId) { return; }
		s.providerSessionId = providerSessionId;
		this.persist();
	}

	markRead(id: string): void {
		const s = this.sessions.get(id);
		if (!s || !s.unread) { return; }
		s.unread = false;
		this.persist();
	}

	private touch(id: string): void {
		this.order = [id, ...this.order.filter(other => other !== id)];
	}

	isEmpty(id: string): boolean {
		const s = this.sessions.get(id);
		return !!s && this.isEmptySession(s);
	}

	private deriveTitle(messages: IChatMessage[]): string {
		const firstUser = messages.find(m => m.role === 'user');
		// /commands: the title comes from what was TYPED (displayText), not the expanded body
		const t = (firstUser?.displayText || firstUser?.content || '').trim().replace(/\s+/g, ' ');
		if (!t) { return 'Nuevo chat'; }
		return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + '…' : t;
	}

	/** Sessions open as a tab (in strip order). */
	openTabs(): IChatSessionMeta[] {
		return this.openTabIds.map(id => this.sessions.get(id)).filter((s): s is IChatSession => !!s).map(s => this.toMeta(s));
	}

	/** Every persisted session (archived included), most recent first. */
	listAll(): IChatSessionMeta[] {
		return this.order
			.map(id => this.sessions.get(id))
			.filter((s): s is IChatSession => !!s)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(s => this.toMeta(s));
	}

	activeSessionId(): string | undefined {
		return this.activeId;
	}

	messagesOf(id: string | undefined): IChatMessage[] {
		return (id && this.sessions.get(id)?.messages) || [];
	}

	changeSetOf(id: string | undefined, messageId: string): IMessageChangeSet | undefined {
		const set = id ? this.sessions.get(id)?.changeSetsByMessageId[messageId] : undefined;
		return set ? JSON.parse(JSON.stringify(set)) as IMessageChangeSet : undefined;
	}

	saveChangeSet(id: string, changeSet: IMessageChangeSet): void {
		const session = this.sessions.get(id);
		if (!session) { return; }
		const encoded = JSON.stringify(changeSet);
		const currentSize = Object.entries(session.changeSetsByMessageId)
			.filter(([messageId]) => messageId !== changeSet.messageId)
			.reduce((total, [, set]) => total + JSON.stringify(set).length, 0);
		if (encoded.length + currentSize > MAX_CHANGE_SET_CHARS) {
			session.changeSetsByMessageId[changeSet.messageId] = { messageId: changeSet.messageId, timestamp: changeSet.timestamp, state: 'unavailable', files: [], unavailableReason: 'El change set excede el límite seguro de persistencia.' };
		} else {
			session.changeSetsByMessageId[changeSet.messageId] = JSON.parse(encoded) as IMessageChangeSet;
		}
		this.persist();
	}

	removeChangeSets(id: string, messageIds: readonly string[]): void {
		const session = this.sessions.get(id);
		if (!session) { return; }
		for (const messageId of messageIds) { delete session.changeSetsByMessageId[messageId]; }
		this.persist();
	}

	usageOf(id: string | undefined): IChatSessionUsage | undefined {
		const usage = id ? this.sessions.get(id)?.usage : undefined;
		return usage ? { ...usage } : undefined;
	}

	/** Updates the snapshot without touching updatedAt: receiving usage must not reorder history. */
	saveUsage(id: string, usage: IChatSessionUsage): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}
		session.usage = normalizeUsage(usage);
		this.persist();
	}

	clearUsage(id: string): void {
		const session = this.sessions.get(id);
		if (session?.usage) {
			delete session.usage;
			this.persist();
		}
	}

	/** Guarantees there is an active session (creating one if needed). Returns its id. */
	ensureActive(): string {
		if (this.activeId && this.sessions.has(this.activeId)) {
			if (!this.openTabIds.includes(this.activeId) && !this.sessions.get(this.activeId)!.archived) {
				this.openTabIds.push(this.activeId);
			}
			return this.activeId;
		}
		// reusar la primera tab abierta si la hay
		const firstTab = this.openTabIds.find(id => this.sessions.has(id));
		if (firstTab) {
			this.activeId = firstTab;
			this.persist();
			return firstTab;
		}
		return this.create();
	}

	create(): string {
		// VS Code's "New Chat" never stacks empties: an active session with no turns is already the
		// new chat, so it is reused in place (chatEditorInput.ts `shouldReplaceEmptyLocalSession`,
		// chatNewActions.ts `runNewChatAction`). Without this, every click on `+` grew the strip.
		if (this.activeId) {
			const active = this.sessions.get(this.activeId);
			if (active && !active.archived && this.isEmptySession(active) && this.openTabIds.includes(active.id)) {
				return active.id;
			}
		}
		const id = generateUuid();
		const session: IChatSession = { id, title: 'Nuevo chat', updatedAt: Date.now(), archived: false, hasError: false, forked: false, kind: 'native', messages: [], changeSetsByMessageId: {} };
		this.sessions.set(id, session);
		this.order.unshift(id);
		this.openTabIds.push(id);
		this.activeId = id;
		this.prune();
		this.persist();
		return id;
	}

	/** The mirror session of a specialist run, if this window still has one. */
	sessionOfSubagentRun(runId: string): string | undefined {
		for (const session of this.sessions.values()) {
			if (session.subagentRunId === runId) { return session.id; }
		}
		return undefined;
	}

	createBackground(title: string, messages: IChatMessage[], subagentRunId?: string): string {
		const id = generateUuid();
		const session: IChatSession = {
			id,
			title: title.trim().slice(0, TITLE_MAX) || 'Subagente',
			updatedAt: Date.now(),
			archived: false,
			hasError: false,
			forked: true,
			kind: 'native',
			subagentRunId,
			messages,
			changeSetsByMessageId: {},
		};
		this.sessions.set(id, session);
		this.order.unshift(id);
		// Transient: it is NOT added to openTabIds. The session lives in the Agents panel as a
		// sub-branch; it only opens a tab if the user activates it manually. When the tab closes, the
		// session stays archived in the panel without piling up in the strip.
		this.prune();
		this.persist();
		return id;
	}

	/** Opens (or reopens) a session as a strip tab. Used by the Agents panel when the user
	 *  manually activates a sub-conversation. */
	openTab(id: string): void {
		if (!this.sessions.has(id) || this.openTabIds.includes(id)) { return; }
		this.openTabIds.push(id);
		this.persist();
	}

	/** Closes the strip tab without destroying the session (it stays in the Agents panel). */
	closeBackgroundTab(id: string): void {
		const idx = this.openTabIds.indexOf(id);
		if (idx < 0) { return; }
		this.openTabIds.splice(idx, 1);
		if (this.activeId === id) {
			this.activeId = this.openTabIds[this.openTabIds.length - 1] ?? undefined;
		}
		this.persist();
	}

	/** Fork (/fork): a new session that INHERITS another's COMPLETE conversational
	 *  state (messages, tool calls and results — everything the engine uses to reason)
	 *  and evolves independently from there. They are diverging branches: there is no merge,
	 *  and no new message syncs between them. It avoids contaminating the original session
	 *  while exploring an alternative idea, without losing the context already built. */
	fork(id: string): string | undefined {
		const src = this.sessions.get(id);
		if (!src) { return undefined; }
		const newId = generateUuid();
		// Deep copy via JSON. Forks share immutable references to the assets; the binary is not
		// duplicated and both branches can restore the image after a restart.
		const messages: IChatMessage[] = JSON.parse(JSON.stringify(src.messages));
		const session: IChatSession = {
			id: newId,
			title: src.title,
			updatedAt: Date.now(),
			archived: false,
			hasError: false,
			forked: true,
			kind: 'native',
			messages,
			changeSetsByMessageId: JSON.parse(JSON.stringify(src.changeSetsByMessageId)) as Record<string, IMessageChangeSet>,
			usage: src.usage ? { ...src.usage } : undefined,
		};
		this.sessions.set(newId, session);
		this.order.unshift(newId);
		this.openTabIds.push(newId);
		this.activeId = newId;
		this.prune();
		this.persist();
		return newId;
	}

	/** Opens an existing session (adds it to the strip if it was not there, and activates it). */
	open(id: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.archived = false;
		if (!this.openTabIds.includes(id)) { this.openTabIds.push(id); }
		this.activeId = id;
		this.persist();
	}

	activate(id: string): void {
		this.markRead(id);
		if (this.sessions.has(id)) {
			this.activeId = id;
			if (!this.openTabIds.includes(id) && !this.sessions.get(id)!.archived) { this.openTabIds.push(id); }
			this.persist();
		}
	}

	/** Removes the session from the strip (it stays in history). Reactivates another if it was active.
	 *  An EMPTY unnamed session is deleted outright instead — VS Code garbage-collects those on
	 *  disposal (chatServiceImpl.ts:268-284) so history never fills with "Nuevo chat" husks. */
	closeTab(id: string): void {
		const session = this.sessions.get(id);
		if (session && this.isEmptySession(session)) {
			this.delete(id);
			return;
		}
		this.openTabIds = this.openTabIds.filter(t => t !== id);
		if (this.activeId === id) { this.activeId = this.openTabIds[this.openTabIds.length - 1]; }
		this.persist();
		this._onDidDelete.fire(id);
	}

	/** Moves a tab next to another one (drag and drop in the strip). */
	reorderTab(id: string, targetId: string, after: boolean): void {
		if (id === targetId || !this.openTabIds.includes(id) || !this.openTabIds.includes(targetId)) { return; }
		const without = this.openTabIds.filter(t => t !== id);
		const at = without.indexOf(targetId) + (after ? 1 : 0);
		without.splice(at, 0, id);
		this.openTabIds = without;
		this.persist();
	}

	archive(id: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.archived = true;
		this.openTabIds = this.openTabIds.filter(t => t !== id);
		if (this.activeId === id) { this.activeId = this.openTabIds[this.openTabIds.length - 1]; }
		this.persist();
	}

	unarchive(id: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.archived = false;
		this.persist();
	}

	private readonly _onDidDelete = new Emitter<string>();
	/** A conversation was deleted by the user. What indexes sessions elsewhere (the Agent Changes view) drops it on this. */
	readonly onDidDelete: Event<string> = this._onDidDelete.event;

	delete(id: string): void {
		this.sessions.delete(id);
		this.order = this.order.filter(t => t !== id);
		this.openTabIds = this.openTabIds.filter(t => t !== id);
		if (this.activeId === id) { this.activeId = this.openTabIds[this.openTabIds.length - 1]; }
		this.persist();
	}

	/** Persists the active conversation's state (messages + derived title + error). */
	save(id: string, messages: IChatMessage[], hasError: boolean): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.messages = messages;
		s.updatedAt = Date.now();
		s.hasError = hasError;
		// The derived title tracks the FIRST user turn; a manual rename freezes it (VS Code's
		// `title = customTitle || getDefaultTitle(requests)`).
		if (!s.customTitle) { s.title = this.deriveTitle(messages); }
		this.persist();
	}

	/** Renames a session. An empty title clears the manual name and returns to the derived one. */
	rename(id: string, title: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		const trimmed = title.trim().slice(0, TITLE_MAX);
		s.customTitle = trimmed || undefined;
		s.title = trimmed || this.deriveTitle(s.messages);
		this.persist();
	}

	/** Deletes every session. The caller confirms first; this is VS Code's "clear history". */
	deleteAll(): void {
		const ids = [...this.sessions.keys()];
		this.sessions.clear();
		this.order = [];
		this.openTabIds = [];
		this.activeId = undefined;
		this.persist();
		for (const id of ids) { this._onDidDelete.fire(id); }
	}

	private prune(): void {
		// Soft cap: with too many sessions we drop the oldest ones that are neither open nor active.
		if (this.order.length <= MAX_SESSIONS) { return; }
		const keep = new Set([...this.openTabIds, this.activeId].filter((x): x is string => !!x));
		const sorted = this.order
			.map(id => this.sessions.get(id))
			.filter((s): s is IChatSession => !!s)
			.sort((a, b) => b.updatedAt - a.updatedAt);
		for (let i = sorted.length - 1; i >= 0 && this.sessions.size > MAX_SESSIONS; i--) {
			const s = sorted[i];
			if (!keep.has(s.id)) {
				this.sessions.delete(s.id);
				this.order = this.order.filter(t => t !== s.id);
			}
		}
	}
}
