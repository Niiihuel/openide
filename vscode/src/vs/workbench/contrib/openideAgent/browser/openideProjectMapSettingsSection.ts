/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > Project Map.
 *
 *  The 14 scalar `openide.memory.*` settings are rendered by the NATIVE LIST from the schema
 *  (several carry a markdownDescription far more complete than the webview showed). What stays
 *  here is what the schema cannot express: the index state with its actions
 *  (rebuild / clear / open), the learning metrics, and the two glob patterns
 *  (`exclude`/`include`) which, being arrays, would fall back to "edit in settings.json".
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from './openideControlStyles.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideProjectMapLearningService } from './openideProjectMapLearningService.js';
import { t } from '../common/openideStrings.js';

const GLOB_SETTINGS = ['openide.memory.exclude', 'openide.memory.include'] as const;

export class OpenideProjectMapSettingsSection extends Disposable implements IOpenideSettingsSection {
	/** Glob arrays: the generic control only offers "edit in settings.json". */
	readonly ownedSettings = [...GLOB_SETTINGS];

	private readonly renderStore = this._register(new DisposableStore());
	private root: HTMLElement | undefined;
	private generation = 0;
	/** Unsaved drafts, per key: a repaint must not clobber what you are typing. */
	private readonly drafts = new Map<string, string>();
	private warning = '';
	private busy = false;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@ICodebaseMemoryService private readonly memoryService: ICodebaseMemoryService,
		@IOpenideProjectMapLearningService private readonly learning: IOpenideProjectMapLearningService,
	) {
		super();
		// The index changes outside configuration (incremental indexing, watcher): without this the
		// metrics would stay frozen until the user navigated to another category and back.
		this._register(this.memoryService.onDidChange(() => this.paint()));
	}

	render(container: HTMLElement, _context: IOpenideSettingsSectionContext): void {
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	private paint(): void {
		const root = this.root;
		// After navigating to another category the editor clears its content and our root is left
		// disconnected: painting it would be wasted work (and would hide a leak if it stopped being so).
		if (!root?.isConnected) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;

		const status = append(root, $('.openide-settings-section'));
		append(status, $('.openide-settings-section-title', undefined, t('settings.projectMap.title')));
		append(status, $('.openide-settings-section-desc', undefined,
			t('settings.projectMap.desc')));

		const headline = append(status, $('.openide-settings-status-headline'));
		const dot = append(headline, $('span.openide-settings-status-dot'));
		const headlineText = append(headline, $('span', undefined, t('settings.projectMap.reading')));

		const metrics = append(status, $('.openide-settings-metrics'));
		const scanReport = append(status, $('.openide-settings-section-desc'));
		const warnBox = append(status, $('.openide-settings-warnbox'));
		warnBox.textContent = this.warning;
		warnBox.classList.toggle('visible', !!this.warning);

		const actions = append(status, $('.openide-settings-section-actions'));
		const rebuild = append(actions, $('button.oi-btn.openide-settings-section-button.primary', { type: 'button' }, t('settings.projectMap.rebuild'))) as HTMLButtonElement;
		const clear = append(actions, $('button.oi-btn.openide-settings-section-button.danger', { type: 'button' }, t('settings.projectMap.clear'))) as HTMLButtonElement;
		const open = append(actions, $('button.oi-btn.openide-settings-section-button', { type: 'button' }, t('settings.projectMap.open'))) as HTMLButtonElement;
		rebuild.disabled = this.busy;

		this.renderStore.add(addDisposableListener(rebuild, 'click', () => void this.rebuild()));
		this.renderStore.add(addDisposableListener(open, 'click', () => void this.commandService.executeCommand('openide.memory.open')));
		// Clearing deletes the whole index: it arms first, and only the second click executes.
		let clearArmed = false;
		this.renderStore.add(addDisposableListener(clear, 'click', () => {
			if (!clearArmed) {
				clearArmed = true;
				clear.textContent = t('settings.projectMap.clearConfirm');
				clear.classList.add('armed');
				return;
			}
			void this.memoryService.clear().then(() => this.paint());
		}));

		this.renderGlobs(root);
		this.renderLearning(root);
		void this.renderStatus({ dot, headlineText, metrics, scanReport }, token);
	}

	private async renderStatus(ui: { dot: HTMLElement; headlineText: HTMLElement; metrics: HTMLElement; scanReport: HTMLElement }, token: number): Promise<void> {
		const version = await this.memoryService.getVersion().catch(() => undefined);
		// It may have repainted while we waited: these nodes are no longer the ones the user sees.
		if (token !== this.generation) { return; }
		const scan = this.memoryService.getLastScanCounters();

		ui.dot.classList.remove('warn', 'empty');
		if (this.busy) {
			ui.headlineText.textContent = t('settings.projectMap.rebuilding');
		} else if (!version) {
			ui.dot.classList.add('empty');
			ui.headlineText.textContent = t('settings.projectMap.notBuilt');
		} else if (version.staleCount) {
			ui.dot.classList.add('warn');
			ui.headlineText.textContent = `${version.staleCount} archivo(s) requieren actualización`;
		} else {
			ui.headlineText.textContent = t('settings.projectMap.upToDate');
		}

		clearNode(ui.metrics);
		const metric = (value: string, label: string) => {
			const cell = append(ui.metrics, $('.openide-settings-metric'));
			append(cell, $('span.openide-settings-metric-value', undefined, value));
			append(cell, $('span.openide-settings-metric-label', undefined, label));
		};
		metric(version ? `v${version.version}` : '—', t('settings.projectMap.version'));
		metric(version ? Number(version.nodeCount || 0).toLocaleString() : '0', 'Entidades');
		metric(version ? Number(version.edgeCount || 0).toLocaleString() : '0', 'Relaciones');
		metric(version ? Number(version.staleCount || 0).toLocaleString() : '0', t('settings.projectMap.pending'));
		metric(version?.builtAt ? new Date(version.builtAt).toLocaleString() : '—', t('settings.projectMap.lastBuild'));

		// What was left out of the index is stated, not hidden.
		const parts: string[] = [];
		if (scan?.excludedByUser) { parts.push(`${scan.excludedByUser} excluidos por tus patrones`); }
		if (scan?.excludedTests) { parts.push(`${scan.excludedTests} tests omitidos`); }
		if (scan?.skippedTooLarge) { parts.push(`${scan.skippedTooLarge} archivos demasiado grandes`); }
		ui.scanReport.textContent = parts.length ? `Último scan: ${parts.join(' · ')}.` : '';
	}

	private renderGlobs(root: HTMLElement): void {
		const section = append(root, $('.openide-settings-section'));
		append(section, $('.openide-settings-section-title', undefined, t('settings.projectMap.patterns')));
		append(section, $('.openide-settings-section-desc', undefined,
			t('settings.projectMap.patternsDesc')));

		for (const key of GLOB_SETTINGS) {
			const isExclude = key.endsWith('exclude');
			const field = append(section, $('.openide-settings-field'));
			const label = isExclude ? t('settings.projectMap.exclude') : t('settings.projectMap.include');
			append(field, $('label.openide-settings-field-label', undefined, label));
			// Native `InputBox` in multiline mode. A raw `<textarea>` takes no theme colours at all
			// — it renders as the browser's white field in every theme — and doubles the focus ring
			// against its wrapper. See docs/theming-surfaces.md, rule 4.
			const area = this.renderStore.add(new InputBox(append(field, $('.openide-settings-fieldhost')), undefined, {
				inputBoxStyles: openideInputBoxStyles,
				ariaLabel: label,
				placeholder: isExclude ? 'docs\n**/*.generated.ts' : 'src\napps/**',
				flexibleHeight: true,
				flexibleWidth: false,
			}));
			area.element.classList.add('openide-settings-mono', 'openide-settings-globs');
			area.inputElement.spellcheck = false;
			const saved = this.configurationService.getValue<string[]>(key);
			area.value = this.drafts.get(key) ?? (Array.isArray(saved) ? saved.join('\n') : '');
			this.renderStore.add(area.onDidChange(value => { this.drafts.set(key, value); }));
			// On field blur: we normalize (trim, no empties, cap 200) and persist.
			this.renderStore.add(addDisposableListener(area.inputElement, 'blur', () => {
				const globs = area.value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 200);
				this.drafts.delete(key);
				void this.configurationService.updateValue(key, globs, ConfigurationTarget.USER);
			}));
		}
	}

	private renderLearning(root: HTMLElement): void {
		const stats = this.learning.stats();
		const section = append(root, $('.openide-settings-section'));
		append(section, $('.openide-settings-section-title', undefined, 'Aprendizaje'));
		append(section, $('.openide-settings-section-desc', undefined,
			t('settings.projectMap.learnedDesc')));

		const metrics = append(section, $('.openide-settings-metrics'));
		const metric = (value: number, label: string) => {
			const cell = append(metrics, $('.openide-settings-metric'));
			append(cell, $('span.openide-settings-metric-value', undefined, String(value || 0)));
			append(cell, $('span.openide-settings-metric-label', undefined, label));
		};
		metric(stats.tracked, t('settings.projectMap.learned'));
		metric(stats.preferred, 'Confiables');
		metric(stats.tentative, 'Tentativas');
		metric(stats.contested, t('settings.projectMap.disputed'));

		const actions = append(section, $('.openide-settings-section-actions'));
		const forget = append(actions, $('button.oi-btn.openide-settings-section-button', { type: 'button' }, t('settings.projectMap.forget'))) as HTMLButtonElement;
		forget.disabled = !(stats.tracked > 0);
		this.renderStore.add(addDisposableListener(forget, 'click', () => {
			this.learning.clear();
			this.paint();
		}));
	}

	private async rebuild(): Promise<void> {
		this.busy = true;
		this.warning = '';
		this.paint();
		try {
			const result = await this.memoryService.rebuildFull();
			this.warning = result.warning ?? '';
		} catch (error) {
			this.warning = error instanceof Error ? error.message : String(error);
		}
		this.busy = false;
		this.paint();
	}
}
