---
{
  "badge": "What's new",
  "title": "OpenIDE 1.3.0",
  "features": [
    { "icon": "$(notebook)", "title": "Durable Markdown memory", "description": "Searchable notes, consistent capture and recovery of unfinished memory writes." },
    { "icon": "$(search)", "title": "Faster project indexing", "description": "Bounded indexing work, incremental graph updates and cached queries." },
    { "icon": "$(tools)", "title": "Tools your CLI can discover", "description": "A capability catalog and session hooks help connected CLIs find the IDE's tools." },
    { "icon": "$(history)", "title": "Clearer execution recovery", "description": "Run journals retain tool intents and results without automatically repeating uncertain effects." },
    { "icon": "$(sync)", "title": "Safer updates", "description": "Fixed AppImage downloads, atomic recovery and re-download of corrupt Windows installers." }
  ],
  "buttons": [
    { "label": "Release notes", "commandId": "update.showCurrentReleaseNotes", "style": "primary" }
  ]
}
---
OpenIDE 1.3.0 adds persistent Markdown memory, improves project indexing and CLI discovery, and fixes the updater. Linux users on the published 1.1.0 or 1.2.0 AppImages need one manual upgrade to receive the download fix.
