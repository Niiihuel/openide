/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — tool approval gate. 'safe' tools do not ask for
 *  permission; 'write'/'exec' do. The chat's inline card offers 3 options (once /
 *  this session / reject); "always" (a persistent allowlist) lives in the QuickPick fallback.
 *
 *  Guarantees:
 *    - Hardline FLOOR: catastrophic commands (rm -rf /, mkfs, fork bomb, …) are ALWAYS denied,
 *        they cannot be "always allowed".
 *    - Sensitive paths (.env, .ssh, .git, keys) ALWAYS ask, even with a session allow.
 *   - Fail-closed: si el usuario cancela el prompt → se deniega.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { isHardlineDeniedCommand, isSensitiveToolPath, toolApprovalAllowKey } from '../common/openideApprovalPolicy.js';
import { IToolApprovalRequest, ToolApprovalDecision } from '../common/openideAgentTypes.js';
import { t } from '../common/openideStrings.js';

const ALLOWLIST_KEY = 'openide.agent.toolAllowlist';

export class OpenideApprovalManager {

	private readonly session = new Set<string>();

	constructor(
		private readonly quickInputService: IQuickInputService,
		private readonly configurationService: IConfigurationService,
	) { }

	private allowKey(req: IToolApprovalRequest): string {
		return toolApprovalAllowKey(req);
	}

	private persistentAllowlist(): string[] {
		const v = this.configurationService.getValue<string[]>(ALLOWLIST_KEY);
		return Array.isArray(v) ? v : [];
	}

	/** Decides whether a tool may run. Fail-closed. The optional `prompt` shows the decision UI
	 *  (the chat's INLINE card); without it, it falls back to the native QuickPick (palette, etc.).
	 *  `policy` is the global permission mode ('ask'/'auto-edit'/'auto-all'). */
	async check(req: IToolApprovalRequest, prompt?: ApprovalPrompt, policy: string = 'ask'): Promise<ToolApprovalDecision> {
		if (req.risk === 'safe') {
			return 'once';
		}
		if (req.risk === 'exec' && isHardlineDeniedCommand(req.command)) {
			return 'deny';
		}

		const sensitive = isSensitiveToolPath(req.path);
		const key = this.allowKey(req);
		if (!sensitive && (this.session.has(key) || this.persistentAllowlist().includes(key))) {
			return 'once';
		}
		// Global policy (never over sensitive paths nor the hardline floor, both cut off above):
		// auto-all → todo pasa; auto-edit → las ediciones (write) pasan, la terminal (exec) pregunta.
		if (!sensitive && (policy === 'auto-all' || (policy === 'auto-edit' && req.risk === 'write'))) {
			return 'once';
		}

		const decision = prompt
			? await prompt(req, sensitive)
			: await this.pickNative(req, sensitive);

		if (decision === 'session') {
			this.session.add(key);
		} else if (decision === 'always') {
			this.session.add(key);
			if (!sensitive) {
				const list = this.persistentAllowlist();
				if (!list.includes(key)) {
					await this.configurationService.updateValue(ALLOWLIST_KEY, [...list, key]);
				}
			}
		}
		return decision;
	}

	/** Decision prompt with a native QuickPick (fallback when there is no inline UI). */
	private async pickNative(req: IToolApprovalRequest, sensitive: boolean): Promise<ToolApprovalDecision> {
		const items: (IQuickPickItem & { id: ToolApprovalDecision })[] = [
			{ id: 'once', label: t('chatSurface.approve.once'), iconClasses: [] },
			{ id: 'session', label: t('approve.session') },
			{ id: 'always', label: t('chatSurface.approve.always'), description: sensitive ? t('chatSurface.approve.sensitiveNote') : undefined },
			{ id: 'deny', label: t('chatSurface.approve.deny') },
		];
		const placeHolder = req.command
			? t('chatSurface.approve.execPlaceholder', req.command)
			: req.detail || t('chatSurface.approve.usePlaceholder', req.tool);
		const picked = await this.quickInputService.pick(items, { title: req.title, placeHolder, ignoreFocusLost: true });
		return picked ? picked.id : 'deny';
	}
}

/** Shows the decision UI and resolves with the user's choice ('deny' when cancelled). */
export type ApprovalPrompt = (req: IToolApprovalRequest, sensitive: boolean) => Promise<ToolApprovalDecision>;
