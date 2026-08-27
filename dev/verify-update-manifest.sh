#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 ]]; then echo "Uso: $0 <manifest.json> <public-key.pem> [artefacto]" >&2; exit 1; fi
MANIFEST=$1 PUBLIC_KEY=$2 ARTIFACT=${3:-} SIGNATURE="${MANIFEST}.minisig"
[[ -f "${MANIFEST}" && -f "${SIGNATURE}" && -f "${PUBLIC_KEY}" ]] || { echo "Falta manifest, firma o clave pública." >&2; exit 1; }
node - "${MANIFEST}" "${SIGNATURE}" "${PUBLIC_KEY}" <<'NODE'
const fs=require('fs'),crypto=require('crypto'); const [manifest,sigPath,keyPath]=process.argv.slice(2);
const sig=JSON.parse(fs.readFileSync(sigPath,'utf8')); if(sig.algorithm!=='ed25519'||!sig.keyId||!sig.signature) throw new Error('Firma inválida');
if(!crypto.verify(null,fs.readFileSync(manifest),fs.readFileSync(keyPath),Buffer.from(sig.signature,'base64'))) throw new Error('Firma no válida');
const m=JSON.parse(fs.readFileSync(manifest,'utf8')); if(m.schemaVersion!==2||m.product!=='openide') throw new Error('Manifest no es OpenIDE v2');
console.log(`Manifest firmado: ${m.productVersion} ${m.platform}/${m.architecture}/${m.target}`);
NODE
if [[ -n "${ARTIFACT}" ]]; then
  EXPECTED_SIZE=$(jq -er '.artifact.size' "${MANIFEST}"); EXPECTED_SHA=$(jq -er '.artifact.sha256' "${MANIFEST}")
  ACTUAL_SIZE=$(stat -c %s "${ARTIFACT}" 2>/dev/null || stat -f %z "${ARTIFACT}")
  ACTUAL_SHA=$(sha256sum "${ARTIFACT}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${ARTIFACT}" | awk '{print $1}')
  [[ "${ACTUAL_SIZE}" == "${EXPECTED_SIZE}" && "${ACTUAL_SHA}" == "${EXPECTED_SHA}" ]] || { echo "Artefacto no coincide con manifest." >&2; exit 1; }
fi
