---
name: openide-canvas
description: "Create or edit an OpenIDE Canvas: structured UI designs, wireframes, whiteboards, animations, 3D scenes, or standalone .canvas.tsx visuals. Use when a visual artifact is the deliverable. Load before canvas_write or editing .canvas.tsx."
---

# OpenIDE Canvas

Canvas has two formats. Choose by what the user needs to do with the result:

- **Structured design** (`.openide/designs/<id>/design.json`): choose this for editable screens, mockups, mobile flows, presentations, documents, whiteboards, animation or 3D scenes. The user can inspect nodes, adjust tokens and test local interactions in the editor. Use `canvas_templates`, `canvas_create`, `canvas_inspect`, `canvas_patch`, `canvas_preview`, `canvas_import`, `canvas_export` and `canvas_handoff`.
- **Standalone TSX** (`.openide/canvases/<name>.canvas.tsx`): choose this for a visual explanation, comparison, architecture view, audit, chart, table or interactive decision aid built from the `openide/canvas` SDK. Use `canvas_list`, `canvas_read`, `canvas_write` and `canvas_open`. It is an OpenIDE JSX renderer, not a full React app or a structured design.

Honor a format/device already chosen in the Canvas gallery or by the user. If the requested format matters and is genuinely unclear, call `canvas_templates` and offer the relevant choices before creating a file. Match the user's language in visible labels. Do not create a Canvas merely because a task mentions UI or a table: use it when the visual artifact helps the user review or use the result.

## Structured design workflow

1. For a new design, call `canvas_templates`, choose the closest template and `canvas_create`. For an existing design, locate it with `canvas_list` if needed, then call `canvas_inspect`. Work from the returned `path`, stable node/screen IDs and `revision`; do not infer IDs from labels or a screenshot.
2. Preserve the user's content and project identity. Use **wireframe** fidelity for hierarchy and flows with short generic labels. Use **mockup** fidelity for realistic product copy and the project's tokens. If available, import DTCG/Tokens Studio color JSON with `canvas_import`; otherwise inspect the existing tokens before choosing colors. Do not replace a brand palette with editor colors.
3. Make focused, atomic `canvas_patch` batches with `expectedRevision`. Reinspect after every successful mutation before a later dependent edit. If a revision conflict occurs, reinspect and rebase the intended change on the new document; do not blindly replay a stale patch. Use `undo`/`redo` only when they match the user's requested edit.
4. Give controls an actual local action when the prototype calls for one (`navigate`, `overlay`, `close`, `back`, `submit`, `toggle`). Test the main path and an invalid or empty form state in Play mode. Screenshots show appearance, not interaction correctness.
5. Call `canvas_preview` to inspect the rendered result after meaningful visual edits. Compare it with `canvas_inspect`: check hierarchy, readable text, clipping, alignment, token use, and responsive behavior at the relevant mobile/tablet/desktop sizes. Fix specific defects and repeat the preview. A preview writes a JPEG and may require the IDE's configured write approval.
6. Export only when a file is needed (`canvas_export`: `html`, `pdf`, `pptx`, `svg`, `obj` as appropriate). For implementation, use `canvas_handoff` to produce a revision-specific brief; a handoff does not implement the design or complete a plan/goal. Report the design path, revision, interactions tested and any limits.

For spatial work, use `whiteboard` with positioned nodes and paths. For motion, use `animation` with 0.1–60 second keyframes and inspect the timeline; HTML/SVG preserve motion while PDF/PPTX are static. For 3D, use `scene3d` with primitives or a bounded OBJ mesh; OBJ export contains geometry, not materials or video. `canvas_import` accepts workspace PNG/JPEG/passive SVG, OBJ and supported token JSON. Do not claim Figma sync, GLB/video export, arbitrary web fonts or network-loaded assets.

## Standalone TSX workflow

1. For an edit, call `canvas_list` and `canvas_read` first; preserve unrelated content and state keys. Write the complete source with `canvas_write` and open it with `auto_open` or `canvas_open`.
2. Use exactly one `.openide/canvases/<kebab-name>.canvas.tsx` file. Import only from `openide/canvas`; no npm packages, builtins, fetch, network, dynamic imports, helper files or external CSS. Default-export one top-level component and embed only the data needed for this artifact.
3. Compose with `Stack`, `Row`, `Grid`, headings, `Text`, `Card`, `Table`, charts, inputs, `Choice` and other exported SDK components. Use `Wireframe`, `WireframeBox`, `WireframeLine` and `WireframeText` only for low-fidelity wireframes. Use `useHostTheme()` for custom colors so light, dark and high-contrast themes remain legible. Avoid ASCII/TUI drawings, decorative gradients and repeated cards without information value.
4. For charts and tables, identify the metric, units, time range and source. Distinguish observed data from assumptions or examples. Prefer a compact layout that stays readable in a narrow editor pane; avoid empty placeholders or invented metrics.
5. Persist meaningful local state with `useCanvasState(key, default)`. For decisions, let `Choice` change selection first; provide an explicit `Button` that calls `useCanvasAction()` with `canvasChoice` to put a short, editable label in the chat composer. Selection alone must not submit. Do not put secrets or large data in that label.
6. Treat the `canvas_write` check as syntax/SDK-import validation only. Open the result, inspect the rendered layout and exercise each interaction before delivery; fix runtime errors rather than claiming a successful write proves behavior.

Example of a confirmed choice:

```tsx
import { Stack, H1, Choice, Button, useCanvasState, useCanvasAction } from 'openide/canvas';

export default function Options() {
  const [selected, setSelected] = useCanvasState('direction', '');
  const action = useCanvasAction();
  return <Stack gap={16}>
    <H1>Choose a direction</H1>
    <Choice id="compact" title="Compact" selected={selected === 'compact'} onSelect={() => setSelected('compact')} />
    <Choice id="spacious" title="Spacious" selected={selected === 'spacious'} onSelect={() => setSelected('spacious')} />
    <Button variant="primary" disabled={!selected} onClick={() => action({ type: 'canvasChoice', choiceId: selected, label: `I prefer the ${selected} option` })}>Use this option</Button>
  </Stack>;
}
```

In the final response, link the real artifact file and state what was visually inspected and what was actually tested. If a preview or interaction test could not run, say so plainly.
