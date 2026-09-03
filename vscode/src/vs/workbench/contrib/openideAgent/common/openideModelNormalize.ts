/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — conservative slug normalization across aggregators and direct APIs.
 *--------------------------------------------------------------------------------------------*/

import { IProviderEntry } from './openideProviderCatalog.js';

const DIRECT_VENDOR_PREFIXES: Readonly<Record<string, readonly string[]>> = {
	anthropic: ['anthropic/'],
	openai: ['openai/'],
	deepseek: ['deepseek/'],
	gemini: ['google/'],
};

export function normalizeModelForProvider(model: string, provider: Pick<IProviderEntry, 'id' | 'defaultModel'>): string {
	let value = String(model ?? '').trim();
	if (!value) {
		return provider.defaultModel ?? '';
	}
	for (const prefix of DIRECT_VENDOR_PREFIXES[provider.id] ?? []) {
		if (value.toLowerCase().startsWith(prefix)) {
			value = value.slice(prefix.length);
			break;
		}
	}
	return value;
}
