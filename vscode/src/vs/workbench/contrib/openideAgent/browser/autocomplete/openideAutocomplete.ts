/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — AI autocomplete: ghost text from the configured model as you type.
 *
 *  Continue's tab autocomplete, as a workbench feature instead of an extension: one
 *  `InlineCompletionsProvider` registered for every language, fed by the engine in
 *  `common/autocomplete/` and by the agent service's raw completion call. The editor's own
 *  inline-suggest controller does the rest — debounce (`debounceDelayMs`), ghost rendering,
 *  Tab to accept, word/line partial accept, the typed-through matching — which is why this
 *  file is small: it decides WHETHER to ask, what to ask, and what of the answer to show.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { match as matchGlob } from '../../../../../base/common/glob.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorFeature, registerEditorFeature } from '../../../../../editor/common/editorFeatures.js';
import { InlineCompletionContext, InlineCompletions, InlineCompletionsProvider, InlineCompletionTriggerKind } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { t } from '../../common/openideStrings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { buildAutocompletePrompt, COMPLETION_MAX_TOKENS, OpenideAutocompleteMultiline, postprocessCompletion, reuseCompletion } from '../../common/autocomplete/openideAutocompleteEngine.js';
import { IOpenideAgentService } from '../openideAgentService.js';

export const OPENIDE_AUTOCOMPLETE_ENABLED = 'openide.autocomplete.enabled';
export const OPENIDE_AUTOCOMPLETE_MODEL = 'openide.autocomplete.model';
export const OPENIDE_AUTOCOMPLETE_DEBOUNCE = 'openide.autocomplete.debounceMs';
export const OPENIDE_AUTOCOMPLETE_MULTILINE = 'openide.autocomplete.multiline';
export const OPENIDE_AUTOCOMPLETE_MAX_TOKENS = 'openide.autocomplete.maxTokens';
export const OPENIDE_AUTOCOMPLETE_DISABLE_IN = 'openide.autocomplete.disableInFiles';
export const OPENIDE_AUTOCOMPLETE_TOGGLE_COMMAND = 'openide.autocomplete.toggle';

/** Completions remembered per editor session, across every file. Continue keeps 1000 in SQLite. */
const CACHE_LIMIT = 200;
/** After a provider says "too many requests", automatic completions pause this long. */
const RATE_LIMIT_COOLDOWN_MS = 30_000;

export class OpenideAutocompleteFeature extends Disposable implements IEditorFeature, InlineCompletionsProvider {

	readonly displayName = 'OpenIDE';
	readonly groupId = 'openide.autocomplete';

	/** Keyed `uri\0prunedPrefix`, insertion-ordered so the oldest entry is the first to go. */
	private readonly cache = new Map<string, string>();
	private inFlight = 0;
	/** Until when automatic requests stay off after a 429. An explicit trigger still asks. */
	private cooldownUntil = 0;
	private readonly status = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@ILanguageFeaturesService languageFeatures: ILanguageFeaturesService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(languageFeatures.inlineCompletionsProvider.register('*', this));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openide.autocomplete')) {
				this.renderStatus();
			}
		}));
		this.renderStatus();
	}

	/** Read by the inline-suggest controller: it waits this long after the last keystroke. */
	get debounceDelayMs(): number {
		const value = this.configurationService.getValue<number>(OPENIDE_AUTOCOMPLETE_DEBOUNCE);
		return typeof value === 'number' && value >= 0 ? value : 350;
	}

	private get enabled(): boolean {
		return this.configurationService.getValue<boolean>(OPENIDE_AUTOCOMPLETE_ENABLED) !== false;
	}

	async provideInlineCompletions(model: ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletions | undefined> {
		if (!this.enabled || !context.includeInlineCompletions) {
			return undefined;
		}
		if (model.uri.scheme !== 'file' && model.uri.scheme !== 'untitled') {
			return undefined; // the SCM input, output panes, settings editors: not code being written
		}
		const path = this.pathOf(model);
		const disabledIn = this.configurationService.getValue<string[]>(OPENIDE_AUTOCOMPLETE_DISABLE_IN);
		if (Array.isArray(disabledIn) && disabledIn.some(pattern => typeof pattern === 'string' && pattern && matchGlob(pattern, path))) {
			return undefined;
		}
		const lineCount = model.getLineCount();
		const prefix = model.getValueInRange(new Range(1, 1, position.lineNumber, position.column));
		const suffix = model.getValueInRange(new Range(position.lineNumber, position.column, lineCount, model.getLineMaxColumn(lineCount)));
		if (!prefix.trim() && context.triggerKind === InlineCompletionTriggerKind.Automatic) {
			return undefined; // an empty file has nothing to continue; Alt+\ still asks
		}
		if (context.triggerKind === InlineCompletionTriggerKind.Automatic && Date.now() < this.cooldownUntil) {
			return undefined; // the provider asked for a pause; hammering it only lengthens it
		}
		const multiline = this.configurationService.getValue<OpenideAutocompleteMultiline>(OPENIDE_AUTOCOMPLETE_MULTILINE) ?? 'auto';
		const built = buildAutocompletePrompt({ path, languageId: model.getLanguageId(), prefix, suffix, multiline });
		const uri = model.uri.toString();

		let completion = this.lookup(uri, built.prefix);
		if (completion === undefined) {
			this.inFlight++;
			this.renderStatus();
			try {
				const maxTokens = this.configurationService.getValue<number>(OPENIDE_AUTOCOMPLETE_MAX_TOKENS);
				const target = this.configurationService.getValue<string>(OPENIDE_AUTOCOMPLETE_MODEL);
				const raw = await this.agentService.completeText({
					system: built.system,
					prompt: built.prompt,
					maxTokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : COMPLETION_MAX_TOKENS,
					target: typeof target === 'string' && target.trim() ? target.trim() : undefined,
				}, token);
				if (token.isCancellationRequested) {
					return undefined;
				}
				completion = postprocessCompletion(raw, built);
				this.logService.info(`[openide-autocomplete] ${path}: ${raw.length} chars back, ${completion ? completion.split('\n').length + ' line(s) shown' : 'nothing usable'}`);
				if (completion) {
					this.remember(uri, built.prefix, completion);
				}
			} catch (error) {
				if (isCancellationError(error) || token.isCancellationRequested) {
					return undefined; // the next keystroke cancelled this one: routine, not a failure
				}
				const message = error instanceof Error ? error.message : String(error);
				if (/\b429\b|too many requests|rate.?limit/i.test(message)) {
					// Continue has no answer to this either; a pause is the one that keeps the
					// provider from escalating the limit. The status bar says so.
					this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
					this.logService.info(`[openide-autocomplete] rate-limited by the provider; automatic completions paused for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
					return undefined;
				}
				// A provider that is down or a key that expired must not turn every keystroke into
				// an error toast: the ghost text simply does not appear, and the log says why.
				this.logService.warn('[openide-autocomplete] request failed', error);
				return undefined;
			} finally {
				this.inFlight--;
				this.renderStatus();
			}
		}
		if (!completion) {
			return undefined;
		}
		return {
			items: [{
				insertText: completion,
				range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
				completeBracketPairs: true,
			}],
			enableForwardStability: true,
		};
	}

	disposeInlineCompletions(): void {
		// Nothing to release: the items own no resources.
	}

	private pathOf(model: ITextModel): string {
		const folder = this.contextService.getWorkspaceFolder(model.uri);
		return (folder && relativePath(folder.uri, model.uri)) || model.uri.path;
	}

	/**
	 * Continue's cache lookup: the exact prefix, or the LONGEST remembered prefix the current one
	 * extends whose completion the user has been typing out — the remainder is still valid.
	 */
	private lookup(uri: string, prefix: string): string | undefined {
		const exact = this.cache.get(`${uri}\0${prefix}`);
		if (exact !== undefined) {
			return exact;
		}
		let best: { length: number; remainder: string } | undefined;
		for (const [key, cached] of this.cache) {
			if (!key.startsWith(`${uri}\0`)) {
				continue;
			}
			const cachedPrefix = key.slice(uri.length + 1);
			const remainder = reuseCompletion(cachedPrefix, cached, prefix);
			if (remainder !== undefined && (!best || cachedPrefix.length > best.length)) {
				best = { length: cachedPrefix.length, remainder };
			}
		}
		return best?.remainder;
	}

	private remember(uri: string, prefix: string, completion: string): void {
		const key = `${uri}\0${prefix}`;
		this.cache.delete(key);
		this.cache.set(key, completion);
		while (this.cache.size > CACHE_LIMIT) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.cache.delete(oldest);
		}
	}

	/**
	 * The status bar entry: whether the autocomplete is on, and a spinner while a request is in
	 * flight. Continue's `$(check) Continue` / `$(circle-slash) Continue`; clicking toggles.
	 */
	private renderStatus(): void {
		const enabled = this.enabled;
		const busy = enabled && this.inFlight > 0;
		const limited = enabled && !busy && Date.now() < this.cooldownUntil;
		const entry: IStatusbarEntry = {
			name: t('autocomplete.name'),
			text: busy ? '$(loading~spin) IA' : limited ? '$(warning) IA' : enabled ? '$(sparkle) IA' : '$(circle-slash) IA',
			ariaLabel: enabled ? t('autocomplete.on') : t('autocomplete.off'),
			tooltip: limited
				? t('autocomplete.tooltipLimited')
				: enabled
					? t('autocomplete.tooltipOn')
					: t('autocomplete.tooltipOff'),
			command: OPENIDE_AUTOCOMPLETE_TOGGLE_COMMAND,
		};
		if (this.status.value) {
			this.status.value.update(entry);
		} else {
			this.status.value = this.statusbarService.addEntry(entry, 'openide.autocomplete.status', StatusbarAlignment.RIGHT, 100.5);
		}
	}
}

registerEditorFeature(OpenideAutocompleteFeature);
