/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { OpenideStringKey } from './openideStrings.js';

/** Stable command IDs shared by native keybindings, menus and empty-state labels. */
export const AgentWindowAction = {
	newChat: 'openide.agentWindow.newChat', search: 'openide.agentWindow.search',
	review: 'openide.agentWindow.review', browser: 'openide.agentWindow.browser', files: 'openide.agentWindow.files',
	terminal: 'openide.agentWindow.terminal', focusChat: 'openide.agentWindow.focusChat',
	sidebar: 'openide.agentWindow.sidebar', workspace: 'openide.agentWindow.workspace',
	explore: 'openide.agentWindow.explore', plan: 'openide.agentWindow.plan', debug: 'openide.agentWindow.debug',
} as const;

export const agentWindowShortcuts: readonly { id: string; label: OpenideStringKey; primary: number }[] = [
	{ id: AgentWindowAction.newChat, label: 'chat.header.newTitle', primary: KeyMod.CtrlCmd | KeyCode.KeyN },
	{ id: AgentWindowAction.search, label: 'agentWindow.search', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF },
	{ id: AgentWindowAction.review, label: 'agentWindow.reviewChanges', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG },
	{ id: AgentWindowAction.browser, label: 'agentWindow.browser', primary: KeyMod.CtrlCmd | KeyCode.KeyT },
	{ id: AgentWindowAction.files, label: 'agentWindow.filesTitle', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE },
	{ id: AgentWindowAction.terminal, label: 'agentWindow.terminal', primary: KeyMod.CtrlCmd | KeyCode.Backquote },
	{ id: AgentWindowAction.focusChat, label: 'agentWindow.focusChat', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyL },
	{ id: AgentWindowAction.sidebar, label: 'agentWindow.toggleSidebar', primary: KeyMod.CtrlCmd | KeyCode.KeyB },
	{ id: AgentWindowAction.workspace, label: 'agentWindow.toggleWorkspace', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB },
	{ id: AgentWindowAction.explore, label: 'chat.empty.explore', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit1 },
	{ id: AgentWindowAction.plan, label: 'chat.empty.plan', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit2 },
	{ id: AgentWindowAction.debug, label: 'chat.empty.debug', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Digit3 },
];
