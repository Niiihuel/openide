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

/**
 * The endpoint said the model cannot take pictures. OpenRouter: "No endpoints found that support
 * image input"; OpenAI-compatible servers: "does not support image(s)/vision", "image_url is not
 * supported", "invalid content type: image_url". A recording ends with a contact sheet attached
 * to the turn, so without this a text-only model turned every recording into a failed turn.
 */
export function isImageInputUnsupportedError(message: string): boolean {
	const value = message.toLowerCase();
	return /support(?:s)? image[ _-]?input/.test(value)
		|| /(?:does not|doesn't|do not|not) support.{0,40}(?:image|vision|multimodal)/.test(value)
		|| /(?:image|image_url|vision).{0,40}(?:not supported|unsupported|unavailable|not allowed)/.test(value)
		|| /invalid (?:content )?type.{0,20}image_url/.test(value);
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

/** Live endpoint modalities override registry guesses, including an explicitly text-only model.
 * OpenRouter publishes architecture; compatible catalogs can publish modalities directly. */
export function modelModalitiesFromProviderResponse(value: unknown): ReadonlyMap<string, { input?: string[]; output?: string[] }> {
	const result = new Map<string, { input?: string[]; output?: string[] }>();
	if (!value || typeof value !== 'object') { return result; }
	const data = (value as Record<string, unknown>).data;
	if (!Array.isArray(data)) { return result; }
	const strings = (value: unknown): string[] | undefined => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
	for (const entry of data) {
		if (!entry || typeof entry !== 'object') { continue; }
		const model = entry as Record<string, unknown>;
		if (typeof model.id !== 'string') { continue; }
		const architecture = model.architecture && typeof model.architecture === 'object' ? model.architecture as Record<string, unknown> : {};
		const modalities = model.modalities && typeof model.modalities === 'object' ? model.modalities as Record<string, unknown> : {};
		const input = strings(architecture.input_modalities) ?? strings(modalities.input);
		const output = strings(architecture.output_modalities) ?? strings(modalities.output);
		if (input || output) { result.set(model.id, { input, output }); }
	}
	return result;
}
