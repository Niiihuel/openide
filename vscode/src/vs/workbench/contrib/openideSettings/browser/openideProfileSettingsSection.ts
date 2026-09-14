/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { IUserDataProfileManagementService, IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { getOpenideLanguage, t } from '../../openideAgent/common/openideStrings.js';
import { OpenideActivityCalendar } from '../../../browser/openideActivityCalendar.js';
import { OpenideGitHubActivity, OpenideGitHubActivityError } from './openideGitHubActivity.js';
import { OpenideAccountProfile } from './openideAccountProfile.js';
import { IOpenideSettingsSection, IOpenideSettingsSectionContext } from './openideSettingsSection.js';
import { OpenideSectionRenderer } from './openideSettingsSectionBuilder.js';

/** Settings identity page shares account loading, avatar and sign-in with both sidebars. */
export class OpenideProfileSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings = [];
	private readonly nameDrafts = new Map<string, string>();
	private newProfileName = '';
	private managing = false;
	private readonly activity: OpenideGitHubActivity;
	private readonly didManage = this._register(new Emitter<void>());
	get navigationChildren() { return [{ id: 'workbench/profile/local', label: t('accounts.manageProfile'), hidden: true }]; }
	constructor(
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IContextViewService private readonly contextView: IContextViewService,
		@ICommandService private readonly commands: ICommandService,
		@IOpenerService private readonly opener: IOpenerService,
		@IUserDataProfileService private readonly profiles: IUserDataProfileService,
		@IUserDataProfilesService private readonly profileList: IUserDataProfilesService,
		@IUserDataProfileManagementService private readonly management: IUserDataProfileManagementService,
	) { super(); this.activity = this._register(instantiation.createInstance(OpenideGitHubActivity)); }

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): DisposableStore {
		if (context.category === 'workbench/profile/local') { return this.renderLocalProfiles(container); }
		const store = new DisposableStore();
		const root = append(container, $('.openide-profile-page'));
		const identity = store.add(this.instantiation.createInstance(OpenideAccountProfile, root));
		identity.showAsPage();
		const details = append(root, $('.openide-profile-details'));
		const rows = store.add(new DisposableStore());
		const command = (id: string, ...args: unknown[]) => { void this.commands.executeCommand(id, ...args).catch(onUnexpectedError); };
		const paint = () => {
			rows.clear(); clearNode(details);
			const ui = new OpenideSectionRenderer(rows, this.contextView);
			const account = identity.account;
			if (account?.providerId === 'github') { this.renderActivity(details, rows.add(new DisposableStore()), account.label); }
			if (account) {
				const card = ui.card(details, { caption: t('accounts.connectedAccount'), keywords: ['GitHub', 'account', 'cuenta'] });
				const actions = ui.cardRow(card, { label: account.providerLabel, description: account.label });
				if (account.providerId === 'github') {
					ui.button(actions, { label: t('accounts.viewOnGitHub'), icon: 'link-external', run: () => { void this.opener.open(URI.parse(`https://github.com/${encodeURIComponent(account.label)}`)).catch(onUnexpectedError); } });
				}
				ui.cardRow(card, { label: t('accounts.permissions'), description: t('accounts.permissionsDescription'), icon: 'chevron-right', run: () => command('_manageTrustedExtensionsForAccount', { providerId: account.providerId, accountLabel: account.label }) });
			}
			const profile = ui.card(details, { caption: t('accounts.localProfile') });
			const actions = ui.cardRow(profile, { label: this.profiles.currentProfile.name, description: t('accounts.localProfileDescription') });
			ui.button(actions, { label: t('accounts.manageProfile'), run: () => context.navigate?.('workbench/profile/local') });
		};
		store.add(identity.onDidChange(paint));
		paint();
		return store;
	}

	private renderActivity(parent: HTMLElement, store: DisposableStore, login: string): void {
		const ui = new OpenideSectionRenderer(store, this.contextView);
		const section = ui.block(parent, ['GitHub', t('accounts.activity.title'), t('accounts.activity.description')]);
		section.classList.add('openide-profile-activity');
		const header = append(section, $('.openide-profile-activity-header'));
		const heading = append(header, $('div'));
		append(heading, $('h3', undefined, t('accounts.activity.title')));
		const summary = append(heading, $('p', undefined, t('accounts.activity.description')));
		const actions = append(header, $('div'));
		const content = append(section, $('div.openide-profile-activity-content'));
		const status = append(section, $('p.openide-profile-activity-status', { role: 'status' }));
		const charts = store.add(new DisposableStore());
		const cancellation = new CancellationTokenSource();
		store.add(toDisposable(() => cancellation.dispose(true)));
		let busy = false;
		const load = async (refresh = false) => {
			if (busy || store.isDisposed) { return; }
			busy = true; refreshButton.enabled = false;
			section.setAttribute('aria-busy', 'true');
			status.textContent = t('accounts.activity.loading');
			try {
				const value = await this.activity.load(login, cancellation.token, refresh);
				if (store.isDisposed) { return; }
				charts.clear(); clearNode(content);
				const locale = getOpenideLanguage();
				summary.textContent = t('accounts.activity.total', value.total.toLocaleString(locale));
				charts.add(this.instantiation.createInstance(OpenideActivityCalendar, content, value.days, {
					label: t('accounts.activity.title'), locale, less: t('accounts.activity.less'), more: t('accounts.activity.more'),
					describe: (day, date) => t(day.count === 1 ? 'accounts.activity.dayOne' : 'accounts.activity.day', day.count.toLocaleString(locale), date),
				}));
				status.textContent = t('accounts.activity.visibility');
			} catch (error) {
				if (store.isDisposed || cancellation.token.isCancellationRequested) { return; }
				status.textContent = t(error instanceof OpenideGitHubActivityError && error.reason === 'session' ? 'accounts.activity.session' : error instanceof OpenideGitHubActivityError && error.reason === 'limited' ? 'accounts.activity.limited' : 'accounts.activity.error');
			} finally {
				if (!store.isDisposed) { busy = false; refreshButton.enabled = true; section.removeAttribute('aria-busy'); }
			}
		};
		const refreshButton = ui.button(actions, { label: t('accounts.activity.refresh'), icon: 'refresh', run: () => { void load(true); } });
		void load();
	}

	private renderLocalProfiles(container: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		const root = append(container, $('.openide-local-profiles'));
		const rows = store.add(new DisposableStore());

		const run = async (action: () => Promise<unknown>) => {
			if (this.managing) { return; }
			this.managing = true;
			root.setAttribute('aria-busy', 'true');
			try { await action(); } catch (error) { onUnexpectedError(error); }
			finally { this.managing = false; this.didManage.fire(); }
		};
		const paint = () => {
			if (store.isDisposed || this.managing) { return; }
			rows.clear(); clearNode(root);
			root.removeAttribute('aria-busy');
			const ui = new OpenideSectionRenderer(rows, this.contextView);
			const profiles = this.profileList.profiles.filter(profile => !profile.isInternal);
			const validName = (name: string, id?: string) => !!name.trim() && !profiles.some(profile => profile.id !== id && profile.name.toLowerCase() === name.trim().toLowerCase());
			for (const profile of profiles) {
				const card = ui.card(root, { caption: profile.name });
				card.dataset.profileId = profile.id;
				const current = profile.id === this.profiles.currentProfile.id;
				const actions = ui.cardRow(card, { label: profile.name, description: current ? t('accounts.currentProfile') : t('accounts.localProfileDescription') });
				if (!current) { ui.button(actions, { label: t('accounts.switchProfile'), run: () => { void run(() => this.management.switchProfile(profile)); } }); }
				if (!profile.isDefault) {
					let name = this.nameDrafts.get(profile.id) ?? profile.name;
					const input = ui.input(card, { label: t('accounts.profileName'), value: name, change: value => { name = value; this.nameDrafts.set(profile.id, value); save.enabled = validName(name, profile.id) && name.trim() !== profile.name; } });
					const editActions = ui.cardRow(card, { label: t('accounts.profileActions') });
					const save = ui.button(editActions, { label: t('accounts.renameProfile'), enabled: validName(name, profile.id) && name.trim() !== profile.name, run: () => { if (validName(name, profile.id)) { void run(async () => { await this.management.updateProfile(profile, { name: input.value.trim() }); this.nameDrafts.delete(profile.id); }); } } });
					ui.button(editActions, { label: t('accounts.removeProfile'), danger: true, confirm: t('accounts.confirmRemoveProfile'), run: () => { void run(async () => { await this.management.removeProfile(profile); this.nameDrafts.delete(profile.id); }); } });
				}
			}
			const create = ui.card(root, { caption: t('accounts.createProfile') });
			let name = this.newProfileName;
			ui.input(create, { label: t('accounts.profileName'), value: name, change: value => { name = value; this.newProfileName = value; add.enabled = validName(name); } });
			const actions = ui.cardRow(create, { label: t('accounts.newProfileDescription') });
			const add = ui.button(actions, { label: t('accounts.createProfile'), enabled: validName(name), run: () => { if (validName(name)) { void run(async () => { await this.management.createProfile(name.trim()); this.newProfileName = ''; }); } } });
		};
		store.add(this.didManage.event(() => paint()));
		store.add(this.profileList.onDidChangeProfiles(() => paint()));
		store.add(this.profiles.onDidChangeCurrentProfile(() => paint()));
		paint();
		return store;
	}
}
