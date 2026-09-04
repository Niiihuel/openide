/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — base types for the agentic chat engine.
 *--------------------------------------------------------------------------------------------*/

import type { IComposerSnippet } from './chat/openideChatSnippet.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Credencial resuelta para autenticar contra el provider (API key u OAuth). */
export type ICredential =
	| { readonly kind: 'apiKey'; readonly value: string }
	| { readonly kind: 'oauth'; readonly token: string };

export interface IToolCall {
	readonly id: string;
	readonly name: string;
	/** Arguments as a JSON string (exactly as the model emits them). */
	readonly argumentsJson: string;
	/** Gemini 3 / Antigravity: reasoning signature on functionCall (required when resending history). */
	readonly thoughtSignature?: string;
}

/** Image attached to a user message (paste/drag in the composer). */
export interface IChatImage {
	readonly mimeType: string;
	/** Base64 data, without the data: prefix. Empty on load until `assetUri` is hydrated. */
	readonly data: string;
	/** Copia durable fuera del state.vscdb, dentro del workspaceStorage privado de OpenIDE. */
	readonly assetUri?: string;
}

/** Structured mention chosen from the composer's `/` picker. Persisted so the
 *  transcript keeps its chips and to inject the real skill/tool/MCP context. */
export interface IChatCapabilityMention {
	readonly kind: 'skill' | 'tool' | 'mcp' | 'command';
	readonly name: string;
}

/** The slash menu is an explicit user surface: skills/context and commands only, never operational tools. */
export function isSlashVisibleCapability(kind: IChatCapabilityMention['kind']): boolean { return kind === 'skill' || kind === 'command'; }

/** What the user sends back from an `ask_user` card: the answer, plus any pictures with it. */
export interface IOpenideAskAnswer {
	readonly text: string;
	readonly images?: readonly IChatImage[];
}

/**
 * `image-1`, `image-2`, … — the names the answer text uses to refer to the pictures.
 *
 * One numbering per turn and not per question, so the model reading "image-2" in the second answer
 * finds the second picture of the batch and not the second of that answer. The UI renders the very
 * same names on its chips, which is why this lives beside the types instead of in either surface.
 */
export function openideAskImageNames(count: number, alreadyAttached: number): string[] {
	return Array.from({ length: count }, (_, index) => `image-${alreadyAttached + index + 1}`);
}

/**
 * A recorded browser flow as the transcript keeps it: paths and the step list, nothing heavy.
 * The chat card reads the files from disk when it mounts.
 */
export interface IPersistedFlowVideo {
	readonly label: string;
	readonly dir: string;
	/** Empty when the build could not encode video; the sheet and the frames still exist. */
	readonly videoPath: string;
	readonly sheetPath: string;
	readonly durationMs: number;
	readonly width: number;
	readonly height: number;
	readonly steps: readonly { readonly file: string; readonly t: number; readonly label: string; readonly kind: string }[];
	/**
	 * What the tape measured: a stall, a flash, an action that moved nothing. Each carries the
	 * millisecond to look at, which is what the card turns into a button that seeks the player —
	 * the difference between "here is a video" and "here is the second that is wrong".
	 */
	readonly findings?: readonly { readonly kind: string; readonly t: number; readonly detail: string; readonly severity: number }[];
	/** What the page said about itself at the end of the flow. No timestamp: it is a state, not a moment. */
	readonly lint?: readonly { readonly kind: string; readonly selector: string; readonly detail: string }[];
}

export interface IChatMessage {
	role: ChatRole;
	content: string;
	/** Stable local identity of the message. On user messages it also identifies the file
	 *  transaction produced by its AI response. Not sent to the provider as content. */
	messageId?: string;
	/** Durable subagent result; idempotency key for exactly-once delivery. */
	subagentRunId?: string;
	/** Only on 'assistant' messages that invoke tools. */
	toolCalls?: IToolCall[];
	/** Only on 'tool' messages (the result of a tool). */
	toolCallId?: string;
	/** Internal operational turn (mode change/build): travels to the model but not to the transcript. */
	hidden?: boolean;
	/** Only on 'user' messages: attached images. */
	images?: IChatImage[];
	/** Only on 'user' messages: attached context (@mentioned files). It travels to the model
	 *  appended to the content, but the UI shows only the clean content. */
	context?: string;
	/** Target captured when the turn was accepted. Durable metadata: not sent to the provider. */
	providerId?: string;
	modelId?: string;
	/** Mode captured for this turn; editing/rollback must not depend on the current global selector. */
	executionMode?: AgentMode;
	/** Only on 'user' messages born from a /command: what was TYPED ("/slug args"). The UI,
	 *  titles and memory show this; the model sees the content (the expanded body). */
	displayText?: string;
	/** Editor selections attached to the turn, for the bubble; their text travels in `context`. */
	snippets?: IComposerSnippet[];
	/** Only on 'user' messages: `/` chips explicitly selected in the composer. */
	capabilities?: IChatCapabilityMention[];
	/** Only on 'tool' messages from write_file/edit_file: the persisted diff of that edit, used to
	 *  rebuild the styled edit card in the transcript when restoring the session (Ctrl+R). */
	fileDiff?: IPersistedFileDiff;
	/** Only on 'tool' messages from browser_record_stop: where the flow's files are, so the video
	 *  card comes back on restore. Paths only — the pictures live on disk. */
	video?: IPersistedFlowVideo;
	/** Gemini/Antigravity only: model-turn parts exactly as the API returned them (includes thoughtSignature). */
	geminiParts?: Record<string, unknown>[];
	/** Anthropic only: signed thinking/redacted_thinking blocks that must be resent unchanged before tool_use. */
	anthropicThinkingBlocks?: Record<string, unknown>[];
	/** Synthetic message replacing old history after compaction. The model receives its
	 *  structured content; the transcript shows a short card instead of the internal summary. */
	compaction?: ICompactionSnapshot;
	/** Only on 'user' messages: the exact state of each file before this turn's first edit.
	 *  This is local IDE metadata (adapters never send it to the provider) and it lets
	 *  "Go back here" restore the workspace before truncating the conversation. */
	rollbackFiles?: IFileRollbackCheckpoint[];
}

export interface IFileRollbackCheckpoint {
	readonly path: string;
	readonly content: string;
	/** False means the file was created during the turn and must be deleted when going back. */
	readonly existed: boolean;
}

/** JSON-serializable textual patch. Each hunk replaces `beforeLines` with `afterLines` and
 *  keeps enough context to relocate itself uniquely against a later version. */
export interface ITextPatchHunk {
	readonly expectedStart: number;
	readonly contextBefore: readonly string[];
	readonly beforeLines: readonly string[];
	readonly afterLines: readonly string[];
	readonly contextAfter: readonly string[];
}

export interface ITextPatch {
	readonly eol: '\n' | '\r\n';
	readonly sourceEol?: '\n' | '\r\n';
	readonly targetEol?: '\n' | '\r\n';
	readonly sourceEndsWithEol?: boolean;
	readonly targetEndsWithEol?: boolean;
	readonly changesEol?: boolean;
	readonly changesFinalNewline?: boolean;
	readonly hunks: readonly ITextPatchHunk[];
}

export type FileChangeOperation = 'create' | 'modify' | 'delete' | 'rename';
export type MessageChangeSetState = 'open' | 'finalized' | 'cancelled' | 'unavailable';

export interface IFileChange {
	readonly uri: string;
	readonly operation: FileChangeOperation;
	readonly originalUri?: string;
	readonly beforeContent?: string;
	readonly afterContent?: string;
	readonly beforeHash?: string;
	readonly afterHash?: string;
	readonly forwardPatch?: ITextPatch;
	readonly reversePatch?: ITextPatch;
}

export interface IMessageChangeSet {
	readonly messageId: string;
	readonly timestamp: number;
	readonly state: MessageChangeSetState;
	readonly files: readonly IFileChange[];
	/** Old checkpoints have neither after-state nor patch and cannot be reverted safely. */
	readonly unavailableReason?: string;
}

export type FileRollbackStatus = 'reverted' | 'skipped' | 'conflict';

export interface IFileRollbackResult {
	readonly uri: string;
	readonly status: FileRollbackStatus;
	readonly reason?: string;
}

export interface IMessageRollbackResult {
	readonly messageId: string;
	readonly status: 'noop' | 'reverted' | 'partial' | 'conflict' | 'unavailable';
	readonly files: readonly IFileRollbackResult[];
}

export interface ICompactionSnapshot {
	readonly beforeTokens: number;
	readonly afterTokens: number;
	readonly savingsPercent: number;
	readonly origin: 'automatic' | 'manual' | 'recovery';
}

/** Diff snapshot of ONE edit (write/edit), persisted to rebuild the transcript's edit card
 *  after a webview reload. Same diffLines shape as the fileDiff event. */
export interface IPersistedFileDiff {
	readonly path: string;
	readonly created?: boolean;
	readonly editAdded?: number;
	readonly editRemoved?: number;
	readonly diffLines?: { t: 'add' | 'del' | 'ctx' | 'gap'; x: string }[];
}

export interface IToolDefinition {
	readonly name: string;
	readonly description: string;
	/** JSON Schema of the parameters. */
	readonly parameters: object;
}

/** Events the provider emits while streaming the response. */
export type AgentStreamEvent =
	| { type: 'text'; delta: string }
	| { type: 'reasoning'; delta: string }
	| { type: 'info'; message: string }
	| { type: 'toolCall'; call: IToolCall }
	/**
	 * Chunk of the ARGUMENTS of a tool call that is still being written. The provider was
	 * already accumulating this internally (it was the only one that saw it) and only emitted
	 * `toolCall` on close. Exposing it allows showing a plan while the model drafts it, instead
	 * varios minutos a que aparezca entero de golpe.
	 * `argumentsJson` is what has accumulated SO FAR: incomplete JSON, not parseable with JSON.parse.
	 * Not every provider emits it (Gemini cloud-code delivers the call already closed).
	 */
	| { type: 'toolCallDelta'; id: string; name: string; argumentsJson: string }
	| { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };

export interface IProviderRequest {
	/** Credencial ya resuelta (API key u OAuth bearer token). */
	readonly credential: ICredential;
	/** Data provider that selected this protocol (OpenRouter, Groq, Ollama, etc.). */
	readonly providerId?: string;
	readonly baseUrl?: string;
	readonly model: string;
	/** Reasoning effort chosen by the user: '' default · none off ·
	 *  minimal/low/medium/high/xhigh (each adapter maps it per protocol). */
	readonly effort?: string;
	readonly system?: string;
	readonly messages: IChatMessage[];
	readonly tools?: IToolDefinition[];
	readonly maxTokens?: number;
	/** Extra headers the provider requires (e.g. Copilot: Editor-Version, Copilot-Integration-Id). */
	readonly extraHeaders?: Record<string, string>;
	/** Metadata del body loadCodeAssist/onboardUser (Antigravity vs Gemini CLI). */
	readonly cloudCodeMetadata?: Record<string, string>;
}

/** Minimum data for authenticated model discovery. Protocols with their own catalog
 *  (Antigravity/Cloud Code, for example) implement it without coupling the service to their API. */
export interface IProviderModelsRequest {
	readonly credential: ICredential;
	readonly providerId?: string;
	readonly baseUrl?: string;
	readonly extraHeaders?: Record<string, string>;
	readonly cloudCodeMetadata?: Record<string, string>;
}

export interface IProviderResult {
	/** Mensaje 'assistant' final (texto + toolCalls si hubo). */
	readonly message: IChatMessage;
	readonly stopReason?: string;
}

/** A PROTOCOL adapter (openai-compatible, anthropic, …). Few of them; providers are data. */
export interface ILLMProvider {
	readonly id: string;
	streamChat(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult>;
	/** Optional authenticated discovery. If it fails, the static catalog remains the fallback. */
	listModels?(req: IProviderModelsRequest, token: CancellationToken): Promise<readonly string[]>;
	/** Limpia estado ligado a credenciales/cuenta (proyecto resuelto, capacidades aprendidas). */
	resetSessionState?(): void;
}

/** Agent working mode: Agent decides when to delegate; Plan/Ask are read-only and
 *  Debug requires evidence-based diagnosis. */
export type AgentMode = 'agent' | 'plan' | 'ask' | 'debug';

/** Options for an agent run. */
export interface IAgentRunOptions {
	readonly mode?: AgentMode;
	/**
	 * The conversation this run belongs to. It is what lets two conversations work at the same
	 * time: the runs are serialized per conversation instead of globally, and every tool call
	 * carries it so the agent terminal, the interactive prompt and the output streaming into the
	 * chat card belong to one conversation each.
	 */
	readonly conversationId?: string;
	/** Ephemeral interpretation used to resume the same turn when a suggested mode is accepted. Never persisted nor rendered as a message. */
	readonly modeInstruction?: string;
	/** Stable id of the user message that owns every structured edit in this run. */
	readonly messageId?: string;
	/** Optional isolated root for a subagent's tools (worktree/single-writer). */
	readonly workspaceRoot?: URI;
	/** Failover: run with this provider instead of the active one (internal, set by the engine itself). */
	readonly providerOverride?: string;
	/** Explicit model for the failover step; when missing, the provider default is used. */
	readonly modelOverride?: string;
	/** Providers already tried in this failover chain (prevents loops). */
	readonly triedProviders?: readonly string[];
	/** provider/model steps already tried; allows several models of the same provider without loops. */
	readonly triedFallbackSteps?: readonly string[];
	/**
	 * The target the user actually chose, carried through every reroute.
	 *
	 * It is what makes the chip honest: `providerOverride`/`modelOverride` say where this attempt
	 * runs, and this says where it was MEANT to run, so the composer can show one arriving at the
	 * other instead of quietly claiming the reroute was the choice. Upstream keeps the same
	 * distinction in `IIntendedModelSelection` (`chat/common/modelSelection.ts`): the model a
	 * conversation is meant to run on is owned separately from what the catalog can serve now.
	 */
	readonly intendedTarget?: { readonly providerId: string; readonly model: string };
	/** Why this attempt is not on `intendedTarget`: it was cooling down, or the previous hop failed. */
	readonly rerouteReason?: 'cooldown' | 'failover';
	/** For a cooldown reroute, when the intended target is expected back. */
	readonly rerouteUntil?: number;
	/** OAuth providers that already got a forced refresh during this run. */
	readonly refreshedOAuthProviders?: readonly string[];
	/**
	 * This run already moved to another account of the provider. One retry, never a walk down the
	 * whole account list: the second failure means the quota is not what is wrong.
	 */
	readonly accountSwitched?: boolean;
	/** Internal execution of the /compact command: prepares the runtime and compacts, without asking for a response. */
	readonly compactOnly?: boolean;
}

/** One question from the ask_user stepper (supports batches of 1 to 5). */
export interface IAskQuestion {
	readonly question: string;
	readonly options?: string[];
	/** Several options may apply at once: the UI lets the user toggle many and joins the labels. */
	readonly allowMultiple?: boolean;
}

/** Estimated breakdown of the context in use, for the UI context panel (integrated:
 *  each component that occupies the window, separately). Categories at 0 are not shown. */
export interface IContextBreakdown {
	/** Base system prompt (without memory or skills). */
	readonly system: number;
	/** Injected agentic memory (project + user). */
	readonly memory: number;
	/** Skill index injected into the system prompt. */
	readonly skills: number;
	/** Tool definitions (they travel on every request). */
	readonly tools: number;
	/** Definiciones aportadas por servidores MCP conectados. */
	readonly mcp: number;
	/** Contexto de @menciones (archivos adjuntados a mensajes). */
	readonly mentions: number;
	readonly images: number;
	/** Historical reports from legacy subagents. New runs are persisted by identity. */
	readonly subagents: number;
	/** The rest of the conversation (messages + tool calls/results). */
	readonly conversation: number;
}

/** Semantic location of the agent. The follow-along UI consumes this without knowing tool
 *  names: built-in tools declare it and dynamic integrations can opt in
 *  manteniendo el mismo contrato. */
export type IAgentLocation =
	| {
		readonly kind: 'file';
		readonly path: string;
		readonly line?: number;
		/** Inclusive end of the range just read/edited. It lets "follow the agent" walk exactly
		 *  the new block, without re-animating every change in the file. */
		readonly endLine?: number;
		readonly activity: 'read' | 'write' | 'edit' | 'create' | 'delete';
		/** After a write, open the inline review instead of the flat view. */
		readonly review?: boolean;
	}
	| {
		readonly kind: 'terminal';
		readonly command: string;
		readonly background: boolean;
	}
	| {
		readonly kind: 'browser';
		readonly url?: string;
		readonly activity: 'open' | 'navigate' | 'inspect' | 'interact';
	};

/** High-level events the agent loop emits towards the UI/consumer. */
export type AgentLoopEvent =
	| { type: 'text'; delta: string }
	| { type: 'reasoning'; delta: string }
	| { type: 'agentLocation'; location: IAgentLocation }
	| { type: 'toolStart'; id: string; name: string; argumentsJson: string }
	/**
	 * The call is queued behind another conversation holding the file. `holder` is that
	 * conversation's title while it waits, and absent once the file is finally its own.
	 */
	| { type: 'toolWaiting'; id: string; holder?: string }
	| { type: 'toolResult'; id: string; name: string; result: string; isError: boolean }
	// Incremental output of the in-flight run_command (plain text, no ANSI): feeds the
	// chat's embedded terminal. id = id of the tool call it belongs to.
	| { type: 'terminalData'; id: string; data: string }
	// Screenshot (browser_screenshot / navigate): the UI shows it as an inline image card.
	| { type: 'screenshot'; id: string; mimeType: string; data: string }
	// A recorded flow (browser_record_stop): the UI shows it as a playable video card.
	| { type: 'video'; id: string; video: IPersistedFlowVideo }
	| {
		type: 'usage';
		inputTokens?: number; outputTokens?: number;
		cacheReadTokens?: number; cacheCreationTokens?: number;
		/** Total estimated context in use and the active model's limit. */
		contextUsed?: number; contextLimit?: number;
		breakdown?: IContextBreakdown;
	}
	| { type: 'approval'; name: string; decision: string }
	// INLINE approval request: the UI shows a card in the chat box with the options
	// (allow/session/always/reject) and answers with resolveApproval(id, decision).
	| { type: 'approvalRequest'; id: string; tool: string; title: string; detail?: string; command?: string; risk: ToolRisk; sensitive?: boolean }
	// The active account is spent and several could take over: the UI shows the choice and answers
	// with resolveAccountChoice(id, accountId | 'stop').
	| { type: 'accountChoiceRequest'; id: string; spentLabel: string; candidates: readonly { accountId: string; label: string; paid?: boolean }[] }
	| { type: 'info'; message: string }
	| {
		type: 'compaction';
		status: 'started' | 'completed' | 'skipped' | 'failed';
		origin: 'automatic' | 'manual' | 'recovery';
		beforeTokens?: number;
		afterTokens?: number;
		savingsPercent?: number;
		message?: string;
	}
	// Transient/rate-limit stream retry: the UI shows ONE row with a countdown that updates
	// in place (it removes itself when the stream resumes or the run ends).
	| { type: 'retry'; kind: 'rate-limit' | 'transient'; attempt: number; max: number; delayMs: number }
	| { type: 'todos'; items: ITodoItem[] }
	| { type: 'ask'; id: string; questions: IAskQuestion[]; allowFreeText?: boolean }
	// added/removed = acumulado contra el baseline (bandeja de archivos); editAdded/editRemoved
	// and diffLines = this edit only (inline transcript card); created = new file.
	| { type: 'fileDiff'; path: string; added: number; removed: number; created?: boolean; editAdded?: number; editRemoved?: number; diffLines?: { t: 'add' | 'del' | 'ctx' | 'gap'; x: string }[] }
	// Legacy host-only; conversaciones nuevas persisten messageChangeSet.
	| { type: 'fileCheckpoint'; checkpoint: IFileRollbackCheckpoint }
	// Host-only event when the run finishes (including cancellation/error): immutable transaction.
	| { type: 'messageChangeSet'; changeSet: IMessageChangeSet }
	// Legacy delegation events: they preserve identity when restoring old conversations.
	| { type: 'delegationStart'; id: string; total: number }
	| { type: 'subagentStart'; id: string; parentId: string; index: number; total: number; status: 'running'; title: string; prompt: string; model: string; sessionId?: string }
	| { type: 'subagentEvent'; id: string; parentId: string; index: number; total: number; status: 'running'; ev: AgentLoopEvent }
	| { type: 'subagentDone'; id: string; parentId: string; index: number; total: number; status: 'completed' | 'failed' | 'cancelled'; isError?: boolean; cancelled?: boolean }
	| { type: 'delegationDone'; id: string; total: number; status: 'completed' | 'partial' | 'cancelled' }
	| { type: 'subagentRun'; run: import('./openideSubagentTypes.js').ISubagentRun }
	| { type: 'subagentTimeline'; runId: string; event: import('./openideSubagentTypes.js').ISubagentTimelineEvent }
	// Complexity triage: the agent RECOMMENDS a mode. The UI shows an actionable card;
	// on accept, the webview switches the selector and resends the request or opens a fork.
	// 'fork' is NOT an AgentMode → the literal goes inline here.
	| { type: 'suggestMode'; id: string; mode: AgentMode | 'fork'; reason: string; prompt?: string; autoAcceptSeconds?: number }
	| { type: 'done'; reason?: string }
	| {
		/**
		 * This turn is running somewhere other than the model the user picked, and why. Host-only:
		 * it is not transcript content — the transcript already carries the `info` line — it is what
		 * the composer needs in order to stop displaying a model that is not the one answering.
		 */
		type: 'modelRoute';
		providerId: string; model: string;
		intendedProviderId: string; intendedModel: string;
		reason: 'cooldown' | 'failover';
		/** When the intended target is expected back, for a cooldown. */
		until?: number;
	}
	// action 'connect' → the UI offers the "Connect provider…" button (credential error).
	| {
		type: 'error'; message: string; action?: 'connect' | 'continue' | 'account-back';
		/**
		 * How loud the card should be. A rate limit is a failed turn but NOT a broken IDE: upstream
		 * reports it as `ChatErrorLevel.Info` for the same reason (`chat/common/chatErrorMessages.ts`),
		 * and painting the provider's busy signal in red teaches users to distrust the red.
		 */
		severity?: 'warning' | 'error';
	};

/** Event from a background terminal (run_command background). Emitted outside the run loop. */
export interface IBackgroundTerminalEvent {
	readonly id: string;
	readonly command: string;
	readonly status: 'running' | 'exited';
	readonly exitCode?: number;
}

/** Structured file operation that completed successfully. The service attributes it to the
 *  active run's messageId and consolidates the first before with the last after. */
export interface IFileEditEvent {
	/** Explicit owners of the invocation; they prevent attributing an event to the wrong run. */
	readonly messageId?: string;
	readonly runId?: string;
	readonly path: string;
	readonly operation: FileChangeOperation;
	readonly originalPath?: string;
	readonly beforeContent?: string;
	readonly afterContent?: string;
}

/** State of an item in the agent's task list. */
export type TodoStatus = 'pending' | 'in-progress' | 'completed';

export interface ITodoItem {
	readonly id: string;
	readonly title: string;
	readonly status: TodoStatus;
}

/** Tool risk: 'safe' needs no approval; 'write'/'exec' do. */
export type ToolRisk = 'safe' | 'write' | 'exec';

/** The user's decision on a tool that requires approval. */
export type ToolApprovalDecision = 'once' | 'session' | 'always' | 'deny';

export interface IToolApprovalRequest {
	readonly tool: string;
	readonly risk: ToolRisk;
	readonly title: string;
	readonly detail?: string;
	/** Para exec: el comando exacto a correr. */
	readonly command?: string;
	/** Para write: la ruta afectada (para detectar paths sensibles). */
	readonly path?: string;
}
