/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { language as ideLocale } from '../../../../base/common/platform.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILanguagePackItem, ILanguagePackService } from '../../../../platform/languagePacks/common/languagePacks.js';
import { ILocaleService } from '../../../services/localization/common/locale.js';
import { onDidChangeOpenideLanguage, t } from '../../openideAgent/common/openideStrings.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from './openideSettingsSection.js';
import { OpenideSectionRenderer } from './openideSettingsSectionBuilder.js';

/** Value of the native selector that means "no language pack": the built-in English. */
const BUILTIN = '';
/** Value that opens the marketplace flow instead of picking a language. */
const INSTALL_MORE = '__install_more__';
const CONFIGURE_LOCALE_COMMAND = 'workbench.action.configureLocale';

/**
 * Settings › Language. ONE selector, because there is one language.
 *
 * It drives the IDE locale — `argv.json`'s `locale`, the same thing "Configure Display Language"
 * writes — and `ILocaleService.setLocale` owns the flow: install the pack if needed, then ask for
 * the restart. OpenIDE's own strings read that same locale (`openideStrings.ts`), so the single
 * restart moves the native interface and the fork's screens together.
 *
 * There used to be a second selector here for OpenIDE's strings alone. It switched without a
 * restart, which read as an advantage and was not: the native half still needed one, so the two
 * selectors' only reachable in-between state was a half-translated interface.
 */
export class OpenideLanguageSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings = [];

	private readonly renderStore = this._register(new DisposableStore());
	private root: HTMLElement | undefined;
	private installed: readonly ILanguagePackItem[] | undefined;
	private generation = 0;

	constructor(
		@ILanguagePackService private readonly languagePackService: ILanguagePackService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ILocaleService private readonly localeService: ILocaleService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this._register(onDidChangeOpenideLanguage(() => this.paint()));
	}

	render(container: HTMLElement, _context: IOpenideSettingsSectionContext): void {
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
		if (!this.installed) {
			const token = ++this.generation;
			this.languagePackService.getInstalledLanguages().then(languages => {
				if (token !== this.generation) { return; }
				this.installed = languages;
				this.paint();
			}, () => {
				if (token !== this.generation) { return; }
				this.installed = [];
				this.paint();
			});
		}
	}

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);

		const body = ui.section(root, {
			title: t('language.title'),
			description: t('language.desc'),
			keywords: ['idioma', 'language', 'locale', 'español', 'spanish', 'english', 'inglés', 'language pack', 'paquete de idioma'],
		});

		ui.callout(body, { icon: 'info', title: t('language.callout.title'), text: t('language.callout.text') });

		// ---- native interface
		const installed = this.installed;
		const current = ideLocale.toLowerCase();
		const native: { value: string; label: string }[] = [{ value: BUILTIN, label: t('language.ui.builtin') }];
		if (!installed) {
			native.push({ value: current, label: t('language.ui.loading') });
		} else {
			for (const pack of installed) {
				if (pack.id && pack.id !== 'en') {
					native.push({ value: pack.id.toLowerCase(), label: pack.label });
				}
			}
			if (current !== 'en' && !native.some(option => option.value === current)) {
				// The active locale is not among the installed packs (a pack removed, a locale set by
				// hand in argv.json): it is still what the user sees, so it is still selectable.
				native.push({ value: current, label: current });
			}
		}
		native.push({ value: INSTALL_MORE, label: t('language.ui.installMore') });
		const nativeSelect = ui.select(body, {
			label: t('language.ui.label'),
			options: native,
			value: current === 'en' ? BUILTIN : current,
			change: value => void this.changeNativeLocale(value),
		});
		this.describe(nativeSelect, t('language.ui.desc'));
	}

	/** The renderer's select row has no description slot; the hint goes under the row. */
	private describe(combobox: HTMLElement, text: string): void {
		const row = combobox.parentElement;
		if (row?.parentElement) {
			const desc = $('.openide-settings-section-desc.openide-settings-fieldrow-desc', undefined, text);
			row.parentElement.insertBefore(desc, row.nextSibling);
		}
	}

	private async changeNativeLocale(value: string): Promise<void> {
		if (value === INSTALL_MORE) {
			await this.commandService.executeCommand(CONFIGURE_LOCALE_COMMAND);
			return;
		}
		if (value === BUILTIN) {
			await this.localeService.clearLocalePreference();
			return;
		}
		const item = this.installed?.find(pack => pack.id?.toLowerCase() === value);
		if (item) {
			await this.localeService.setLocale(item);
		}
	}
}
