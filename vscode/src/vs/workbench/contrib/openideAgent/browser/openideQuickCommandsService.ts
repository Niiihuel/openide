/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — persistence of terminal quick commands (see common/openideQuickCommands.ts).
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IQuickCommand, QuickCommandScope, parseQuickCommandsFile, serializeQuickCommands } from '../common/openideQuickCommands.js';

export class OpenideQuickCommandsService {

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
	) { }

	fileUri(scope: QuickCommandScope): URI | undefined {
		if (scope === 'global') {
			return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'quick-commands.json');
		}
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'quick-commands.json') : undefined;
	}

	private async readScope(scope: QuickCommandScope): Promise<IQuickCommand[]> {
		const uri = this.fileUri(scope);
		if (!uri) {
			return [];
		}
		try {
			const content = (await this.fileService.readFile(uri)).value.toString();
			return parseQuickCommandsFile(content, scope);
		} catch {
			return [];
		}
	}

	async listAll(): Promise<IQuickCommand[]> {
		const [project, global] = await Promise.all([this.readScope('project'), this.readScope('global')]);
		return [...global, ...project];
	}

	private async writeScope(scope: QuickCommandScope, commands: readonly IQuickCommand[]): Promise<void> {
		const uri = this.fileUri(scope);
		if (!uri) {
			throw new Error('No hay una carpeta abierta para guardar un comando rápido de proyecto.');
		}
		await this.fileService.writeFile(uri, VSBuffer.fromString(serializeQuickCommands(commands)));
	}

	/** Creates (without `id`) or updates (with `id`) an entry within its scope. */
	async upsert(scope: QuickCommandScope, entry: { id?: string; label: string; command: string }): Promise<IQuickCommand> {
		const current = await this.readScope(scope);
		const id = entry.id || generateUuid();
		const next: IQuickCommand = { id, label: entry.label.trim(), command: entry.command.trim(), scope };
		const index = current.findIndex(existing => existing.id === id);
		if (index >= 0) {
			current[index] = next;
		} else {
			current.push(next);
		}
		await this.writeScope(scope, current);
		return next;
	}

	async remove(scope: QuickCommandScope, id: string): Promise<boolean> {
		const current = await this.readScope(scope);
		const next = current.filter(entry => entry.id !== id);
		if (next.length === current.length) {
			return false;
		}
		await this.writeScope(scope, next);
		return true;
	}
}
