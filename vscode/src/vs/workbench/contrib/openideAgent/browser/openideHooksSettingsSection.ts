/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Hooks.
 *
 *  Hooks live in `.openide/hooks.json` (project) or the profile-global one, grouped by
 *  lifecycle event. The only real setting is the `openide.agent.hooks.enabled` kill-switch,
 *  which comes out as a native row; here go the list, the consent and the tester.
 *
 *  Consent: a hook runs with the user's full credentials, so each one requires explicit
 *  approval and is asked about again if the script changes (the 'drifted' state).
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
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { HookEvent, IHookEntry } from './openideAgentHooks.js';
import { t } from '../common/openideStrings.js';

/** Order and explanation of each lifecycle event (it also defines the group order). */
const EVENTS: readonly { id: HookEvent; description: string }[] = [
	{ id: 'preToolUse', description: t('openide.hooks.preToolUse') },
	{ id: 'postToolUse', description: t('openide.hooks.postToolUse') },
	{ id: 'userPromptSubmit', description: t('openide.hooks.userPromptSubmit') },
	{ id: 'sessionStart', description: t('openide.hooks.sessionStart') },
	{ id: 'stop', description: t('openide.hooks.stop') },
	{ id: 'subagentStop', description: t('openide.hooks.subagentStop') },
];

interface IHookRow extends IHookEntry {
	readonly approval: 'approved' | 'pending' | 'drifted';
}

export class OpenideHooksSettingsSection extends Disposable implements IOpenideSettingsSection {
	/** The kill-switch is rendered as a native row from the schema. */
	readonly ownedSettings: readonly string[] = [];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
	) { super(); }

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.context = context;
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	private get hooks() { return this.agentService.hooksManager(); }
	private get scope(): 'project' | 'global' { return this.context.scope === 'user' ? 'global' : 'project'; }
	private projectRoot(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private hooksJsonUri(): URI | undefined {
		const root = this.projectRoot();
		return this.scope === 'project'
			? (root ? joinPath(root, '.openide', 'hooks.json') : undefined)
			: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'hooks.json');
	}

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const body = this.ui.section(root, {
			title: t('openide.hooks.title'),
			description: t('openide.hooks.desc'),
			actions: [
				{ label: t('openide.hooks.editJson'), icon: 'go-to-file', run: () => void this.openHooksJson() },
				{ label: t('openide.hooks.new'), icon: 'add', primary: true, run: () => void this.newHook() },
			],
		});

		body.textContent = t('openide.hooks.loading');
		void this.paintHooks(body, token);
	}

	private async paintHooks(body: HTMLElement, token: number): Promise<void> {
		const entries = await this.hooks.scan().catch(() => [] as IHookEntry[]);
		const rows: IHookRow[] = await Promise.all(entries.map(async entry => ({
			...entry,
			approval: await this.hooks.approvalState(entry.event, entry.command).catch(() => 'pending' as const),
		})));
		if (token !== this.generation) { return; }
		clearNode(body);

		const query = this.context.query.trim().toLowerCase();
		const matches = (row: IHookRow) => !query || `${row.command} ${row.matcher ?? ''} ${row.event}`.toLowerCase().includes(query);

		if (!entries.length) {
			this.ui.empty(body, {
				title: t('openide.hooks.emptyTitle'),
				description: t('openide.hooks.emptyDesc'),
				actions: [{ label: t('openide.hooks.new'), icon: 'add', primary: true, run: () => void this.newHook() }],
			});
		} else {
			let shown = 0;
			for (const event of EVENTS) {
				const group = rows.filter(row => row.event === event.id && matches(row));
				if (!group.length) { continue; }
				shown += group.length;
				append(body, $('.openide-settings-group-label', undefined, event.id));
				append(body, $('.openide-settings-group-desc', undefined, event.description));
				for (const row of group) { this.hookRow(body, row); }
			}
			if (!shown) {
				this.ui.empty(body, { title: t('openide.hooks.noMatch') });
			}
		}

		// Approvals that no longer correspond to any hook in the file: they are offered for revoking
		// because if the command reappears, it would run without asking again.
		const orphans = this.hooks.listApprovals().filter(approval => !entries.some(entry => entry.event === approval.event && entry.command === approval.command));
		if (orphans.length) {
			append(body, $('.openide-settings-group-label', undefined, t('openide.hooks.orphans')));
			append(body, $('.openide-settings-group-desc', undefined, t('openide.hooks.orphansDesc')));
			for (const orphan of orphans) {
				this.ui.row(body, {
					name: orphan.command,
					mono: true,
					badges: [orphan.event],
					iconActions: [{
						label: t('openide.hooks.revoke'), icon: 'circle-slash',
						run: () => { this.hooks.revokeApproval(orphan.event, orphan.command); this.paint(); },
					}],
				});
			}
		}
	}

	private hookRow(body: HTMLElement, row: IHookRow): void {
		const badges: string[] = [];
		if (row.matcher) { badges.push(row.matcher); }
		badges.push(row.scope === 'global' ? t('openide.hooks.global') : t('openide.hooks.project'));
		badges.push(row.approval === 'approved'
			? t('openide.hooks.approved')
			: row.approval === 'drifted'
				? t('openide.hooks.drifted')
				: t('openide.hooks.pending'));

		const actions: { label: string; icon: string; run(): void }[] = [];
		if (row.approval !== 'approved') {
			actions.push({
				label: row.approval === 'drifted' ? t('openide.hooks.reapprove') : t('openide.hooks.approve'),
				icon: 'check',
				run: () => void this.approve(row),
			});
		}
		if (row.approval !== 'pending') {
			actions.push({
				label: t('openide.hooks.revoke'), icon: 'circle-slash',
				run: () => { this.hooks.revokeApproval(row.event, row.command); this.paint(); },
			});
		}

		this.ui.row(body, {
			name: row.command,
			mono: true,
			description: t('openide.hooks.timeout', row.timeoutSeconds),
			badges,
			iconActions: actions,
			expand: panel => this.testPanel(panel, row),
		});
	}

	/** Expanding runs NOTHING: a hook runs a shell with your credentials, so testing is always an
	 *  explicit act. The button stays fixed and the result is painted below. */
	private testPanel(panel: HTMLElement, row: IHookRow): void {
		const actions = append(panel, $('.openide-settings-section-actions'));
		const output = append(panel, $('.openide-settings-test-output'));
		this.ui.button(actions, {
			label: t('openide.hooks.test'),
			icon: 'beaker',
			run: () => void this.runTest(output, row),
		});
	}

	private async runTest(panel: HTMLElement, row: IHookRow): Promise<void> {
		panel.textContent = t('openide.hooks.running', row.event);
		let result;
		try {
			result = await this.hooks.testHook(row.event, { command: row.command, timeout: row.timeoutSeconds });
		} catch (error) {
			if (!panel.isConnected) { return; }
			clearNode(panel);
			this.ui.pre(panel, t('openide.hooks.testFailed'), error instanceof Error ? error.message : String(error));
			return;
		}
		if (!panel.isConnected) { return; }
		clearNode(panel);

		const parts = [t('openide.hooks.exit', result.exitCode === null ? 'null' : String(result.exitCode))];
		if (result.timedOut) { parts.push('TIMEOUT'); }
		if (result.blockMessage) { parts.push(t('openide.hooks.block', result.blockMessage)); }
		if (result.context) { parts.push(t('openide.hooks.context', result.context.length)); }

		const output = [
			result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}` : t('openide.hooks.noStdout'),
			result.stderr ? `stderr:\n${result.stderr.slice(0, 4000)}` : '',
		].filter(Boolean).join('\n');
		this.ui.pre(panel, parts.join(' · '), output);
	}

	private async approve(row: IHookRow): Promise<void> {
		await this.hooks.approveAlways(row.event, row.command);
		this.paint();
	}

	private async openHooksJson(): Promise<void> {
		const uri = this.hooksJsonUri();
		if (!uri) {
			this.notificationService.notify({ severity: Severity.Error, message: t('openide.hooks.noProject') });
			return;
		}
		if (!(await this.fileService.exists(uri))) {
			await this.fileService.writeFile(uri, VSBuffer.fromString('{\n\t"hooks": {\n\t\t"preToolUse": []\n\t}\n}\n'));
		}
		await this.editorService.openEditor({ resource: uri, options: { pinned: true } });
	}

	private async newHook(): Promise<void> {
		const uri = this.hooksJsonUri();
		if (!uri) {
			this.notificationService.notify({ severity: Severity.Error, message: t('openide.hooks.noProject') });
			return;
		}
		type EventItem = IQuickPickItem & { id: HookEvent };
		const items: EventItem[] = EVENTS.map(event => ({ id: event.id, label: event.id, description: event.description }));
		const event = await this.quickInputService.pick(items, {
			placeHolder: t('openide.hooks.pickEvent'),
			matchOnDescription: true,
		});
		if (!event) { return; }

		const command = await this.quickInputService.input({
			prompt: t('openide.hooks.promptCommand'),
			placeHolder: '~/.openide-hooks/mi-hook.sh   ·   node scripts/check.js',
			ignoreFocusLost: true,
			validateInput: async value => value.trim() ? undefined : t('openide.hooks.commandRequired'),
		});
		if (!command?.trim()) { return; }

		let matcher = '';
		if (event.id === 'preToolUse' || event.id === 'postToolUse') {
			const asked = await this.quickInputService.input({
				prompt: t('openide.hooks.promptMatcher'),
				placeHolder: 'run_command|write_file',
				ignoreFocusLost: true,
			});
			if (asked === undefined) { return; }
			matcher = asked.trim();
		}

		// Upsert over a fresh read of the file: it is never rewritten from an in-memory state.
		let json: any = {};
		try { json = JSON.parse((await this.fileService.readFile(uri)).value.toString()); } catch { /* sin archivo o roto: arranca de cero */ }
		if (!json || typeof json !== 'object' || Array.isArray(json)) { json = {}; }
		if (!json.hooks || typeof json.hooks !== 'object' || Array.isArray(json.hooks)) { json.hooks = {}; }
		if (!Array.isArray(json.hooks[event.id])) { json.hooks[event.id] = []; }
		json.hooks[event.id].push({ ...(matcher ? { matcher } : {}), command: command.trim() });
		await this.fileService.writeFile(uri, VSBuffer.fromString(`${JSON.stringify(json, null, '\t')}\n`));

		const consent = await this.dialogService.confirm({
			message: t('openide.hooks.approveNow', command.trim()),
			detail: t('openide.hooks.approveDetail'),
			primaryButton: t('openide.hooks.approve'),
			cancelButton: t('openide.hooks.later'),
		});
		if (consent.confirmed) { await this.hooks.approveAlways(event.id, command.trim()); }
		this.paint();
	}
}
