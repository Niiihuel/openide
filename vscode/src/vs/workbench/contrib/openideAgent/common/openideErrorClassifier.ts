/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — clasificador de errores de provider (clasificador compacto de errores de
 *  providers). Maps the error message to a CLASS that decides the recovery action:
 *  transient → retry with backoff; rate-limit → retry honoring Retry-After when parseable;
 *  auth/billing → no retry (and candidates for failover to another provider); fatal → report.
 *--------------------------------------------------------------------------------------------*/

export type ProviderErrorKind = 'transient' | 'rate-limit' | 'auth' | 'billing' | 'fatal';
export type ProviderErrorReason =
	| 'authentication'
	| 'billing'
	| 'rate-limit'
	| 'overloaded'
	| 'model-not-found'
	| 'model-retired'
	| 'project-not-found'
	| 'provider-unavailable'
	| 'context-overflow'
	| 'multimodal-unsupported'
	| 'tool-calling-unsupported'
	| 'format'
	| 'network'
	| 'connection-refused'
	| 'fatal';

export interface IProviderErrorContext {
	readonly status?: number;
	readonly providerId?: string;
	readonly model?: string;
	readonly endpoint?: string;
	readonly stage?: 'loadCodeAssist' | 'onboardUser' | 'streamGenerateContent' | 'models' | string;
	readonly body?: string;
}

export interface IClassifiedProviderError {
	readonly kind: ProviderErrorKind;
	readonly reason: ProviderErrorReason;
	readonly shouldCompact?: boolean;
	readonly shouldDropImages?: boolean;
	readonly shouldDropTools?: boolean;
	/** Wait suggested by the provider itself ("retry in 20s", "resets in 4hr 5min"). */
	readonly retryAfterMs?: number;
	/** Actionable hint for the user (appended to the error message). */
	readonly hint?: string;
}

/** Parsea esperas del texto del error: "try again in 20s", "retry after 2 minutes", "resets in 1hr". */
function parseRetryAfterMs(lower: string): number | undefined {
	const m = lower.match(/(?:retry|try again|resets?)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(ms|s|sec|second|m|min|minute|h|hr|hour)/);
	if (!m) {
		return undefined;
	}
	const value = parseFloat(m[1]);
	const unit = m[2];
	const ms = unit === 'ms' ? value
		: unit.startsWith('h') ? value * 3_600_000
			: unit.startsWith('m') && unit !== 'ms' ? value * 60_000
				: value * 1000;
	// defensive cap: never wait more than 2 minutes inside an interactive run
	return Math.min(ms, 120_000);
}

export function classifyProviderError(message: string, context?: IProviderErrorContext): IClassifiedProviderError {
	const m = `${message}\n${context?.body ?? ''}`.toLowerCase();
	const status = context?.status ?? Number(/http\s+(\d{3})\b/.exec(m)?.[1] ?? 0);
	const notFound = status === 404 || /\bnot_found\b|requested entity was not found|model not found|unknown model|no such model/.test(m);
	if (notFound) {
		if (context?.stage === 'loadCodeAssist' || context?.stage === 'onboardUser' || /(?:project|cloudaicompanionproject|duetproject).{0,40}(?:not found|does not exist|unknown)/.test(m)) {
			return { kind: 'fatal', reason: 'project-not-found', hint: 'El proyecto de Google Code Assist no existe o esta cuenta no puede accederlo. Revisá openide.agent.googleCloudProject o reconectá Antigravity.' };
		}
		if (context?.stage === 'streamGenerateContent' || /(?:model|model=)[^\n]{0,80}(?:not found|unknown|retired|requested entity)|(?:not found|unknown|retired)[^\n]{0,80}\bmodel\b/.test(m)) {
			const retired = /retired|deprecated|discontinued|no longer available|decommissioned/.test(m);
			return { kind: 'fatal', reason: retired ? 'model-retired' : 'model-not-found', hint: `El modelo${context?.model ? ` "${context.model}"` : ''} no existe o no está habilitado para esta cuenta; actualizá modelos o configurá un fallback.` };
		}
		if (/provider|endpoint|service/.test(m)) {
			return { kind: 'fatal', reason: 'provider-unavailable', hint: 'El endpoint del proveedor ya no está disponible. Revisá su URL o configurá otro target.' };
		}
		if (context?.providerId) {
			return { kind: 'fatal', reason: 'provider-unavailable', hint: `El proveedor ${context.providerId} devolvió un 404 ambiguo; revisá el endpoint o configurá un fallback.` };
		}
	}

	// gemini code assist: tier gratis discontinuado por Google (18/jun/2026) → la cuenta no
	// is "eligible". This is NOT a credential problem (OAuth login works); the fix is another provider.
	if (/free_tier_user_not_eligible|not eligible for gemini code assist|gemini code assist for individuals/.test(m)) {
		return { kind: 'billing', reason: 'billing', hint: 'Tu cuenta no tiene acceso a Code Assist con este OAuth. Probá "Antigravity (cuenta Google)" en Proveedores, o usá el provider "Gemini" con API key de AI Studio (aistudio.google.com/apikey).' };
	}
	// NVIDIA NIM: a 403 after generating nvapi- usually means the model terms were not accepted on build.nvidia.com
	if (/integrate\.api\.nvidia|nvidia\.com\/v1/.test(m) && /http 403|authorization failed|forbidden/.test(m)) {
		return { kind: 'auth', reason: 'authentication', hint: 'NVIDIA NIM rechazó la key: generá una en build.nvidia.com/settings/api-keys (prefijo nvapi-), abrí la página del modelo en el catálogo y aceptá los términos antes del primer request. Si persiste, tu cuenta puede necesitar habilitar "Public API Endpoints" (foro NVIDIA Developer).' };
	}
	if (/context.{0,20}(length|window).{0,30}(exceed|too (?:large|long)|maximum|max)|maximum context|prompt.{0,20}too long|request too large|too many input tokens|token limit exceeded/.test(m)) {
		return { kind: 'fatal', reason: 'context-overflow', shouldCompact: true, hint: 'La conversación excedió la ventana del modelo. OpenIDE intentará compactarla antes de volver a enviar.' };
	}
	if (/(?:model|endpoint).{0,40}(?:does not|doesn't|not).{0,20}support.{0,20}(?:image|vision|multimodal)|(?:image|vision|multimodal).{0,30}(?:not supported|unsupported)/.test(m)) {
		return { kind: 'fatal', reason: 'multimodal-unsupported', shouldDropImages: true, hint: 'El modelo no acepta imágenes; OpenIDE puede continuar conservando una referencia textual.' };
	}
	if (/(?:does not|doesn't|do not|not) support.{0,40}(?:tool|function)[ _-]?(?:call|calling)?|(?:tool|function)[ _-]?(?:call|calling)?.{0,40}(?:not supported|unsupported|unavailable)|unsupported (?:parameter|field).{0,20}["'`]?tools?["'`]?/.test(m)) {
		return { kind: 'fatal', reason: 'tool-calling-unsupported', shouldDropTools: true, hint: 'El modelo no admite herramientas del cliente; OpenIDE puede reintentar como conversación sin acciones.' };
	}
	// Gemini 3 / Antigravity: missing thoughtSignature when resending the history with tools.
	if (/thought_signature|thoughtsignature|missing a thought/.test(m)) {
		return { kind: 'fatal', reason: 'format', hint: 'Antigravity/Gemini 3 requiere preservar las firmas de razonamiento entre llamadas a herramientas. Actualizá OpenIDE a la última versión; si persiste, empezá un chat nuevo.' };
	}
	if (/http 40[13]\b|invalid.{0,3}api.{0,3}key|authentication|unauthorized|invalid_grant|refresh_token_reused|token.{0,20}(expired|revoked|invalid)|falta la api key|no iniciaste sesi/.test(m)) {
		return { kind: 'auth', reason: 'authentication', hint: 'Credencial inválida o vencida: reconectá el proveedor (API key u OAuth) o configurá un fallback.' };
	}
	// billing: quota/invoicing — like auth, we do not retry.
	if (/http 402\b|billing|payment required|credit balance|insufficient.{0,10}(credit|quota|balance)|out of extra usage|quota exceeded/.test(m)) {
		return { kind: 'billing', reason: 'billing', hint: 'Cuota o facturación agotada en el proveedor.' };
	}
	// Some endpoints encode overload as 429. That is transient, not a signal to rotate
	// credentials or to assume the user's quota is exhausted.
	if (/temporarily overloaded|service.{0,20}overloaded|overload.{0,20}(1305|try again)|code["']?\s*:\s*1305/.test(m)) {
		return { kind: 'transient', reason: 'overloaded', retryAfterMs: parseRetryAfterMs(m) };
	}
	// rate limit: retry using the wait the provider suggests (or backoff).
	if (/http 429\b|rate.?limit|too many requests/.test(m)) {
		return { kind: 'rate-limit', reason: 'rate-limit', retryAfterMs: parseRetryAfterMs(m) };
	}
	// nothing is listening at that URL: typical of a LOCAL provider whose server is down — a retry
	// does not help; the actionable step is to start the server.
	if (/err_connection_refused|econnrefused|connection refused/.test(m)) {
		return { kind: 'fatal', reason: 'connection-refused', hint: 'No hay ningún servidor escuchando en la URL del proveedor. Si es local, arrancalo primero — Ollama: `ollama serve` · LM Studio: pestaña Developer → Start Server · llama.cpp: `llama-server`. Después reintentá.' };
	}
	// transitorios de red/servidor.
	if (/http (408|5\d\d)\b|econn|enotfound|etimedout|eai_again|socket|network|overloaded|cf-mitigated|internal server error|stream stale timeout|stream ended before terminal event|unexpected end of (file|stream)|connection reset/.test(m)) {
		return { kind: 'transient', reason: 'network' };
	}
	return { kind: 'fatal', reason: 'fatal' };
}
