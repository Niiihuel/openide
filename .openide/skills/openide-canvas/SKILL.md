---
name: openide-canvas
description: Crear, editar o depurar artefactos visuales HTML/CSS y wireframes interactivos .canvas.tsx en OpenIDE. DEBES cargarla antes de canvas_write o tocar .canvas.tsx; usala para wireframes, comparar opciones, arquitectura, audits, charts y tablas standalone.
---

# OpenIDE Canvas

Un Canvas es un documento visual HTML/CSS vivo que se abre junto al chat. Priorizalo cuando la respuesta sea un artefacto standalone: wireframes de UI, comparación de opciones, estructura visual, arquitectura, auditorías, timelines, charts o tablas grandes.

## Principio visual

Generá HTML/CSS visual, no arte ASCII ni TUI. Para representar una interfaz o estructura usá wireframes semánticos: cajas, líneas, jerarquía y labels breves. El objetivo es comunicar estructura y decisiones, no copiar contenido final específico.

- Usá `Wireframe`, `WireframeBox`, `WireframeLine` y `WireframeText` para mockups.
- Mantené contenido genérico: `Navegación`, `Título`, `Formulario`, `Acción principal`; no inventes textos de producto largos.
- Usá `Choice` cuando haya alternativas que el usuario deba seleccionar.
- No dibujes interfaces con caracteres `│ ─ ┌ ┐ [ ]` ni bloques monospace.
- Paleta neutral y nativa del host: nunca hardcodees neón, violeta, gradientes o sombras llamativas.

## Workflow obligatorio

1. Para editar uno existente, llamá `canvas_list` y `canvas_read`; preservá lo que no cambia.
2. Creá o actualizá el archivo real con `canvas_write`; nunca pegues TSX como sustituto.
3. Un canvas es exactamente `.openide/canvases/<kebab-name>.canvas.tsx`, sin helpers ni CSS externo.
4. Importá solamente desde `openide/canvas`. Sin npm, builtins, fetch, red ni imports dinámicos.
5. Default-exportá exactamente un componente top-level y embebé los datos inline.
6. No renderices placeholders vacíos: si no hay datos para el artefacto entero, no lo crees.
7. Charts/tablas deben indicar métrica, ejes/unidades, fuente y rango temporal.
8. Disponibles: `Stack`, `Row`, `Grid`, `Spacer`, `Divider`, `H1/H2/H3`, `Text`, `Card/CardHeader/CardBody`, `Button`, `Link`, `Pill`, `Stat`, `Callout`, `Code`, `Table`, charts, `TodoList`, `DiffView`, `CollapsibleSection`, inputs, `Wireframe`, `WireframeBox`, `WireframeLine`, `WireframeText` y `Choice`.
9. Todos los colores deben venir de `useHostTheme()`. Diseño flat/minimal: sin gradients, box-shadow, emojis decorativos, rainbow coloring ni paredes de cards idénticas.
10. `useCanvasState(key, default)` persiste selección/estado. `useCanvasAction()` despacha acciones al host.

## Patrón de opciones seleccionables

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
    <H1>Elegí una dirección</H1>
    <Text tone="secondary">Comparación estructural; el contenido final se define después.</Text>
    <Choice id="a" title="Opción A" description="Estructura en dos columnas" selected={selected === 'a'} onSelect={() => choose('a', 'Opción A — estructura en dos columnas')} />
    <Choice id="b" title="Opción B" description="Flujo lineal de una columna" selected={selected === 'b'} onSelect={() => choose('b', 'Opción B — flujo lineal de una columna')} />
  </Stack>;
}
```

Al seleccionar, OpenIDE lleva `label` al composer del chat como texto visible y editable; el usuario confirma Enviar. No incluyas secretos ni contenido enorme en `label`.

## Patrón wireframe

```tsx
<Wireframe label="Vista principal">
  <WireframeBox label="Navegación" height={52} />
  <Grid columns="1fr 2fr" gap={16}>
    <WireframeBox label="Filtros" height={240} />
    <Stack gap={10}>
      <WireframeLine width="55%" />
      <WireframeLine width="90%" />
      <WireframeBox label="Contenido principal" height={180} />
    </Stack>
  </Grid>
</Wireframe>
```

Antes de entregar, verificá jerarquía, responsividad razonable, ausencia de TUI/neón y que cada `Choice` tenga ID/label claros. Tratá el TypeScript check de `canvas_write` como autoritativo. En la respuesta final incluí un link absoluto al `.canvas.tsx` y aclarale que puede abrirlo junto al chat.
