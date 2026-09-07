/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lstat, readlink, realpath } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';

async function canonical(path: string): Promise<string> {
	try { return await realpath(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
		const parent = dirname(path);
		// A dangling link is not a missing filename: creating through it would reach its target.
		try {
			if ((await lstat(path)).isSymbolicLink()) { return canonical(resolve(parent, await readlink(path))); }
		} catch (statError) {
			if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') { throw statError; }
		}
		if (parent === path) { throw error; }
		return resolve(await canonical(parent), relative(parent, path));
	}
}

function contains(root: string, path: string): boolean {
	const rel = relative(root, path);
	return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Validate existing targets and nearest existing ancestors for creation against canonical roots.
 * Call at operation boundaries; an external process can still race a later filesystem operation.
 */
export async function validateOpenideWorkspacePath(request: { path: string; roots: readonly string[]; mutation?: boolean }): Promise<void> {
	if (!isAbsolute(request.path) || !request.roots.length || request.roots.some(root => !isAbsolute(root))) {
		throw new Error('Workspace access requires an absolute path and assigned workspace roots.');
	}
	const path = await canonical(request.path);
	const roots = await Promise.all(request.roots.map(root => realpath(root)));
	if (request.mutation && [request.path, path].some(candidate => candidate.split(/[\\/]/).some(segment => segment.toLowerCase() === '.git'))) { throw new Error('OpenIDE file tools cannot modify Git metadata.'); }
	if (!roots.some(root => contains(root, path))) { throw new Error('The resolved path is outside the assigned workspace (including symbolic links).'); }
}
