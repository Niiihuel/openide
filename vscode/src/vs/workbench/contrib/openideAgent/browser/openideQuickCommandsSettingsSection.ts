/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Terminal quick commands.
 *
 *  Atajos label→comando guardados en `quick-commands.json` (proyecto o global). No son config
 *  keys: the page is 100% section. The scope comes from the header tabs.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from './openideControlStyles.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { IQuickCommand, QuickCommandScope } from '../common/openideQuickCommands.js';
import { OpenideQuickCommandsService } from './openideQuickCommandsService.js';
import { t } from '../common/openideStrings.js';

export class OpenideQuickCommandsSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private readonly service: OpenideQuickCommandsService;
	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;
	/** Add in progress: an empty edit row is appended at the end of the list. */
	private adding = false;

	constructor(
		@IFileService fileService: IFileService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.service = new OpenideQuickCommandsService(fileService, contextService, environmentService);
	}

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.context = context;
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	private get scope(): QuickCommandScope { return this.context.scope === 'user' ? 'global' : 'project'; }

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const body = this.ui.section(root, {
			title: t('openide.quickCommands.title'),
			description: t('openide.quickCommands.desc'),
			actions: [{
				label: t('openide.quickCommands.new'), icon: 'add', primary: true,
				run: () => { this.adding = true; this.paint(); },
			}],
		});

		if (this.scope === 'project' && !this.service.fileUri('project')) {
			this.ui.empty(body, {
				title: t('openide.quickCommands.noProject'),
				description: t('openide.quickCommands.noProjectDesc'),
			});
			return;
		}

		body.textContent = t('openide.quickCommands.loading');
		void this.paintCommands(body, token);
	}

	private async paintCommands(body: HTMLElement, token: number): Promise<void> {
		const all = await this.service.listAll().catch(() => [] as IQuickCommand[]);
		if (token !== this.generation) { return; }
		clearNode(body);

		const query = this.context.query.trim().toLowerCase();
		const commands = all.filter(command => command.scope === this.scope
			&& (!query || `${command.label} ${command.command}`.toLowerCase().includes(query)));

		if (!commands.length && !this.adding) {
			this.ui.empty(body, query
				? { title: t('openide.quickCommands.noMatch') }
				: {
					title: t('openide.quickCommands.emptyTitle'),
					description: t('openide.quickCommands.emptyDesc'),
					actions: [{
						label: t('openide.quickCommands.new'), icon: 'add', primary: true,
						run: () => { this.adding = true; this.paint(); },
					}],
				});
			return;
		}

		for (const command of commands) {
			this.ui.row(body, {
				name: command.label,
				description: command.command,
				iconActions: [
					{ label: t('openide.quickCommands.edit'), icon: 'edit', run: () => this.editRow(body, command) },
					{ label: t('openide.quickCommands.delete'), icon: 'trash', run: () => void this.remove(command) },
				],
			});
		}

		if (this.adding) { this.editor(body, undefined); }
	}

	/** Replaces the row with its inline editor (same place, no modal). */
	private editRow(body: HTMLElement, command: IQuickCommand): void {
		this.adding = false;
		clearNode(body);
		this.editor(body, command);
	}

	private editor(parent: HTMLElement, command: IQuickCommand | undefined): void {
		const box = append(parent, $('.openide-settings-section-body'));
		const labelHost = append(this.ui.field(box, t('openide.quickCommands.label')), $('.openide-settings-fieldhost'));
		const label = this.renderStore.add(new InputBox(labelHost, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			placeholder: t('openide.quickCommands.labelPlaceholder'),
			ariaLabel: t('openide.quickCommands.label'),
		}));
		label.value = command?.label ?? '';

		const field = this.ui.field(box, t('openide.quickCommands.command'));
		const inputHost = append(field, $('.openide-settings-fieldhost'));
		const input = this.renderStore.add(new InputBox(inputHost, undefined, {
			inputBoxStyles: openideInputBoxStyles,
			placeholder: 'pnpm dev',
			ariaLabel: t('openide.quickCommands.command'),
		}));
		input.element.classList.add('openide-settings-mono');
		input.value = command?.command ?? '';

		const actions = append(box, $('.openide-settings-section-actions'));
		this.ui.button(actions, {
			label: t('openide.quickCommands.save'), primary: true,
			run: () => void this.save(command?.id, label.value, input.value),
		});
		this.ui.button(actions, {
			label: t('openide.quickCommands.cancel'),
			run: () => { this.adding = false; this.paint(); },
		});
		// Enter saves from either field: it is a two-line form.
		for (const control of [label, input]) {
			this.renderStore.add(addDisposableListener(control.inputElement, 'keydown', event => {
				if ((event as KeyboardEvent).key === 'Enter') { void this.save(command?.id, label.value, input.value); }
			}));
		}
		label.focus();
	}

	private async save(id: string | undefined, label: string, command: string): Promise<void> {
		if (!label.trim() || !command.trim()) {
			this.notificationService.notify({ severity: Severity.Error, message: t('openide.quickCommands.incomplete') });
			return;
		}
		try {
			await this.service.upsert(this.scope, { id, label: label.trim(), command: command.trim() });
		} catch (error) {
			this.notificationService.notify({ severity: Severity.Error, message: error instanceof Error ? error.message : String(error) });
			return;
		}
		this.adding = false;
		this.paint();
	}

	private async remove(command: IQuickCommand): Promise<void> {
		const confirmed = await this.dialogService.confirm({
			message: t('openide.quickCommands.deleteConfirm', command.label),
			primaryButton: t('openide.quickCommands.deleteButton'),
		});
		if (!confirmed.confirmed) { return; }
		await this.service.remove(command.scope, command.id);
		this.paint();
	}
}
