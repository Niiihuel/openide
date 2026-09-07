# Interactive shortcut for the OpenIDE build environment on NixOS.
#
#   nix-shell            # enter the FHS sandbox with the whole toolchain
#   . dev/build.sh -o    # (inside) resolve versions and prepare, without compiling
#   . dev/build.sh       # (inside) full build
#
# The actual environment definition lives in dev/openide-fhs.nix.
{ pkgs ? import <nixpkgs> { } }:

(import ./dev/openide-fhs.nix { inherit pkgs; }).env
