/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the Agent Changes view: what each hosted CLI touched, one section per conversation.
 *
 *  Source Control already answers "what is different from HEAD". This answers a question it
 *  cannot: WHO changed it, and in WHICH conversation. A CLI writes with its own tools and reports
 *  nothing, so the grouping comes from the turn boundaries the dock already derives, and the file
 *  list from git (see openideCliChangesService).
 *
 *  ── One section per conversation ───────────────────────────────────────────────────────────
 *  A section is a SESSION, not a turn. VS Code splits it the same way: its panel reads
 *  `getDiffsForFilesInSession` while the per-turn list feeds a summary inline in the transcript.
 *  For a hosted CLI that inline view already exists — the agent's own TUI prints its diff as it
 *  works — so grouping by turn here only broke apart the one thing the panel is for.
 *
 *  ── One row, one review, shared with the chat ─────────────────────────────────────────────
 *  A file row is `OpenideChatFileRow`, the same primitive the transcript's edit card and the
 *  dock's tray paint, with the same ±N — counted by `buildDiffPreview`, the same engine. A click
 *  opens the change the way the harness opens its own: the file in the editor with the blocks
 *  painted and Undo/Keep (`OpenideEditReview`), seeded with this session's baseline. This view
 *  used to draw its own row and send the reader to a side-by-side diff editor, so a change
 *  looked one way in the chat and another way here. The diff lives in the editor, only there.
 *
 *  The container opts into the user's file icon theme the way the Explorer does — the row's
 *  icon comes through `getIconClasses` — and the status letter sits on the right, where Source
 *  Control puts it. The agent's mark is the one the dock paints for that provider.
 *
 *  ── Saying only what we know ───────────────────────────────────────────────────────────────
 *  The list is "what changed while the agent was working", the user's own edits in those windows
 *  included. A session whose turn boundaries came from the output heuristic rather than the CLI's
 *  own hooks is marked `aprox.`. Presenting an approximate list with the confidence of an exact
 *  one is the single way this view could mislead somebody reviewing a change.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { createFileIconThemableTreeContainerScope } from '../../files/browser/views/explorerView.js';
import { IOpenideCliChangedFile, IOpenideCliChangesService, IOpenideCliChangesSession, OpenideCliChangesService } from './openideCliChangesService.js';
import { getOpenideCli } from '../common/openideAgentCliCatalog.js';
import { applyProviderIcon } from './openideProviderIcons.js';
import { t } from '../common/openideStrings.js';
import { OpenideChatFileRow } from './chat/parts/openideChatFileRow.js';
import './media/openideCliChanges.css';

export const OPENIDE_CLI_CHANGES_VIEW_ID = 'workbench.view.openideCliChanges';

/** What each state is called, and what its tooltip explains. */
const ACTIVITY_LABEL = {
	working: 'cliChanges.state.working',
	typing: 'cliChanges.state.typing',
	waiting: 'cliChanges.state.waiting',
	done: 'cliChanges.state.done',
	failed: 'cliChanges.state.failed',
} as const;

const ACTIVITY_TITLE = {
	working: 'cliChanges.state.workingTitle',
	typing: 'cliChanges.state.typingTitle',
	waiting: 'cliChanges.state.waitingTitle',
	done: 'cliChanges.state.doneTitle',
	failed: 'cliChanges.state.failedTitle',
} as const;

export class OpenideCliChangesView extends ViewPane {

	/** `body` belongs to ViewPane, so ours carries its own name. */
	private root: HTMLElement | undefined;
	private readonly renderStore = this._register(new DisposableStore());
	/** Sections the user collapsed. Collapsing is a choice, so it survives a repaint. */
	private readonly collapsed = new Set<string>();

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IOpenideCliChangesService private readonly changes: OpenideCliChangesService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.changes.onDidChange(() => {
			// The welcome view is what stands in for an empty list, and it only re-evaluates
			// `shouldShowWelcome()` when told to: the first session has to take it off screen.
			this._onDidChangeViewWelcomeState.fire();
			this.paint();
		}));
	}

	/**
	 * Empty state = the workbench's own welcome view, the one Explorer, Source Control and Run &
	 * Debug show. It used to be a hand-rolled block in this file, which meant a second empty-state
	 * design to keep in step with the IDE's — and the pane hides its content for us while the
	 * welcome is up (`.pane-body.welcome > :not(.welcome-view)`, views.css).
	 */
	override shouldShowWelcome(): boolean {
		return !this.sessionsWithTurns().length;
	}

	/** A session with no turns yet has nothing to say; one that ran and changed nothing does. */
	private sessionsWithTurns(): readonly IOpenideCliChangesSession[] {
		return this.changes.sessions().filter(session => session.turnCount > 0);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.openide-cli-changes'));
		// Opts the container into the user's file icon theme, the way the Explorer does. Without
		// it `getIconClasses` resolves to nothing and every row shows a blank square.
		this._register(createFileIconThemableTreeContainerScope(this.root, this.themeService));
		// `renderBody` runs while the pane is still DETACHED — `Pane.render()` builds the element and
		// the split view inserts it afterwards — so this first paint hits the `isConnected` guard and
		// draws nothing. With no CLI session there is no `onDidChange` to follow it, so the view sat
		// permanently blank: not even the empty state, which is what it should show more than 90% of
		// the time. Painting on visibility is what upstream's views do anyway, and it also covers
		// coming back to the view after navigating away.
		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				this.paint();
			}
		}));
		this.paint();
	}

	private paint(): void {
		const body = this.root;
		// After navigating away the pane's content is cleared and our node is left disconnected:
		// painting it would be wasted work, and would hide a leak if it ever stopped being.
		if (!body?.isConnected) {
			return;
		}
		this.renderStore.clear();
		clearNode(body);

		// Nothing to draw when there is nothing: the welcome view has the pane at that point.
		const sessions = this.sessionsWithTurns();
		if (!sessions.length) {
			return;
		}
		for (const session of sessions) {
			this.paintSection(body, session);
		}
	}

	private paintSection(body: HTMLElement, session: IOpenideCliChangesSession): void {
		const cli = getOpenideCli(session.cliId);
		const isCollapsed = this.collapsed.has(session.sessionId);
		const section = append(body, $('.openide-cli-changes-section'));

		const header = append(section, $('.openide-cli-changes-header'));
		header.setAttribute('role', 'button');
		header.setAttribute('aria-expanded', String(!isCollapsed));
		const twistie = append(header, $('span.codicon.openide-cli-changes-twistie'));
		twistie.classList.add(isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down');

		const brand = append(header, $('span.openide-cli-changes-brand'));
		applyProviderIcon(brand, cli?.icon ?? session.cliId, cli?.name ?? '');

		const heading = append(header, $('.openide-cli-changes-heading'));
		append(heading, $('span.openide-cli-changes-agent')).textContent = cli?.name ?? session.cliId;
		const subtitle = append(heading, $('span.openide-cli-changes-subtitle'));
		subtitle.textContent = session.title;
		subtitle.title = `${session.title} · ${session.cwd}`;

		// ONE state chip, not a row of labels. The `aprox.` caveat moved into its tooltip: it is
		// real, but it was competing for attention with the state, and a header that shouts two
		// things at once ends up saying neither.
		const state = append(header, $('span.openide-cli-changes-state'));
		state.classList.add(`state-${session.activity}`);
		if (session.activity === 'working') {
			state.classList.add('openide-cli-changes-shimmer');
		}
		state.textContent = t(ACTIVITY_LABEL[session.activity]);
		state.title = session.hooked
			? t(ACTIVITY_TITLE[session.activity])
			: `${t(ACTIVITY_TITLE[session.activity])}\n\n${t('cliChanges.approxTitle')}`;
		if (session.files.length) {
			append(header, $('span.openide-cli-changes-count')).textContent = String(session.files.length);
		}
		this.renderStore.add(addDisposableListener(header, 'click', () => {
			if (isCollapsed) {
				this.collapsed.delete(session.sessionId);
			} else {
				this.collapsed.add(session.sessionId);
			}
			this.paint();
		}));

		if (isCollapsed) {
			return;
		}
		if (!session.files.length) {
			append(section, $('.openide-cli-changes-note')).textContent = session.working
				? t('cliChanges.pending')
				: t('cliChanges.noFiles');
			return;
		}
		for (const file of session.files) {
			this.paintFile(section, session, file);
		}
		if (session.truncated) {
			// Cutting silently would read as "the agent touched exactly these", which is the one
			// thing this view must never say when it is not true.
			const note = append(section, $('.openide-cli-changes-note.openide-cli-changes-warn'));
			note.textContent = t('cliChanges.truncated');
			note.title = t('cliChanges.truncatedTitle');
		}
	}

	private paintFile(section: HTMLElement, session: IOpenideCliChangesSession, file: IOpenideCliChangedFile): void {
		const open = () => void this.changes.openDiff(session.sessionId, file);
		const row = this.renderStore.add(this.instantiationService.createInstance(OpenideChatFileRow, {
			className: 'openide-cli-changes-row',
			onClick: open,
		}));
		append(section, row.domNode);
		row.setFile(file.path);
		row.setStats({ status: file.status });
		row.setActions([{ icon: 'go-to-file', tooltip: () => t('cliChanges.row.openEditor'), run: open }]);
		row.domNode.title = file.from ? t('cliChanges.renamedFrom', file.path, file.from) : file.path;
		if (!file.exact) {
			// The file was already sitting in the tree untracked when the conversation began, so
			// nothing records what it looked like: the diff will show all of it. Marked, because a
			// diff that shows everything looks like the agent rewrote everything.
			const warn = append(row.domNode, $('span.codicon.codicon-question.openide-cli-changes-nobase'));
			warn.title = t('cliChanges.noBaseline');
		}
		// The ±N, the way the tray's rows carry it. Counted lazily and cached by the service, so
		// a repaint of a long list does not re-read every file.
		void this.changes.preview(session.sessionId, file).then(preview => {
			if (preview && row.domNode.isConnected) {
				row.setStats({ added: preview.added, removed: preview.removed, created: preview.created, status: file.status });
			}
		});
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.root) {
			this.root.style.height = `${height}px`;
		}
	}
}
