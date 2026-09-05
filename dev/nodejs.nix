# Exact Node toolchain for the FHS build; independent of the nixpkgs channel's Node minor.
{ pkgs }:
let
  version = builtins.replaceStrings [ "\n" ] [ "" ] (builtins.readFile ../.nvmrc);
  artifacts = {
    x86_64-linux = { arch = "x64"; sha256 = "55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"; };
    aarch64-linux = { arch = "arm64"; sha256 = "58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6"; };
  };
  artifact = artifacts.${pkgs.stdenv.hostPlatform.system} or (throw "Unsupported OpenIDE FHS architecture");
in
assert version == "24.18.0";
pkgs.stdenv.mkDerivation {
  pname = "openide-nodejs";
  inherit version;
  src = pkgs.fetchurl {
    url = "https://nodejs.org/dist/v${version}/node-v${version}-linux-${artifact.arch}.tar.xz";
    inherit (artifact) sha256;
  };
  nativeBuildInputs = [ pkgs.autoPatchelfHook ];
  buildInputs = [ pkgs.stdenv.cc.cc.lib ];
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r bin include lib share "$out/"
    runHook postInstall
  '';
  meta.mainProgram = "node";
}
