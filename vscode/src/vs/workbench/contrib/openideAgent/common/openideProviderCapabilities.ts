/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — shared capability detection for models and endpoints.
 *--------------------------------------------------------------------------------------------*/

/** Recognizes explicit rejections only. Schema/argument errors must not disable every tool,
 *  since they usually point at one faulty definition. */
export function isToolCallingUnsupportedError(message: string): boolean {
	const value = message.toLowerCase();
	return /(?:does not|doesn't|do not|not) support.{0,40}(?:tool|function)[ _-]?(?:call|calling)?/.test(value)
		|| /(?:tool|function)[ _-]?(?:call|calling)?.{0,40}(?:not supported|unsupported|unavailable)/.test(value)
		|| /unsupported (?:parameter|field).{0,20}["'`]?tools?["'`]?/.test(value)
		|| /["'`]?tools?["'`]?.{0,20}(?:is not allowed|is unavailable for this model)/.test(value);
}

export function providerModelCapabilityKey(providerId: string | undefined, baseUrl: string | undefined, model: string): string {
	return `${providerId ?? ''}\u0000${baseUrl?.replace(/\/+$/, '').toLowerCase() ?? ''}\u0000${model.trim().toLowerCase()}`;
}

/** Ids the backend returns that are not selectable models: numbered internal surfaces
 *  (`chat_20706`) that showed up in the picker with no name and no family. */
function isSelectableModelId(id: string): boolean {
	return !/^chat_\d+$/i.test(id);
}

/** Normalizes the two discovery shapes used by the adapters: OpenAI `{data:[{id}]}` and
 *  Antigravity `{models:{id: metadata}}`. A `models` array is also tolerated for compatibility.
 *
 *  In the map shape, each entry's metadata says whether the backend considers it presentable:
 *  a real model carries `displayName`. Antigravity mixes internal entries in there that used to
 *  reach the picker as selectable models. Both filters are fail-open: if they would empty the
 *  list, the original is returned — having no models is worse than showing one too many. */
export function modelIdsFromProviderResponse(value: unknown): string[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return [];
	}
	const record = value as Record<string, unknown>;
	const data = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : undefined;
	let ids: string[];
	if (data) {
		ids = data.map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).id : item)
			.filter((id): id is string => typeof id === 'string' && id.length > 0);
	} else if (record.models && typeof record.models === 'object') {
		const entries = Object.entries(record.models as Record<string, unknown>);
		const named = entries.filter(([, metadata]) => {
			const name = (metadata as Record<string, unknown> | null)?.['displayName'];
			return typeof name === 'string' && name.length > 0;
		});
		ids = (named.length ? named : entries).map(([id]) => id);
	} else {
		ids = [];
	}
	const selectable = ids.filter(isSelectableModelId);
	return [...new Set(selectable.length ? selectable : ids)].sort((a, b) => a.localeCompare(b));
}
