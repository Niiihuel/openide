/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Commands.
 *
 *  A command is an .md on disk (the project's `.openide/commands` or the profile-global one), not
 *  a config key: the page is 100% section. The scope comes from the header tabs, so creating a
 *  command NO LONGER asks where to store it — the header is the answer.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ISlashCommand, OpenideAgentCommands } from './openideAgentCommands.js';
import { t } from '../common/openideStrings.js';

const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;

export class OpenideCommandsSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private readonly commands: OpenideAgentCommands;
	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		// Commands are pure filesystem: our own instance for scan/expand is enough (the
		// agent uses its own to resolve /slug in the composer).
		this.commands = this._register(new OpenideAgentCommands(fileService, contextService, environmentService));
	}

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.context = context;
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	private get scope(): 'project' | 'global' { return this.context.scope === 'user' ? 'global' : 'project'; }
	private projectRoot(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private commandsDir(): URI | undefined {
		const root = this.projectRoot();
		return this.scope === 'project'
			? (root ? joinPath(root, '.openide', 'commands') : undefined)
			: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'commands');
	}

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const body = this.ui.section(root, {
			title: t('openide.commands.title'),
			description: t('openide.commands.desc'),
			actions: [{ label: t('openide.commands.new'), icon: 'add', primary: true, run: () => void this.newCommand() }],
		});

		if (this.scope === 'project' && !this.projectRoot()) {
			this.ui.empty(body, {
				title: t('openide.commands.noProject'),
				description: t('openide.commands.noProjectDesc'),
			});
			return;
		}

		body.textContent = t('openide.commands.loading');
		void this.paintCommands(body, token);
	}

	private async paintCommands(body: HTMLElement, token: number): Promise<void> {
		const all = await this.commands.scan().catch(() => [] as ISlashCommand[]);
		if (token !== this.generation) { return; }
		clearNode(body);

		const scope = this.scope;
		const query = this.context.query.trim().toLowerCase();
		const commands = all.filter(command => command.scope === scope
			&& (!query || `${command.slug} ${command.description}`.toLowerCase().includes(query)));

		if (!commands.length) {
			this.ui.empty(body, query
				? { title: t('openide.commands.noMatch'), description: t('openide.commands.tryOther') }
				: {
					title: t('openide.commands.emptyTitle'),
					description: t('openide.commands.emptyDesc'),
					actions: [{ label: t('openide.commands.new'), icon: 'add', primary: true, run: () => void this.newCommand() }],
				});
			return;
		}

		for (const command of commands) {
			const badges = [command.scope === 'global' ? t('openide.commands.global') : t('openide.commands.project')];
			if (command.argumentHint) { badges.push(command.argumentHint); }
			this.ui.row(body, {
				name: `/${command.slug}`,
				mono: true,
				description: command.description || t('openide.commands.noDesc'),
				badges,
				iconActions: [
					{ label: t('openide.commands.open'), icon: 'go-to-file', run: () => void this.editorService.openEditor({ resource: command.filePath, options: { pinned: true } }) },
					{ label: t('openide.commands.delete'), icon: 'trash', run: () => void this.deleteCommand(command.slug) },
				],
				expand: preview => void this.paintPreview(preview, command.slug),
			});
		}
	}

	private async paintPreview(preview: HTMLElement, slug: string): Promise<void> {
		preview.textContent = t('openide.commands.loadingPreview');
		const [body, example] = await Promise.all([
			this.commands.expand(slug, '').catch(() => undefined),
			this.commands.expand(slug, 'ejemplo "dos palabras"').catch(() => undefined),
		]);
		// The row may have closed (or repainted) while we were resolving the markdown.
		if (!preview.isConnected) { return; }
		clearNode(preview);
		const empty = t('openide.commands.emptyBody');
		this.ui.pre(preview, t('openide.commands.previewBody'), (body?.modelText ?? '').slice(0, 4000) || empty);
		this.ui.pre(preview, t('openide.commands.previewExample', slug), (example?.modelText ?? '').slice(0, 4000) || empty);
	}

	private async deleteCommand(slug: string): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: t('openide.commands.deleteConfirm', slug),
			primaryButton: t('openide.commands.deleteButton'),
		});
		if (!confirmed.confirmed) { return; }
		await this.commands.delete(slug);
		this.paint();
	}

	private async newCommand(): Promise<void> {
		const dir = this.commandsDir();
		if (!dir) {
			this.notificationService.notify({ severity: Severity.Error, message: t('openide.commands.noProjectToast') });
			return;
		}
		const existing = new Set((await this.commands.scan().catch(() => [])).filter(command => command.scope === this.scope).map(command => command.slug));
		const slug = await this.quickInputService.input({
			prompt: t('openide.commands.newPrompt'),
			placeHolder: t('openide.commands.newPlaceholder'),
			ignoreFocusLost: true,
			validateInput: async value => {
				const candidate = value.trim();
				if (!NAME_RE.test(candidate)) { return t('openide.commands.nameInvalid'); }
				return existing.has(candidate) ? t('openide.commands.exists', candidate) : undefined;
			},
		});
		if (!slug?.trim()) { return; }

		const uri = joinPath(dir, `${slug.trim()}.md`);
		if (!(await this.fileService.exists(uri))) {
			const template = `---\ndescription: Qué hace este comando (aparece en el menú del /)\nargument-hint: [args]\n---\n\nInstrucciones para el agente. $ARGUMENTS interpola todo lo tipeado tras /${slug.trim()}; $1..$9 los argumentos sueltos (comillas respetadas).\n`;
			await this.fileService.writeFile(uri, VSBuffer.fromString(template));
		}
		await this.editorService.openEditor({ resource: uri, options: { pinned: true } });
		this.paint();
	}
}
