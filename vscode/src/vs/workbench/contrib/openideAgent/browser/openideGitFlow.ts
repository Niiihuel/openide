/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — safe, reviewable commit workflow. A commit never mixes somebody else's staging,
 *  never includes known secrets, and requires a review of the current diff before running.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { OpenideToolRegistry } from './openideTools.js';

export interface IGitFlowConfig {
	maxChangedLines: number;
	maxUnpushedCommits: number;
	conventionalCommits: boolean;
	rules: string[];
	requireExplicitFiles: boolean;
	requireReview: boolean;
	agentReviewers: number;
	ultraReviewers: number;
	maxReviewRounds: number;
}

const DEFAULT_CONFIG: IGitFlowConfig = {
	maxChangedLines: 200,
	maxUnpushedCommits: 3,
	conventionalCommits: true,
	rules: [],
	requireExplicitFiles: true,
	requireReview: true,
	agentReviewers: 1,
	ultraReviewers: 2,
	maxReviewRounds: 2,
};

/** Paths that must never enter automatic commits under any circumstance. */
const SUSPICIOUS_PATH_RE = /(^|\/)(?:\.env(?:\.|$)|id_rsa|id_ed25519|.*\.(?:pem|key)|.*(?:credential|secret)(?:\.|$))/i;
/** Real credentials; variable names alone do not block example files. */
const SECRET_VALUE_RE = /(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9_-]{16,}|AIza[\w-]{20,}|xox[baprs]-[\w-]{12,})\b)/;
const CONVENTIONAL_COMMIT_RE = /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)\r\n]+\))?!?:\s+\S/;

export interface IGitProposal {
	readonly message: string;
	readonly body?: string;
	readonly files: string[];
	readonly newBranch?: string;
}

export interface IGitPreflight {
	readonly ok: boolean;
	readonly message: string;
	readonly fingerprint?: string;
}

/** Shell escaping with single quotes (paths and messages travel through the terminal). */
export function shq(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function isWorkspaceRelativePath(path: string): boolean {
	return !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..');
}

export class OpenideGitFlow {

	private reviewedFingerprint: string | undefined;

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly tools: OpenideToolRegistry,
	) { }

	private workflowConfigUri() {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'workflow.json') : undefined;
	}

	private legacyConfigUri() {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'git.json') : undefined;
	}

	private normalizeConfig(raw: any): IGitFlowConfig {
		return {
			maxChangedLines: typeof raw.maxChangedLines === 'number' && raw.maxChangedLines > 0 ? Math.round(raw.maxChangedLines) : DEFAULT_CONFIG.maxChangedLines,
			maxUnpushedCommits: typeof raw.maxUnpushedCommits === 'number' && raw.maxUnpushedCommits > 0 ? Math.round(raw.maxUnpushedCommits) : DEFAULT_CONFIG.maxUnpushedCommits,
			conventionalCommits: raw.conventionalCommits !== false,
			rules: Array.isArray(raw.rules) ? raw.rules.map(String).slice(0, 20) : [],
			requireExplicitFiles: raw.requireExplicitFiles !== false,
			requireReview: raw.requireReview !== false,
			agentReviewers: typeof raw.agentReviewers === 'number' ? Math.min(2, Math.max(1, Math.round(raw.agentReviewers))) : DEFAULT_CONFIG.agentReviewers,
			ultraReviewers: typeof raw.ultraReviewers === 'number' ? Math.min(4, Math.max(2, Math.round(raw.ultraReviewers))) : DEFAULT_CONFIG.ultraReviewers,
			maxReviewRounds: typeof raw.maxReviewRounds === 'number' ? Math.min(3, Math.max(1, Math.round(raw.maxReviewRounds))) : DEFAULT_CONFIG.maxReviewRounds,
		};
	}

	async readConfig(): Promise<IGitFlowConfig> {
		const workflow = this.workflowConfigUri();
		const legacy = this.legacyConfigUri();
		for (const uri of [workflow, legacy]) {
			if (!uri) {
				continue;
			}
			try {
				return this.normalizeConfig(JSON.parse((await this.fileService.readFile(uri)).value.toString()));
			} catch { /* intenta la fuente siguiente */ }
		}
		return { ...DEFAULT_CONFIG };
	}

	async writeConfig(cfg: IGitFlowConfig): Promise<string> {
		const uri = this.workflowConfigUri();
		if (!uri) {
			return 'Error: no folder is open.';
		}
		await this.fileService.createFolder(dirname(uri));
		await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(cfg, null, '\t') + '\n'));
		return 'OK: workflow saved to .openide/workflow.json. The earlier .openide/git.json is still read for compatibility.';
	}

	private async run(cmd: string, token: CancellationToken): Promise<{ ok: boolean; output: string }> {
		const res = await this.tools.runShellCaptured(cmd, token, 60000);
		if (!res || res === 'no-shell-integration') {
			return { ok: false, output: res === 'no-shell-integration' ? '(sin shell integration: no se pudo capturar la salida)' : '(timeout)' };
		}
		return { ok: (res.exitCode ?? 1) === 0, output: (res.output ?? '').trim() };
	}

	private pathsCommand(files: readonly string[]): string {
		return files.map(shq).join(' ');
	}

	private validateFiles(files: readonly string[]): string | undefined {
		if (!files.length) {
			return 'You must list the commit files explicitly; OpenIDE does not use git add -A.';
		}
		const invalid = files.find(path => !isWorkspaceRelativePath(path));
		if (invalid) {
			return `Invalid path, or outside the workspace: ${invalid}`;
		}
		const duplicate = files.find((path, index) => files.indexOf(path) !== index);
		if (duplicate) {
			return `The path ${duplicate} appears more than once.`;
		}
		const secretPath = files.find(path => SUSPICIOUS_PATH_RE.test(path));
		return secretPath ? `Blocked: ${secretPath} looks like it contains secrets. Exclude it and manage the credential outside git.` : undefined;
	}

	private async selectedContents(files: readonly string[]): Promise<string> {
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder) {
			return '';
		}
		const contents: string[] = [];
		for (const path of files) {
			try {
				const content = (await this.fileService.readFile(joinPath(folder.uri, path))).value.toString();
				if (SECRET_VALUE_RE.test(content)) {
					throw new Error(`Bloqueado: ${path} contiene una credencial con formato conocido.`);
				}
				contents.push(`${path}\0${content.slice(0, 512_000)}`);
			} catch (error) {
				if (error instanceof Error && error.message.startsWith('Bloqueado:')) {
					throw error;
				}
				// Deleted files cannot be read; their diff still feeds the fingerprint.
			}
		}
		return contents.join('\n');
	}

	private async currentFingerprint(files: readonly string[], token: CancellationToken): Promise<{ fingerprint: string; diff: string }> {
		const paths = this.pathsCommand(files);
		const diff = await this.run(`git diff --no-ext-diff --find-renames --unified=40 HEAD -- ${paths}`, token);
		const status = await this.run(`git status --porcelain=v1 -- ${paths}`, token);
		const contents = await this.selectedContents(files);
		return { fingerprint: hashText(`${status.output}\n${diff.output}\n${contents}`), diff: diff.output };
	}

	/** Diff acotado que reciben revisores aislados. No expone paths sospechosos de secretos. */
	async readReviewDiff(files: readonly string[], token: CancellationToken): Promise<{ ok: boolean; text: string; fingerprint?: string }> {
		const invalid = this.validateFiles(files);
		if (invalid) {
			return { ok: false, text: `Error: ${invalid}` };
		}
		try {
			const current = await this.currentFingerprint(files, token);
			const untrackedContents = current.diff.trim() ? '' : await this.selectedContents(files);
			const reviewDiff = current.diff.trim() || (untrackedContents ? `New files with no previous diff:\n${untrackedContents.replace(/\0/g, '\n')}` : '');
			if (!reviewDiff.trim()) {
				return { ok: false, text: 'Error: there is no tracked diff to review in the selected files.' };
			}
			return { ok: true, text: reviewDiff.slice(0, 60_000), fingerprint: current.fingerprint };
		} catch (error) {
			return { ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` };
		}
	}

	markReviewed(fingerprint: string): void {
		this.reviewedFingerprint = fingerprint;
	}

	/** A preflight that is also the last line of defence right before altering the git index. */
	async preflight(proposal: IGitProposal, token: CancellationToken): Promise<IGitPreflight> {
		const cfg = await this.readConfig();
		const message = proposal.message.trim();
		if (!message) {
			return { ok: false, message: 'Error: the commit message is empty.' };
		}
		if (cfg.conventionalCommits && !CONVENTIONAL_COMMIT_RE.test(message)) {
			return { ok: false, message: 'Error: the message must use Conventional Commits (for example: feat(chat): add review).'};
		}
		if (cfg.requireExplicitFiles || proposal.files.length) {
			const invalid = this.validateFiles(proposal.files);
			if (invalid) {
				return { ok: false, message: `Error: ${invalid}` };
			}
		}
		const files = proposal.files;
		const staged = await this.run('git diff --cached --name-only', token);
		if (!staged.ok) {
			return { ok: false, message: `Error: the git index could not be inspected.\n${staged.output}` };
		}
		if (staged.output) {
			return { ok: false, message: `Blocked: there are already staged changes from outside this flow:\n${staged.output}\n\nClear or commit that index yourself; OpenIDE does not mix in staging it did not create.` };
		}
		const identity = await this.run('git config user.name && git config user.email', token);
		if (!identity.ok || identity.output.split('\n').filter(Boolean).length < 2) {
			return { ok: false, message: 'Error: git needs user.name and user.email before it can create a commit.' };
		}
		const status = await this.run(`git status --porcelain=v1 -- ${this.pathsCommand(files)}`, token);
		if (!status.ok || !status.output) {
			return { ok: false, message: 'Error: none of the given files has changes to commit.' };
		}
		const whitespace = await this.run(`git diff --check -- ${this.pathsCommand(files)}`, token);
		if (!whitespace.ok) {
			return { ok: false, message: `Error: git diff --check found whitespace problems:\n${whitespace.output}` };
		}
		let current: { fingerprint: string; diff: string };
		try {
			current = await this.currentFingerprint(files, token);
		} catch (error) {
			return { ok: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
		}
		if (cfg.requireReview && this.reviewedFingerprint !== current.fingerprint) {
			return { ok: false, message: 'Blocked: the current diff has no approved review. Run review_changes after your last edit and fix the findings.' };
		}
		return { ok: true, fingerprint: current.fingerprint, message: `Preflight OK: ${files.length} file(s), a current review, and no foreign staging.` };
	}

	/** Repository state formatted to steer the agent and the UI. */
	async describeStatus(token: CancellationToken): Promise<string> {
		const cfg = await this.readConfig();
		const st = await this.run('git status --porcelain=v1 --branch', token);
		if (!st.ok && !st.output) {
			return 'Error: the git state could not be read (is this a repo? is shell integration active?).';
		}
		const lines = st.output.split('\n').filter(line => line.trim());
		const branchLine = lines.find(line => line.startsWith('##')) ?? '## (desconocida)';
		const files = lines.filter(line => !line.startsWith('##'));
		const branch = branchLine.replace(/^## /, '').split('...')[0];
		const ahead = Number((branchLine.match(/ahead (\d+)/) ?? [])[1] ?? 0);
		const behind = Number((branchLine.match(/behind (\d+)/) ?? [])[1] ?? 0);
		const diff = await this.run('git diff HEAD --shortstat', token);
		const ins = Number((diff.output.match(/(\d+) insertion/) ?? [])[1] ?? 0);
		const del = Number((diff.output.match(/(\d+) deletion/) ?? [])[1] ?? 0);
		const changedLines = ins + del;
		const suspicious = files.map(file => file.slice(3).trim()).filter(path => SUSPICIOUS_PATH_RE.test(path));
		const checkpointDue = changedLines >= cfg.maxChangedLines || ahead >= cfg.maxUnpushedCommits;
		const out = [`Branch: ${branch}${ahead ? ` — ${ahead} unpushed commit(s)` : ''}${behind ? ` — ${behind} behind the remote` : ''}.`, files.length ? `Uncommitted changes: ${files.length} file(s), ~${changedLines} lines (+${ins}/−${del}).` : 'Working tree clean (no changes).'];
		if (files.length && files.length <= 25) {
			out.push(files.map(file => `  ${file}`).join('\n'));
		}
		if (suspicious.length) {
			out.push(`⛔ Paths bloqueados por posible secreto: ${suspicious.join(', ')}`);
		}
		if (checkpointDue) {
			out.push(`CHECKPOINT RECOMMENDED: over the threshold (${cfg.maxChangedLines} lines or ${cfg.maxUnpushedCommits} unpushed commits). Run review_changes and then git_preflight before proposing a git_commit with explicit files.`);
		} else if (files.length) {
			out.push('Recommended flow: review_changes → git_preflight → git_commit. Commits are atomic, with explicit files and user approval.');
		}
		if (cfg.rules.length) {
			out.push('User rules:\n' + cfg.rules.map(rule => `  - ${rule}`).join('\n'));
		}
		return out.join('\n');
	}

	/** Runs an already-approved commit. It does not push and rejects a foreign index. */
	async execute(proposal: IGitProposal, token: CancellationToken): Promise<string> {
		const preflight = await this.preflight(proposal, token);
		if (!preflight.ok) {
			return preflight.message;
		}
		const steps: string[] = [];
		const done: string[] = [];
		if (proposal.newBranch) {
			steps.push(`git switch -c ${shq(proposal.newBranch)}`);
		}
		steps.push(`git add -- ${this.pathsCommand(proposal.files)}`);
		const msg = proposal.body ? `${proposal.message}\n\n${proposal.body}` : proposal.message;
		steps.push(`git commit -m ${shq(msg)}`);
		for (const step of steps) {
			const res = await this.run(`GIT_TERMINAL_PROMPT=0 ${step}`, token);
			if (!res.ok) {
				return `Error in "${step}":\n${res.output}\n\nSteps completed before the failure: ${done.length ? done.join('; ') : 'none'}.`;
			}
			done.push(step);
		}
		this.reviewedFingerprint = undefined;
		return `OK: commit created (no automatic push).\n${done.map(step => `  ✓ ${step}`).join('\n')}`;
	}
}
