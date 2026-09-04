/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — effort normalization for OpenAI-compatible endpoints.
 *--------------------------------------------------------------------------------------------*/

import type { OpenideStringKey } from './openideStrings.js';

export type OpenideReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Levels offered in the UI, in order. `''` = whatever the model decides. It lives here so the
 *  chat menu and the plan menu cannot offer different lists for the same setting.
 *
 *  The second slot is a DICTIONARY KEY, not a label: the two levels that are prose ("Model
 *  default", "No reasoning") were written here as Spanish literals and reached an English IDE
 *  untranslated, next to the five that are the API's own values and read the same in both
 *  languages. Keys keep the resolution at render time, where the locale is known. */
export const OPENIDE_REASONING_EFFORTS: readonly (readonly [string, OpenideStringKey])[] = [
	['', 'chatSurface.effort.default'],
	['none', 'chatSurface.effort.none'],
	['minimal', 'chatSurface.effort.minimal'],
	['low', 'chatSurface.effort.low'],
	['medium', 'chatSurface.effort.medium'],
	['high', 'chatSurface.effort.high'],
	['xhigh', 'chatSurface.effort.xhigh'],
	['max', 'chatSurface.effort.max'],
];

export function normalizeReasoningEffort(value: string | undefined): OpenideReasoningEffort | undefined {
	const effort = String(value ?? '').toLowerCase();
	return effort === 'none' || effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max'
		? effort
		: undefined;
}

export function openAIReasoningBody(
	providerId: string | undefined,
	baseUrl: string,
	model: string,
	effortValue: string | undefined,
): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	const effort = normalizeReasoningEffort(effortValue);
	const modelLc = model.toLowerCase();
	const isNim = /integrate\.api\.nvidia\.com|nvidia\.com\/v1/.test(baseUrl);

	if (providerId === 'openrouter' && effort) {
		body.reasoning = effort === 'none' ? { enabled: false } : { effort: effort === 'max' ? 'high' : effort };
	} else if (effort && (
		modelLc.includes('gpt-oss')
		|| /(^|\/)o[134](?:[-./]|$)/.test(modelLc)
		|| /(^|\/)gpt-5(?:[-./]|$)/.test(modelLc)
		|| modelLc.includes('codex')
	)) {
		body.reasoning_effort = effort === 'xhigh' || effort === 'max' ? 'high' : effort;
	}

	if (isNim && /glm|qwen|deepseek-r1|nemotron|qwq/.test(modelLc)) {
		if (effortValue === 'none') { body.chat_template_kwargs = { enable_thinking: false }; }
		else if (effort) { body.chat_template_kwargs = { enable_thinking: true }; }
	}
	return body;
}
