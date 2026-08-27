<!-- order: 10 -->

# Getting all telemetry out

This page explains how OpenIDE handles telemetry and how it enhances your privacy.

## Table of contents

- [Telemetry in OpenIDE](#telemetry)
- [Replacements to Microsoft Online Services](#replacements)
- [Checking for telemetry](#checking)
- [OpenIDE announcements](#announcements)
- [Malicious & deprecated extensions](#malicious-extensions)

## <a id="telemetry"></a>Telemetry in OpenIDE

Even though we do not pass the telemetry build flags and go out of our way to cripple the baked-in telemetry, Microsoft still can track usage by default depending on your settings.

We disable all the following telemetry-related settings by default to enhance your privacy:

```
telemetry.telemetryLevel
telemetry.enableCrashReporter
telemetry.enableTelemetry
telemetry.editStats.enabled
workbench.enableExperiments
workbench.settings.enableNaturalLanguageSearch
workbench.commandPalette.experimental.enableNaturalLanguageSearch
```

It is also recommended that you review all the settings that "use online services" by following [these instructions](https://code.visualstudio.com/docs/getstarted/telemetry#_managing-online-services). You can use the search filter `@tag:usesOnlineServices` to show such settings and review what to change.

**Please note that some extensions send telemetry data to Microsoft as well. We have no control over this and can only recommend removing the extension.**  
For example, the C# extension `ms-vscode.csharp` sends tracking data to Microsoft. Be sure to check each extension's settings page to disable their telemetry if applicable.

### Update services

By default, the app periodically fetches connections to check for the latest version available to download and install.  
Extensions are also checked for updates automatically from time to time.

If you want to prevent such behaviors, modify the following preferences:

For the app itself:

- `update.mode` -> `manual` (or `none`)
- `update.enableWindowsBackgroundUpdates` -> `false` (only applicable for Microsoft Windows)

For extensions:

- `extensions.autoUpdate` -> `false`
- `extensions.autoCheckUpdates` -> `false`

_Note: on Linux, the app update service is disabled completely at build-time even if the `update.mode` preference is configured. This is because users will more likely use their package managers to update the app rather than updating via the app itself._

### Feedback telemetry

By default, we keep the preference `telemetry.feedback.enabled` enabled. It's used to allow the button `Report Issue...` to be used on the app depending on the context. It does not send any data by having it enabled (other options already cover it). If you want, you can disable this behavior by toggling the preference value.

## <a id="replacements"></a>Replacements to Microsoft Online Services

When searching the `@tag:usesOnlineServices` filter, note that while the "Update: Mode" setting description still says "The updates are fetched from a Microsoft online service", OpenIDE sets [`updateUrl`](https://github.com/Niiihuel/openide/blob/master/vscode/product.json) in `product.json` to its own release feed, so enabling that setting won't actually result in any calls to the Microsoft online service.

Likewise, while the descriptions for "Extensions: Auto Check Updates" and "Extensions: Auto Update" include the same phrase, OpenIDE points [`extensionsGallery`](https://github.com/Niiihuel/openide/blob/master/vscode/product.json) at Open VSX instead of the Visual Studio Marketplace, so these settings won't call Microsoft either.

## <a id="checking"></a>Checking for telemetry

If you want to verify that no telemetry is being sent, you can use network monitoring tools like:

- Wireshark
- Little Snitch (macOS)
- GlassWire (Windows)

Look for connections to Microsoft domains and telemetry endpoints.

## <a id="announcements"></a>OpenIDE announcements

The welcome page in OpenIDE displays announcements that are fetched via the internet from the project's GitHub repository.

If you prefer to disable this feature, you can disable the preference `workbench.welcomePage.extraAnnouncements`.

## <a id="malicious-extensions"></a>Malicious & deprecated extensions

The definitions for malicious and deprecated extensions are dynamically loaded from the following URL:
https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json

If you prefer to avoid any external connections, you can disable the preference `extensions.excludeUnsafes`.
However, this is not recommended as it may reduce the safety of your environment.
