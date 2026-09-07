/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IOpenideMemoryRequest, MemoryRecordKind } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { OpenideAgentMemory } from './openideAgentMemory.js';
import { IAgentTool, IAgentToolContext } from './openideTools.js';

export function createMemoryTools(memory: OpenideAgentMemory): IAgentTool[] {
	const text = { type: 'string' };
	const identity = { id: text, expected_revision: { type: 'integer', minimum: 1 }, expected_hash: text };
	const contextFor = (context?: IAgentToolContext) => ({ session: context?.conversationId ?? context?.execution?.runId ?? 'external', message: context?.messageId,
		origin: context?.execution?.origin ?? (context?.external ? 'external' : 'native') });
	const save = (summary: boolean): IAgentTool => ({
		risk: 'write', capability: 'memory',
		def: { name: summary ? 'memory_session_summary' : 'memory_save',
			description: summary ? 'Persist a session handoff: goal, progress, blockers and next steps. This is not proof of task completion.' : 'Save a concise durable Markdown note: what, why, where, evidence and limits. Search the topic first. To update, memory_get then supply id, expected_revision and expected_hash. Use supersedes when a decision changes. Never store secrets or copy profile preferences into project memory.',
			parameters: { type: 'object', additionalProperties: false, properties: { ...identity, topic_key: text, body: text, idempotency_key: { type: 'string', description: 'Unique operation key; reuse exactly for a retry of the same write.' },
				kind: { type: 'string', enum: ['decision', 'convention', 'discovery', 'bugfix', 'preference'] }, related: { type: 'array', items: text, description: 'Workspace-relative paths or path#symbol references.' }, supersedes: text }, required: ['topic_key', 'body', 'idempotency_key'] } },
		invoke: async (args: Record<string, unknown>, _token, context) => {
			const source = contextFor(context);
			const request: IOpenideMemoryRequest = { action: 'save', ...source, topic: String(args.topic_key), body: String(args.body),
				kind: summary ? 'session' : args.kind as MemoryRecordKind | undefined, id: args.id as string | undefined,
				expectedRevision: args.expected_revision as number | undefined, expectedHash: args.expected_hash as string | undefined,
				supersedes: args.supersedes as string | undefined, related: args.related as string[] | undefined,
				operationId: `${source.origin}:${source.origin === 'external' ? '' : source.session}:${String(args.idempotency_key)}` };
			const result = await memory.request(request, context?.workspaceRoot);
			return JSON.stringify({ status: 'saved', ...result.document });
		},
	});
	return [
		{ risk: 'safe', def: { name: 'memory_search', description: 'Search full project memory text and topics. Returns bounded excerpts with IDs, provenance and revision hashes; memory_get expands a record. Available without the graph or embeddings.', parameters: { type: 'object', additionalProperties: false, properties: { query: text, max_tokens: { type: 'integer', minimum: 100, maximum: 3000 }, include_sessions: { type: 'boolean' } }, required: ['query'] } },
			invoke: async (args: Record<string, unknown>, _token, context) => await memory.search(String(args.query), Number(args.max_tokens ?? 1000), context?.workspaceRoot, args.include_sessions === true) || 'No matching project memories.' },
		{ risk: 'safe', def: { name: 'memory_get', description: 'Read the complete canonical Markdown memory and current revision hash before updating or forgetting it.', parameters: { type: 'object', additionalProperties: false, properties: { id: text }, required: ['id'] } },
			invoke: async (args: Record<string, unknown>, _token, context) => JSON.stringify(await memory.request({ action: 'get', id: String(args.id) }, context?.workspaceRoot)) },
		save(false), save(true),
		{ risk: 'write', def: { name: 'memory_forget', description: 'Forget a project memory after an explicit user request. Requires memory_get revision and hash. Removes canonical content and retained local revisions; Git history is outside this operation.', parameters: { type: 'object', additionalProperties: false, properties: identity, required: ['id', 'expected_revision', 'expected_hash'] } },
			invoke: async (args: Record<string, unknown>, _token, context) => JSON.stringify(await memory.request({ action: 'forget', id: String(args.id), expectedRevision: Number(args.expected_revision), expectedHash: String(args.expected_hash) }, context?.workspaceRoot)) },
	];
}
