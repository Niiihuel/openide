# Cómo está armado el fork

OpenIDE es un fork de Code OSS (VS Code sin la marca ni la telemetría de
Microsoft). Este documento explica **dónde vive cada cosa y por qué**, porque la
estructura de un fork de VS Code no se parece a la de un proyecto normal: la
mayor parte del árbol no es tuya, y saber distinguir qué es tuyo de qué es de
upstream es lo que hace que actualizar sea posible.

## Los dos modelos, y cuál usamos

Un fork de VS Code se mantiene de una de dos formas:

**Por parches** (el modelo de VSCodium). El repositorio NO contiene el código de
VS Code: contiene una carpeta `patches/` y un script que clona el fuente al
construir. La ventaja es que un parche que deja de aplicar te *avisa* exactamente
dónde cambió upstream. La desventaja es que trabajar así es incómodo: no podés
abrir el proyecto y editarlo, cada cambio es un parche que hay que regenerar.

**Vendorizado** (el nuestro). El árbol completo de Code OSS vive en `vscode/` y
se edita directo. Es cómodo para desarrollar y es lo que permite tener 74.000
líneas propias sin volverse loco. El costo es que perdés el aviso automático:
nada te dice qué tocaste vos.

OpenIDE usa el modelo **vendorizado**. No hay carpeta `patches/`, y `get_repo.sh`
no clona nada — espera que `vscode/` ya esté ahí. Ese costo lo compensamos con
las herramientas de la sección "Actualizar".

## El reparto del árbol

Medido sobre `vscode/src`:

| | archivos | qué es |
|---|---|---|
| Código propio de OpenIDE | 458 | `contrib/openideAgent`, `contrib/openideSettings`, `platform/openideBrowser`, etc. |
| Archivos de upstream modificados | 511 | integraciones: el chat en la auxiliary bar, el updater, la marca |
| Resto de Code OSS | ~6.600 | intacto |

Sos el **6%** del árbol. Ese número importa: no reescribiste VS Code, lo
extendiste. Mientras se mantenga bajo, actualizar sigue siendo viable.

También hay 4.200 archivos de upstream **borrados**, de los cuales 4.103 son
`extensions/copilot` — la extensión de Copilot que viene con Code OSS y que acá
sobra, porque el agente es propio.

## Dónde va el código nuevo

La regla: **todo lo propio vive en carpetas con prefijo `openide`**, para que un
`git grep openide` responda "qué agregamos nosotros".

```
vscode/src/vs/
  workbench/contrib/openideAgent/     el agente, el chat, Project Map, estilos
    common/                            lógica pura, sin DOM  → testeable
    browser/                           widgets y servicios de UI
    test/                              tests que corren en Chromium
  workbench/contrib/openideSettings/  la pantalla de Settings propia
  platform/openideBrowser/            automatización del navegador nativo
    common/                            contrato compartido
    electron-main/                     el proceso principal (Playwright)
```

La separación `common/` vs `browser/` no es decorativa: `common/` no puede
importar DOM ni servicios, así que se testea sin levantar un navegador. Cuando
algo se pueda expresar como función pura, va ahí.

**Tocar un archivo de upstream es una decisión, no un accidente.** Cada uno de
esos 511 archivos es trabajo extra en cada actualización. Antes de editar uno,
preguntate si el cambio puede vivir en una carpeta `openide*` y engancharse por
un registro (un `registerSingleton`, un `registerAction2`, una contribución de
vista). Casi siempre se puede.

## Actualizar Code OSS

El ancla es `openide-version.json`:

```json
"codeOss": { "version": "1.121.0", "commit": "987c9597..." }
```

Ese commit es **de qué versión de upstream salió este árbol**. Sin él no habría
forma de calcular el delta.

El proceso lo hace `dev/sync-codeoss.sh`:

1. Lee el commit actual de `openide-version.json`.
2. Baja el commit destino de `microsoft/vscode`.
3. Calcula el delta de upstream: `git diff <actual> <destino>`.
4. Lo aplica con `git apply --3way --directory=vscode`.

El `--3way` es lo importante: hace un merge de tres vías, así que **conserva tus
cambios** y donde no puede decidir deja un conflicto explícito para que lo
resuelvas a mano. Es lo mismo que hace un `git merge`, pero contra un árbol que
no comparte historia con el tuyo.

Corre solo todos los lunes (`.github/workflows/sync-codeoss.yml`) y abre un PR.
El workflow además compila, así que un PR verde significa que el merge no rompió
la compilación — no que la funcionalidad siga bien.

Después de una actualización, `version` sube a `<major>.<minor>.0` de Code OSS y
la tercera cifra es la revisión de OpenIDE: `1.121.1` es la revisión 1 sobre la
API de Code OSS 1.121.

## Las barandas

Tres capas, de la más rápida a la más lenta:

**El hook de pre-commit** (husky) corre el *hygiene* de VS Code sobre lo que
estás por commitear. Exige **tabs** para indentar y prohíbe espacios al final de
línea. Si un commit se rechaza con cientos de "Bad whitespace indentation", es
esto: arreglá la indentación, no uses `--no-verify`.

**Los audits** (`dev/audit-*.mjs`) son invariantes que ya costaron una sesión de
debugging cada uno, escritos para que no vuelvan a pasar:

- `audit-surface-tokens.mjs` — que los tokens `--oi-*` se declaren donde el tema
  publica sus variables. Se declararon una vez solo en `:root` y todas las
  superficies nativas corrieron meses sobre los fallbacks sin que se notara.
- `audit-branding.mjs` — que no se filtre marca de VSCodium/Microsoft a lo que
  se distribuye.
- `audit-comment-language.mjs` — consistencia de idioma en los comentarios.

**El CI** (`.github/workflows/ci-openide.yml`) corre los audits, compila, y
ejecuta los tests: contrato del updater firmado, agente en Node y agente en
Chromium.

## El canal de actualizaciones

OpenIDE se actualiza solo, y eso es superficie de ataque: si alguien puede
convencer al IDE de bajar un binario, ejecuta código en tu máquina. Por eso el
manifiesto viene firmado con Ed25519 (`updater.publicKey` en
`openide-version.json`) y `openideUpdateManifest.ts` valida además:

- que la URL sea HTTPS, sin usuario ni contraseña;
- que el host esté en la allowlist;
- que la **ruta** sea de este repositorio (regex contra `/Niiihuel/openide/...`);
- el tamaño y el `sha256` del artefacto.

Si movés el repositorio de cuenta, esa regex hay que actualizarla o el updater
rechaza toda release legítima. Falla cerrada, que es la dirección correcta, pero
silenciosa.

## Verificar sin esperar al CI

```bash
# Typecheck del árbol (TypeScript 7 nativo)
cd vscode && node node_modules/@typescript/native/bin/tsc \
  --project ./src/tsconfig.json --noEmit --skipLibCheck

# Transpilar a out/ (los tests corren sobre out/, no sobre src/)
npx tsx build/next/index.ts transpile

# Tests del agente en Chromium
node test/unit/browser/index.js --browser chromium --grep Openide

# Levantar la IDE y sacarle capturas
node dev/visual-check.mjs --open=usage
```

En NixOS todo eso va adentro de `./result-fhs/bin/openide-build -c "..."`.

Ver [BUILD.md](../BUILD.md) para el build completo y el empaquetado.
