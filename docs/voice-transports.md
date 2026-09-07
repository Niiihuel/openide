# Dictation: formats per provider and model

Researched on 4 September 2026. This matrix documents the contracts OpenIDE
implements; it does not certify access, quotas or availability for any given
account. The automated tests use synthetic audio and local servers and consume
no provider credits.

## How a format is chosen

Capture produces WAV PCM16 phrases, mono, 16 kHz. `openideVoiceTransport.ts`
decides the format from the provider, endpoint, model and modalities. The Voice
picker, the microphone test and the actual request all use that same resolver.

Priority: exception for an exact model id → the provider's explicit format →
the endpoint's documented profile and family rules → the model's modalities. An
explicit provider format does not turn its text models into audio models. The
modalities the endpoint publishes win over the models.dev catalog; missing
metadata does not count as support.

OpenIDE never probes formats by sending several requests, and never switches
provider to obtain a transcription. Dictation keeps the account and model you
selected even when the chat uses a different one. Connected providers without an
integration stay visible in the picker with an explanation.

## Implemented contracts

| Provider / family | Format and response | Official source |
| --- | --- | --- |
| OpenAI, conversational audio models | `/chat/completions`, `input_audio: {data, format: "wav"}`; response in `choices[].message.content` | [Audio](https://developers.openai.com/api/docs/guides/audio) |
| OpenAI Whisper and GPT Transcribe | `/audio/transcriptions`, multipart file; `text` response. Diarize adds `chunking_strategy=auto` | [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) |
| OpenRouter, multimodal models | `input_audio` with bare base64. The contract is OpenRouter's even when the model is NVIDIA's | [Audio inputs](https://openrouter.ai/docs/guides/overview/multimodal/audio) |
| OpenRouter, STT models | `/audio/transcriptions`, JSON with `input_audio`; `text` response. Detected by the `transcription` output modality or a known STT family | [STT](https://openrouter.ai/docs/guides/overview/multimodal/stt) |
| Google Gemini | Compatible endpoint: `input_audio`. Native endpoint: `generateContent` with `inlineData`, MIME `audio/wav`; response in `candidates[].content.parts` | [Compatibility](https://ai.google.dev/gemini-api/docs/openai), [GenerateContent](https://ai.google.dev/api/generate-content) |
| NVIDIA NIM Nemotron Omni | `audio_url: {url: "data:audio/wav;base64,…"}`. The documented optional reasoning of Nemotron Omni is disabled | [Nemotron Omni](https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/nemotron-3-nano-omni-30b-a3b-reasoning/api.html) |
| Alibaba Qwen Omni / DashScope | `input_audio.data` with a data URL; `stream=true`, text output. SSE deltas are assembled, excluding reasoning | [Qwen Omni](https://www.alibabacloud.com/help/en/model-studio/qwen-omni) |
| Groq Whisper | `/audio/transcriptions`, multipart WAV; `text` response | [Speech to text](https://console.groq.com/docs/speech-to-text) |
| Mistral Voxtral Small | Chat with `input_audio` as a base64 string, not the object OpenAI uses | [Voxtral](https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription) |
| Mistral Voxtral Mini Transcribe | `/audio/transcriptions`, multipart WAV; `text` response | [Transcriptions](https://docs.mistral.ai/api/endpoint/audio/transcriptions) |
| Together Whisper, Parakeet and documented ASR families | `/audio/transcriptions`, multipart WAV; `text` response | [Transcription](https://docs.together.ai/docs/inference/transcription/overview) |
| Fireworks, deployments with audio | Chat with `audio_url` and a data URL. Qwen Omni needs an enabled deployment; the integration does not create it | [Audio inputs](https://docs.fireworks.ai/guides/video-audio-inputs) |
| xAI Speech to Text | `/stt`, multipart with the file last and no `model` parameter; `text` response. The internal `stt` selection identifies the service, not a chat model | [Speech to text](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text) |
| vLLM with an audio model | OpenAI `input_audio` contract; the server must load a model that accepts audio | [Multimodal inputs](https://docs.vllm.ai/en/stable/features/multimodal_inputs/) |

The transport ids behind the table are `chat-input-audio`, `chat-audio-url`,
`mistral-audio`, `dashscope-audio`, `audio-transcriptions`,
`transcriptions-json`, `gemini-inline` and `xai-stt` (`VOICE_TRANSPORTS`).

Realtime/Live models need an audio session and are outside file-based
dictation. Models that only produce audio cannot transcribe. NIM Parakeet and
Canary use recognition APIs distinct from Nemotron's chat and are not announced
as compatible with that format.

Anthropic Messages, ChatGPT/Codex, Copilot and Cloud Code Assist do not receive
audio through these adapters, and their sessions are not reused to call the
public audio APIs of the same companies. [Messages](https://platform.claude.com/docs/en/api/messages/create)
describes a different contract; [OpenCode Zen](https://opencode.ai/docs/zen)
does not define a uniform dictation contract for its models either. Zen and
other endpoints without a documented format stay without automatic integration.

## Adding a custom server

In `openide.agent.customProviders`, `voiceTransport` fixes the endpoint's
contract and `voiceModelTransports` allows per-model exceptions. Example for a
local server that publishes two audio routes:

```json
{
  "id": "audio-local",
  "label": "Local audio",
  "protocol": "openai",
  "auth": "none",
  "baseUrl": "http://localhost:8000/v1",
  "voiceModel": "my-stt-model",
  "voiceTransport": "audio-transcriptions",
  "voiceModelTransports": {
    "my-omni-model": "chat-audio-url"
  }
}
```

The model names in the example are illustrative: they must match the server's.
Declared exceptions appear in Voice even when a chat endpoint publishes no STT
models. The valid formats are enumerated in `VOICE_TRANSPORTS` and in the
settings schema. A native Gemini endpoint must have a `/v1beta` base, without
`/openai`.

Adding another provider that shares an existing contract needs only a data
profile with its ids, hosts and family rules. A new contract needs an adapter in
`openideVoiceRequest.ts`, its format in `VOICE_TRANSPORTS`, and tests for the
request and the response. The composer does not change.

## Transport and validation

The multipart body travels over IPC as base64 and is decoded to a `VSBuffer` in
the main process. `NodeRequestOptions.dataBuffer` writes the bytes directly;
passing them as UTF-8 text would corrupt the WAV. The route keeps the existing
proxy settings and cancellation channel. Cancelling dictation also cancels the
pending requests. Each request has a 60-second timeout.

The tests cover selection by provider and model, JSON and multipart formats and
their bytes, SSE responses, structured rejections, endpoint-published modalities
and custom exceptions. The IPC → local HTTP route is verified with every byte
value 0–255. Recognition quality and account availability must be checked with
*Test dictation*; configuring a model is not presented as a verified
transcription.

Changes to the binary channel and to the main process require restarting the
whole IDE process. Reloading only the window does not update those components.
