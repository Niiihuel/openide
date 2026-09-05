/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ISetting, ISettingsGroup } from '../../../../services/preferences/common/preferences.js';
import { Settings2EditorModel } from '../../../../services/preferences/common/preferencesModels.js';
import { OpenideSettingsModel } from '../../../openideSettings/browser/openideSettingsModel.js';

suite('OpenIDE settings search snapshot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
	const setting = (key: string): ISetting => ({ key, type: 'number', value: 14, description: ['Font size'], range, keyRange: range, valueRange: range, descriptionRanges: [] });
	function fixture() {
		const configuration = new class extends TestConfigurationService {
			readonly reads: { key: string; overrides?: IConfigurationOverrides }[] = [];
			override updateValue(key: string, value: unknown): Promise<void> {
				return this.setUserConfiguration(key, value);
			}
			override inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationValue<T> {
				this.reads.push({ key, overrides });
				return super.inspect<T>(key, overrides);
			}
		}({ editor: { fontSize: 14 } });
		const groups: ISettingsGroup[] = [{ id: 'editor', title: 'Editor', range, titleRange: range, sections: [{ settings: [setting('editor.fontSize'), setting('terminal.integrated.fontSize')] }] }];
		const model = new OpenideSettingsModel(configuration);
		model.setModel({ settingsGroups: groups } as Settings2EditorModel);
		return { model, configuration, groups };
	}

	test('typing and navigation do not inspect every configuration value', () => {
		const { model, configuration } = fixture();
		for (const query of ['f', 'fo', 'font', 'not a setting']) {
			model.setState({ query });
			model.visibleNavigation;
			model.groupItems(model.items());
			model.activeNavigationLabel;
			model.navigationPath('editor');
		}
		assert.strictEqual(configuration.reads.length, 0);
		model.setState({ query: 'font' });
		const item = model.items()[0];
		assert.strictEqual(item.value.effective, 14);
		assert.strictEqual(item.value.configured, true);
		assert.strictEqual(configuration.reads.length, 1);
	});

	test('updates and external invalidation refresh values and modified results', async () => {
		const { model, configuration } = fixture();
		model.setState({ query: '@modified' });
		assert.deepStrictEqual(model.items().map(item => item.key), ['editor.fontSize']);
		await model.update(model.items()[0], 20);
		assert.strictEqual(model.items()[0].value.effective, 20);
		await configuration.updateValue('terminal.integrated.fontSize', 16);
		model.invalidate();
		assert.strictEqual(model.items().length, 2);
	});

	test('scope, folder and language changes do not reuse inspected values', () => {
		const { model, configuration } = fixture();
		model.setState({ query: '@modified' });
		assert.strictEqual(model.items().length, 1);
		model.setState({ target: ConfigurationTarget.WORKSPACE });
		assert.strictEqual(model.items().length, 0);
		const folderUri = URI.file('/workspace/second');
		model.setState({ target: ConfigurationTarget.USER_LOCAL, folderUri, language: 'typescript' });
		assert.strictEqual(model.items().length, 1);
		assert.deepStrictEqual(configuration.reads.at(-1)?.overrides, { resource: folderUri, overrideIdentifier: 'typescript' });
	});

	test('category filtering does not contaminate the shared search results', () => {
		const { model } = fixture();
		model.setState({ query: 'font size', category: 'commonlyUsed' });
		assert.deepStrictEqual(model.items().map(item => item.key), ['editor.fontSize']);
		model.setState({ category: 'home' });
		assert.strictEqual(model.items().length, 2);
		model.setState({ query: 'no match' });
		assert.strictEqual(model.items().length, 0);
	});

	test('schema invalidation refreshes the catalog and releasing the input clears results', () => {
		const { model, groups } = fixture();
		model.items();
		const previousNavigation = model.navigation;
		groups[0].sections[0].settings.push(setting('editor.lineHeight'));
		model.invalidate();
		assert.notStrictEqual(model.navigation, previousNavigation);
		model.setState({ query: '@id:editor.lineHeight' });
		assert.deepStrictEqual(model.items().map(item => item.key), ['editor.lineHeight']);
		model.setModel(undefined);
		assert.deepStrictEqual(model.items(), []);
		assert.deepStrictEqual(model.navigation, []);
	});
});
