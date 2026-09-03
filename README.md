OpenIDE update feed

Signed v2 update manifests live here, one per platform/arch/target:

    <channel>/<platform>/<arch>/<target>/latest.json
    <channel>/<platform>/<arch>/<target>/latest.json.minisig

They are written by dev/generate-update-manifest.sh from the release workflow and
signed with the key pinned in openide-version.json. Nothing here is edited by hand.

The branch was reset when OpenIDE restarted its version line at 1.0.0: the previous
manifests announced 1.121.2, and leaving them would have offered every fresh 1.0.0
install an "update" back to the older build.
