# OpenIDE product icons

OpenIDE retains Codicon ids and codepoints for compatibility, but the visible font is generated
as an OpenIDE-specific outline/filled pair. Generic interface symbols use separately drawn 24×24
vectors derived from the MIT-licensed Reicon visual language. OpenIDE controls that benefit from a
denser selected state opt in with `codicon-filled`; selection never changes geometry implicitly.
Editor-specific symbols without
a semantic Reicon equivalent keep their Codicon structure with normalized OpenIDE metrics.

High-frequency shell symbols that need tighter optical balance live in
`openide-icon-overrides.json`. These drawings are OpenIDE originals, share a maximum 235-unit
outline width (245 in the heavier active state), and take precedence over both Reicon and the
normalized Codicon fallback.

Provider/company marks are protected in the generator and retain their original outlines. The
allowlist includes Anthropic/Claude, Apple, Azure, Code OSS, Copilot, Docker, Gemini/Google,
GitHub, GitLab, Meta, Microsoft, Mistral, OpenAI, Twitter, and xAI (including future Codicon
aliases that use those prefixes).

`reicon-reference.json` is a curated generated subset, not a runtime dependency. Refresh it from a
Reicon checkout when updating the visual mapping:

```sh
node resources/openide-icons/import_reicon_reference.mjs /path/to/reicon/data/icon-data.json
```

Then regenerate after updating either reference or `@vscode/codicons`:

```sh
nix shell nixpkgs#fontforge -c fontforge -script \
  resources/openide-icons/generate_openide_codicons.py \
  node_modules/@vscode/codicons/dist/codicon.ttf \
  node_modules/@vscode/codicons/src/template/mapping.json \
  resources/openide-icons
```

The normal build copies the generated fonts; it does not need FontForge.

Semantic variants are governed by `openide-icon-policy.json`. It prevents status, shell, and other
meaningful Codicon variants from collapsing onto the same Reicon drawing, while explicit public
`*-filled` ids use the filled source even when rendered through the regular family.

Regenerate the regular-only static extension-webview compatibility sheet after a Codicon update.
OpenIDE-owned webviews embed the filled companion only when they explicitly consume it:

```sh
node resources/openide-icons/generate_webview_codicon_css.mjs
```

Validate coverage and protected brand geometry with:

```sh
node resources/openide-icons/validate_openide_codicons.mjs
```
