#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Generates the OpenIDE Bootstrap product icon theme from the webfont's own codepoint table.
 *
 *  Strict on both sides: every codicon id must exist in the codicon library (a typo would
 *  otherwise produce a mapping the workbench silently ignores), and every Bootstrap glyph must
 *  exist in `bootstrap-icons.json` (a typo would otherwise produce an empty box). Ids with no
 *  honest equivalent are left out ON PURPOSE — they fall back to the stock codicon.
 *
 *  Usage, from the repo root:
 *      node dev/gen-bootstrap-icons.mjs
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VSCODE = join(REPO, 'vscode');
const PRODUCTICONS = join(VSCODE, 'extensions/theme-defaults/producticons');
const THEME = join(PRODUCTICONS, 'openide-bootstrap-product-icon-theme.json');

const points = JSON.parse(readFileSync(join(REPO, 'dev/bootstrap-icons.codepoints.json'), 'utf8'));

/**
 * Every id the workbench can theme. Two sources, because they are two different registries and
 * the previous generator only knew about the first one — which is why the Search view kept the
 * stock glyph while its neighbours were themed: its default is `Codicon.searchLarge`, and
 * `search-large` had simply never been mapped.
 *
 *   - `codiconsLibrary` in `src/vs/base/common/codiconsLibrary.ts`: the 675 base ids.
 *   - `registerIcon(...)` calls across the workbench: the derived ids (`search-view-icon`,
 *     `explorer-view-icon`, …). A product icon theme may override those too.
 */
function knownIconIds() {
	const ids = new Set();
	for (const file of ['src/vs/base/common/codiconsLibrary.ts', 'src/vs/base/common/codicons.ts']) {
		const source = readFileSync(join(VSCODE, file), 'utf8');
		for (const m of source.matchAll(/register\('([a-z0-9-]+)'/g)) { ids.add(m[1]); }
	}
	// The derived ids the workbench registers itself (`search-view-icon`, `explorer-view-icon`, …).
	// A product icon theme overrides those exactly like a base codicon, and forgetting them is how
	// the Search view kept the stock glyph while the rest of the activity bar was themed.
	const grep = execFileSync('grep', ['-rhoE', "registerIcon\\('[a-z0-9-]+'", join(VSCODE, 'src')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	for (const m of grep.matchAll(/registerIcon\('([a-z0-9-]+)'/g)) { ids.add(m[1]); }
	return ids;
}

/**
 * [codicon id, Bootstrap glyph]. Bootstrap ships outline and `-fill` variants in ONE font, so
 * unlike the Tabler theme this needs a single font id.
 *
 * The rule for choosing: same MEANING, not same drawing. Where Bootstrap has no honest match the
 * pair is simply absent and upstream's codicon shows through.
 *
 * OUTLINE vs FILL follows upstream, id by id, not by name: codicon draws `error`, `warning`,
 * `record` and the live breakpoints as SOLID shapes even though nothing in the id says so, and
 * draws the 25 explicit `*-filled` / `*-full` ids as the solid twin of an outline sibling. Both
 * kinds map to Bootstrap's `-fill` variant, which lives in the SAME font — so unlike the Tabler
 * theme this needs one `fonts` entry, exactly like upstream's own codicon/codicon-filled split is
 * invisible to the theme. Filling everything would bring back the heavy look; outlining
 * everything would make a breakpoint or a `circle-filled` unreadable.
 */
const MAP = [
	// ---- chrome / primitives
	['chevron-down', 'chevron-down'], ['chevron-up', 'chevron-up'], ['chevron-left', 'chevron-left'], ['chevron-right', 'chevron-right'],
	['triangle-down', 'caret-down-fill'], ['triangle-up', 'caret-up-fill'], ['triangle-left', 'caret-left-fill'], ['triangle-right', 'caret-right-fill'],
	['close', 'x-lg'], ['chrome-close', 'x-lg'], ['close-all', 'x-lg'], ['close-dirty', 'circle-fill'],
	['search', 'search'], ['search-large', 'search'], ['search-fuzzy', 'search'], ['search-stop', 'search'],
	['gear', 'gear'], ['settings-gear', 'gear'], ['settings', 'sliders'], ['menu', 'list'], ['three-bars', 'list'],
	['ellipsis', 'three-dots'], ['more', 'three-dots'], ['kebab-vertical', 'three-dots-vertical'],
	['add', 'plus-lg'], ['plus', 'plus-lg'], ['remove', 'dash-lg'], ['dash', 'dash-lg'], ['check', 'check-lg'], ['check-all', 'check2-all'],
	['arrow-left', 'arrow-left'], ['arrow-right', 'arrow-right'], ['arrow-up', 'arrow-up'], ['arrow-down', 'arrow-down'],
	['arrow-small-left', 'chevron-left'], ['arrow-small-right', 'chevron-right'], ['arrow-small-up', 'chevron-up'], ['arrow-small-down', 'chevron-down'],
	['arrow-circle-left', 'arrow-left-circle'], ['arrow-circle-right', 'arrow-right-circle'], ['arrow-circle-up', 'arrow-up-circle'], ['arrow-circle-down', 'arrow-down-circle'],
	['arrow-both', 'arrows'], ['arrow-swap', 'arrow-left-right'], ['question', 'question-circle'],
	['grabber', 'grip-vertical'], ['gripper', 'grip-horizontal'], ['move', 'arrows-move'],
	['primitive-square', 'square'], ['primitive-dot', 'circle-fill'], ['circle-small', 'dot'], ['circle-small-filled', 'circle-fill'],
	['circle-large', 'circle'], ['circle-large-outline', 'circle'], ['circle-large-filled', 'circle-fill'],
	['circle-filled', 'circle-fill'], ['circle-outline', 'circle'], ['circle', 'circle'], ['circle-slash', 'slash-circle'], ['record', 'record-circle-fill'],
	['fold', 'chevron-bar-contract'], ['fold-up', 'chevron-bar-up'], ['fold-down', 'chevron-bar-down'], ['unfold', 'chevron-bar-expand'],
	['expand-all', 'chevron-double-down'], ['collapse-all', 'chevron-double-up'],
	['ungroup-by-ref-type', 'collection'], ['group-by-ref-type', 'collection-fill'],

	// ---- activity bar / views
	['files', 'files'], ['file-directory', 'folder'], ['source-control', 'git'], ['debug-alt', 'bug'], ['debug-alt-small', 'bug'], ['bug', 'bug'], ['extensions', 'box-seam'],
	['account', 'person-circle'], ['remote', 'hdd-network'], ['remote-explorer', 'hdd-rack'], ['home', 'house'], ['layers', 'layers'], ['layers-active', 'layers-fill'], ['layers-dot', 'layers-half'],
	['output', 'terminal'], ['terminal', 'terminal'], ['terminal-bash', 'terminal'], ['terminal-cmd', 'terminal'], ['terminal-powershell', 'terminal'],
	['terminal-tmux', 'terminal-split'], ['terminal-ubuntu', 'terminal'], ['terminal-debian', 'terminal'], ['terminal-linux', 'terminal'],
	['notebook', 'journal-code'], ['book', 'book'], ['bookmark', 'bookmark'], ['compass', 'compass'], ['map', 'map'], ['location', 'geo-alt'],
	['explorer-view-icon', 'files'], ['search-view-icon', 'search'], ['source-control-view-icon', 'git'], ['run-view-icon', 'bug'],
	['extensions-view-icon', 'box-seam'], ['ports-view-icon', 'plug'], ['debug-console-view-icon', 'terminal'], ['output-view-icon', 'terminal'],
	['settings-view-bar-icon', 'gear'], ['accounts-view-bar-icon', 'person-circle'], ['remote-explorer-view-icon', 'hdd-rack'],

	// ---- explorer / files
	['file', 'file-earmark'], ['symbol-file', 'file-earmark'], ['go-to-file', 'file-earmark-arrow-up'], ['new-file', 'file-earmark-plus'], ['file-add', 'file-earmark-plus'], ['new-folder', 'folder-plus'],
	['folder', 'folder'], ['folder-opened', 'folder2-open'], ['folder-active', 'folder2-open'], ['folder-library', 'folder-fill'], ['symbol-folder', 'folder'], ['root-folder', 'folder'], ['root-folder-opened', 'folder2-open'],
	['file-text', 'file-earmark-text'], ['file-code', 'file-earmark-code'], ['file-pdf', 'file-earmark-pdf'], ['file-media', 'file-earmark-image'], ['file-zip', 'file-earmark-zip'], ['file-binary', 'file-earmark-binary'],
	['file-submodule', 'folder-symlink'], ['file-symlink-file', 'file-earmark-arrow-up'], ['file-symlink-directory', 'folder-symlink'],
	['trash', 'trash'], ['trashcan', 'trash'], ['edit', 'pencil'], ['pencil', 'pencil'], ['copy', 'copy'], ['clippy', 'clipboard'], ['save', 'floppy'], ['save-all', 'floppy2'], ['save-as', 'floppy-fill'],
	['refresh', 'arrow-clockwise'], ['sync', 'arrow-repeat'], ['sync-ignored', 'arrow-repeat'], ['history', 'clock-history'], ['clock', 'clock'], ['watch', 'stopwatch'],
	['list-unordered', 'list-ul'], ['list-ordered', 'list-ol'], ['list-selection', 'list-check'], ['list-flat', 'list'], ['list-tree', 'diagram-2'], ['list-filter', 'funnel'],
	['checklist', 'list-check'], ['tasklist', 'list-task'], ['table', 'table'], ['discard', 'arrow-counterclockwise'], ['redo', 'arrow-clockwise'],
	['archive', 'archive'], ['package', 'box-seam'], ['inbox', 'inbox'], ['briefcase', 'briefcase'], ['tag', 'tag'], ['milestone', 'flag'],
	['filter', 'funnel'], ['filter-filled', 'funnel-fill'], ['sort-precedence', 'sort-down'],

	// ---- source control
	['git-commit', 'git'], ['git-merge', 'git'], ['git-pull-request', 'git'], ['git-pull-request-closed', 'git'], ['git-pull-request-draft', 'git'],
	['git-branch', 'git'], ['git-compare', 'file-diff'], ['git-fetch', 'cloud-arrow-down'], ['repo', 'journal-code'], ['repo-forked', 'diagram-2'], ['repo-clone', 'copy'],
	['repo-push', 'cloud-arrow-up'], ['repo-pull', 'cloud-arrow-down'], ['diff', 'file-diff'], ['diff-added', 'plus-square'], ['diff-removed', 'dash-square'], ['diff-modified', 'circle-fill'], ['diff-renamed', 'arrow-right-square'],
	['diff-ignored', 'slash-square'], ['diff-single', 'file-diff'], ['diff-multiple', 'files'],
	['cloud-upload', 'cloud-arrow-up'], ['cloud-download', 'cloud-arrow-down'], ['cloud', 'cloud'], ['github', 'github'], ['github-inverted', 'github'], ['github-alt', 'github'],
	['git-stash', 'archive'], ['git-stash-apply', 'archive'], ['git-stash-pop', 'archive-fill'], ['request-changes', 'git'],
	['desktop-download', 'download'], ['gist', 'file-earmark-code'], ['mirror', 'arrow-left-right'],

	// ---- run / debug / testing
	['play', 'play-fill'], ['run', 'play-fill'], ['run-all', 'play-fill'], ['play-circle', 'play-circle'], ['debug-start', 'play-fill'], ['debug-continue', 'play-fill'], ['debug-continue-small', 'play-fill'],
	['debug-stop', 'stop-fill'], ['stop-circle', 'stop-circle'], ['debug-pause', 'pause-fill'], ['debug-restart', 'arrow-clockwise'], ['debug-rerun', 'arrow-clockwise'], ['debug-disconnect', 'plug'],
	['debug-step-over', 'arrow-90deg-right'], ['debug-step-into', 'box-arrow-in-down'], ['debug-step-out', 'box-arrow-up'], ['debug-step-back', 'arrow-counterclockwise'],
	['debug-breakpoint', 'circle-fill'], ['debug-breakpoint-unverified', 'circle'], ['debug-breakpoint-disabled', 'circle-fill'], ['debug-console', 'terminal'], ['debug-line-by-line', 'list'],
	['debug', 'bug'], ['debug-coverage', 'shield-check'],
	['beaker', 'flask'], ['beaker-stop', 'flask'], ['pass', 'check-circle'], ['pass-filled', 'check-circle-fill'], ['run-errors', 'x-circle'],
	['testing-error-icon', 'x-circle-fill'], ['testing-passed-icon', 'check-circle-fill'], ['testing-failed-icon', 'x-circle-fill'], ['testing-skipped-icon', 'dash-circle-fill'], ['testing-queued-icon', 'clock'], ['testing-unset-icon', 'circle'],
	['coverage', 'shield-check'], ['run-above', 'skip-start'], ['run-below', 'skip-end'],

	// ---- layout / window
	['split-horizontal', 'layout-split'], ['split-vertical', 'layout-split'], ['layout', 'layout-wtf'], ['editor-layout', 'layout-wtf'],
	// Bootstrap has no `layout-sidebar-fill`, so the on/off distinction rides on the INSET pair:
	// the side column goes from an empty outline to a solid block, which reads as on/off the same
	// way a fill does. Mapping both halves of a pair to one glyph — which is what this line used
	// to do — is why the Primary Side Bar toggle never appeared to change.
	['layout-sidebar-left', 'layout-sidebar-inset'], ['layout-sidebar-left-off', 'layout-sidebar'],
	['layout-sidebar-right', 'layout-sidebar-inset-reverse'], ['layout-sidebar-right-off', 'layout-sidebar-reverse'],
	['layout-panel', 'layout-split'], ['layout-panel-off', 'layout-split'], ['layout-centered', 'layout-text-window'], ['layout-menubar', 'window'], ['layout-statusbar', 'window-dock'],
	['layout-activitybar-left', 'layout-sidebar'], ['layout-activitybar-right', 'layout-sidebar-reverse'],
	['layout-panel-left', 'layout-sidebar-inset'], ['layout-panel-right', 'layout-sidebar-inset-reverse'], ['layout-panel-center', 'layout-split'],
	['screen-full', 'arrows-fullscreen'], ['screen-normal', 'fullscreen-exit'], ['zoom-in', 'zoom-in'], ['zoom-out', 'zoom-out'],
	['chrome-maximize', 'square'], ['chrome-minimize', 'dash-lg'], ['chrome-restore', 'copy'],
	['pin', 'pin-angle'], ['pinned', 'pin-angle-fill'], ['pinned-dirty', 'pin-fill'],
	['open-preview', 'file-text'], ['preview', 'eye'], ['link-external', 'box-arrow-up-right'], ['window', 'window'], ['multiple-windows', 'window-stack'], ['browser', 'browser-chrome'], ['empty-window', 'window'],
	['device-desktop', 'display'], ['device-mobile', 'phone'], ['device-camera', 'camera'], ['device-camera-video', 'camera-video'], ['keyboard', 'keyboard'], ['record-keys', 'keyboard'],
	['vm', 'display'], ['vm-active', 'display'], ['vm-running', 'display'], ['vm-outline', 'display'], ['vm-connect', 'display'],
	['word-wrap', 'text-wrap'], ['whitespace', 'text-paragraph'], ['case-sensitive', 'type'], ['whole-word', 'type-bold'], ['text-size', 'fonts'],

	// ---- status / feedback
	['bell', 'bell'], ['bell-dot', 'bell-fill'], ['bell-slash', 'bell-slash'], ['bell-slash-dot', 'bell-slash-fill'],
	['error', 'x-circle-fill'], ['error-small', 'x-circle-fill'], ['warning', 'exclamation-triangle-fill'], ['alert', 'exclamation-triangle-fill'], ['report', 'flag-fill'],
	['info', 'info-circle-fill'], ['issues', 'record-circle'], ['issue-opened', 'record-circle'], ['issue-closed', 'check-circle'], ['issue-draft', 'record'], ['issue-reopened', 'record-circle'],
	['loading', 'arrow-repeat'], 
	['verified', 'patch-check'], ['verified-filled', 'patch-check-fill'], ['unverified', 'patch-question'],
	['shield', 'shield'], ['lock', 'lock'], ['lock-small', 'lock'], ['unlock', 'unlock'], ['key', 'key'],
	['workspace-trusted', 'shield-check'], ['workspace-untrusted', 'shield-x'], ['workspace-unknown', 'shield-exclamation'],
	['eye', 'eye'], ['eye-closed', 'eye-slash'], ['eye-watch', 'eye'],
	['thumbsup', 'hand-thumbs-up'], ['thumbsdown', 'hand-thumbs-down'], ['thumbsup-filled', 'hand-thumbs-up-fill'], ['thumbsdown-filled', 'hand-thumbs-down-fill'],
	['rocket', 'rocket-takeoff'], ['flame', 'fire'], ['pulse', 'activity'], ['graph', 'bar-chart'], ['graph-line', 'graph-up'], ['graph-scatter', 'graph-up'],
	['dashboard', 'speedometer2'], ['calendar', 'calendar'], ['telescope', 'binoculars'],
	['star-empty', 'star'], ['star-full', 'star-fill'], ['star-half', 'star-half'], ['heart', 'heart'], ['heart-filled', 'heart-fill'],
	['globe', 'globe'], ['database', 'database'], ['server', 'hdd-rack'], ['server-environment', 'hdd-rack'], ['server-process', 'cpu'],
	['plug', 'plug'], ['tools', 'tools'], ['wrench', 'wrench'], ['wrench-subaction', 'wrench-adjustable'],
	['export', 'box-arrow-up'], ['share', 'share'], ['mail', 'envelope'], ['mail-read', 'envelope-open'], ['megaphone', 'megaphone'], ['broadcast', 'broadcast'], ['rss', 'rss'], ['gift', 'gift'],
	['organization', 'people'], ['person', 'person'], ['person-filled', 'person-fill'], ['person-add', 'person-plus'], ['hubot', 'robot'], ['robot', 'robot'], ['copilot', 'stars'],
	['smiley', 'emoji-smile'], ['reactions', 'emoji-smile'], ['feedback', 'chat-square-dots'],

	// ---- editor / language
	['symbol-color', 'palette'], ['paintcan', 'paint-bucket'], ['color-mode', 'circle-half'],
	['sparkle', 'stars'], ['sparkle-filled', 'stars'], ['wand', 'magic'], ['zap', 'lightning-charge'], ['symbol-event', 'lightning-charge'],
	['lightbulb', 'lightbulb'], ['lightbulb-autofix', 'lightbulb'], ['lightbulb-sparkle', 'lightbulb-fill'], ['lightbulb-empty', 'lightbulb'],
	['code', 'code-slash'], ['code-oss', 'code-slash'], ['json', 'braces'], ['bracket', 'code-square'], ['bracket-dot', 'code-square'], ['bracket-error', 'code-square'],
	['markdown', 'markdown'], ['mention', 'at'], ['quote', 'quote'],
	['type-hierarchy', 'diagram-3'], ['type-hierarchy-sub', 'diagram-3'], ['type-hierarchy-super', 'diagram-3'],
	['symbol-string', 'type'], ['symbol-number', 'hash'], ['symbol-numeric', 'hash'], ['symbol-boolean', 'toggle-on'],
	['symbol-variable', 'braces-asterisk'], ['symbol-function', 'braces'], ['symbol-method', 'braces'],
	['symbol-class', 'box'], ['symbol-interface', 'bounding-box'], ['symbol-field', 'input-cursor'], ['symbol-property', 'wrench'],
	['symbol-constant', 'lock'], ['symbol-enum', 'list-ol'], ['symbol-enum-member', 'dot'], ['symbol-key', 'key'], ['symbol-keyword', 'key'],
	['symbol-array', 'list-ol'], ['symbol-namespace', 'braces'], ['symbol-module', 'box-seam'], ['symbol-package', 'box-seam'],
	['symbol-struct', 'box'], ['symbol-operator', 'plus-slash-minus'], ['symbol-parameter', 'braces-asterisk'], ['symbol-reference', 'link-45deg'],
	['symbol-snippet', 'code-square'], ['symbol-text', 'type'], ['symbol-unit', 'rulers'], ['symbol-value', 'braces-asterisk'],
	['symbol-misc', 'collection'], ['symbol-ruler', 'rulers'], ['symbol-constructor', 'braces'], ['symbol-null', 'slash-circle'],
	['bold', 'type-bold'], ['italic', 'type-italic'], ['link', 'link-45deg'], 
	['sign-out', 'box-arrow-right'], ['sign-in', 'box-arrow-in-right'], ['send', 'send'], ['reply', 'reply'],
	['comment', 'chat-square'], ['comment-discussion', 'chat-square'], ['comment-draft', 'chat-square'],
	['comment-unresolved', 'chat-square-dots'], ['comment-add', 'chat-square-dots'], ['clear-all', 'eraser'],
	['chat-sparkle', 'chat-square-heart'], ['chat-sparkle-error', 'chat-square'], ['chat-sparkle-warning', 'chat-square'],
	['unmute', 'volume-up'], ['mute', 'volume-mute'], ['mic', 'mic'], ['mic-filled', 'mic-fill'],
	['target', 'bullseye'], ['inspect', 'search'], ['references', 'link-45deg'], ['go-to-search', 'search'],
	['selection', 'bounding-box'], ['insert', 'box-arrow-in-right'],
	['radio-tower', 'broadcast-pin'], ['music', 'music-note-beamed'], ['mortar-board', 'mortarboard'], ['library', 'journals'], ['law', 'bank'],
	['combine', 'union'], ['gather', 'union'], ['ruby', 'gem'], ['cursor', 'cursor'],
	['record-small', 'circle-fill'], ['debug-hint', 'circle-fill'], ['blank', 'square'],

	// ---- aliases upstream registers next to the ones above (same drawing, different id)
	['gist-new', 'plus-lg'], ['repo-create', 'plus-lg'], ['light-bulb', 'lightbulb'], ['repo-delete', 'journal-x'],
	['gist-fork', 'diagram-2'], ['git-pull-request-abandoned', 'git'], ['git-pull-request-label', 'tag'],
	['tag-add', 'tag'], ['tag-remove', 'tag'], ['person-follow', 'person-plus'], ['person-outline', 'person'], ['person-filled', 'person-fill'],
	['star', 'star'], ['star-add', 'star'], ['star-delete', 'star'], ['search-save', 'search'],
	['log-out', 'box-arrow-right'], ['log-in', 'box-arrow-in-right'], ['eye-unwatch', 'eye-slash'],
	['x', 'x-lg'], ['remove-close', 'x-lg'], ['kebab-horizontal', 'three-dots'], ['mail-reply', 'reply'],
	['repo-sync', 'arrow-repeat'], ['clone', 'copy'], ['microscope', 'search'], ['logo-github', 'github'], ['mark-github', 'github'],
	['console', 'terminal'], ['repl', 'terminal'], ['stop', 'stop-fill'], ['organization-filled', 'people-fill'], ['organization-outline', 'people'],
	['file-directory-create', 'folder-plus'], ['mirror-public', 'arrow-left-right'], ['mirror-private', 'arrow-left-right'],
	['gist-private', 'file-earmark-lock'], ['gist-secret', 'file-earmark-lock'], ['git-fork-private', 'diagram-2'],
	['note', 'sticky'], ['versions', 'stack'], ['project', 'kanban'], ['credit-card', 'credit-card'], ['pie-chart', 'pie-chart'],
	['percentage', 'percent'], ['sort-percentage', 'percent'], ['magnet', 'magnet'], ['jersey', 'person-badge'],
	['horizontal-rule', 'dash-lg'], ['newline', 'arrow-return-left'], ['no-newline', 'arrow-return-left'], ['indent', 'text-indent-left'],
	['coffee', 'cup-hot'], ['snake', 'bug'], ['game', 'controller'], ['vr', 'badge-vr'], ['chip', 'cpu'], ['piano', 'music-note-list'],
	['twitter', 'twitter'], ['azure', 'cloud'], ['azure-devops', 'cloud'], ['github-action', 'github'], ['github-project', 'kanban'],
	['octoface', 'github'], ['squirrel', 'github'], ['live-share', 'people'], ['circuit-board', 'cpu'],
	['clockface', 'clock'], ['unarchive', 'archive'], ['download', 'download'], ['forward', 'arrow-right'], ['flag', 'flag'],
	['attach', 'paperclip'], ['skip', 'skip-forward'], ['build', 'hammer'], ['thinking', 'stars'],

	// ---- find / replace
	['replace', 'arrow-left-right'], ['replace-all', 'arrow-left-right'], ['regex', 'asterisk'], ['preserve-case', 'type'],
	['exclude', 'slash-circle'], ['compare-changes', 'file-diff'], ['diff-sidebyside', 'layout-split'],
	['surround-with', 'bounding-box'], ['strikethrough', 'type-strikethrough'], ['quotes', 'quote'], ['rename', 'input-cursor-text'],

	// ---- symbols upstream registers separately
	['variable', 'braces-asterisk'], ['array', 'list-ol'], ['symbol-object', 'box'], ['symbol-structure', 'box'],
	['symbol-type-parameter', 'braces-asterisk'], ['symbol-method-arrow', 'braces'], ['variable-group', 'braces'],

	// ---- debug extras
	['debug-breakpoint-conditional', 'circle-fill'], ['debug-breakpoint-conditional-unverified', 'circle'], ['debug-breakpoint-conditional-disabled', 'circle-fill'],
	['debug-breakpoint-data', 'circle-fill'], ['debug-breakpoint-data-unverified', 'circle'], ['debug-breakpoint-data-disabled', 'circle-fill'],
	['debug-breakpoint-log', 'circle-fill'], ['debug-breakpoint-log-unverified', 'circle'], ['debug-breakpoint-log-disabled', 'circle-fill'],
	['debug-breakpoint-function', 'circle-fill'], ['debug-breakpoint-function-unverified', 'circle'], ['debug-breakpoint-function-disabled', 'circle-fill'],
	['debug-breakpoint-unsupported', 'circle-fill'], ['debug-breakpoint-pending', 'circle'], ['activate-breakpoints', 'circle-fill'],
	['debug-stackframe', 'arrow-right'], ['debug-stackframe-active', 'arrow-right-circle-fill'], ['debug-stackframe-focused', 'arrow-right-circle'], ['debug-stackframe-dot', 'circle-fill'],
	['debug-reverse-continue', 'skip-backward-fill'], ['debug-restart-frame', 'arrow-counterclockwise'], ['debug-all', 'play-fill'],
	['run-coverage', 'shield-check'], ['run-all-coverage', 'shield-check'], ['run-with-deps', 'play-fill'], ['debug-connected', 'plug-fill'],
	['terminal-decoration-success', 'check-lg'], ['terminal-decoration-error', 'x-lg'], ['terminal-decoration-incomplete', 'dash-lg'], ['terminal-decoration-mark', 'circle-fill'],
	['terminal-git-bash', 'terminal'], ['terminal-secure', 'terminal'],

	// ---- git extras
	['git-branch-create', 'plus-lg'], ['git-branch-delete', 'trash'], ['git-branch-changes', 'git'], ['git-branch-staged-changes', 'git'], ['git-branch-conflicts', 'exclamation-triangle'],
	['merge', 'union'], ['merge-into', 'union'], ['repo-force-push', 'cloud-arrow-up'], ['repo-fetch', 'cloud-arrow-down'], ['repo-pinned', 'pin-angle'], ['repo-selected', 'journal-check'],
	['git-pull-request-create', 'git'], ['git-pull-request-milestone', 'flag'], ['git-pull-request-reviewer', 'person'], ['git-pull-request-assignee', 'person'],
	['git-pull-request-done', 'check-circle'], ['git-pull-request-go-to-changes', 'file-diff'], ['git-pull-request-new-changes', 'file-diff'],
	['worktree', 'diagram-2'], ['worktree-small', 'diagram-2'], ['code-review', 'file-diff'], ['graph-left', 'graph-up'],
	['call-incoming', 'box-arrow-in-down-left'], ['call-outgoing', 'box-arrow-up-right'],

	// ---- layout extras
	['layout-panel-dock', 'window-dock'], ['layout-sidebar-left-dock', 'layout-sidebar'], ['layout-sidebar-right-dock', 'layout-sidebar-reverse'],
	['layout-panel-justify', 'layout-split'], ['window-active', 'window'], ['open-in-window', 'box-arrow-up-right'], ['open-in-product', 'box-arrow-up-right'],
	['share-window', 'share'], ['map-filled', 'map-fill'], ['map-horizontal', 'map'], ['map-vertical', 'map'], ['map-horizontal-filled', 'map-fill'], ['map-vertical-filled', 'map-fill'],
	// `fold-horizontal`/`fold-vertical` stay on upstream's codicon: Bootstrap has no fill twin for
	// `chevron-bar-contract`, and theming the outline while its `-filled` sibling fell back would
	// put two icon families side by side in the same control.
	['compass-dot', 'compass'], ['compass-active', 'compass-fill'], ['notebook-template', 'journal-code'],

	// ---- chat / agent. `chat-square` is the house glyph for conversation, by request.
	['openide-chat', 'chat-square'], ['chat-view-icon', 'chat-square'], ['chat-sessions-icon', 'chat-square-text'],
	// Agent Changes: its own entry rather than riding on `git-pull-request-go-to-changes`, which is
	// what it aliases. A sheet and not a box, because the activity bar now puts the extensions box
	// directly under it and two boxes in a column say nothing to the eye.
	['openide-cli-changes', 'file-earmark-diff'],
	['comment-discussion-sparkle', 'chat-square-heart'], ['comment-discussion-quote', 'chat-square-quote'],
	['chat-import', 'box-arrow-in-down'], ['chat-export', 'box-arrow-up'], ['new-session', 'chat-square-dots'], ['session-in-progress', 'chat-square-fill'],
	['send-to-remote-agent', 'send'], ['go-to-editing-session', 'chat-square-text'], ['edit-session', 'chat-square-text'],
	['agent', 'robot'],
	['ask', 'question-circle'], ['openai', 'stars'], ['claude', 'stars'], ['python', 'filetype-py'], ['mcp', 'plug'],
	['search-sparkle', 'search-heart'], ['edit-sparkle', 'pencil-square'], ['edit-code', 'code-square'],
	['copilot-large', 'stars'], ['copilot-warning', 'exclamation-triangle'], ['copilot-warning-large', 'exclamation-triangle'],
	['copilot-blocked', 'slash-circle'], ['copilot-not-connected', 'plug'], ['copilot-unavailable', 'slash-circle'],
	['copilot-in-progress', 'arrow-repeat'], ['copilot-error', 'x-circle-fill'], ['copilot-success', 'check-circle-fill'], ['copilot-snooze', 'moon'],
	['collection', 'collection'], ['new-collection', 'collection-fill'], ['collection-small', 'collection'],
	['extensions-large', 'box-seam'], ['index-zero', 'hash'], ['keyboard-tab', 'arrow-bar-right'], ['keyboard-tab-above', 'arrow-bar-up'], ['keyboard-tab-below', 'arrow-bar-down'],

	// ---- title-bar layout toggles, where the theme carries the open/closed state
	//
	// These are the one place the workbench DOES swap glyph by state, and it does it the way a
	// theme can follow: two registered ids per toggle, alternated by `toggled: { condition, icon }`
	// on the menu item. The base `icon:` is the CLOSED state and the `toggled` one is OPEN — so
	// the id WITHOUT `-off` is the one that shows while the panel is open.
	//
	// Both halves of every pair are mapped on purpose. Mapping only one would theme a button that
	// then jumps to upstream's codicon the moment you click it.
	//
	// The bottom panel reads as a terminal rather than a layout diagram: it is what that panel
	// actually holds. The layout ids proper (`panel-bottom` in the Customize Layout picker) keep
	// their layout glyph — a different surface, a different question.
	['panel-left-off', 'layout-sidebar'], ['panel-left', 'layout-sidebar-inset'],
	['panel-right-off', 'layout-sidebar-reverse'], ['panel-right', 'layout-sidebar-inset-reverse'],
	['panel-layout-icon-off', 'terminal'], ['panel-layout-icon', 'terminal-fill'],
	['auxiliarybar-right-off-layout-icon', 'chat-square'], ['auxiliarybar-right-layout-icon', 'chat-square-fill'],
	['auxiliarybar-left-off-layout-icon', 'chat-square'], ['auxiliarybar-left-layout-icon', 'chat-square-fill'],
	['agent-secondary-sidebar-toggle-closed', 'chat-square'], ['agent-secondary-sidebar-toggle-open', 'chat-square-fill'],

	// ---- workbench chrome the theme must not forget: dialogs, trees, menus, scrollbars
	['dialog-error', 'x-circle-fill'], ['dialog-warning', 'exclamation-triangle-fill'], ['dialog-info', 'info-circle-fill'], ['dialog-close', 'x-lg'],
	['tree-item-expanded', 'chevron-down'], ['tree-filter-on-type-on', 'funnel-fill'], ['tree-filter-on-type-off', 'funnel'],
	['tree-filter-clear', 'x-lg'], ['tree-item-loading', 'arrow-repeat'],
	['menu-selection', 'check-lg'], ['menu-submenu', 'chevron-right'], ['menubar-more', 'three-dots'],
	['scrollbar-button-left', 'chevron-left'], ['scrollbar-button-right', 'chevron-right'], ['scrollbar-button-up', 'chevron-up'], ['scrollbar-button-down', 'chevron-down'],
	['toolbar-more', 'three-dots'], ['quick-input-back', 'arrow-left'], ['drop-down-button', 'chevron-down'],
	['symbol-customcolor', 'palette'], ['workspace-unspecified', 'shield'], ['lightbulb-sparkle-autofix', 'lightbulb-fill'],
	['vm-small', 'display'], ['cloud-small', 'cloud'], ['add-small', 'plus-lg'], ['remove-small', 'dash-lg'],
	['vscode', 'code-square'], ['vscode-insiders', 'code-square'], ['screen-cut', 'scissors'], ['eraser', 'eraser'],
];

const iconIds = knownIconIds();
const defs = {};
const notAnIcon = [];
const unknownGlyph = [];
const seen = new Set();
for (const [id, glyph] of MAP) {
	if (seen.has(id)) { continue; }
	if (!iconIds.has(id)) { notAnIcon.push(id); continue; }
	const cp = points[glyph];
	if (cp === undefined) { unknownGlyph.push(`${id}<-${glyph}`); continue; }
	seen.add(id);
	defs[id] = { fontCharacter: '\\' + cp.toString(16) };
}
if (unknownGlyph.length) { throw new Error('glifos inexistentes en bootstrap-icons: ' + unknownGlyph.join(' ')); }

const header = `{
	// OpenIDE Bootstrap — product icon theme that re-skins the workbench's codicons with Bootstrap
	// Icons (https://icons.getbootstrap.com, MIT). One 16px grid, one visual weight, outline and
	// solid variants in a SINGLE font, so the whole IDE speaks ONE icon language.
	//
	// Ids absent here fall back to the stock codicon on purpose: only those with no honest
	// semantic equivalent in Bootstrap's set.
	//
	// Generated by dev/gen-bootstrap-icons.mjs — do not hand-edit.
	"fonts": [
		{ "id": "bootstrap-icons", "src": [{ "path": "./bootstrap-icons.woff2", "format": "woff2" }], "weight": "normal", "style": "normal" }
	],
	"iconDefinitions": ${JSON.stringify(defs, null, '\t').replace(/\n/g, '\n\t')}
}
`;
writeFileSync(THEME, header);
console.log(`mapped ${Object.keys(defs).length} ids (${iconIds.size} themeable)`);
if (notAnIcon.length) { console.log('skipped, not a registered icon id:', notAnIcon.join(' ')); }
