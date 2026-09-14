/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { setupChatTooltip } from '../../openideAgent/browser/chat/openideChatHover.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { onDidChangeOpenideLanguage, t } from '../../openideAgent/common/openideStrings.js';
import './media/openideAccountProfile.css';

/** The IDE identity footer, shared by Settings and the companion agent window. */
export class OpenideAccountProfile extends Disposable {
	readonly domNode: HTMLElement;
	private readonly avatar: HTMLElement;
	private readonly profile: HTMLElement;
	private page = false;
	private openProfile: () => void = () => { void this.commandService.executeCommand('openide.agent.openSettings', 'profile').catch(onUnexpectedError); };
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	account: { providerId: string; providerLabel: string; label: string } | undefined;
	private readonly name: HTMLElement;
	private readonly detail: HTMLElement;
	private readonly signIn: HTMLButtonElement;
	private readonly signInLabel: HTMLElement;
	private generation = 0;
	private signingIn = false;

	constructor(
		parent: HTMLElement,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this.domNode = append(parent, $('.openide-settings-profile-block'));
		const profile = this.profile = append(this.domNode, $('.openide-settings-profile', { role: 'button', tabindex: '0' }));
		this._register(setupChatTooltip(hoverService, profile, () => this.page ? '' : t('accounts.openProfile'), { aria: false }));
		const open = () => { if (!this.page) { this.openProfile(); } };
		this._register(addDisposableListener(profile, 'click', open));
		this._register(addDisposableListener(profile, 'keydown', event => {
			if (!this.page && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); open(); }
		}));
		this.avatar = append(profile, $('span.openide-settings-profile-avatar', { 'aria-hidden': 'true' }));
		const copy = append(profile, $('.openide-settings-profile-copy'));
		this.name = append(copy, $('.openide-settings-profile-name'));
		this.detail = append(copy, $('.openide-settings-profile-detail'));
		this.signIn = append(this.domNode, $<HTMLButtonElement>('button.oi-btn.openide-settings-profile-signin.hidden', { type: 'button' }));
		append(this.signIn, $('span.codicon.codicon-github', { 'aria-hidden': 'true' }));
		this.signInLabel = append(this.signIn, $('span', undefined, t('accounts.signInWithGitHub')));
		this._register(addDisposableListener(this.signIn, 'click', () => { void this.signInWithGitHub().catch(onUnexpectedError); }));
		this._register(userDataProfileService.onDidChangeCurrentProfile(() => { void this.refresh(); }));
		this._register(authenticationService.onDidChangeSessions(() => { void this.refresh(); }));
		this._register(authenticationService.onDidRegisterAuthenticationProvider(() => { void this.refresh(); }));
		this._register(authenticationService.onDidUnregisterAuthenticationProvider(() => { void this.refresh(); }));
		this._register(onDidChangeOpenideLanguage(() => { this.signInLabel.textContent = t(this.signingIn ? 'accounts.signingIn' : 'accounts.signInWithGitHub'); void this.refresh(); }));
		this.paintSignedOut(false);
		void this.refresh();
	}

	setOpenProfile(action: () => void): void { this.openProfile = action; }

	/** The same account renderer becomes the identity header of Settings. */
	showAsPage(): void {
		this.page = true;
		this.domNode.classList.add('openide-profile-hero');
		this.profile.removeAttribute('role');
		this.profile.removeAttribute('tabindex');
	}

	/** Query account metadata only. Credentials and authentication sessions never enter this UI. */
	async refresh(): Promise<void> {
		const generation = ++this.generation;
		try {
			await this.extensionService.activateByEvent('onAuthenticationRequest:github');
		} catch {
			// Other already registered account providers still work if GitHub cannot activate.
		}
		if (this._store.isDisposed || generation !== this.generation) { return; }
		const github = this.authenticationService.declaredProviders.find(provider => provider.id === 'github');
		const others = this.authenticationService.declaredProviders.filter(provider => provider.id !== 'github' && this.authenticationService.isAuthenticationProviderRegistered(provider.id));
		const candidates = [...(github && this.authenticationService.isAuthenticationProviderRegistered('github') ? [github] : []), ...others];
		for (const provider of candidates) {
			try {
				const accounts = await this.authenticationService.getAccounts(provider.id);
				if (this._store.isDisposed || generation !== this.generation) { return; }
				if (!accounts.length) { continue; }
				const login = accounts[0].label;
				this.account = { providerId: provider.id, providerLabel: provider.label, label: login };
				this.name.textContent = login;
				this.detail.textContent = t('accounts.profileWithAccount', provider.label, this.userDataProfileService.currentProfile.name);
				this.signIn.classList.add('hidden');
				clearNode(this.avatar);
				this.avatar.textContent = (login.trim().charAt(0) || 'O').toUpperCase();
				if (provider.id === 'github') {
					const image = append(this.avatar, $<HTMLImageElement>('img.openide-settings-profile-image'));
					image.alt = '';
					image.referrerPolicy = 'no-referrer';
					image.addEventListener('error', () => image.remove(), { once: true });
					image.src = `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=240`;
				}
				this.changed.fire();
				return;
			} catch {
				// A provider that fails to answer does not hide an account from another provider.
			}
		}
		if (!this._store.isDisposed && generation === this.generation) { this.paintSignedOut(!!github); }
	}

	private paintSignedOut(offerSignIn: boolean): void {
		this.account = undefined;
		this.name.textContent = t('accounts.signedOut');
		this.detail.textContent = t('accounts.profile', this.userDataProfileService.currentProfile.name);
		clearNode(this.avatar);
		append(this.avatar, $('span.codicon.codicon-account'));
		this.signIn.classList.toggle('hidden', !offerSignIn);
		this.changed.fire();
	}

	private async signInWithGitHub(): Promise<void> {
		if (this.signingIn) { return; }
		this.signingIn = true;
		this.signIn.disabled = true;
		this.signInLabel.textContent = t('accounts.signingIn');
		try {
			await this.commandService.executeCommand('openide.signInWithGitHub');
		} finally {
			this.signingIn = false;
			if (!this._store.isDisposed) {
				this.signIn.disabled = false;
				this.signInLabel.textContent = t('accounts.signInWithGitHub');
				await this.refresh();
			}
		}
	}
}
