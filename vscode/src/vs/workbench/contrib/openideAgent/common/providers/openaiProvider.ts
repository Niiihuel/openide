/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — provider OpenAI-compatible (OpenAI, Groq, OpenRouter, Ollama, etc.) con streaming.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../../base/common/buffer.js';
import { listenStream } from '../../../../../base/common/stream.js';
import { asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { AgentStreamEvent, IChatMessage, ILLMProvider, IProviderRequest, IProviderResult, IToolCall } from '../openideAgentTypes.js';
import { openAIReasoningBody } from '../openideReasoning.js';
import { isToolCallingUnsupportedError, providerModelCapabilityKey } from '../openideProviderCapabilities.js';
import { sseDataOf } from '../openideSse.js';

interface IStreamAccum {
	text: string;
	reasoning: string;
	toolAcc: Map<number, { id: string; name: string; args: string }>;
	stopReason?: string;
	gotUsage: boolean;
}

export class OpenAICompatibleProvider implements ILLMProvider {

	readonly id = 'openai';

	constructor(private readonly requestService: IRequestService) { }

	/** Per endpoint/model learning: avoids paying every turn for a request we know is invalid. */
	private readonly modelsWithoutTools = new Set<string>();
	/**
	 * Empty-with-tools incidents per capability. One empty answer is NOT proof the endpoint lacks
	 * function calling — stealth/preview models return the occasional empty stream and recover on
	 * the next call. The first incident retries the SAME request once; a confirmed incident drops
	 * tools for that turn only; two confirmed incidents mark the capability for the session. A
	 * successful tools answer wipes the record. (The permanent mark used to land on the FIRST
	 * empty, which silently downgraded the whole session to a chat without read_file.)
	 */
	private readonly emptyToolStrikes = new Map<string, number>();

	resetSessionState(): void {
		this.modelsWithoutTools.clear();
		this.emptyToolStrikes.clear();
	}

	async streamChat(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		return this.streamChatAttempt(req, onEvent, token, false);
	}

	private async streamChatAttempt(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken, emptyRetried: boolean): Promise<IProviderResult> {
		const capabilityKey = providerModelCapabilityKey(req.providerId, req.baseUrl, req.model);
		if (req.tools?.length && this.modelsWithoutTools.has(capabilityKey)) {
			return this.streamChatAttempt(this.withoutTools(req), onEvent, token, emptyRetried);
		}
		const base = (req.baseUrl?.replace(/\/+$/, '')) || 'https://api.openai.com/v1';
		const url = `${base}/chat/completions`;

		const body: Record<string, unknown> = {
			model: req.model,
			messages: this.toMessages(req),
			stream: true,
			stream_options: { include_usage: true },
		};
		if (req.maxTokens) {
			body.max_tokens = req.maxTokens;
		}
		if (req.tools?.length) {
			body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
			body.tool_choice = 'auto';
		}
		Object.assign(body, openAIReasoningBody(req.providerId, base, req.model, req.effort));

		const state: IStreamAccum = { text: '', reasoning: '', toolAcc: new Map(), gotUsage: false };

		const bearer = req.credential.kind === 'apiKey' ? req.credential.value : req.credential.token;
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (bearer) {
			headers['Authorization'] = `Bearer ${bearer}`;
		}
		if (req.extraHeaders) {
			Object.assign(headers, req.extraHeaders);
		}

		const ctx = await this.requestService.request({
			type: 'POST',
			callSite: 'openideAgent',
			url,
			headers,
			data: JSON.stringify(body),
		}, token);

		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			const errBody = await asText(ctx);
			const detail = `HTTP ${status}: ${(errBody ?? '').slice(0, 800)}`;
			if (req.tools?.length && isToolCallingUnsupportedError(detail)) {
				// An EXPLICIT rejection is a capability statement, unlike an empty stream: remember it.
				this.modelsWithoutTools.add(capabilityKey);
				onEvent({ type: 'info', message: `${req.model} rechazó function calling; OpenIDE reintenta sin tools y recordará esta capacidad para esta sesión.` });
				return this.streamChatAttempt(this.withoutTools(req), onEvent, token, emptyRetried);
			}
			throw new Error(detail);
		}

		const contentType = String(ctx.res.headers?.['content-type'] ?? ctx.res.headers?.['Content-Type'] ?? '').toLowerCase();
		if (contentType.includes('text/event-stream')) {
			await this.consumeSse(ctx.stream, token, block => {
				const data = sseDataOf(block);
				if (!data || data === '[DONE]') {
					return;
				}
				let json: any;
				try { json = JSON.parse(data); } catch { return; }
				this.processPayload(json, state, onEvent);
			});
		} else {
			// Some backends (misconfigured vLLM/NIM) ignore stream:true and return a single JSON.
			const raw = await readAll(ctx.stream);
			let json: any;
			try { json = JSON.parse(raw); } catch {
				throw new Error(`Respuesta no parseable del provider (Content-Type: ${contentType || 'desconocido'}).`);
			}
			if (json.error) {
				const msg = typeof json.error === 'string' ? json.error : (json.error.message ?? JSON.stringify(json.error));
				throw new Error(String(msg));
			}
			this.processPayload(json, state, onEvent);
		}

		// NIM/GLM models that only emit reasoning_content in the stream.
		if (!state.text.trim() && state.reasoning.trim()) {
			state.text = state.reasoning;
			onEvent({ type: 'text', delta: state.reasoning });
		}

		const toolCalls = this.finalizeToolCalls(state.toolAcc);
		for (const c of toolCalls) {
			onEvent({ type: 'toolCall', call: c });
		}

		const message: IChatMessage = { role: 'assistant', content: state.text, toolCalls: toolCalls.length ? toolCalls : undefined };
		const result: IProviderResult = { message, stopReason: state.stopReason };
		// Empty response with tools sent: several NIM models do not support function calling and
		// return an empty stream. We retry WITHOUT tools — the agent loses tools for that turn
		// but at least answers (better than the "replied empty" error).
		const empty = !result.message.content?.trim() && !(result.message.toolCalls?.length);
		if (empty && req.tools?.length) {
			if (!emptyRetried) {
				// Transient blip until proven otherwise: the same request, once more, with tools.
				onEvent({ type: 'info', message: `${req.model} devolvió una respuesta vacía; OpenIDE reintenta.` });
				return this.streamChatAttempt(req, onEvent, token, true);
			}
			const strikes = (this.emptyToolStrikes.get(capabilityKey) ?? 0) + 1;
			this.emptyToolStrikes.set(capabilityKey, strikes);
			if (strikes >= 2) {
				this.modelsWithoutTools.add(capabilityKey);
				onEvent({ type: 'info', message: `${req.model} volvió a responder vacío con tools; OpenIDE seguirá sin tools con este modelo durante esta sesión.` });
			} else {
				onEvent({ type: 'info', message: `${req.model} devolvió una respuesta vacía con tools; este turno sigue sin ellas y el próximo vuelve a intentarlo.` });
			}
			return this.streamChatAttempt(this.withoutTools(req), onEvent, token, true);
		}
		if (req.tools?.length && !empty) {
			// A healthy tools answer clears the record: the incidents were the model's bad day.
			this.emptyToolStrikes.delete(capabilityKey);
		}
		return result;
	}

	private withoutTools(req: IProviderRequest): IProviderRequest {
		return {
			...req,
			tools: [],
			system: `${req.system ?? ''}\n\nCAPACIDAD DEL MODELO: el endpoint rechazó function calling. Respondé sin tools y no afirmes haber ejecutado acciones en OpenIDE.`.trim(),
		};
	}

	private processPayload(json: any, state: IStreamAccum, onEvent: (e: AgentStreamEvent) => void): void {
		if (json.usage && !state.gotUsage) {
			const promptTokens = Number(json.usage.prompt_tokens ?? json.usage.input_tokens);
			const outputTokens = Number(json.usage.completion_tokens ?? json.usage.output_tokens);
			const cached = Number(json.usage.prompt_tokens_details?.cached_tokens ?? json.usage.input_tokens_details?.cached_tokens ?? 0);
			if (Number.isFinite(promptTokens) || Number.isFinite(outputTokens) || cached > 0) {
				state.gotUsage = true;
				onEvent({
					type: 'usage',
					inputTokens: Math.max(0, (Number.isFinite(promptTokens) ? promptTokens : 0) - cached),
					outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
					cacheReadTokens: cached || undefined,
				});
			}
		}
		const choice = json.choices?.[0];
		if (choice) {
			this.processChoice(choice, state, onEvent);
		}
	}

	private processChoice(choice: any, state: IStreamAccum, onEvent: (e: AgentStreamEvent) => void): void {
		const delta = choice.delta ?? {};
		const message = choice.message ?? {};

		const content = delta.content ?? message.content;
		if (typeof content === 'string' && content.length) {
			state.text += content;
			onEvent({ type: 'text', delta: content });
		}

		// NIM/vLLM/TGI emiten el razonamiento en campos inconsistentes: reasoning_content
		// (standard), reasoning, thinking or thought. GLM on NIM puts the WHOLE response here and
		// leaves content empty — we capture all of them (kilocode#7350, NVIDIA Developer forum #366612).
		const reasoning = delta.reasoning_content ?? message.reasoning_content
			?? delta.reasoning ?? message.reasoning
			?? delta.thinking ?? message.thinking
			?? delta.thought ?? message.thought;
		if (typeof reasoning === 'string' && reasoning.length) {
			state.reasoning += reasoning;
			onEvent({ type: 'reasoning', delta: reasoning });
		}

		this.accumulateToolCalls(delta.tool_calls, state.toolAcc, onEvent);
		this.accumulateToolCalls(message.tool_calls, state.toolAcc, onEvent);

		const fc = delta.function_call ?? message.function_call;
		if (fc?.name) {
			let acc = state.toolAcc.get(0);
			if (!acc) {
				acc = { id: 'call_0', name: '', args: '' };
				state.toolAcc.set(0, acc);
			}
			acc.name += fc.name;
			if (fc.arguments) { acc.args += fc.arguments; }
		}

		if (choice.finish_reason) {
			state.stopReason = choice.finish_reason;
		}
	}

	private accumulateToolCalls(toolCalls: unknown, toolAcc: Map<number, { id: string; name: string; args: string }>, onEvent?: (ev: AgentStreamEvent) => void): void {
		if (!Array.isArray(toolCalls) || !toolCalls.length) {
			return;
		}
		for (const tc of toolCalls) {
			const fn = tc?.function;
			const namePart = fn?.name;
			// vLLM/NIM a veces manda tool_calls: [{ function: { name: "", arguments: "" } }] — ignorar.
			if (!namePart && !fn?.arguments) {
				continue;
			}
			const idx = typeof tc.index === 'number' ? tc.index : toolAcc.size;
			let acc = toolAcc.get(idx);
			if (!acc) {
				acc = { id: tc.id || `call_${idx}`, name: '', args: '' };
				toolAcc.set(idx, acc);
			}
			if (tc.id) { acc.id = tc.id; }
			if (namePart) { acc.name += namePart; }
			if (fn?.arguments) {
				acc.args += fn.arguments;
				// The name arrives in the first chunk and the arguments afterwards; without a name there is
				// no way to know which tool it belongs to, so that case is not emitted.
				if (acc.name.trim()) { onEvent?.({ type: 'toolCallDelta', id: acc.id, name: acc.name, argumentsJson: acc.args }); }
			}
		}
	}

	private finalizeToolCalls(toolAcc: Map<number, { id: string; name: string; args: string }>): IToolCall[] {
		return [...toolAcc.values()]
			.filter(a => a.name.trim())
			.map(a => ({ id: a.id, name: a.name, argumentsJson: a.args || '{}' }));
	}

	private consumeSse(stream: VSBufferReadableStream, token: CancellationToken, onBlock: (block: string) => void): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let buffer = '';
			listenStream(stream, {
				onData: (chunk: VSBuffer) => {
					buffer = (buffer + chunk.toString()).replace(/\r\n/g, '\n');
					let idx: number;
					while ((idx = buffer.indexOf('\n\n')) !== -1) {
						const block = buffer.slice(0, idx);
						buffer = buffer.slice(idx + 2);
						if (block.trim()) {
							onBlock(block);
						}
					}
				},
				onError: err => reject(err),
				onEnd: () => {
					if (buffer.trim()) {
						onBlock(buffer);
					}
					resolve();
				},
			}, token);
		});
	}

	private toMessages(req: IProviderRequest): any[] {
		const out: any[] = [];
		if (req.system) {
			out.push({ role: 'system', content: req.system });
		}
		for (const m of req.messages) {
			if (m.role === 'tool') {
				out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
			} else if (m.role === 'assistant' && m.toolCalls?.length) {
				out.push({
					role: 'assistant',
					content: m.content || null,
					tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argumentsJson } })),
				});
			} else if (m.role === 'user' && m.images?.length) {
				const content: any[] = [{ type: 'text', text: m.content || 'Mirá la imagen adjunta.' }];
				for (const img of m.images) {
					content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
				}
				out.push({ role: 'user', content });
			} else {
				out.push({ role: m.role, content: m.content });
			}
		}
		return out;
	}
}

function readAll(stream: VSBufferReadableStream): Promise<string> {
	return new Promise<string>(resolve => {
		let buf = '';
		listenStream(stream, {
			onData: (c: VSBuffer) => { buf += c.toString(); },
			onError: () => resolve(buf),
			onEnd: () => resolve(buf),
		});
	});
}
