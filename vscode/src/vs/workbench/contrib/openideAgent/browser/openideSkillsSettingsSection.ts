/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Skills.
 *
 *  Unlike Subagents/Project Map there are NO native rows here: a skill is a directory with a
 *  SKILL.md, not a config key. The only thing that IS configuration is the exclusion list
 *  `openide.agent.disabledSkills`, which each row's toggle maintains through the agent service.
 *
 *  All the content is composed with OpenideSectionRenderer: the rows come out with the same
 *  anatomy as a native setting, so the page reads as part of Settings and not as a
 *  separate panel (which is exactly what happened with the webview).
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { ISkillInfo } from './openideAgentSkills.js';
import { OpenideSkillInstallerInput, OpenideSkillInstallScope } from './openideSkillInstallerInput.js';
import { t } from '../common/openideStrings.js';

/** kebab-case: a-z, 0-9 and single hyphens, with no hyphens at the edges. */
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;

const LOCATION_BADGE: Record<ISkillInfo['location'], string | undefined> = {
	builtin: undefined,
	openide: 'OpenIDE',
	agents: 'Skills CLI',
};

export class OpenideSkillsSettingsSection extends Disposable implements IOpenideSettingsSection {
	/** The exclusion list is managed with the toggles, not as a standalone row. */
	readonly ownedSettings = ['openide.agent.disabledSkills'];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly render_ = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
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

	private get skillScope(): OpenideSkillInstallScope {
		return this.context.scope === 'user' ? 'global' : 'project';
	}
	private projectRoot(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private notify(severity: Severity, message: string): void { this.notificationService.notify({ severity, message }); }

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const scope = this.skillScope;
		const actions = [
			...(scope === 'project' ? [
				{ label: t('openide.skills.import'), icon: 'folder-opened', run: () => void this.importSkill() },
				{ label: t('openide.skills.new'), icon: 'edit', run: () => void this.newSkill() },
			] : []),
			{ label: t('openide.skills.install'), icon: 'cloud-download', primary: true, run: () => void this.openInstaller() },
		];
		const body = this.render_.section(root, {
			title: t('openide.skills.title'),
			description: t('openide.skills.desc'),
			actions,
		});

		if (scope === 'project' && !this.projectRoot()) {
			this.render_.empty(body, {
				title: t('openide.skills.noProject'),
				description: t('openide.skills.noProjectDesc'),
			});
			return;
		}

		body.textContent = t('openide.skills.loading');
		void this.paintSkills(body, token);
	}

	private async paintSkills(body: HTMLElement, token: number): Promise<void> {
		const all = await this.agentService.listSkills(true).catch(() => [] as ISkillInfo[]);
		// It may have repainted (scope or search change) while we were reading the disk.
		if (token !== this.generation) { return; }
		clearNode(body);

		const scope = this.skillScope === 'global' ? 'global' : 'project';
		const query = this.context.query.trim().toLowerCase();
		const skills = all.filter(skill => skill.scope === scope
			&& (!query || `${skill.name} ${skill.description}`.toLowerCase().includes(query)));

		if (!skills.length) {
			if (query) {
				this.render_.empty(body, { title: t('openide.skills.noMatch') });
			} else {
				this.render_.empty(body, {
					title: t('openide.skills.emptyTitle'),
					description: t('openide.skills.emptyDesc'),
					actions: [{ label: t('openide.skills.install'), icon: 'cloud-download', primary: true, run: () => void this.openInstaller() }],
				});
			}
			return;
		}

		for (const skill of skills) {
			const badges: string[] = [];
			const locationBadge = LOCATION_BADGE[skill.location];
			if (locationBadge) { badges.push(locationBadge); }
			if (skill.disabled) { badges.push(t('openide.skills.disabled')); }

			this.render_.row(body, {
				name: skill.name,
				mono: true,
				description: skill.description || t('openide.skills.noDesc'),
				badges,
				// Built-ins live inside the product: they are neither opened nor deleted, only turned off.
				iconActions: skill.location === 'builtin' ? [] : [
					{ label: t('openide.skills.open'), icon: 'go-to-file', run: () => void this.openSkill(skill.name) },
					{ label: t('openide.skills.delete'), icon: 'trash', run: () => void this.deleteSkill(skill.name) },
				],
				toggle: {
					checked: !skill.disabled,
					title: skill.disabled
						? t('openide.skills.reenable')
						: t('openide.skills.disable'),
					change: on => void this.toggleSkill(skill.name, !on),
				},
			});
		}
	}

	private async toggleSkill(name: string, disabled: boolean): Promise<void> {
		await this.agentService.setSkillDisabled(name, disabled);
		this.notify(Severity.Info, t('openide.skills.toggled'));
		this.paint();
	}

	private async openSkill(name: string): Promise<void> {
		const uri = this.agentService.skillFileUri(name);
		if (uri) { await this.editorService.openEditor({ resource: uri, options: { pinned: true } }); }
	}

	private async deleteSkill(name: string): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: t('openide.skills.deleteConfirm', name),
			detail: t('openide.skills.deleteDetail'),
			primaryButton: t('openide.skills.deleteButton'),
		});
		if (!confirmed.confirmed) { return; }
		if (!await this.agentService.deleteSkill(name)) {
			this.notify(Severity.Error, t('openide.skills.deleteFailed', name));
			return;
		}
		this.paint();
	}

	private async openInstaller(): Promise<void> {
		await this.editorService.openEditor(new OpenideSkillInstallerInput(this.skillScope), {
			pinned: true,
			modal: { nested: true, size: { width: 920, height: 660 } },
		}, MODAL_GROUP);
	}

	private async newSkill(): Promise<void> {
		if (!this.projectRoot()) {
			this.notify(Severity.Error, t('openide.skills.noProjectToast'));
			return;
		}
		const existing = new Set((await this.agentService.listSkills(true).catch(() => [])).map(skill => skill.name));
		const name = await this.quickInputService.input({
			prompt: t('openide.skills.newPrompt'),
			placeHolder: t('openide.skills.newPlaceholder'),
			ignoreFocusLost: true,
			validateInput: async value => {
				const trimmed = value.trim();
				if (!NAME_RE.test(trimmed)) { return t('openide.skills.kebabInvalid'); }
				if (existing.has(trimmed)) { return t('openide.skills.exists'); }
				return undefined;
			},
		});
		if (!name?.trim()) { return; }

		const result = await this.agentService.saveSkill(
			name.trim(),
			t('openide.skills.templateDesc'),
			t('openide.skills.templateBody'),
		);
		if (result.startsWith('Error')) { this.notify(Severity.Error, result); return; }
		await this.openSkill(name.trim());
		this.paint();
	}

	private async importSkill(): Promise<void> {
		const root = this.projectRoot();
		if (!root) {
			this.notify(Severity.Error, t('openide.skills.noProjectToast'));
			return;
		}
		const picked = await this.fileDialogService.showOpenDialog({
			title: t('openide.skills.importTitle'),
			canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
			openLabel: t('openide.skills.importLabel'),
		});
		const source = picked?.[0];
		if (!source) { return; }
		if (!(await this.fileService.exists(joinPath(source, 'SKILL.md')))) {
			this.notify(Severity.Error, t('openide.skills.importNoMd'));
			return;
		}

		let name = basename(source).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
		if (!NAME_RE.test(name)) {
			const asked = await this.quickInputService.input({
				prompt: t('openide.skills.importName'),
				value: name,
				ignoreFocusLost: true,
				validateInput: async value => NAME_RE.test(value.trim()) ? undefined : t('openide.skills.kebabInvalid'),
			});
			if (!asked?.trim()) { return; }
			name = asked.trim();
		}

		const destination = joinPath(root, '.openide', 'skills', name);
		if (await this.fileService.exists(destination)) {
			const overwrite = await this.dialogService.confirm({
				message: t('openide.skills.importExists', name),
				primaryButton: t('openide.skills.replace'),
			});
			if (!overwrite.confirmed) { return; }
			await this.fileService.del(destination, { recursive: true });
		}
		await this.fileService.copy(source, destination);
		this.notify(Severity.Info, t('openide.skills.importOk', name));
		this.paint();
	}
}
