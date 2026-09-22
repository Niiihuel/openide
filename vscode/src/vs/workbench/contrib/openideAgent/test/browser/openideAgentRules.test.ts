/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { AgentInstructionFileType,IPromptsService } from '../../../chat/common/promptSyntax/service/promptsService.js';
import { OpenideAgentRules } from '../../browser/openideAgentRules.js';

suite('OpenIDE agent AGENTS.md instructions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = URI.from({ scheme: Schemas.inMemory, path: '/workspace' });
	const userHome = URI.from({ scheme: Schemas.inMemory, path: '/home/test' });

	async function fixture(trusted: boolean) {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
		const context = new TestContextService(testWorkspace(workspace));
		const rootAgents = joinPath(workspace, 'AGENTS.md');
		const prompts = upcastPartial<IPromptsService>({
			listAgentInstructions: async () => [{ uri: rootAgents, realPath: undefined, type: AgentInstructionFileType.agentsMd }],
		});
		const trust = upcastPartial<IWorkspaceTrustManagementService>({ isWorkspaceTrusted: () => trusted });
		const environment = upcastPartial<IEnvironmentService>({ userRoamingDataHome: URI.from({ scheme: Schemas.inMemory, path: '/user-data' }) });
		const rules = new OpenideAgentRules(files, context, environment, prompts, trust, userHome);
		return { files, rootAgents, rules };
	}

	test('loads global instructions first and prefers a project override', async () => {
		const { files, rootAgents, rules } = await fixture(true);
		await files.writeFile(joinPath(userHome, '.codex', 'AGENTS.md'), VSBuffer.fromString('global instruction'));
		await files.writeFile(rootAgents, VSBuffer.fromString('root instruction'));
		await files.writeFile(joinPath(workspace, 'AGENTS.override.md'), VSBuffer.fromString('project override'));

		const block = await rules.buildPromptBlock();
		assert.match(block, /global instruction/);
		assert.match(block, /project override/);
		assert.doesNotMatch(block, /root instruction/);
		assert.ok(block.indexOf('global instruction') < block.indexOf('project override'));
	});

	test('does not load project AGENTS.md from an untrusted workspace', async () => {
		const { files, rootAgents, rules } = await fixture(false);
		await files.writeFile(joinPath(userHome, '.codex', 'AGENTS.md'), VSBuffer.fromString('trusted global instruction'));
		await files.writeFile(rootAgents, VSBuffer.fromString('untrusted project instruction'));
		await files.writeFile(joinPath(workspace, '.openide', 'rules', 'repository.md'), VSBuffer.fromString('untrusted legacy rule'));

		const block = await rules.buildPromptBlock();
		assert.match(block, /trusted global instruction/);
		assert.doesNotMatch(block, /untrusted project instruction/);
		assert.doesNotMatch(block, /untrusted legacy rule/);
	});

	test('falls back to AGENTS.md when the override is empty', async () => {
		const { files, rootAgents, rules } = await fixture(true);
		await files.writeFile(rootAgents, VSBuffer.fromString('root fallback instruction'));
		await files.writeFile(joinPath(workspace, 'AGENTS.override.md'), VSBuffer.fromString('  \n'));

		assert.match(await rules.buildPromptBlock(), /root fallback instruction/);
	});
});
