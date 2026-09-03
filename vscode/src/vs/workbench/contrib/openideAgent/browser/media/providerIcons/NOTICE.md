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
