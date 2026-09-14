/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideAccountProfile } from '../../browser/openideAccountProfile.js';

suite('OpenIDE shared account profile', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		let accounts: { id: string; label: string }[] = [];
		const changes = store.add(new Emitter<void>());
		const commands: string[] = [];
		const profile = { name: 'Development' };
		const auth = upcastPartial<IAuthenticationService>({
			declaredProviders: [{ id: 'github', label: 'GitHub' }, { id: 'fixture', label: 'Fixture' }],
			isAuthenticationProviderRegistered: id => id === 'fixture',
			getAccounts: async () => accounts,
			onDidRegisterAuthenticationProvider: Event.None, onDidUnregisterAuthenticationProvider: Event.None,
			onDidChangeSessions: Event.map(changes.event, () => ({ providerId: 'fixture', label: 'Fixture', event: { added: [], removed: [], changed: [] } })),
		});
		const widget = store.add(new OpenideAccountProfile(mainWindow.document.createElement('div'),
			upcastPartial<IUserDataProfileService>({ currentProfile: upcastPartial<IUserDataProfile>(profile), onDidChangeCurrentProfile: Event.None }),
			auth, upcastPartial<IExtensionService>({ activateByEvent: async () => {} }),
			upcastPartial<ICommandService>({ executeCommand: async id => { commands.push(id); return undefined; } }), NullHoverService,
		));
		return { widget, profile, commands, setAccounts: (value: typeof accounts) => { accounts = value; changes.fire(); } };
	}

	test('shared footer updates for sign in and sign out without fetching credentials', async () => {
		const f = fixture();
		await f.widget.refresh();
		const button = f.widget.domNode.querySelector<HTMLButtonElement>('button')!;
		const signedOutOffersSignIn = !button.classList.contains('hidden');
		f.setAccounts([{ id: 'fixture-account', label: 'Test Person' }]);
		await timeout(0);
		const connected = { name: f.widget.domNode.querySelector('.openide-settings-profile-name')?.textContent, hidden: button.classList.contains('hidden') };
		f.setAccounts([]);
		await timeout(0);
		assert.deepStrictEqual({ signedOutOffersSignIn, connected, signedOutAgain: !button.classList.contains('hidden') }, { signedOutOffersSignIn: true, connected: { name: 'Test Person', hidden: true }, signedOutAgain: true });
	});

	test('sign in delegates to the existing IDE command', async () => {
		const f = fixture();
		await f.widget.refresh();
		f.widget.domNode.querySelector<HTMLButtonElement>('button')!.click();
		await timeout(0);
		assert.deepStrictEqual(f.commands, ['openide.signInWithGitHub']);
	});

	test('profile footer supports keyboard navigation and the page identity is not interactive', async () => {
		const f = fixture();
		let opened = 0;
		f.widget.setOpenProfile(() => opened++);
		const profile = f.widget.domNode.querySelector<HTMLElement>('.openide-settings-profile')!;
		profile.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.strictEqual(opened, 1);
		f.widget.showAsPage();
		profile.click();
		assert.strictEqual(opened, 1);
		assert.strictEqual(profile.hasAttribute('tabindex'), false);
		assert.strictEqual(profile.hasAttribute('role'), false);
	});

	test('late account response cannot repaint a disposed footer', async () => {
		const ready = new DeferredPromise<void>();
		let queries = 0;
		const widget = store.add(new OpenideAccountProfile(mainWindow.document.createElement('div'),
			upcastPartial<IUserDataProfileService>({ currentProfile: upcastPartial<IUserDataProfile>({ name: 'Test' }), onDidChangeCurrentProfile: Event.None }),
			upcastPartial<IAuthenticationService>({ declaredProviders: [], getAccounts: async () => { queries++; return []; }, onDidRegisterAuthenticationProvider: Event.None, onDidUnregisterAuthenticationProvider: Event.None, onDidChangeSessions: Event.None }),
			upcastPartial<IExtensionService>({ activateByEvent: () => ready.p }), upcastPartial<ICommandService>({}), NullHoverService,
		));
		const pending = widget.refresh();
		widget.dispose();
		await ready.complete();
		await pending;
		assert.strictEqual(queries, 0);
	});
});
