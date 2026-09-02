---
title: Otros recursos
description: Los archivos reh y reh-web, el archivo de CLI y dónde hacer preguntas.
---

## ¿Qué son los archivos `reh` y `reh-web`?

Cada release publica, junto a los builds de escritorio, algunos archivos del lado del servidor:

- **Remote Host (`reh`)** es el componente de servidor para los flujos de trabajo remotos por SSH y WSL. Corre en la computadora "remota" y la hace accesible desde OpenIDE. El archivo se llama `openide-reh-<platform>-<arch>-<version>.tar.gz`.
- **Web Host (`reh-web`)** es el componente de servidor detrás del comando `openide serve-web`. Corre localmente y hace que OpenIDE sea accesible desde un navegador. El archivo se llama `openide-reh-web-<platform>-<arch>-<version>.tar.gz`.
- **CLI (`cli`)** contiene la herramienta de línea de comandos independiente `openide`, usada para túneles y operaciones headless: `openide-cli-<platform>-<arch>-<version>.tar.gz`.

Las extensiones remotas compatibles están listadas en [Compatibilidad de extensiones](/docs/extensions-compatibility/#desarrollo-remoto).

## Dónde preguntar

- [GitHub Discussions](https://github.com/Niiihuel/openide/discussions) para preguntas, ideas y para mostrar tu trabajo.
- [Issues](https://github.com/Niiihuel/openide/issues) para bugs, después de revisar [Solución de problemas](/docs/troubleshooting/).
- [Releases](https://github.com/Niiihuel/openide/releases) para descargas y notas de la versión.

## Proyectos relacionados

OpenIDE se construye sobre el trabajo de proyectos upstream:

- [Microsoft VS Code](https://github.com/microsoft/vscode), la base del editor.
- [VSCodium](https://github.com/VSCodium/vscodium), la referencia para builds con licencia libre sin la configuración propietaria de los binarios oficiales de Microsoft. OpenIDE comenzó como un fork del sistema de build de VSCodium y todavía le debe gran parte de su empaquetado y sus valores predeterminados de privacidad a ese proyecto.
- [Open VSX](https://open-vsx.org/), el registro de extensiones neutral respecto a proveedores usado por defecto.

Los binarios producidos por este repositorio se compilan a partir de fuentes abiertas con la configuración de producto definida por OpenIDE. El repositorio conserva la licencia MIT heredada del proyecto base.
