/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpath } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { isWindows } from '../../../base/common/platform.js';

const owners = new Set<OpenideRestoreLocks>();
const held = new Map<string, string>();

async function canonicalPath(path: string): Promise<string> {
	try {
		const result = await realpath(path);
		return isWindows ? result.toLowerCase() : result;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
		const parent = dirname(path);
		if (parent === path) { throw error; }
		return resolve(await canonicalPath(parent), relative(parent, path));
	}
}

function contains(root: string, path: string): boolean {
	const rel = relative(root, path);
	return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** One authenticated renderer's leases; the registry is shared by the main process. */
export class OpenideRestoreLocks {
	private roots: readonly string[] = [];
	private ready: Promise<void> = Promise.resolve();
	private readonly leases = new Map<string, readonly string[]>();
	private disposed = false;
	// A connected window has unknown editor state until it registers its workspace.
	private registering = true;
	private workspaceGeneration = 0;

	constructor() { owners.add(this); }

	setWorkspace(roots: readonly string[]): Promise<void> {
		const generation = ++this.workspaceGeneration;
		this.registering = true;
		this.ready = Promise.all(roots.map(path => {
			if (!isAbsolute(path) || path.includes('\0')) { throw new Error('Invalid restore workspace.'); }
			return canonicalPath(path);
		})).then(paths => {
			if (generation === this.workspaceGeneration) { this.roots = paths; this.registering = false; }
		});
		return this.ready;
	}

	async acquire(resources: readonly string[]): Promise<string | undefined> {
		if (this.disposed || !resources.length || resources.length > 1024 || resources.some(path => !isAbsolute(path) || path.includes('\0'))) {
			return undefined;
		}
		try {
			await Promise.all([...owners].map(owner => owner.ready));
			const paths = [...new Set(await Promise.all(resources.map(canonicalPath)))];
			if (this.disposed || [...owners].some(owner => owner.registering) || paths.some(path => !this.roots.some(root => contains(root, path)) || held.has(path))) { return undefined; }
			// Another open window may have an unsaved buffer or a writer that this renderer cannot
			// observe. Refuse until that owner closes, rather than treating local idle as global idle.
			if ([...owners].some(owner => owner !== this && paths.some(path => owner.roots.some(root => contains(root, path))))) { return undefined; }
			const lease = randomUUID();
			for (const path of paths) { held.set(path, lease); }
			this.leases.set(lease, paths);
			return lease;
		} catch {
			return undefined;
		}
	}

	release(lease: string): void {
		const paths = this.leases.get(lease);
		if (!paths) { return; }
		for (const path of paths) { if (held.get(path) === lease) { held.delete(path); } }
		this.leases.delete(lease);
	}

	dispose(): void {
		this.disposed = true;
		for (const lease of this.leases.keys()) { this.release(lease); }
		owners.delete(this);
	}
}
