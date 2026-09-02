---
title: Primeros pasos
description: Instalá OpenIDE, abrí tu primer proyecto y conocé el agente integrado.
---

OpenIDE es una distribución de Visual Studio Code construida sobre una base de Code OSS con licencia libre. Si ya conocés VS Code, ya conocés el editor: la misma arquitectura, los mismos atajos de teclado y el mismo ecosistema de extensiones. Lo nuevo es el agente que viene incluido en el producto.

## Instalación

Los builds se publican en [GitHub Releases](https://github.com/Niiihuel/openide/releases) para Linux y Windows. La [guía de instalación](/docs/installation/) cubre todos los formatos (AppImage, tarball, instalador de Windows) y el wrapper de NixOS.

macOS todavía no está publicado. El código compila y corre ahí, pero un release firmado y notarizado requiere un Apple Developer ID. Compilarlo vos mismo desde el código fuente funciona; mirá [Compilar OpenIDE](/docs/building/).

## Primeros pasos

1. **Abrí una carpeta.** Usá *File > Open Folder* para abrir tu proyecto.
2. **Instalá extensiones.** Hacé clic en el ícono de Extensiones en la barra de actividad. La galería predeterminada es [Open VSX](https://open-vsx.org/); mirá [Extensiones](/docs/extensions/) para conocer alternativas.
3. **Abrí el agente.** El chat vive en el panel derecho. Ejecutá *OpenIDE: New Chat* desde la Paleta de comandos o usá el ícono del agente en la barra auxiliar.
4. **Conectá un proveedor.** Ejecutá *OpenIDE: Open Providers* e iniciá sesión con OAuth o pegá una API key. Las credenciales se guardan en el llavero (keyring) del sistema a través de `SecretStorage`, nunca en `settings.json`. Detalles en [Proveedores](/docs/agent-providers/).
5. **Pedí algo.** Empezá en modo *Agent* para un cambio concreto, o en modo *Plan* para diseñar primero. La página [Agente](/docs/agent/) explica cada modo.

## Uso básico

OpenIDE funciona igual que Visual Studio Code, con algunas diferencias:

- Usa Open VSX para las extensiones por defecto en lugar del Visual Studio Marketplace.
- No incluye telemetría ni branding de Microsoft.
- Algunas extensiones propietarias de Microsoft se niegan a correr fuera del build oficial; mirá [Compatibilidad de extensiones](/docs/extensions-compatibility/).
- El asistente de IA es parte del workbench. Tiene acceso nativo a archivos, terminales, el índice del language server, una vista previa local del navegador y git.

## Atajos de teclado

Algunos atajos para arrancar:

| Acción | Linux / Windows | macOS |
| --- | --- | --- |
| Quick Open, ir a un archivo | `Ctrl+P` | `Cmd+P` |
| Paleta de comandos | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Configuración de usuario | `Ctrl+,` | `Cmd+,` |
| Editor de atajos de teclado | `Ctrl+K Ctrl+S` | `Cmd+K Cmd+S` |

El mapa completo es compatible con Code OSS; mirá [Atajos de teclado](/docs/keyboard-shortcuts/).

## Próximos pasos

- Leé [Uso](/docs/usage/) para modo portable, integración con la terminal y preguntas frecuentes.
- Aprendé cómo se firman y aplican las [actualizaciones](/docs/updates/).
- ¿Venís de VS Code? Seguí la [guía de migración](/docs/migration/).
- ¿Algo no funciona? Revisá [Solución de problemas](/docs/troubleshooting/).
- ¿Querés ayudar? Leé la [guía de contribución](/docs/contributing/) y sumate a las [discusiones](https://github.com/Niiihuel/openide/discussions).
