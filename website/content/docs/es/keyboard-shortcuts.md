---
title: Atajos de teclado
description: OpenIDE conserva el keymap de Code OSS, así que tu memoria muscular y los atajos de cada extensión siguen funcionando.
---

OpenIDE conserva el mapa de comandos compatible con Code OSS y el ecosistema de extensiones. Navegá y personalizá cada atajo desde **File > Preferences > Keyboard Shortcuts** (`Ctrl+K Ctrl+S` en Linux y Windows, `⌘K ⌘S` en macOS).

## Lo esencial

| Acción | Linux / Windows | macOS |
| --- | --- | --- |
| Quick Open, ir a un archivo | `Ctrl+P` | `⌘P` |
| Paleta de comandos | `Ctrl+Shift+P` | `⇧⌘P` |
| Configuración de usuario | `Ctrl+,` | `⌘,` |
| Editor de atajos de teclado | `Ctrl+K Ctrl+S` | `⌘K ⌘S` |
| Mostrar/ocultar la terminal | `` Ctrl+` `` | `` ⌃` `` |
| Mostrar/ocultar la barra lateral | `Ctrl+B` | `⌘B` |
| Ir a un símbolo en el workspace | `Ctrl+T` | `⌘T` |
| Buscar en archivos | `Ctrl+Shift+F` | `⇧⌘F` |

## Comandos del agente

El agente registra sus acciones como comandos normales, así que podés asignarle un atajo a cualquiera de ellos desde el editor de atajos de teclado. Buscá `OpenIDE` en el editor para listarlos. Algunos útiles:

| Comando | Qué hace |
| --- | --- |
| `openide.agent.newChat` | Inicia un chat nuevo en el panel derecho |
| `openide.agent.forkChat` | Bifurca la conversación actual |
| `openide.agent.selectProvider` | Elige el proveedor y el modelo activos |
| `openide.agent.openProviders` | Abre la configuración de proveedores |
| `openide.agent.pickElement` | Inicia Pick & Polish sobre la vista previa local |
| `openide.localPreview` | Abre la vista previa de localhost |
| `openide.plan.open` | Abre un plan en el editor de planes |
| `openide.canvas.open` | Abre un canvas |
| `openide.memory.open` | Abre el grafo de memoria del código |
| `openide.markdown.validate` | Valida el documento Markdown activo |

## Importar tus atajos de teclado

Tu `keybindings.json` de VS Code se puede copiar tal cual a la carpeta de usuario de OpenIDE. Mirá [Migración](/docs/migration/).
