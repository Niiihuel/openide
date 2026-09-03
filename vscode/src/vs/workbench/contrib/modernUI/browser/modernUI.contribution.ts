/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { setGlobalDefaultScrollbarSize } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { COMPACT_NOTIFICATION_ROW_HEIGHT, setNotificationRowHeight } from '../../../browser/parts/notifications/notificationsViewer.js';
import { setGlobalPaneHeaderSize } from '../../../../base/browser/ui/splitview/paneview.js';

// Bundle the CSS for every Modern UI module. Every rule is written behind a
// `.modern-ui*` class; this contribution is what puts those classes on.
import './media/activityBar.css';
import './media/commandCenter.css';
import './media/controlMetrics.css';
import './media/editorBorder.css';
// `fontRamp.css` is deliberately NOT imported. It hardcodes type sizes on pane headers, title
// labels, aux-bar labels, tab labels and badges, and its `.modern-ui.monaco-workbench` selectors
// (0,2,0) beat the fork's own `.monaco-workbench` ones (0,1,0) whatever the import order — so the
// font-size settings this fork ships (`base/common/font.ts`, read by 57 files) would keep being
// written and silently stop having any effect on those surfaces. Two type systems fighting, with
// the user's one losing without a word. The file stays vendored so a future rebase still diffs
// cleanly against upstream; if the scaling system ever goes away, re-adding the import is enough.
import './media/keyboardFocusOnly.css';
import './media/notificationsDialogs.css';
import './media/padding.css';
import './media/paneHeaders.css';
import './media/roundedCorners.css';
import './media/sashHandles.css';
import './media/shadows.css';
import './media/statusBar.css';
import './media/tabs.css';
import './media/titlebar.css';
import '../../../services/themes/browser/modernTabColorCustomizations.js';

/** Scrollbar thickness (px) applied by Modern UI. Matches the editor's own default (see
 *  `editorOptions.ts`) so a pane and the editor beside it do not disagree, and matches Settings.
 *  See media/roundedCorners.css for the reasoning and for the shape. */
const MODERN_UI_SCROLLBAR_SIZE = 10;

/** Increased pane header size (px) applied by Modern UI. */
const MODERN_UI_PANE_HEADER_SIZE = 28;

const MODERN_UI_CLASS = 'modern-ui';
const MODERN_UI_TABS_CLASS = 'modern-ui-tabs';
const MODERN_UI_NOTIFICATIONS_DIALOGS_CLASS = 'modern-ui-notifications-dialogs';

/**
 * Modern UI, ported from upstream 1.135 and made unconditional.
 *
 * Upstream ships this behind `workbench.experimental.modernUI` and toggles the classes on and off
 * as the setting changes. OpenIDE has no such experiment: this IS the product's look, so the
 * classes go on once and stay on, and the setting, its listener and the "turn it back off" paths
 * are gone. What survives is the CLASS GATING itself, deliberately: the ~2.800 lines of CSS under
 * `media/` are upstream's, byte for byte, and keeping the `.modern-ui*` prefixes means the next
 * rebase against upstream is a copy rather than a 300-selector manual merge. The always-on
 * decision costs about ten lines here — in fork code, where divergence is cheap — instead of
 * being smeared across every stylesheet.
 *
 * Upstream's `modern-ui-uppercase-view-headers` module stays OFF: it is a separate opt-in there
 * too, and uppercasing every view header is a visible change nobody asked for.
 */
export class ModernUIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.modernUI';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super();

		// Global metrics first: `paneHeaders` changes layout, so it has to be in place before the
		// parts measure themselves.
		setGlobalPaneHeaderSize(MODERN_UI_PANE_HEADER_SIZE);
		setGlobalDefaultScrollbarSize(MODERN_UI_SCROLLBAR_SIZE);
		setNotificationRowHeight(COMPACT_NOTIFICATION_ROW_HEIGHT);

		for (const container of this.layoutService.containers) {
			this.applyTo(container);
		}

		// Auxiliary windows open after startup and get their own container.
		this._register(this.layoutService.onDidAddContainer(({ container }) => this.applyTo(container)));
	}

	private applyTo(container: HTMLElement): void {
		container.classList.add(MODERN_UI_CLASS);
		container.classList.add(MODERN_UI_TABS_CLASS);
		container.classList.add(MODERN_UI_NOTIFICATIONS_DIALOGS_CLASS);
	}
}

registerWorkbenchContribution2(ModernUIContribution.ID, ModernUIContribution, WorkbenchPhase.BlockRestore);
