# OpenIDE Agent Window

Open the separate native window with **OpenIDE Agent: Open Agent Window** in the command palette, View menu, or chat's more-actions menu. Repeating the command focuses the existing window for this workspace.

The IDE and agent window remain usable simultaneously. The agent window contains the existing project-grouped Sessions pane, native chat/composer, PATH-discovered harness picker and a collapsible context panel. It uses OpenIDE surface tokens, icon metrics and popovers. Selecting a conversation in either surface selects it in both; their scroll positions are local. Draft content and the message queue are shared.

## State ownership

`OpenideChatViewPane` owns the primary `OpenideChatWidget`. `OpenideAgentWindow` opens an `IAuxiliaryWindow` and asks the primary widget to create a companion presentation. Both use the same `OpenideChatSessions`, controller, provider services and running conversation records. The companion does not register a second conversation host, install CLI hooks, or consume the message queue independently.

This is a native companion window in the same service graph, not a second workbench loading a competing copy of the workspace database. Closing the companion disposes only its presentation; work continues in the shared runtime without opening IDE presentation. Closing or reloading the owning IDE follows the normal IDE execution lifecycle and closes its auxiliary windows.

Session changes publish through the existing store. `OpenideChatPresentation` namespaces row identities by conversation and keeps measured heights local to each view, so equal local response IDs cannot reuse another conversation's text and different window widths cannot share row measurements. Shared drafts suppress echo updates while being applied. Only the primary composer drains queued messages.

The CLI process and terminal instance retain one owner. The terminal presentation can be attached to the surface where it is being used without starting another process. Closing that surface returns the terminal presentation to the IDE.

## Native window details

Auxiliary windows inherit workbench styles and theme changes. Elements must be constructed in the primary JavaScript context and adopted into the target document, through `createOpenideElement`; the auxiliary document deliberately blocks direct `createElement`. Popovers use the triggering element's window container. Native bounds, sidebar/context widths, terminal height and right-panel mode are saved per workspace.

The shell reuses the native auxiliary titlebar (OS controls), the IDE menu control and auxiliary statusbar. Its sidebar, chat, context rail and bottom terminal are islands using the same surface/border/radius tokens as the IDE. Shared Sash controls resize the panels. Sidebar, terminal, browser and layout controls live in the native titlebar; the chat header contains only the conversation title and existing actions menu. Sessions stay in the left sidebar. Its footer reuses the Settings account component with the actual connected GitHub user and profile. The native statusbar mirrors agent activity and provider usage without adding editor-only status or another usage poll.

The Files island, opened from the layout menu, uses WorkbenchAsyncDataTree and ResourceLabels over IFileService: lazy folder loading, exclusions, file icons/decorations and correlated watches. It occupies the right panel without replacing Sessions. Opening files, agent reviews and browser previews uses the workbench’s native ModalEditorPart hosted in the agent window. The modal supports real editor tabs, Monaco diffs and the existing BrowserEditorInput; it is independently scoped from any modal open in the IDE. Closing the agent window uses the native Save / Don’t Save / Cancel workflow before unloading. Cancel retains the window and its dirty buffers; successful close removes its tabs without transferring files, browser previews or Changes into the IDE. Late artifact opens for a closed companion are ignored. The bottom terminal island borrows existing ITerminalService instances without spawning replacement processes; create/select/close act on real terminals. Hiding the island or closing the window returns the same process to the IDE. Hidden CLI harness terminals retain their separate owner.

The context rail contains live SCM and agent changes, branch actions, conversation-scoped subagents with details/cancellation, available terminal processes and deduplicated attached sources. Sources can open through the existing editor and the add action uses the shared attachment picker. Agent review and attached-source actions open locally. Settings opens its existing native editor in the agent window as well. Branch and commit commands reuse their existing IDE implementations. History remains scoped to the connected workspace; the window does not aggregate unrelated workspace databases or expose a separate agent server.

Adjacent subagents appear in the transcript as a compact, expandable activity row with their shared task avatars and names. Environment prioritizes active workers before completed ones. Collapsed worker details retain the latest snapshot without repainting their hidden history; expanding uses that snapshot. Opening a worker from Agents Window selects its detail in the local Subagents tab and preserves the parent conversation. The event carries its source window so the regular IDE does not navigate or open a panel. Restored durable runs use the same parent identity as live runs.

## Conversation navigation and CLI sessions

The compact sidebar groups recent conversations by project context, with pinned sessions above the project groups and a collapsible archive below. Project groups can collapse and reveal more history. Per-session menus reuse the shared pin, custom-title, read/unread and archive operations. Pins and user titles survive reloads and do not change a provider session's identity. Running sessions use the shared spinner; completed updates outside the active conversation use its unread indicator. Completion alerts reuse the IDE notification settings and account for focus in either window.

The shared New Conversation picker offers the native harness and supported CLIs actually found on PATH. An optional title can be entered before choosing the harness. A CLI selected from the companion opens the existing CLI terminal presentation in its central island, using the same process and shared session as the IDE. Its header identifies the CLI and its environment follows the selected conversation's cwd/repository. CLI changes come from the existing session change tracker and open native Monaco reviews in the same window; native-chat sources and usage are not carried over into CLI context.

Project grouping uses workspace folders and the CLI's recorded working directory. History still belongs to the connected workspace; this does not aggregate session stores from unrelated IDE workspaces.

## Search and keyboard navigation

The sidebar's search icon opens a centered native QuickPick with recent conversations, project labels and quick actions for a new chat, opening a folder and finding files. Arrow keys, Enter and Escape retain their workbench behavior. The permanent search/filter row is hidden only in this window; the IDE Sessions pane keeps its existing controls. File search uses the native search service and honors workspace exclusions.

The agent window resolves the existing workbench keybindings, including user overrides. On Linux/Windows, Ctrl+J toggles its terminal island, Ctrl+Shift+` creates a terminal, Ctrl+Shift+5 splits the active terminal, Ctrl+B toggles Sessions, Ctrl+Alt+B toggles Context, Ctrl+Shift+F opens conversation search and Ctrl+P searches files. Terminal pane navigation uses the native terminal context and bindings. Existing editor and command-palette shortcuts remain available. The corresponding native commands route locally while the agent window owns input and retain their IDE behavior otherwise.

Header buttons use the shared ghost-button hover and show tooltips below with the configured shortcut when available. Context rows only show supplementary or truncated text in tooltips positioned to the left.

## Verification

Run the isolated native integration suite:

```sh
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-cli-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-terminal-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-editors-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-settings-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-hover-runtime.mjs'
./result-fhs/bin/openide-build -c 'node dev/run-virtual-gui.mjs dev/test-agent-window-sessions-runtime.mjs'
```

The suite uses real Electron windows and native chat components with a controlled provider response, so it does not send a paid model request. It exercises shared history/selection, live response rendering, approvals, singleton opening, lifecycle and responsive layout. Screenshots and results are written under `.build/agent-window-runtime/`.

The CLI integration suite launches a controlled executable discovered through PATH in a real PTY, sends keyboard input from both surfaces and verifies the same process and session survive companion closure.

The focused browser unit suites cover shared drafts/queue ownership, auxiliary DOM/popover behavior, session storage and response rendering. Run `npm run typecheck-client` from `vscode` for the client type check.

## Design references

Local reference repositories were inspected for shell and ownership patterns: OpenChamber's `MainLayout`/`MiniChatLayout` reuse the existing chat surface; its sync layer separates domain state from window presence. Orca's runtime graph keeps terminal ownership and renderer lifecycle explicit. VS Code's `IAuxiliaryWindowService` provides the native window infrastructure used here. Their application logic and visual components were not copied into OpenIDE.
