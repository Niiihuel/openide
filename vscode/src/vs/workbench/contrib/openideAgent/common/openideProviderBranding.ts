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
	| 'github-copilot.svg'
	| 'codex.svg'
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
	| 'droid.svg';

export interface IProviderBrand {
	readonly name: string;
	readonly initials: string;
	readonly asset?: ProviderBrandAsset;
}

/**
 * Built-ins are intentionally exhaustive. Providers absent from SVGL receive a short,
 * provider-specific monogram instead of a misleading third-party mark.
 */
export const OPENIDE_PROVIDER_BRANDS: Readonly<Record<string, IProviderBrand>> = {
	'antigravity-oauth': { name: 'Google Antigravity', initials: 'AG', asset: 'antigravity.svg' },
	anthropic: { name: 'Anthropic', initials: 'AN', asset: 'anthropic.svg' },
	claude: { name: 'Anthropic Claude', initials: 'CL', asset: 'anthropic.svg' },
	copilot: { name: 'GitHub Copilot', initials: 'GH', asset: 'github-copilot.svg' },
	'openai-codex': { name: 'OpenAI Codex', initials: 'CX', asset: 'codex.svg' },
	'xai-oauth': { name: 'Grok', initials: 'G', asset: 'grok.svg' },
	'minimax-oauth': { name: 'MiniMax', initials: 'MM', asset: 'minimax.svg' },
	openai: { name: 'OpenAI', initials: 'OA', asset: 'openai.svg' },
	openrouter: { name: 'OpenRouter', initials: 'OR', asset: 'openrouter.svg' },
	groq: { name: 'Groq', initials: 'GQ', asset: 'groq.svg' },
	deepseek: { name: 'DeepSeek', initials: 'DS', asset: 'deepseek.svg' },
	mistral: { name: 'Mistral AI', initials: 'MI', asset: 'mistral.svg' },
	xai: { name: 'Grok', initials: 'G', asset: 'grok.svg' },
	gemini: { name: 'Google Gemini', initials: 'GE', asset: 'gemini.svg' },
	together: { name: 'Together AI', initials: 'TO', asset: 'together.svg' },
	cerebras: { name: 'Cerebras', initials: 'CE', asset: 'cerebras.svg' },
	fireworks: { name: 'Fireworks AI', initials: 'FW', asset: 'fireworks.svg' },
	perplexity: { name: 'Perplexity AI', initials: 'PX', asset: 'perplexity.svg' },
	moonshot: { name: 'Moonshot Kimi', initials: 'KI', asset: 'kimi.svg' },
	dashscope: { name: 'Alibaba Qwen', initials: 'QW', asset: 'qwen.svg' },
	zhipu: { name: 'Z.ai', initials: 'ZA', asset: 'zai.svg' },
	'zhipu-coding': { name: 'Z.ai', initials: 'ZA', asset: 'zai.svg' },
	sambanova: { name: 'SambaNova', initials: 'SN' },
	nous: { name: 'Nous Research', initials: 'NR' },
	'nvidia-nim': { name: 'NVIDIA', initials: 'NV', asset: 'nvidia.svg' },
	cohere: { name: 'Cohere', initials: 'CO', asset: 'cohere.svg' },
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
