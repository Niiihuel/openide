/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — PLAN MODE EditorPane, native.
 *
 *  It takes the REAL URI of .openide/plans/<slug>.md, reads it with IFileService and renders it
 *  in the workbench DOM: the prose through the chat's markdown renderer (tokenized code blocks,
 *  tables, copy buttons, link hovers), the ```mermaid fences through the native diagram engine,
 *  and the "## Tareas" section as an interactive task list that rewrites the file through the
 *  agent service. The model chip and the run button live in the breadcrumb
 *  (openidePlanBreadcrumbActions.ts); the document only keeps the "follow the agent" strip.
 *
 *  It replaces the webview of the same name (removed with it): every feature of that HTML is
 *  here, ported to DOM builders — no `innerHTML`, no message bus, no second scrollbar.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, getWindow, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { t } from '../../common/openideStrings.js';
import { OpenideChatMarkdownRenderer } from '../chat/openideChatMarkdown.js';
import { OPENIDE_CHAT_MARKDOWN_CLASS } from '../chat/parts/openideChatMarkdownPart.js';
import { renderOpenideDiagram } from '../diagrams/openideDiagramRender.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { OpenidePlanInput } from '../openidePlanInput.js';
import { applyOpenideSurfaceCss } from '../openideSurfaceStyle.js';
import '../chat/media/openideChatMarkdown.css';
import './media/openidePlan.css';

/** One task of the "## Tareas" section; `editing` marks the inline input of a step being added. */
interface IPlanTask {
	text: string;
	done: boolean;
	editing?: boolean;
}

type TaskChange = 'added' | 'done' | 'undone';

interface IPlanState {
	markdown: string;
	followAgent: boolean;
	buildBusy: boolean;
	buildCompleted: boolean;
	buildError: string;
	drafting: boolean;
}

/** The webview's `stripFrontmatter`: the body is what the reader sees, the frontmatter is data. */
export function stripPlanFrontmatter(markdown: string): string {
	if (!markdown.startsWith('---')) {
		return markdown;
	}
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) {
		return markdown;
	}
	return markdown.slice(end + 4).replace(/^\s+/, '');
}

/** The webview's `splitTasks`: the LAST "## Tareas|Tasks|To-dos" heading opens the task list. */
export function splitPlanTasks(markdown: string): { body: string; tasks: IPlanTask[] } {
	const lines = markdown.split('\n');
	let index = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^##\s+(Tareas|Tasks|To-?dos?)\b/i.test(lines[i])) {
			index = i;
		}
	}
	if (index < 0) {
		return { body: markdown, tasks: [] };
	}
	const body = lines.slice(0, index).join('\n').replace(/\s+$/, '');
	const tasks: IPlanTask[] = [];
	for (let j = index + 1; j < lines.length; j++) {
		const match = lines[j].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
		if (match) {
			tasks.push({ text: match[2].trim(), done: match[1].toLowerCase() === 'x' });
			continue;
		}
		if (/^#{1,6}\s/.test(lines[j])) {
			break;
		}
	}
	return { body, tasks };
}

/**
 * The webview's `diffTasks`: compares the next list against the LAST RENDERED one to know what
 * to animate. A consumable pool, not a map — two tasks may share a text and a map would collapse
 * them, inventing changes where there are none.
 */
export function diffPlanTasks(previous: readonly IPlanTask[] | undefined, next: readonly IPlanTask[]): (TaskChange | undefined)[] {
	if (!previous) {
		return [];
	}
	const pool = previous.map(task => ({ text: task.text, done: !!task.done, used: false }));
	const take = (text: string) => {
		for (const entry of pool) {
			if (!entry.used && entry.text === text) {
				entry.used = true;
				return entry;
			}
		}
		return undefined;
	};
	const changes: (TaskChange | undefined)[] = [];
	next.forEach((task, index) => {
		if (task.editing) {
			return; // the row being typed is animated by its own input
		}
		const before = take(task.text);
		if (!before) {
			changes[index] = 'added';
		} else if (before.done !== !!task.done) {
			changes[index] = task.done ? 'done' : 'undone';
		}
	});
	return changes;
}

const DIAGRAM_LANGS = new Set(['mermaid', 'flowchart', 'diagram', 'openide-diagram']);

type PlanSegment = { kind: 'markdown'; text: string } | { kind: 'diagram'; source: string };

/**
 * Cuts the body at its diagram fences. Everything else stays one markdown string per run, so
 * lists and paragraphs that straddle a fence are not broken any further than the fence itself.
 */
export function splitPlanSegments(body: string): PlanSegment[] {
	const segments: PlanSegment[] = [];
	const fence = /```([^\n]*)\n([\s\S]*?)```/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = fence.exec(body))) {
		const lang = match[1].trim().toLowerCase();
		if (!DIAGRAM_LANGS.has(lang)) {
			continue;
		}
		if (match.index > last) {
			segments.push({ kind: 'markdown', text: body.slice(last, match.index) });
		}
		segments.push({ kind: 'diagram', source: match[2] });
		last = match.index + match[0].length;
	}
	if (last < body.length) {
		segments.push({ kind: 'markdown', text: body.slice(last) });
	}
	return segments;
}

function icon(id: ThemeIcon): HTMLElement {
	return $(`span.${ThemeIcon.asClassName(id).replace(/ /g, '.')}`);
}

const SELF_WRITE_GRACE_MS = 400;
const PULSE_MS = 900;

export class OpenidePlanEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openidePlan';

	private root!: HTMLElement;
	private doc!: HTMLElement;
	private scrollable!: DomScrollableElement;
	private followHost!: HTMLElement;
	private mdHost!: HTMLElement;
	private skeleton!: HTMLElement;
	private tasksHost!: HTMLElement;

	private readonly renderer: OpenideChatMarkdownRenderer;
	/** Rendered markdown results and their link hovers; cleared before every repaint. */
	private readonly rendered = this._register(new DisposableStore());
	private readonly followRendered = this._register(new DisposableStore());
	private readonly rowListeners = this._register(new DisposableStore());
	private readonly watcher = this._register(new MutableDisposable());
	private readonly inputDisposables = this._register(new DisposableStore());

	private state: IPlanState = { markdown: '', followAgent: false, buildBusy: false, buildCompleted: false, buildError: '', drafting: false };
	private tasks: IPlanTask[] = [];
	private lastRenderedTasks: IPlanTask[] | undefined;
	private pulseTimer: ReturnType<typeof setTimeout> | undefined;

	private inputGeneration = 0;
	private contentRequest = 0;
	private lastSelfWrite: { uri: string; at: number } | undefined;
	private taskWriteQueue: Promise<void> = Promise.resolve();
	private readonly lastMarkdownByResource = new Map<string, string>();

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
	) {
		super(OpenidePlanEditor.ID, group, telemetryService, themeService, storageService);
		this.renderer = instantiationService.createInstance(OpenideChatMarkdownRenderer);
	}

	protected createEditor(parent: HTMLElement): void {
		applyOpenideSurfaceCss();
		this.root = append(parent, $('.openide-plan'));
		this.doc = $('.openide-plan-doc');
		const wrap = append(this.doc, $('.openide-plan-wrap'));
		this.followHost = append(wrap, $('.openide-plan-follow-host'));
		this.mdHost = append(wrap, $('.openide-plan-md'));
		this.skeleton = append(wrap, $('.openide-plan-skeleton.hidden'));
		this.tasksHost = append(wrap, $('.openide-plan-tasks-host'));
		this.scrollable = this._register(new DomScrollableElement(this.doc, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(this.root, this.scrollable.getDomNode());

		// Build with the keyboard (⌘↵ / Ctrl+↵), unless the user is typing a task.
		this._register(addDisposableListener(this.root, 'keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
				return;
			}
			const tag = (event.target as HTMLElement | null)?.tagName ?? '';
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				event.preventDefault();
				this.build();
			}
		}));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}
		this.armWatcher();
		const current = this.input instanceof OpenidePlanInput ? this.input.resource : undefined;
		await this.refresh(current, this.inputGeneration);
	}

	override clearInput(): void {
		this.watcher.clear();
		this.inputDisposables.clear();
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
		this.scrollable.scanDomNode();
	}

	override focus(): void {
		super.focus();
		this.root.focus();
	}

	// ---- content -------------------------------------------------------------------------------

	/** Re-reads when the .md changes on disk (model, tasks, or the agent ticking it). */
	private armWatcher(): void {
		this.inputGeneration++;
		this.inputDisposables.clear();
		const input = this.input;
		if (!(input instanceof OpenidePlanInput)) {
			this.watcher.clear();
			return;
		}
		const uri = input.resource;
		this.watcher.value = this.fileService.onDidFilesChange(e => {
			if (e.contains(uri) && (!this.lastSelfWrite || this.lastSelfWrite.uri !== uri.toString() || Date.now() - this.lastSelfWrite.at >= SELF_WRITE_GRACE_MS)) {
				void this.refresh(uri, this.inputGeneration);
			}
		});
		this.inputDisposables.add(this.agentService.onDidChangePlanBuild(event => {
			if (event.resource.toString() === uri.toString()) {
				void this.refresh(uri, this.inputGeneration);
			}
		}));
		this.inputDisposables.add(this.agentService.onDidChangePlanFollow(enabled => {
			this.state = { ...this.state, followAgent: enabled };
			this.renderFollow();
			this.scrollable.scanDomNode();
		}));
		// The plan is being written RIGHT NOW: every model delta repaints the document. The file
		// does not exist on disk yet, so the watcher above sees nothing.
		this.inputDisposables.add(this.agentService.onDidChangePlanDraft(draft => {
			if (draft.resource.toString() === uri.toString()) {
				void this.refresh(uri, this.inputGeneration);
			}
		}));
	}

	private async refresh(expectedResource?: URI, expectedGeneration?: number): Promise<void> {
		const request = ++this.contentRequest;
		const input = this.input;
		if (!(input instanceof OpenidePlanInput)) {
			return;
		}
		// Draft in flight: the .md does not exist yet (or lags behind the latest delta). While it
		// lasts the DRAFT wins — reading the disk would give empty and the document would flicker.
		const draft = this.agentService.getPlanDraft(input.resource);
		if (draft && !draft.done) {
			this.state = { markdown: draft.markdown, followAgent: this.agentService.isPlanFollowEnabled(), buildBusy: false, buildCompleted: false, buildError: '', drafting: true };
			this.renderAll();
			return;
		}
		let markdown = '';
		try {
			markdown = (await this.fileService.readFile(input.resource)).value.toString();
		} catch {
			markdown = this.lastMarkdownByResource.get(input.resource.toString()) ?? '';
		}
		if (markdown) {
			this.lastMarkdownByResource.set(input.resource.toString(), markdown);
			await this.agentService.reconcilePlanBuild(input.resource, markdown);
		}
		const stale = input.resource.toString() !== (expectedResource ?? input.resource).toString()
			|| (expectedGeneration !== undefined && expectedGeneration !== this.inputGeneration)
			|| request !== this.contentRequest
			|| this.input !== input;
		if (stale) {
			return;
		}
		this.state = {
			markdown,
			followAgent: this.agentService.isPlanFollowEnabled(),
			buildBusy: this.agentService.isPlanBuildRunning(input.resource),
			buildCompleted: this.agentService.isPlanBuildCompleted(input.resource),
			buildError: '',
			drafting: false,
		};
		this.renderAll();
	}

	private build(): void {
		const input = this.input;
		if (!(input instanceof OpenidePlanInput)) {
			return;
		}
		const uri = input.resource;
		void this.commandService.executeCommand('workbench.view.openideChat.view.focus')
			.then(() => this.agentService.buildPlan(uri), () => this.agentService.buildPlan(uri))
			.catch(error => {
				this.state = { ...this.state, buildBusy: false, buildCompleted: false, buildError: error instanceof Error ? error.message : String(error) };
				this.renderFollow();
			});
	}

	// ---- rendering -------------------------------------------------------------------------------

	private renderAll(): void {
		const previousTop = this.scrollable.getScrollPosition().scrollTop;
		// Was the reader at the end? Then the text that keeps arriving must follow. If they went up
		// to read, no: dragging the view while they read is worse than not following.
		const dims = this.scrollable.getScrollDimensions();
		const stuckToEnd = dims.scrollHeight - previousTop - dims.height < 40;

		const markdown = stripPlanFrontmatter(this.state.markdown || '');
		const parts = splitPlanTasks(markdown);
		this.renderBody(parts.body);
		this.tasks = parts.tasks;
		const changedRow = this.renderTasks();
		// Tasks come at the end of the plan: offering "0 To-dos / Nuevo" while it is being written
		// is offering to edit a list the model is still about to dictate.
		this.tasksHost.classList.toggle('hidden', this.state.drafting && !this.tasks.length);
		this.renderFollow();
		this.renderSkeleton();

		this.scrollable.scanDomNode();
		if (this.state.drafting) {
			this.scrollable.setScrollPosition({ scrollTop: stuckToEnd ? this.scrollable.getScrollDimensions().scrollHeight : previousTop });
		} else if (this.state.followAgent) {
			this.revealTasks(changedRow);
			// Diagrams and code blocks settle their heights after the first paint; re-anchoring on
			// the next frame keeps the to-dos in view during the agent's automatic updates.
			scheduleAtNextAnimationFrame(getWindow(this.root), () => { this.scrollable.scanDomNode(); this.revealTasks(changedRow); });
		} else {
			this.scrollable.setScrollPosition({ scrollTop: previousTop });
		}
	}

	/**
	 * The prose: diagram fences go to the native engine, everything else to the chat's markdown
	 * renderer. Disposed BEFORE rendering: its link hovers hang off these nodes and its pending
	 * tokenizations write back by `data-code` lookup, so a slow highlight from three deltas ago
	 * must find its render already dead.
	 */
	private renderBody(body: string): void {
		this.rendered.clear();
		clearNode(this.mdHost);
		const doc = this.mdHost.ownerDocument;
		for (const segment of splitPlanSegments(body)) {
			if (segment.kind === 'diagram') {
				this.mdHost.appendChild(this.renderDiagram(doc, segment.source));
				continue;
			}
			if (!segment.text.trim()) {
				continue;
			}
			const host = append(this.mdHost, $(`div.${OPENIDE_CHAT_MARKDOWN_CLASS}.openide-plan-prose`));
			const result = this.renderer.render(
				new MarkdownString(segment.text, { isTrusted: false, supportThemeIcons: false }),
				{
					// A half-written ** pair or ` would otherwise render as literal marks that flip
					// to formatting on the next delta — one flicker per bold word of the plan.
					fillInIncompleteTokens: this.state.drafting,
					asyncRenderCallback: () => this.scrollable.scanDomNode(),
				},
				host,
			);
			this.rendered.add(result);
		}
		// The caret only makes sense when there is something written to follow.
		if (this.state.drafting && body.trim()) {
			this.placeCaret(this.mdHost);
		}
	}

	private renderDiagram(doc: Document, source: string): HTMLElement {
		const render = renderOpenideDiagram(doc, source);
		if (!render) {
			// Not a diagram after all: the source, readable, exactly like the webview's fallback.
			const wrap = $('div.openide-plan-diagram-code');
			const pre = append(wrap, $('pre'));
			pre.textContent = source;
			return wrap;
		}
		if (render.svg) {
			const svg = render.svg;
			const button = $('button.openide-diagram-full') as HTMLButtonElement;
			button.type = 'button';
			button.title = t('plan.diagram.fullscreen');
			button.setAttribute('aria-label', t('plan.diagram.fullscreen'));
			append(button, icon(Codicon.screenFull));
			render.domNode.insertBefore(button, render.domNode.firstChild);
			this.rendered.add(addDisposableListener(button, 'click', event => {
				event.stopPropagation();
				// The same native modal (zoom/pan) the chat uses.
				void this.commandService.executeCommand('openide.diagram.fullscreen', svg.outerHTML, t('plan.diagram.title')).then(undefined, () => { /* already visible inline */ });
			}));
		}
		return render.domNode;
	}

	/** Last child that is visible (skips the whitespace markdown leaves between blocks). */
	private lastVisibleNode(element: HTMLElement): ChildNode | undefined {
		for (let i = element.childNodes.length - 1; i >= 0; i--) {
			const node = element.childNodes[i];
			if (node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim()) {
				continue;
			}
			return node;
		}
		return undefined;
	}

	/**
	 * Caret at the end of what has been written, on the DEEPEST node: pinned on the container's
	 * last child it landed under a list instead of after its last line. Descends only while the
	 * last child is an element: loose text after it (a bold mid-line) keeps the caret outside.
	 */
	private placeCaret(host: HTMLElement): void {
		let element: HTMLElement = host;
		for (; ;) {
			const last = this.lastVisibleNode(element);
			if (!last || last.nodeType !== Node.ELEMENT_NODE) {
				break;
			}
			element = last as HTMLElement;
		}
		if (element === host) {
			return;
		}
		append(element, $('span.openide-plan-caret'));
	}

	/**
	 * Skeleton bars while the model keeps writing. With nothing yet a whole document is drawn
	 * (title + paragraphs); with text already there, only the rest — so skeleton to content is
	 * not a cut, it is the same thing filling up.
	 */
	private renderSkeleton(): void {
		clearNode(this.skeleton);
		if (!this.state.drafting) {
			this.skeleton.classList.add('hidden');
			return;
		}
		const empty = !stripPlanFrontmatter(this.state.markdown || '').trim();
		const rows = empty
			? ['sk-title', 'w95', 'w88', 'w72', 'sk-heading', 'w95', 'w60']
			: ['w88', 'w95', 'w60'];
		for (const row of rows) {
			append(this.skeleton, $(`div.openide-plan-sk-line.${row}`));
		}
		this.skeleton.classList.remove('hidden');
	}

	private renderFollow(): void {
		this.followRendered.clear();
		clearNode(this.followHost);
		if (!this.state.followAgent) {
			return;
		}
		const bar = append(this.followHost, $('.openide-plan-follow'));
		const label = append(bar, $('span'));
		label.textContent = this.state.buildBusy ? t('plan.follow.running') : this.state.buildCompleted ? t('plan.follow.done') : t('plan.follow.idle');
		if (this.state.buildBusy) {
			label.setAttribute('aria-live', 'polite');
		}
		if (this.state.buildError) {
			label.textContent = this.state.buildError;
			bar.classList.add('error');
		}
		append(bar, $('span.openide-plan-follow-spacer'));
		if (this.state.buildBusy) {
			append(bar, icon(ThemeIcon.modify(Codicon.loading, 'spin')));
		}
		const toggle = append(bar, $('button.openide-plan-follow-toggle', { type: 'button' })) as HTMLButtonElement;
		toggle.textContent = t('plan.follow.stop');
		this.followRendered.add(addDisposableListener(toggle, 'click', () => {
			this.state = { ...this.state, followAgent: false };
			this.agentService.setPlanFollowEnabled(false);
			this.renderFollow();
		}));
	}

	// ---- tasks -----------------------------------------------------------------------------------

	private pushTasks(): void {
		const input = this.input;
		if (!(input instanceof OpenidePlanInput)) {
			return;
		}
		const uri = input.resource;
		const tasks = this.tasks.filter(task => !task.editing).map(task => ({ text: task.text, done: !!task.done }));
		this.lastSelfWrite = { uri: uri.toString(), at: Date.now() };
		this.taskWriteQueue = this.taskWriteQueue
			.catch(() => undefined)
			.then(() => this.agentService.updatePlanTasks(uri, tasks))
			.then(() => this.refresh(uri, this.inputGeneration));
	}

	private addNewTask(): void {
		this.tasks.push({ text: '', done: false, editing: true });
		this.renderTasks();
	}

	/**
	 * Render by DIFF. Rebuilding the list from scratch on every update gave the browser nothing to
	 * animate against: there was no "this row became done", only "a done row appeared". Comparing
	 * with the LAST RENDERED list gives both what to animate and which row to scroll to when the
	 * agent works alone.
	 */
	private renderTasks(): HTMLElement | undefined {
		const changes = diffPlanTasks(this.lastRenderedTasks, this.tasks);
		this.lastRenderedTasks = this.tasks.map(task => ({ text: task.text, done: !!task.done }));
		this.rowListeners.clear();
		clearNode(this.tasksHost);
		if (this.pulseTimer) {
			clearTimeout(this.pulseTimer);
			this.pulseTimer = undefined;
		}

		const box = append(this.tasksHost, $('.openide-plan-tasks'));
		const head = append(box, $('.openide-plan-tasks-head'));
		const count = append(head, $('span.openide-plan-tasks-count'));
		count.textContent = this.tasks.length === 1 ? t('plan.tasks.one') : t('plan.tasks.count', this.tasks.length);
		append(head, $('span.openide-plan-tasks-spacer'));
		const add = append(head, $('button.openide-plan-tasks-add', { type: 'button' })) as HTMLButtonElement;
		append(add, icon(Codicon.add));
		append(add, $('span', undefined, t('plan.tasks.new')));
		this.rowListeners.add(addDisposableListener(add, 'click', () => this.addNewTask()));

		const pulsed: HTMLElement[] = [];
		this.tasks.forEach((task, index) => {
			const row = append(box, $(`.openide-plan-task${task.done ? '.done' : ''}`));
			const circle = append(row, $('button.openide-plan-task-circle', { type: 'button' })) as HTMLButtonElement;
			circle.title = task.done ? t('plan.task.markPending') : t('plan.task.markDone');
			append(circle, icon(task.done ? Codicon.passFilled : Codicon.circleLargeOutline));
			this.rowListeners.add(addDisposableListener(circle, 'click', () => {
				this.tasks[index].done = !this.tasks[index].done;
				this.renderTasks();
				this.pushTasks();
			}));
			if (task.editing) {
				// New step: inline input; Enter confirms, Escape or empty discards.
				const inputEl = append(row, $('input.openide-plan-task-input', { type: 'text', placeholder: t('plan.task.placeholder') })) as HTMLInputElement;
				inputEl.value = task.text || '';
				const commit = (keep: boolean) => {
					if (!this.tasks[index] || !this.tasks[index].editing) {
						return; // already resolved (Enter + blur must not commit twice)
					}
					const value = inputEl.value.trim();
					delete this.tasks[index].editing;
					if (keep && value) {
						this.tasks[index].text = value;
					} else {
						this.tasks.splice(index, 1);
					}
					this.renderTasks();
					this.pushTasks();
				};
				this.rowListeners.add(addDisposableListener(inputEl, 'keydown', (event: KeyboardEvent) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						commit(true);
					} else if (event.key === 'Escape') {
						event.preventDefault();
						commit(false);
					}
				}));
				this.rowListeners.add(addDisposableListener(inputEl, 'blur', () => commit(true)));
				scheduleAtNextAnimationFrame(getWindow(this.root), () => inputEl.focus());
			} else {
				const text = append(row, $('div.openide-plan-task-text'));
				text.textContent = task.text;
				const remove = append(row, $('button.openide-plan-task-del', { type: 'button' })) as HTMLButtonElement;
				remove.title = t('plan.task.remove');
				append(remove, icon(Codicon.close));
				this.rowListeners.add(addDisposableListener(remove, 'click', () => {
					this.tasks.splice(index, 1);
					this.renderTasks();
					this.pushTasks();
				}));
			}
			const change = changes[index];
			if (change) {
				row.classList.add(`tk-just-${change}`);
				pulsed.push(row);
			}
		});

		// The class is removed when the pulse ends: it is a pulse, not a state. Left in place, the
		// next update could not animate the same row again.
		if (pulsed.length) {
			this.pulseTimer = setTimeout(() => {
				for (const row of pulsed) {
					row.classList.remove('tk-just-done', 'tk-just-undone', 'tk-just-added');
				}
				this.pulseTimer = undefined;
			}, PULSE_MS);
		}
		this.scrollable.scanDomNode();
		return pulsed[0];
	}

	/**
	 * Brings the row that JUST changed into view; with no change, the task block. Always anchoring
	 * the container was the bug: with 14 to-dos the one the agent ticked could sit half a screen
	 * below the anchor and never be seen.
	 */
	private revealTasks(changedRow: HTMLElement | undefined): void {
		if (!this.state.followAgent) {
			return;
		}
		const target = changedRow ?? this.tasksHost.querySelector<HTMLElement>('.openide-plan-tasks');
		if (!target) {
			return;
		}
		const hostRect = this.scrollable.getDomNode().getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		// A single row is centred; the whole block is anchored at the top.
		const offset = changedRow ? Math.max(12, (hostRect.height - targetRect.height) / 2) : 12;
		const delta = targetRect.top - hostRect.top - offset;
		if (Math.abs(delta) < 2) {
			return; // already where it should be: do not shake the view
		}
		this.scrollable.setScrollPosition({ scrollTop: this.scrollable.getScrollPosition().scrollTop + delta });
	}

	override dispose(): void {
		if (this.pulseTimer) {
			clearTimeout(this.pulseTimer);
		}
		super.dispose();
	}
}
