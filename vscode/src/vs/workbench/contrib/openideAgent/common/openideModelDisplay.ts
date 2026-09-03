/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — presentation of a model in the picker: display name, context size and price.
 *
 *  models.dev publishes a `name` for almost every model, and that is what the picker shows.
 *  `humanizeModelId` only covers ids the registry does not know — gateways that mint their own
 *  (Antigravity), local runtimes and custom providers — so those do not fall back to a raw slug.
 *--------------------------------------------------------------------------------------------*/

/** Tokens whose casing cannot be derived: acronyms and vendor spellings. */
const TOKEN_LABELS: Record<string, string> = {
	ai: 'AI', api: 'API', glm: 'GLM', gpt: 'GPT', lfm: 'LFM', lm: 'LM', oss: 'OSS',
	pdf: 'PDF', ui: 'UI', vl: 'VL', vlm: 'VLM',
	anthropic: 'Anthropic', chatgpt: 'ChatGPT', claude: 'Claude', codestral: 'Codestral',
	codex: 'Codex', command: 'Command', deepseek: 'DeepSeek', gemini: 'Gemini', gemma: 'Gemma',
	grok: 'Grok', hermes: 'Hermes', hunyuan: 'Hunyuan', kimi: 'Kimi', llama: 'Llama',
	minimax: 'MiniMax', mistral: 'Mistral', mixtral: 'Mixtral', nemotron: 'Nemotron',
	openai: 'OpenAI', qwen: 'Qwen', sonar: 'Sonar',
};

function titleCase(token: string): string {
	return token ? token[0].toUpperCase() + token.slice(1).toLowerCase() : '';
}

/** `anthropic/claude-sonnet-5` → `claude-sonnet-5`: aggregator ids carry the vendor as a path
 *  segment, and the group header already says which provider this is. */
function stripProviderPrefix(value: string): string {
	const withoutAlias = value.startsWith('~') ? value.slice(1) : value;
	const slash = withoutAlias.lastIndexOf('/');
	return slash >= 0 ? withoutAlias.slice(slash + 1) : withoutAlias;
}

/** `llama3.3:70b` → base `llama3.3` + suffix `70b`. Ollama-style tags. */
function splitColonSuffix(value: string): { base: string; suffix: string } {
	const colon = value.lastIndexOf(':');
	if (colon <= 0 || colon >= value.length - 1) {
		return { base: value, suffix: '' };
	}
	return { base: value.slice(0, colon), suffix: value.slice(colon + 1) };
}

function tokenize(value: string): string[] {
	const raw = value
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.split(/[-_\s]+/)
		.map(token => token.trim())
		.filter(Boolean);

	const tokens: string[] = [];
	for (let i = 0; i < raw.length; i++) {
		// `2025-10-01` arrives split in three; rejoin it before anything tries to title-case it.
		if (/^(19|20)\d{2}$/.test(raw[i]) && /^\d{2}$/.test(raw[i + 1] ?? '') && /^\d{2}$/.test(raw[i + 2] ?? '')) {
			tokens.push(`${raw[i]}-${raw[i + 1]}-${raw[i + 2]}`);
			i += 2;
			continue;
		}
		// `claude-sonnet-4-5` means version 4.5, not two separate tokens.
		if (/^\d$/.test(raw[i]) && /^\d$/.test(raw[i + 1] ?? '')) {
			tokens.push(`${raw[i]}.${raw[i + 1]}`);
			i += 1;
			continue;
		}
		tokens.push(raw[i]);
	}
	return tokens;
}

function formatToken(token: string): string {
	const lower = token.toLowerCase();
	const mapped = TOKEN_LABELS[lower];
	if (mapped) {
		return mapped;
	}
	const qwen = lower.match(/^qwen(\d(?:\.\d+)?)$/);
	if (qwen) {
		return `Qwen${qwen[1]}`;
	}
	if (/^o\d/.test(lower)) {
		return lower;			// o1 / o3 / o4 keep their lowercase branding
	}
	if (/^v\d/.test(lower)) {
		return `V${token.slice(1).toUpperCase()}`;
	}
	if (/^[a-z]\d+[a-z]?$/.test(lower)) {
		return lower.toUpperCase();		// b7, k2 …
	}
	if (/^\d+(?:x\d+)?[a-z]+$/.test(lower)) {
		return lower.replace(/[a-z]+$/i, unit => unit.toUpperCase());	// 70b, 8x7b
	}
	return titleCase(token);
}

/** Re-joins a family prefix with its version: `GPT` + `5.6` → `GPT-5.6`. */
function combineTokens(tokens: string[]): string[] {
	const result = [...tokens];
	if (result[0] === 'GPT' && result[1] && /^(?:\d|\d+[a-z]|OSS$)/i.test(result[1])) {
		result.splice(0, 2, `GPT-${result[1]}`);
	}
	if (result[0] === 'GLM' && result[1] && /^\d/.test(result[1])) {
		result.splice(0, 2, `GLM-${result[1]}`);
	}
	if (result[0] === 'Qwen' && result[1] && /^\d/.test(result[1])) {
		result.splice(0, 2, `Qwen${result[1]}`);
	}
	return result;
}

/** Best-effort human name for a model id the registry does not publish. */
export function humanizeModelId(modelId: string | null | undefined): string {
	const normalized = typeof modelId === 'string' ? modelId.trim() : '';
	if (!normalized) {
		return '';
	}
	const { base, suffix } = splitColonSuffix(stripProviderPrefix(normalized));
	const tokens = combineTokens(tokenize(base).map(formatToken));

	const last = tokens[tokens.length - 1];
	if (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(last ?? '')) {
		tokens[tokens.length - 1] = `(${last})`;
	}
	const name = tokens.join(' ').replace(/\s+\(/g, ' (').trim();
	const tag = suffix.trim().toLowerCase();
	return tag ? `${name} (${tag})` : name;
}

/** Context window as the picker shows it: `500 mil`, `1,1 M` (locale-aware, ≤1 decimal).
 *  Empty string when the model publishes no limit — the row then shows no size at all rather
 *  than a made-up one. */
export function formatContextTokens(value: number | undefined, locale: string): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return '';
	}
	const formatted = new Intl.NumberFormat(locale, {
		notation: 'compact',
		compactDisplay: 'short',
		maximumFractionDigits: 1,
		minimumFractionDigits: 0,
	}).format(value);
	// Some locales still render the redundant `.0` even with minimumFractionDigits 0.
	return formatted.replace(/[.,]0(?=\s*\D*$)/, '');
}

/** Price per million tokens. `—` when the provider publishes none (subscriptions, local). */
export function formatCostPerMillion(value: number | undefined, locale: string): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return '—';
	}
	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 4,
		minimumFractionDigits: 2,
	}).format(value);
}
