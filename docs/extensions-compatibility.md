<!-- order: 0 -->

# Extensions compatibility

- [Incompatible extensions](#incompatibility)
- [Replacements](#replacements)
  - [C/C++](#cc)
  - [Python](#python)
  - [Remote development](#remote)
  - [AI assistance](#ai)

## <a id="incompatibility"></a>Incompatible extensions

Several Microsoft extensions are limited to the official Visual Studio Code
build, either by licence or by a check in their proprietary code. Known cases:

- [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) — the
  editing part loads; the Windows debugger is licensed for the official build only.
- [C#](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) — same
  situation for its debugger.
- [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) — the
  bundled Pylance language server is licensed for the official build.
- [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers),
  [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh),
  [Remote - SSH: Editing Configuration Files](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh-edit),
  [Remote - WSL](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl)
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) and
  Copilot Chat — not bundled and not configured; see [GitHub Copilot](./ext-github-copilot.md).

An extension that is not on this list and misbehaves is more likely a
packaging problem than a compatibility one; check whether the same version
works from a `.vsix` before filing an issue.

## <a id="replacements"></a>Replacements

### <a id="cc"></a>C/C++

- [clangd](https://open-vsx.org/extension/llvm-vs-code-extensions/vscode-clangd)
  for editing and IntelliSense.
- [Native Debug](https://open-vsx.org/extension/webfreak/debug) or
  [CodeLLDB](https://open-vsx.org/extension/vadimcn/vscode-lldb) for debugging
  with GDB and LLDB.
- For C#, [netcoredbg](https://github.com/Samsung/netcoredbg) works as a
  debug adapter with the open C# extension.

### <a id="python"></a>Python

- [BasedPyright](https://open-vsx.org/extension/detachhead/basedpyright) as the
  language server, alongside the Python extension's own tooling.

### <a id="remote"></a>Remote development

- [Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh).
  The server needs `AllowTcpForwarding yes` in `sshd_config`; the remote host
  it installs is OpenIDE's own `openide-reh-*` archive.
- [Open Remote - WSL](https://open-vsx.org/extension/jeanp413/open-remote-wsl).

### <a id="ai"></a>AI assistance

OpenIDE's agent is built into the product and does not depend on an
extension: connect a provider in Settings → Providers. The chat dock can also
host Claude Code, Codex, Gemini CLI, OpenCode, Amp, Factory Droid, Copilot CLI
and Grok; see the [harness guide](./harness.md#hosted-cli-integration).
