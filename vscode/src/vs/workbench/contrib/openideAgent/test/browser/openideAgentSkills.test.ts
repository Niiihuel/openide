/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Schemas } from '../../../../../base/common/network.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { PluginFormat } from '../../../../../platform/agentPlugins/common/pluginParsers.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { ContributionEnablementState } from '../../../chat/common/enablement.js';
import { IAgentPlugin,IAgentPluginService } from '../../../chat/common/plugins/agentPluginService.js';
import { OpenideAgentSkills } from '../../browser/openideAgentSkills.js';

suite('OpenIDE Agent Skills compatibility', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('skill_save writes the portable .agents layout', async () => {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
		const workspace = URI.from({ scheme: Schemas.inMemory, path: '/workspace' });
		const userHome = URI.from({ scheme: Schemas.inMemory, path: '/home/test' });
		const skills = new OpenideAgentSkills(
			files,
			new TestContextService(testWorkspace(workspace)),
			new TestConfigurationService(),
			joinPath(userHome, '.agents', 'skills'),
			undefined,
			joinPath(userHome, '.config', 'agents', 'skills'),
		);

		const result = await skills.saveSkill('portable-skill', 'Use when testing portable skills.', '# Steps\n\nDo the thing.');
		const canonical = joinPath(workspace, '.agents', 'skills', 'portable-skill', 'SKILL.md');
		const legacy = joinPath(workspace, '.openide', 'skills', 'portable-skill', 'SKILL.md');

		assert.match(result, /\.agents\/skills\/portable-skill\/SKILL\.md/);
		assert.strictEqual(await files.exists(canonical), true);
		assert.strictEqual(await files.exists(legacy), false);
		assert.match((await skills.readSkill('portable-skill')) ?? '', /name: portable-skill/);

		await files.writeFile(legacy, VSBuffer.fromString('---\nname: portable-skill\ndescription: Legacy copy\n---\n\nlegacy body'));
		const rediscovered = new OpenideAgentSkills(
			files,
			new TestContextService(testWorkspace(workspace)),
			new TestConfigurationService(),
			joinPath(userHome, '.agents', 'skills'),
		);
		assert.ok((await rediscovered.listSkills()).some(skill => skill.name === 'portable-skill' && skill.location === 'agents'));
		assert.doesNotMatch((await rediscovered.readSkill('portable-skill')) ?? '', /legacy body/);
	});

	test('enabled plugin skills are namespaced, readable and managed by their plugin', async () => {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
		const workspace = URI.from({ scheme: Schemas.inMemory, path: '/workspace' });
		const skillUri = joinPath(workspace, 'plugins', 'team-tools', 'skills', 'deploy', 'SKILL.md');
		await files.writeFile(skillUri, VSBuffer.fromString('---\nname: deploy\ndescription: Deploy safely\n---\n\n# Deploy'));
		const plugin: IAgentPlugin = {
			uri: joinPath(workspace, 'plugins', 'team-tools'),
			format: PluginFormat.AgentPlugin,
			label: 'team-tools',
			enablement: observableValue('pluginEnablement', ContributionEnablementState.EnabledProfile),
			hooks: observableValue('pluginHooks', []),
			commands: observableValue('pluginCommands', []),
			skills: observableValue('pluginSkills', [
				{ uri: skillUri, name: 'deploy', description: 'Deploy safely' },
				{ uri: skillUri, name: 'team-tools', description: 'Plugin overview' },
			]),
			agents: observableValue('pluginAgents', []),
			instructions: observableValue('pluginInstructions', []),
			mcpServerDefinitions: observableValue('pluginMcp', []),
		};
		const pluginService = { plugins: observableValue<readonly IAgentPlugin[]>('plugins', [plugin]) } as unknown as IAgentPluginService;
		const skills = new OpenideAgentSkills(
			files,
			new TestContextService(testWorkspace(workspace)),
			new TestConfigurationService(),
			URI.from({ scheme: Schemas.inMemory, path: '/home/test/.agents/skills' }),
			pluginService,
		);

		assert.strictEqual(await skills.deleteSkill('team-tools'), false);
		const listed = await skills.listSkills();
		assert.ok(listed.some(skill => skill.name === 'team-tools:deploy' && skill.location === 'plugin'));
		assert.match((await skills.readSkill('team-tools:deploy')) ?? '', /# Deploy/);
		assert.strictEqual(await skills.deleteSkill('team-tools:deploy'), false);
	});

	test('does not load or create project skills in an untrusted workspace', async () => {
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
		const workspace = URI.from({ scheme: Schemas.inMemory, path: '/workspace' });
		const globalRoot = URI.from({ scheme: Schemas.inMemory, path: '/home/test/.agents/skills' });
		await files.writeFile(joinPath(workspace, '.agents', 'skills', 'project-skill', 'SKILL.md'), VSBuffer.fromString('---\nname: project-skill\ndescription: Untrusted\n---'));
		await files.writeFile(joinPath(globalRoot, 'global-skill', 'SKILL.md'), VSBuffer.fromString('---\nname: global-skill\ndescription: Personal\n---'));
		const skills = new OpenideAgentSkills(
			files,
			new TestContextService(testWorkspace(workspace)),
			new TestConfigurationService(),
			globalRoot,
			undefined,
			undefined,
			upcastPartial<IWorkspaceTrustManagementService>({ isWorkspaceTrusted: () => false }),
		);

		assert.deepStrictEqual((await skills.listSkills()).map(skill => skill.name).sort(), ['global-skill', 'openide-canvas']);
		assert.strictEqual(await skills.readSkill('project-skill'), undefined);
		assert.match(await skills.saveSkill('blocked', 'Blocked', 'Do not write'), /workspace is trusted/);
	});
});
