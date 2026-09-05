# OpenIDE 1.2.0 — recorded walkthrough verification

Recorded on September 5, 2026, using the released Linux x64 AppImage in a dedicated demo profile and a disposable Launch Board project. The user's normal profile and conversations were not captured.

## Delivered cut

88 seconds · 1920×1080 · 30 fps · H.264 / AAC · English synthetic narration.

- `openide-demo-en.mp4`: sharing copy with captions.
- `openide-demo-en-master.mp4`: master with narration and chapter titles, without burned-in captions.
- `openide-demo-en.srt` / `openide-demo-en.vtt`: English captions.
- `narration-en.wav`: separate voice track.
- `thumbnail.png`: frame from the actual recording.
- `chapters.json`: timing and speed changes. Accelerated clips are labeled “Sped up.”

## Verified during capture

| Check | Result |
|---|---|
| Native chat accepts and preserves the draft | Passed |
| Project Map queries the sample's indexed code | Passed |
| Shared project memory read through MCP | Passed |
| Saved plan waits for explicit approval and returns it | Passed |
| Proposed diff opens in the real editor | Passed |
| Save As writes the proposed change to the sample file | Passed; contents checked on disk |
| Compact toggle updates the visible app | Passed |
| Filtering produces the matching task | Passed |
| Keyboard Tab moves focus to a task | Passed |
| Browser actions preserve the chat draft | Passed |
| Node tests: empty filter, case-insensitive filter, no match, source immutability | 4 passed |
| Terminal MCP checks: memory, browser snapshot, Project Map | 3 passed |
| Project convention persists and can be read back | Passed |

## Issue found — not counted as a passing check

After the diff proposal is saved through Save As, the file is updated correctly, but the pending `openDiff` MCP call does not return `FILE_SAVED` within the five-second assertion window after the tab closes. The capture therefore verifies the saved file, not successful completion of that acknowledgement.

Investigation entry point: `OpenideIdeServerService.openDiff` in `vscode/src/vs/workbench/contrib/openideAgent/browser/openideIdeServerService.ts`. It currently identifies the closed editor using the untitled resource; Save As and diff editor identity need a focused regression test.

## What the recording demonstrates

This is an automated product walkthrough against the real IDE, real local application, and real authenticated MCP endpoints. A scripted MCP client invokes the tools. Tool results and terminal test results are not fabricated.

It does not demonstrate a live native-model generation, a third-party coding CLI conversation, microphone transcription, update installation, or Zen-mode regression. Those should be separate recorded scenarios. The earlier broader storyboard remains useful for a future take with connected model accounts.

## Audio credits

Synthetic voice: Piper TTS, `en_US-ljspeech-high`. The voice model card identifies the LJ Speech dataset as public domain. No background music was used.

- Model and card: https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/ljspeech/high
- Dataset: https://keithito.com/LJ-Speech-Dataset/

## Export validation

- Captioned MP4: 88.000 seconds, 1920×1080, 30 fps, 2640 video frames.
- H.264 video and AAC mono audio at 48 kHz.
- Full-file FFmpeg decode completed without an error.
- Black-frame detection found no black intervals at the configured threshold.
- Encoded audio peak measured −1.5 dBFS; no clipped peak detected.
- Sampled exported frames were visually checked for readable captions and complete IDE framing.
- Chromium playback decoded the video, sought to a chapter, and reached the end without a media error.
