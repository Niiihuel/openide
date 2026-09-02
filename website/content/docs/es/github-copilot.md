---
title: GitHub Copilot
description: Copilot está deshabilitado y no configurado en OpenIDE. Esto es lo que hace falta para habilitarlo de todas formas.
---

A diferencia de Visual Studio Code, en OpenIDE las funcionalidades de Copilot están deshabilitadas y no configuradas. OpenIDE viene con su propio [agente](/docs/agent/), que no depende de Copilot; el proveedor de GitHub Copilot está disponible en el [catálogo de proveedores](/docs/agent-providers/) si querés usar tu suscripción de Copilot con él.

Si en cambio querés la extensión Copilot Chat original, seguí estos pasos.

## Actualizá tu configuración

En tu configuración, establecé:

```json
"chat.disableAIFeatures": false
```

## Configurá `product.json`

Creá un `product.json` personalizado en la siguiente ubicación (reemplazá `OpenIDE` por `OpenIDE - Insiders` si usás ese canal):

- Windows: `%APPDATA%\OpenIDE` o `%USERPROFILE%\AppData\Roaming\OpenIDE`
- macOS: `~/Library/Application Support/OpenIDE`
- Linux: `$XDG_CONFIG_HOME/OpenIDE` o `~/.config/OpenIDE`

Después seguí la guía [Running with Code OSS](https://github.com/microsoft/vscode-copilot-chat/blob/main/CONTRIBUTING.md#running-with-code-oss) con el `product.json` que acabás de crear. Vas a necesitar agregar las propiedades `trustedExtensionAuthAccess` y `defaultChatAgent`.

Tené en cuenta que la extensión de Copilot que viene con Code OSS (`extensions/copilot`) fue eliminada del árbol de OpenIDE, porque el agente es nativo. Los pasos anteriores la instalan desde el marketplace en su lugar.
