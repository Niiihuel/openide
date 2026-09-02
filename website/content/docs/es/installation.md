---
title: Instalación
description: Todos los formatos publicados para Linux y Windows, además de NixOS y compilar desde el código fuente.
---

Todos los builds provienen de la [página de GitHub Releases](https://github.com/Niiihuel/openide/releases). Cada release incluye los artefactos junto con archivos de checksum `.sha256` y un manifiesto de actualización firmado; verificá el checksum antes de instalar cualquier cosa que hayas descargado a mano.

## Linux

### AppImage (recomendado)

El AppImage es el único formato de Linux que el actualizador integrado puede reemplazar por sí solo. Descargá `OpenIDE-<version>-x86_64.AppImage`, hacelo ejecutable y ejecutalo:

```bash
chmod +x OpenIDE-*.AppImage
./OpenIDE-*.AppImage
```

La instalación mutable soportada vive en `~/.local/bin/OpenIDE.AppImage`. Cuando se instala una actualización, el archivo nuevo se escribe como `.pending`, el anterior se conserva como `.previous` y se escribe un marcador de salud; si el primer inicio de la nueva versión falla, el wrapper restaura la versión anterior una vez. Mirá [Actualizaciones](/docs/updates/).

### Tarball

`OpenIDE-linux-<arch>-<version>.tar.gz` contiene el build genérico de Linux. Extraelo donde quieras y ejecutá el punto de entrada:

```bash
tar -xzf OpenIDE-linux-x64-*.tar.gz
./OpenIDE-linux-x64/bin/openide
```

El lanzador `bin/openide` es lo que los gestores de paquetes ponen en tu `PATH`.

### Paquetes

El workflow de release también produce paquetes `.deb` y `.rpm` construidos desde el mismo árbol. Instalalos con tu gestor de paquetes:

```bash
sudo dpkg -i openide_*.deb     # Debian, Ubuntu y derivados
sudo rpm -i openide-*.rpm      # Fedora, RHEL, openSUSE
```

Las instalaciones por paquete se actualizan con tu gestor de paquetes, no con el actualizador integrado.

### NixOS

Una derivación bajo `/nix/store` nunca se modifica automáticamente, así que en NixOS el AppImage mutable en `~/.local/bin` es la vía soportada. El repositorio incluye un sandbox FHS para ejecutar y compilar el producto:

```bash
nix-build dev/openide-fhs.nix -o result-fhs
./result-fhs/bin/openide-build -c './VSCode-linux-x64/openide --user-data-dir ~/.config/OpenIDE'
```

`dev/install-appimage.sh` instala el AppImage en la ubicación soportada y conecta el wrapper.

## Windows

Descargá el instalador desde el último release y seguí el asistente. Durante la instalación podés habilitar *Add "Open with OpenIDE" action to Windows Explorer file context menu*; en Windows 11 la opción puede quedar oculta detrás de *Show more options* (Shift + clic derecho).

Los instaladores de Windows actualmente se publican **sin firmar**, porque hay que comprarle un certificado Authenticode a una CA. La actualización automática igual funciona (el actualizador verifica su propia firma Ed25519 y el hash del artefacto), pero SmartScreen y Windows Defender pueden advertir cuando descargás el instalador manualmente. Verificá el SHA-256 publicado junto al release y mirá [Solución de problemas](/docs/troubleshooting/#windows-defender-marca-el-instalador-como-malware).

Los despliegues por Group Policy leen de `HKLM\SOFTWARE\Policies\OpenIDE\OpenIDE`; mirá la [sección de Windows en Solución de problemas](/docs/troubleshooting/#windows).

## macOS

Todavía no hay un build de macOS firmado publicado. El código fuente compila y corre en macOS; mirá [Compilar OpenIDE](/docs/building/).

## Servidor y archivos remotos

Cada release también contiene `openide-reh-<platform>-<arch>-<version>.tar.gz` (el host remoto usado por los flujos de SSH y WSL) y `openide-reh-web-…` (el servidor detrás de `openide serve-web`). Están explicados en [Otros recursos](/docs/other-resources/).

## Verificar una descarga

```bash
sha256sum -c OpenIDE-1.121.1-x86_64.AppImage.sha256
```

Los archivos de checksum se generan en el workflow de release a partir de los bytes exactos que se subieron.
