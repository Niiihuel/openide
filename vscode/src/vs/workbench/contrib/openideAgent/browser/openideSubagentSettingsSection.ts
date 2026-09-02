/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Subagents.
 *
 *  The 14 simple `openide.subagents.*` settings are rendered by the NATIVE LIST from the
 *  schema (with description, per-scope reset and search). What stays here is only what the
 *  schema cannot express: the validated editor for `routing.policy` (an object) and the live
 *  state panels (connected providers, health/cooldowns, latest routing decisions).
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from './openideControlStyles.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { parseSubagentRoutingPolicy } from '../common/openideSubagentRouting.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { ISubagentRoutingService } from './openideSubagentRoutingService.js';
import { ISubagentRunService } from './openideSubagentRunService.js';
import { t } from '../common/openideStrings.js';

const POLICY_SETTING = 'openide.subagents.routing.policy';

export class OpenideSubagentSettingsSection extends Disposable implements IOpenideSettingsSection {
	/** The rest of `openide.subagents.*` comes out as native rows; only the policy is drawn here. */
	readonly ownedSettings = [POLICY_SETTING];

	private readonly renderStore = this._register(new DisposableStore());
	/** Unsaved editing: the editor repaints on any config change and we do not want that to
	 *  erase the user's half-written JSON. */
	private draft: string | undefined;
	private generation = 0;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ISubagentRoutingService private readonly routing: ISubagentRoutingService,
		@ISubagentRunService private readonly runs: ISubagentRunService,
	) { super(); }

	render(container: HTMLElement, _context: IOpenideSettingsSectionContext): void {
		this.renderStore.clear();
		const token = ++this.generation;

		const policy = append(container, $('.openide-settings-section'));
		append(policy, $('.openide-settings-section-title', undefined, t('settings.subagents.policy')));
		append(policy, $('.openide-settings-section-desc', undefined,
			t('settings.subagents.policyDesc')));

		// Native `InputBox` in multiline mode, not a raw `<textarea>`: a bare textarea takes NO
		// theme colours — it renders with the browser's own white field, which is what this looked
		// like in every theme — and it would draw a second focus ring inside the one its wrapper
		// paints. `flexibleHeight` is upstream's multiline mode; it grows with the JSON instead of
		// pinning `rows`. See docs/theming-surfaces.md, rule 4.
		const editor = this.renderStore.add(new InputBox(append(policy, $('.openide-settings-fieldhost')), undefined, {
			inputBoxStyles: openideInputBoxStyles,
			ariaLabel: t('settings.subagents.policyLabel'),
			flexibleHeight: true,
			flexibleWidth: false,
		}));
		editor.element.classList.add('openide-settings-mono', 'openide-settings-policy');
		editor.inputElement.spellcheck = false;
		editor.value = this.draft ?? JSON.stringify(this.routing.policy(), null, 2);
		this.renderStore.add(editor.onDidChange(value => { this.draft = value; }));

		const errors = append(policy, $('.openide-settings-section-errors'));
		const showDiagnostics = (messages: readonly string[]) => {
			errors.textContent = messages.join('\n');
			errors.classList.toggle('visible', messages.length > 0);
		};
		showDiagnostics(this.routing.policyDiagnostics());

		const actions = append(policy, $('.openide-settings-section-actions'));
		const save = append(actions, $('button.oi-btn.openide-settings-section-button.primary', { type: 'button' }, t('settings.subagents.save'))) as HTMLButtonElement;
		const revert = append(actions, $('button.oi-btn.openide-settings-section-button', { type: 'button' }, t('settings.subagents.discard'))) as HTMLButtonElement;

		this.renderStore.add(addDisposableListener(save, 'click', () => {
			let parsedJson: unknown;
			try {
				parsedJson = JSON.parse(editor.value);
			} catch (error) {
				showDiagnostics([t('settings.subagents.policyInvalid', error instanceof Error ? error.message : String(error))]);
				return;
			}
			// Two layers: JSON.parse validates syntax, parseSubagentRoutingPolicy validates semantics
			// (version, presets, targets). We only persist when the second has no diagnostics.
			const parsed = parseSubagentRoutingPolicy(parsedJson);
			if (parsed.diagnostics.length) { showDiagnostics(parsed.diagnostics); return; }
			this.draft = undefined;
			showDiagnostics([]);
			void this.configurationService.updateValue(POLICY_SETTING, parsed.policy, ConfigurationTarget.USER);
		}));
		this.renderStore.add(addDisposableListener(revert, 'click', () => {
			this.draft = undefined;
			editor.value = JSON.stringify(this.routing.policy(), null, 2);
			showDiagnostics(this.routing.policyDiagnostics());
		}));

		const status = append(container, $('.openide-settings-section'));
		append(status, $('.openide-settings-section-title', undefined, t('settings.subagents.routingState')));
		const statusBody = append(status, $('.openide-settings-section-body'));
		statusBody.textContent = t('settings.subagents.loading');
		void this.renderStatus(statusBody, token);
	}

	private async renderStatus(body: HTMLElement, token: number): Promise<void> {
		const providers = await Promise.all(this.agentService.listProviders().map(async provider => ({
			label: provider.label,
			connected: await this.agentService.isConnected(provider.id).catch(() => false),
			models: await this.agentService.resolveProviderModels(provider).catch(() => provider.defaultModel ? [provider.defaultModel] : []),
		})));
		// The editor may have repainted (config/scope change) while we waited: if this run is no
		// longer the current one, `body` is orphaned and painting it would show another view's data.
		if (token !== this.generation) { return; }

		body.textContent = '';
		const group = (title: string): HTMLElement => {
			const wrapper = append(body, $('.openide-settings-status-group'));
			append(wrapper, $('.openide-settings-status-title', undefined, title));
			return append(wrapper, $('.openide-settings-status-list'));
		};

		const providerList = group(t('settings.subagents.providers'));
		if (!providers.length) {
			append(providerList, $('.openide-settings-status-empty', undefined, t('settings.subagents.noProviders')));
		}
		for (const provider of providers) {
			const row = append(providerList, $('.openide-settings-status-row'));
			append(row, $('span.openide-settings-status-name', undefined, provider.label));
			append(row, $('span.openide-settings-status-detail', undefined, provider.models.join(', ') || 'Sin modelos conocidos'));
			append(row, $(`span.openide-settings-status-state.${provider.connected ? 'ok' : 'off'}`, undefined, provider.connected ? 'Conectado' : 'Desconectado'));
		}

		const health = this.routing.listHealth();
		const healthList = group(t('settings.subagents.health'));
		if (!health.length) {
			append(healthList, $('.openide-settings-status-empty', undefined, t('settings.subagents.noFailures')));
		}
		for (const entry of health) {
			const row = append(healthList, $('.openide-settings-status-row'));
			append(row, $('span.openide-settings-status-name', undefined, `${entry.providerId}/${entry.model}`));
			append(row, $('span.openide-settings-status-detail', undefined, entry.reason ?? ''));
			append(row, $('span.openide-settings-status-state', undefined, entry.status));
		}

		const routed = this.runs.list().filter(run => run.routingDecision).slice(0, 20);
		const runList = group(t('settings.subagents.decisions'));
		if (!routed.length) {
			append(runList, $('.openide-settings-status-empty', undefined, t('settings.subagents.noRuns')));
		}
		for (const run of routed) {
			const attempts = run.routingAttempts?.length ?? 0;
			const row = append(runList, $('.openide-settings-status-row'));
			append(row, $('span.openide-settings-status-name', undefined, run.definitionName));
			append(row, $('span.openide-settings-status-detail', undefined, `${run.routingDecision!.profile} · ${run.providerId || 'default'}/${run.model}`));
			append(row, $('span.openide-settings-status-state', undefined, `${attempts} intento${attempts === 1 ? '' : 's'}`));
		}
	}
}

