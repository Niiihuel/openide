<!-- order: 5 -->

# Getting started with OpenIDE

- [Install](#install)
- [Where OpenIDE keeps its files](#files)
- [First steps](#first-steps)
- [Connect a model](#connect-a-model)
- [Talk to the agent](#talk-to-the-agent)
- [Next steps](#next-steps)

## <a id="install"></a>Install

OpenIDE publishes builds for Linux (x64 and arm64) and Windows (x64 and arm64).
The artifact list, which of them auto-update, and the checksum files are in the
[Install section of the README](../README.md#install).

macOS is not published: the code builds and runs there, but a signed and
notarized release needs an Apple Developer ID, so there is no macOS download
until that is in place. Building it yourself works — see [BUILD.md](../BUILD.md).

## <a id="files"></a>Where OpenIDE keeps its files

OpenIDE has its own identity, so it never touches an existing VS Code
installation and the two can run side by side.

| What | Linux | Windows |
|---|---|---|
| User settings, keybindings, profiles | `~/.config/OpenIDE` | `%APPDATA%\OpenIDE` |
| Extensions | `~/.openide/extensions` | `%USERPROFILE%\.openide\extensions` |
| Agent memory, rules, hooks, subagents and codebase indexes (profile-wide) | `~/.config/OpenIDE/User/openideAgent` | `%APPDATA%\OpenIDE\User\openideAgent` |
| Per-project agent files | `.openide/` inside the workspace | `.openide\` inside the workspace |

Moving settings and extensions over from VS Code is covered in
[migration](./migration.md).

## <a id="first-steps"></a>First steps

1. **Open a folder** with File → Open Folder. The agent, Project Map and
   per-project memory all work on the first folder of the workspace.
2. **Install extensions** from the Extensions view. The gallery is
   [Open VSX](https://open-vsx.org); see [extensions](./extensions.md) for
   what that means and how to get an extension that is not there.
3. **Pick the UI language for OpenIDE's own surfaces** if you want it to differ
   from the editor's: `openide.language` accepts `auto`, `en` or `es`.

Everything else about the editor — keybindings, settings, tasks, debugging,
source control — behaves as in Code OSS.

## <a id="connect-a-model"></a>Connect a model

The agent needs a provider before it can answer. Open the OpenIDE Settings
editor from the gear in the chat header (or run *OpenIDE Agent: Select
provider* from the Command Palette), go to **Providers**, and connect one:

- **API key** for OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral,
  Together, Fireworks, xAI, DeepSeek, NVIDIA NIM, DashScope and the other
  entries in the catalog. The key goes to the operating system's secret store,
  never to `settings.json`.
- **OAuth** for the providers that support it (ChatGPT/Codex, Gemini Cloud
  Code Assist, GitHub Copilot, xAI, MiniMax and others). OpenIDE opens the
  browser and waits for the callback.
- **A local or custom server** through `openide.agent.customProviders`:
  anything that speaks the OpenAI, Anthropic or Gemini protocol, such as
  Ollama, LM Studio, llama.cpp, vLLM, Jan or an organisation proxy.

The models list combines what the provider reports with the
[models.dev](https://models.dev) catalog. A model that appears in the list is
not a guarantee that your account can use it; the *Refresh* action re-reads
the provider.

## <a id="talk-to-the-agent"></a>Talk to the agent

The chat lives in the secondary side bar. The composer has four modes:

| Mode | What the agent may do |
|---|---|
| **Agent** | Read, edit, run commands and use the browser, within the permission policy you chose. |
| **Plan** | Read and search, then write a plan to `.openide/plans/` for you to edit and approve. No file mutation or terminal. |
| **Ask** | Answer from the codebase without changing anything. |
| **Debug** | Like Agent, oriented at reproducing and diagnosing a problem. |

Two editor shortcuts feed it: `Ctrl+L` sends the current selection to the
chat, `Ctrl+K` opens a quick edit on the selection. A microphone button
appears in the composer once a voice-capable model is configured; see
[voice transports](./voice-transports.md).

Changes the agent makes show up as reviewable diffs with keep and undo
actions. Tool calls that need permission ask before running unless you chose a
broader policy. If you prefer a coding CLI you already use, the same dock can
host Claude Code, Codex, Gemini CLI, OpenCode, Amp, Factory Droid, Copilot CLI
and Grok; see the [harness guide](./harness.md#hosted-cli-integration).

## <a id="next-steps"></a>Next steps

- Read the [harness guide](./harness.md) for memory, Project Map, every tool
  and every setting.
- Add project conventions to `.openide/MEMORY.md` and rules to
  `.openide/rules/` so each session starts with them.
- Look at [updates](./updates.md) to know how a new version reaches you, and
  at [privacy](./privacy.md) for every connection OpenIDE makes on its own.
- Contribute: [CONTRIBUTING.md](../CONTRIBUTING.md).
