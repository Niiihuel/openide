/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — reading/writing subagent definitions. The Markdown is the single source of
 *  truth; this service keeps no parallel configuration.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { parseSubagentDefinition, serializeSubagentDefinition, updateSubagentDefinition } from '../common/openideSubagentDefinition.js';
import { IParsedSubagentDefinition, ISubagentDefinition, SubagentScope } from '../common/openideSubagentTypes.js';

export const ISubagentDefinitionService = createDecorator<ISubagentDefinitionService>('openideSubagentDefinitionService');

export interface ISubagentDefinitionService {
	readonly _serviceBrand: undefined;
	read(resource: URI, scope: SubagentScope): Promise<IParsedSubagentDefinition>;
	write(resource: URI, definition: Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>): Promise<void>;
	update(resource: URI, scope: SubagentScope, patch: Partial<Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>>): Promise<IParsedSubagentDefinition>;
}

export class SubagentDefinitionService implements ISubagentDefinitionService {
	declare readonly _serviceBrand: undefined;

	constructor(@IFileService private readonly fileService: IFileService) { }

	async read(resource: URI, scope: SubagentScope): Promise<IParsedSubagentDefinition> {
		const file = await this.fileService.readFile(resource, { atomic: true });
		return parseSubagentDefinition(file.value.toString(), resource, scope, file.mtime || Date.now());
	}

	async write(resource: URI, definition: Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>): Promise<void> {
		await this.fileService.writeFile(resource, VSBuffer.fromString(serializeSubagentDefinition(definition)), { atomic: { postfix: '.openide-agent' } });
	}

	async update(resource: URI, scope: SubagentScope, patch: Partial<Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>>): Promise<IParsedSubagentDefinition> {
		const file = await this.fileService.readFile(resource, { atomic: true });
		const next = updateSubagentDefinition(file.value.toString(), resource, scope, file.mtime || Date.now(), patch);
		await this.fileService.writeFile(resource, VSBuffer.fromString(next), { etag: file.etag, mtime: file.mtime, atomic: { postfix: '.openide-agent' } });
		return this.read(resource, scope);
	}
}
