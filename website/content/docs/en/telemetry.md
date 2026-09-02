---
title: Telemetry
description: Which telemetry settings are disabled by default, what replaces Microsoft's online services, and how to check for yourself.
---

This page explains how OpenIDE handles telemetry and how it enhances your privacy.

## Telemetry in OpenIDE

Even though the telemetry build flags are not passed and the baked-in telemetry is crippled on purpose, some settings could still allow usage to be tracked. OpenIDE disables all of the following by default:

```text
telemetry.telemetryLevel
telemetry.enableCrashReporter
telemetry.enableTelemetry
telemetry.editStats.enabled
workbench.enableExperiments
workbench.settings.enableNaturalLanguageSearch
workbench.commandPalette.experimental.enableNaturalLanguageSearch
```

It is also recommended to review every setting that "uses online services" by following [these instructions](https://code.visualstudio.com/docs/getstarted/telemetry#_managing-online-services). Use the search filter `@tag:usesOnlineServices` to list them and decide what to change.

**Some extensions send telemetry data to Microsoft as well. OpenIDE has no control over this and can only recommend removing the extension.** For example, the C# extension `ms-vscode.csharp` sends tracking data. Check each extension's settings page to disable its telemetry where possible.

### Update services

By default the app periodically checks for the latest version available to download and install, and extensions are checked for updates from time to time. To prevent this, change the following preferences.

For the app itself:

- `update.mode` → `manual` (or `none`)
- `update.enableWindowsBackgroundUpdates` → `false` (Windows only)

For extensions:

- `extensions.autoUpdate` → `false`
- `extensions.autoCheckUpdates` → `false`

On Linux the updater only replaces an AppImage; package installs are updated by the package manager regardless of `update.mode`.

### Feedback telemetry

The preference `telemetry.feedback.enabled` stays enabled. It only allows the *Report Issue…* button to appear where it makes sense; it does not send data by itself (the other options already cover that). Toggle it off if you prefer.

## Replacements to Microsoft online services

When searching with the `@tag:usesOnlineServices` filter, note that the description of *Update: Mode* still says "the updates are fetched from a Microsoft online service". OpenIDE sets `updateUrl` in `product.json` to its own release feed, so enabling that setting does not call Microsoft.

Likewise, the descriptions of *Extensions: Auto Check Updates* and *Extensions: Auto Update* include the same phrase, but OpenIDE points `extensionsGallery` at Open VSX instead of the Visual Studio Marketplace, so these settings do not call Microsoft either.

## Checking for telemetry

To verify that no telemetry is being sent, use a network monitoring tool such as:

- Wireshark
- Little Snitch (macOS)
- GlassWire (Windows)

Look for connections to Microsoft domains and telemetry endpoints.

## OpenIDE announcements

The welcome page displays announcements fetched from the project's GitHub repository. Disable the preference `workbench.welcomePage.extraAnnouncements` to turn this off.

## Malicious and deprecated extensions

The definitions of malicious and deprecated extensions are loaded dynamically from:

```text
https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json
```

If you prefer to avoid any external connection you can disable the preference `extensions.excludeUnsafes`. This is not recommended, as it reduces the safety of your environment.
