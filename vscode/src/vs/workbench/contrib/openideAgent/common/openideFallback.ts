/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — normalized failover chain by provider and model.
 *--------------------------------------------------------------------------------------------*/

export interface IFallbackStep {
	readonly providerId: string;
	readonly model?: string;
}

export function parseProviderModelTarget(value: unknown): IFallbackStep | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	const separator = normalized.indexOf('/');
	if (separator <= 0 || separator === normalized.length - 1) {
		return undefined;
	}
	return { providerId: normalized.slice(0, separator), model: normalized.slice(separator + 1) };
}

export function fallbackStepKey(step: IFallbackStep): string {
	return `${step.providerId}\u0000${step.model ?? ''}`;
}

export function parseFallbackChain(value: unknown, legacyProviders: unknown): IFallbackStep[] {
	const steps: IFallbackStep[] = [];
	const seen = new Set<string>();
	const add = (providerIdValue: unknown, modelValue?: unknown) => {
		const providerId = typeof providerIdValue === 'string' ? providerIdValue.trim() : '';
		const model = typeof modelValue === 'string' ? modelValue.trim() : '';
		if (!providerId) {
			return;
		}
		const step: IFallbackStep = { providerId, ...(model ? { model } : {}) };
		const key = fallbackStepKey(step);
		if (!seen.has(key)) {
			seen.add(key);
			steps.push(step);
		}
	};

	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === 'string') {
				const separator = item.indexOf('/');
				add(separator > 0 ? item.slice(0, separator) : item, separator > 0 ? item.slice(separator + 1) : undefined);
			} else if (item && typeof item === 'object') {
				const record = item as Record<string, unknown>;
				add(record.providerId ?? record.provider, record.model);
			}
		}
	}
	if (!steps.length && Array.isArray(legacyProviders)) {
		for (const providerId of legacyProviders) {
			add(providerId);
		}
	}
	return steps;
}
