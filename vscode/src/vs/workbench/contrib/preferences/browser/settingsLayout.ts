/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ISetting, ISettingsGroup } from '../../../services/preferences/common/preferences.js';
import { t } from '../../openideAgent/common/openideStrings.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	/** Optional workbench command for categories backed by a dedicated visual manager. */
	command?: string;
	hide?: boolean;
}

const COMMONLY_USED_SETTINGS: readonly string[] = [
	'editor.fontSize',
	'editor.formatOnSave',
	'files.autoSave',
	'editor.defaultFormatter',
	'editor.fontFamily',
	'editor.wordWrap',
	'chat.agent.maxRequests',
	'files.exclude',
	'workbench.colorTheme',
	'editor.tabSize',
	'editor.mouseWheelZoom',
	'editor.formatOnPaste'
];

export function getCommonlyUsedData(settingGroups: ISettingsGroup[]): ITOCEntry<ISetting> {
	const allSettings = new Map<string, ISetting>();
	for (const group of settingGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				allSettings.set(s.key, s);
			}
		}
	}
	const settings: ISetting[] = [];
	for (const id of COMMONLY_USED_SETTINGS) {
		const setting = allSettings.get(id);
		if (setting) {
			settings.push(setting);
		}
	}
	return {
		id: 'commonlyUsed',
		label: localize('commonlyUsed', "Commonly Used"),
		settings
	};
}

export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{
			id: 'editor',
			label: localize('textEditor', "Text Editor"),
			settings: ['editor.*'],
			children: [
				{
					id: 'editor/cursor',
					label: localize('cursor', "Cursor"),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', "Find"),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', "Font"),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', "Formatting"),
					settings: ['editor.format*']
				},
				{
					id: 'editor/diffEditor',
					label: localize('diffEditor', "Diff Editor"),
					settings: ['diffEditor.*']
				},
				{
					id: 'editor/multiDiffEditor',
					label: localize('multiDiffEditor', "Multi-File Diff Editor"),
					settings: ['multiDiffEditor.*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', "Minimap"),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/suggestions',
					label: localize('suggestions', "Suggestions"),
					settings: ['editor.*suggest*']
				},
				{
					id: 'editor/files',
					label: localize('files', "Files"),
					settings: ['files.*']
				}
			]
		},
		{
			id: 'workbench',
			label: localize('workbench', "Workbench"),
			settings: ['workbench.*'],
			children: [
				{
					id: 'workbench/appearance',
					label: localize('appearance', "Appearance"),
					settings: ['workbench.activityBar.*', 'workbench.*color*', 'workbench.fontAliasing', 'workbench.iconTheme', 'workbench.sidebar.location', 'workbench.*.visible', 'workbench.tips.enabled', 'workbench.tree.*', 'workbench.view.*']
				},
				{
					id: 'workbench/breadcrumbs',
					label: localize('breadcrumbs', "Breadcrumbs"),
					settings: ['breadcrumbs.*']
				},
				{
					id: 'workbench/editor',
					label: localize('editorManagement', "Editor Management"),
					settings: ['workbench.editor.*']
				},
				{
					id: 'workbench/settings',
					label: localize('settings', "Settings Editor"),
					settings: ['workbench.settings.*']
				},
				{
					id: 'workbench/zenmode',
					label: localize('zenMode', "Zen Mode"),
					settings: ['zenmode.*']
				},
				{
					// OpenIDE: display language (language packs) + the fork's own strings. Rendered by
					// OpenideLanguageSettingsSection; the label follows `openide.language`.
					id: 'workbench/language',
					label: localize('openideLanguage', "Language")
				},
				{
					id: 'workbench/screencastmode',
					label: localize('screencastMode', "Screencast Mode"),
					settings: ['screencastMode.*']
				}
			]
		},
		{
			id: 'window',
			label: localize('window', "Window"),
			settings: ['window.*'],
			children: [
				{
					id: 'window/newWindow',
					label: localize('newWindow', "New Window"),
					settings: ['window.*newwindow*']
				}
			]
		},
		// OpenIDE is a product of its own and the agent is part of the base product. The visual
		// surfaces are declared as TOC commands; the technical settings are grouped under
		// Advanced, without duplicating editors or renderers.
		{
			id: 'openideAgent',
			label: t('settingsToc.agent'),
			children: [
				{
					id: 'openideAgent/providers',
					label: t('settingsToc.agentProviders')
				},
				{
					id: 'openideAgent/chat',
					label: t('settingsToc.agentChat'),
					settings: [
						'openide.chat.*',
						'openide.agent.maxAgentIterations',
						'openide.agent.streamStaleTimeoutSeconds'
					]
				},
				{
					id: 'openideAgent/voice',
					label: t('settingsToc.agentVoice'),
					settings: [
						'openide.agent.voiceModel',
						'openide.agent.voiceMode'
					]
				},
				{
					id: 'openideAgent/context',
					label: t('settingsToc.agentContext'),
					settings: [
						'openide.agent.contextTokens',
						'openide.agent.maxOutputTokens',
						'openide.agent.autoCompact',
						'openide.agent.compactionThreshold',
						'openide.agent.compactionTailRatio',
						'openide.agent.compactionModel'
					]
				},
				{
					id: 'openideAgent/skills',
					label: localize('openideAgentSkills', "Skills")
				},
				{
					id: 'openideAgent/mcp',
					label: localize('openideAgentMcp', "MCP")
				},
				{
					id: 'openideAgent/rules',
					label: localize('openideAgentRules', "Rules")
				},
				{
					id: 'openideAgent/hooks',
					label: localize('openideAgentHooks', "Hooks")
				},
				{
					id: 'openideAgent/commands',
					label: t('settingsToc.agentCommands')
				},
				{
					id: 'openideAgent/quickCommands',
					label: t('settingsToc.agentQuickCommands')
				},
				{
					id: 'openideAgent/subagents',
					label: t('settingsToc.agentSubagents'),
					settings: ['openide.subagents.*']
				},
				{
					id: 'openideAgent/projectMap',
					label: localize('openideAgentProjectMap', "Project Map"),
					settings: ['openide.memory.*']
				},
				{
					id: 'openideAgent/notifications',
					label: t('settingsToc.agentNotifications'),
					settings: ['openide.agent.notifications.*']
				},
				{
					id: 'openideAgent/browser',
					label: t('settingsToc.agentBrowser'),
					settings: ['workbench.browser.*', 'openide.agent.browserAllowedHosts', 'openide.agent.browserTools.*']
				},
				{
					id: 'openideAgent/import',
					label: t('settingsToc.agentImport'),
					settings: [],
				},
				{
					id: 'openideAgent/advanced',
					label: t('settingsToc.agentAdvanced'),
					settings: [
						'openide.agent.customProviders',
						'openide.agent.fallbackProviders',
						'openide.agent.fallbackChain',
						'openide.agent.accountFailover',
						'openide.agent.toolAllowlist',
						'openide.agent.web.enabled',
						'openide.agent.web.searchEndpoint',
						'openide.agent.web.allowedHosts',
						'openide.agent.web.blockedHosts',
						'openide.agent.web.allowHttp',
						'openide.agent.web.timeoutSeconds',
						'openide.agent.web.maxResponseBytes',
						'openide.agent.web.maxExtractedChars',
						'openide.agent.mcp.enabled',
						'openide.agent.hooks.enabled',
						'openide.agent.googleCloudProject',
						'openide.agent.disabledSkills'
					]
				}
			]
		},
		{
			id: 'features',
			label: localize('features', "Features"),
			children: [
				{
					id: 'features/accessibilitySignals',
					label: localize('accessibility.signals', 'Accessibility Signals'),
					settings: ['accessibility.signal*']
				},
				{
					id: 'features/accessibility',
					label: localize('accessibility', "Accessibility"),
					settings: ['accessibility.*']
				},
				{
					id: 'features/explorer',
					label: localize('fileExplorer', "Explorer"),
					settings: ['explorer.*', 'outline.*']
				},
				{
					id: 'features/search',
					label: localize('search', "Search"),
					settings: ['search.*']
				},
				{
					id: 'features/debug',
					label: localize('debug', "Debug"),
					settings: ['debug.*', 'launch']
				},
				{
					id: 'features/testing',
					label: localize('testing', "Testing"),
					settings: ['testing.*']
				},
				{
					id: 'features/scm',
					label: localize('scm', "Source Control"),
					settings: ['scm.*']
				},
				{
					id: 'features/extensions',
					label: localize('extensions', "Extensions"),
					settings: ['extensions.*']
				},
				{
					id: 'features/terminal',
					label: localize('terminal', "Terminal"),
					settings: ['terminal.*']
				},
				{
					id: 'features/task',
					label: localize('task', "Task"),
					settings: ['task.*']
				},
				{
					id: 'features/problems',
					label: localize('problems', "Problems"),
					settings: ['problems.*']
				},
				{
					id: 'features/output',
					label: localize('output', "Output"),
					settings: ['output.*']
				},
				{
					id: 'features/comments',
					label: localize('comments', "Comments"),
					settings: ['comments.*']
				},
				{
					id: 'features/remote',
					label: localize('remote', "Remote"),
					settings: ['remote.*']
				},
				{
					id: 'features/timeline',
					label: localize('timeline', "Timeline"),
					settings: ['timeline.*']
				},
				{
					id: 'features/notebook',
					label: localize('notebook', 'Notebook'),
					settings: ['notebook.*', 'interactiveWindow.*']
				},
				{
					id: 'features/mergeEditor',
					label: localize('mergeEditor', 'Merge Editor'),
					settings: ['mergeEditor.*']
				},
				{
					id: 'features/issueReporter',
					label: localize('issueReporter', 'Issue Reporter'),
					settings: ['issueReporter.*'],
					hide: !isWeb
				}
			]
		},
		{
			id: 'application',
			label: localize('application', "Application"),
			children: [
				{
					id: 'application/http',
					label: localize('proxy', "Proxy"),
					settings: ['http.*']
				},
				{
					id: 'application/keyboard',
					label: localize('keyboard', "Keyboard"),
					settings: ['keyboard.*']
				},
				{
					id: 'application/update',
					label: localize('update', "Update"),
					settings: ['update.*']
				},
				{
					id: 'application/telemetry',
					label: localize('telemetry', "Telemetry"),
					settings: ['telemetry.*']
				},
				{
					id: 'application/settingsSync',
					label: localize('settingsSync', "Settings Sync"),
					settings: ['settingsSync.*']
				},
				{
					id: 'application/network',
					label: localize('network', "Network"),
					settings: ['network.*']
				},
				{
					id: 'application/experimental',
					label: localize('experimental', "Experimental"),
					settings: ['application.experimental.*']
				},
				{
					id: 'application/other',
					label: localize('other', "Other"),
					settings: ['application.*'],
					hide: isWindows
				}
			]
		},
		{
			id: 'security',
			label: localize('security', "Security"),
			settings: ['security.*'],
			children: [
				{
					id: 'security/workspace',
					label: localize('workspace', "Workspace"),
					settings: ['security.workspace.*']
				}
			]
		}
	]
};
