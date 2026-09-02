/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — canonical provider visual identity. The metadata lives outside the views so that
 *  chat, status bar, Settings and Usage never resolve the same account differently.
 *--------------------------------------------------------------------------------------------*/

export type ProviderBrandAsset =
	| 'antigravity.svg'
	| 'anthropic.svg'
	| 'claude.svg'
	| 'github-copilot.svg'
	| 'grok.svg'
	| 'openai.svg'
	| 'openrouter.svg'
	| 'groq.svg'
	| 'deepseek.svg'
	| 'mistral.svg'
	| 'gemini.svg'
	| 'cerebras.svg'
	| 'perplexity.svg'
	| 'kimi.svg'
	| 'qwen.svg'
	| 'nvidia.svg'
	| 'cohere.svg'
	| 'ollama.svg'
	| 'lmstudio.svg'
	| 'together.svg'
	| 'fireworks.svg'
	| 'zai.svg'
	| 'minimax.svg'
	| 'opencode.svg'
	| 'cursor.svg'
	| 'vscode.svg'
	| 'droid.svg';

/**
 * How a mark is painted.
 *
 * - `full`: the SVG paints itself. Its colours ARE the brand (Gemini's four, Mistral's ramp,
 *   Cohere's three), so it is shown as an image and never masked.
 * - `{ tint }`: a one-colour mark whose brand colour is unmistakable. The silhouette is masked
 *   and filled with that colour instead of the surface's foreground.
 * - absent: a black-on-white brand (OpenAI, Grok, Codex, Ollama, opencode…). The silhouette in
 *   the surface's foreground, which is what those marks look like everywhere else.
 *
 * The colours are the brands' own, not ours, and only where they are beyond doubt; a guessed
 * tint on a logo reads worse than no tint. Everything else stays in the theme's ink.
 */
export type ProviderBrandPaint = 'full' | { readonly tint: string };

export interface IProviderBrand {
	readonly name: string;
	readonly initials: string;
	readonly asset?: ProviderBrandAsset;
	readonly paint?: ProviderBrandPaint;
}

/** Anthropic's terracotta — the colour of the Claude mark on claude.ai and in the app stores. */
const ANTHROPIC = { tint: '#D97757' } as const;
/** Groq's orange. */
const GROQ = { tint: '#F55036' } as const;
/** NVIDIA green. */
const NVIDIA = { tint: '#76B900' } as const;
/** Qwen's violet. */
const QWEN = { tint: '#615CED' } as const;
/** Visual Studio Code's blue. */
const VSCODE = { tint: '#007ACC' } as const;

/**
 * Built-ins are intentionally exhaustive. Providers absent from SVGL receive a short,
 * provider-specific monogram instead of a misleading third-party mark.
 */
export const OPENIDE_PROVIDER_BRANDS: Readonly<Record<string, IProviderBrand>> = {
	'antigravity-oauth': { name: 'Google Antigravity', initials: 'AG', asset: 'antigravity.svg', paint: 'full' },
	anthropic: { name: 'Anthropic', initials: 'AN', asset: 'anthropic.svg', paint: ANTHROPIC },
	// The Claude spark, not Anthropic's wordmark: it is what the product and the CLI show.
	claude: { name: 'Anthropic Claude', initials: 'CL', asset: 'claude.svg', paint: ANTHROPIC },
	copilot: { name: 'GitHub Copilot', initials: 'GH', asset: 'github-copilot.svg' },
	// OpenAI's mark, not the Codex terminal blob: a ChatGPT subscription is what the account is.
	'openai-codex': { name: 'OpenAI Codex', initials: 'CX', asset: 'openai.svg' },
	'xai-oauth': { name: 'Grok', initials: 'G', asset: 'grok.svg' },
	'minimax-oauth': { name: 'MiniMax', initials: 'MM', asset: 'minimax.svg' },
	openai: { name: 'OpenAI', initials: 'OA', asset: 'openai.svg' },
	openrouter: { name: 'OpenRouter', initials: 'OR', asset: 'openrouter.svg' },
	groq: { name: 'Groq', initials: 'GQ', asset: 'groq.svg', paint: GROQ },
	deepseek: { name: 'DeepSeek', initials: 'DS', asset: 'deepseek.svg', paint: 'full' },
	mistral: { name: 'Mistral AI', initials: 'MI', asset: 'mistral.svg', paint: 'full' },
	xai: { name: 'Grok', initials: 'G', asset: 'grok.svg' },
	gemini: { name: 'Google Gemini', initials: 'GE', asset: 'gemini.svg', paint: 'full' },
	together: { name: 'Together AI', initials: 'TO', asset: 'together.svg' },
	cerebras: { name: 'Cerebras', initials: 'CE', asset: 'cerebras.svg', paint: 'full' },
	fireworks: { name: 'Fireworks AI', initials: 'FW', asset: 'fireworks.svg' },
	perplexity: { name: 'Perplexity AI', initials: 'PX', asset: 'perplexity.svg', paint: 'full' },
	moonshot: { name: 'Moonshot Kimi', initials: 'KI', asset: 'kimi.svg' },
	dashscope: { name: 'Alibaba Qwen', initials: 'QW', asset: 'qwen.svg', paint: QWEN },
	zhipu: { name: 'Z.ai', initials: 'ZA', asset: 'zai.svg' },
	'zhipu-coding': { name: 'Z.ai', initials: 'ZA', asset: 'zai.svg' },
	sambanova: { name: 'SambaNova', initials: 'SN' },
	nous: { name: 'Nous Research', initials: 'NR' },
	'nvidia-nim': { name: 'NVIDIA', initials: 'NV', asset: 'nvidia.svg', paint: NVIDIA },
	cohere: { name: 'Cohere', initials: 'CO', asset: 'cohere.svg', paint: 'full' },
	minimax: { name: 'MiniMax', initials: 'MM', asset: 'minimax.svg' },
	ollama: { name: 'Ollama', initials: 'OL', asset: 'ollama.svg' },
	lmstudio: { name: 'LM Studio', initials: 'LM', asset: 'lmstudio.svg' },
	llamacpp: { name: 'llama.cpp', initials: 'L+' },
	vllm: { name: 'vLLM', initials: 'VL' },
	jan: { name: 'Jan', initials: 'J' },
	// The hosted CLIs the dock runs as a TUI: same identity as the provider behind them where
	// there is one (Claude Code → Anthropic, Codex → OpenAI, Gemini CLI → Google), their own
	// mark where the tool is the brand. Amp publishes only a wordmark, unreadable at 14px.
	opencode: { name: 'opencode', initials: 'OC', asset: 'opencode.svg' },
	amp: { name: 'Amp', initials: 'AM' },
	droid: { name: 'Factory Droid', initials: 'FD', asset: 'droid.svg' },
	// Editors the Settings import page can read from; the ones without a mark that can be
	// shipped take a monogram.
	cursor: { name: 'Cursor', initials: 'CU', asset: 'cursor.svg' },
	vscode: { name: 'Visual Studio Code', initials: 'VS', asset: 'vscode.svg', paint: VSCODE },
	vscodium: { name: 'VSCodium', initials: 'VC' },
	windsurf: { name: 'Windsurf', initials: 'WS' },
};

function initialsFrom(value: string): string {
	const parts = value.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
	if (parts.length > 1) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return (parts[0]?.slice(0, 2) || 'AI').toUpperCase();
}

/** Also recognizes common custom-provider ids without coupling protocol code to branding. */
export function resolveProviderBrand(providerId: string, label = ''): IProviderBrand {
	const direct = OPENIDE_PROVIDER_BRANDS[providerId];
	if (direct) {
		return direct;
	}
	const value = `${providerId} ${label}`.toLowerCase();
	const aliases: readonly [RegExp, string][] = [
		[/antigravity/, 'antigravity-oauth'], [/copilot|github/, 'copilot'], [/codex/, 'openai-codex'],
		[/openai|chatgpt/, 'openai'], [/openrouter/, 'openrouter'], [/grok|x\.ai|\bxai\b/, 'xai'],
		[/gemini|\bgoogle\b/, 'gemini'], [/anthropic/, 'anthropic'], [/claude/, 'claude'], [/minimax/, 'minimax'],
		[/deepseek/, 'deepseek'], [/mistral/, 'mistral'], [/groq/, 'groq'], [/together/, 'together'],
		[/cerebras/, 'cerebras'], [/fireworks/, 'fireworks'], [/perplexity/, 'perplexity'],
		[/moonshot|kimi/, 'moonshot'], [/dashscope|qwen|alibaba/, 'dashscope'], [/zhipu|z\.ai|\bglm\b/, 'zhipu'],
		[/sambanova/, 'sambanova'], [/nous/, 'nous'], [/nvidia|\bnim\b/, 'nvidia-nim'], [/cohere/, 'cohere'],
		[/opencode/, 'opencode'], [/droid|factory/, 'droid'], [/ampcode|\bamp\b/, 'amp'],
		[/ollama/, 'ollama'], [/lm\s*studio/, 'lmstudio'], [/llama\.cpp|llamacpp/, 'llamacpp'], [/\bvllm\b/, 'vllm'], [/\bjan\b/, 'jan'],
	];
	for (const [pattern, id] of aliases) {
		if (pattern.test(value)) {
			return OPENIDE_PROVIDER_BRANDS[id];
		}
	}
	const fallbackLabel = label.trim() || providerId.trim() || 'Proveedor de IA';
	return { name: fallbackLabel, initials: initialsFrom(fallbackLabel) };
}
