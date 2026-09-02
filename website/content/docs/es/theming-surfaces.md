---
title: Superficies y temas
description: Cómo la UI propia de OpenIDE obtiene sus colores, y las cinco formas en que salió mal.
---

Cada regla acá viene de un bug que llegó a producción. Todas comparten una forma: **la superficie se veía correcta en el tema contra el que se escribió, y se rompía en otro.** Ninguna se anunció como un error; el IDE simplemente se veía un poco raro, que es el tipo de defecto más caro de arrastrar, porque nadie lo reporta y se acumula durante meses.

`dev/audit-surface-tokens.mjs` hace cumplir los dos invariantes que se pueden chequear de forma estática. El resto son reglas de revisión.

## 1. Los tokens del fork se declaran donde viven las variables del tema

El workbench define `--vscode-*` en **`.monaco-workbench`**, no en `:root`.

`openideSurfaceCss.ts` define los tokens del producto (`--oi-surface`, `--oi-raised`, `--oi-card`, …) y cada uno de ellos deriva de un `--vscode-*`. Declarado solo en `:root`, cada token resolvía a *invalid at computed-value time* y no computaba nada en cada superficie nativa: el dock del chat, Settings, el editor de planes, el Project Map. Todas venían corriendo sobre los fallbacks de cada regla en lugar del sistema de diseño.

El selector tiene que llevar los dos scopes:

```css
:root, .monaco-workbench { --oi-surface: …; }
```

`:root` es lo que aplica adentro de un webview, donde `.monaco-workbench` no existe y el host exporta el tema como custom properties en la raíz del iframe.

*Auditado.* Verificado en `auditTokenScope`.

## 2. Una superficie usa la familia de color que la pinta

El fork no pinta sus partes con `sideBar.background`. `sidebarPart.ts` usa `openide.islandBackground`, el diseño de "isla". Una regla que en cambio recurre al id de upstream se ve idéntica en un tema que define los dos igual, y se parte en dos en el momento en que un tema no lo hace.

`openide.islandBackground` cae de vuelta (fallback) a `editorBackground`, así que cualquier tema que no lo defina igual resuelve, solo que a un valor distinto de `sideBar.background`. Ese es exactamente el caso que rompe.

Escribí las superficies del fork contra `--oi-surface`. Recurrí a un id `--vscode-*` directamente solo cuando la superficie realmente pertenece a upstream.

## 3. Nada de `opacity` sobre un color que ya tiene tema

Un separador pintado con `menu.separatorBackground` y después atenuado con `opacity: .5` es legible en un tema con un color de separador fuerte, e invisible en uno que no lo tiene. El autor del tema ya decidió qué tan visible debía ser esa línea; reducirla a la mitad pisa esa decisión en la dirección de "desaparecer".

Si un color necesita ser más suave, definilo más suave, o dejá que lo lleve el propio token del tema.

## 4. Un solo widget es dueño de su borde y de su anillo de foco

Un `<input>` crudo adentro de un `<div>` con estilos produce **dos** anillos apenas toma foco: el wrapper dibuja el suyo con `:focus-within`, y el input recibe el outline global `[tabindex]:focus` del workbench. El `outline: none` que normalmente se escribe para suprimir el segundo pierde por especificidad: `:not()` toma la especificidad de su argumento, así que la guarda obvia empata con la regla global y pierde por orden de carga.

Esto produjo tres reportes separados de "doble borde" antes de que se nombrara el patrón. El arreglo no es un override más específico: es usar el widget nativo (`InputBox`, `Button`, `SelectBox`, `Checkbox` de `base/browser/ui/`), que es un único elemento dueño de ambos. Los widgets nativos también traen los colores del tema, el manejo del foco, el alto contraste y las métricas de escalado de fuente; cada copia hecha a mano es una cosa más que se desvía.

## 5. Nada de comillas invertidas dentro de comentarios CSS-in-TS

`openideSurfaceCss.ts` es un template literal de TypeScript que contiene una hoja de estilos. Un backtick adentro cierra el literal, incluso uno dentro de un comentario donde se lee como comillas comunes. El error de parseo aparece entonces de cuatro a ocho líneas más allá, en código sin relación, sin nada que señale la causa. Esto ya costó dos sesiones de debugging separadas.

Usá comillas normales en esos comentarios.

*Auditado.* Verificado en `auditBackticks`.

## Verificar una superficie

El typecheck no prueba nada sobre el color. El IDE corre con `--remote-debugging-port=9222`; manejalo con `playwright-core` a través de `chromium.connectOverCDP` y leé los estilos computados.

Dos trampas que vale la pena conocer antes de confiar en una medición:

- Leé el lado que corresponde. Una sonda que reporta `borderTopWidth` para cualquier lado que haya detectado va a llamar "0px" a un elemento con `border-right: 1px` y sacarlo de sospecha. Ese error escondió los separadores de Settings durante toda una ronda.
- Una `mask` de CSS pinta el fondo propio del elemento a través del glifo. Sin `background-color` y `mask-size` la marca es una caja invisible, no un archivo faltante, y un asset que llega en una placa a sangre completa se renderiza como un cuadrado sólido.

Chequeá al menos dos temas con paletas distintas. Un solo tema oscuro va a estar de acuerdo con casi cualquier error de este documento.
