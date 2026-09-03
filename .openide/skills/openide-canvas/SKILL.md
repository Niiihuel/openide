---
name: openide-canvas
description: Create, edit or debug visual HTML/CSS artifacts and interactive .canvas.tsx wireframes in OpenIDE. You MUST load it before canvas_write or before touching a .canvas.tsx; use it for wireframes, comparing options, architecture, audits, charts and standalone tables.
---

# OpenIDE Canvas

A Canvas is a live visual HTML/CSS document that opens next to the chat. Prefer it when the answer is a standalone artifact: UI wireframes, option comparisons, visual structure, architecture, audits, timelines, charts or large tables.

## Visual principle

Produce visual HTML/CSS, not ASCII art or TUI. To represent an interface or a structure use semantic wireframes: boxes, lines, hierarchy and short labels. The goal is to communicate structure and decisions, not to reproduce specific final content.

- Use `Wireframe`, `WireframeBox`, `WireframeLine` and `WireframeText` for mockups.
- Keep content generic: `Navigation`, `Title`, `Form`, `Primary action`; do not invent long product copy.
- LANGUAGE — these instructions are written in English; the labels you write into a canvas are not. Write every label, heading and visible string in whatever language the user writes to you in. Component names, props, IDs and file paths stay as they are.
- Use `Choice` when there are alternatives the user has to pick from.
- Do not draw interfaces with `│ ─ ┌ ┐ [ ]` characters or monospace blocks.
- Neutral palette, native to the host: never hardcode neon, violet, gradients or loud shadows.

## Mandatory workflow

1. To edit an existing one, call `canvas_list` and `canvas_read`; preserve whatever does not change.
2. Create or update the real file with `canvas_write`; never paste TSX as a substitute.
3. A canvas is exactly `.openide/canvases/<kebab-name>.canvas.tsx`, with no helpers and no external CSS.
4. Import only from `openide/canvas`. No npm, builtins, fetch, network or dynamic imports.
5. Default-export exactly one top-level component and embed the data inline.
6. Do not render empty placeholders: if there is no data for the whole artifact, do not create it.
7. Charts/tables must state the metric, axes/units, source and time range.
8. Available: `Stack`, `Row`, `Grid`, `Spacer`, `Divider`, `H1/H2/H3`, `Text`, `Card/CardHeader/CardBody`, `Button`, `Link`, `Pill`, `Stat`, `Callout`, `Code`, `Table`, charts, `TodoList`, `DiffView`, `CollapsibleSection`, inputs, `Wireframe`, `WireframeBox`, `WireframeLine`, `WireframeText` and `Choice`.
9. Every color must come from `useHostTheme()`. Flat/minimal design: no gradients, box-shadow, decorative emojis, rainbow coloring or walls of identical cards.
10. `useCanvasState(key, default)` persists selection/state. `useCanvasAction()` dispatches actions to the host.

## Selectable options pattern

```tsx
import { Stack, H1, Text, Choice, useCanvasState, useCanvasAction } from 'openide/canvas';

export default function Options() {
  const [selected, setSelected] = useCanvasState('choice', '');
  const action = useCanvasAction();
  const choose = (id: string, label: string) => {
    setSelected(id);
    action({ type: 'canvasChoice', choiceId: id, label });
  };
  return <Stack gap={16}>
    <H1>Pick a direction</H1>
    <Text tone="secondary">Structural comparison; the final content is decided later.</Text>
    <Choice id="a" title="Option A" description="Two-column structure" selected={selected === 'a'} onSelect={() => choose('a', 'Option A — two-column structure')} />
    <Choice id="b" title="Option B" description="Linear single-column flow" selected={selected === 'b'} onSelect={() => choose('b', 'Option B — linear single-column flow')} />
  </Stack>;
}
```

On selection, OpenIDE carries `label` into the chat composer as visible, editable text; the user confirms Send. Do not put secrets or huge content in `label`.

## Wireframe pattern

```tsx
<Wireframe label="Main view">
  <WireframeBox label="Navigation" height={52} />
  <Grid columns="1fr 2fr" gap={16}>
    <WireframeBox label="Filters" height={240} />
    <Stack gap={10}>
      <WireframeLine width="55%" />
      <WireframeLine width="90%" />
      <WireframeBox label="Main content" height={180} />
    </Stack>
  </Grid>
</Wireframe>
```

Before delivering, check hierarchy, reasonable responsiveness, absence of TUI/neon, and that every `Choice` has a clear ID/label. Treat the `canvas_write` TypeScript check as authoritative. In the final answer include an absolute link to the `.canvas.tsx` and tell the user they can open it next to the chat.
