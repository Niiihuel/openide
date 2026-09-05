/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { language as ideLocale, locale as requestedLocale } from '../../../../base/common/platform.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IExtensionGalleryService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { ILanguagePackItem, ILanguagePackService } from '../../../../platform/languagePacks/common/languagePacks.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { ILocaleService } from '../../../services/localization/common/locale.js';
import { onDidChangeOpenideLanguage, t } from '../../openideAgent/common/openideStrings.js';
import { buildDisplayLanguageOptions, IOpenideShippedLanguage, OPENIDE_DEFAULT_LOCALE, OPENIDE_SHIPPED_LANGUAGES, selectedDisplayLanguage } from '../common/openideDisplayLanguages.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from './openideSettingsSection.js';
import { OpenideSectionRenderer } from './openideSettingsSectionBuilder.js';

/** Value that opens the marketplace flow instead of picking a language. */
const INSTALL_MORE = '__install_more__';
const CONFIGURE_LOCALE_COMMAND = 'workbench.action.configureLocale';
const EXTENSIONS_SEARCH_COMMAND = 'workbench.extensions.search';

/**
 * Settings › Language. ONE selector, because there is one language.
 *
 * It drives the IDE locale — `argv.json`'s `locale`, the same thing "Configure Display Language"
 * writes — and `ILocaleService.setLocale` owns the flow: install the pack if needed, then ask for
 * the restart. OpenIDE's own strings read that same locale (`openideStrings.ts`), so the single
 * restart moves the native interface and the fork's screens together.
 *
 * The two languages OpenIDE is TRANSLATED INTO are listed unconditionally, from a constant, and
 * their pack is fetched by id — see `openideDisplayLanguages.ts` for why the gallery's own
 * language-pack listing cannot be trusted to surface them.
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
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IProgressService private readonly progressService: IProgressService,
		@INotificationService private readonly notificationService: INotificationService,
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

		const stranded = this.strandedLanguage();
		if (stranded) {
			ui.callout(body, {
				tone: 'warn',
				icon: 'warning',
				title: t('language.mismatch.title', stranded.label),
				text: t('language.mismatch.text', stranded.label),
				actions: [{ label: t('language.mismatch.install', stranded.label), run: () => void this.pickLanguage(stranded.locale) }],
			});
		}

		const options = buildDisplayLanguageOptions(ideLocale, this.installed);
		const rows = options.map(option => ({
			value: option.value,
			label: option.partial ? t('language.ui.partial', option.label) : option.label,
		}));
		rows.push({ value: INSTALL_MORE, label: t('language.ui.installMore') });

		const select = ui.select(body, {
			label: t('language.ui.label'),
			options: rows,
			value: selectedDisplayLanguage(ideLocale, options),
			change: value => void this.pickLanguage(value),
		});
		this.describe(select, t('language.ui.desc'));
	}

	/**
	 * A language was asked for and English was delivered. `resolveNLSConfiguration` falls back
	 * silently when it cannot find the pack, so the IDE looks like nobody ever chose anything —
	 * `platform.locale` is what was asked for (from `argv.json` or the OS), `platform.language`
	 * what was actually loaded. Someone whose system is in Spanish gets an English IDE and no
	 * explanation; this is the explanation, with the one action that fixes it.
	 *
	 * Only when the pack is genuinely absent. The same two values also diverge in a DEV build,
	 * where `resolveNLSConfiguration` skips language packs outright — pack installed, English
	 * anyway — and "the pack is missing" would be a lie the user cannot act on.
	 */
	private strandedLanguage(): IOpenideShippedLanguage | undefined {
		if (!this.installed || ideLocale.toLowerCase() !== OPENIDE_DEFAULT_LOCALE) {
			return undefined;
		}
		const asked = (requestedLocale ?? '').toLowerCase();
		if (!asked || asked.startsWith(OPENIDE_DEFAULT_LOCALE)) {
			return undefined;
		}
		const shipped = OPENIDE_SHIPPED_LANGUAGES.find(language => !!language.extensionId && (asked === language.locale || asked.startsWith(`${language.locale}-`)));
		if (!shipped || this.installed.some(pack => pack.id?.toLowerCase() === shipped.locale)) {
			return undefined;
		}
		return shipped;
	}

	/** The renderer's select row has no description slot; the hint goes under the row. */
	private describe(combobox: HTMLElement, text: string): void {
		const row = combobox.parentElement;
		if (row?.parentElement) {
			const desc = $('.openide-settings-section-desc.openide-settings-fieldrow-desc', undefined, text);
			row.parentElement.insertBefore(desc, row.nextSibling);
		}
	}

	private async pickLanguage(value: string): Promise<void> {
		if (value === INSTALL_MORE) {
			await this.commandService.executeCommand(CONFIGURE_LOCALE_COMMAND);
			return;
		}
		if (value === OPENIDE_DEFAULT_LOCALE) {
			await this.localeService.clearLocalePreference();
			return;
		}
		// An installed pack is already a complete `ILanguagePackItem`: no gallery round-trip.
		const installed = this.installed?.find(pack => pack.id?.toLowerCase() === value);
		if (installed) {
			await this.localeService.setLocale(installed);
			return;
		}
		const shipped = OPENIDE_SHIPPED_LANGUAGES.find(language => language.locale === value);
		if (!shipped?.extensionId) {
			// The active locale listed as itself, with no pack behind it: picking it is a no-op.
			return;
		}
		const item = await this.fetchLanguagePack(shipped);
		if (item) {
			await this.localeService.setLocale(item);
		}
	}

	/**
	 * Resolves the pack BY ID rather than out of a listing, and asks for a version compatible with
	 * this build: the gallery serves the newest pack (whose engine tracks the newest Code OSS),
	 * and installing that one into an older workbench is exactly the install that fails.
	 */
	private async fetchLanguagePack(language: IOpenideShippedLanguage): Promise<ILanguagePackItem | undefined> {
		if (!this.galleryService.isEnabled()) {
			this.reportUnavailable(language);
			return undefined;
		}
		const cancellation = new CancellationTokenSource();
		try {
			const [extension] = await this.progressService.withProgress(
				{ location: ProgressLocation.Notification, title: t('language.ui.fetching', language.label) },
				() => this.galleryService.getExtensions([{ id: language.extensionId! }], { compatible: true, source: 'openideLanguageSection' }, cancellation.token));
			if (!extension) {
				this.reportUnavailable(language);
				return undefined;
			}
			return {
				id: language.locale,
				label: language.label,
				extensionId: extension.identifier.id,
				galleryExtension: extension,
			};
		} catch (error) {
			this.reportUnavailable(language);
			return undefined;
		} finally {
			cancellation.dispose();
		}
	}

	private reportUnavailable(language: IOpenideShippedLanguage): void {
		this.notificationService.prompt(
			Severity.Error,
			t('language.ui.packUnavailable', language.label),
			[{ label: t('language.ui.packSearch'), run: () => void this.commandService.executeCommand(EXTENSIONS_SEARCH_COMMAND, `@id:${language.extensionId}`) }],
		);
	}
}
