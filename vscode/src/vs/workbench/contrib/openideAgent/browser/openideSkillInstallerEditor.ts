/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — native Skills installer. It lives inside the workbench's real modal editor and
 *  mounts a real xterm instance: the command is prepared without running it so the user
 *  pueda revisarlo/modificarlo y confirmar con Enter.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, EventType } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { OpenideSkillInstallerInput, OpenideSkillInstallScope } from './openideSkillInstallerInput.js';
import './media/openideSkillInstaller.css';

export class OpenideSkillInstallerEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideSkillInstaller';

	private root: HTMLElement | undefined;
	private projectButton: HTMLButtonElement | undefined;
	private globalButton: HTMLButtonElement | undefined;
	private terminalHost: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private scope: OpenideSkillInstallScope = 'project';
	private pendingLayout: number | undefined;
	private readonly terminal = this._register(new MutableDisposable<ITerminalInstance>());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super(OpenideSkillInstallerEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-skill-installer'));
		const intro = append(this.root, $('.openide-skill-installer-intro'));
		append(intro, $('h2', undefined, 'Instalar una Skill'));
		append(intro, $('p', undefined, 'Pegá una fuente de skills.sh, owner/repo o el comando publicado por la Skill. OpenIDE lo normaliza y lo deja preparado en una terminal real; vos decidís cuándo ejecutarlo.'));

		const scopeRow = append(this.root, $('.openide-skill-installer-scope', { role: 'tablist', 'aria-label': 'Ámbito de instalación' }));
		this.projectButton = append(scopeRow, $('button', { type: 'button', role: 'tab' }, 'Proyecto')) as HTMLButtonElement;
		this.globalButton = append(scopeRow, $('button', { type: 'button', role: 'tab' }, 'Global')) as HTMLButtonElement;

		const terminalSection = append(this.root, $('.openide-skill-installer-terminal-section'));
		const terminalHeader = append(terminalSection, $('.openide-skill-installer-terminal-header'));
		append(terminalHeader, $('span', undefined, 'Terminal'));
		this.status = append(terminalHeader, $('span.openide-skill-installer-status', undefined, 'Iniciando…'));
		this.terminalHost = append(terminalSection, $('.openide-skill-installer-terminal'));

		this._register(addDisposableListener(this.projectButton, EventType.CLICK, () => void this.changeScope('project')));
		this._register(addDisposableListener(this.globalButton, EventType.CLICK, () => void this.changeScope('global')));
		// The modal is sized after mounting and can be resized: observing the
		// container is the only signal that ALWAYS arrives, and in time.
		const observer = new ResizeObserver(() => {
			if (this.pendingLayout !== undefined) { return; }
			this.pendingLayout = this.terminalHost!.ownerDocument.defaultView!.requestAnimationFrame(() => {
				this.pendingLayout = undefined;
				this.layoutTerminal();
			});
		});
		observer.observe(this.terminalHost);
		this._register({ dispose: () => observer.disconnect() });

		const pasteListener = (event: ClipboardEvent) => void this.handleTerminalPaste(event);
		this.terminalHost.addEventListener('paste', pasteListener, true);
		this._register({ dispose: () => this.terminalHost?.removeEventListener('paste', pasteListener, true) });
	}

	override async setInput(input: OpenideSkillInstallerInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.scope = input.initialScope === 'project' && !this.projectRoot() ? 'global' : input.initialScope;
		this.updateScopeButtons();
		await this.createTerminal();
		await this.terminal.value?.focusWhenReady(true);
	}

	private projectRoot(): URI | undefined {
		return this.workspaceService.getWorkspace().folders[0]?.uri;
	}

	private async changeScope(scope: OpenideSkillInstallScope): Promise<void> {
		if (scope === 'project' && !this.projectRoot()) {
			return;
		}
		if (this.scope === scope) {
			return;
		}
		this.scope = scope;
		this.updateScopeButtons();
		await this.createTerminal();
	}

	private updateScopeButtons(): void {
		if (!this.projectButton || !this.globalButton) {
			return;
		}
		const hasProject = !!this.projectRoot();
		this.projectButton.disabled = !hasProject;
		this.projectButton.classList.toggle('active', this.scope === 'project');
		this.globalButton.classList.toggle('active', this.scope === 'global');
		this.projectButton.setAttribute('aria-selected', String(this.scope === 'project'));
		this.globalButton.setAttribute('aria-selected', String(this.scope === 'global'));
		this.projectButton.title = hasProject ? 'Instalar en el proyecto abierto' : 'Abrí una carpeta para usar este ámbito';
	}

	private normalizeSkillsCommand(rawValue: string): string {
		let raw = rawValue.trim().replace(/^\$\s*/, '');
		if (/[^\S ]|\0/.test(raw)) {
			throw new Error('El comando debe ocupar una sola línea.');
		}
		if (!raw) {
			throw new Error('Pegá una fuente o un comando de instalación.');
		}

		const skillsSh = raw.match(/^https?:\/\/(?:www\.)?skills\.sh\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?$/i);
		if (skillsSh && skillsSh[1] !== 'docs') {
			raw = `${skillsSh[1]}/${skillsSh[2]}${skillsSh[3] ? `@${skillsSh[3]}` : ''}`;
		}

		const isFullCommand = /^(?:(?:npx|bunx)\s+|pnpm\s+dlx\s+)?skills\s+add\s+/i.test(raw);
		let command = isFullCommand ? raw : `npx skills add ${this.shellQuote(raw)}`;
		command = command.replace(/\s+--global(?=\s|$)/gi, '');
		if (!/\s--agent(?:=|\s)/i.test(command)) {
			command += ' --agent universal';
		}
		if (this.scope === 'global') {
			command += ' --global';
		}
		return command;
	}

	private shellQuote(value: string): string {
		return `'${value.replace(/'/g, `'\\''`)}'`;
	}

	private async handleTerminalPaste(event: ClipboardEvent): Promise<void> {
		const terminal = this.terminal.value;
		const pasted = event.clipboardData?.getData('text')?.trim() ?? '';
		if (!terminal || !this.status || !pasted || /[\r\n\0]/.test(pasted)) {
			return;
		}
		const looksLikeSkill = /(?:skills\.sh|github\.com|\bskills\s+add\b|^[\w.-]+\/[\w.-]+)/i.test(pasted);
		if (!looksLikeSkill) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		try {
			const command = this.normalizeSkillsCommand(pasted);
			await terminal.runCommand(command, false);
			this.status.textContent = 'Comando normalizado · revisalo y presioná Enter';
			this.status.classList.remove('error');
			await terminal.focusWhenReady(true);
		} catch (error) {
			this.status.textContent = error instanceof Error ? error.message : String(error);
			this.status.classList.add('error');
		}
	}

	private async createTerminal(): Promise<void> {
		if (!this.terminalHost || !this.status) {
			return;
		}
		this.terminal.value?.detachFromElement();
		this.terminal.clear();
		clearNode(this.terminalHost);
		this.status.textContent = 'Iniciando…';
		this.status.classList.remove('error');
		const cwd = this.scope === 'project'
			? this.projectRoot()
			: this.environmentService.userRoamingDataHome;
		const terminal = await this.terminalService.createTerminal({
			cwd,
			location: TerminalLocation.Panel,
			config: { name: `Skills CLI · ${this.scope === 'global' ? 'Global' : 'Proyecto'}`, hideFromUser: true, isFeatureTerminal: true },
		});
		this.terminal.value = terminal;
		terminal.attachToElement(this.terminalHost);
		terminal.setVisible(true);
		this.layoutTerminal();
		this.status.textContent = this.scope === 'global' ? 'Ámbito global' : 'Ámbito del proyecto';
	}

	/**
	 * The terminal is measured by its REAL container, not by the pane's dimension. `setInput` creates
	 * the terminal before the first `layout()`, so requiring a prior dimension left xterm at
	 * its default size: the terminal ended up in a narrow column and the prompt glyphs looked
	 * enormous (the atlas scaled with the wrong ratio).
	 */
	private layoutTerminal(): void {
		if (!this.terminalHost || !this.terminal.value) {
			return;
		}
		const rect = this.terminalHost.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			this.terminal.value.layout({ width: rect.width, height: rect.height });
		}
	}

	override layout(_dimension: Dimension): void {
		this.layoutTerminal();
	}

	override focus(): void {
		super.focus();
		this.terminal.value?.focus(true);
	}

	protected override setEditorVisible(visible: boolean): void {
		this.terminal.value?.setVisible(visible);
		if (visible) {
			this.layoutTerminal();
		}
		super.setEditorVisible(visible);
	}

	override clearInput(): void {
		this.terminal.value?.detachFromElement();
		this.terminal.clear();
		super.clearInput();
	}
}
