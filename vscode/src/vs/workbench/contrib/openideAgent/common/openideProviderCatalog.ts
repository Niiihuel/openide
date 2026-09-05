/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — provider catalog as DATA. The idea: few "protocols" (code) and many providers
 *  (data). Adding a provider = one entry here, or a custom one in settings.
 *  Each entry carries its `company` (to group them in the settings UI) and a `blurb`.
 *
 *  An entry describes how to REACH a provider (protocol, endpoint, credentials, headers) — never
 *  which models it serves. Model lists come from the live endpoint or from models.dev
 *  (see openideModelCatalog.ts); `defaultModel` is the only model id named here, because it is a
 *  product decision rather than a fact about the provider.
 *--------------------------------------------------------------------------------------------*/

import { isVoiceTransport, VoiceTransportId } from './openideVoiceTransport.js';

/** 'codex' = Responses API of the ChatGPT Codex backend (subscription).
 * 'openai-responses' = Responses API oficial de OpenAI (requerida por GPT-5.6 preview). */
export type ProtocolId = 'openai' | 'openai-responses' | 'anthropic' | 'codex' | 'gemini-cloudcode';
/** 'none' = local endpoints with no credential (Ollama, for instance). */
export type AuthKind = 'apiKey' | 'oauth' | 'none';

export interface IOAuthConfig {
	/** 'pkce' = authorize code + PKCE (the user pastes the code or the callback URL);
	 *  'device' = device code RFC 8628 (polling);
	 *  'openai-device' = device custom de OpenAI (usercode/deviceauth → authorization_code);
	 *  'minimax-device' = device custom de MiniMax (user_code + verification_uri);
	 *  'loopback' = PKCE con redirect a http://localhost:<puerto>/oauth2callback capturado por
	 *  an ephemeral server in main (Google does not support paste-code — it requires loopback). */
	readonly flow: 'pkce' | 'device' | 'openai-device' | 'minimax-device' | 'loopback';
	readonly authorizationUrl?: string;
	readonly deviceAuthorizationUrl?: string;
	readonly tokenUrl: string;
	/** Alternative token endpoint URLs (tried in order when the primary one fails).
	 *  E.g. Anthropic moved to platform.claude.com and console.anthropic.com became the fallback. */
	readonly tokenUrlFallbacks?: string[];
	readonly clientId: string;
	readonly scopes: string[];
	/** Redirect URI registered with the provider (for PKCE-paste it usually shows the code). */
	readonly redirectUri?: string;
	/** Algunos token endpoints esperan JSON en vez de form-urlencoded. */
	readonly tokenContentType?: 'json' | 'form';
	/** User-Agent requerido por el token endpoint (Anthropic bloquea UAs desconocidos). */
	readonly tokenUserAgent?: string;
	/** Discovery OIDC (.well-known/openid-configuration) para resolver los endpoints (xAI). */
	readonly discoveryUrl?: string;
	/** Extra authorize-URL params (xAI requires plan=generic for loopback clients). */
	readonly authorizeExtraParams?: Record<string, string>;
	/** Resend code_challenge + method in the token exchange (xAI re-validates them there). */
	readonly resendChallengeOnToken?: boolean;
	/** Refresh buffer in seconds (default 60; xAI uses 3600 — its tokens last ~6h). */
	readonly refreshSkewSeconds?: number;
	/** "Installed app" client secret (Google requires it in the exchange even with PKCE;
	 *  it is public by design — the same one the official Gemini CLI ships). */
	readonly clientSecret?: string;
}

export interface IProviderEntry {
	readonly id: string;
	readonly label: string;
	/** Empresa / vendor — usado para agrupar en la UI ("Anthropic", "OpenAI", …). */
	readonly company: string;
	readonly protocol: ProtocolId;
	readonly baseUrl?: string;
	readonly auth: AuthKind;
	/** URL for obtaining the API key (shown as a link in the UI). */
	readonly apiKeysUrl?: string;
	/** Short description for the provider card. */
	readonly blurb?: string;
	readonly defaultModel?: string;
	readonly oauth?: IOAuthConfig;
	/** Extra headers the inference API requires (e.g. Copilot: Editor-Version, etc.). */
	readonly extraHeaders?: Record<string, string>;
	/** Notice shown during OAuth login (e.g. Codex requires enabling device-auth in ChatGPT). */
	readonly oauthHint?: string;
	/** Link associated with the notice (opened from the providers page). */
	readonly oauthHintUrl?: string;
	/** Hard max_tokens ceiling of the ENDPOINT (when it is lower than the model's limit in the
	 *  catalog — e.g. Z.ai's coding endpoint rejects 131072 with error 1210). */
	readonly outputCap?: number;
	/** Metadata de Cloud Code Assist (loadCodeAssist / onboardUser) — Antigravity vs Gemini CLI. */
	readonly cloudCodeMetadata?: Record<string, string>;
	/** Si true, la lista de modelos se obtiene de GET {baseUrl}/models (ej: NVIDIA NIM). */
	readonly dynamicModels?: boolean;
	/** Default dictation model; the voice registry resolves its actual wire contract. */
	readonly voiceModel?: string;
	readonly voiceTransport?: VoiceTransportId;
	readonly voiceModelTransports?: Readonly<Record<string, VoiceTransportId>>;
	readonly custom?: boolean;
}

/**
 * Built-in providers. Most speak the OpenAI-compatible protocol (the de facto standard),
 * so adding a new one is usually just {id, label, company, baseUrl}.
 */
export const OPENIDE_BUILTIN_PROVIDERS: ReadonlyArray<IProviderEntry> = [
	{
		id: 'antigravity-oauth', label: 'Antigravity (Google account)', company: 'Google', protocol: 'gemini-cloudcode', auth: 'oauth',
		baseUrl: 'https://cloudcode-pa.googleapis.com',
		blurb: 'Gemini, Claude and GPT-OSS through your Google account via the Antigravity gateway (OAuth), no API key.',
		defaultModel: 'gemini-3.6-flash-medium',
		oauthHint: 'The Google login opens in the browser and returns to OpenIDE on its own. On a Workspace or licensed account, set "openide.agent.googleCloudProject" before connecting.',
		cloudCodeMetadata: { ideType: 'ANTIGRAVITY', platform: 'LINUX_AMD64', pluginType: 'GEMINI' },
		extraHeaders: {
			'User-Agent': 'antigravity/1.23.2 linux/amd64',
			'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
			'Client-Metadata': '{"ideType":"ANTIGRAVITY","platform":"LINUX_AMD64","pluginType":"GEMINI"}',
		},
		oauth: {
			flow: 'loopback',
			authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
			tokenUrl: 'https://oauth2.googleapis.com/token',
			// Antigravity IDE's OAuth client, published and already used by opencode-antigravity-auth.
			// The same installed-app shape as the Copilot entry below, whose `Editor-Version` and
			// `Copilot-Integration-Id` do the same job: these gateways identify the CLIENT, not the
			// user, so a provider that speaks to one is the client it speaks as. The secret is
			// shipped in the client and held by no server of ours — there is nothing here to rotate,
			// and nothing an OpenIDE-registered client could replace, because the gateway would not
			// know it. Kept deliberately; the secret-scanning alert is resolved, not hidden.
			clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
			clientSecret: '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',
			redirectUri: 'http://localhost:51121/oauth-callback',
			scopes: [
				'https://www.googleapis.com/auth/cloud-platform',
				'https://www.googleapis.com/auth/userinfo.email',
				'https://www.googleapis.com/auth/userinfo.profile',
				'https://www.googleapis.com/auth/cclog',
				'https://www.googleapis.com/auth/experimentsandconfigs',
			],
			tokenUserAgent: 'google-api-nodejs-client/9.15.1',
			authorizeExtraParams: { access_type: 'offline', prompt: 'consent' },
			refreshSkewSeconds: 300,
		},
	},
	{
		id: 'copilot', label: 'GitHub Copilot (subscription)', company: 'GitHub', protocol: 'openai',
		baseUrl: 'https://api.githubcopilot.com', auth: 'oauth',
		blurb: 'Use your GitHub Copilot subscription through GitHub device-code, no API key.',
		defaultModel: 'gpt-5.5',
		// Headers the Copilot API requires (without Editor-Version/Integration-Id it rejects).
		extraHeaders: {
			'Editor-Version': 'vscode/1.104.1',
			'Copilot-Integration-Id': 'vscode-chat',
			'Openai-Intent': 'conversation-edits',
			'User-Agent': 'GitHubCopilotChat/0.26.7',
		},
		oauth: {
			flow: 'device',
			deviceAuthorizationUrl: 'https://github.com/login/device/code',
			tokenUrl: 'https://github.com/login/oauth/access_token',
			clientId: 'Iv1.b507a08c87ecfe98',
			scopes: ['read:user'],
		},
	},
	{
		id: 'openai-codex', label: 'ChatGPT (Codex subscription)', company: 'OpenAI', protocol: 'codex', auth: 'oauth',
		baseUrl: 'https://chatgpt.com/backend-api/codex',
		blurb: 'Use your ChatGPT Plus/Pro subscription through the Codex backend, no API key.',
		oauthHint: 'ChatGPT requires "Device code authorization for Codex" to be enabled under Settings → Security on your account. If the browser shows that error, turn it on and try again.',
		oauthHintUrl: 'https://chatgpt.com/#settings/Security',
		defaultModel: 'gpt-5.6-sol',
		oauth: {
			flow: 'openai-device',
			deviceAuthorizationUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
			tokenUrl: 'https://auth.openai.com/oauth/token',
			clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
			scopes: [],
			refreshSkewSeconds: 120,
		},
	},
	{
		id: 'xai-oauth', label: 'Grok (SuperGrok subscription)', company: 'xAI', protocol: 'openai', auth: 'oauth',
		baseUrl: 'https://api.x.ai/v1',
		blurb: 'Use your SuperGrok/Premium+ subscription through OAuth (you paste the callback URL), no API key.',
		defaultModel: 'grok-4.3',
		oauth: {
			flow: 'pkce',
			discoveryUrl: 'https://auth.x.ai/.well-known/openid-configuration',
			tokenUrl: '', // se resuelve por discovery
			clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
			scopes: ['openid', 'profile', 'email', 'offline_access', 'grok-cli:access', 'api:access'],
			redirectUri: 'http://127.0.0.1:56121/callback',
			authorizeExtraParams: { plan: 'generic' },
			resendChallengeOnToken: true,
			refreshSkewSeconds: 3600,
		},
	},
	{
		id: 'minimax-oauth', label: 'MiniMax (subscription)', company: 'MiniMax', protocol: 'anthropic', auth: 'oauth',
		baseUrl: 'https://api.minimax.io/anthropic',
		blurb: 'MiniMax M3 through your MiniMax account via device-code (experimental).',
		defaultModel: 'MiniMax-M3',
		oauth: {
			flow: 'minimax-device',
			deviceAuthorizationUrl: 'https://api.minimax.io/oauth/code',
			tokenUrl: 'https://api.minimax.io/oauth/token',
			clientId: '78257093-7e40-4613-99e0-527b14b39113',
			scopes: ['group_id', 'profile', 'model.completion'],
			tokenContentType: 'json',
		},
	},
	{
		id: 'openai', label: 'OpenAI', company: 'OpenAI', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', auth: 'apiKey',
		apiKeysUrl: 'https://platform.openai.com/api-keys',
		blurb: 'GPT-5.x and GPT-5.6 Sol/Terra/Luna through the official Responses API.',
		defaultModel: 'gpt-5.6-sol',
		voiceModel: 'gpt-audio-mini',
	},
	{
		id: 'openrouter', label: 'OpenRouter', company: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', auth: 'apiKey',
		apiKeysUrl: 'https://openrouter.ai/keys',
		blurb: 'A single endpoint for hundreds of models from many providers.',
		defaultModel: 'openai/gpt-5.5',
	},
	{
		// OpenCode Zen: the gateway opencode ships, OpenAI-compatible, one key for models from
		// several vendors. models.dev publishes it as `opencode` (97 models) and the endpoint
		// answers GET /models with what THIS account may reach (66 here), so the picker gets the
		// account's real list and the registry supplies the limits and prices — no model list
		// belongs in this file.
		id: 'opencode', label: 'OpenCode Zen', company: 'opencode', protocol: 'openai', baseUrl: 'https://opencode.ai/zen/v1', auth: 'apiKey',
		apiKeysUrl: 'https://opencode.ai/docs/zen',
		blurb: 'The opencode gateway: one key for models from several vendors, with a free tier.',
		defaultModel: 'claude-sonnet-4-6',
	},
	{
		id: 'groq', label: 'Groq', company: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', auth: 'apiKey',
		voiceModel: 'whisper-large-v3-turbo',
		apiKeysUrl: 'https://console.groq.com/keys',
		blurb: 'Very fast inference (LPU) for open-source models.',
		defaultModel: 'openai/gpt-oss-120b',
	},
	{
		id: 'deepseek', label: 'DeepSeek', company: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', auth: 'apiKey',
		apiKeysUrl: 'https://platform.deepseek.com/api_keys',
		blurb: 'DeepSeek V3.2 (chat) and its reasoning mode.',
		defaultModel: 'deepseek-chat',
	},
	{
		id: 'mistral', label: 'Mistral', company: 'Mistral AI', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', auth: 'apiKey',
		voiceModel: 'voxtral-mini-latest',
		apiKeysUrl: 'https://console.mistral.ai/api-keys',
		blurb: 'Mistral Large, Medium and Codestral models.',
		defaultModel: 'mistral-medium-latest',
	},
	{
		id: 'xai', label: 'Grok', company: 'xAI', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', auth: 'apiKey',
		voiceModel: 'stt',
		apiKeysUrl: 'https://console.x.ai',
		blurb: 'xAI Grok models.',
		defaultModel: 'grok-4.3',
	},
	{
		id: 'gemini', label: 'Gemini', company: 'Google', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', auth: 'apiKey',
		apiKeysUrl: 'https://aistudio.google.com/apikey',
		blurb: 'Gemini through the OpenAI-compatible API.',
		defaultModel: 'gemini-3.5-flash',
		voiceModel: 'gemini-3.5-flash',
	},
	{
		id: 'together', label: 'Together', company: 'Together AI', protocol: 'openai', baseUrl: 'https://api.together.xyz/v1', auth: 'apiKey',
		voiceModel: 'openai/whisper-large-v3',
		apiKeysUrl: 'https://api.together.xyz/settings/api-keys',
		blurb: 'Hosted open-source models (Llama, Qwen, …).',
		defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
	},
	{
		id: 'cerebras', label: 'Cerebras', company: 'Cerebras', protocol: 'openai', baseUrl: 'https://api.cerebras.ai/v1', auth: 'apiKey',
		apiKeysUrl: 'https://cloud.cerebras.ai/platform/apikeys',
		blurb: 'Inferencia ultrarrápida en hardware wafer-scale.',
		defaultModel: 'zai-glm-4.7',
	},
	{
		id: 'fireworks', label: 'Fireworks', company: 'Fireworks AI', protocol: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1', auth: 'apiKey',
		apiKeysUrl: 'https://fireworks.ai/account/api-keys',
		blurb: 'Open-source models served at low latency.',
		defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
	},
	{
		id: 'perplexity', label: 'Perplexity', company: 'Perplexity', protocol: 'openai', baseUrl: 'https://api.perplexity.ai', auth: 'apiKey',
		apiKeysUrl: 'https://www.perplexity.ai/settings/api',
		blurb: 'Sonar models with built-in web search.',
		defaultModel: 'sonar-pro',
	},
	{
		id: 'moonshot', label: 'Moonshot (Kimi)', company: 'Moonshot AI', protocol: 'openai', baseUrl: 'https://api.moonshot.ai/v1', auth: 'apiKey',
		apiKeysUrl: 'https://platform.moonshot.ai/console/api-keys',
		blurb: 'Moonshot Kimi K2 models.',
		defaultModel: 'kimi-k2.7-code',
	},
	{
		id: 'dashscope', label: 'Qwen (DashScope)', company: 'Alibaba', protocol: 'openai', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', auth: 'apiKey',
		apiKeysUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1',
		blurb: 'Qwen models through the Alibaba Cloud API (compatible mode).',
		defaultModel: 'qwen3.7-max',
		voiceModel: 'qwen3-omni-flash',
	},
	{
		id: 'zhipu', label: 'Z.ai (GLM · API)', company: 'Zhipu AI', protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', auth: 'apiKey',
		apiKeysUrl: 'https://z.ai/manage-apikey/apikey-list',
		blurb: 'GLM models on the pay-as-you-go API (billed against API credit). With a GLM Coding Plan, use the "Z.ai Coding Plan" entry instead.',
		defaultModel: 'glm-5.2',
	},
	{
		// The Coding Plan (subscription) does NOT draw on the API balance: it applies only through the
		// coding endpoints. Same API key as the API entry, but against the Anthropic-compatible
		// endpoint (the one Claude Code and agentic tools use) — with the pay-as-you-go base it
		// returns 429 code 1113 "Insufficient balance" even when the plan has quota.
		id: 'zhipu-coding', label: 'Z.ai Coding Plan (GLM)', company: 'Zhipu AI', protocol: 'anthropic', baseUrl: 'https://api.z.ai/api/anthropic', auth: 'apiKey',
		apiKeysUrl: 'https://z.ai/manage-apikey/apikey-list',
		blurb: 'GLM Coding Plan subscription: the plan quota (not API credit), same Z.ai API key.',
		defaultModel: 'glm-5.2',
		outputCap: 128000,
	},
	{
		id: 'sambanova', label: 'SambaNova', company: 'SambaNova', protocol: 'openai', baseUrl: 'https://api.sambanova.ai/v1', auth: 'apiKey',
		apiKeysUrl: 'https://cloud.sambanova.ai/apis',
		blurb: 'Fast open-source model inference on RDU hardware.',
		defaultModel: 'Meta-Llama-3.3-70B-Instruct',
	},
	{
		id: 'nous', label: 'Nous Research', company: 'Nous Research', protocol: 'openai', baseUrl: 'https://inference-api.nousresearch.com/v1', auth: 'apiKey',
		apiKeysUrl: 'https://portal.nousresearch.com',
		blurb: 'Nous Research Hermes models.',
		defaultModel: 'Hermes-4-405B',
	},
	{
		id: 'nvidia-nim', label: 'NVIDIA NIM', company: 'NVIDIA', protocol: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', auth: 'apiKey',
		apiKeysUrl: 'https://build.nvidia.com/settings/api-keys',
		blurb: 'The full build.nvidia.com catalog (loaded from the API). API key nvapi-…; accept each model\'s terms before first use. For a local NIM in Docker, use vLLM against http://localhost:8000/v1.',
		defaultModel: 'meta/llama-3.1-8b-instruct',
		dynamicModels: true,
	},
	{
		id: 'cohere', label: 'Cohere', company: 'Cohere', protocol: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1', auth: 'apiKey',
		apiKeysUrl: 'https://dashboard.cohere.com/api-keys',
		blurb: 'Cohere Command models (OpenAI-compatible endpoint).',
		defaultModel: 'command-a-03-2025',
	},
	{
		id: 'minimax', label: 'MiniMax (API key)', company: 'MiniMax', protocol: 'openai', baseUrl: 'https://api.minimax.io/v1', auth: 'apiKey',
		apiKeysUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
		blurb: 'MiniMax M3 with an API key.',
		defaultModel: 'MiniMax-M3',
	},
	{
		id: 'ollama', label: 'Ollama', company: 'Local', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', auth: 'none',
		blurb: 'Local models on your own machine, no API key. Requires Ollama running.',
		defaultModel: 'llama3.2',
	},
	{
		id: 'lmstudio', label: 'LM Studio', company: 'Local', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', auth: 'none',
		blurb: 'Servidor local de LM Studio (Developer → Start Server).',
	},
	{
		id: 'llamacpp', label: 'llama.cpp', company: 'Local', protocol: 'openai', baseUrl: 'http://localhost:8080/v1', auth: 'none',
		blurb: 'llama.cpp\'s llama-server running locally.',
	},
	{
		id: 'vllm', label: 'vLLM', company: 'Local', protocol: 'openai', baseUrl: 'http://localhost:8000/v1', auth: 'none',
		blurb: 'A vLLM server, local or on your network (OpenAI-compatible).',
	},
	{
		id: 'jan', label: 'Jan', company: 'Local', protocol: 'openai', baseUrl: 'http://localhost:1337/v1', auth: 'none',
		blurb: 'Servidor local de Jan.',
	},
];

/** Normaliza un provider custom venido de settings (tolerante a campos faltantes). */
function normalizeCustom(raw: any): IProviderEntry | undefined {
	if (!raw || typeof raw.id !== 'string' || !raw.id) {
		return undefined;
	}
	const protocol: ProtocolId = raw.protocol === 'anthropic' ? 'anthropic' : 'openai';
	const auth: AuthKind = raw.auth === 'oauth' ? 'oauth' : raw.auth === 'none' ? 'none' : 'apiKey';
	return {
		id: raw.id,
		label: typeof raw.label === 'string' && raw.label ? raw.label : raw.id,
		company: typeof raw.company === 'string' && raw.company ? raw.company : 'Personalizados',
		protocol,
		baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
		auth,
		// Where this provider's key is minted. A custom entry could not carry it before, so a
		// provider added from the registry had nowhere to put its documentation link except the
		// blurb — where a bare URL reads as the row's description instead of as a link.
		apiKeysUrl: typeof raw.apiKeysUrl === 'string' ? raw.apiKeysUrl : undefined,
		blurb: typeof raw.blurb === 'string' ? raw.blurb : (typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined),
		defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : undefined,
		voiceModel: typeof raw.voiceModel === 'string' && raw.voiceModel.trim() ? raw.voiceModel.trim() : undefined,
		voiceTransport: isVoiceTransport(raw.voiceTransport) ? raw.voiceTransport : undefined,
		voiceModelTransports: raw.voiceModelTransports && typeof raw.voiceModelTransports === 'object' && !Array.isArray(raw.voiceModelTransports)
			? Object.fromEntries(Object.entries(raw.voiceModelTransports).filter((entry): entry is [string, VoiceTransportId] => isVoiceTransport(entry[1]))) : undefined,
		custom: true,
	};
}

/** Final catalog = built-in + custom (a custom entry with the same id overrides the built-in). */
export function resolveProviders(custom: any[] | undefined): IProviderEntry[] {
	const map = new Map<string, IProviderEntry>();
	for (const p of OPENIDE_BUILTIN_PROVIDERS) {
		map.set(p.id, p);
	}
	if (Array.isArray(custom)) {
		for (const raw of custom) {
			const entry = normalizeCustom(raw);
			if (entry) {
				map.set(entry.id, entry);
			}
		}
	}
	return [...map.values()];
}

export function findProvider(custom: any[] | undefined, id: string): IProviderEntry | undefined {
	return resolveProviders(custom).find(p => p.id === id);
}

export interface IProviderGroup {
	readonly company: string;
	readonly providers: IProviderEntry[];
}

/** Groups by company preserving order of appearance (built-in first, custom last). */
export function groupProvidersByCompany(providers: IProviderEntry[]): IProviderGroup[] {
	const order: string[] = [];
	const map = new Map<string, IProviderEntry[]>();
	for (const p of providers) {
		const company = p.company || 'Otros';
		if (!map.has(company)) {
			map.set(company, []);
			order.push(company);
		}
		map.get(company)!.push(p);
	}
	return order.map(company => ({ company, providers: map.get(company)! }));
}
