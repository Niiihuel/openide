/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — integrated inline review of agent edits: the file opens in the NORMAL EDITOR (no
 *  side-by-side with a dead left pane) with the changed blocks painted inline (added = green
 *  background; removed = red view zone holding the baseline lines), a global bar in the
 *  breadcrumbs and a pill anchored to the active block. The block widget is a content widget
 *  clipped by Monaco: it never overflows into the chat.
 *  State lives in OpenideDiffSnapshotProvider (per path, accumulated):
 *  - Undo block (Ctrl+N): rewrites that model range with the baseline lines (+ save).
 *  - Keep block (Ctrl+Y): folds the block into the baseline (overwriteBaseline) — stops counting.
 *  - No blocks left ⇒ the file is resolved (clearBaseline + callback to the chat).
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, timeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IContentWidgetRenderedCoordinate, IOverlayWidget, MouseTargetType, OverlayWidgetPositionPreference } from '../../../../editor/browser/editorBrowser.js';
import { IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { linesDiffComputers } from '../../../../editor/common/diff/linesDiffComputers.js';
import { DetailedLineRangeMapping } from '../../../../editor/common/diff/rangeMapping.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { IModelDeltaDecoration, ITextModel, OverviewRulerLane } from '../../../../editor/common/model.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { DEFAULT_EDITOR_ASSOCIATION } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextFileService, TextFileResolveReason } from '../../../services/textfile/common/textfiles.js';
import { OpenideDiffSnapshotProvider } from './openideDiffSnapshot.js';
import { applyOpenideSurfaceCss } from './openideSurfaceStyle.js';

const DIFF_OPTIONS = { ignoreTrimWhitespace: false, maxComputationTimeMs: 5000, computeMoves: false };

/** True when the active editor has an agent review session (the gate for the integrated
 *  keybindings: Ctrl+N undoes the block, Ctrl+Y keeps it, Ctrl+Enter keeps the file — ONLY
 *  during the review; outside it, the keys keep their normal meaning). */
export const CTX_OPENIDE_REVIEW_ACTIVE = new RawContextKey<boolean>('openideReviewActive', false);

export type ReviewAction = 'undoBlock' | 'keepBlock' | 'undoFile' | 'keepFile' | 'nextBlock' | 'prevBlock';

export interface IEditReviewHost {
	resolveUri(path: string): URI | undefined;
	/** Backup baseline against git HEAD (when there is no session snapshot, e.g. after a restart).
	 *  undefined = untracked / no commits / git down ⇒ the file is treated as new. */
	gitBaseline?(path: string): Promise<string | undefined>;
	/** Forgets the session baseline for a path (the review auto-resolving in the editor). */
	clearBaseline?(path: string): void;
	/** Full file revert (restores the baseline, or deletes it if the agent created it). */
	revertFile(path: string): Promise<void>;
	/** Keep completo (olvida el baseline). */
	keepFile(path: string): Promise<void>;
	/** Notifica al chat el conteo vigente (added=removed=0 ⇒ archivo resuelto, sacar la fila). */
	notifyCounts(path: string, added: number, removed: number): void;
}

/** Review session over ONE editor with ONE pending path. */
class ReviewSession extends Disposable {

	// Assigned in the constructor, not as field initializers: under `useDefineForClassFields`
	// semantics (which `define-class-fields-check` enforces) an initializer runs BEFORE the
	// parameter properties are assigned, so `this.editor` would still be undefined here.
	private readonly decorations: IEditorDecorationsCollection;
	/** Ephemeral visual cursor for "follow the agent" mode. Kept apart from the persistent diff so
	 *  it alters neither Undo/Keep nor the overview ruler map. */
	private readonly followDecorations: IEditorDecorationsCollection;
	/** Typewriter-style visual reveal. It never mutates the model: the code is already complete and
	 *  saved; it only hides/reveals ephemeral ranges so cancelling never leaves partial files. */
	private readonly typingDecorations: IEditorDecorationsCollection;
	private zoneIds: string[] = [];
	private deletionZones: { change: DetailedLineRangeMapping; dom: HTMLElement; lines: HTMLElement[] }[] = [];
	private changes: readonly DetailedLineRangeMapping[] = [];
	private readonly headerWidget: ReviewHeaderWidget;
	private readonly blockWidget: ReviewBlockWidget;
	private readonly recompute: RunOnceScheduler;
	private applying = false;
	/** Baseline content the diff is computed against (the live session's if there was one, else git
	 *  HEAD). Per-block keep overwrites it locally with the kept block folded in. */
	private baseline: string;
	/** Becomes true on seeing the first diff. It prevents auto-resolving the file when the review
	 *  attaches BEFORE the model reloads from disk (diff still empty). */
	private hadChanges = false;
	/** Index of the active block (the editor bar's stepper). */
	private currentBlock = -1;
	private followEpoch = 0;
	private followAnimating = false;
	private renderAfterFollow = false;
	private hoverBlock = -1;
	private readonly hoverScheduler: RunOnceScheduler;

	constructor(
		readonly path: string,
		private readonly editor: ICodeEditor,
		private readonly snapshot: OpenideDiffSnapshotProvider,
		baseline: string,
		private readonly host: IEditReviewHost,
		private readonly textFileService: ITextFileService,
		private readonly onResolved: () => void,
		private readonly onPendingChanged: () => void,
	) {
		// The Keep/Undo tints come from the surface tokens (--openide-green): the review must not
		// depend on the chat having mounted first to get them.
		applyOpenideSurfaceCss();
		super();
		this.decorations = this.editor.createDecorationsCollection();
		this.followDecorations = this.editor.createDecorationsCollection();
		this.typingDecorations = this.editor.createDecorationsCollection();
		this.baseline = baseline;
		// The agent review uses the overview ruler to locate changes. The minimap duplicates that
		// information, steals width and displaces the action pill; it is disabled only for the
		// duration of this session and restored when it resolves.
		const minimapWasEnabled = this.editor.getOption(EditorOption.minimap).enabled;
		this.editor.updateOptions({ minimap: { enabled: false } });
		this._register({ dispose: () => this.editor.updateOptions({ minimap: { enabled: minimapWasEnabled } }) });
		this.headerWidget = this._register(new ReviewHeaderWidget(editor, {
			prevFile: () => this.hopFile(-1),
			nextFile: () => this.hopFile(1),
			prevBlock: () => this.revealBlock(-1),
			nextBlock: () => this.revealBlock(1),
			undoFile: () => this.resolveFile('revert'),
			keepFile: () => this.resolveFile('keep'),
		}));
		this.blockWidget = this._register(new ReviewBlockWidget(editor, {
			prevBlock: () => this.revealBlock(-1),
			nextBlock: () => this.revealBlock(1),
			undoBlock: () => this.runAction('undoBlock'),
			keepBlock: () => this.runAction('keepBlock'),
		}));
		this.recompute = this._register(new RunOnceScheduler(() => this.render(), 250));
		// The hunk pill also activates on hover intent: a second resting over a block is enough and
		// avoids forcing the user to move the cursor or click the code.
		this.hoverScheduler = this._register(new RunOnceScheduler(() => {
			const block = this.changes[this.hoverBlock];
			if (!block) {
				return;
			}
			this.currentBlock = this.hoverBlock;
			this.updateChrome();
		}, 1000));
		this._register(this.editor.onDidChangeModelContent(() => {
			if (!this.applying) {
				this.recompute.schedule();
			}
		}));
		this._register(this.editor.onDidScrollChange(() => this.blockWidget.layout()));
		this._register(this.editor.onDidChangeCursorPosition(e => {
			const index = this.changes.findIndex(change => change === this.blockAt(e.position.lineNumber));
			if (index >= 0 && index !== this.currentBlock) {
				this.currentBlock = index;
				this.updateChrome();
			}
		}));
		this._register(this.editor.onMouseMove(e => {
			const line = e.target.type === MouseTargetType.CONTENT_TEXT || e.target.type === MouseTargetType.CONTENT_EMPTY || e.target.type === MouseTargetType.GUTTER_LINE_NUMBERS || e.target.type === MouseTargetType.GUTTER_LINE_DECORATIONS
				? e.target.position?.lineNumber : undefined;
			const index = line === undefined ? -1 : this.changes.findIndex(change => change === this.blockAt(line));
			if (index === this.hoverBlock) {
				return;
			}
			this.hoverBlock = index;
			this.hoverScheduler.cancel();
			if (index >= 0) {
				this.hoverScheduler.schedule(1000);
			}
		}));
		this._register(this.editor.onMouseLeave(() => {
			this.hoverBlock = -1;
			this.hoverScheduler.cancel();
		}));
		this._register(this.editor.onDidLayoutChange(() => {
			this.headerWidget.remount();
			this.blockWidget.layout();
		}));
		this.render();
	}

	private model(): ITextModel | null {
		return this.editor.getModel();
	}

	private baselineLines(): string[] {
		return this.baseline.split(/\r\n|\r|\n/);
	}

	// ---- render ----

	private render(revealActive = false): void {
		if (this.followAnimating) {
			this.renderAfterFollow = true;
			return;
		}
		const model = this.model();
		if (!model) {
			return;
		}
		const result = linesDiffComputers.getDefault().computeDiff(this.baselineLines(), model.getLinesContent(), DIFF_OPTIONS);
		this.changes = result.changes;

		// The left margin marks the active hunk in yellow. The right overview ruler is exclusively a
		// map of the diff: green added, red removed, grey context.
		const additions = this.changes.filter(c => !c.modified.isEmpty).map(c => ({
			range: new Range(c.modified.startLineNumber, 1, c.modified.endLineNumberExclusive - 1, model.getLineMaxColumn(c.modified.endLineNumberExclusive - 1)),
			options: {
				description: c.original.isEmpty ? 'openide-review-added' : 'openide-review-modified',
				isWholeLine: true,
				className: c.original.isEmpty ? 'openide-review-added-line' : 'openide-review-modified-line',
				linesDecorationsClassName: 'openide-review-change-gutter',
				overviewRuler: { color: 'rgba(43, 151, 113, 0.72)', position: OverviewRulerLane.Right },
			},
		}));
		const deletions = this.changes.filter(c => !c.original.isEmpty).map(c => {
			const line = Math.max(1, Math.min(model.getLineCount(), c.modified.startLineNumber));
			return {
				range: new Range(line, 1, line, 1),
				options: {
					description: 'openide-review-deleted',
					overviewRuler: { color: 'rgba(194, 63, 96, 0.72)', position: OverviewRulerLane.Left },
				},
			};
		});
		const neutral: { range: Range; options: { description: string; overviewRuler: { color: string; position: OverviewRulerLane } } }[] = [];
		const changed = this.changes.filter(c => !c.modified.isEmpty).map(c => c.modified).sort((a, b) => a.startLineNumber - b.startLineNumber);
		let unchangedStart = 1;
		for (const range of changed) {
			if (unchangedStart < range.startLineNumber) {
				neutral.push({
					range: new Range(unchangedStart, 1, range.startLineNumber - 1, 1),
					options: { description: 'openide-review-context', overviewRuler: { color: 'rgba(128, 128, 128, 0.25)', position: OverviewRulerLane.Center } },
				});
			}
			unchangedStart = Math.max(unchangedStart, range.endLineNumberExclusive);
		}
		if (unchangedStart <= model.getLineCount()) {
			neutral.push({
				range: new Range(unchangedStart, 1, model.getLineCount(), 1),
				options: { description: 'openide-review-context', overviewRuler: { color: 'rgba(128, 128, 128, 0.25)', position: OverviewRulerLane.Center } },
			});
		}
		this.decorations.set([...neutral, ...additions, ...deletions]);

		// removed lines: red view zone holding the baseline content
		const base = this.baselineLines();
		const fontInfo = this.editor.getOption(EditorOption.fontInfo);
		this.editor.changeViewZones(accessor => {
			for (const id of this.zoneIds) {
				accessor.removeZone(id);
			}
			this.zoneIds = [];
			this.deletionZones = [];
			for (const c of this.changes) {
				if (c.original.isEmpty) {
					continue;
				}
				const lines = base.slice(c.original.startLineNumber - 1, c.original.endLineNumberExclusive - 1);
				const dom = document.createElement('div');
				dom.className = 'openide-review-deleted-zone';
				dom.style.fontFamily = fontInfo.fontFamily;
				dom.style.fontSize = `${fontInfo.fontSize}px`;
				dom.style.lineHeight = `${fontInfo.lineHeight}px`;
				const lineNodes: HTMLElement[] = [];
				for (const text of lines) {
					const ln = document.createElement('div');
					ln.className = 'openide-review-deleted-line';
					const sign = document.createElement('span');
					sign.className = 'openide-review-deleted-sign';
					sign.textContent = '−';
					const code = document.createElement('span');
					code.className = 'openide-review-deleted-code';
					code.textContent = text || ' ';
					ln.append(sign, code);
					dom.appendChild(ln);
					lineNodes.push(ln);
				}
				this.deletionZones.push({ change: c, dom, lines: lineNodes });
				this.zoneIds.push(accessor.addZone({
					afterLineNumber: c.modified.isEmpty ? c.modified.startLineNumber - 1 : c.modified.startLineNumber - 1,
					heightInLines: lines.length,
					domNode: dom,
				}));
			}
		});

		if (this.changes.length) { this.hadChanges = true; }
		if (this.changes.length) {
			this.currentBlock = Math.min(this.currentBlock < 0 ? 0 : this.currentBlock, this.changes.length - 1);
		} else {
			this.currentBlock = -1;
		}
		let added = 0;
		let removed = 0;
		for (const change of this.changes) {
			added += change.modified.length;
			removed += change.original.length;
		}
		const pendingChanged = this.snapshot.markPending(this.path, this.changes.length > 0, added, removed);
		this.updateChrome(revealActive);
		if (pendingChanged) {
			this.onPendingChanged();
		}

		// no blocks left (and there was a diff before) ⇒ the user undid/kept everything: resolve the file.
		// The hadChanges guard avoids resolving when we attach before the model reloads.
		if (!this.changes.length && this.hadChanges) {
			this.host.clearBaseline?.(this.path);
			this.host.notifyCounts(this.path, 0, 0);
			this.onResolved();
		}
	}

	/** Single source of truth for both surfaces. It also relayouts the content widget when
	 *  scroll/layout moved the hunk, keeping the pill inside the Monaco viewport. */
	private updateChrome(revealActive = false): void {
		const pending = this.snapshot.pendingPaths();
		this.headerWidget.update(pending, this.path, this.changes.length, this.currentBlock);
		const block = this.currentBlock >= 0 ? this.changes[this.currentBlock] : undefined;
		const line = block ? (block.modified.isEmpty ? Math.max(1, block.modified.startLineNumber - 1) : block.modified.endLineNumberExclusive - 1) : undefined;
		this.blockWidget.update(this.changes.length, this.currentBlock, line);
		if (line !== undefined && revealActive) {
			this.editor.revealLineInCenterIfOutsideViewport(line);
		}
	}

	/** Updates only counters/mount; used by the controller when another file resolves. */
	refreshChrome(): void {
		this.updateChrome();
	}

	/** Block whose changed zone (or the red zone's insertion point) contains the line. */
	private blockAt(line: number): DetailedLineRangeMapping | undefined {
		return this.changes.find(c => {
			const start = c.modified.isEmpty ? c.modified.startLineNumber - 1 : c.modified.startLineNumber;
			const end = c.modified.isEmpty ? c.modified.startLineNumber : c.modified.endLineNumberExclusive - 1;
			return line >= Math.max(1, start) && line <= end;
		});
	}

	/** The bar's ∧/∨ stepper: navigates to the previous/next block (no wrap) and reveals it. */
	private stepBlock(dir: 1 | -1): void {
		if (!this.changes.length) { return; }
		const cur = this.currentBlock >= 0 ? this.currentBlock : 0;
		const ni = Math.max(0, Math.min(this.changes.length - 1, cur + dir));
		const block = this.changes[ni];
		if (!block) { return; }
		this.currentBlock = ni;
		const revealLine = block.modified.isEmpty ? Math.max(1, block.modified.startLineNumber - 1) : block.modified.startLineNumber;
		this.editor.revealLineInCenterIfOutsideViewport(revealLine);
		this.updateChrome();
		this.editor.focus();
	}

	// ---- operaciones por bloque ----

	/** Replaces the model's line range [startLine, endLineEx) with newLines (empty = delete). */
	private replaceLines(model: ITextModel, startLine: number, endLineEx: number, newLines: string[]): void {
		let range: Range;
		let text: string;
		if (startLine < endLineEx) {
			const endLine = endLineEx - 1;
			if (newLines.length) {
				range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
				text = newLines.join('\n');
			} else if (endLine < model.getLineCount()) {
				range = new Range(startLine, 1, endLine + 1, 1);
				text = '';
			} else if (startLine > 1) {
				range = new Range(startLine - 1, model.getLineMaxColumn(startLine - 1), endLine, model.getLineMaxColumn(endLine));
				text = '';
			} else {
				range = new Range(1, 1, endLine, model.getLineMaxColumn(endLine));
				text = '';
			}
		} else if (startLine <= model.getLineCount()) {
			range = new Range(startLine, 1, startLine, 1);
			text = newLines.length ? newLines.join('\n') + '\n' : '';
		} else {
			const last = model.getLineCount();
			range = new Range(last, model.getLineMaxColumn(last), last, model.getLineMaxColumn(last));
			text = newLines.length ? '\n' + newLines.join('\n') : '';
		}
		model.pushEditOperations([], [{ range, text }], () => null);
	}

	private async undoBlockAt(line: number): Promise<void> {
		const block = this.blockAt(line);
		const model = this.model();
		if (!block || !model) {
			return;
		}
		const original = this.baselineLines().slice(block.original.startLineNumber - 1, block.original.endLineNumberExclusive - 1);
		this.applying = true;
		try {
			this.replaceLines(model, block.modified.startLineNumber, block.modified.endLineNumberExclusive, original);
			// the agent writes to disk: keep disk and model in sync after the undo
			await this.textFileService.save(model.uri).catch(() => { /* best-effort */ });
		} finally {
			this.applying = false;
		}
		this.render(true);
		this.notify();
	}

	private keepBlockAt(line: number): void {
		const block = this.blockAt(line);
		const model = this.model();
		if (!block || !model) {
			return;
		}
		const base = this.baselineLines();
		const modified = model.getLinesContent().slice(block.modified.startLineNumber - 1, block.modified.endLineNumberExclusive - 1);
		const merged = [
			...base.slice(0, block.original.startLineNumber - 1),
			...modified,
			...base.slice(block.original.endLineNumberExclusive - 1),
		].join('\n');
		// Keep block: folds the block into the LOCAL baseline and into the shared snapshot. Without
		// updating both, a later agent edit counted this already-kept block again
		// aceptado en la bandeja de Files.
		this.baseline = merged;
		this.snapshot.overwriteBaseline(this.path, merged);
		this.render(true);
		this.notify();
	}

	/** Recomputes +N/−N against the current baseline and notifies the chat (0/0 ⇒ row resolved). */
	private notify(): void {
		const model = this.model();
		if (!model) {
			return; // ya resuelto (render() avisó 0/0)
		}
		let added = 0;
		let removed = 0;
		for (const c of this.changes) {
			added += c.modified.length;
			removed += c.original.length;
		}
		this.host.notifyCounts(this.path, added, removed);
	}

	// ---- acciones globales ----

	private async resolveFile(action: 'revert' | 'keep'): Promise<void> {
		const pending = this.snapshot.pendingPaths().filter(p => p !== this.path);
		if (action === 'revert') {
			await this.host.revertFile(this.path);
		} else {
			await this.host.keepFile(this.path);
		}
		this.host.notifyCounts(this.path, 0, 0);
		this.onResolved();
		// if more files are still pending, jump to the next one (the editor's "N of M files" flow)
		if (pending.length) {
			this.hopTo(pending[0]);
		}
	}

	private hopFile(dir: 1 | -1): void {
		const paths = this.snapshot.pendingPaths();
		if (paths.length < 2) {
			return;
		}
		const idx = paths.indexOf(this.path);
		this.hopTo(paths[(idx + dir + paths.length) % paths.length]);
	}

	private hopTo(path: string): void {
		this.hopRequest?.(path);
	}
	/** Set by the controller: open the review for another path. */
	hopRequest: ((path: string) => void) | undefined;

	/** Repaints decorations/zones (e.g. after a model swap with the same URI). */
	refresh(): void {
		this.render();
	}

	/** Walks the last edit's range as a progressive write. The content is already applied and
	 *  saved: this layer hides everything not yet written, reveals the active prefix and centers
	 *  Monaco. That way it never leaves a half-written file if the run is cancelled. */
	async followRange(startLine?: number, endLine?: number): Promise<void> {
		const epoch = ++this.followEpoch;
		// A new edit may arrive while the previous one is still animating. We cancel its projection
		// WITHOUT repainting the persistent decorations (that caused the green/red flash of the WHOLE
		// block when there were previous changes). We only clear the typewriter overlay.
		const wasAnimating = this.followAnimating;
		if (wasAnimating) {
			this.followAnimating = false;
			this.typingDecorations.clear();
			this.followDecorations.clear();
			for (const zone of this.deletionZones) {
				zone.dom.classList.remove('openide-agent-delete-pending');
				for (const line of zone.lines) { line.classList.remove('openide-agent-delete-revealed'); }
			}
		}
		const model = this.model();
		if (!model || !this.changes.length) {
			if (wasAnimating) { this.render(); }
			return;
		}
		const from = Math.max(1, startLine ?? 1);
		const to = Math.max(from, endLine ?? model.getLineCount());
		// Animate only the blocks INSIDE the new edit's range. Previous changes (outside this range)
		// are not painted during the animation: the file looks clean and only the green/red of what
		// is being written right now appears.
		const blocks = this.changes.filter(change => {
			const start = change.modified.isEmpty ? Math.max(1, change.modified.startLineNumber - 1) : change.modified.startLineNumber;
			const end = change.modified.isEmpty ? start : Math.max(start, change.modified.endLineNumberExclusive - 1);
			return end >= from && start <= to;
		});
		const followed = blocks.length ? blocks : [];
		const ranges = followed.filter(block => !block.modified.isEmpty).map(block => {
			const start = block.modified.startLineNumber;
			const end = Math.max(start, block.modified.endLineNumberExclusive - 1);
			return { block, start: Math.max(start, from), end: Math.min(end, to) };
		}).filter(range => range.start <= range.end);
		const deletionZones = followed.flatMap(block => this.deletionZones.filter(zone => zone.change === block));
		if (!ranges.length && !deletionZones.length) {
			if (wasAnimating) { this.render(); }
			return;
		}
		// Only here do we confirm there is something to animate: we clear the persistent diff so the
		// animation starts over a clean file (no whole-block flash).
		this.decorations.clear();
		if (!ranges.length && !deletionZones.length) {
			return;
		}
		this.followAnimating = true;
		this.renderAfterFollow = false;
		const finish = (restorePersistent: boolean): void => {
			if (epoch !== this.followEpoch) { return; }
			this.typingDecorations.clear();
			this.followDecorations.clear();
			this.followAnimating = false;
			for (const zone of this.deletionZones) {
				zone.dom.classList.remove('openide-agent-delete-pending');
			}
			if (restorePersistent || this.renderAfterFollow) {
				// When it ends we paint the PERSISTENT diff. But to avoid the flash of the WHOLE block, we do
				// it with a normal re-render (no violent clear+set).
				this.render();
			}
		};

		const totalCharacters = ranges.reduce((sum, range) => {
			for (let line = range.start; line <= range.end; line++) { sum += model.getLineLength(line) + 1; }
			return sum;
		}, 0);
		// The model is never modified: we hide what has not been "written" yet and advance a visual
		// cursor. For large files we raise the chunk size without lengthening the animation.
		const totalLines = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
		const targetSteps = Math.max(24, Math.min(520, Math.ceil(totalCharacters / 3)));
		const baseChunk = Math.max(1, Math.ceil(totalCharacters / targetSteps));
		let first = true;
		const linePause = totalLines <= 40 ? 55 : totalLines <= 120 ? 24 : 8;
		const updateTypingDecorations = (activeRangeIndex: number, activeLine: number, column: number, completeActive = false): void => {
			const pending: IModelDeltaDecoration[] = [];
			const activeRange = ranges[activeRangeIndex];
			const activeMaxColumn = model.getLineMaxColumn(activeLine);
			const completedLine = (line: number): void => {
				pending.push({
					range: new Range(line, 1, line, model.getLineMaxColumn(line)),
					options: { description: 'openide-agent-typewriter-complete-line', isWholeLine: true, className: 'openide-agent-typewriter-complete-line' },
				});
			};
			for (let rangeIndex = 0; rangeIndex <= activeRangeIndex; rangeIndex++) {
				const range = ranges[rangeIndex];
				const completedEnd = rangeIndex < activeRangeIndex ? range.end : activeLine - 1;
				for (let line = range.start; line <= completedEnd; line++) { completedLine(line); }
			}
			if (completeActive) {
				completedLine(activeLine);
			} else {
				// The active line is shown without colour. Green appears only when the line break is
				// confirmed; the not-yet-written suffix stays completely hidden.
				pending.push({
					range: new Range(activeLine, 1, activeLine, activeMaxColumn),
					options: { description: 'openide-agent-typewriter-pending-line', isWholeLine: true, className: 'openide-agent-typewriter-pending-line' },
				});
				if (column < activeMaxColumn) {
				pending.push({
					range: new Range(activeLine, column, activeLine, activeMaxColumn),
					options: { description: 'openide-agent-typewriter-hidden', inlineClassName: 'openide-agent-typewriter-hidden' },
				});
				}
			}

			const hideLines = (start: number, end: number): void => {
				if (start > end) { return; }
				pending.push({
					range: new Range(start, 1, end, model.getLineMaxColumn(end)),
					options: {
						description: 'openide-agent-typewriter-pending-lines',
						isWholeLine: true,
						className: 'openide-agent-typewriter-pending-line',
						inlineClassName: 'openide-agent-typewriter-hidden',
					},
				});
			};
			hideLines(activeLine + 1, activeRange.end);
			for (let futureIndex = activeRangeIndex + 1; futureIndex < ranges.length; futureIndex++) {
				hideLines(ranges[futureIndex].start, ranges[futureIndex].end);
			}
			this.typingDecorations.set(pending);
		};

		// We remove the persistent diff BEFORE the first frame: the file starts visually clean.
		// We then hide the full replacement. If the hunk is an edit, the baseline zone stays visible
		// in its neutral colour and is confirmed line by line in red before we start writing the new
		// code in green.
		for (const zone of deletionZones) {
			zone.dom.classList.add('openide-agent-delete-pending');
			for (const line of zone.lines) { line.classList.remove('openide-agent-delete-revealed'); }
		}
		this.decorations.clear();
		if (ranges.length) {
			updateTypingDecorations(0, ranges[0].start, 1);
		}
		if (deletionZones.length) {
			await timeout(110);
			const deletedLineCount = deletionZones.reduce((sum, zone) => sum + zone.lines.length, 0);
			const deletePause = deletedLineCount <= 30 ? 58 : deletedLineCount <= 100 ? 26 : 10;
			for (const zone of deletionZones) {
				const blockIndex = this.changes.indexOf(zone.change);
				if (blockIndex >= 0) { this.currentBlock = blockIndex; this.updateChrome(); }
				const revealLine = zone.change.modified.isEmpty ? Math.max(1, zone.change.modified.startLineNumber - 1) : zone.change.modified.startLineNumber;
				if (first) { this.editor.revealLineInCenter(revealLine); first = false; }
				else { this.editor.revealLineInCenterIfOutsideViewport(revealLine); }
				for (const line of zone.lines) {
					if (epoch !== this.followEpoch || !this.model()) {
						finish(false);
						return;
					}
					line.classList.add('openide-agent-delete-revealed');
					await timeout(deletePause);
				}
				zone.dom.classList.remove('openide-agent-delete-pending');
				await timeout(Math.min(80, deletePause * 2));
			}
		}
		if (!ranges.length) {
			finish(true);
			return;
		}
		for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
			const range = ranges[rangeIndex];
			const blockIndex = this.changes.indexOf(range.block);
			if (blockIndex >= 0) { this.currentBlock = blockIndex; this.updateChrome(); }
			for (let line = range.start; line <= range.end; line++) {
				if (epoch !== this.followEpoch || !this.model()) { finish(false); return; }
				const safeLine = Math.max(1, Math.min(model.getLineCount(), line));
				const maxColumn = model.getLineMaxColumn(safeLine);
				const lineText = model.getLineContent(safeLine);
				let column = 1;
				if (first) { this.editor.revealLineInCenter(safeLine); first = false; }
				else { this.editor.revealLineInCenterIfOutsideViewport(safeLine); }
				while (column < maxColumn) {
					if (epoch !== this.followEpoch || !this.model()) { finish(false); return; }
					const burst = Math.random() < 0.24 ? Math.floor(Math.random() * 5) + 2 : 1;
					column = Math.min(maxColumn, column + Math.max(baseChunk, burst));
					updateTypingDecorations(rangeIndex, safeLine, column);
					this.followDecorations.set([{
						range: new Range(safeLine, Math.max(1, column - 1), safeLine, column),
						options: { description: 'openide-agent-typewriter-cursor', inlineClassName: 'openide-agent-typewriter-cursor' },
					}]);
					const last = lineText.charAt(Math.max(0, column - 2));
					let delay = 10 + Math.floor(Math.random() * 15);
					if (/[;{}]/.test(last)) { delay += 35; }
					else if (/[,.:()[\]]/.test(last)) { delay += 15; }
					await timeout(delay);
				}
				// Makes the finished line's green background visible, while keeping every later line
				// hidden until its own animation starts.
				updateTypingDecorations(rangeIndex, safeLine, maxColumn, true);
				await timeout(linePause);
			}
		}
		await timeout(180);
		finish(true);
	}

	/** API for the keybindings (Ctrl+N / Ctrl+Y / Ctrl+Enter, gated by openideReviewActive). */
	runAction(action: ReviewAction): void {
		const line = this.editor.getPosition()?.lineNumber;
		const blockLine = (() => {
			if (this.currentBlock >= 0 && this.changes[this.currentBlock]) {
				const b = this.changes[this.currentBlock];
				return b.modified.isEmpty ? Math.max(1, b.modified.startLineNumber - 1) : b.modified.startLineNumber;
			}
			return line;
		})();
		switch (action) {
			case 'undoBlock':
				if (blockLine !== undefined) { this.undoBlockAt(blockLine); }
				break;
			case 'keepBlock':
				if (blockLine !== undefined) { this.keepBlockAt(blockLine); }
				break;
			case 'undoFile':
				this.resolveFile('revert');
				break;
			case 'keepFile':
				this.resolveFile('keep');
				break;
			case 'nextBlock':
				this.revealBlock(1);
				break;
			case 'prevBlock':
				this.revealBlock(-1);
				break;
		}
	}

	/** This session's editor (for the context key gate). */
	get codeEditor(): ICodeEditor {
		return this.editor;
	}

	private revealBlock(dir: 1 | -1): void {
		this.stepBlock(dir);
	}

	override dispose(): void {
		this.followEpoch++;
		this.decorations.clear();
		this.followDecorations.clear();
		this.editor.changeViewZones(accessor => {
			for (const id of this.zoneIds) {
				accessor.removeZone(id);
			}
			this.zoneIds = [];
		});
		super.dispose();
	}
}

/** Action pill of the active hunk. It is a content widget (not overflow) so Monaco's canvas
 *  clips it at the editor group boundary, even with auxiliary bar/islands. */
class ReviewBlockWidget extends Disposable implements IContentWidget {

	readonly allowEditorOverflow = false;
	readonly suppressMouseDown = true;
	private readonly dom = document.createElement('div');
	private readonly label = document.createElement('span');
	private line: number | undefined;

	constructor(
		private readonly editor: ICodeEditor,
		actions: { prevBlock(): void; nextBlock(): void; undoBlock(): void; keepBlock(): void },
	) {
		super();
		this.dom.className = 'openide-review-block';
		const icon = (name: string, title: string, action: () => void) => {
			const button = document.createElement('button');
			button.className = 'oreview-block-chev';
			button.title = title;
			const glyph = document.createElement('span');
			glyph.className = `codicon codicon-${name}`;
			button.appendChild(glyph);
			button.addEventListener('mousedown', e => e.preventDefault());
			button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); action(); });
			return button;
		};
		const action = (label: string, shortcut: string, primary: boolean, run: () => void) => {
			const button = document.createElement('button');
			button.className = `oreview-block-action${primary ? ' primary' : ''}`;
			button.append(label + ' ');
			const key = document.createElement('span');
			key.className = 'oreview-block-kbd';
			key.textContent = shortcut;
			button.appendChild(key);
			button.addEventListener('mousedown', e => e.preventDefault());
			button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
			return button;
		};
		const stepper = document.createElement('div');
		stepper.className = 'oreview-block-stepper';
		this.label.className = 'oreview-block-count';
		stepper.append(
			icon('chevron-up', localize('openide.review.prevBlock', "Previous block"), actions.prevBlock),
			this.label,
			icon('chevron-down', localize('openide.review.nextBlock', "Next block"), actions.nextBlock),
		);
		this.dom.append(
			stepper,
			action(localize('openide.review.undoBlock', "Undo"), 'Ctrl+N', false, actions.undoBlock),
			action(localize('openide.review.keepBlock', "Keep"), 'Ctrl+Y', true, actions.keepBlock),
		);
		this.editor.addContentWidget(this);
		this._register({ dispose: () => this.editor.removeContentWidget(this) });
	}

	getId(): string { return 'openide.review.block'; }
	getDomNode(): HTMLElement { return this.dom; }
	getPosition(): IContentWidgetPosition | null {
		return this.line === undefined ? null : {
			position: { lineNumber: this.line, column: 1 },
			preference: [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE],
		};
	}

	update(total: number, current: number, line: number | undefined): void {
		this.line = total > 0 ? line : undefined;
		this.label.textContent = total > 0 ? `${Math.max(0, current) + 1} of ${total}` : '';
		this.dom.classList.toggle('hidden', this.line === undefined);
		this.layout();
	}

	layout(): void { this.editor.layoutContentWidget(this); }

	afterRender(_position: ContentWidgetPositionPreference | null, coordinate: IContentWidgetRenderedCoordinate | null): void {
		if (!coordinate || this.line === undefined) {
			this.dom.style.transform = '';
			return;
		}
		const layout = this.editor.getLayoutInfo();
		const rightInset = layout.verticalScrollbarWidth + layout.minimap.minimapWidth + 14;
		// coordinate.left is relative to `.lines-content`, whose origin already starts at
		// contentLeft. Adding the gutter again displaced the pill and cut off Keep.
		const desiredLeft = Math.max(8, layout.contentWidth - rightInset - this.dom.offsetWidth);
		this.dom.style.transform = `translateX(${Math.round(desiredLeft - coordinate.left)}px)`;
	}
}

/** Global review bar (breadcrumb / TOP-RIGHT): navigation + Undo/Keep File. */
class ReviewHeaderWidget extends Disposable implements IOverlayWidget {

	private readonly dom: HTMLElement;
	private readonly fileLabel: HTMLElement;
	private readonly blockLabel: HTMLElement;
	private readonly fileNavButtons: HTMLButtonElement[];
	private readonly mountScheduler: RunOnceScheduler;
	private readonly observer: MutationObserver;
	private observedGroup: HTMLElement | undefined;
	private breadcrumbs: HTMLElement | undefined;
	private mounted: 'breadcrumbs' | 'overlay' | undefined;

	constructor(
		private readonly editor: ICodeEditor,
		actions: { prevFile(): void; nextFile(): void; prevBlock(): void; nextBlock(): void; undoFile(): void; keepFile(): void },
	) {
		super();
		this.dom = document.createElement('div');
		this.dom.className = 'openide-review-header';
		const mkIcon = (cls: string, icon: string, title: string, fn: () => void) => {
			const b = document.createElement('button');
			b.className = cls;
			b.title = title;
			const glyph = document.createElement('span');
			glyph.className = 'codicon codicon-' + icon;
			b.appendChild(glyph);
			b.addEventListener('mousedown', e => e.preventDefault());
			b.addEventListener('click', e => { e.preventDefault(); fn(); });
			return b;
		};
		const mkAction = (cls: string, label: string, title: string, fn: () => void, shortcut?: string) => {
			const b = document.createElement('button');
			b.className = cls;
			b.title = title;
			const text = document.createElement('span');
			text.className = 'oreview-btn-label';
			text.textContent = label;
			b.appendChild(text);
			if (shortcut) {
				const key = document.createElement('span');
				key.className = 'oreview-kbd';
				key.textContent = shortcut;
				b.appendChild(key);
			}
			b.addEventListener('mousedown', e => e.preventDefault());
			b.addEventListener('click', e => { e.preventDefault(); fn(); });
			return b;
		};

		const blockNav = document.createElement('div');
		blockNav.className = 'oreview-stepper';
		blockNav.appendChild(mkIcon('oreview-chev', 'chevron-up', localize('openide.review.prevBlock', "Previous block"), actions.prevBlock));
		this.blockLabel = document.createElement('span');
		this.blockLabel.className = 'oreview-count';
		blockNav.appendChild(this.blockLabel);
		blockNav.appendChild(mkIcon('oreview-chev', 'chevron-down', localize('openide.review.nextBlock', "Next block"), actions.nextBlock));

		const fileNav = document.createElement('div');
		fileNav.className = 'oreview-file-nav';
		const prevF = mkIcon('openide-review-nav', 'chevron-left', localize('openide.review.prevFile', "Previous file"), actions.prevFile);
		this.fileLabel = document.createElement('span');
		this.fileLabel.className = 'oreview-file-label';
		const nextF = mkIcon('openide-review-nav', 'chevron-right', localize('openide.review.nextFile', "Next file"), actions.nextFile);
		fileNav.appendChild(prevF);
		fileNav.appendChild(this.fileLabel);
		fileNav.appendChild(nextF);
		this.fileNavButtons = [prevF, nextF];
		const sep = document.createElement('span');
		sep.className = 'openide-review-sep';
		const sep2 = document.createElement('span');
		sep2.className = 'openide-review-sep';
		const undo = mkAction('openide-review-btn', localize('openide.review.undoFile', "Undo File"), localize('openide.review.undoFileTip', "Undo all agent changes in this file"), actions.undoFile);
		const keep = mkAction('openide-review-btn primary', localize('openide.review.keepFile', "Keep File"), localize('openide.review.keepFileTip', "Keep all agent changes in this file"), actions.keepFile, 'Ctrl+Enter');
		for (const n of [blockNav, sep, fileNav, sep2, undo, keep]) {
			this.dom.appendChild(n);
		}
		this.mountScheduler = this._register(new RunOnceScheduler(() => this.mountNow(), 40));
		this.observer = new MutationObserver(() => this.remount());
		this._register({ dispose: () => { this.observer.disconnect(); this.unmount(); } });
		this._register(this.editor.onDidChangeModel(() => this.remount()));
		this._register(this.editor.onDidChangeConfiguration(() => this.remount()));
		this.mountNow();
	}

	/** Retries because breadcrumbs is created/hidden independently of the Monaco editor. */
	remount(): void { this.mountScheduler.schedule(); }

	private observeGroup(group: HTMLElement | undefined): void {
		if (group === this.observedGroup) { return; }
		this.observer.disconnect();
		this.observedGroup = group;
		if (group) { this.observer.observe(group, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] }); }
	}

	private visibleBreadcrumbs(group: HTMLElement | undefined): HTMLElement | undefined {
		const node = group?.querySelector<HTMLElement>('.breadcrumbs-control');
		if (!node || node.classList.contains('hidden') || !node.isConnected) { return undefined; }
		return node.ownerDocument.defaultView?.getComputedStyle(node).display === 'none' ? undefined : node;
	}

	private mountNow(): void {
		const group = this.editor.getContainerDomNode()?.closest<HTMLElement>('.editor-group-container') ?? undefined;
		this.observeGroup(group);
		const breadcrumbs = this.visibleBreadcrumbs(group);
		if (breadcrumbs) {
			if (this.mounted === 'overlay') { this.editor.removeOverlayWidget(this); }
			if (this.breadcrumbs && this.breadcrumbs !== breadcrumbs) {
				this.breadcrumbs.classList.remove('openide-review-host');
				this.breadcrumbs.style.removeProperty('--openide-review-header-width');
				this.breadcrumbs.style.removeProperty('--openide-review-fade-width');
			}
			this.breadcrumbs = breadcrumbs;
			this.dom.classList.add('in-breadcrumbs');
			if (!breadcrumbs.classList.contains('openide-review-host')) { breadcrumbs.classList.add('openide-review-host'); }
			if (breadcrumbs.ownerDocument.defaultView?.getComputedStyle(breadcrumbs).position === 'static' && breadcrumbs.style.position !== 'relative') { breadcrumbs.style.position = 'relative'; }
			if (this.dom.parentElement !== breadcrumbs) { breadcrumbs.appendChild(this.dom); }
			const available = breadcrumbs.clientWidth;
			const headerWidth = Math.min(this.dom.offsetWidth + 12, Math.max(0, available - 72));
			const width = `${headerWidth}px`;
			const fade = `${Math.max(18, Math.min(42, Math.round((available - headerWidth) * 0.12)))}px`;
			if (breadcrumbs.style.getPropertyValue('--openide-review-header-width') !== width) { breadcrumbs.style.setProperty('--openide-review-header-width', width); }
			if (breadcrumbs.style.getPropertyValue('--openide-review-fade-width') !== fade) { breadcrumbs.style.setProperty('--openide-review-fade-width', fade); }
			this.mounted = 'breadcrumbs';
			return;
		}
		if (this.mounted === 'breadcrumbs') {
			this.breadcrumbs?.classList.remove('openide-review-host');
			this.breadcrumbs?.style.removeProperty('--openide-review-header-width');
			this.breadcrumbs?.style.removeProperty('--openide-review-fade-width');
			this.dom.remove();
		}
		this.breadcrumbs = undefined;
		this.dom.classList.remove('in-breadcrumbs');
		if (this.mounted !== 'overlay') { this.editor.addOverlayWidget(this); }
		this.mounted = 'overlay';
	}

	private unmount(): void {
		if (this.mounted === 'overlay') { this.editor.removeOverlayWidget(this); }
		this.breadcrumbs?.classList.remove('openide-review-host');
		this.breadcrumbs?.style.removeProperty('--openide-review-header-width');
		this.breadcrumbs?.style.removeProperty('--openide-review-fade-width');
		this.dom.remove();
		this.breadcrumbs = undefined;
		this.mounted = undefined;
	}

	getId(): string { return 'openide.review.header'; }
	getDomNode(): HTMLElement { return this.dom; }
	getPosition() { return { preference: OverlayWidgetPositionPreference.TOP_RIGHT_CORNER }; }

	update(pendingPaths: string[], path: string, blocks: number, currentBlock = -1): void {
		const idx = pendingPaths.indexOf(path);
		const totalFiles = Math.max(1, pendingPaths.length);
		this.fileLabel.textContent = totalFiles > 1
			? localize('openide.review.fileOf', "{0} of {1} Files", (idx >= 0 ? idx + 1 : 1), totalFiles)
			: localize('openide.review.oneFile', "1 of 1 File");
		for (const button of this.fileNavButtons) {
			button.disabled = totalFiles < 2;
		}
		this.blockLabel.textContent = blocks > 0
			? localize('openide.review.blockOf', "{0} of {1}", Math.max(0, currentBlock) + 1, blocks)
			: localize('openide.review.noBlocks', "0 of 0");
		this.remount();
	}
}

/** Controller: one session per editor+path; auto-attaches when activating an editor with a pending path. */
export class OpenideEditReview extends Disposable {

	private readonly sessions = new Map<string, { session: ReviewSession; store: DisposableStore }>();
	/** In-flight async attach per path: concurrent calls AWAIT it (they do not drop the click). */
	private readonly attaching = new Map<string, Promise<boolean>>();
	private readonly ctxReviewActive;

	constructor(
		private readonly snapshot: OpenideDiffSnapshotProvider,
		private readonly host: IEditReviewHost,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.ctxReviewActive = CTX_OPENIDE_REVIEW_ACTIVE.bindTo(contextKeyService);
		// auto-attach: opening a file with pending changes by hand also shows the review
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.attachActive();
			this.updateContext();
		}));
		// Restored editors may exist before this service is constructed.
		timeout(0).then(() => this.attachActive());
	}

	/** Session of the focused/active editor (the keybindings operate on it). */
	private activeSession(): ReviewSession | undefined {
		const editor = this.codeEditorService.getFocusedCodeEditor() ?? this.codeEditorService.getActiveCodeEditor();
		if (!editor) {
			return undefined;
		}
		for (const { session } of this.sessions.values()) {
			if (session.codeEditor === editor) {
				return session;
			}
		}
		return undefined;
	}

	private updateContext(): void {
		this.ctxReviewActive.set(!!this.activeSession());
	}

	/** Entry point for the commands/keybindings (Ctrl+N, Ctrl+Y, Ctrl+Enter…). */
	runAction(action: ReviewAction): void {
		this.activeSession()?.runAction(action);
	}

	private refreshSessionChrome(): void {
		for (const { session } of this.sessions.values()) { session.refreshChrome(); }
	}

	/** Opens the file in the normal editor and attaches the review (replacing vscode.diff). It
	 *  attaches the explicit path DIRECTLY (it does not depend on the `pendingPaths()` gate, which
	 *  is empty after a restart): the baseline resolves against git HEAD then → the diff survives reloads. */
	async openReview(path: string, preserveFocus = false, follow?: { startLine?: number; endLine?: number }): Promise<void> {
		const uri = this.host.resolveUri(path);
		if (!uri) {
			throw new Error(`No se pudo resolver el archivo para revisar: ${path}`);
		}
		// Force the native TEXT editor. Without `override`, .md (and other custom editors) open the
		// preview/webview: there is no ICodeEditor with a model → the file looks "flat" and the
		// integrated review (green/red + Undo/Keep) never attaches. This is exactly the
		// "the chat has a diff, the editor does not" symptom.
		await this.editorService.openEditor({
			resource: uri,
			options: { pinned: true, preserveFocus, override: DEFAULT_EDITOR_ASSOCIATION.id },
		});
		// Tools write with IFileService (disk), not through textFileService: if the file was already
		// open, Monaco may keep showing the baseline. We reload the clean model before attaching the
		// decorations; we never clobber a user's dirty buffer.
		await this.reloadFromDisk(path);
		// openEditor can resolve BEFORE Monaco has the model: wait for the editor whose model.uri
		// matches; otherwise the file opened without the green/red decorations.
		const editor = await this.waitForEditorWithModel(uri);
		if (!editor) {
			throw new Error(`No se pudo abrir el editor de texto para revisar: ${path}`);
		}
		const attached = await this.attach(path, editor);
		if (!attached) {
			throw new Error(`No se pudo activar el review del agente para: ${path}`);
		}
		if (follow) {
			await this.sessions.get(path)?.session.followRange(follow.startLine, follow.endLine);
		}
	}

	/** Editor (focused/active o cualquiera listado) cuyo modelo actual es exactamente `uri`. */
	private findEditorForUri(uri: URI): ICodeEditor | undefined {
		const target = uri.toString();
		const preferred = this.codeEditorService.getFocusedCodeEditor() ?? this.codeEditorService.getActiveCodeEditor();
		if (preferred?.getModel()?.uri.toString() === target) {
			return preferred;
		}
		for (const editor of this.codeEditorService.listCodeEditors()) {
			if (editor.getModel()?.uri.toString() === target) {
				return editor;
			}
		}
		return undefined;
	}

	/** Refreshes a text model from disk only when it has no unsaved local changes. */
	private async refreshModelFromDisk(uri: URI): Promise<void> {
		if (this.textFileService.files.get(uri)?.isDirty()) {
			return;
		}
		try {
			await this.textFileService.files.resolve(uri, {
				reload: { async: false },
				forceReadFromFile: true,
				reason: TextFileResolveReason.OTHER,
			});
		} catch {
			/* deleted / binary file: the caller decides whether the review can still attach */
		}
	}

	/** Forces a read of the open file after an agent write. */
	async reloadFromDisk(path: string): Promise<void> {
		const uri = this.host.resolveUri(path);
		if (!uri) {
			return;
		}
		await this.refreshModelFromDisk(uri);
		this.sessions.get(path)?.session.refresh();
	}

	/** The agent's write is asynchronous with respect to the file watcher. Waiting explicitly for
	 *  the refreshed model before attaching the review eliminates the "the chat has a diff,
	 *  Monaco abre el archivo plano". */
	private async attachAfterReload(path: string): Promise<void> {
		const uri = this.host.resolveUri(path);
		if (!uri) {
			return;
		}
		await this.refreshModelFromDisk(uri);
		const live = this.findEditorForUri(uri);
		if (live) {
			await this.attach(path, live);
		}
	}

	/** Waits for a code editor holding `uri`'s model to exist (cap ~5s). */
	private waitForEditorWithModel(uri: URI, timeoutMs = 5000): Promise<ICodeEditor | undefined> {
		const existing = this.findEditorForUri(uri);
		if (existing) {
			return Promise.resolve(existing);
		}
		return new Promise<ICodeEditor | undefined>(resolve => {
			const store = new DisposableStore();
			let settled = false;
			const finish = (editor?: ICodeEditor) => {
				if (settled) {
					return;
				}
				settled = true;
				store.dispose();
				resolve(editor);
			};
			const check = () => {
				const found = this.findEditorForUri(uri);
				if (found) {
					finish(found);
				}
			};
			store.add(this.codeEditorService.onCodeEditorAdd(ed => {
				check();
				store.add(ed.onDidChangeModel(() => check()));
			}));
			store.add(this.editorService.onDidActiveEditorChange(() => check()));
			for (const ed of this.codeEditorService.listCodeEditors()) {
				store.add(ed.onDidChangeModel(() => check()));
			}
			timeout(timeoutMs).then(() => finish(this.findEditorForUri(uri)));
		});
	}

	private attachActive(): void {
		const editor = this.codeEditorService.getFocusedCodeEditor() ?? this.codeEditorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (!editor || !model) {
			return;
		}
		for (const path of this.snapshot.pendingPaths()) {
			const uri = this.host.resolveUri(path);
			if (uri && uri.toString() === model.uri.toString()) {
				void this.attachAfterReload(path);
				return;
			}
		}
	}

	/** Attaches the review to ANY already-open editor with this path. Called by the service when
	 *  the agent edits a file: if it is already open in Monaco, the diff appears ON ITS OWN, without
	 *  que clickear la card del chat. */
	attachIfOpen(path: string): void {
		const uri = this.host.resolveUri(path);
		if (!uri) {
			return;
		}
		const editor = this.findEditorForUri(uri);
		if (editor) {
			void this.attachAfterReload(path);
		}
		this.updateContext();
	}

	private async attach(path: string, editor: ICodeEditor): Promise<boolean> {
		const existing = this.sessions.get(path);
		if (existing) {
			// Same session already alive: just repaint (repeated click in the tray / Review).
			if (existing.session.codeEditor === editor) {
				existing.session.refresh();
				this.updateContext();
				return true;
			}
			// The path ended up attached to ANOTHER editor (e.g. preview → text): re-attach.
			this.detach(path);
		}
		// If an attach is already in flight, AWAIT it (do not drop the user's click).
		const inflight = this.attaching.get(path);
		if (inflight) {
			await inflight;
			const after = this.sessions.get(path);
			if (after) {
				after.session.refresh();
				this.updateContext();
				return true;
			}
			// the previous attach aborted: retry below
		}

		const run = (async (): Promise<boolean> => {
			// Baseline: we prefer the live session's one (precise + instant). When there is none
			// (e.g. after a restart) we fall back to git HEAD → the review survives reloads.
			let baseline = this.snapshot.getBaseline(path);
			if (baseline === undefined) {
				const gitBaseline = await this.host.gitBaseline?.(path);
				baseline = gitBaseline ?? '';
				// After a workbench reload the live snapshot no longer exists. Materializing the
				// fallback keeps navigation, Undo/Keep and future edits coherent.
				this.snapshot.setBaselineOnce(path, baseline, gitBaseline !== undefined);
			}
			if (this.sessions.has(path)) {
				this.sessions.get(path)?.session.refresh();
				return true;
			}
			const expected = this.host.resolveUri(path);
			if (!expected) {
				return false;
			}
			// After awaiting the baseline the editor may have lost the model (preview→text swap).
			// Wait again: a silent return here was the "opens the file flat with no diff" bug.
			let live = this.findEditorForUri(expected);
			if (!live || live.getModel()?.uri.toString() !== expected.toString()) {
				live = await this.waitForEditorWithModel(expected, 3000);
			}
			if (!live || live.getModel()?.uri.toString() !== expected.toString()) {
				return false;
			}
			editor = live;
			const store = new DisposableStore();
			const session = new ReviewSession(path, editor, this.snapshot, baseline, this.host, this.textFileService, () => this.detach(path), () => this.refreshSessionChrome());
			session.hopRequest = p => this.openReview(p);
			store.add(session);
			store.add(editor.onDidDispose(() => this.detach(path)));
			// Detach only when the model moves to ANOTHER path. An intermediate clear (null) or a swap
			// of the same URI (openEditor → setModel) must not erase the review.
			store.add(editor.onDidChangeModel(e => {
				const still = this.host.resolveUri(path);
				if (!still) {
					this.detach(path);
					return;
				}
				const expectedUri = still.toString();
				const next = e.newModelUrl?.toString();
				if (next === expectedUri) {
					this.sessions.get(path)?.session.refresh();
					return;
				}
				if (!next) {
					// transient clear during reload: re-check on the next tick
					timeout(0).then(() => {
						if (!this.sessions.has(path)) {
							return;
						}
						const model = editor.getModel();
						if (model?.uri.toString() === expectedUri) {
							this.sessions.get(path)?.session.refresh();
						} else {
							this.detach(path);
						}
					});
					return;
				}
				this.detach(path);
			}));
			this.sessions.set(path, { session, store });
			this.refreshSessionChrome();
			this.updateContext();
			return true;
			})();

			this.attaching.set(path, run);
			try {
				return await run;
			} finally {
				if (this.attaching.get(path) === run) {
					this.attaching.delete(path);
				}
			}
		}

	/** Closes a path's session (resolved from the chat tray or from here). */
	detach(path: string): void {
		const entry = this.sessions.get(path);
		if (entry) {
			this.sessions.delete(path);
			entry.store.dispose();
		}
		this.refreshSessionChrome();
		this.updateContext();
	}

	override dispose(): void {
		for (const path of [...this.sessions.keys()]) {
			this.detach(path);
		}
		super.dispose();
	}
}
