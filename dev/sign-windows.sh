#!/usr/bin/env bash
# Authenticode signing for the Windows installers.
#
# The certificate arrives base64-encoded in a secret and is written to a temporary `.pfx` that is
# deleted on the way out, including when signing fails — a private key left behind on a runner is
# a private key in whatever that runner does next.
set -euo pipefail

# Signing is OPTIONAL, because an Authenticode certificate has to be bought from a CA and this
# project does not have one yet. Without it the installer still works and still auto-updates — the
# updater verifies the manifest's Ed25519 signature plus the artifact's size and SHA-256, never
# Authenticode — but Windows SmartScreen warns the person downloading it.
#
# Absent certificate: skip, loudly. Certificate WITHOUT its password: fail. A half-configured
# signing setup silently producing unsigned installers is the one outcome nobody would notice.
if [[ -z "${WINDOWS_SIGNING_CERT:-}" ]]; then
	if [[ -n "${WINDOWS_SIGNING_PASSWORD:-}" ]]; then
		echo 'WINDOWS_SIGNING_PASSWORD is set but WINDOWS_SIGNING_CERT is not: signing is half configured.' >&2
		exit 1
	fi
	echo 'No WINDOWS_SIGNING_CERT: shipping unsigned installers. SmartScreen will warn on download.'
	exit 0
fi
: "${WINDOWS_SIGNING_PASSWORD:?WINDOWS_SIGNING_CERT is set, so WINDOWS_SIGNING_PASSWORD is required}"

CERT="${RUNNER_TEMP:-/tmp}/openide-signing.pfx"
trap 'rm -f "$CERT"' EXIT
printf '%s' "$WINDOWS_SIGNING_CERT" | base64 --decode >"$CERT"

# `signtool` is NOT on PATH under the bash this script runs in: it ships with the Windows SDK,
# under `Windows Kits/10/bin/<sdk-version>/<arch>/`. Calling it bare fails with "command not
# found" AFTER the whole product has been built, which is the most expensive moment to discover a
# missing tool. Newest SDK first, and both Program Files roots because the arm64 runners install
# it in the other one.
find_signtool() {
	if command -v signtool >/dev/null 2>&1; then command -v signtool; return; fi
	local root
	for root in "/c/Program Files (x86)/Windows Kits/10/bin" "/c/Program Files/Windows Kits/10/bin"; do
		[[ -d "$root" ]] || continue
		find "$root" -name 'signtool.exe' -type f 2>/dev/null | sort -V | tail -1 | grep . && return
	done
	return 1
}

SIGNTOOL=$(find_signtool) || {
	echo 'signtool.exe not found. It ships with the Windows SDK; install it or add it to PATH.' >&2
	exit 1
}
echo "Signing with ${SIGNTOOL}"

# `-print0` + `read -d ''` because installer names carry spaces (`OpenIDE UserSetup ...`).
COUNT=0
while IFS= read -r -d '' file; do
	"$SIGNTOOL" sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f "$CERT" /p "$WINDOWS_SIGNING_PASSWORD" "$file"
	"$SIGNTOOL" verify /pa /all "$file"
	COUNT=$((COUNT + 1))
done < <(find assets -type f \( -name '*.exe' -o -name '*.msi' \) -print0)

# Signing nothing used to succeed silently. On Windows that means shipping an unsigned installer
# that SmartScreen blocks, discovered by whoever downloads it rather than here.
[[ ${COUNT} -gt 0 ]] || { echo 'No .exe or .msi found under assets/ to sign.' >&2; exit 1; }
echo "Signed ${COUNT} artifact(s)."
