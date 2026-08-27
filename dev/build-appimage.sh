#!/usr/bin/env bash
#
# Empaqueta el producto Linux de OpenIDE en un AppImage.
# Requiere un build previo:  . dev/build.sh   (genera VSCode-linux-x64/).
#
# En NixOS se auto-ejecuta dentro del wrapper FHS (result-fhs) porque el
# appimagetool bajado es un ELF que necesita /lib64/ld-linux-x86-64.so.2,
# inexistente fuera del FHS.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- NixOS: re-ejecutar dentro del FHS si falta el dynamic loader ------------
# appimagetool (un AppImage/ELF) necesita el loader de glibc, y además invoca
# `file` y `mksquashfs`. El wrapper FHS provee las tres cosas.
#
# NO alcanza con chequear que /lib64/ld-linux-x86-64.so.2 exista: NixOS instala
# ahí un stub de nix-ld que existe y es ejecutable pero aborta con "cannot run
# dynamically linked executables". Con la guarda anterior el script se quedaba
# afuera del sandbox y appimagetool moría con "file command is missing".
# Se comprueba que el loader realmente CORRA (--version sale 0; el stub, 127).
needs_fhs="no"
/lib64/ld-linux-x86-64.so.2 --version > /dev/null 2>&1 || needs_fhs="yes"
command -v file > /dev/null 2>&1 || needs_fhs="yes"
command -v mksquashfs > /dev/null 2>&1 || needs_fhs="yes"

if [[ "${needs_fhs}" == "yes" ]]; then
	# El flag corta la recursión: si adentro del FHS sigue faltando algo, se
	# reporta en vez de reejecutarse para siempre.
	if [[ -n "${OPENIDE_IN_FHS:-}" ]]; then
		echo "Ya estoy dentro del FHS y siguen faltando el loader de glibc, 'file' o 'mksquashfs'." >&2
		echo "Revisá los paquetes de dev/openide-fhs.nix y regenerá el wrapper." >&2
		exit 1
	fi
	FHS="${OPENIDE_FHS:-${ROOT_DIR}/result-fhs/bin/openide-build}"
	if [[ -x "${FHS}" ]]; then
		exec env OPENIDE_IN_FHS=1 "${FHS}" -c "cd '${ROOT_DIR}' && bash '${ROOT_DIR}/dev/build-appimage.sh'"
	fi
	echo "NixOS: falta el toolchain del AppImage y no encuentro el wrapper FHS." >&2
	echo "Crealo con:  nix-build dev/openide-fhs.nix -o result-fhs" >&2
	exit 1
fi

PRODUCT_DIR="${PRODUCT_DIR:-${ROOT_DIR}/VSCode-linux-x64}"
VERSION="${RELEASE_VERSION:-$(jq -er '.version' "${ROOT_DIR}/openide-version.json")}"
WORK_DIR="${ROOT_DIR}/.build/openide-appimage"
APP_DIR="${WORK_DIR}/OpenIDE.AppDir"
OUTPUT_DIR="${ROOT_DIR}/assets"
ARCH="${APPIMAGE_ARCH:-x86_64}"
OUTPUT_FILE="${OUTPUT_DIR}/OpenIDE-${VERSION}-${ARCH}.AppImage"
CACHE_DIR="${XDG_CACHE_HOME:-${HOME}/.cache}/openide-build"
# Override: APPIMAGETOOL_BIN=/ruta/appimagetool-x86_64.AppImage  (para builds
# reproducibles vendé tu propia copia verificada; ver README del repo AppImage).
APPIMAGETOOL="${APPIMAGETOOL_BIN:-${CACHE_DIR}/appimagetool-x86_64.AppImage}"

if [[ ! -x "${PRODUCT_DIR}/openide" ]]; then
	echo "No se encontró el producto Linux en ${PRODUCT_DIR}. Ejecutá primero: . dev/build.sh" >&2
	exit 1
fi

rm -rf "${APP_DIR}"
mkdir -p \
	"${APP_DIR}/usr/bin" \
	"${APP_DIR}/usr/share/openide" \
	"${APP_DIR}/usr/share/applications" \
	"${OUTPUT_DIR}" \
	"${CACHE_DIR}"

# --- Producto + symlink de CLI ----------------------------------------------
cp -a "${PRODUCT_DIR}/." "${APP_DIR}/usr/share/openide/"
ln -s ../share/openide/openide "${APP_DIR}/usr/bin/openide"

# --- Icono hicolor en la resolución correcta + .DirIcon ----------------------
# El source puede no ser 512x512 (este build es 1024x1024): lo ubicamos en el
# dir hicolor que coincide con su resolución real y, si hay imagemagink, se
# generan los tamaños menores por downscale.
SOURCE_ICON="${PRODUCT_DIR}/resources/app/resources/linux/code.png"
ICON_RES="1024x1024"
if command -v identify >/dev/null 2>&1; then
	w=$(identify -format '%w' "${SOURCE_ICON}" 2>/dev/null || echo 1024)
	h=$(identify -format '%h' "${SOURCE_ICON}" 2>/dev/null || echo 1024)
	ICON_RES="${w}x${h}"
fi
mkdir -p "${APP_DIR}/usr/share/icons/hicolor/${ICON_RES}/apps"
cp "${SOURCE_ICON}" "${APP_DIR}/usr/share/icons/hicolor/${ICON_RES}/apps/openide.png"
if command -v convert >/dev/null 2>&1; then
	for size in 512 256 128 64 48 32; do
		mkdir -p "${APP_DIR}/usr/share/icons/hicolor/${size}x${size}/apps"
		convert "${SOURCE_ICON}" -resize "${size}x${size}" \
			"${APP_DIR}/usr/share/icons/hicolor/${size}x${size}/apps/openide.png" 2>/dev/null || true
	done
fi
# icono raíz del AppDir + .DirIcon (appimagetool los usa para el thumbnail)
cp "${SOURCE_ICON}" "${APP_DIR}/openide.png"
cp "${SOURCE_ICON}" "${APP_DIR}/.DirIcon"

# --- Desktop entry ----------------------------------------------------------
# StartupWMClass=OpenIDE coincide con product.json nameShort (Electron usa
# nameShort como WM_CLASS). Si la ventana no agrupa bien en el dock, verificá
# con:  xprop WM_CLASS   sobre la ventana abierta.
printf '%s\n' \
	'[Desktop Entry]' \
	'Name=OpenIDE' \
	'Comment=Open source agentic development environment' \
	'GenericName=Integrated Development Environment' \
	'Exec=openide %F' \
	'Icon=openide' \
	'Type=Application' \
	'StartupNotify=true' \
	'StartupWMClass=OpenIDE' \
	'Categories=Development;IDE;TextEditor;' \
	'MimeType=text/plain;inode/directory;' \
	'Actions=new-empty-window;' \
	'' \
	'[Desktop Action new-empty-window]' \
	'Name=New Empty Window' \
	'Name[es]=Nueva ventana vacía' \
	'Exec=openide --new-window' \
	'Icon=openide' \
	> "${APP_DIR}/openide.desktop"
cp "${APP_DIR}/openide.desktop" "${APP_DIR}/usr/share/applications/openide.desktop"

# --- AppRun -----------------------------------------------------------------
printf '%s\n' \
	'#!/bin/sh' \
	'HERE="$(dirname "$(readlink -f "$0")")"' \
	'if [ "${1:-}" = "--" ]; then' \
	'\tshift' \
	'\texec "${HERE}/usr/share/openide/bin/openide" "$@"' \
	'fi' \
	'exec "${HERE}/usr/share/openide/openide" "$@"' \
	> "${APP_DIR}/AppRun"
chmod +x "${APP_DIR}/AppRun"

# --- appimagetool -----------------------------------------------------------
# El canal "continuous" es el recomendado (los tags numerados están estancados).
# Se cachea en ${CACHE_DIR}; para reproducibilidad vendé tu copia y apuntala
# con APPIMAGETOOL_BIN. APPIMAGE_EXTRACT_AND_RUN=1 evita el montaje FUSE.
if [[ ! -x "${APPIMAGETOOL}" ]]; then
	echo "Bajando appimagetool (continuous) → ${APPIMAGETOOL}"
	curl --fail --location \
		'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage' \
		--output "${APPIMAGETOOL}"
	chmod +x "${APPIMAGETOOL}"
fi

rm -f "${OUTPUT_FILE}"
ARCH="${ARCH}" APPIMAGE_EXTRACT_AND_RUN=1 "${APPIMAGETOOL}" "${APP_DIR}" "${OUTPUT_FILE}"
chmod +x "${OUTPUT_FILE}"

echo "AppImage generado: ${OUTPUT_FILE}"
