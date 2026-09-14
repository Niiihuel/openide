/* Copyright (c) OpenIDE. Licensed under the MIT License. */

/** Use the requested work as the name; leave visual clipping to the shared overflow fade. */
export function subagentTaskTitle(task: string, fallback: string): string {
	return task.trim().split(/\r?\n|(?<=[.!?])\s+/u)[0]?.trim() || fallback.trim();
}
