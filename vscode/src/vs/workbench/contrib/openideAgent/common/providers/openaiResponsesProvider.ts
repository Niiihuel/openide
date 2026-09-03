/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — adaptador para la Responses API oficial de OpenAI.
 *
 *  Used for recent OpenAI models that do not guarantee compatibility with /chat/completions
 *  (for example, GPT-5.6 during its preview). It keeps the same streaming contract as the
 *  other protocols and requires a terminal Responses event: it never turns an EOF or a failed
 *  response into a silent "done".
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { AgentStreamEvent, IChatMessage, ILLMProvider, IProviderRequest, IProviderResult, IToolCall } from '../openideAgentTypes.js';
import { normalizeReasoningEffort } from '../openideReasoning.js';
import { stablePromptCacheKey } from '../openideAgentEfficiency.js';
import { sseDataOf, ssePost } from '../openideSse.js';

function errorText(value: any): string | undefined {
	const error = value?.error ?? value;
	const text = [error?.code, error?.message].filter(Boolean).join(': ');
	return text || undefined;
}

/** Converts the internal history into the Responses item format. */
function toInput(messages: IChatMessage[]): any[] {
	const input: any[] = [];
	for (const m of messages) {
		if (m.role === 'user') {
			if (m.images?.length) {
				const content: any[] = [{ type: 'input_text', text: m.content || 'Mirá la imagen adjunta.' }];
				for (const image of m.images) {
					content.push({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` });
				}
				input.push({ role: 'user', content });
			} else {
				input.push({ role: 'user', content: m.content });
			}
		} else if (m.role === 'assistant') {
			if (m.content) {
				input.push({ role: 'assistant', content: m.content });
			}
			for (const call of m.toolCalls ?? []) {
				input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.argumentsJson || '{}' });
			}
		} else if (m.role === 'tool') {
			input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
		}
	}
	return input;
}

export class OpenAIResponsesProvider implements ILLMProvider {

	readonly id = 'openai-responses';

	constructor(private readonly requestService: IRequestService) { }

	async streamChat(req: IProviderRequest, onEvent: (event: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		const base = (req.baseUrl?.replace(/\/+$/, '')) || 'https://api.openai.com/v1';
		const url = `${base}/responses`;
		const bearer = req.credential.kind === 'apiKey' ? req.credential.value : req.credential.token;
		const tools = (req.tools ?? []).map(tool => ({
			type: 'function', name: tool.name, description: tool.description, strict: false,
			parameters: tool.parameters ?? { type: 'object', properties: {} },
		}));

		const instructions = req.system || 'You are a helpful coding assistant.';
		const body: Record<string, unknown> = {
			model: req.model,
			instructions,
			input: toInput(req.messages),
			store: false,
			stream: true,
			prompt_cache_key: stablePromptCacheKey(instructions, JSON.stringify(tools)),
		};
		if (req.maxTokens) {
			body.max_output_tokens = req.maxTokens;
		}
		const model = req.model.toLowerCase();
		const effort = normalizeReasoningEffort(req.effort);
		if (effort && (model.startsWith('gpt-5') || /^o[1-9]/.test(model))) {
			// Responses does not accept `none`; GPT-5 does accept minimal, while the o* models use low.
			const mapped = effort === 'none' ? (model.startsWith('gpt-5') ? 'minimal' : 'low') : effort === 'minimal' ? (model.startsWith('gpt-5') ? 'minimal' : 'low') : effort === 'xhigh' || effort === 'max' ? (model.startsWith('gpt-5.6') ? 'xhigh' : 'high') : effort;
			body.reasoning = { effort: mapped };
		}
		if (tools.length) {
			body.tools = tools;
			body.tool_choice = 'auto';
			body.parallel_tool_calls = true;
		}

		const headers: Record<string, string> = {
			'Accept': 'text/event-stream',
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearer}`,
		};
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
			if (!data) {
				return;
			}
			let json: any;
			try {
				json = JSON.parse(data);
			} catch {
				return;
			}
			const type = String(json.type ?? '');

			if (type === 'error') {
				errorFrame = errorText(json) ?? 'error del proveedor';
				return;
			}
			if (type.includes('output_text.delta')) {
				const delta = typeof json.delta === 'string' ? json.delta : '';
				if (delta) {
					text += delta;
					onEvent({ type: 'text', delta });
				}
				return;
			}
			if (type.includes('reasoning') && type.includes('delta')) {
				const delta = typeof json.delta === 'string' ? json.delta : '';
				if (delta) {
					onEvent({ type: 'reasoning', delta });
				}
				return;
			}
			// Arguments of a function_call as they are written (see codexProvider): without this,
			// a long call such as plan_save appears all at once only when it closes.
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
				const delta = typeof json.delta === 'string' ? json.delta : '';
				if (acc && delta) {
					acc.args += delta;
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
				const response = json.response ?? {};
				stopReason = String(response.status ?? type.replace('response.', ''));
				if (type === 'response.failed') {
					errorFrame = errorText(response) ?? errorFrame ?? 'respuesta fallida';
				}
				if (type === 'response.incomplete') {
					const details = response.incomplete_details ?? {};
					const detailText = [details.reason, details.message].filter(Boolean).join(': ');
					incompleteReason = errorText(details) ?? (detailText || undefined);
				}
				const usage = response.usage;
				if (usage) {
					const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0);
					onEvent({
						type: 'usage',
						inputTokens: Math.max(0, Number(usage.input_tokens ?? 0) - cached),
						outputTokens: Number(usage.output_tokens ?? 0),
						cacheReadTokens: cached || undefined,
					});
				}
			}
		});

		// The caller already discards the result of a cancellation; returning a valid shape prevents
		// a voluntary abort from turning into a connection alert.
		if (token.isCancellationRequested) {
			return { message: { role: 'assistant', content: text }, stopReason: 'cancelled' };
		}
		if (!terminalEvent) {
			throw new Error('OpenAI Responses: stream ended before terminal event (la conexión se cerró antes de finalizar la respuesta).');
		}
		if (errorFrame) {
			throw new Error(`OpenAI Responses: ${errorFrame}`);
		}
		if (terminalEvent === 'response.incomplete') {
			const reasonLower = (incompleteReason ?? '').toLowerCase();
			const isMaxOutput = reasonLower.includes('max_output_tokens') || reasonLower.includes('max tokens') || reasonLower.includes('length');
			if (isMaxOutput && text.trim()) {
				return { message: { role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined }, stopReason: 'max_output_tokens' };
			}
			throw new Error(`OpenAI Responses: respuesta incompleta${incompleteReason ? ` (${incompleteReason})` : ''}.`);
		}

		return {
			message: { role: 'assistant', content: text, toolCalls: toolCalls.length ? toolCalls : undefined },
			stopReason,
		};
	}
}
