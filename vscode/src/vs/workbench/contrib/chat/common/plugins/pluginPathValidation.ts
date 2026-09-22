/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/**
 * A path segment that has one stable spelling on the filesystems supported by
 * the desktop client. This prevents distinct registry coordinates from
 * aliasing to the same path on Windows or normalization-sensitive filesystems.
 */
export function isPortablePluginPathSegment(value: string): boolean {
	return value.length > 0
		&& value === value.normalize('NFC')
		&& value !== '.'
		&& value !== '..'
		&& !/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/.test(value)
		&& !/[. ]$/.test(value)
		&& !WINDOWS_DEVICE_NAME.test(value);
}

export function isCanonicalPluginRelativePath(value: unknown, allowEmpty: boolean): value is string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value !== value.trim() || value.startsWith('/') || value.endsWith('/') || value.includes('\\') || value.includes('//')) {
		return false;
	}
	if (value.length === 0) {
		return allowEmpty;
	}
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return false;
	}
	return decoded.split('/').every(isPortablePluginPathSegment);
}

/** Allows a single package segment, or an npm-style @scope/name pair. */
export function isPortablePluginPackageName(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) {
		return false;
	}
	const segments = value.split('/');
	if (segments.length === 1) {
		return isPortablePluginPathSegment(segments[0]);
	}
	return segments.length === 2
		&& segments[0].startsWith('@')
		&& segments[0].length > 1
		&& isPortablePluginPathSegment(segments[0])
		&& isPortablePluginPathSegment(segments[1]);
}

/** Keep registry persistence checks and runtime materialization on one path algorithm. */
export function getRegistryPluginInstallUri(cacheRoot: URI, artifactUrl: string, publisherId: string, pluginId: string): URI {
	const parsed = URI.parse(artifactUrl);
	const marker = '/v1/publishers/';
	const markerIndex = parsed.path.indexOf(marker);
	const registryBasePath = markerIndex >= 0 ? parsed.path.slice(0, markerIndex) : '';
	const origin = sanitizePluginCacheSegment(`${parsed.scheme}_${parsed.authority.toLowerCase() || 'unknown'}`);
	const baseSegments = registryBasePath.split('/').filter(Boolean).map(sanitizePluginCacheSegment);
	return joinPath(cacheRoot, 'registry', origin, ...baseSegments, publisherId, pluginId);
}

function sanitizePluginCacheSegment(value: string): string {
	return value.replace(/[\\/:*?"<>|]/g, '_');
}
