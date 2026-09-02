---
title: Uso
description: Modo portable, integración con la terminal, inicio de sesión con GitHub, el gestor de archivos predeterminado y validación de Markdown.
---

## Iniciar sesión con GitHub

En OpenIDE, *Sign in with GitHub* usa un token de acceso personal. Seguí la [documentación de GitHub](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) para crear uno y seleccioná los scopes que necesite la extensión (GitLens, por ejemplo, requiere el scope `repo`). Mirá [Autenticación de cuentas](/docs/accounts-authentication/) para más detalles.

### Linux

Si obtenés el error `Writing login information to the keychain failed with error 'The name org.freedesktop.secrets was not provided by any .service files'`, instalá el paquete `gnome-keyring` (u otro proveedor de Secret Service).

## Modo portable

Seguí las [instrucciones de modo portable](https://code.visualstudio.com/docs/editor/portable) del sitio de Visual Studio Code.

- **Windows / Linux:** las instrucciones se pueden seguir tal cual, creando una carpeta `data` al lado del ejecutable.
- **macOS:** el modo portable se habilita con una carpeta con un nombre especial. Para VS Code es `code-portable-data`; para OpenIDE, creá `openide-portable-data` en su lugar.

## Arreglar el gestor de archivos predeterminado (Linux)

En algunos casos OpenIDE se convierte en la aplicación usada para abrir directorios en lugar de Dolphin o Nautilus. Esto pasa cuando ninguna aplicación está declarada como el gestor de archivos predeterminado, así que el sistema elige la última capaz de hacerlo.

Configurá el predeterminado explícitamente en `~/.config/mimeapps.list`:

```ini
[Default Applications]
inode/directory=org.gnome.Nautilus.desktop;
```

Podés encontrar tu gestor de archivos habitual con:

```bash
grep directory /usr/share/applications/mimeinfo.cache
# inode/directory=openide.desktop;org.gnome.Nautilus.desktop;
```

## Mantener presionada una tecla para repetirla (macOS)

El dominio de `defaults` es distinto al de VS Code:

```bash
defaults write com.openide ApplePressAndHoldEnabled -bool false
```

## Abrir OpenIDE desde la terminal

En macOS y Windows:

1. Abrí la Paleta de comandos (*View > Command Palette…*).
2. Ejecutá *Shell command: Install 'openide' command in PATH*.

Esto te permite abrir archivos o directorios directamente desde tu shell:

```bash
openide .          # abre este directorio
openide file.txt   # abre este archivo
```

Sentite libre de crear un alias del comando en tu perfil de shell, por ejemplo `alias code=openide`.

En Linux, cuando se instala con un gestor de paquetes, `openide` ya está en tu `PATH`.

### Desde el tarball de Linux

Cuando se extrae `OpenIDE-linux-<arch>-<version>.tar.gz`, el punto de entrada principal es `./bin/openide`.

## Validar un documento Markdown

Abrí un archivo `.md` y ejecutá **OpenIDE: Validate Active Markdown** desde la Paleta de comandos. OpenIDE revisa los code fences, la jerarquía de encabezados y esquemas de enlaces inseguros sin modificar el documento. Los conteos de encabezados, enlaces, imágenes, tareas y bloques de código se escriben en el canal de salida **OpenIDE Markdown**.

## Idioma

La interfaz del workbench sigue la configuración `openide.language`. Las cadenas propias del agente siguen la misma configuración, así que el chat, las superficies de configuración y el editor de planes cambian juntos.
