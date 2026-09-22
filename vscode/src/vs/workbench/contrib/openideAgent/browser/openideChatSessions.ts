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

import { t } from '../common/openideStrings.js';
import { collectConversationChanges, IConversationFileChange } from '../common/openideConversationChanges.js';
import { subagentTaskTitle } from '../common/openideSubagentTitle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IChatMessage, IContextBreakdown, IMessageChangeSet } from '../common/openideAgentTypes.js';
import { getOpenideCli, isOpenideCliId, isOpenideCliSessionStatus, OpenideCliId, OpenideCliSessionStatus } from '../common/openideAgentCliCatalog.js';

/** `native` = the IDE's own harness (a transcript); `cli` = an external agent in a terminal. */
export type OpenideChatSessionKind = 'native' | 'cli';

export interface IChatSessionMeta {
	/** True when the session has no user turns yet: history hides it, closing its tab deletes it. */
	empty?: boolean;
	readonly id: string;
	title: string;
	updatedAt: number;
	archived: boolean;
	/** User-pinned history is grouped by the sidebar. History is never pruned by recency. */
	pinned?: boolean;
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
	subagentStartedAt?: number;
	subagentCompletedAt?: number;
	subagentStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
	/** Owning conversation; specialist transcripts are children, never peer sessions. */
	parentSessionId?: string;
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

interface IStoredChatSession extends IChatSessionMeta {
	customTitle?: string;
	/** Allows history and tab operations without reading the transcript. */
	hasUserMessages: boolean;
	usage?: IChatSessionUsage;
	/** Immutable model-window snapshots captured before compaction, oldest first. */
	compactionArchiveIds?: string[];
}

interface IChatSessionContent {
	messages: IChatMessage[];
	changeSetsByMessageId: Record<string, IMessageChangeSet>;
}

interface IPersistedIndex {
	version: 2;
	sessionIds: string[];
	openTabIds: string[];
	activeId?: string;
}

const LEGACY_STORAGE_KEY = 'openide.chat.sessions.v1';
const INDEX_STORAGE_KEY = 'openide.chat.sessions.v2.index';
const META_STORAGE_PREFIX = 'openide.chat.sessions.v2.meta.';
const CONTENT_STORAGE_PREFIX = 'openide.chat.sessions.v2.content.';
const ARCHIVE_STORAGE_PREFIX = 'openide.chat.sessions.v2.archive.';
const TITLE_MAX = 120;
const MAX_CHANGE_SET_CHARS = 16_000_000;

function messagesForStorage(messages: readonly IChatMessage[]): IChatMessage[] {
	return messages.map(message => !message.images?.length ? message : {
		...message,
		images: message.images.map(image => image.assetUri ? { ...image, data: '' } : image),
	});
}

function isCompactionMessage(message: IChatMessage): boolean {
	return !!message.compaction || (message.role === 'user' && message.content.startsWith('[Resumen histórico compacto]'));
}

/** Join successive model windows without repeating their preserved tail. This projection is
 * for reading/export only: the harness always receives the compacted `messagesOf` window. */
function appendTranscriptWindow(history: IChatMessage[], window: readonly IChatMessage[]): void {
	const messages = window.filter(message => !isCompactionMessage(message));
	const candidateKeys = messagesForStorage(messages).map(message => JSON.stringify(message));
	const previous = history.filter(message => !isCompactionMessage(message));
	const previousKeys = messagesForStorage(messages.length ? previous.slice(-messages.length) : []).map(message => JSON.stringify(message));
	// KMP computes the longest history suffix matching the next window's prefix in linear time.
	const prefixes = new Array<number>(candidateKeys.length).fill(0);
	for (let i = 1, matched = 0; i < candidateKeys.length; i++) {
		while (matched > 0 && candidateKeys[i] !== candidateKeys[matched]) { matched = prefixes[matched - 1]; }
		if (candidateKeys[i] === candidateKeys[matched]) { matched++; }
		prefixes[i] = matched;
	}
	let overlap = 0;
	for (const key of previousKeys) {
		while (overlap > 0 && (overlap === candidateKeys.length || key !== candidateKeys[overlap])) { overlap = prefixes[overlap - 1]; }
		if (key === candidateKeys[overlap]) { overlap++; }
	}
	const priorCompactions = new Set(history.filter(isCompactionMessage).map(message => JSON.stringify(message)));
	for (const message of window.filter(isCompactionMessage)) {
		if (!priorCompactions.has(JSON.stringify(message))) { history.push(message); }
	}
	const userMessageIds = new Set(history.filter(message => message.role === 'user' && message.messageId).map(message => message.messageId!));
	for (const message of messages.slice(overlap)) {
		// Emergency compaction can retain a shortened version of the latest user request.
		// Its durable original is the same turn and must stay intact in the reading projection.
		const key = message.role === 'user' ? message.messageId : undefined;
		if (!key || !userMessageIds.has(key)) {
			history.push(message);
			if (key) { userMessageIds.add(key); }
		}
	}
}

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

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly sessions = new Map<string, IStoredChatSession>();
	private readonly contents = new Map<string, IChatSessionContent>();
	private readonly archives = new Map<string, readonly IChatMessage[]>();
	private readonly reviewChanges = new Map<string, readonly IConversationFileChange[]>();
	private readonly messageVersions = new WeakMap<IStoredChatSession, number>();
	/** Global session order (most recent first by updatedAt). */
	private order: string[] = [];
	private openTabIds: string[] = [];
	private activeId: string | undefined;

	constructor(private readonly storageService: IStorageService) {
		this.load();
	}

	private load(): void {
		const rawIndex = this.storageService.get(INDEX_STORAGE_KEY, StorageScope.WORKSPACE);
		let index: IPersistedIndex | undefined;
		if (rawIndex) {
			try {
				const candidate: IPersistedIndex = JSON.parse(rawIndex);
				if (candidate.version === 2 && Array.isArray(candidate.sessionIds) && Array.isArray(candidate.openTabIds)) { index = candidate; }
			} catch { /* Recover individual records below; never replace them with an empty store. */ }
		}
		if (index) {
			this.loadMetadata(index.sessionIds);
			this.restoreTabs(index);
			return;
		}
		// Recover newer records before consulting the migration backup. Losing only the index
		// must never let a stale v1 snapshot overwrite conversations saved since migration.
		const ids = this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)
			.filter(key => key.startsWith(META_STORAGE_PREFIX))
			.map(key => key.slice(META_STORAGE_PREFIX.length));
		this.loadMetadata(ids);
		// An interrupted migration can still have missing records; import only those IDs.
		if (!this.migrateLegacy() && this.sessions.size) { this.persistIndex(); }
	}

	private normalizeMetadata(s: Partial<IStoredChatSession>, id: string): IStoredChatSession {
		const cli = s.kind === 'cli' && isOpenideCliId(s.cliId);
		const customTitle = typeof s.customTitle === 'string' && s.customTitle ? s.customTitle : undefined;
		return {
			id,
			title: customTitle || (typeof s.title === 'string' && s.title) || 'Nuevo chat',
			customTitle,
			updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
			archived: !!s.archived,
			pinned: !!s.pinned,
			hasError: !!s.hasError,
			forked: !!s.forked,
			subagentRunId: typeof s.subagentRunId === 'string' && s.subagentRunId ? s.subagentRunId : undefined,
			subagentStartedAt: typeof s.subagentStartedAt === 'number' ? s.subagentStartedAt : undefined,
			subagentCompletedAt: typeof s.subagentCompletedAt === 'number' ? s.subagentCompletedAt : undefined,
			subagentStatus: s.subagentStatus === 'running' ? 'interrupted' : ['completed', 'failed', 'cancelled', 'interrupted'].includes(s.subagentStatus ?? '') ? s.subagentStatus : undefined,
			parentSessionId: typeof s.parentSessionId === 'string' ? s.parentSessionId : undefined,
			kind: cli ? 'cli' : 'native',
			cliId: cli ? s.cliId : undefined,
			// A restored CLI has no live turn signal until its terminal reconnects.
			status: isOpenideCliSessionStatus(s.status) ? (s.status === 'in-progress' ? (cli ? 'unknown' : 'completed') : s.status) : undefined,
			cwd: typeof s.cwd === 'string' && s.cwd ? s.cwd : undefined,
			providerSessionId: typeof s.providerSessionId === 'string' && s.providerSessionId ? s.providerSessionId : undefined,
			unread: !!s.unread,
			hasUserMessages: s.hasUserMessages !== false,
			usage: normalizeUsage(s.usage),
			compactionArchiveIds: Array.isArray(s.compactionArchiveIds) ? s.compactionArchiveIds.filter(id => typeof id === 'string') : undefined,
		};
	}

	private loadMetadata(ids: readonly string[]): void {
		for (const id of ids) {
			if (typeof id !== 'string' || this.sessions.has(id)) { continue; }
			let source: Partial<IStoredChatSession> = {};
			try {
				const raw = this.storageService.get(META_STORAGE_PREFIX + id, StorageScope.WORKSPACE);
				const candidate: IStoredChatSession | undefined = raw ? JSON.parse(raw) : undefined;
				if (candidate?.id === id) { source = candidate; }
			} catch { /* Keep the indexed conversation and its content even if its metadata is damaged. */ }
			this.sessions.set(id, this.normalizeMetadata(source, id));
			this.order.push(id);
		}
	}

	private restoreTabs(source: { openTabIds: string[]; activeId?: string }): void {
		this.openTabIds = [...new Set(source.openTabIds)].filter(id => this.sessions.has(id) && !this.sessions.get(id)!.archived);
		this.activeId = source.activeId && this.sessions.has(source.activeId) ? source.activeId : undefined;
	}

	/** Publish the new index only after every migrated record exists. Keep v1 as recovery data. */
	private migrateLegacy(): boolean {
		const raw = this.storageService.get(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) { return false; }
		let source: IPersisted;
		try {
			source = JSON.parse(raw);
			if (!Array.isArray(source.sessions)) { return false; }
		} catch { return false; }
		for (const old of source.sessions) {
			if (!old || typeof old.id !== 'string' || this.sessions.has(old.id)) { continue; }
			const messages = Array.isArray(old.messages) ? old.messages : [];
			const hasUserMessages = messages.some(message => message.role === 'user');
			const canDeriveTitle = !old.subagentRunId && old.kind !== 'cli' && hasUserMessages && !messages.some(message => message.compaction);
			const session = this.normalizeMetadata({ ...old, title: canDeriveTitle ? this.deriveTitle(messages) : old.title, hasUserMessages }, old.id);
			this.sessions.set(old.id, session);
			this.contents.set(old.id, { messages, changeSetsByMessageId: normalizeChangeSets(old.changeSetsByMessageId, messages) });
			this.order.push(old.id);
			this.persistContent(old.id);
			this.persistMetadata(session);
		}
		this.restoreTabs({ openTabIds: Array.isArray(source.openTabIds) ? source.openTabIds : [], activeId: source.activeId });
		this.persistIndex();
		// Migration is the only full transcript read. Subsequent access follows the lazy path too.
		this.contents.clear();
		return true;
	}

	private contentOf(id: string): IChatSessionContent {
		let content = this.contents.get(id);
		if (!content) {
			const raw = this.storageService.get(CONTENT_STORAGE_PREFIX + id, StorageScope.WORKSPACE);
			try {
				const source: IChatSessionContent = raw ? JSON.parse(raw) : { messages: [], changeSetsByMessageId: {} };
				if (!Array.isArray(source.messages)) { throw new Error('Invalid conversation content'); }
				content = { messages: source.messages, changeSetsByMessageId: normalizeChangeSets(source.changeSetsByMessageId, source.messages) };
			} catch {
				// Do not silently replace damaged content when the user opens or renames a session.
				throw new Error(t('openide.chat.history.unreadable'));
			}
			this.contents.set(id, content);
		}
		return content;
	}

	private persistContent(id: string): void {
		const content = this.contents.get(id);
		if (!content) { return; }
		// The binary lives in workspaceStorage. In state.vscdb we only store mime + assetUri;
		// old images, or ones whose write failed, keep base64 as a fallback so they are not lost.
		const data: IChatSessionContent = {
			...content,
			messages: messagesForStorage(content.messages),
		};
		this.storageService.store(CONTENT_STORAGE_PREFIX + id, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private persistMetadata(session: IStoredChatSession): void {
		this.storageService.store(META_STORAGE_PREFIX + session.id, JSON.stringify(session), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private persistIndex(): void {
		const data: IPersistedIndex = { version: 2, sessionIds: this.order, openTabIds: this.openTabIds, activeId: this.activeId };
		this.storageService.store(INDEX_STORAGE_KEY, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	/** Transcript writes never serialize other conversations or the full history index. */
	private persist(id?: string, contentChanged = false, indexChanged = id === undefined): void {
		const session = id ? this.sessions.get(id) : undefined;
		if (session) {
			if (contentChanged) { this.persistContent(session.id); }
			this.persistMetadata(session);
		}
		if (indexChanged) { this.persistIndex(); }
		this._onDidChange.fire();
	}

	private toMeta(s: IStoredChatSession): IChatSessionMeta {
		return { id: s.id, title: s.title, updatedAt: s.updatedAt, archived: s.archived, pinned: s.pinned, hasError: s.hasError, forked: s.forked, subagentRunId: s.subagentRunId, subagentStartedAt: s.subagentStartedAt, subagentCompletedAt: s.subagentCompletedAt, subagentStatus: s.subagentStatus, parentSessionId: s.parentSessionId, empty: this.isEmptySession(s), kind: s.kind, cliId: s.cliId, status: s.status, cwd: s.cwd, providerSessionId: s.providerSessionId, unread: s.unread };
	}

	/** No user turns and no name the user chose: nothing worth keeping or listing. A CLI session
	 *  is never empty — its content lives in the agent's own transcript, not in `messages`. */
	private isEmptySession(s: IStoredChatSession): boolean {
		return s.kind === 'native' && !s.customTitle && !s.pinned && !s.hasUserMessages;
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
			kind: 'cli', cliId, status: 'unknown', cwd, providerSessionId, hasUserMessages: false,
		});
		this.contents.set(id, { messages: [], changeSetsByMessageId: {} });
		this.order.unshift(id);
		this.openTabIds.push(id);
		this.activeId = id;
		this.persist(id, true, true);
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
		this.persist(id);
		return true;
	}

	setProviderSession(id: string, providerSessionId: string): void {
		const s = this.sessions.get(id);
		if (!s || s.providerSessionId === providerSessionId) { return; }
		s.providerSessionId = providerSessionId;
		this.persist(id);
	}

	markRead(id: string): void {
		const s = this.sessions.get(id);
		if (!s || !s.unread) { return; }
		s.unread = false;
		this.persist(id);
	}

	private touch(id: string): void {
		this.order = [id, ...this.order.filter(other => other !== id)];
	}

	isEmpty(id: string): boolean {
		const s = this.sessions.get(id);
		return !!s && this.isEmptySession(s);
	}

	private deriveTitle(messages: IChatMessage[]): string {
		const firstUser = messages.find(m => m.role === 'user' && (m.displayText || m.content || '').trim());
		// /commands: the title comes from what was TYPED (displayText), not the expanded body
		const t = (firstUser?.displayText || firstUser?.content || '').trim().replace(/\s+/g, ' ');
		if (!t) { return 'Nuevo chat'; }
		if (t.length <= TITLE_MAX) { return t; }
		const prefix = Array.from(t).slice(0, TITLE_MAX).join('');
		const boundary = prefix.lastIndexOf(' ');
		return (boundary > TITLE_MAX / 2 ? prefix.slice(0, boundary) : prefix) + '…';
	}

	/** Sessions open as a tab (in strip order). */
	openTabs(): IChatSessionMeta[] {
		return this.openTabIds.map(id => this.sessions.get(id)).filter((s): s is IStoredChatSession => !!s).map(s => this.toMeta(s));
	}

	/** Every persisted session (archived included), most recent first. */
	listAll(): IChatSessionMeta[] {
		return this.order
			.map(id => this.sessions.get(id))
			.filter((s): s is IStoredChatSession => !!s)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(s => this.toMeta(s));
	}

	activeSessionId(): string | undefined {
		return this.activeId;
	}

	/** In-memory revision for readers; metadata changes do not invalidate a transcript. */
	messageVersionOf(id: string): number | undefined {
		const session = this.sessions.get(id);
		return session ? this.messageVersions.get(session) ?? 0 : undefined;
	}

	messagesOf(id: string | undefined): IChatMessage[] {
		return id && this.sessions.has(id) ? this.contentOf(id).messages : [];
	}

	/** Synchronous capture: the compactor mutates the live array immediately after its event. */
	archiveBeforeCompaction(id: string, messages: readonly IChatMessage[]): void {
		const session = this.sessions.get(id);
		if (!session || !messages.length) { return; }
		const encoded = JSON.stringify(messagesForStorage(messages));
		const lastArchiveId = session.compactionArchiveIds?.at(-1);
		if (lastArchiveId && this.storageService.get(this.archiveKey(id, lastArchiveId), StorageScope.WORKSPACE) === encoded) { return; }
		const archiveId = generateUuid();
		this.storageService.store(this.archiveKey(id, archiveId), encoded, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		session.compactionArchiveIds = [...session.compactionArchiveIds ?? [], archiveId];
		this.persist(id);
	}

	/** Original messages remain available for reading even after several automatic compactions. */
	archivedMessagesOf(id: string | undefined): IChatMessage[] {
		const history: IChatMessage[] = [];
		if (!id) { return history; }
		for (const archiveId of this.sessions.get(id)?.compactionArchiveIds ?? []) {
			appendTranscriptWindow(history, this.readArchive(id, archiveId));
		}
		return history;
	}

	/** Full read-only history. Never pass this projection back into the harness or rollback. */
	transcriptOf(id: string | undefined): IChatMessage[] {
		if (!id || !this.sessions.has(id)) { return []; }
		const history = this.archivedMessagesOf(id);
		if (!history.length) { return this.messagesOf(id); }
		appendTranscriptWindow(history, this.messagesOf(id));
		return history;
	}

	/** A reverted turn may also occur in a pre-compaction snapshot. Replace this branch's
	 * archive with its retained prefix so reading/export cannot resurrect discarded turns. */
	truncateArchiveBefore(id: string, messageId: string): void {
		const session = this.sessions.get(id);
		if (!session?.compactionArchiveIds?.length) { return; }
		const history = this.archivedMessagesOf(id);
		const cut = history.findIndex(message => message.role === 'user' && message.messageId === messageId);
		if (cut < 0) { return; }
		const previousIds = session.compactionArchiveIds;
		const archiveId = cut > 0 ? generateUuid() : undefined;
		if (archiveId) {
			this.storageService.store(this.archiveKey(id, archiveId), JSON.stringify(messagesForStorage(history.slice(0, cut))), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		// Publish the replacement only once it exists. Forks own separate archive keys.
		session.compactionArchiveIds = archiveId ? [archiveId] : [];
		try { this.persistMetadata(session); }
		catch (error) { session.compactionArchiveIds = previousIds; throw error; }
		this.messageVersions.set(session, (this.messageVersions.get(session) ?? 0) + 1);
		for (const previousId of previousIds) {
			const key = this.archiveKey(id, previousId);
			this.storageService.remove(key, StorageScope.WORKSPACE);
			this.archives.delete(key);
		}
	}

	private archiveKey(sessionId: string, archiveId: string): string {
		return `${ARCHIVE_STORAGE_PREFIX}${encodeURIComponent(sessionId)}:${archiveId}`;
	}

	private readArchive(sessionId: string, archiveId: string): readonly IChatMessage[] {
		const key = this.archiveKey(sessionId, archiveId);
		let messages = this.archives.get(key);
		if (!messages) {
			try {
				const raw = this.storageService.get(key, StorageScope.WORKSPACE);
				const source: IChatMessage[] | undefined = raw ? JSON.parse(raw) : undefined;
				if (!Array.isArray(source)) { throw new Error('Invalid archived conversation'); }
				messages = source;
			} catch {
				throw new Error(t('openide.chat.archive.unreadable'));
			}
			this.archives.set(key, messages);
		}
		return messages;
	}

	/** Exact before/after receipts owned by this conversation, independent of the working tree. */
	changesOf(id: string | undefined): readonly IConversationFileChange[] {
		if (!id) { return []; }
		const session = this.sessions.get(id);
		if (!session) { return []; }
		let changes = this.reviewChanges.get(id);
		if (!changes) {
			changes = collectConversationChanges(Object.values(this.contentOf(id).changeSetsByMessageId));
			this.reviewChanges.set(id, changes);
		}
		return changes;
	}

	changeSetOf(id: string | undefined, messageId: string): IMessageChangeSet | undefined {
		const set = id && this.sessions.has(id) ? this.contentOf(id).changeSetsByMessageId[messageId] : undefined;
		return set ? JSON.parse(JSON.stringify(set)) as IMessageChangeSet : undefined;
	}

	saveChangeSet(id: string, changeSet: IMessageChangeSet): void {
		this.reviewChanges.delete(id);
		const session = this.sessions.get(id);
		if (!session) { return; }
		const content = this.contentOf(id);
		const encoded = JSON.stringify(changeSet);
		const currentSize = Object.entries(content.changeSetsByMessageId)
			.filter(([messageId]) => messageId !== changeSet.messageId)
			.reduce((total, [, set]) => total + JSON.stringify(set).length, 0);
		if (encoded.length + currentSize > MAX_CHANGE_SET_CHARS) {
			content.changeSetsByMessageId[changeSet.messageId] = { messageId: changeSet.messageId, timestamp: changeSet.timestamp, state: 'unavailable', files: [], unavailableReason: 'El change set excede el límite seguro de persistencia.' };
		} else {
			content.changeSetsByMessageId[changeSet.messageId] = JSON.parse(encoded) as IMessageChangeSet;
		}
		this.persist(id, true);
	}

	removeChangeSets(id: string, messageIds: readonly string[]): void {
		this.reviewChanges.delete(id);
		const session = this.sessions.get(id);
		if (!session) { return; }
		const content = this.contentOf(id);
		for (const messageId of messageIds) { delete content.changeSetsByMessageId[messageId]; }
		this.persist(id, true);
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
		this.persist(id);
	}

	clearUsage(id: string): void {
		const session = this.sessions.get(id);
		if (session?.usage) {
			delete session.usage;
			this.persist(id);
		}
	}

	/** Guarantees there is an active session (creating one if needed). Returns its id. */
	ensureActive(): string {
		if (this.activeId && this.sessions.has(this.activeId)) {
			if (!this.openTabIds.includes(this.activeId) && !this.sessions.get(this.activeId)!.archived) {
				this.openTabIds.push(this.activeId);
				this.persist();
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
		const session: IStoredChatSession = { id, title: 'Nuevo chat', updatedAt: Date.now(), archived: false, hasError: false, forked: false, kind: 'native', hasUserMessages: false };
		this.sessions.set(id, session);
		this.contents.set(id, { messages: [], changeSetsByMessageId: {} });
		this.order.unshift(id);
		this.openTabIds.push(id);
		this.activeId = id;
		this.persist(id, true, true);
		return id;
	}

	/** The mirror session of a specialist run, if this window still has one. */
	sessionOfSubagentRun(runId: string): string | undefined {
		for (const session of this.sessions.values()) {
			if (session.subagentRunId === runId) { return session.id; }
		}
		return undefined;
	}

	setSubagentStatus(id: string, status: NonNullable<IChatSessionMeta['subagentStatus']>): void {
		const session = this.sessions.get(id);
		if (!session?.subagentRunId || session.subagentStatus === status) { return; }
		session.subagentStatus = status;
		if (status === 'running') { session.subagentStartedAt ??= Date.now(); }
		else { session.subagentCompletedAt = Date.now(); }
		session.status = status === 'running' ? 'in-progress' : status === 'failed' ? 'failed' : 'completed';
		this.persist(id);
	}

	linkSubagentParent(id: string, parentSessionId: string, task?: string, definitionName?: string): void {
		const session = this.sessions.get(id);
		if (!session?.subagentRunId || id === parentSessionId || !this.sessions.has(parentSessionId)) { return; }
		const title = task && session.title === definitionName ? subagentTaskTitle(task, session.title) : session.title;
		if (session.parentSessionId === parentSessionId && title === session.title) { return; }
		session.parentSessionId = parentSessionId;
		if (title !== session.title) { session.title = title; session.customTitle = title; }
		this.persist(id);
	}

	createBackground(title: string, messages: IChatMessage[], subagentRunId?: string, parentSessionId?: string): string {
		const id = generateUuid();
		title = subagentRunId ? subagentTaskTitle(messages.find(message => message.role === 'user')?.content ?? '', title) : title.trim().slice(0, TITLE_MAX);
		const session: IStoredChatSession = {
			id,
			title: title.trim() || 'Subagente',
			updatedAt: Date.now(),
			archived: false,
			hasError: false,
			forked: true,
			kind: 'native',
			subagentRunId,
			parentSessionId,
			customTitle: title.trim() || undefined,
			hasUserMessages: messages.some(message => message.role === 'user'),
		};
		this.sessions.set(id, session);
		this.contents.set(id, { messages, changeSetsByMessageId: {} });
		this.order.unshift(id);
		// Transient: it is NOT added to openTabIds. The session lives in the Agents panel as a
		// sub-branch; it only opens a tab if the user activates it manually. When the tab closes, the
		// session stays archived in the panel without piling up in the strip.
		this.persist(id, true, true);
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
		const content = this.contentOf(id);
		const messages: IChatMessage[] = JSON.parse(JSON.stringify(content.messages));
		const session: IStoredChatSession = {
			id: newId,
			title: src.title,
			updatedAt: Date.now(),
			archived: false,
			hasError: false,
			forked: true,
			kind: 'native',
			hasUserMessages: messages.some(message => message.role === 'user'),
			usage: src.usage ? { ...src.usage } : undefined,
		};
		// Forks own their archive records, so deleting either branch cannot break the other.
		for (const archiveId of src.compactionArchiveIds ?? []) {
			const archived = this.readArchive(id, archiveId);
			this.storageService.store(this.archiveKey(newId, archiveId), JSON.stringify(archived), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		session.compactionArchiveIds = src.compactionArchiveIds ? [...src.compactionArchiveIds] : undefined;
		this.sessions.set(newId, session);
		this.contents.set(newId, { messages, changeSetsByMessageId: JSON.parse(JSON.stringify(content.changeSetsByMessageId)) as Record<string, IMessageChangeSet> });
		this.order.unshift(newId);
		this.openTabIds.push(newId);
		this.activeId = newId;
		this.persist(newId, true, true);
		return newId;
	}

	/** Opens an existing session (adds it to the strip if it was not there, and activates it). */
	open(id: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.archived = false;
		if (!this.openTabIds.includes(id)) { this.openTabIds.push(id); }
		this.activeId = id;
		this.persist(id, false, true);
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
		this.persist(id, false, true);
	}

	unarchive(id: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		s.archived = false;
		this.persist(id);
	}

	private readonly _onDidDelete = new Emitter<string>();
	/** A conversation was deleted by the user. What indexes sessions elsewhere (the Agent Changes view) drops it on this. */
	readonly onDidDelete: Event<string> = this._onDidDelete.event;

	delete(id: string): void {
		if (!this.sessions.delete(id)) { return; }
		this.contents.delete(id);
		this.reviewChanges.delete(id);
		this.order = this.order.filter(t => t !== id);
		this.openTabIds = this.openTabIds.filter(t => t !== id);
		if (this.activeId === id) { this.activeId = this.openTabIds[this.openTabIds.length - 1]; }
		this.persist();
		this.removePersistedSession(id);
		this._onDidDelete.fire(id);
	}

	/** Persists the active conversation's state (messages + derived title + error). */
	save(id: string, messages: IChatMessage[], hasError: boolean): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		this.contentOf(id).messages = messages;
		s.hasUserMessages = messages.some(message => message.role === 'user');
		this.messageVersions.set(s, (this.messageVersions.get(s) ?? 0) + 1);
		s.updatedAt = Date.now();
		s.hasError = hasError;
		// The derived title tracks the FIRST user turn; a manual rename freezes it (VS Code's
		// `title = customTitle || getDefaultTitle(requests)`).
		// Compaction replaces the opening request with a synthetic summary. Keep the
		// conversation's identity even when only later user turns remain in memory.
		if (!s.customTitle && !messages.some(message => message.compaction)) { s.title = this.deriveTitle(messages); }
		this.persist(id, true);
	}

	/** Renames a session. An empty title clears the manual name and returns to the derived one. */
	rename(id: string, title: string): void {
		const s = this.sessions.get(id);
		if (!s) { return; }
		const trimmed = title.trim().slice(0, TITLE_MAX);
		const nextTitle = trimmed || (s.kind === 'cli' ? getOpenideCli(s.cliId)?.name || s.title : this.deriveTitle(this.contentOf(id).messages));
		s.customTitle = trimmed || undefined;
		s.title = nextTitle;
		this.persist(id);
	}

	/** Pinning is a user preference, not activity: it never changes recency or starts a run. */
	setPinned(id: string, pinned: boolean): void {
		const session = this.sessions.get(id);
		if (!session || !!session.pinned === pinned) { return; }
		session.pinned = pinned;
		this.persist(id);
	}

	/** Deletes every session. The caller confirms first; this is VS Code's "clear history". */
	deleteAll(): void {
		const ids = [...this.sessions.keys()];
		this.sessions.clear();
		this.contents.clear();
		this.archives.clear();
		this.reviewChanges.clear();
		this.order = [];
		this.openTabIds = [];
		this.activeId = undefined;
		this.persist();
		this.storageService.remove(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE);
		// Also clear unreferenced records left by an interrupted migration or archive write.
		for (const key of this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)) {
			if (key.startsWith(META_STORAGE_PREFIX) || key.startsWith(CONTENT_STORAGE_PREFIX) || key.startsWith(ARCHIVE_STORAGE_PREFIX)) {
				this.storageService.remove(key, StorageScope.WORKSPACE);
			}
		}
		for (const id of ids) {
			this._onDidDelete.fire(id);
		}
	}

	private removePersistedSession(id: string): void {
		// Explicit deletion also removes the migration backup: it must not resurrect deleted data.
		this.storageService.remove(LEGACY_STORAGE_KEY, StorageScope.WORKSPACE);
		this.storageService.remove(META_STORAGE_PREFIX + id, StorageScope.WORKSPACE);
		this.storageService.remove(CONTENT_STORAGE_PREFIX + id, StorageScope.WORKSPACE);
		const archivePrefix = `${ARCHIVE_STORAGE_PREFIX}${encodeURIComponent(id)}:`;
		for (const key of this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE)) {
			if (key.startsWith(archivePrefix)) {
				this.storageService.remove(key, StorageScope.WORKSPACE);
				this.archives.delete(key);
			}
		}
	}
}
