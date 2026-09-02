---
title: Compilar OpenIDE
description: Dependencias, el loop de iteración rápida, el build completo del producto, NixOS, el empaquetado y las reglas de mantenimiento.
---

OpenIDE mantiene su árbol de fuentes completo en `vscode/`. **Esa carpeta es la fuente de verdad**: la editás directamente, y ningún comando de build la resetea, reemplaza o regenera a partir de parches.

El esquema de versión es `majorCodeOss.minorCodeOss.openideRevision`. Por ejemplo, `1.121.1` es la revisión 1 de OpenIDE sobre la API de Code OSS 1.121. Esto mantiene las extensiones compatibles a la vez que permite releases independientes.

## Dependencias

Comunes a todas las plataformas:

- `node`, ver `.nvmrc` para la versión exacta
- `git`
- `jq`
- `python3` 3.11
- `rustup`

### Linux

`gcc`, `g++`, `make`, `pkg-config`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, `libkrb5-dev`, `fakeroot`, `rpm`, `rpmbuild`, `dpkg`, `imagemagick` (para AppImage), `snapcraft` (para Snap).

### macOS

Solo las dependencias comunes de arriba.

### Windows

Los scripts de build están escritos en Bash, así que ejecutalos dentro de **Git Bash** (incluido con [Git for Windows](https://gitforwindows.org/)) o **WSL2**. Se recomienda Git Bash porque los scripts dependen de utilidades POSIX (`sed`, `grep`, `find`) que vienen incluidas; si usás WSL2, seguí las dependencias de Linux en su lugar.

```cmd
winget install --id Git.Git -e
winget install --id jqlang.jq -e
winget install --id 7zip.7zip -e
winget install --id Python.Python.3.11 -e
winget install --id Rustlang.Rustup -e
```

Para Node, usá [nvm-windows](https://github.com/coreybutler/nvm-windows) con la versión de `.nvmrc`, o descargalo de [nodejs.org](https://nodejs.org/) con *Automatically install the necessary tools* habilitado para que los addons nativos puedan compilar. Reiniciá tu shell después de instalar rustup para que `cargo` quede en el `PATH`.

Empaquetar instaladores `.msi` además necesita [WiX Toolset v3](https://wixtoolset.org/releases/), con `candle.exe` y `light.exe` en el `PATH`.

Verificá que todo se pueda encontrar desde Git Bash:

```bash
node --version    # should match .nvmrc
npm --version
jq --version
python3 --version # should be 3.11.x
cargo --version
7z i 2>&1 | head -1
git --version
```

## Iteración rápida

Este es el loop para el trabajo del día a día. Compila el TypeScript y lanza una instancia de desarrollo sin producir un producto empaquetado:

```bash
cd vscode
npm ci          # first checkout only
npm run compile
./scripts/code.sh
```

Ejecutá `npm run watch` en una segunda terminal para rebuilds incrementales.

La instancia de desarrollo guarda su perfil en `~/.config/code-oss-dev`, así que no interfiere con una copia instalada de OpenIDE. Pasá `--remote-debugging-port=9333` si querés inspeccionarla por CDP.

Para los checks que hay que correr antes de abrir un pull request, ver [Cómo contribuir](/docs/contributing/#validar-tu-cambio).

## Build completo del producto

```bash
. dev/build.sh
```

El resultado en Linux termina en `VSCode-linux-x64/`. El primer build de un checkout nuevo ejecuta `npm ci`; los builds siguientes reutilizan `vscode/node_modules`.

En Windows:

```bash
"C:\Program Files\Git\bin\bash.exe" ./dev/build.sh    # Git Bash, recommended
powershell -ExecutionPolicy ByPass -File .\dev\build.ps1
```

### Flags

`dev/build.sh` acepta:

- `-i`: compila el canal Insiders
- `-o`: se salta el paso de build
- `-p`: genera los paquetes, assets e instaladores

Si GitHub limita la tasa de descargas de extensiones, pasá un token:

```bash
GITHUB_TOKEN=$(gh auth token) . dev/build.sh
```

`dev/build.sh` está pensado para desarrollo. Los releases los produce `.github/workflows/release-openide.yml`, que es la referencia de cómo se arma un build real.

## Compilar en NixOS

Creá el sandbox FHS una vez (y cada vez que cambie `dev/openide-fhs.nix`):

```bash
nix-build dev/openide-fhs.nix -o result-fhs
```

Después, ejecutá cualquiera de los comandos de arriba adentro de él:

```bash
./result-fhs/bin/openide-build -c 'cd vscode && npm run compile'
./result-fhs/bin/openide-build -c 'cd vscode && ./scripts/code.sh'
./result-fhs/bin/openide-build -c '. dev/build.sh'
```

Para ejecutar el producto compilado:

```bash
./result-fhs/bin/openide-build -c \
  './VSCode-linux-x64/openide --user-data-dir ~/.config/OpenIDE'
```

`shell.nix` te da una shell interactiva en el mismo entorno.

## Empaquetado

### Snap

```bash
cd ./stores/snapcraft/stable    # or ./stores/snapcraft/insider
snapcraft --use-lxd
review-tools.snap-review --allow-classic openide*.snap
```

### AppImage

Ver `dev/build-appimage.sh` y `dev/install-appimage.sh`. El AppImage es el formato que el actualizador integrado puede reemplazar por sí solo; ver [Actualizaciones](/docs/updates/).

### Íconos

`icons/build_icons.sh` necesita `imagemagick`, `librsvg` y `png2icns` (`npm install png2icns -g`).

## Reglas de mantenimiento

- Las funcionalidades de OpenIDE viven directamente bajo `vscode/src/`. Ver la [tabla de organización del código fuente](/docs/contributing/#c-mo-est-organizado-el-repositorio) para saber qué rutas son de OpenIDE.
- Los recursos y la configuración del producto viven dentro de `vscode/`.
- No se agregan parches para que una funcionalidad compile.
- Un cambio se valida con un typecheck o compile y, si afecta la UI, en una ventana real del producto.
- Las actualizaciones de Code OSS se integran como cambios de código revisables, nunca borrando el árbol local durante un build.
- Los scripts de empaquetado deciden los nombres de los instaladores, los íconos y los feeds de actualización, así que la marca heredada ahí llega directo a los usuarios. `node dev/audit-branding.mjs` escanea tanto el producto distribuido como los scripts que lo producen; mantenelo en verde.
