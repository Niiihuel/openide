/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the account-usage monitor, transcribed from Orca's rate-limit service
 *  in its main process. Orca keeps ONE coordinator that owns the
 *  snapshot for every account, polls in the background, refetches on window focus (debounced),
 *  ingests live windows on every agent turn, backs off exponentially on failures and lets the
 *  user's click bypass the throttle. The status bar and the popover only subscribe. Here the
 *  per-provider HTTP lives in `IOpenideUsageService`; this class is the scheduler and the state.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { IProviderRateLimits, mergeUsageAccountsByIdentity, usageStatusOf } from '../common/openideUsage.js';
import {
	clampUsagePollMs,
	clampUsedPercent,
	formatUsageDuration,
	isUsageRefreshDue,
	tightestUsageWindow,
	USAGE_AFTER_TURN_DELAY_MS,
	USAGE_DEFAULT_POLL_MS,
	USAGE_MIN_REFETCH_MS,
	USAGE_VISIBLE_POLL_MS,
	usageFailureDelayMs,
	usageStaleness,
	UsageStaleness, usageWindowTitle } from '../common/openideUsageSchedule.js';
import { isCliUsageAccountId } from '../common/openideCliUsageAuth.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { IOpenideCliUsageSource } from './openideCliUsage.js';

export const IOpenideUsageMonitor = createDecorator<IOpenideUsageMonitor>('openideUsageMonitor');

export type UsageRefreshReason = 'manual' | 'poll' | 'focus' | 'turn' | 'accounts' | 'open';

export interface IOpenideUsageAccount {
	readonly entry: IProviderEntry;
	/** Last answer, kept while it is not expired (Orca shows stale data dimmed before dropping it). */
	readonly usage: IProviderRateLimits | undefined;
	readonly staleness: UsageStaleness;
	readonly fetching: boolean;
	/** Consecutive failures, drives the backoff lane. */
	readonly failureStreak: number;
	/**
	 * Labels of the other rows folded into this one because the credential says they are the same
	 * subscription (the in-app ChatGPT account and the Codex CLI's, typically). Empty for a row
	 * that stands alone, which is every row whose credential carries no identity claim.
	 */
	readonly alsoFrom: readonly string[];
}

export interface IOpenideUsageSnapshot {
	readonly accounts: readonly IOpenideUsageAccount[];
	/** Epoch ms of the last completed cycle, 0 when nothing was fetched yet. */
	readonly updatedAt: number;
	readonly fetching: boolean;
	readonly enabled: boolean;
}

/** What the status bar shows for the active account. */
export interface IOpenideUsageStatusSummary {
	readonly providerId: string;
	readonly text: string;
	readonly tooltip: string;
	readonly percent: number | undefined;
}

export interface IOpenideUsageMonitor {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<IOpenideUsageSnapshot>;
	getSnapshot(): IOpenideUsageSnapshot;
	/** Status-bar line for `providerId`, or the first account with data when that one has none. */
	getStatusSummary(providerId: string): IOpenideUsageStatusSummary | undefined;
	/** Runs a cycle. `manual` bypasses the throttle (Orca: the click must never no-op). */
	refresh(reason: UsageRefreshReason): Promise<void>;
	/** A turn ended on `providerId`: the provider counted it, so the windows moved. */
	notifyTurnFinished(providerId: string | undefined): void;
	/** The popover is open: switch to the live cadence while it is. Returns the release. */
	holdVisible(): { dispose(): void };
}

interface IAccountState {
	entry: IProviderEntry;
	usage: IProviderRateLimits | undefined;
	fetching: boolean;
	failureStreak: number;
	lastFetchAt: number;
}

export class OpenideUsageMonitor extends Disposable implements IOpenideUsageMonitor {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<IOpenideUsageSnapshot>());
	readonly onDidChange = this._onDidChange.event;

	private readonly states = new Map<string, IAccountState>();
	private updatedAt = 0;
	private cycle: Promise<void> | undefined;
	private queued: UsageRefreshReason | undefined;
	private visibleHolds = 0;
	private lastFocusRefreshAt = 0;
	private readonly timer = this._register(new MutableDisposable());
	private readonly turnTimer = this._register(new MutableDisposable());

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IHostService hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOpenideCliUsageSource private readonly cliUsage: IOpenideCliUsageSource,
	) {
		super();
		// Orca: `mainWindow.on('focus', refreshOnResume)`, throttled by MIN_REFETCH_MS so one
		// outage does not turn alt-tabbing into a tight retry loop.
		this._register(hostService.onDidChangeFocus(focused => {
			if (!focused || Date.now() - this.lastFocusRefreshAt < USAGE_MIN_REFETCH_MS) { return; }
			this.lastFocusRefreshAt = Date.now();
			void this.refresh('focus');
		}));
		// Accounts connected/disconnected or config changed: Orca clears the retry schedule and
		// refetches, because a new account starts clean.
		this._register(this.agentService.onDidChange(() => void this.refresh('accounts')));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openide.agent.usage')) { this.states.clear(); void this.refresh('accounts'); }
		}));
		this.schedule();
		void this.refresh('poll');
	}

	private get enabled(): boolean {
		return this.configurationService.getValue<boolean>('openide.agent.usage.enabled') !== false;
	}

	/** Reading the CLIs' credential stores is opt-out: some people would call it snooping. */
	private get cliAccountsEnabled(): boolean {
		return this.configurationService.getValue<boolean>('openide.agent.usage.cliAccounts') !== false;
	}

	private get pollMs(): number {
		const minutes = Number(this.configurationService.getValue('openide.agent.usage.pollMinutes'));
		// 0 used to mean "never": now it falls back to Orca's default cadence — usage without
		// refresh is a lie after the first turn.
		return clampUsagePollMs(Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : USAGE_DEFAULT_POLL_MS);
	}

	getSnapshot(): IOpenideUsageSnapshot {
		const now = Date.now();
		const rows = [...this.states.values()].map(state => {
			const staleness = usageStaleness(state.usage, now);
			return {
				id: state.entry.id,
				label: state.entry.label,
				entry: state.entry,
				usage: staleness === 'expired' ? undefined : state.usage,
				staleness,
				fetching: state.fetching,
				failureStreak: state.failureStreak,
			};
		});
		// One row per SUBSCRIPTION, not per integration: the same ChatGPT account arrives both as
		// the provider connected in OpenIDE and as the Codex CLI's credential file, and two rows
		// would show the same quota twice as if the user had two of them.
		const accounts = mergeUsageAccountsByIdentity(rows, isCliUsageAccountId)
			.map(({ account, alsoFrom }) => ({
				entry: account.entry,
				usage: account.usage,
				staleness: account.staleness,
				fetching: account.fetching,
				failureStreak: account.failureStreak,
				alsoFrom,
			} satisfies IOpenideUsageAccount))
			// Tightest first, like the old popover; accounts without data at the end.
			.sort((a, b) => (clampUsedPercent(tightestUsageWindow(b.usage)?.usedPercent) ?? -1) - (clampUsedPercent(tightestUsageWindow(a.usage)?.usedPercent) ?? -1));
		return { accounts, updatedAt: this.updatedAt, fetching: !!this.cycle, enabled: this.enabled };
	}

	getStatusSummary(providerId: string): IOpenideUsageStatusSummary | undefined {
		const snapshot = this.getSnapshot();
		const account = snapshot.accounts.find(candidate => candidate.entry.id === providerId && tightestUsageWindow(candidate.usage))
			?? snapshot.accounts.find(candidate => tightestUsageWindow(candidate.usage));
		const window = tightestUsageWindow(account?.usage);
		const percent = clampUsedPercent(window?.usedPercent);
		if (!account || !window || percent === undefined) {
			return undefined;
		}
		const reset = window.resetsAt != null ? formatUsageDuration(window.resetsAt - Date.now()) : '';
		const credits = account.usage?.credits;
		const balance = credits?.remaining != null ? `$${credits.remaining.toFixed(2)}` : '';
		// The status bar shows the percentage only; everything else lives in the tooltip (and in the
		// popover), so the item stays as narrow as the brand mark next to it.
		const lines = [
			`${account.entry.label}${account.usage?.plan ? ` · ${account.usage.plan}` : ''}`,
			`${usageWindowTitle(window)}: ${percent}% usado${reset ? ` · se reinicia en ${reset}` : ''}`,
		];
		if (balance) { lines.push(`Saldo: ${balance}`); }
		if (account.staleness === 'stale') { lines.push('Datos viejos; se actualizan en el próximo ciclo.'); }
		return {
			providerId: account.entry.id,
			percent,
			text: `${percent}%`,
			tooltip: lines.join('\n'),
		};
	}

	notifyTurnFinished(providerId: string | undefined): void {
		// Orca ingests the statusline on every turn; without a live feed we refetch shortly after
		// the turn, once, so a burst of quick turns does not hammer the billing endpoint.
		if (!providerId || !this.enabled) { return; }
		this.turnTimer.value = toDisposable(() => { /* replaced */ });
		const handle = setTimeout(() => void this.refresh('turn'), USAGE_AFTER_TURN_DELAY_MS);
		this.turnTimer.value = toDisposable(() => clearTimeout(handle));
	}

	holdVisible(): { dispose(): void } {
		this.visibleHolds++;
		this.schedule();
		void this.refresh('open');
		let released = false;
		return {
			dispose: () => {
				if (released) { return; }
				released = true;
				this.visibleHolds = Math.max(0, this.visibleHolds - 1);
				this.schedule();
			},
		};
	}

	async refresh(reason: UsageRefreshReason): Promise<void> {
		if (this.cycle) {
			// Orca queues one full fetch behind the in-flight one instead of racing two.
			this.queued = reason === 'manual' ? 'manual' : this.queued ?? reason;
			return this.cycle;
		}
		this.cycle = this.runCycle(reason).finally(() => {
			this.cycle = undefined;
			const next = this.queued;
			this.queued = undefined;
			if (next) { void this.refresh(next); }
		});
		return this.cycle;
	}

	private async runCycle(reason: UsageRefreshReason): Promise<void> {
		if (!this.enabled) {
			if (this.states.size) { this.states.clear(); this.fire(); }
			return;
		}
		const providers = this.agentService.listProviders().filter(entry => entry.auth === 'oauth' || entry.id === 'openrouter');
		const connected = (await Promise.all(providers.map(async entry => {
			try { return (await this.agentService.isConnected(entry.id)) ? entry : undefined; } catch { return undefined; }
		}))).filter((entry): entry is IProviderEntry => !!entry);
		// Orca's roster is wider than the in-app accounts: every agent CLI signed in on this
		// machine (Claude Code, Codex, Gemini CLI, Grok) is an account too, read from its own
		// credential store. Same cycle, same backoff; only the fetch routes differently.
		if (this.cliAccountsEnabled) {
			try { connected.push(...await this.cliUsage.listAccounts()); } catch { /* sin CLIs legibles */ }
		}
		for (const id of [...this.states.keys()]) {
			if (!connected.some(entry => entry.id === id)) { this.states.delete(id); }
		}
		const force = reason === 'manual' || reason === 'turn' || reason === 'accounts';
		const visible = this.visibleHolds > 0;
		const now = Date.now();
		const due = connected.filter(entry => {
			const state = this.states.get(entry.id);
			if (!state) { return true; }
			return isUsageRefreshDue({ lastFetchAt: state.lastFetchAt, failureStreak: state.failureStreak, retryAt: state.usage?.retryAt, pollMs: this.pollMs, visible, force, now });
		});
		for (const entry of due) {
			const state = this.states.get(entry.id) ?? { entry, usage: undefined, fetching: false, failureStreak: 0, lastFetchAt: 0 };
			state.entry = entry;
			state.fetching = true;
			this.states.set(entry.id, state);
		}
		for (const entry of connected) {
			if (!this.states.has(entry.id)) { this.states.set(entry.id, { entry, usage: undefined, fetching: false, failureStreak: 0, lastFetchAt: 0 }); }
		}
		if (due.length) { this.fire(); }
		await Promise.all(due.map(async entry => {
			const state = this.states.get(entry.id)!;
			let usage: IProviderRateLimits | undefined;
			try {
				usage = isCliUsageAccountId(entry.id)
					? await this.cliUsage.getUsage(entry.id, force)
					: await this.agentService.getProviderUsage(entry.id, force);
			} catch {
				usage = { providerId: entry.id, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'unknown', error: 'La consulta de uso falló.' };
			}
			state.fetching = false;
			state.lastFetchAt = Date.now();
			if (!usage) {
				// Disconnected meanwhile, or usage disabled: drop the row.
				this.states.delete(entry.id);
				return;
			}
			const status = usageStatusOf(usage);
			// Orca: any success OR "unavailable" resets the streak — retrying an endpoint that does
			// not exist is not a failure lane, it is noise.
			if (status === 'error') {
				state.failureStreak++;
				// Keep the last good snapshot while it is not expired (stale beats blank), but
				// remember the failure so the popover can say both.
				state.usage = state.usage && usageStatusOf(state.usage) === 'ok' && usageStaleness(state.usage) !== 'expired'
					? { ...state.usage, retryAt: usage.retryAt ?? null, error: usage.error, failureKind: usage.failureKind }
					: usage;
			} else {
				state.failureStreak = 0;
				state.usage = usage;
			}
		}));
		this.updatedAt = Date.now();
		this.fire();
		this.schedule();
	}

	private fire(): void {
		this._onDidChange.fire(this.getSnapshot());
	}

	/**
	 * One timer, re-armed after every cycle: the live cadence while something is looking, the
	 * failure backoff when an account is failing, the background poll otherwise.
	 */
	private schedule(): void {
		let delay = this.visibleHolds > 0 ? USAGE_VISIBLE_POLL_MS : this.pollMs;
		for (const state of this.states.values()) {
			if (state.failureStreak > 0) {
				delay = Math.min(delay, usageFailureDelayMs(state.failureStreak));
			}
		}
		const handle = setTimeout(() => void this.refresh('poll'), delay);
		this.timer.value = toDisposable(() => clearTimeout(handle));
	}
}

registerSingleton(IOpenideUsageMonitor, OpenideUsageMonitor, InstantiationType.Delayed);
