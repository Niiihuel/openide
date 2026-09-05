# Entorno FHS para compilar OpenIDE (fork de VSCodium) en NixOS.
#
# Devuelve el WRAPPER ejecutable del FHS, util para builds no-interactivos:
#   nix-build dev/openide-fhs.nix -o result-fhs
#   ./result-fhs/bin/openide-build -c '. dev/build.sh -o'
#
# Para uso interactivo, ver ../shell.nix (usa el .env de esta misma definicion).
{ pkgs ? import <nixpkgs> { } }:

let
  # Libs nativas que pide VS Code / Electron. Se incluyen tambien sus outputs
  # `dev` (headers + .pc) porque los modulos nativos compilan via pkg-config.
  libs = with pkgs; [
    libsecret
    glib
    nss
    nspr
    at-spi2-core
    at-spi2-atk
    atk
    cairo
    pango
    gdk-pixbuf
    gtk3
    cups
    dbus
    expat
    libdrm
    libxkbcommon
    mesa
    libgbm
    libglvnd
    wayland
    alsa-lib
    fontconfig
    freetype
    krb5
    zlib
    stdenv.cc.cc.lib
    systemdLibs
    libnotify

    # Xorg
    xorgproto
    libx11
    libxcb
    libxkbfile
    libxrandr
    libxrender
    libxi
    libxtst
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxcursor
    libxscrnsaver
  ];

  # output dev de cada lib (cae al `out` si no tiene dev)
  libsDev = builtins.map (p: p.dev or p) libs;

  tools = with pkgs; [
    (import ./nodejs.nix { inherit pkgs; })
    python3
    gcc
    gnumake
    pkg-config
    git
    jq
    unzip
    zip
    fakeroot
    dpkg
    rpm
    imagemagick
    rustup # build_cli.sh compila el CLI en Rust; llama "rustup target add ..." directo

    # Empaquetado AppImage (dev/build-appimage.sh): appimagetool los requiere.
    file
    squashfsTools # mksquashfs
    cpio
  ];
in
pkgs.buildFHSEnv {
  name = "openide-build";

  targetPkgs = pkgs: tools ++ libs ++ libsDev;

  profile = ''
    export PKG_CONFIG_PATH=/usr/lib/pkgconfig:/usr/share/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}
  '';

  runScript = "bash";
}
