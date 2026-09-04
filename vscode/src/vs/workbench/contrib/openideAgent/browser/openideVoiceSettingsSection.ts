/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Voice.
 *
 *  This page was two schema rows: a free-text `openide.agent.voiceModel` in `provider/model` form
 *  and an enum for the button's behaviour. The text box was not a stylistic choice — the product
 *  only knew three transcription models (the `voiceModel` a provider entry declares), so anyone
 *  with any other provider connected had to guess a model id, type it, and find out at the
 *  microphone whether it existed. A setting whose valid values the product can enumerate has no
 *  business being a text box.
 *
 *  It can enumerate them: `listVoiceModels` intersects the connected models with the ones that
 *  publish audio input, so this page offers the same models the chat offers, minus the ones that
 *  cannot hear. What it renders instead of a field:
 *
 *    - Automatic, which is the historical empty value, saying out loud what it resolves to NOW.
 *    - One card per connected provider, one row per model that hears, the current one checked.
 *    - The providers that were left out, WITH the reason. A user who connected Anthropic and
 *      does not find it here is owed "its protocol cannot carry audio", not an absence.
 *
 *  `ownedSettings` hides both keys from the native list: leaving the raw text box underneath a
 *  selector that writes the same key is how two controls start disagreeing about one value.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import { t } from '../common/openideStrings.js';
import { formatVoiceSetting, isVoiceSettingFor, IVoiceExclusion, IVoiceModelSelection, parseVoiceSetting, VoiceSetting } from '../common/openideVoiceModels.js';
import { IOpenideAgentService, IOpenidePickerModel } from './openideAgentService.js';

const VOICE_MODEL_SETTING = 'openide.agent.voiceModel';
const VOICE_MODE_SETTING = 'openide.agent.voiceMode';

/** Above this many models the list gets a filter: the registry publishes 32 audio models for a
 *  single router provider, and a card that long is a scroll, not a choice. */
const FILTER_THRESHOLD = 8;

export class OpenideVoiceSettingsSection extends Disposable implements IOpenideSettingsSection {

	readonly ownedSettings: readonly string[] = [VOICE_MODEL_SETTING, VOICE_MODE_SETTING];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	/**
	 * The section's OWN element inside the editor's content.
	 *
	 * `render` is handed the same container the native setting rows were just painted into, so a
	 * section that clears it erases them. Everything here goes in this child instead, which is also
	 * what makes an event-driven repaint possible: it can be emptied without touching anything the
	 * editor put there.
	 */
	private host: HTMLElement | undefined;
	/** Invalidates a listing that arrives after the page was repainted or navigated away from. */
	private generation = 0;
	/** Types into the model filter. Kept on the section, not in the DOM, so a repaint triggered by
	 *  a config change does not throw away what the user was narrowing down. */
	private query = '';
	private navigate: ((category: string) => void) | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super();
		// Connecting a provider elsewhere (or a catalog refresh) changes what this page can offer.
		this._register(this.agentService.onDidChange(() => this.repaint()));
	}

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.navigate = context.navigate;
		this.host = append(container, $('.openide-settings-voice'));
		this.paint();
	}

	/**
	 * `isConnected` is NOT checked here, only in `repaint` and in the async callbacks below.
	 *
	 * The first paint runs from `render`, and whether the editor's content element is attached at
	 * that moment is the editor's business, not this page's. A guard here would turn "rendered a
	 * beat early" into a page that draws nothing at all and says nothing about why -- the worst
	 * failure a settings page has. What the guard is really for is the LATE work: an event or a
	 * resolved listing arriving after the user navigated away.
	 */
	private paint(): void {
		const host = this.host;
		if (!host) {
			return;
		}
		this.renderStore.clear();
		clearNode(host);
		const token = ++this.generation;

		this.renderMode(host);

		const modelsHost = append(host, $('.openide-settings-section'));
		append(modelsHost, $('.openide-settings-section-title', undefined, t('settings.voice.modelTitle')));
		append(modelsHost, $('.openide-settings-section-desc', undefined, t('settings.voice.modelDesc')));
		const busy = append(modelsHost, $('.openide-settings-section-desc', undefined, t('settings.voice.loading')));

		void this.agentService.listVoiceModels().then(selection => {
			if (token !== this.generation || !host.isConnected) { return; }
			busy.remove();
			this.renderModels(modelsHost, selection);
		}, () => {
			if (token !== this.generation || !host.isConnected) { return; }
			busy.textContent = t('settings.voice.loadFailed');
		});
	}

	/** Hold-to-talk vs toggle. An enum of two, so it reads as two buttons rather than a menu. */
	private renderMode(container: HTMLElement): void {
		const host = append(container, $('.openide-settings-section'));
		append(host, $('.openide-settings-section-title', undefined, t('settings.voice.modeTitle')));
		append(host, $('.openide-settings-section-desc', undefined, t('settings.voice.modeDesc')));
		const current = String(this.configurationService.getValue(VOICE_MODE_SETTING) ?? 'toggle');
		this.ui.segmented(host, {
			label: t('settings.voice.modeLabel'),
			options: [
				{ id: 'toggle', label: t('settings.voice.modeToggle') },
				{ id: 'holdToTalk', label: t('settings.voice.modeHold') },
			],
			value: current === 'holdToTalk' ? 'holdToTalk' : 'toggle',
			change: id => void this.configurationService.updateValue(VOICE_MODE_SETTING, id, ConfigurationTarget.USER),
		});
	}

	private renderModels(host: HTMLElement, selection: IVoiceModelSelection<IOpenidePickerModel>): void {
		const setting = parseVoiceSetting(String(this.configurationService.getValue(VOICE_MODEL_SETTING) ?? ''));

		// A value typed by hand before this page existed, in the wrong shape. It cannot be shown as
		// a selected row (it matches nothing), and leaving it silently would keep the microphone
		// broken with no clue why, so it gets said and offered a way out.
		if (setting.kind === 'invalid') {
			this.ui.callout(host, {
				tone: 'error',
				title: t('settings.voice.invalidTitle'),
				text: t('settings.voice.invalidText'),
				actions: [{ label: t('settings.voice.invalidClear'), run: () => void this.choose(undefined) }],
			});
		}

		const total = selection.groups.reduce((count, group) => count + group.models.length, 0);
		if (!total) {
			this.renderNothingAvailable(host, selection.excluded);
			return;
		}

		let counter: ((text: string | undefined) => void) | undefined;
		const rows: { row: HTMLElement; card: HTMLElement; text: string }[] = [];
		if (total > FILTER_THRESHOLD) {
			const filter = this.ui.filter(host, {
				placeholder: t('settings.voice.filterPlaceholder'),
				change: query => { this.query = query; applyFilter(); },
			});
			counter = text => filter.setCount(text);
		}

		this.renderAutomatic(host, setting);

		for (const group of selection.groups) {
			const card = this.ui.card(host, { caption: group.label, keywords: [group.id, 'voice', 'audio', 'dictation', 'dictado', 'voz'] });
			for (const model of group.models) {
				const selected = isVoiceSettingFor(setting, group.id, model.id);
				const value = this.ui.cardRow(card, {
					label: model.name,
					description: model.id,
					mono: true,
					icon: selected ? 'check' : undefined,
					keywords: [group.id, group.label, ...model.input],
					run: () => void this.choose(formatVoiceSetting(group.id, model.id)),
				});
				const row = value.parentElement!;
				if (selected) { row.classList.add('selected'); }
				if (model.context) { this.ui.status(value, { label: model.context, tone: 'neutral' }); }
				rows.push({ row, card, text: [model.name, model.id, group.label, group.id].join(' ').toLowerCase() });
			}
		}

		// A pinned value the listing no longer contains: the model was withdrawn, the provider was
		// disconnected, or the registry stopped publishing audio for it. Dictation still WORKS (the
		// resolver sends whatever is stored), so this is a warning, not an error.
		if (setting.kind === 'pinned' && !rows.some(entry => entry.row.classList.contains('selected'))) {
			this.ui.callout(host, {
				tone: 'warn',
				title: t('settings.voice.pinnedMissingTitle'),
				text: t('settings.voice.pinnedMissingText', formatVoiceSetting(setting.providerId, setting.model)),
				actions: [{ label: t('settings.voice.invalidClear'), run: () => void this.choose(undefined) }],
			});
		}

		this.renderExcluded(host, selection.excluded);

		const applyFilter = () => {
			let shown = 0;
			const firstVisible = new Set<HTMLElement>();
			for (const entry of rows) {
				const visible = !this.query || entry.text.includes(this.query);
				entry.row.classList.toggle('hidden', !visible);
				entry.row.classList.remove('first-visible');
				if (!visible) { continue; }
				shown++;
				// Same hairline rule the providers list follows: the border-top belongs to every row
				// but the first child, so when the filter hides that child the next one has to give
				// its own line up or it draws right under the card's edge.
				if (!firstVisible.has(entry.card)) {
					firstVisible.add(entry.card);
					if (entry.row.previousElementSibling) { entry.row.classList.add('first-visible'); }
				}
			}
			// A card whose every row is filtered out is a caption floating over nothing.
			for (const card of new Set(rows.map(entry => entry.card))) {
				const any = rows.some(entry => entry.card === card && !entry.row.classList.contains('hidden'));
				card.closest('.openide-settings-cardsection')?.classList.toggle('hidden', !any);
			}
			counter?.(this.query ? t('settings.voice.filterCount', String(shown), String(total)) : undefined);
		};
		if (this.query) { applyFilter(); }
	}

	/** The historical empty value, which follows the active provider. It says what it resolves to
	 *  right now: "Automatic" alone is a promise the user cannot check. */
	private renderAutomatic(host: HTMLElement, setting: VoiceSetting): void {
		const active = this.agentService.findProvider(this.agentService.getActiveProviderId());
		const resolved = active?.voiceModel
			? t('settings.voice.autoResolved', active.label, active.voiceModel)
			: t('settings.voice.autoUnresolved', active?.label ?? '—');
		const card = this.ui.card(host, { keywords: ['auto', 'automatic', 'automático'] });
		const value = this.ui.cardRow(card, {
			label: t('settings.voice.auto'),
			description: resolved,
			icon: setting.kind === 'auto' ? 'check' : undefined,
			run: () => void this.choose(undefined),
		});
		if (setting.kind === 'auto') { value.parentElement!.classList.add('selected'); }
	}

	private renderNothingAvailable(host: HTMLElement, excluded: readonly IVoiceExclusion[]): void {
		this.ui.empty(host, {
			title: excluded.length ? t('settings.voice.noneTitle') : t('settings.voice.noProvidersTitle'),
			description: excluded.length ? t('settings.voice.noneDesc') : t('settings.voice.noProvidersDesc'),
			actions: [{ label: t('settings.voice.openProviders'), primary: true, run: () => this.navigateToProviders() }],
		});
		this.renderExcluded(host, excluded);
	}

	/** Why a connected provider is not on the list. Without this the page is an absence, and an
	 *  absence reads as a bug. */
	private renderExcluded(host: HTMLElement, excluded: readonly IVoiceExclusion[]): void {
		if (!excluded.length) { return; }
		const box = this.ui.group(host, { title: t('settings.voice.excludedTitle'), footer: t('settings.voice.excludedFooter') });
		for (const entry of excluded) {
			this.ui.groupRow(box, {
				label: entry.label,
				description: entry.reason === 'protocol'
					? t('settings.voice.excludedProtocol')
					: t('settings.voice.excludedNoAudio'),
			});
		}
	}

	private navigateToProviders(): void {
		this.navigate?.('openideAgent/providers');
	}

	private repaint(): void {
		if (this.host?.isConnected) { this.paint(); }
	}

	/** `undefined` clears the setting back to Automatic. Written at USER scope: dictation is a
	 *  property of this person's microphone and accounts, not of the folder they opened. */
	private async choose(value: string | undefined): Promise<void> {
		await this.configurationService.updateValue(VOICE_MODEL_SETTING, value ?? '', ConfigurationTarget.USER);
		this.repaint();
	}
}
