---
title: Migración
description: Mové tu configuración, atajos de teclado y extensiones de Visual Studio Code a OpenIDE.
---

## Migración manual desde Visual Studio Code

OpenIDE (como cualquier copia de VS Code compilada desde el código fuente) guarda sus extensiones en `~/.vscode-oss`. Si actualmente tenés Visual Studio Code instalado, tus extensiones no se van a poblar automáticamente. Podés copiarlas de `~/.vscode/extensions` a `~/.vscode-oss/extensions`.

Visual Studio Code guarda `keybindings.json` y `settings.json` en estas ubicaciones:

- **Windows:** `%APPDATA%\Code\User`
- **macOS:** `$HOME/Library/Application Support/Code/User`
- **Linux:** `$HOME/.config/Code/User`

Copiá esos archivos a la carpeta de configuración de usuario de OpenIDE:

- **Windows:** `%APPDATA%\OpenIDE\User`
- **macOS:** `$HOME/Library/Application Support/OpenIDE/User`
- **Linux:** `$HOME/.config/OpenIDE/User`

Para copiar tu configuración manualmente desde dentro del editor:

1. En Visual Studio Code, abrí Settings (`Ctrl+,` / `Cmd+,`).
2. Hacé clic en los tres puntos `…` y elegí *Open settings.json*.
3. Copiá el contenido al mismo archivo en OpenIDE.

## Migración semiautomática con la extensión "Sync Settings"

La extensión [**Sync Settings**](https://github.com/zokugun/vscode-sync-settings) simplifica el proceso sincronizando configuración, atajos de teclado, extensiones y más entre Visual Studio Code y OpenIDE. Está disponible en el Visual Studio Marketplace, Open VSX y su repositorio de GitHub.

1. Instalá **Sync Settings** tanto en Visual Studio Code como en OpenIDE.
2. Configurá la extensión en ambos editores: abrí la Paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`), ejecutá *Sync Settings: Open the repository settings* y configurá el repositorio.
3. Exportá tu configuración actual desde Visual Studio Code: ejecutá *Sync Settings: Upload (user -> repository)*.
4. Importala en OpenIDE:
   - Se recomienda la configuración `"syncSettings.openOutputOnActivity": true`.
   - Ejecutá *Sync Settings: Download (repository -> user)*.
   - Esperá a que se descarguen e instalen todas las extensiones (seguí los logs en el panel *Output*) antes de reiniciar OpenIDE.

Este método transfiere toda la configuración soportada.

## Qué no migra

- Extensiones licenciadas solo para el build oficial de Microsoft. Mirá [Compatibilidad de extensiones](/docs/extensions-compatibility/) para alternativas.
- GitHub Copilot, que está deshabilitado y no configurado en OpenIDE. Mirá [GitHub Copilot](/docs/github-copilot/).
- Las sesiones de cuenta de Microsoft. El inicio de sesión con GitHub usa un token de acceso personal; mirá [Autenticación de cuentas](/docs/accounts-authentication/).
