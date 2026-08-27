/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Rules.
 *
 *  A Rule is an .md on disk, not a config key: the page is 100% section. The scope comes from
 *  the header tabs (User/Workspace) and the search from the native search box, so there is no
 *  custom scopebar or search here — which is exactly what each webview kept reinventing.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IOpenideAgentRule, RuleScope } from './openideAgentRules.js';
import { t } from '../common/openideStrings.js';

/** kebab-case: mismo criterio que openideAgentRules. */
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;

export class OpenideRulesSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
	) { super(); }

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.context = context;
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	private get scope(): RuleScope { return this.context.scope === 'user' ? 'global' : 'project'; }
	private get rules() { return this.agentService.rulesManager(); }
	private hasProject(): boolean { return !!this.contextService.getWorkspace().folders[0]; }

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const body = this.ui.section(root, {
			title: t('openide.rules.title'),
			description: t('openide.rules.desc'),
			actions: [{ label: t('openide.rules.new'), icon: 'add', primary: true, run: () => void this.newRule() }],
		});

		if (this.scope === 'project' && !this.hasProject()) {
			this.ui.empty(body, {
				title: t('openide.rules.noProject'),
				description: t('openide.rules.noProjectDesc'),
			});
			return;
		}

		body.textContent = t('openide.rules.loading');
		void this.paintRules(body, token);
	}

	private async paintRules(body: HTMLElement, token: number): Promise<void> {
		const all = await this.rules.listAll().catch(() => [] as IOpenideAgentRule[]);
		if (token !== this.generation) { return; }
		clearNode(body);

		const scope = this.scope;
		const query = this.context.query.trim().toLowerCase();
		const rules = all.filter(rule => rule.scope === scope
			&& (!query || `${rule.name} ${rule.description}`.toLowerCase().includes(query)));

		if (!rules.length) {
			this.ui.empty(body, query
				? { title: t('openide.rules.noMatch'), description: t('openide.rules.tryOther') }
				: {
					title: t('openide.rules.emptyTitle'),
					description: t('openide.rules.emptyDesc'),
					actions: [{ label: t('openide.rules.new'), icon: 'add', primary: true, run: () => void this.newRule() }],
				});
			return;
		}

		for (const rule of rules) {
			this.ui.row(body, {
				name: `${rule.name}.md`,
				mono: true,
				description: rule.description || t('openide.rules.emptyRule'),
				badges: [rule.scope === 'global' ? t('openide.rules.global') : t('openide.rules.project')],
				iconActions: [
					{ label: t('openide.rules.open'), icon: 'go-to-file', run: () => void this.openRule(rule.scope, rule.name) },
					{ label: t('openide.rules.delete'), icon: 'trash', run: () => void this.deleteRule(rule.scope, rule.name) },
				],
			});
		}
	}

	private async openRule(scope: RuleScope, name: string): Promise<void> {
		const uri = this.rules.fileUri(scope, name);
		if (uri) { await this.editorService.openEditor({ resource: uri, options: { pinned: true } }); }
	}

	private async deleteRule(scope: RuleScope, name: string): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: t('openide.rules.deleteConfirm', name),
			detail: t('openide.rules.deleteDetail'),
			primaryButton: t('openide.rules.deleteButton'),
		});
		if (!confirmed.confirmed) { return; }
		await this.rules.delete(scope, name);
		this.paint();
	}

	private async newRule(): Promise<void> {
		const scope = this.scope;
		if (scope === 'project' && !this.hasProject()) {
			this.notificationService.notify({ severity: Severity.Error, message: t('openide.rules.noProjectToast') });
			return;
		}
		const existing = new Set((await this.rules.listAll().catch(() => [])).filter(rule => rule.scope === scope).map(rule => rule.name));
		const name = await this.quickInputService.input({
			prompt: t('openide.rules.newPrompt'),
			placeHolder: t('openide.rules.newPlaceholder'),
			ignoreFocusLost: true,
			validateInput: async value => {
				const candidate = value.trim();
				if (!NAME_RE.test(candidate)) { return t('openide.rules.nameInvalid'); }
				return existing.has(candidate) ? t('openide.rules.exists') : undefined;
			},
		});
		if (!name?.trim()) { return; }

		const result = await this.rules.save(scope, name.trim(), `# ${name.trim()}\n\nEscribí acá una instrucción obligatoria, concreta y verificable para el agente.`);
		if (result.startsWith('Error')) {
			this.notificationService.notify({ severity: Severity.Error, message: result });
			return;
		}
		await this.openRule(scope, name.trim());
		this.paint();
	}
}
