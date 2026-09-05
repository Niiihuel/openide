# Dictado: formatos por proveedor y modelo

Investigado el 4 de septiembre de 2026. Esta matriz documenta los contratos implementados; no certifica acceso, cuotas ni disponibilidad de cada cuenta. Las pruebas automatizadas usan audio sintético y servidores locales, sin consumir créditos de proveedores.

## Cómo se resuelve

La captura produce frases WAV PCM16, mono, 16 kHz. `openideVoiceTransport.ts` decide el formato a partir del proveedor, endpoint, modelo y modalidades. El selector de Voz, la comprobación del micrófono y el envío usan ese mismo resolver.

Prioridad: excepción por ID exacto de modelo → formato explícito del proveedor → perfil documentado del endpoint y reglas de familia → modalidades del modelo. Un formato explícito del proveedor no convierte sus modelos de texto en modelos de audio. Las modalidades publicadas por el endpoint prevalecen sobre las del catálogo models.dev; una ausencia de metadatos no equivale a soporte.

No se prueban formatos enviando varias solicitudes ni se cambia de proveedor para conseguir una transcripción. El dictado conserva la cuenta y modelo seleccionados, aunque el chat use otra IA. Los proveedores conectados sin integración permanecen visibles con una explicación.

## Contratos implementados

| Proveedor / familia | Formato y respuesta | Fuente oficial |
| --- | --- | --- |
| OpenAI, modelos de audio conversacional | `/chat/completions`, `input_audio: {data, format: "wav"}`; respuesta en `choices[].message.content` | [Audio](https://developers.openai.com/api/docs/guides/audio) |
| OpenAI Whisper y GPT Transcribe | `/audio/transcriptions`, archivo multipart; respuesta `text`. Diarize añade `chunking_strategy=auto` | [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) |
| OpenRouter, modelos multimodales | `input_audio` con base64 sin prefijo. El contrato corresponde a OpenRouter aunque el modelo sea de NVIDIA | [Audio inputs](https://openrouter.ai/docs/guides/overview/multimodal/audio) |
| OpenRouter, modelos STT | `/audio/transcriptions`, JSON con `input_audio`; respuesta `text`. Se detectan por modalidad de salida `transcription` o familia STT conocida | [STT](https://openrouter.ai/docs/guides/overview/multimodal/stt) |
| Google Gemini | Endpoint compatible: `input_audio`. Endpoint nativo: `generateContent` con `inlineData`, MIME `audio/wav`; respuesta en `candidates[].content.parts` | [Compatibilidad](https://ai.google.dev/gemini-api/docs/openai), [GenerateContent](https://ai.google.dev/api/generate-content) |
| NVIDIA NIM Nemotron Omni | `audio_url: {url: "data:audio/wav;base64,…"}`. Se desactiva el razonamiento opcional del modelo Nemotron Omni documentado | [Nemotron Omni](https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/nemotron-3-nano-omni-30b-a3b-reasoning/api.html) |
| Alibaba Qwen Omni / DashScope | `input_audio.data` con data URL; `stream=true`, salida de texto. Se ensamblan los deltas SSE, excluyendo razonamiento | [Qwen Omni](https://www.alibabacloud.com/help/en/model-studio/qwen-omni) |
| Groq Whisper | `/audio/transcriptions`, multipart WAV; respuesta `text` | [Speech to text](https://console.groq.com/docs/speech-to-text) |
| Mistral Voxtral Small | Chat con `input_audio` como cadena base64, sin el objeto usado por OpenAI | [Voxtral](https://docs.mistral.ai/studio/audio/speech_to_text/offline_transcription) |
| Mistral Voxtral Mini Transcribe | `/audio/transcriptions`, multipart WAV; respuesta `text` | [Transcriptions](https://docs.mistral.ai/api/endpoint/audio/transcriptions) |
| Together Whisper, Parakeet y familias ASR documentadas | `/audio/transcriptions`, multipart WAV; respuesta `text` | [Transcription](https://docs.together.ai/docs/inference/transcription/overview) |
| Fireworks, despliegues con audio | Chat con `audio_url` y data URL. Qwen Omni requiere un despliegue habilitado; la integración no lo crea | [Audio inputs](https://docs.fireworks.ai/guides/video-audio-inputs) |
| xAI Speech to Text | `/stt`, multipart con el archivo al final, sin parámetro `model`; respuesta `text`. La selección interna `stt` identifica el servicio, no un modelo de chat | [Speech to text](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text) |
| vLLM con modelo de audio | Contrato OpenAI `input_audio`; el servidor debe cargar un modelo que acepte audio | [Multimodal inputs](https://docs.vllm.ai/en/stable/features/multimodal_inputs/) |

Los modelos Realtime/Live necesitan una sesión de audio y quedan fuera del dictado por archivos. Los modelos que solo producen audio no sirven para transcribir. NIM Parakeet/Canary usan APIs de reconocimiento distintas del chat de Nemotron y no se anuncian como compatibles con ese formato.

Anthropic Messages, ChatGPT/Codex, Copilot y Cloud Code Assist no reciben audio mediante estos adaptadores. No se reutiliza su sesión para llamar a las APIs públicas de audio de sus empresas. [Messages](https://platform.claude.com/docs/en/api/messages/create) describe un contrato distinto; [OpenCode Zen](https://opencode.ai/docs/zen) tampoco establece un contrato uniforme de dictado para sus modelos. Zen y otros endpoints sin formato documentado permanecen sin integración automática.

## Agregar un servidor personalizado

En `openide.agent.customProviders`, `voiceTransport` fija el contrato del endpoint y `voiceModelTransports` permite excepciones por modelo. Ejemplo para un servidor local que publica dos rutas de audio:

```json
{
  "id": "audio-local",
  "label": "Audio local",
  "protocol": "openai",
  "auth": "none",
  "baseUrl": "http://localhost:8000/v1",
  "voiceModel": "mi-modelo-stt",
  "voiceTransport": "audio-transcriptions",
  "voiceModelTransports": {
    "mi-modelo-omni": "chat-audio-url"
  }
}
```

Los nombres de modelo del ejemplo son ilustrativos: deben coincidir con los del servidor. Las excepciones declaradas se incluyen en Voz aunque un endpoint de chat no publique modelos STT. Los formatos válidos se enumeran en `VOICE_TRANSPORTS` y en el esquema de ajustes. Un endpoint nativo Gemini debe tener base `/v1beta`, sin `/openai`.

Para añadir otro proveedor que comparte un contrato existente basta un perfil de datos con sus identificadores, hosts y reglas de familia. Un nuevo contrato requiere un adaptador en `openideVoiceRequest.ts`, su formato en `VOICE_TRANSPORTS` y pruebas de la solicitud y respuesta. No hace falta modificar el composer.

## Transporte y validación

El multipart viaja por IPC como base64 y se decodifica a `VSBuffer` en main. `NodeRequestOptions.dataBuffer` escribe los bytes directamente; pasarlos como texto UTF-8 corrompería el WAV. La ruta mantiene los ajustes de proxy y el canal de cancelación existentes. Cancelar dictado cancela también las solicitudes pendientes. Cada solicitud tiene un timeout de 60 segundos.

Las pruebas cubren selección por proveedor/modelo, formatos JSON, multipart y sus bytes, respuestas SSE, rechazos estructurados, modalidades publicadas por el endpoint y excepciones personalizadas. Se verifica la ruta IPC → HTTP local con todos los valores de byte 0–255. La calidad de reconocimiento y la disponibilidad de cuentas deben comprobarse con “Probar dictado”; configurar un modelo no se presenta como una transcripción verificada.

Los cambios en el canal binario y en main requieren reiniciar el proceso completo del IDE. Recargar solamente la ventana no actualiza esos componentes.
