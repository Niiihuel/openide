# OpenIDE — 88-second product demo

Production brief: **English, 60–90 seconds, real product footage.**
Target cut: 88 seconds, 16:9, 1920×1080, 30 fps, with English narration and
captions. This is the shooting script; footage and narration have not yet been
recorded. The [caption file](./openide-90s-en.srt) is a timing draft to align with
the final voice track.

## Story

**From understanding a project to reviewing a working change, in one editor.**
Follow one small task in a sample task-board app: add a compact view without
changing the existing behavior. Show how memory, plans, edits, browser inspection
and an external CLI contribute to that same task. Keep the provider menu brief;
the demo's subject is the workflow, not the size of the model catalog.

## Timeline and narration

| Time | Real footage to capture | On-screen label | English voice-over |
|---|---|---|---|
| 00–07 | Start on the sample app in OpenIDE's browser beside its source and chat. A short push-in establishes the three surfaces. | **Your project. One workspace.** | “Meet OpenIDE. Your code, your AI agent, and your running app, together in one workspace.” |
| 07–15 | Open the native model picker, choose an already connected, working model, then return to the composer. Do not open account details. | **Choose your model** | “Choose a connected model, then describe the change you want. OpenIDE brings the editor context into the conversation.” |
| 15–27 | Open Project Map, search the task-list component, select a connected node, and briefly reveal the relevant project memory note. | **Context that carries forward** | “Project Map connects files, symbols, and dependencies. Shared memory keeps the conventions and decisions that matter, so each session has a useful starting point.” |
| 27–39 | Show the saved plan, edit one acceptance criterion, and approve it. Keep text large enough to read. | **Plan before changing** | “Review the plan, refine the details, and decide what happens next. The plan stays in your project, ready to revisit.” |
| 39–51 | Show a real edit, the full-width diff and changed-file tray. End on a keep action after review. | **Changes you can review** | “Watch the changes arrive in your editor. Inspect the diff, review affected files, and keep the work you want.” |
| 51–64 | Interact with the real compact-view toggle in the integrated browser. Briefly show the agent's screenshot result alongside the page. | **Check the running app** | “Then check the result in the built-in browser. The agent can inspect the page and capture what you see, using the session already open.” |
| 64–76 | Cut to a clearly labeled, preconfigured external CLI session in the dock. Show an actual Project Map tool call and a screenshot from the same app. | **Your CLI. OpenIDE tools.** | “Prefer a coding CLI? Supported integrations can use OpenIDE's browser, project context, memory, and plan review, while keeping their own workflow.” |
| 76–83 | Show a durable note saved to `.openide/MEMORY.md`, then a new session reading that same note. | **Keep what you learn** | “Save the convention you learned, and carry it into the next session.” |
| 83–88 | End on the working app, then the existing OpenIDE logo and repository address. | **OpenIDE · Explore the source** | “OpenIDE. Explore the source, and make it yours.” |

## Recording setup

- Use the packaged stable build after the release checks pass, with a dedicated
  demo profile and a disposable sample repository.
- Use English UI, a consistent dark theme and readable editor/chat font sizes.
  Keep the browser and chat widths stable between shots.
- Seed the sample app with a real test and a small, understandable component
  structure. Example initial memory: “Keep filters usable in compact view.”
- Connect one native model and one CLI integration before recording. Frame only
  the model choice; keep tokens, email addresses and unrelated conversations
  outside the footage.
- Run the task once to establish that it works, then reset only the disposable
  sample's changes for the capture. Retain successful raw takes and outputs.
- Record the entire IDE window with desktop capture. OpenIDE's browser recording
  tools capture browser flows; they do not capture the editor, settings or CLI
  dock around that browser.

## Prompts for the real takes

Native agent, planning first:

> Add a compact view to the task board. Keep filtering and keyboard interaction
> working. Read the project memory and inspect Project Map before proposing the
> change. Save a plan for review.

Implementation after reviewing the plan:

> Implement the approved plan, run the relevant checks, and inspect compact view
> in the integrated browser. Show the changes for review.

External CLI, opened as a separate session:

> Use OpenIDE's Project Map and shared memory to inspect the compact-view change.
> Use the OpenIDE browser tools to capture the running app. Report what you can
> verify from the code and the page.

Memory handoff:

> Save this project convention: compact view must preserve filters and keyboard
> interaction. Consolidate the existing note instead of duplicating it.

These prompts guide real execution. If a tool fails or a model chooses a
different path, fix or recapture the workflow; do not fabricate tool output.

## Editing direction

Use straight cuts between task stages and short, restrained zooms to guide
attention. Keep the cursor movement deliberate. Hold a readable result after an
action rather than cutting through it. Avoid decorative transitions, dense
feature lists and a talking-head overlay that obscures the IDE.

Trim waiting time between actions. If a continuous tool execution is sped up,
label that segment “Sped up”; do not imply the model completed the entire task
in 88 seconds. The CLI shot is a separate session and should retain that label.
The memory handoff demonstrates a shared note, not automatic conversation
transfer between independent agents.

Record the voice-over at a calm pace, then adjust the captions to the actual
spoken timing. Keep captions to two lines within the lower safe area, positioned
away from the composer and diff controls. Background music is optional and
should stay below the voice; use only audio licensed for the intended release.

## Deliverables and completion criteria

- One 88-second MP4, H.264 video and AAC audio, plus an English SRT file.
- A clean master without burned-in captions and a captioned sharing copy.
- A thumbnail captured from the working app/IDE, with the existing OpenIDE mark.
- Real, legible footage for each claim; no account identifiers or private paths.
- Final verification of narration/caption alignment, readable code, audio level,
  browser result, repository URL and playback on a second player.

The storyboard and draft captions are ready. Capture, voice recording, editing
and final export remain production work after the stable build is available.
