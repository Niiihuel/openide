# Provider icon sources

The SVG marks in this directory were retrieved from [SVGL](https://svgl.app/) on 2026-08-03 and,
for the second table, from [models.dev](https://models.dev/) and the vendors' own sites on
2026-08-25. All of them are cached locally so OpenIDE does not make runtime requests.

Most are painted as CSS masks (`openideProviderIcons.ts`), so only the silhouette survives: any
mark that arrived on a plate — a full-bleed background rect — has that plate stripped, or it would
render as a solid square. The marks whose colours are the brand (Gemini, Mistral, Cohere,
DeepSeek, Antigravity, Cerebras, Perplexity) are shown as images instead, unmasked, and a few
one-colour marks are masked in their brand's own colour (`paint` in
`common/openideProviderBranding.ts`).

SVGL's application source is MIT licensed. Company and product logos remain trademarks of their
respective owners and are used only to identify the corresponding provider integration. SVGL
notes that permission may be required for logo use; do not treat inclusion here as endorsement.

| Local file | SVGL asset |
| --- | --- |
| `antigravity.svg` | `antigravity.svg` |
| `anthropic.svg` | `anthropic_black.svg` |
| `claude.svg` | not SVGL: the Claude AI symbol from Wikimedia Commons (`File:Claude_AI_symbol.svg`, CC0), monochrome |
| `cursor.svg` | not SVGL: Cursor's two-cursor mark as published by Simple Icons (CC0), monochrome |
| `vscode.svg` | not SVGL: the Visual Studio Code mark as published by Simple Icons (CC0), monochrome, tinted with the product's blue |
| `github-copilot.svg` | `copilot.svg` |
| `grok.svg` | `grok-light.svg` |
| `openai.svg` | `openai.svg` |
| `openrouter.svg` | `openrouter_light.svg` |
| `deepseek.svg` | `deepseek.svg` |
| `mistral.svg` | `mistral-ai_logo.svg` |
| `gemini.svg` | `gemini.svg` |
| `cerebras.svg` | `cerebras.svg` |
| `perplexity.svg` | `perplexity.svg` |
| `qwen.svg` | `qwen_light.svg` |
| `cohere.svg` | `cohere.svg` |
| `ollama.svg` | `ollama_light.svg` |

Retrieved 2026-08-25, from models.dev's logo set (the one openchamber falls back to) except where
noted. models.dev answers an unknown id with a generic sparkle instead of a 404, so each file here
was checked to be the provider's actual mark.

| Local file | Source |
| --- | --- |
| `together.svg` | `models.dev/logos/togetherai.svg` |
| `fireworks.svg` | `models.dev/logos/fireworks-ai.svg` |
| `zai.svg` | `models.dev/logos/zai.svg` (Z.ai / Zhipu GLM) |
| `minimax.svg` | `models.dev/logos/minimax.svg` |
| `lmstudio.svg` | openchamber's `provider-logos/lmstudio.svg` |
| `opencode.svg` | SVGL `opencode.svg`, background plate removed |
| `droid.svg` | `factory.ai/favicon.svg`, black plate removed |
| `groq.svg` | `models.dev/logos/groq.svg` — SVGL's `groq.svg` was a mark on a plate, so as a mask it painted a solid square |
| `kimi.svg` | `models.dev/logos/moonshotai.svg` — same plate problem as Groq |
| `nvidia.svg` | `models.dev/logos/nvidia.svg` — replaced SVGL's `nvidia-icon-light.svg`, whose wordmark turned to mush at 15px |

Still on monograms, because no source publishes a mark that survives 14px: Amp (wordmark only),
SambaNova, Nous Research, vLLM, llama.cpp, Jan.

## `registry/` — the rest of models.dev

181 more marks, one per provider models.dev publishes a logo for that has no curated entry above,
fetched from `https://models.dev/logos/<provider id>.svg` on 2026-09-04 and cached locally like
the others (OpenIDE makes no runtime request to draw a list). They exist because the Providers
page now offers the whole registry, and 181 rows of two-letter monograms is a list nobody can
scan.

How they were prepared, and how to redo it:

- one request per id in `api.json`; models.dev answers an unknown id with a **generic sparkle**
  rather than a 404, so every response whose bytes match that sparkle was dropped (17 of them);
- anything with `<script>`, `javascript:`, a `<foreignObject>` or an `http` reference is rejected
  outright — these files are inlined into masks and background images;
- XML declarations, comments, `<title>`/`<desc>`/`<metadata>` and inter-tag whitespace stripped;
- anything still over 20 KB skipped, because a logo that heavy is mush at 20 px (`hpc-ai`,
  `kosmik`, `lucidquery` — they keep their monogram);
- **wordmarks skipped too**, found by their aspect ratio (viewBox wider than 2.2:1): a name set in
  type is unreadable in a 20 px circle and renders as a smudge, which is worse than the two letters
  a monogram gives (`abliteration-ai`, `scnet-token-plan`, `crusoe`, `aiand`, `drun`);
- `paint: 'full'` only where the logo carries its own colours (a gradient, more than one ink, or a
  mark on a plate). The rest are masked into the surface's ink, like the curated marks.

`test/node/openideProviderIcons.test.ts` holds the invariants: every asset a brand names exists,
no file carries a script or a remote reference, and the generated map never shadows a curated
brand — the curated ones carry decisions a generator cannot make (Anthropic's terracotta, the
Claude spark instead of the wordmark, NVIDIA's green).

The logos remain trademarks of their owners and are used only to identify the corresponding
provider integration; inclusion is not endorsement.
