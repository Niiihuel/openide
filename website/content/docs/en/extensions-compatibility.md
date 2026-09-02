---
title: Extensions compatibility
description: Which Microsoft extensions refuse to run in OpenIDE and which open alternatives replace them.
---

## Incompatibility

Most Microsoft extensions are limited to Microsoft products by their license and by additional checks in their proprietary code.

Extensions incompatible with OpenIDE **include**:

- [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)
- [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) (explicitly unsupported by its author)
- [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)
- [Remote - SSH: Editing Configuration Files](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh-edit)
- [Remote - WSL](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl)

## Replacements

The following extensions are functional replacements for the incompatible ones.

### C/C++

- [clangd](https://open-vsx.org/extension/llvm-vs-code-extensions/vscode-clangd) for full-featured editing, including IntelliSense.
- [Native Debug](https://open-vsx.org/extension/webfreak/debug) for debugging with GDB and LLDB. Many other debugging extensions exist, including specialized ones for microcontrollers.

### Python

- [BasedPyright](https://open-vsx.org/extension/detachhead/basedpyright)

### Remote development

- [Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh). The SSH server must be configured with `AllowTcpForwarding yes`.
- [Open Remote - WSL](https://open-vsx.org/extension/jeanp413/open-remote-wsl)

### AI assistance

You do not need an extension for that: the [integrated agent](/docs/agent/) ships with the product and works with any provider you connect. GitHub Copilot itself can still be enabled by hand; see [GitHub Copilot](/docs/github-copilot/).
