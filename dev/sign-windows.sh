#!/usr/bin/env bash
set -euo pipefail
: "${WINDOWS_SIGNING_CERT:?Missing WINDOWS_SIGNING_CERT}"
: "${WINDOWS_SIGNING_PASSWORD:?Missing WINDOWS_SIGNING_PASSWORD}"
CERT="$RUNNER_TEMP/openide-signing.pfx"; printf '%s' "$WINDOWS_SIGNING_CERT" | base64 --decode > "$CERT"
find assets -type f \( -name '*.exe' -o -name '*.msi' \) -print0 | while IFS= read -r -d '' file; do
  signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f "$CERT" /p "$WINDOWS_SIGNING_PASSWORD" "$file"
  signtool verify /pa /all "$file"
done
rm -f "$CERT"
