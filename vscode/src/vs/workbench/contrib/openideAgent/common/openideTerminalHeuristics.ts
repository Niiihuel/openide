/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Detects an interactive prompt only after a command has emitted output and gone quiet. */
export function shouldDetectAwaitingInput(opts: {
	readonly now: number;
	readonly startTime: number;
	readonly lastDataTime: number;
	readonly minRuntimeMs?: number;
	readonly quietAfterOutputMs?: number;
}): boolean {
	const minRuntimeMs = opts.minRuntimeMs ?? 12_000;
	const quietAfterOutputMs = opts.quietAfterOutputMs ?? 6_000;
	if (opts.lastDataTime <= 0) {
		return false;
	}
	const sinceStart = opts.now - opts.startTime;
	const sinceData = opts.now - opts.lastDataTime;
	return sinceStart >= minRuntimeMs && sinceData >= quietAfterOutputMs;
}

/** Only long-running commands belong in the background-terminal tray. */
export function isBackgroundTrayWorthy(command: string): boolean {
	const c = command.trim().toLowerCase();
	if (!c) {
		return false;
	}
	if (/^(cat|head|tail|wc|ls|pwd|echo|printf|which|type|file|stat|test|\[|true|false)\b/.test(c)) {
		return false;
	}
	if (/^(grep|rg|find|git\s+(status|diff|log|show|branch|stash\s+list|rev-parse|checkout|switch|add|commit))\b/.test(c)) {
		return false;
	}
	if (/^(npm|pnpm|yarn|bun)\s+(test|run\s+(test|lint|check|build|compile|format|typecheck|verify))\b/.test(c)) {
		return false;
	}
	if (/^(curl|wget)\s/.test(c) && !/\s(-d|--data|--upload-file)/.test(c)) {
		return false;
	}
	if (/\b(dev|serve|server|watch|watchers?|start|nodemon|pm2|tail\s+-f|journalctl\s+-f|docker\s+(compose\s+up|run)|code\.sh)\b/.test(c)) {
		return true;
	}
	if (/^(npm|yarn|pnpm|bun)\s+run\s+\w/.test(c) && !/\b(test|lint|check|build|compile|format|typecheck|verify)\b/.test(c)) {
		return true;
	}
	return false;
}
