---
title: Cómo contribuir
description: Cómo reportar errores, configurar un entorno de desarrollo, validar un cambio y abrir un pull request.
---

Gracias por tomarte el tiempo de contribuir. Esta página resume el [CONTRIBUTING.md](https://github.com/Niiihuel/openide/blob/master/CONTRIBUTING.md) del repositorio.

## Código de conducta

Este proyecto y todos los que participan en él se rigen por el [Código de conducta de OpenIDE](https://github.com/Niiihuel/openide/blob/master/CODE_OF_CONDUCT.md). Al participar, se espera que lo respetes.

## Uso de IA

El uso de herramientas de IA para ayudar a redactar discusiones, issues o código es bienvenido, con estas reglas:

- Usá las herramientas de IA de forma responsable y divulgá su uso.
- Asegurate de que todo el contenido pase una revisión humana de autenticidad y calidad.
- Sé conciso. No escribas discusiones, issues o pull requests extensos.

Las discusiones, issues o pull requests que consistan únicamente en salida de IA sin revisar pueden cerrarse a criterio del mantenedor.

## Reportar errores

Antes de abrir un issue, revisá los [issues existentes](https://github.com/Niiihuel/openide/issues) y la [página de solución de problemas](/docs/troubleshooting/). Cuando reportes un error, completá la [plantilla de reporte de errores](https://github.com/Niiihuel/openide/issues/new?labels=bug&template=bug_report.md) con todos los detalles que puedas; esa información es lo que hace que un error sea reproducible.

## Cómo está organizado el repositorio

**OpenIDE mantiene su árbol de fuentes completo en `vscode/`. Esa carpeta es la fuente de verdad: la editás directamente, y ningún comando de build la resetea, reemplaza o regenera.**

OpenIDE empezó como un fork de VSCodium, que personaliza VS Code aplicando una pila de archivos `.patch` al momento del build. OpenIDE ya no hace eso: no hay carpeta `patches/`, ni script de parches, ni un paso de "regenerar el parche después de editar". Si encontrás documentación o herramientas que todavía describan un flujo de parches, está desactualizada; por favor reportalo.

El esquema de versión es `majorCodeOss.minorCodeOss.openideRevision`. Por ejemplo, `1.121.1` es la revisión 1 de OpenIDE sobre la API de Code OSS 1.121, lo que mantiene las extensiones compatibles a la vez que permite releases independientes.

El código que pertenece a OpenIDE y no a VS Code upstream vive en:

| Ruta | Qué contiene |
| --- | --- |
| `vscode/src/vs/workbench/contrib/openideAgent/` | El motor del agente, la UI del chat, providers, tools, subagents, MCP, skills y la memoria del código base |
| `vscode/src/vs/workbench/contrib/openideSettings/` | Las superficies de configuración de OpenIDE |
| `vscode/src/vs/workbench/contrib/openideUpdate/` | UI de actualizaciones |
| `vscode/src/vs/platform/openideAgentHost/` | Agent host que corre en el proceso principal |
| `vscode/src/vs/platform/openideBrowser/` | Servicio de automatización del navegador |
| `vscode/src/vs/platform/update/openide*` | Manifiesto de actualización firmado, verificador y actualizador de AppImage |

Todo lo demás bajo `vscode/` es fuente de VS Code upstream. Preferí mantener tus cambios dentro de las rutas propias de OpenIDE; tocar archivos de upstream a veces es necesario, pero cada cambio de esos es una cosa más para reconciliar cuando se actualiza Code OSS, así que mantenelos chicos y obvios. [Arquitectura del fork](/docs/fork-architecture/) explica por qué.

## Preparar el entorno

La versión de Node está fijada en `.nvmrc`. También necesitás `git`, `jq`, `python3` y `rustup`, más las dependencias de build de la plataforma listadas en [Compilar OpenIDE](/docs/building/).

```bash
git clone https://github.com/Niiihuel/openide.git
cd openide/vscode
npm ci
```

En NixOS usá el sandbox FHS en lugar de instalar dependencias globalmente; ver [Compilar OpenIDE](/docs/building/#compilar-en-nixos).

## Hacer un cambio

Compilá el TypeScript y lanzá una instancia de desarrollo:

```bash
cd vscode
npm run compile
./scripts/code.sh
```

Para un loop incremental, ejecutá `npm run watch` en una segunda terminal y reiniciá `./scripts/code.sh` cuando necesites una ventana nueva. La instancia de desarrollo mantiene su propio perfil en `~/.config/code-oss-dev`, así que no interfiere con una copia instalada de OpenIDE.

### Reglas de capas

El código fuente está dividido en capas `common/`, `browser/`, `node/` y `electron-*/`, y esa división se hace cumplir:

- `common/` no debe importar de ninguna otra capa. Mantené acá la lógica pura; también es la capa más fácil de testear con unit tests.
- `browser/` puede importar `common/` y puede usar APIs del DOM.
- `node/` y `electron-*/` pueden importar `common/` y pueden usar APIs de Node.

Ejecutá `npm run valid-layers-check` para verificar. Una violación de capas hace fallar el CI. La lógica nueva que se pueda expresar sin acceso al DOM o a Node va en `common/`, con un test al lado en `test/common/`.

### Idioma

El código, los comentarios y la documentación se escriben en inglés. Partes del código base todavía tienen comentarios en español de antes de que existiera esa regla; `dev/comment-language-allowlist.json` rastrea lo que queda, por archivo, y funciona como un trinquete: un archivo nunca puede superar su presupuesto registrado.

```bash
node dev/audit-comment-language.mjs                 # check (CI runs this)
node dev/audit-comment-language.mjs --list <path>   # show what is pending in a file
node dev/audit-comment-language.mjs --update        # after translating, lower the budgets
```

## Validar tu cambio

Ejecutá lo mismo que corre el CI, en este orden. Desde la raíz del repositorio:

```bash
# 1. Reliability gates: invariants that must hold before a release
node dev/check-reliability-gates.mjs
node --test dev/reliability-gates.test.mjs

# 2. Branding audit: catches upstream branding leaking into the product
node dev/audit-branding.mjs

# 3. Comment language: code and comments are written in English
node dev/audit-comment-language.mjs
```

Después, desde `vscode/`:

```bash
# 4. Compile
npm run compile

# 5. Unit tests that run in Node
./node_modules/.bin/mocha --ui tdd --timeout 10000 --exit \
  out/vs/platform/openideAgentHost/test/common/openideAgentHost.test.js \
  'out/vs/workbench/contrib/openideAgent/test/common/*.test.js'

# 6. Unit tests that need a DOM
npm run test-browser-no-install -- \
  --runGlob 'vs/workbench/contrib/openideAgent/test/browser/*.test.js' \
  --browser chromium
```

Si tu cambio afecta la UI, verificalo también en una ventana real del producto; que compile no es evidencia de que una superficie se renderice correctamente. Si toca un invariante cubierto por `dev/reliability-gates.json` (actualizaciones, rollback del chat, permisos de subagents y similares), leé primero [Confiabilidad](/docs/reliability/): esos gates tienen reglas explícitas de promoción y degradación, y debilitar uno es una decisión que se revisa, no un efecto secundario.

Un build completo del producto solo hace falta cuando cambiás el empaquetado o el build en sí.

## Abrir un pull request

- Mantené el pull request enfocado en un solo cambio. Las limpiezas no relacionadas van en su propio commit o pull request.
- Explicá *por qué* hace falta el cambio, no solo qué hace. El diff ya dice qué hace.
- Indicá cómo lo verificaste: cuáles de los checks de arriba corriste, y si probaste el cambio en una ventana real.
- Si cambiaste un comportamiento que un usuario puede observar, actualizá la página de documentación correspondiente.
