/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { AnchorAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IOpenideCliDefinition, OPENIDE_CLI_CATALOG, OpenideCliId } from '../../common/openideAgentCliCatalog.js';
import { t } from '../../common/openideStrings.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { createProviderIcon } from '../openideProviderIcons.js';
import { menuEmpty, menuRow, menuSection, menuSeparator, OpenideChatMenuPopover } from './openideChatMenuDom.js';

/**
 * "New session with…": the local harness plus every external agent the catalog knows, the
 * ones not on PATH greyed out with "not installed" — VS Code's session-type picker
 * (`sessionTargetPickerActionItem.ts` + `sessionTypeAvailability.ts`) in the dock's own menu
 * language. Availability is resolved once per picker life and refreshed on each open, so an
 * agent installed while the IDE runs shows up without a restart.
 */

export type OpenideChatSessionKindChoice = { readonly kind: 'native' } | { readonly kind: 'cli'; readonly cli: IOpenideCliDefinition };

export class OpenideCliAvailability {

	private readonly _cache = new Map<OpenideCliId, { path: string | undefined; at: number }>();
	private static readonly TTL = 60_000;

	constructor(private readonly agentService: IOpenideAgentService) { }

	cached(id: OpenideCliId): string | undefined | null {
		const entry = this._cache.get(id);
		return entry ? entry.path : null;
	}

	async resolve(cli: IOpenideCliDefinition): Promise<string | undefined> {
		return (await this.resolveAll()).get(cli.id);
	}

	/**
	 * Probes the whole catalogue in ONE shell command, and coalesces concurrent callers.
	 *
	 * The previous shape asked for each agent separately and in parallel, which sent seven
	 * commands into the single shared agent terminal at once; their output interleaved and most
	 * probes read somebody else's answer, so installed CLIs were reported missing.
	 */
	async resolveAll(): Promise<Map<OpenideCliId, string | undefined>> {
		const fresh = OPENIDE_CLI_CATALOG.every(cli => {
			const entry = this._cache.get(cli.id);
			return entry && Date.now() - entry.at < OpenideCliAvailability.TTL;
		});
		if (fresh) {
			return new Map(OPENIDE_CLI_CATALOG.map(cli => [cli.id, this._cache.get(cli.id)!.path]));
		}
		// Coalesced: opening the picker twice while the shell is still answering must not send a
		// second probe into the same terminal, which is the very race this replaced.
		this._inFlight ??= this.probe().finally(() => { this._inFlight = undefined; });
		return this._inFlight;
	}

	private _inFlight: Promise<Map<OpenideCliId, string | undefined>> | undefined;

	private async probe(): Promise<Map<OpenideCliId, string | undefined>> {
		const byBinary = await this.agentService.resolveExecutables(OPENIDE_CLI_CATALOG.map(cli => cli.binary)).catch(() => undefined);
		const at = Date.now();
		const result = new Map<OpenideCliId, string | undefined>();
		for (const cli of OPENIDE_CLI_CATALOG) {
			const path = byBinary?.get(cli.binary);
			this._cache.set(cli.id, { path, at });
			result.set(cli.id, path);
		}
		return result;
	}
}

export class OpenideChatSessionKindPicker extends OpenideChatMenuPopover {

	constructor(
		contextViewService: IContextViewService,
		private readonly availability: OpenideCliAvailability,
		private readonly choose: (choice: OpenideChatSessionKindChoice) => void,
		alignment: AnchorAlignment = AnchorAlignment.RIGHT,
		position: AnchorPosition = AnchorPosition.BELOW,
	) {
		super(contextViewService, {
			menuClass: 'openide-chat-kind-menu',
			insetLeft: 0,
			insetRight: 0,
			alignment,
			stretchToAnchor: false,
			anchorTo: 'trigger',
			position,
		});
	}

	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		append(content, menuSection(t('sessions.newKind')));
		const local = menuRow('comment-discussion', t('sessions.kind.local'));
		append(local.row, $('span.openide-menu-hint', undefined, t('sessions.kind.localDesc')));
		store.add(addDisposableListener(local.row, 'click', event => {
			event.stopPropagation();
			this.close();
			this.choose({ kind: 'native' });
		}));
		append(content, local.row);

		// Only what is actually on PATH. The menu used to list the whole catalogue and grey out
		// what was missing, so a machine with two agents installed showed five dead rows — the
		// list described the catalogue, not the computer. The catalogue is still the source of
		// truth for HOW to launch and resume each agent; it just stopped being the menu.
		const host = append(content, $('div.openide-chat-kind-installed'));
		const paint = (paths: readonly (string | undefined)[]): void => {
			if (store.isDisposed) { return; }
			clearNode(host);
			const installed = OPENIDE_CLI_CATALOG
				.map((cli, index) => ({ cli, path: paths[index] }))
				.filter((entry): entry is { cli: IOpenideCliDefinition; path: string } => !!entry.path);
			if (!installed.length) {
				append(host, menuSeparator());
				append(host, menuEmpty(t('sessions.kind.noneInstalled')));
				this.relayout();
				return;
			}
			append(host, menuSeparator());
			for (const { cli, path } of installed) {
				// The agent's own mark, not a terminal glyph: identical codicons told the reader
				// nothing about which agent a row launches.
				const { row } = menuRow(createProviderIcon(host.ownerDocument, cli.icon, cli.name), cli.name);
				append(row, $('span.openide-menu-hint', undefined, t('sessions.kind.terminal')));
				row.title = path;
				store.add(addDisposableListener(row, 'click', event => {
					event.stopPropagation();
					this.close();
					this.choose({ kind: 'cli', cli });
				}));
				append(host, row);
			}
			// The row count is only known after the probe, so the popover has to be re-anchored.
			this.relayout();
		};

		const cached = OPENIDE_CLI_CATALOG.map(cli => this.availability.cached(cli.id));
		if (cached.every(entry => entry !== null)) {
			paint(cached as readonly (string | undefined)[]);
		} else {
			append(host, menuEmpty(t('sessions.kind.checking')));
		}
		// Re-probed on every open: an agent installed while the IDE runs shows up without a restart.
		void this.availability.resolveAll().then(byId => paint(OPENIDE_CLI_CATALOG.map(cli => byId.get(cli.id))));
	}
}
