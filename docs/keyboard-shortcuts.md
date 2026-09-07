# OpenIDE keyboard shortcuts

OpenIDE keeps the command map compatible with Code OSS and with the extension
ecosystem, so every upstream shortcut works unchanged. Browse and customize all
of them from **File > Preferences > Keyboard Shortcuts** (`Ctrl+K Ctrl+S` on
Linux and Windows, `⌘K ⌘S` on macOS).

## Shortcuts OpenIDE adds

| Keys | Command | When |
|---|---|---|
| `Ctrl+L` / `⌘L` | **OpenIDE Agent: Add the selection to the chat** — attaches the selected text, with file and range, to the composer | Editor focused, non-empty selection |
| `Ctrl+K` / `⌘K` | **OpenIDE Agent: Quick edit the selection** — opens the inline quick-edit box on the selection; the result is applied as a reviewable edit | Editor focused, non-empty selection, writable file |
| `Escape` | **OpenIDE Agent: Close the quick edit** | Quick edit visible |

`Ctrl+K` is a prefix for many upstream chords (`Ctrl+K Ctrl+S`, `Ctrl+K Z`);
OpenIDE only takes it when there is a selection, so the chords keep working
from an empty selection. Rebind either command in Keyboard Shortcuts if that
conflicts with your habits.

## Commands without a default keybinding

Everything else OpenIDE adds is reachable from the Command Palette
(`Ctrl+Shift+P`) and can be given a shortcut there. The ones worth knowing:

| Command | Purpose |
|---|---|
| OpenIDE Agent: New chat · Fork the conversation | Start a conversation, or branch the current one at this point |
| OpenIDE Agent: Write a prompt into the chat | Put text in the composer without sending it |
| OpenIDE Agent: Select provider · Set API key · Sign in (OAuth) | Provider management without the Settings UI |
| OpenIDE Agent: Context usage · Account usage | What the next request will contain; the connected account's quota |
| OpenIDE Agent: Toggle AI autocomplete | Inline completion on or off (`openide.autocomplete.enabled`) |
| OpenIDE Agent: Copy the diagrams MCP configuration | Launch details for the diagram MCP server |
| OpenIDE: Open Project Map · Rebuild Codebase Memory · Clear Codebase Memory · Codebase Memory Status | The codebase graph |
| OpenIDE: Create Subagent · Open Subagent Editor · Open Subagent as Text | Subagent definitions under `.openide/agents/` |
| OpenIDE: Localhost preview · Pick an element from the app (Pick & Polish) | The integrated browser |
| OpenIDE: Register OpenIDE tools in a CLI | Registers the MCP bridge with a CLI that has no launch adapter (Grok) |
| OpenIDE: Validate active Markdown | Structure report for the current `.md` file |
| OpenIDE: Import settings and extensions from another editor | One-shot import from a VS Code profile |
| OpenIDE: Connect to GitHub | The editor's GitHub account, see [accounts](./accounts-authentication.md) |
| OpenIDE: Check for Updates · Download Update · Install Update · Restart and Update · Restore Previous Version | The updater, when the title-bar indicator is hidden |
| OpenIDE: Show welcome | The welcome page |

The OpenIDE Settings editor (providers, voice, memory, MCP, rules, skills,
hooks, subagents, notifications) opens from the gear in the chat header; its
sections are also reachable through `openide.agent.openSettings`,
`openide.agent.openProviders` and `openide.agent.openVoiceSettings` if you want
to bind them.

The exact titles appear in the language selected by `openide.language`; the
Command Palette matches both the English and the Spanish wording.
