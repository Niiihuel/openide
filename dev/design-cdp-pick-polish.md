# Diseño: tools CDP de browser + Pick & Polish (fase posterior al browser localhost)

Estado: **IMPLEMENTADO (jul 2026)** en `src/vs/platform/openideBrowser/{common,electron-main}/` +
`contrib/openideAgent/browser/openideBrowserTools.ts`, con dos desvíos deliberados del diseño:
1. **Sin CDP/debugger**: APIs Electron puras alcanzan (executeJavaScript / sendInputEvent /
   insertText / capturePage / evento console-message) — menos maquinaria y sin el riesgo del
   attach; la puerta a `webContents.debugger` queda abierta si hiciera falta (ej: network).
   Ventana OCULTA con `offscreen: true` (capturePage confiable) para tools; el pick usa una
   ventana VISIBLE aparte (OSR no se puede mostrar).
2. **Integración directa**: vive en la fuente canónica junto al agente y el registro de `app.ts`.
El resto del documento se conserva como diseño original de referencia.

## Por qué no alcanza el iframe del browser localhost

El preview (#22) es un iframe dentro de un webview: la página localhost es **cross-origin**
respecto del webview (`vscode-webview://`), así que ni el picker ni la automatización pueden
tocar su DOM desde ahí. La automatización necesita un `webContents` real controlado por CDP.

## Arquitectura propuesta (3 capas)

### 1. Main process: `OpenideBrowserAutomationMain`
- Vive en `src/vs/platform/openideBrowser/electron-main/` como servicio propio del producto.
- Mantiene un pool (máx 2) de `WebContentsView` **ocultas** (no attachadas a ninguna ventana,
  o attachadas fuera de viewport) con `sandbox: true`, partición `persist:openide-automation`.
- **Restricción localhost server-side**: handler `will-navigate` + validación previa con el
  mismo `normalizeLocalUrl` (compartir `common/openideLocalUrl.ts`, que es common-safe).
- CDP **sin puertos TCP**: `view.webContents.debugger.attach('1.3')` → `sendCommand(...)`.
  Nada de `--remote-debugging-port` (el error que ghost dejó sin cablear, y además inseguro).
- Canal IPC: registrar un `IServerChannel` (`ProxyChannel.fromService`) en el main, expuesto
  como `openideBrowserAutomation` vía `IMainProcessService` (mismo patrón que `nativeHost`).

API del servicio main (todas devuelven JSON serializable):
```
newSession(): { id }                       // toma una view del pool
navigate(id, url)                          // valida localhost → Page.navigate + esperar loadEventFired (timeout 10s)
screenshot(id): { base64 }                 // Page.captureScreenshot (jpeg quality 70, clip viewport)
click(id, selector | x,y)                  // DOM.querySelector → getBoxModel → Input.dispatchMouseEvent x2 (down/up)
type(id, selector, text)                   // focus + Input.insertText
evaluate(id, expression): { value }        // Runtime.evaluate (returnByValue, timeout 5s, SIN awaitPromise por default)
readDom(id, selector?): { html }           // DOM.getOuterHTML (cap 50k chars)
console(id): { entries }                   // buffer de Runtime.consoleAPICalled (últimos 50)
dispose(id)
```

### 2. Workbench: tools del agente
Registradas con `registry.registerTool()` desde el service (como memory/skills/git):
- `browser_navigate` (exec — navega/interactúa: pasa por el gate de aprobación una vez por
  sesión con "Permitir siempre"), `browser_click`, `browser_type`, `browser_screenshot` (safe),
  `browser_read_dom` (safe), `browser_evaluate` (exec), `browser_console` (safe).
- El resultado de `browser_screenshot` vuelve como imagen del mensaje tool → los providers ya
  soportan imágenes en mensajes user; hay que extender el rol tool con imagen (Anthropic:
  tool_result con content de bloques image; OpenAI: no soporta imagen en tool → fallback:
  inyectarla como mensaje user siguiente "screenshot de la herramienta").
- Sesión CDP por RUN del agente (se crea lazy en la primera tool browser_*, se dispose al done).
- El system prompt del modo agente suma una línea: "browser_*: para verificar apps locales
  en vivo (navegá, mirá screenshot, leé la consola) — SOLO localhost".

### 3. Pick & Polish (UI + tool, encima de lo anterior)
- **Pick**: comando "OpenIDE: Elegir elemento de la página" sobre la sesión CDP visible…
  pero la view de automatización es oculta. Dos variantes:
  a) *Pick sobre el preview visible* (iframe): imposible cross-origin → NO.
  b) *Pick sobre una view CDP visible*: la view del pool se attachea temporalmente a la
     ventana (encima del editor, con bounds del panel del preview) → overlay inyectado vía
     `Runtime.evaluate` (script que dibuja outline en mouseover y en click hace
     `window.__openidePick = {selector, outerHTML, styles: getComputedStyle serializado,
     rect}`), el main la poll-ea con `Runtime.evaluate` hasta que aparece, la view se
     desattachea y vuelve al preview normal.
- **Contexto al agente**: el pick devuelve `{selector, html (cap 4k), stylesRelevantes,
  screenshotDelElemento (clip=rect)}` → se inyecta al composer como bloque de contexto
  (mismo mecanismo `IChatMessage.context` de las @menciones) con un chip visible
  "elemento: <selector>".
- **Polish**: dos niveles:
  1. *En vivo*: tool `browser_set_style(selector, cssText)` / `browser_set_text` vía
     Runtime.evaluate — prototipado inmediato, no persiste.
  2. *A código*: el agente busca el fuente del elemento (search_text por clase/texto/testid —
    ya existe) y edita con edit_file. El prompt del flujo pick&polish le indica: "aplicá el
    cambio EN VIVO primero para validación visual (screenshot antes/después) y después
    llevalo al código fuente".

## Orden de implementación sugerido
1. Servicio main-process + canal + `browser_navigate/screenshot/read_dom/console` (read-only).
2. `browser_click/type/evaluate` + aprobaciones.
3. Pick (attach temporal + overlay + chip de contexto).
4. Polish en vivo + flujo a código.

## Riesgos conocidos
- `webContents.debugger` y eventos `loadEventFired`: hay que attachear ANTES de navegar.
- Screenshots grandes → cap y jpeg (tokens: ~1100/imagen según nuestro estimador).
- El pool oculto consume memoria (~100MB/view): crear lazy, dispose agresivo (idle 60s).
- Main process compartido: mantener el registro del servicio acotado y cubierto por typecheck.
