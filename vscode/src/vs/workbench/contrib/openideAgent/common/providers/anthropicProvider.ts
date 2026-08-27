/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — adaptador de protocolo Anthropic (Claude): streaming nativo + tool use.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { AgentStreamEvent, IChatMessage, ILLMProvider, IProviderRequest, IProviderResult, IToolCall } from '../openideAgentTypes.js';
import { sseDataOf, ssePost } from '../openideSse.js';

// ---- Extended/adaptive thinking (configuration per model family) ----
// Claude 4.6+ usa thinking ADAPTATIVO (thinking.type=adaptive + output_config.effort);
// los Claude viejos y los endpoints Anthropic-compat no-Claude (MiniMax) usan thinking
// MANUAL con budget_tokens. Haiku no soporta extended thinking.
const THINKING_BUDGET: Record<string, number> = { max: 32000, xhigh: 32000, high: 16000, medium: 8000, low: 4000, minimal: 4000 };
const ADAPTIVE_EFFORT: Record<string, string> = { max: 'max', xhigh: 'xhigh', high: 'high', medium: 'medium', low: 'low', minimal: 'low' };
/** Familias Claude viejas que exigen thinking manual (budget_tokens). Default = moderno. */
const LEGACY_MANUAL_THINKING = [
	'claude-3',
	'claude-opus-4-0', 'claude-opus-4.0', 'claude-opus-4-1', 'claude-opus-4.1',
	'claude-sonnet-4-0', 'claude-sonnet-4.0',
	'claude-opus-4-2025', 'claude-sonnet-4-2025',
	'claude-opus-4-5', 'claude-opus-4.5',
	'claude-sonnet-4-5', 'claude-sonnet-4.5',
	'claude-haiku-4-5', 'claude-haiku-4.5',
];
/** The 4.6 models do not accept the xhigh level (it arrived with Opus 4.7) — it degrades to max. */
const NO_XHIGH = ['claude-opus-4-6', 'claude-opus-4.6', 'claude-sonnet-4-6', 'claude-sonnet-4.6'];

function supportsAdaptiveThinking(model: string): boolean {
	const m = model.toLowerCase();
	if (!m.includes('claude')) {
		return false;
	}
	return !LEGACY_MANUAL_THINKING.some(v => m.includes(v));
}

export class AnthropicProvider implements ILLMProvider {

	readonly id = 'anthropic';

	constructor(private readonly requestService: IRequestService) { }

	async streamChat(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		const base = (req.baseUrl?.replace(/\/+$/, '')) || 'https://api.anthropic.com';
		const url = `${base}/v1/messages`;
		const { system, messages } = this.toAnthropic(req);
		const isOAuth = req.credential.kind !== 'apiKey';

		// With a subscription OAuth token, Anthropic requires presenting as Claude Code: the
		// system MUST start with the official identity block (without it, traffic is rejected).
		const effectiveSystem = isOAuth
			? `You are Claude Code, Anthropic's official CLI for Claude.` + (system ? `\n\n${system}` : '')
			: system;

		const body: Record<string, unknown> = {
			model: req.model,
			max_tokens: req.maxTokens ?? 4096,
			stream: true,
			messages,
		};
		const nativeAnthropic = /(?:^|\.)anthropic\.com$/i.test(new URL(base).hostname)
			|| req.providerId === 'anthropic' || req.providerId === 'anthropic-oauth' || req.providerId === 'claude';
		if (effectiveSystem) {
			// A breakpoint at the end of the system also reuses the previous prefix (tools included)
			// en la API nativa. Gateado para no romper gateways Anthropic-compat.
			body.system = nativeAnthropic
				? [{ type: 'text', text: effectiveSystem, cache_control: { type: 'ephemeral' } }]
				: effectiveSystem;
		}
		if (req.tools?.length) {
			body.tools = req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
		}

		// Reasoning (chosen by the user in the model popover). '' = the model's default
		// (send nothing); 'none' = explicitly off (also not sent).
		const effort = (req.effort ?? '').toLowerCase();
		if (effort && effort !== 'none' && !req.model.toLowerCase().includes('haiku')) {
			if (supportsAdaptiveThinking(req.model)) {
				body.thinking = { type: 'adaptive' };
				let adaptive = ADAPTIVE_EFFORT[effort] ?? 'medium';
				if (adaptive === 'xhigh' && NO_XHIGH.some(v => req.model.toLowerCase().includes(v))) {
					adaptive = 'max';
				}
				body.output_config = { effort: adaptive };
			} else {
				const budget = THINKING_BUDGET[effort] ?? 8000;
				body.thinking = { type: 'enabled', budget_tokens: budget };
				// older models require temperature=1 with thinking, plus an output budget
				body.temperature = 1;
				body.max_tokens = Math.max(Number(body.max_tokens) || 0, budget + 4096);
			}
		}

		// Auth: API key uses x-api-key; OAuth (Claude subscription) uses Bearer plus the headers
		// subscription billing requires: both betas + the claude-code UA + x-app (without the
		// full combination the API 500s or rejects OAuth traffic).
		const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
		if (req.credential.kind === 'apiKey') {
			headers['x-api-key'] = req.credential.value;
		} else {
			headers['Authorization'] = `Bearer ${req.credential.token}`;
			headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20';
			headers['User-Agent'] = 'claude-cli/2.1.74 (external, cli)'; // el UA del CLI real es "claude-cli/…"
			headers['x-app'] = 'cli';
		}
		if (req.extraHeaders) {
			Object.assign(headers, req.extraHeaders);
		}

		let text = '';
		const blocks = new Map<number, { type: 'text' | 'tool_use' | 'thinking' | 'redacted_thinking'; id?: string; name?: string; partial: string; signature?: string; data?: string }>();
		let stopReason: string | undefined;
		let inputTokens: number | undefined;
		let outputTokens: number | undefined;
		let cacheReadTokens: number | undefined;
		let cacheCreationTokens: number | undefined;

		await ssePost(this.requestService, { url, headers, body: JSON.stringify(body) }, token, block => {
			const data = sseDataOf(block);
			if (!data) { return; }
			let json: any;
			try { json = JSON.parse(data); } catch { return; }

			switch (json.type) {
				case 'message_start':
					inputTokens = json.message?.usage?.input_tokens;
					cacheReadTokens = json.message?.usage?.cache_read_input_tokens;
					cacheCreationTokens = json.message?.usage?.cache_creation_input_tokens;
					break;
				case 'content_block_start': {
					const cb = json.content_block;
					if (cb?.type === 'tool_use') {
						blocks.set(json.index, { type: 'tool_use', id: cb.id, name: cb.name, partial: '' });
					} else if (cb?.type === 'thinking') {
						blocks.set(json.index, { type: 'thinking', partial: cb.thinking || '', signature: cb.signature });
					} else if (cb?.type === 'redacted_thinking') {
						blocks.set(json.index, { type: 'redacted_thinking', partial: '', data: cb.data });
					} else {
						blocks.set(json.index, { type: 'text', partial: '' });
					}
					break;
				}
				case 'content_block_delta': {
					const d = json.delta;
					if (d?.type === 'text_delta' && d.text) {
						text += d.text;
						onEvent({ type: 'text', delta: d.text });
					} else if (d?.type === 'thinking_delta' && d.thinking) {
						const b = blocks.get(json.index); if (b) { b.partial += d.thinking; }
						onEvent({ type: 'reasoning', delta: d.thinking });
					} else if (d?.type === 'signature_delta') {
						const b = blocks.get(json.index); if (b) { b.signature = (b.signature || '') + (d.signature || ''); }
					} else if (d?.type === 'input_json_delta') {
						const b = blocks.get(json.index);
						if (b) {
							b.partial += d.partial_json || '';
							// The accumulated value, not the chunk: listeners want the argument's current
							// state and should not have to re-implement the accumulation.
							if (b.name) { onEvent({ type: 'toolCallDelta', id: b.id || '', name: b.name, argumentsJson: b.partial }); }
						}
					}
					break;
				}
				case 'message_delta':
					stopReason = json.delta?.stop_reason;
					outputTokens = json.usage?.output_tokens;
					break;
			}
		});

		const toolCalls: IToolCall[] = [];
		for (const b of blocks.values()) {
			if (b.type === 'tool_use' && b.name) {
				toolCalls.push({ id: b.id || `call_${toolCalls.length}`, name: b.name, argumentsJson: b.partial || '{}' });
			}
		}
		for (const c of toolCalls) {
			onEvent({ type: 'toolCall', call: c });
		}
		if (inputTokens !== undefined || outputTokens !== undefined) {
			onEvent({ type: 'usage', inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens });
		}

		const anthropicThinkingBlocks: Record<string, unknown>[] = [];
		for (const block of blocks.values()) {
			if (block.type === 'thinking') { anthropicThinkingBlocks.push({ type: 'thinking', thinking: block.partial, signature: block.signature || '' }); }
			else if (block.type === 'redacted_thinking') { anthropicThinkingBlocks.push({ type: 'redacted_thinking', data: block.data || '' }); }
		}
		const message: IChatMessage = { role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined, anthropicThinkingBlocks: anthropicThinkingBlocks.length ? anthropicThinkingBlocks : undefined };
		return { message, stopReason };
	}

	private toAnthropic(req: IProviderRequest): { system?: string; messages: any[] } {
		let system = req.system;
		const messages: any[] = [];
		for (const m of req.messages) {
			if (m.role === 'system') {
				system = (system ? system + '\n\n' : '') + m.content;
			} else if (m.role === 'tool') {
				messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
			} else if (m.role === 'assistant' && m.toolCalls?.length) {
				const content: any[] = [];
				if (m.anthropicThinkingBlocks?.length) { content.push(...m.anthropicThinkingBlocks); }
				if (m.content) { content.push({ type: 'text', text: m.content }); }
				for (const tc of m.toolCalls) {
					let input: any = {};
					try { input = JSON.parse(tc.argumentsJson || '{}'); } catch { /* ignore */ }
					content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
				}
				messages.push({ role: 'assistant', content });
			} else if (m.role === 'user' && m.images?.length) {
				// Attached images: image blocks (base64) plus the text.
				const content: any[] = m.images.map(img => ({
					type: 'image',
					source: { type: 'base64', media_type: img.mimeType, data: img.data },
				}));
				content.push({ type: 'text', text: m.content || 'Mirá la imagen adjunta.' });
				messages.push({ role: 'user', content });
			} else {
				messages.push({ role: m.role, content: m.content });
			}
		}
		return { system, messages };
	}
}
