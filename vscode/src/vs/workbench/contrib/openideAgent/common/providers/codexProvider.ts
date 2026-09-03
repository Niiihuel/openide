/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — adapter for the ChatGPT Codex backend (Responses API at
 *  chatgpt.com/backend-api/codex/responses, ChatGPT Plus/Pro subscription via OAuth).
 *  Adaptador del protocolo Responses usado por Codex. Reglas del backend: Reglas duras del backend:
 *  - store:false ALWAYS (and therefore NEVER replay items with an id → 404).
 *  - NO soporta max_output_tokens ni temperature (400).
 *  - tools is omitted entirely when there are no functions (FLAT shape, not nested in function).
 *  - headers originator + User-Agent codex-shaped (Cloudflare) + ChatGPT-Account-ID (del JWT).
 *  - the output is rebuilt ONLY from response.output_item.done (completed.output may be null).
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { AgentStreamEvent, IChatMessage, ILLMProvider, IProviderRequest, IProviderResult, IToolCall } from '../openideAgentTypes.js';
import { chatGptAccountIdFromJwt } from '../openideJwt.js';
import { stablePromptCacheKey } from '../openideAgentEfficiency.js';
import { sseDataOf, ssePost } from '../openideSse.js';

export class CodexProvider implements ILLMProvider {

	readonly id = 'codex';

	constructor(private readonly requestService: IRequestService) { }

	async streamChat(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		const base = (req.baseUrl?.replace(/\/+$/, '')) || 'https://chatgpt.com/backend-api/codex';
		const url = `${base}/responses`;
		const bearer = req.credential.kind === 'apiKey' ? req.credential.value : req.credential.token;

		// ---- input items (historial → Responses API) ----
		const input: any[] = [];
		for (const m of req.messages) {
			if (m.role === 'user') {
				if (m.images?.length) {
					const content: any[] = [{ type: 'input_text', text: m.content || 'Mirá la imagen adjunta.' }];
					for (const img of m.images) {
						content.push({ type: 'input_image', image_url: `data:${img.mimeType};base64,${img.data}` });
					}
					input.push({ role: 'user', content });
				} else {
					input.push({ role: 'user', content: m.content });
				}
			} else if (m.role === 'assistant') {
				if (m.content) {
					input.push({ role: 'assistant', content: m.content });
				}
				for (const c of m.toolCalls ?? []) {
					input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.argumentsJson || '{}' });
				}
			} else if (m.role === 'tool') {
				input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
			}
		}

		const toolDefs = (req.tools ?? []).map(t => ({
			type: 'function', name: t.name, description: t.description, strict: false,
			parameters: t.parameters ?? { type: 'object', properties: {} },
		}));

		const instructions = req.system || 'You are a helpful coding assistant.';
		// The Codex wire REQUIRES reasoning. GPT-5.6 supports Extra High; earlier families
		// keep the clamp to high so sessions on a legacy model do not break.
		const supportsExtraHigh = req.model.toLowerCase().startsWith('gpt-5.6');
		const effortMap: Record<string, string> = { none: 'low', minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: supportsExtraHigh ? 'xhigh' : 'high', max: supportsExtraHigh ? 'xhigh' : 'high' };
		const codexEffort = effortMap[(req.effort ?? '').toLowerCase()] ?? 'medium';
		const body: Record<string, unknown> = {
			model: req.model,
			instructions,
			input,
			store: false,
			stream: true,
			reasoning: { effort: codexEffort, summary: 'auto' },
			include: [],
			prompt_cache_key: stablePromptCacheKey(instructions, JSON.stringify(toolDefs)),
		};
		if (toolDefs.length) {
			body.tools = toolDefs;
			body.tool_choice = 'auto';
			body.parallel_tool_calls = true;
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearer}`,
			'User-Agent': 'codex_cli_rs/0.0.0 (OpenIDE)',
			'originator': 'codex_cli_rs',
		};
		const accountId = bearer ? chatGptAccountIdFromJwt(bearer) : undefined;
		if (accountId) {
			headers['ChatGPT-Account-ID'] = accountId;
		}
		if (req.extraHeaders) {
			Object.assign(headers, req.extraHeaders);
		}

		let text = '';
		const toolCalls: IToolCall[] = [];
		let stopReason: string | undefined;
		let errorFrame: string | undefined;
		let terminalEvent: 'response.completed' | 'response.incomplete' | 'response.failed' | undefined;
		let incompleteReason: string | undefined;
		/** in-flight function_calls, by item_id: they accumulate their arguments as they are written. */
		const streamingCalls = new Map<string, { id: string; name: string; args: string }>();

		await ssePost(this.requestService, { url, headers, body: JSON.stringify(body) }, token, block => {
			const data = sseDataOf(block);
			if (!data) { return; }
			let json: any;
			try { json = JSON.parse(data); } catch { return; }
			const type = String(json.type ?? '');

			if (type === 'error') {
				// NON-terminal frame: the real cause arrives here (quota/model unavailable/etc.)
				errorFrame = [json.code, json.message].filter(Boolean).join(': ') || 'error del proveedor';
				return;
			}
			if (type.includes('output_text.delta')) {
				const d = typeof json.delta === 'string' ? json.delta : '';
				if (d) {
					text += d;
					onEvent({ type: 'text', delta: d });
				}
				return;
			}
			if (type.includes('reasoning') && type.includes('delta')) {
				const d = typeof json.delta === 'string' ? json.delta : '';
				if (d) {
					onEvent({ type: 'reasoning', delta: d });
				}
				return;
			}
			// The arguments of a function_call arrive in chunks BEFORE output_item.done.
			// Without this only the closed call is visible, and a long plan appears all at once after
			// minutes of silence. The name comes in output_item.added, the chunks afterwards.
			if (type === 'response.output_item.added') {
				const item = json.item;
				if (item?.type === 'function_call' && item.name) {
					streamingCalls.set(String(item.id ?? item.call_id ?? ''), {
						id: String(item.call_id ?? item.id ?? ''), name: String(item.name), args: '',
					});
				}
				return;
			}
			if (type === 'response.function_call_arguments.delta') {
				const acc = streamingCalls.get(String(json.item_id ?? ''));
				const d = typeof json.delta === 'string' ? json.delta : '';
				if (acc && d) {
					acc.args += d;
					onEvent({ type: 'toolCallDelta', id: acc.id, name: acc.name, argumentsJson: acc.args });
				}
				return;
			}
			if (type === 'response.output_item.done') {
				const item = json.item;
				if (item?.type === 'function_call' && item.name) {
					toolCalls.push({
						id: String(item.call_id ?? item.id ?? `call_${toolCalls.length}`),
						name: String(item.name),
						argumentsJson: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
					});
				}
				return;
			}
			if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
				terminalEvent = type;
				const resp = json.response ?? {};
				stopReason = String(resp.status ?? type.replace('response.', ''));
				if (type === 'response.failed') {
					errorFrame = [resp.error?.code, resp.error?.message].filter(Boolean).join(': ') || errorFrame || 'respuesta fallida';
				}
				if (type === 'response.incomplete') {
					const details = resp.incomplete_details ?? {};
					incompleteReason = [details.reason, details.message].filter(Boolean).join(': ') || undefined;
				}
				const usage = resp.usage;
				if (usage) {
					// input_tokens INCLUYE los cacheados; cached_tokens los separa
					const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
					onEvent({
						type: 'usage',
						inputTokens: Math.max(0, Number(usage.input_tokens ?? 0) - cached),
						outputTokens: Number(usage.output_tokens ?? 0),
						cacheReadTokens: cached || undefined,
					});
				}
				return;
			}
		});

		// The caller discards a voluntary cancellation. We do not surface it as a network error.
		if (token.isCancellationRequested) {
			return { message: { role: 'assistant', content: text }, stopReason: 'cancelled' };
		}
		// Previously an EOF, response.failed or response.incomplete with partial text turned into
		// a normal `done`. That made ChatGPT look like it "cut off" without explaining why.
		if (!terminalEvent) {
			throw new Error('Codex: stream ended before terminal event (la conexión se cerró antes de finalizar la respuesta).');
		}
		if (errorFrame) {
			throw new Error(`Codex: ${errorFrame}`);
		}
		// response.incomplete due to max_output_tokens: we return the partial text with a stopReason
		// the agent loop knows how to handle (automatic continuation). Other incomplete reasons
		// (content filter, etc.) are real errors.
		if (terminalEvent === 'response.incomplete') {
			const reasonLower = (incompleteReason ?? '').toLowerCase();
			const isMaxOutput = reasonLower.includes('max_output_tokens') || reasonLower.includes('max tokens') || reasonLower.includes('length');
			if (isMaxOutput) {
				// With high reasoning, Codex can burn the whole budget before the first visible token.
				// It is still continuable: the loop adds a wire-only turn asking it to carry on.
				return { message: { role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined }, stopReason: 'max_output_tokens' };
			}
			throw new Error(`Codex: respuesta incompleta${incompleteReason ? ` (${incompleteReason})` : ''}.`);
		}
		const message: IChatMessage = { role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined };
		return { message, stopReason };
	}
}
