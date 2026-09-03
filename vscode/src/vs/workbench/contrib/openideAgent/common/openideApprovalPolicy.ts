/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolApprovalRequest } from './openideAgentTypes.js';

const HARDLINE_DENY: RegExp[] = [
	/\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(\/|\/\*|~|\$HOME)(\s|$)/i,
	/\bmkfs(\.\w+)?\b/i,
	/\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd|disk)/i,
	/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
	/>\s*\/dev\/(sd|nvme|hd|vd)[a-z]/i,
	/\bchmod\s+-R\s+0*\s+\//i,
	/\b(shutdown|reboot|halt|poweroff)\b/i,
];

const SENSITIVE_PATH = /(^|\/)(\.env|\.ssh|\.git|\.aws|\.azure|\.config\/gcloud|\.gnupg|id_rsa|id_ed25519|\.npmrc|\.pypirc|\.pgpass|credentials?|secrets?)(\/|$|\.)/i;

export function isHardlineDeniedCommand(command: string | undefined): boolean {
	return !!command && HARDLINE_DENY.some(re => re.test(command));
}

export function isSensitiveToolPath(path: string | undefined): boolean {
	return !!(path && SENSITIVE_PATH.test(path.replace(/\\/g, '/')));
}

export function toolApprovalAllowKey(req: IToolApprovalRequest): string {
	if (req.risk === 'exec' && req.command) {
		return 'exec:' + req.command.trim().replace(/\s+/g, ' ');
	}
	return req.risk + ':' + req.tool;
}
