---
title: Compatibilidad de extensiones
description: Qué extensiones de Microsoft se niegan a funcionar en OpenIDE y qué alternativas abiertas las reemplazan.
---

## Incompatibilidad

La mayoría de las extensiones de Microsoft están limitadas a productos de Microsoft por su licencia y por verificaciones adicionales en su código propietario.

Las extensiones incompatibles con OpenIDE **incluyen**:

- [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)
- [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) (explícitamente no soportada por su autor)
- [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare)
- [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)
- [Remote - SSH: Editing Configuration Files](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh-edit)
- [Remote - WSL](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl)

## Alternativas

Las siguientes extensiones son alternativas funcionales a las incompatibles.

### C/C++

- [clangd](https://open-vsx.org/extension/llvm-vs-code-extensions/vscode-clangd) para edición con todas las funcionalidades, incluyendo IntelliSense.
- [Native Debug](https://open-vsx.org/extension/webfreak/debug) para depurar con GDB y LLDB. Existen muchas otras extensiones de depuración, incluyendo algunas especializadas para microcontroladores.

### Python

- [BasedPyright](https://open-vsx.org/extension/detachhead/basedpyright)

### Desarrollo remoto

- [Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh). El servidor SSH tiene que estar configurado con `AllowTcpForwarding yes`.
- [Open Remote - WSL](https://open-vsx.org/extension/jeanp413/open-remote-wsl)

### Asistencia de IA

No necesitás una extensión para eso: el [agente integrado](/docs/agent/) viene con el producto y funciona con cualquier proveedor que conectes. GitHub Copilot en sí todavía se puede habilitar manualmente; consultá [GitHub Copilot](/docs/github-copilot/).
