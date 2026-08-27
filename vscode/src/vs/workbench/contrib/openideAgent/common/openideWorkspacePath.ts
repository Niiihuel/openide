/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^\\\\/;

function isAbsoluteFilePath(path: string): boolean {
	return path.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(path) || WINDOWS_UNC_PATH.test(path);
}

/**
 * Resolves a model-provided path without allowing it to escape the open workspace.
 * Relative paths use the first workspace root, matching the rest of the agent UI.
 */
export function resolvePathInsideWorkspace(path: string, roots: readonly URI[]): URI | undefined {
	const value = String(path ?? '').trim();
	if (!value || !roots.length) {
		return undefined;
	}

	const candidate = isAbsoluteFilePath(value)
		? URI.file(value)
		: URI.joinPath(roots[0], value);

	return roots.some(root => extUriBiasedIgnorePathCase.isEqualOrParent(candidate, root))
		? candidate
		: undefined;
}
