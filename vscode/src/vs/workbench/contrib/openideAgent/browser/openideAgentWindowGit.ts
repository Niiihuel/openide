/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { openideCheckboxStyles } from './openideControlStyles.js';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, IQuickWidget } from '../../../../platform/quickinput/common/quickInput.js';
import { IResourceMultiDiffEditorInput } from '../../../common/editor.js';
import { ISCMHistoryItemRef } from '../../scm/common/history.js';
import { InputValidationType, ISCMRepository } from '../../scm/common/scm.js';
import { t } from '../common/openideStrings.js';
import { createOpenideElement } from './openideDom.js';
import './chat/media/openideAgentWindowSearch.css';

export interface IOpenideAgentWindowGitActions {
	getRepository(): ISCMRepository | undefined;
	openComparison(input: IResourceMultiDiffEditorInput): Promise<void>;
}

interface IGitPick extends IQuickPickItem {
	readonly ref?: ISCMHistoryItemRef;
}

/** Native Git commands and SCM history, presented in the window where the user invoked them. */
export class OpenideAgentWindowGit extends Disposable {
	private readonly anchor: HTMLElement;
	private readonly pickerStore = this._register(new DisposableStore());
	private picker: IQuickPick<IGitPick> | undefined;
	private form: IQuickWidget | undefined;
	private readonly formStore = this._register(new DisposableStore());

	constructor(
		container: HTMLElement,
		private readonly actions: IOpenideAgentWindowGitActions,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.anchor = append(container, createOpenideElement(container.ownerDocument, 'div'));
		this.anchor.className = 'openide-agent-window-search-anchor';
		this.anchor.setAttribute('aria-hidden', 'true');
		this._register(toDisposable(() => this.anchor.remove()));
	}

	showBranches(): Promise<void> { return this.showRefs(); }
	showCompare(): Promise<void> { return this.showComparison(); }

	private repository(): ISCMRepository | undefined {
		const repository = this.actions.getRepository();
		if (!repository?.provider.rootUri || repository.provider.providerId !== 'git') {
			this.notificationService.info(t('agentWindow.git.noRepository'));
			return undefined;
		}
		return repository;
	}

	private createPicker(): IQuickPick<IGitPick> {
		this.form?.hide();
		this.picker?.hide();
		const picker = this.pickerStore.add(this.quickInputService.createQuickPick<IGitPick>());
		this.picker = picker;
		picker.anchor = this.anchor;
		picker.anchorPosition = 'overlay';
		picker.modal = true;
		picker.matchOnDescription = true;
		picker.sortByLabel = false;
		this.pickerStore.add(picker.onDidHide(() => {
			this.picker = undefined;
			this.pickerStore.clear();
		}));
		return picker;
	}

	private async showRefs(): Promise<void> {
		const repository = this.repository();
		const history = repository?.provider.historyProvider.get();
		if (!repository || !history) { return; }
		const current = history.historyItemRef.get();
		const picker = this.createPicker();
		const cancellation = new CancellationTokenSource();
		this.pickerStore.add(toDisposable(() => cancellation.dispose(true)));
		picker.title = repository.provider.name;
		picker.placeholder = t('agentWindow.git.branchPlaceholder');
		picker.description = current ? t('agentWindow.git.currentBranch') + ': ' + current.name : repository.provider.rootUri?.path;
		picker.busy = true;
		this.pickerStore.add(picker.onDidAccept(() => {
			const ref = picker.selectedItems[0]?.ref;
			if (!ref || picker.busy || this.actions.getRepository()?.id !== repository.id) { return; }
			picker.hide();
			// Native Git handles local checkout and remote tracking branches.
			void this.commandService.executeCommand('git.graph.checkout', repository.provider.rootUri, { references: [ref] }, ref.id).catch(error => this.report(error));
		}));
		picker.show();
		try {
			const refs = await history.provideHistoryItemRefs(undefined, cancellation.token);
			if (cancellation.token.isCancellationRequested || picker !== this.picker) { return; }
			picker.items = (refs ?? []).filter(ref => ref.id.startsWith('refs/heads/') || ref.id.startsWith('refs/remotes/')).map(ref => ({
				label: ref.name,
				description: ref.id === current?.id ? t('agentWindow.git.currentBranch') : ref.description ?? ref.category,
				iconClass: ref.id === current?.id ? 'codicon codicon-check' : 'codicon codicon-git-branch',
				ref,
			}));
		} catch (error) { this.report(error); }
		finally { if (picker === this.picker) { picker.busy = false; } }
	}

	/** QuickWidget supplies the native overlay, focus management and Escape dismissal. */
	private createForm(title: string, repository: ISCMRepository): { form: IQuickWidget; body: HTMLElement; footer: HTMLElement } {
		this.picker?.hide();
		this.form?.hide();
		const form = this.formStore.add(this.quickInputService.createQuickWidget());
		this.form = form;
		form.anchor = this.anchor;
		form.anchorPosition = 'overlay';
		form.modal = true;
		form.ignoreFocusOut = true;
		const body = $('.openide-agent-git-form', { role: 'dialog', 'aria-label': title });
		const header = append(body, $('.openide-agent-git-header'));
		append(header, $('span.openide-agent-git-title', undefined, title));
		this.button(header, t('agentWindow.git.close'), () => form.hide(), 'ghost openide-agent-git-close');
		const context = append(body, $('.openide-agent-git-context'));
		append(context, $('span.codicon.codicon-repo', { 'aria-hidden': 'true' }));
		append(context, $('span', undefined, repository.provider.name));
		append(context, $('span.codicon.codicon-git-branch', { 'aria-hidden': 'true' }));
		append(context, $('span', undefined, repository.provider.historyProvider.get()?.historyItemRef.get()?.name ?? 'HEAD'));
		const footer = $('.openide-agent-git-footer');
		form.widget = body;
		this.formStore.add(form.onDidHide(() => {
			if (this.form === form) { this.form = undefined; this.formStore.clear(); }
		}));
		return { form, body, footer };
	}

	private button(parent: HTMLElement, label: string, run: () => void, style = ''): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.oi-btn', { type: 'button' }, label));
		for (const token of style.split(' ').filter(Boolean)) { button.classList.add(token); }
		this.formStore.add(addDisposableListener(button, 'click', run));
		return button;
	}

	showCommit(): void {
		const repository = this.repository();
		if (!repository) { return; }
		const { form, body, footer } = this.createForm(t('agentWindow.commit'), repository);
		body.classList.add('openide-agent-git-commit');
		body.querySelector('.openide-agent-git-header')?.remove();
		const context = body.querySelector<HTMLElement>('.openide-agent-git-context')!;
		clearNode(context);
		const branch = this.button(context, '', () => { void this.showBranches().catch(error => this.report(error)); }, 'ghost openide-agent-git-branch');
		append(branch, $('span.codicon.codicon-git-branch', { 'aria-hidden': 'true' }));
		append(branch, $('span', undefined, repository.provider.historyProvider.get()?.historyItemRef.get()?.name ?? 'HEAD'));
		append(branch, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
		const counts = () => ({
			staged: repository.provider.groups.find(group => group.id === 'index')?.resources.length ?? 0,
			unstaged: repository.provider.groups.filter(group => group.id === 'workingTree' || group.id === 'untracked').reduce((total, group) => total + group.resources.length, 0),
			conflicts: repository.provider.groups.find(group => group.id === 'merge')?.resources.length ?? 0,
		});
		let all = counts().staged === 0;
		const label = append(body, $('label.openide-agent-git-label'));
		const input = append(label, $<HTMLTextAreaElement>('textarea.oi-field.openide-agent-git-message', { rows: 4, 'aria-label': t('agentWindow.git.message'), placeholder: t('agentWindow.git.messagePlaceholder') }));
		input.value = repository.input.value;
		const scope = append(body, $('.openide-agent-git-scope'));
		const include = this.formStore.add(new Checkbox(t('agentWindow.git.includeUnstaged'), all, openideCheckboxStyles));
		append(scope, include.domNode);
		const includeLabel = this.button(scope, t('agentWindow.git.includeUnstaged'), () => { if (!form.busy) { include.checked = all = !all; refresh(); } }, 'ghost openide-agent-git-include-label');
		this.formStore.add(include.onChange(() => { all = include.checked; refresh(); }));
		const summary = append(scope, $('.openide-agent-git-summary'));
		const feedback = append(body, $('.openide-agent-git-feedback', { role: 'status', 'aria-live': 'polite' }));
		const action = (label: string, icon: string, mode: 'commit' | 'commitPush' | 'push') => {
			const button = this.button(footer, '', () => { void run(mode); }, 'ghost');
			button.dataset.action = mode;
			append(button, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
			append(button, $('span.openide-agent-git-action-label', undefined, label));
			return button;
		};
		const submit = action(t('agentWindow.git.commitAction'), 'git-commit', 'commit');
		append(submit, $('span.oi-kbd', undefined, 'Ctrl+Enter'));
		const commitPush = action(t('agentWindow.git.commitPush'), 'cloud-upload', 'commitPush');
		const push = action(t('agentWindow.git.push'), 'cloud-upload', 'push');
		append(body, footer);
		const refresh = () => {
			const state = counts();
			summary.textContent = t('agentWindow.git.stagedSummary', state.staged, state.unstaged);
			include.checked = all;
			if (form.busy) { include.disable(); } else { include.enable(); }
			includeLabel.disabled = input.disabled = push.disabled = branch.disabled = form.busy;
			submit.disabled = form.busy || !input.value.trim() || !!state.conflicts || !(all ? state.staged + state.unstaged : state.staged);
			commitPush.disabled = submit.disabled;
			submit.querySelector('.openide-agent-git-action-label')!.textContent = t(form.busy ? 'agentWindow.git.working' : 'agentWindow.git.commitAction');
			feedback.textContent = state.conflicts ? t('agentWindow.git.conflicts', state.conflicts) : !(state.staged + state.unstaged) ? t('agentWindow.git.clean') : '';
			body.setAttribute('aria-busy', String(form.busy));
		};
		const run = async (mode: 'commit' | 'commitPush' | 'push') => {
			const isPush = mode === 'push';
			if (form.busy || this.form !== form) { return; }
			if (this.actions.getRepository()?.id !== repository.id) { form.hide(); return; }
			const message = input.value.trim();
			if (!isPush && (!message || counts().conflicts || submit.disabled)) { return; }
			const command = isPush ? 'git.push' : all ? 'git.commitAll' : 'git.commitStaged';
			form.busy = true; refresh();
			try {
				if (!isPush) {
					const validation = await repository.input.validateInput(message, message.length);
					if (form !== this.form || input.value.trim() !== message || this.actions.getRepository()?.id !== repository.id) { return; }
					if (validation?.type === InputValidationType.Error) {
						form.busy = false; refresh();
						feedback.textContent = typeof validation.message === 'string' ? validation.message : validation.message.value;
						input.focus(); return;
					}
					if (counts().conflicts) { return; }
					repository.input.setValue(message, true);
				}
				const previousRevision = repository.provider.historyProvider.get()?.historyItemRef.get()?.revision;
				await this.commandService.executeCommand(command, repository.provider.rootUri);
				// Native commit can return after cancellation or rejected hooks. Only push a new commit.
				if (mode === 'commitPush' && this.actions.getRepository()?.id === repository.id && repository.provider.historyProvider.get()?.historyItemRef.get()?.revision && repository.provider.historyProvider.get()?.historyItemRef.get()?.revision !== previousRevision) {
					await this.commandService.executeCommand('git.push', repository.provider.rootUri);
				}
				if (this.form === form) { form.hide(); }
			} catch (error) {
				if (this.form === form) {
					form.busy = false; refresh(); feedback.textContent = error instanceof Error ? error.message : String(error);
				} else { this.report(error); }
			} finally { if (this.form === form && form.busy) { form.busy = false; refresh(); } }
		};
		this.formStore.add(repository.provider.onDidChangeResources(refresh));
		this.formStore.add(repository.provider.onDidChangeResourceGroups(refresh));
		this.formStore.add(repository.input.onDidChange(({ value }) => { if (input.value !== value) { input.value = value; refresh(); } }));
		this.formStore.add(addDisposableListener(input, 'input', () => { repository.input.setValue(input.value, true); refresh(); }));
		this.formStore.add(addDisposableListener(input, 'keydown', event => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); void run('commit'); }
		}));
		refresh(); form.show(); input.focus();
	}

	private async showComparison(): Promise<void> {
		const repository = this.repository();
		const history = repository?.provider.historyProvider.get();
		const current = history?.historyItemRef.get();
		if (!repository || !history || !current?.revision) { return; }
		const { form, body, footer } = this.createForm(t('agentWindow.compare'), repository);
		body.classList.add('openide-agent-git-compare');
		const cancellation = new CancellationTokenSource();
		this.formStore.add(toDisposable(() => cancellation.dispose(true)));
		append(body, $('.openide-agent-git-label', undefined, t('agentWindow.git.compareDirection', current.name)));
		const search = append(body, $<HTMLInputElement>('input.oi-field', { type: 'search', placeholder: t('agentWindow.git.findRef'), 'aria-label': t('agentWindow.git.findRef') }));
		const list = $('.openide-agent-git-refs', { role: 'radiogroup', 'aria-label': t('agentWindow.git.base') });
		const scroll = this.formStore.add(new DomScrollableElement(list, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		append(body, scroll.getDomNode());
		const feedback = append(body, $('.openide-agent-git-feedback', { role: 'status', 'aria-live': 'polite' }));
		let selected: ISCMHistoryItemRef | undefined;
		let refs: ISCMHistoryItemRef[] = [];
		const rowStore = this.formStore.add(new DisposableStore());
		const submit = this.button(footer, t('agentWindow.git.review'), () => { void review(); });
		submit.disabled = true;
		append(body, footer);
		const render = () => {
			rowStore.clear(); clearNode(list);
			const visible = refs.filter(ref => `${ref.name} ${ref.category ?? ''}`.toLowerCase().includes(search.value.toLowerCase()));
			for (const ref of visible) {
				const row = append(list, $<HTMLButtonElement>('button.oi-btn.ghost.oi-dock-row.openide-agent-git-ref', { type: 'button', role: 'radio', 'aria-checked': String(ref === selected) }));
				append(row, $('span.codicon', { 'aria-hidden': 'true' })).classList.add(ref === selected ? 'codicon-check' : 'codicon-git-branch');
				append(row, $('span.openide-agent-git-ref-name', undefined, ref.name));
				append(row, $('span.openide-agent-git-ref-kind', undefined, ref.category ?? ref.description ?? ''));
				row.classList.toggle('selected', ref === selected); row.disabled = form.busy;
				rowStore.add(addDisposableListener(row, 'click', () => {
					selected = ref; submit.disabled = false; feedback.textContent = t('agentWindow.git.range', ref.name, current.name); render();
					list.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
				}));
			}
			if (!visible.length) { append(list, $('.openide-agent-git-empty', undefined, t('agentWindow.git.noRefs'))); }
			scroll.scanDomNode();
		};
		const review = async () => {
			const ref = selected;
			if (!ref?.revision || form.busy || this.actions.getRepository()?.id !== repository.id) { return; }
			if (history.historyItemRef.get()?.revision !== current.revision) { void this.showComparison(); return; }
			form.busy = true; submit.disabled = search.disabled = true; render();
			feedback.textContent = t('agentWindow.git.working');
			try {
				const changes = await history.provideHistoryItemChanges(current.revision!, ref.revision, cancellation.token);
				if (form !== this.form || cancellation.token.isCancellationRequested || this.actions.getRepository()?.id !== repository.id) { return; }
				if (!changes?.length) { feedback.textContent = t('agentWindow.git.noDifferences'); return; }
				await this.actions.openComparison({
					label: `${ref.name} ↔ ${current.name}`,
					multiDiffSource: URI.from({ scheme: 'git-ref-compare', path: `${repository.provider.rootUri!.path}/${ref.revision}..${current.revision}` }),
					resources: changes.map(change => ({ original: { resource: change.originalUri }, modified: { resource: change.modifiedUri }, goToFileResource: change.uri.with({ query: '' }) })),
					options: { pinned: true },
				});
				if (this.form === form) { form.hide(); }
			} catch (error) { if (this.form === form) { feedback.textContent = error instanceof Error ? error.message : String(error); } }
			finally { if (this.form === form) { form.busy = false; search.disabled = false; submit.disabled = !selected; render(); } }
		};
		this.formStore.add(addDisposableListener(search, 'input', render));
		this.formStore.add(addDisposableListener(list, 'keydown', event => {
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }
			const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
			const index = rows.indexOf(list.ownerDocument.activeElement as HTMLButtonElement);
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
			event.preventDefault(); rows[next]?.focus(); rows[next]?.scrollIntoView({ block: 'nearest' });
		}));
		form.busy = true; feedback.textContent = t('agentWindow.git.working'); form.show(); search.focus();
		try {
			const result = await history.provideHistoryItemRefs(undefined, cancellation.token);
			if (form !== this.form || cancellation.token.isCancellationRequested) { return; }
			refs = (result ?? []).filter(ref => !!ref.revision && ref.id !== current.id);
			form.busy = false; feedback.textContent = ''; render();
		} catch (error) { if (this.form === form) { form.busy = false; feedback.textContent = error instanceof Error ? error.message : String(error); } }
	}

	private report(error: unknown): void { if (!isCancellationError(error)) { this.notificationService.error(error instanceof Error ? error : String(error)); } }

	override dispose(): void { this.form?.hide(); this.picker?.hide(); super.dispose(); }
}
