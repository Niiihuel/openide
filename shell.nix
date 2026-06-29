# Atajo interactivo para el entorno de build de OpenIDE en NixOS.
#
#   nix-shell            # entra al sandbox FHS con todo el toolchain
#   . dev/build.sh -o    # (adentro) prepara el codigo fuente, sin compilar
#   . dev/build.sh       # (adentro) build completo
#
# La definicion real del entorno vive en dev/openide-fhs.nix.
{ pkgs ? import <nixpkgs> { } }:

(import ./dev/openide-fhs.nix { inherit pkgs; }).env
