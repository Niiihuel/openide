/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — adaptador del protocolo Gemini "Cloud Code" (Code Assist API): los modelos Gemini
 *  with a GOOGLE ACCOUNT LOGIN (the Gemini CLI / Antigravity plan), without an API key.
 *
 *  Flow: (1) once per session, loadCodeAssist resolves the account's managed project (if none
 *  exists, onboardUser creates it — an LRO polled until done); (2) every turn goes to
 *  v1internal:streamGenerateContent?alt=sse with the body {model, project, request} where
 *  request is Gemini's standard GenerateContentRequest (contents/systemInstruction/tools).
 *  The SSE events carry the GenerateContentResponse wrapped in {response: …}.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { raceCancellation, timeout } from '../../../../../base/common/async.js';
import { VSBuffer, VSBufferReadableStream } from '../../../../../base/common/buffer.js';
import { listenStream } from '../../../../../base/common/stream.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { AgentStreamEvent, IChatMessage, ILLMProvider, IProviderModelsRequest, IProviderRequest, IProviderResult, IToolCall } from '../openideAgentTypes.js';
import { ssePost } from '../openideSse.js';
import { modelIdsFromProviderResponse } from '../openideProviderCapabilities.js';
import { appendGeminiParts, sanitizeGeminiParts, thoughtSignatureOf } from './geminiParts.js';

const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
const CLIENT_METADATA = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };
const USER_AGENT = 'GeminiCLI/0.10.0 (linux; x64)';

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function asStringId(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value || undefined;
	}
	const object = asObject(value);
	return typeof object?.id === 'string' && object.id ? object.id : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

/** Subset of JSON Schema the Gemini API accepts in functionDeclarations —
 *  campos desconocidos (additionalProperties, $schema…) hacen fallar el request entero. */
const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems']);
function cleanSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}
	if (Array.isArray(schema)) {
		return schema.map(cleanSchema);
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		if (!SCHEMA_KEYS.has(key)) {
			continue;
		}
		if (key === 'properties' && value && typeof value === 'object') {
			out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cleanSchema(v)]));
		} else {
			out[key] = cleanSchema(value);
		}
	}
	return out;
}

export class GeminiCloudCodeProvider implements ILLMProvider {

	readonly id = 'gemini-cloudcode';

	/** Managed Code Assist project, resolved once per window. */
	private projectId: string | undefined;

	/** The project the chat already resolved (after onboarding): the quota is keyed on it. */
	get resolvedProjectId(): string | undefined {
		return this.projectId;
	}

	constructor(
		private readonly requestService: IRequestService,
		/** The user's GCP project (setting openide.agent.googleCloudProject) — required by the
		 *  cuentas Workspace/licenciadas; las personales usan el proyecto administrado. */
		private readonly getProjectOverride?: () => string | undefined,
	) { }

	resetSessionState(): void {
		this.projectId = undefined;
	}

	/** Antigravity publishes the account's effective catalog (including rollout, plan and quota).
	 *  It is the only authoritative source: internal ids change and do not always match the
	 *  nombre visible del modelo. */
	async listModels(req: IProviderModelsRequest, token: CancellationToken): Promise<readonly string[]> {
		if (req.credential.kind !== 'oauth') {
			return [];
		}
		const bearer = req.credential.token;
		const project = await this.ensureProject(bearer, token, req.cloudCodeMetadata, req.extraHeaders);
		const base = req.baseUrl?.replace(/\/+$/, '') || 'https://cloudcode-pa.googleapis.com';
		const response = await this.postJson(`${base}/v1internal:fetchAvailableModels`, bearer, { project }, token, req.extraHeaders, 'models');
		return modelIdsFromProviderResponse(response);
	}

	private headers(bearer: string, extra?: Record<string, string>): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearer}`,
			'User-Agent': USER_AGENT,
			...(extra ?? {}),
		};
	}

	private async postJson(url: string, bearer: string, body: unknown, token: CancellationToken, extraHeaders?: Record<string, string>, stage = 'request'): Promise<unknown> {
		const ctx = await this.requestService.request({
			type: 'POST', url, headers: this.headers(bearer, extraHeaders),
			data: JSON.stringify(body), callSite: 'openideAgent',
		}, token);
		const text = await readAll(ctx.stream);
		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			throw new Error(`HTTP ${status} [gemini-cloudcode:${stage}]: ${text.slice(0, 600)}`);
		}
		try {
			return text ? JSON.parse(text) : {};
		} catch {
			return {};
		}
	}

	/** loadCodeAssist → (onboardUser when needed) → project id. Mirrors the setupUser of the
	 *  official Gemini CLI: if load returns currentTier the account is ALREADY onboarded (the
	 *  project comes with it); otherwise onboardUser with the default tier is an LRO re-posted
	 *  until done. The user's project (setting) wins when the tier demands it (Workspace). */
	private async ensureProject(bearer: string, token: CancellationToken, cloudCodeMetadata?: Record<string, string>, extraHeaders?: Record<string, string>): Promise<string> {
		if (this.projectId) {
			return this.projectId;
		}
		const override = (this.getProjectOverride?.() ?? '').trim() || undefined;
		const metadata: Record<string, string> = { ...(cloudCodeMetadata ?? CLIENT_METADATA) };
		if (override) {
			metadata.duetProject = override;
		}
		const load = await this.postJson(`${CODE_ASSIST_BASE}:loadCodeAssist`, bearer, {
			...(override ? { cloudaicompanionProject: override } : {}),
			metadata,
		}, token, extraHeaders, 'loadCodeAssist');
		const loadObject = asObject(load);
		// account already onboarded: the project (managed or own) comes in the load
		if (loadObject?.currentTier) {
			const project = asStringId(loadObject.cloudaicompanionProject) ?? override;
			if (project) {
				this.projectId = project;
				return project;
			}
			throw new Error('Google Code Assist: tu cuenta requiere un proyecto GCP propio (Workspace/licencia). Configurá "openide.agent.googleCloudProject" con el id de un proyecto que tenga habilitada la API "Gemini for Google Cloud" y reintentá.');
		}
		// primera vez: activar el tier default — LRO re-posteada. Si el default (standard/
		// enterprise, subscription accounts) requires the user's own GCP project and the user has
		// not configured one, it falls back to the FREE tier (works with any consumer account; the
		// "openide.agent.googleCloudProject" setting enables the paid tier once they fill it in).
		const tier = Array.isArray(loadObject?.allowedTiers)
			? loadObject.allowedTiers.map(asObject).find(candidate => candidate?.isDefault === true)
			: undefined;
		let tierId = asStringId(tier?.id) || 'free-tier';
		const onboardBody: Record<string, unknown> = { tierId, metadata };
		if (tier?.userDefinedCloudaicompanionProject) {
			if (override) {
				onboardBody.cloudaicompanionProject = override;
			} else {
				tierId = 'free-tier';
				onboardBody.tierId = tierId;
			}
		}
		let lastOp: unknown;
		for (let i = 0; i < 30; i++) {
			lastOp = await this.postJson(`${CODE_ASSIST_BASE}:onboardUser`, bearer, onboardBody, token, extraHeaders, 'onboardUser');
			const operation = asObject(lastOp);
			if (operation?.done === true) {
				const response = asObject(operation.response);
				const project = asStringId(response?.cloudaicompanionProject) ?? override;
				if (project) {
					this.projectId = project;
					return project;
				}
				break;
			}
			await raceCancellation(timeout(3000), token);
			if (token.isCancellationRequested) {
				throw new Error('Onboarding cancelado.');
			}
		}
		throw new Error(`Google Code Assist: el onboarding no completó (tier ${tierId}). Última respuesta: ${JSON.stringify(lastOp ?? {}).slice(0, 300)}. Si tu cuenta es Workspace, configurá "openide.agent.googleCloudProject"; si es personal, probá de nuevo en unos minutos (la activación del tier gratis puede demorar).`);
	}

	/** Copies the parts sanitizing the oneof: a saved session with an invalid part used to blow up
	 *  on every turn with an HTTP 400 that named a `contents` index and nothing else. */
	private cloneGeminiParts(parts: Record<string, unknown>[]): Record<string, unknown>[] {
		return sanitizeGeminiParts(parts);
	}

	private partThoughtSignature(part: any): string | undefined {
		return thoughtSignatureOf(part as Record<string, unknown> | undefined);
	}

	/** Maps internal messages to Gemini's `contents` shape (functionCall/functionResponse). */
	private toContents(req: IProviderRequest): any[] {
		const contents: any[] = [];
		const callNames = new Map<string, string>(); // toolCallId → nombre (functionResponse lo exige)
		for (const m of req.messages) {
			if (m.role === 'assistant') {
				for (const tc of m.toolCalls ?? []) {
					callNames.set(tc.id, tc.name);
				}
				// Gemini 3 requires resending the model parts with thoughtSignature intact.
				if (m.geminiParts?.length) {
					contents.push({ role: 'model', parts: this.cloneGeminiParts(m.geminiParts) });
					continue;
				}
				const parts: any[] = [];
				if (m.content) {
					parts.push({ text: m.content });
				}
				for (const tc of m.toolCalls ?? []) {
					let args: unknown = {};
					try { args = JSON.parse(tc.argumentsJson || '{}'); } catch { /* args malformados: objeto vacío */ }
					const part: Record<string, unknown> = { functionCall: { name: tc.name, args } };
					if (tc.thoughtSignature) {
						part.thoughtSignature = tc.thoughtSignature;
					}
					parts.push(part);
				}
				if (parts.length) {
					contents.push({ role: 'model', parts });
				}
			} else if (m.role === 'tool') {
				const name = callNames.get(m.toolCallId ?? '') ?? 'tool';
				contents.push({
					role: 'user',
					parts: [{ functionResponse: { name, response: { output: m.content } } }],
				});
			} else if (m.role === 'user') {
				const parts: Record<string, unknown>[] = [{ text: m.content || ' ' }];
				for (const img of m.images ?? []) {
					parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
				}
				contents.push({ role: 'user', parts });
			}
		}
		return contents;
	}

	async streamChat(req: IProviderRequest, onEvent: (e: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		if (req.credential.kind !== 'oauth') {
			throw new Error('Google (Gemini/Antigravity) requiere login con tu cuenta de Google (OAuth) — no usa API key. Iniciá sesión desde la página de Proveedores.');
		}
		const bearer = req.credential.token;
		const project = await this.ensureProject(bearer, token, req.cloudCodeMetadata, req.extraHeaders);

		const request: Record<string, unknown> = {
			contents: this.toContents(req),
		};
		if (req.system) {
			request.systemInstruction = { parts: [{ text: req.system }] };
		}
		if (req.tools?.length) {
			request.tools = [{
				functionDeclarations: req.tools.map(t => ({
					name: t.name,
					description: t.description,
					parameters: cleanSchema(t.parameters),
				})),
			}];
		}
		const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens ?? 8192 };
		const effort = (req.effort ?? '').toLowerCase();
		if (effort !== 'none') {
			// visible thinking (deltas with thought=true go to the reasoning panel)
			generationConfig.thinkingConfig = { includeThoughts: true };
		}
		request.generationConfig = generationConfig;

		const body = { model: req.model, project, request, userAgent: 'antigravity', requestId: `openide-${Date.now().toString(36)}` };
		const url = `${(req.baseUrl?.replace(/\/+$/, '') || 'https://cloudcode-pa.googleapis.com')}/v1internal:streamGenerateContent?alt=sse`;

		let text = '';
		const toolCalls: IToolCall[] = [];
		let geminiParts: Record<string, unknown>[] = [];
		let stopReason: string | undefined;
		let inputTokens: number | undefined;
		let outputTokens: number | undefined;
		let cacheReadTokens: number | undefined;
		let callSeq = 0;

		try {
		await ssePost(this.requestService, { url, headers: this.headers(bearer, req.extraHeaders), body: JSON.stringify(body) }, token, block => {
			for (const line of block.split('\n')) {
				if (!line.startsWith('data:')) {
					continue;
				}
				const payload = line.slice(5).trim();
				if (!payload || payload === '[DONE]') {
					continue;
				}
				let parsed: unknown;
				try { parsed = JSON.parse(payload); } catch { continue; }
				const envelope = asObject(parsed);
				const resp = asObject(envelope?.response) ?? envelope;
				const candidates = Array.isArray(resp?.candidates) ? resp.candidates : [];
				const candidate = asObject(candidates[0]);
				const content = asObject(candidate?.content);
				const incomingParts = Array.isArray(content?.parts)
					? content.parts.map(asObject).filter((part): part is Record<string, unknown> => !!part)
					: [];
				if (incomingParts.length) {
					geminiParts = appendGeminiParts(geminiParts, incomingParts);
				}
				for (const part of incomingParts) {
					if (typeof part.text === 'string' && part.text) {
						if (part.thought === true) {
							onEvent({ type: 'reasoning', delta: part.text });
						} else {
							text += part.text;
							onEvent({ type: 'text', delta: part.text });
						}
					}
				}
				if (candidate?.finishReason) {
					stopReason = String(candidate.finishReason).toLowerCase();
				}
				const usage = asObject(resp?.usageMetadata);
				if (usage) {
					inputTokens = asNumber(usage.promptTokenCount) ?? inputTokens;
					outputTokens = asNumber(usage.candidatesTokenCount) ?? outputTokens;
					cacheReadTokens = asNumber(usage.cachedContentTokenCount) ?? cacheReadTokens;
				}
			}
		});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/HTTP 404\b|NOT_FOUND|Requested entity was not found/i.test(message)) {
				// The managed project may have expired or switched accounts. The next run must resolve it
				// again; the router will decide whether to try another model.
				this.projectId = undefined;
				throw new Error(`HTTP 404 [gemini-cloudcode:streamGenerateContent] model=${req.model}: Requested entity was not found.`);
			}
			throw error;
		}

		for (const part of geminiParts) {
			const functionCall = asObject(part.functionCall);
			if (typeof functionCall?.name !== 'string' || !functionCall.name) {
				continue;
			}
			const thoughtSignature = this.partThoughtSignature(part);
			const call: IToolCall = {
				id: String(functionCall.id ?? `call_${Date.now().toString(36)}_${callSeq++}`),
				name: functionCall.name,
				argumentsJson: JSON.stringify(functionCall.args ?? {}),
				...(thoughtSignature ? { thoughtSignature } : {}),
			};
			toolCalls.push(call);
			onEvent({ type: 'toolCall', call });
		}

		if (inputTokens !== undefined || outputTokens !== undefined) {
			onEvent({ type: 'usage', inputTokens: Math.max(0, (inputTokens ?? 0) - (cacheReadTokens ?? 0)), outputTokens, cacheReadTokens });
		}
		const message: IChatMessage = {
			role: 'assistant',
			content: text,
			toolCalls: toolCalls.length ? toolCalls : undefined,
			geminiParts: geminiParts.length ? geminiParts : undefined,
		};
		return { message, stopReason: toolCalls.length ? 'tool_use' : stopReason };
	}
}
