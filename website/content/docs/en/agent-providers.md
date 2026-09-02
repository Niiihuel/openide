---
title: Providers and models
description: Connect Anthropic, OpenAI, Gemini, OpenRouter, local models and custom endpoints; where credentials are stored and how failover works.
---

The agent talks to models through a provider catalog. Open it with **OpenIDE: Open Providers** (`openide.agent.openProviders`) or from the *Providers* section of the OpenIDE settings.

## Catalog

| Provider | Authentication |
| --- | --- |
| Anthropic | API key or OAuth |
| OpenAI | API key |
| OpenAI Codex | OAuth (Codex account) |
| Gemini (Google Cloud Code) | OAuth; set `openide.agent.googleCloudProject` when your account has several projects |
| GitHub Copilot | OAuth |
| OpenRouter | API key |
| xAI | API key or OAuth |
| MiniMax | API key or OAuth |
| DeepSeek, Mistral, Moonshot, Groq, Cerebras, Together, Fireworks | API key |
| NVIDIA NIM | API key |
| Ollama | Local, no credentials |
| Custom | Any OpenAI-compatible endpoint (corporate proxies, self-hosted gateways) |

The model list for each provider is fetched from the provider when possible and cached. Use the model search in the providers panel to filter by name, and the *retry* action if the list failed to load.

## Credentials

Keys and OAuth tokens go to `SecretStorage`, which is the operating system keychain (GNOME Keyring or KWallet on Linux, Credential Manager on Windows, Keychain on macOS). They are **never** written to `settings.json`, so syncing your settings does not leak them.

On Linux, local credential storage is only available when a Secret Service keyring is running. If sign-in fails with a keychain error, install `gnome-keyring` or another provider; see [Usage](/docs/usage/#linux).

Use **OpenIDE: Set API Key** (`openide.agent.setApiKey`) to paste a key for a provider, or **OpenIDE: Sign In** (`openide.agent.signIn`) for OAuth providers. OAuth sessions are refreshed automatically; when a session has no valid token the provider is marked and you are asked to sign in again.

## Selecting a model

**OpenIDE: Select Provider** (`openide.agent.selectProvider`) switches the provider and model for the current chat. Plans can pin a different model per plan; see [Plans](/docs/agent-workspace/#plans). The summarization model used for context compaction is a separate setting.

## Fallback and failover

`openide.agent.fallbackProviders` and `openide.agent.fallbackChain` define an ordered list of providers to try when the active one fails (rate limit, outage, invalid response). The switch is announced in the chat and can be undone with **OpenIDE: Undo Account Failover** (`openide.agent.undoAccountFailover`).

## Custom OpenAI-compatible endpoints

Add a *Custom* provider with the base URL of the endpoint and, if needed, an API key. The agent uses the Chat Completions API with tool calling. Some gateways return the model's reasoning in a dedicated field and leave `content` empty; OpenIDE reads that field and retries without tools when a model does not support them, but the endpoint still has to speak the Chat Completions protocol.

Ollama is pre-configured as a local provider: start Ollama, pull a model and it appears in the list.

## Usage and limits

`openide.agent.usage.enabled` turns on the usage meter for providers that expose one (subscription quotas, remaining credits). `openide.agent.usage.cliAccounts` lets OpenIDE read the accounts of CLI tools installed on the machine, and `openide.agent.usage.pollMinutes` controls how often the meter refreshes.

## Privacy

Every provider is something you enable. OpenIDE sends prompts, attached files and tool results only to the provider you selected for that conversation. Read [Privacy](/docs/privacy/) for the full picture.
