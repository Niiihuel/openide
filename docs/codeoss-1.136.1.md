# Code OSS 1.136.1 integration

Validated on September 4, 2026, on Linux x64 (NixOS, FHS development environment).

| Component | Version |
| --- | --- |
| OpenIDE product | 1.1.0 |
| Code OSS / extension API | 1.136.1 |
| Upstream commit | a44adf7f53e00964ab890f9f8758a334f1fc15bc |
| Development Node | 24.18.0 |
| Electron | 42.10.0 |
| Node embedded in Electron | 24.18.1 |

The previous recorded upstream base was 1.121.0. The new base was checked against
the [stable release](https://github.com/microsoft/vscode/releases/tag/1.136.1)
and the [upstream release notes](https://code.visualstudio.com/updates/v1_136).

OpenIDE remains a maintained fork with independent product releases. Its product
version names artifacts and drives its signed update feed; the upstream API version
is used for extension compatibility. Updating one does not automatically bump the
other. The canonical record is `openide-version.json`.

## Compatibility work

- Adapted browser model ownership, agent sharing, navigation, inspection, screenshot
  selection, DevTools and remote preview to the new browser interfaces. Automated
  preview opening continues to preserve the chat composer's focus.
- Retained OpenIDE's chat, microphone, provider settings, follow animations, diff
  rendering and composer dock changes.
- Retained the product's panel spacing, typography, icons, settings and branding.
  Updated welcome CSS for the new watermark wrapper; the launcher is centered and
  its actions are visible again. Regenerated both icon fonts against the new icon
  catalog and migrated the font validator to the new OpenType API.
- Adapted the signed updater to the new cancellation and reconfiguration lifecycle.
- Updated build tasks, native dependencies, Electron types, lockfiles and Node pins.
  Nix uses a checksummed Node distribution so an older nixpkgs Node cannot silently
  become the build runtime.
- Vendored upstream shared agent-host sources needed by the new platform. OpenIDE's
  entry points continue to omit upstream provider registration; the native OpenIDE
  harness remains the product integration.

## Validation

Client and build TypeScript checks pass. Client transpilation and all bundled
extensions, including webview media, compile successfully. Native modules rebuilt
for the new runtimes.

| Test group | Passing tests |
| --- | ---: |
| Signed updater and OpenIDE agent common | 666 |
| Native agent browser components | 227 |
| Repository contracts | 19 |
| Electron browser integration, including focus preservation | 61 |
| Panel layout, Modern UI and update interface | 37 |
| Update cancellation / reconfiguration lifecycle | 21 |
| Upstream synchronization tool | 3 |

`node dev/smoke-upgrade.mjs` launches the real Electron application with a separate
profile and enabled bundled extensions. It checks visible, centered welcome actions,
opens the native chat, preserves a draft, and enters/exits the editor's Zen mode.
It writes screenshots and runtime/error results to `.build/upgrade-smoke/`.
The successful run reported no renderer errors. No model request is sent by this test.

Branding, localization, comment/prompt language, surface-token, script-permission,
version-consistency and reliability audits pass. The layer checker still reports
existing OpenIDE browser-layer imports of `IMainProcessService`; these are a separate
architecture issue, not a clean check claimed by this migration.

This validates Linux development and the tested workflows. Windows/macOS installers,
remote distribution artifacts, live provider accounts, physical microphone input
and arbitrary third-party extensions still require their respective integration
environments. No release was published. An upstream update reduces drift; it cannot
guarantee compatibility with every future change.

## Future updates

Use `dev/sync-codeoss.sh` on a prepared integration branch. It resolves the stable
target separately from the base, preserves intentional removals, applies the delta
with three-way conflict handling and advances metadata only after conflicts are
resolved. Continue an interrupted integration with `dev/sync-codeoss.sh --continue`.
Review preserved paths in `dev/codeoss-preserved-paths.json`, update Node checksums
when the pin changes, regenerate icons when their catalog changes, and rerun the
checks and application smoke test. See `BUILD.md` for development commands.
