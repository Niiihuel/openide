#!/usr/bin/env bash
#
# Instala el último AppImage de OpenIDE como app de usuario (integración XDG)
# pensado para NixOS. Idempotente: re-ejecutar después de un rebuild actualiza
# el binario y los iconos.
#
# Qué hace:
#   1) copia el AppImage a ~/.local/bin/OpenIDE.AppImage (nombre versión-agnóstico)
#   2) crea el wrapper ~/.local/bin/openide  (vía appimage-run; paths absolutos
#      porque el .desktop no hereda el PATH del shell)
#   3) copia los iconos hicolor del AppDir del build
#   4) escribe ~/.local/share/applications/openide.desktop
#
# Requiere: appimage-run  (nixpkgs.appimage-run) en el perfil de usuario.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(jq -er '.version' "${ROOT_DIR}/openide-version.json")"

# The AppImage goes by two names depending on who built it, and only one was accepted. A local
# build produces `OpenIDE-<version>-x86_64.AppImage`; CI puts the glibc it linked against in the
# middle of the name -- `OpenIDE-1.121.1.glibc2.34-x86_64.AppImage` -- because that is part of which
# systems the binary can run on. So an AppImage downloaded from a release could not be installed
# with this script, which is exactly when someone reaches for it.
#
# Exactly one candidate is allowed. Picking the alphabetically first of several would install some
# arbitrary version, and installing the wrong one silently is worse than refusing.
APPIMAGE=""
CANDIDATES=()
shopt -s nullglob
# Filtered on existence rather than relying on nullglob alone: the first pattern has no wildcards,
# and a literal path joins the array whether or not the file is there.
for candidate in \
	"${ROOT_DIR}/assets/OpenIDE-${VERSION}-x86_64.AppImage" \
	"${ROOT_DIR}/assets/OpenIDE-${VERSION}."*"-x86_64.AppImage"
do
	[[ -f "${candidate}" ]] && CANDIDATES+=( "${candidate}" )
done
shopt -u nullglob

if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
	APPIMAGE="${CANDIDATES[0]}"
elif [[ ${#CANDIDATES[@]} -gt 1 ]]; then
	echo "More than one ${VERSION} AppImage in assets/; refusing to guess:" >&2
	printf '  %s\n' "${CANDIDATES[@]}" >&2
	echo "Leave exactly one and run again." >&2
	exit 1
fi

if [[ -z "${APPIMAGE}" || ! -x "${APPIMAGE}" ]]; then
	echo "No executable ${VERSION} AppImage found in ${ROOT_DIR}/assets/." >&2
	echo "Build one with:  bash dev/build-appimage.sh" >&2
	echo "Or drop one from a release into assets/ and chmod +x it." >&2
	exit 1
fi

echo "Installing ${APPIMAGE##*/}"

APPIMAGE_RUN="$(command -v appimage-run || true)"
if [[ -z "${APPIMAGE_RUN}" ]]; then
	echo "Falta 'appimage-run'. Agregalo a tu config de NixOS (nixpkgs.appimage-run)." >&2
	exit 1
fi

BIN_DIR="${HOME}/.local/bin"
APPS_DIR="${HOME}/.local/share/applications"
ICONS_DIR="${HOME}/.local/share/icons/hicolor"
APPDIR_ICONS="${ROOT_DIR}/.build/openide-appimage/OpenIDE.AppDir/usr/share/icons/hicolor"
SOURCE_ICON="${ROOT_DIR}/VSCode-linux-x64/resources/app/resources/linux/code.png"

mkdir -p "${BIN_DIR}" "${APPS_DIR}"

# 1) AppImage con nombre versión-agnóstico (sobrevive a rebuilds)
install -m 0755 "${APPIMAGE}" "${BIN_DIR}/OpenIDE.AppImage"

# 2) wrapper CLI + entrypoint (paths absolutos: el .desktop no tiene tu PATH)
cat > "${BIN_DIR}/openide" <<EOF
#!/bin/sh
# Lanzador de OpenIDE (AppImage) en NixOS — generado por dev/install-appimage.sh
set -eu
APPIMAGE="${BIN_DIR}/OpenIDE.AppImage"
MARKER="\${APPIMAGE}.update.json"
PREVIOUS="\${APPIMAGE}.previous"
HEALTHY="\${APPIMAGE}.healthy"
# Si el binario nuevo no alcanzó a marcar un arranque sano, restaurar sólo una vez.
if [ -f "\${MARKER}" ] && [ -f "\${PREVIOUS}" ] && [ ! -f "\${HEALTHY}" ]; then
  ATTEMPTS=\$(sed -n 's/.*"attempts":\([0-9][0-9]*\).*/\1/p' "\${MARKER}" | head -1)
  if [ "\${ATTEMPTS:-0}" -ge 1 ]; then
    mv -f "\${APPIMAGE}" "\${APPIMAGE}.failed" || true
    mv -f "\${PREVIOUS}" "\${APPIMAGE}"
    rm -f "\${MARKER}"
  else
    sed -i 's/"attempts":0/"attempts":1/' "\${MARKER}" || true
  fi
fi
rm -f "\${HEALTHY}"
export OPENIDE_APPIMAGE_PATH="\${APPIMAGE}"
exec ${APPIMAGE_RUN} "\${APPIMAGE}" "\$@"
EOF
chmod +x "${BIN_DIR}/openide"

# 3) iconos hicolor: árbol completo del AppDir del build, o fallback al source
if [[ -d "${APPDIR_ICONS}" ]]; then
	mkdir -p "${ICONS_DIR}"
	cp -r "${APPDIR_ICONS}/." "${ICONS_DIR}/"
elif [[ -f "${SOURCE_ICON}" ]]; then
	mkdir -p "${ICONS_DIR}/1024x1024/apps"
	cp "${SOURCE_ICON}" "${ICONS_DIR}/1024x1024/apps/openide.png"
fi

# 4) .desktop
cat > "${APPS_DIR}/openide.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=OpenIDE
GenericName=Integrated Development Environment
Comment=Open source agentic development environment
Exec=${BIN_DIR}/openide %F
Icon=openide
Categories=Development;IDE;TextEditor;
Keywords=editor;ide;agent;code;
StartupNotify=true
StartupWMClass=OpenIDE
Terminal=false
MimeType=text/plain;inode/directory;
Actions=new-empty-window;

[Desktop Action new-empty-window]
Name=New Empty Window
Name[es]=Nueva ventana vacía
Exec=${BIN_DIR}/openide --new-window
Icon=openide
EOF

# refrescar caches si las herramientas están disponibles (opcional)
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${APPS_DIR}" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f "${ICONS_DIR}" >/dev/null 2>&1 || true

echo "✔ AppImage:   ${BIN_DIR}/OpenIDE.AppImage"
echo "✔ Wrapper:    ${BIN_DIR}/openide"
echo "✔ Desktop:    ${APPS_DIR}/openide.desktop"
echo "Abrí tu launcher (rofi/fuzzel/app grid) y buscá 'OpenIDE'."
echo "(CLI 'openide' en terminal requiere ~/.local/bin en PATH.)"
