# Diseño: Extensibilidad del Agente IA — Skills / MCP / Hooks / Comandos

**Estado:** diseño aprobado para implementación
**Base:** arquitectura actual de `openideAgent` y contratos públicos de MCP.
**Regla madre:** todo vive directamente en la fuente canónica de `vscode/`. Las contribuciones propias se mantienen bajo `src/vs/workbench/contrib/openideAgent/**` y `src/vs/platform/openide*/**`; los archivos compartidos se modifican con integraciones pequeñas y explícitas.

---

## 1. Resumen ejecutivo y decisiones

Se agregan tres subsistemas nuevos (cliente MCP, hooks de shell, /comandos) y una UI de administración que también cubre las skills ya existentes. Los cuatro se **usan** en el chat (tools MCP entran al loop por el registry, hooks cortan el lifecycle de tools/turnos, /comandos se expanden en el composer, skills ya están) y se **administran** desde una página webview-editor "Extensiones del Agente" enlazada desde el TOC de settings.

### Contratos adoptados

| Feature | Contrato |
|---|---|
| MCP | Shape de config `mcpServers`, namespacing `mcp_<server>_<tool>` sanitizado a `[A-Za-z0-9_]`, capability-gating (`tools/list` solo si el server anuncia `tools`), env-whitelist para stdio, stderr a log file, redacción de credenciales en errores, preflight de URL/Content-Type para HTTP. |
| Hooks | Wire protocol stdin/stdout JSON (`{"decision":"block","reason"}` y `{"action":"block","message"}` normalizados), semántica de agregación (primer block gana; contexts concatenados con `\n\n` al mensaje de usuario, NUNCA al system prompt), fail-open para errores de hook, matcher regex `fullmatch` solo en pre/postToolUse, consentimiento primera-vez con mtime del script. |
| Comandos | Contrato de completions `{items, replace_from}` + regla "Enter acepta solo si cambia algo"; separación `{displayText, modelText}` por turno desde el día 1 (la lección de `extract_user_instruction_from_skill_message`). |
| Skills (UI) | Patrón lista agrupada + Switch con guardado optimista + toast "aplica a sesiones nuevas"; disabled como **lista de exclusión** (enabled se computa). |
| MCP (UI) | Master-detail (lista + editor), form tipado por transporte y botón **Test** ("N tools"); validaciones puras de nombre, URL http(s), variables de entorno y duplicados. |

### Qué se simplifica u omite

- **MCP:** sin SDK externo — implementamos JSON-RPC 2.0 newline-delimited nosotros (ya lo dominamos: `openideDiagramsMcpServer.ts` es el mismo wire, del otro lado). Transportes v1: **stdio + Streamable HTTP**; SSE después. Sin OAuth MCP v1 (headers estáticos), sin sampling/elicitation (declaramos capabilities mínimas), sin catálogo/hub, sin OSV scan. Circuit breaker reducido: N fallos → parking + deregistro de tools (nunca tools fantasma) + revival manual/backoff simple. **Sin snapshot de tools:** `getDefinitions()` ya se llama en cada `runMessages`, la lista del turno se deriva del registry vivo — eliminamos de raíz la clase de bugs de `refresh_agent_mcp_tools`.
- **Hooks:** 6 eventos (no 22): `preToolUse`, `postToolUse`, `userPromptSubmit`, `sessionStart`, `stop`, `subagentStop`. Sin capa de middleware (mutación de args), sin plugins Python-style. Timeout default **10s** (no 60: hay UI esperando). Allowlist en `IStorageService` (APPLICATION) en vez de archivo+flock.
- **Comandos:** SOLO archivos markdown (`commands/*.md`), sin quick_commands exec/alias v1 (un comando `.md` puede documentar el shell que el agente correrá; exec-sin-LLM queda para después). **Las skills NO se mapean automáticamente a /comandos**: son progressive-disclosure vía `skill_view` y el modelo las carga solo; un comando puede decir "usá la skill X". Interpolación `$ARGUMENTS`/`$1..$9`. Inline-shell `` !`cmd` `` **omitido en v1** por seguridad.
- **Skills:** el motor ya está completo; solo se agrega `deleteSkill`, toggle `disabledSkills` y UI.

### Decisiones de arquitectura clave

1. **UN solo servicio nuevo en electron-main** (`OpenideAgentHostMainService`) para MCP stdio + ejecución de hooks + exec de comandos futuros ⇒ **una sola línea nueva en `app.ts`** (`ProxyChannel.fromService`, precedente browser automation). Eventos de estado (`onDidChangeMcpServerStatus`) viajan por el mismo ProxyChannel (soporta Events `onDid*`).
2. Config del usuario en **archivos**, no en settings: por proyecto `<workspace>/.openide/{mcp.json,hooks.json,commands/*.md}` y global `userRoamingDataHome/openideAgent/{mcp.json,hooks.json,commands/*.md}` (mismo layout que memoria/skills). Settings solo para toggles de comportamiento y listas de exclusión (`openide.agent.disabledSkills`, `openide.agent.hooks.enabled`, allowlist existente).
3. Tools MCP entran por `registry.registerTool()` con `risk: 'exec'` salvo `annotations.readOnlyHint === true` ⇒ `risk: 'safe'` (así también quedan visibles en modos plan/ask, coherente con el filtro por risk).
4. Los /comandos se resuelven **en el host (`openideChatView.handleSend`) antes de armar los messages**; el webview solo autocompleta (clon del pipeline de @menciones).
5. HARDLINE_DENY del ApprovalManager sigue siendo previo a todo; los hooks preToolUse corren **antes del approval gate** (un block de hook ahorra el prompt al usuario) y son fail-open; el approval sigue fail-closed.

---

## 2. Modelo de datos

### 2.1 `mcp.json` (proyecto: `.openide/mcp.json`; global: `userRoamingDataHome/openideAgent/mcp.json`)

Clave raíz `mcpServers` para facilitar copy-paste desde configuraciones MCP existentes:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." },
      "enabled": true,
      "timeout": 120,
      "tools": { "include": ["search_repositories", "get_file_contents"] }
    },
    "notion": {
      "url": "https://mcp.notion.com/mcp",
      "headers": { "Authorization": "Bearer ..." },
      "enabled": false
    }
  }
}
```

- Transporte **inferido**: `command` ⇒ stdio, `url` ⇒ Streamable HTTP. Campo opcional `transport: "sse"` reservado, rechazado con warning en v1.
- Campos: `enabled` (default `true`), `timeout` seg por tool-call (default 120, clamp 5..600), `connectTimeout` (default 30), `tools.include`/`tools.exclude` (include gana).
- **Merge:** global primero, proyecto pisa por nombre de server. Server con nombre inválido (`^[A-Za-z0-9][A-Za-z0-9_-]*$` fallado) se skipea con warning.
- Secretos: v1 en claro en el json; la UI nunca los muestra (input password + "•••"). Migración a SecretStorage con placeholder `${secret:KEY}` queda documentada como fase futura.

### 2.2 `hooks.json` (proyecto + global, mismo merge: concatenación de listas, proyecto primero)

```json
{
  "hooks": {
    "preToolUse":  [ { "matcher": "run_command", "command": "~/.openide-hooks/block-rm.sh", "timeout": 10 } ],
    "postToolUse": [ { "matcher": "write_file|apply_patch", "command": "node scripts/format.js" } ],
    "userPromptSubmit": [ { "command": "./scripts/inject-branch-context.sh" } ],
    "sessionStart": [], "stop": [], "subagentStop": []
  }
}
```

- `command`: string, parseada estilo shlex (lib propia mínima), spawn `shell:false`, `~` expandido, relativa ⇒ resuelta contra el workspace root.
- `matcher`: regex opcional, `fullmatch` contra `tool_name`, SOLO honrado en `preToolUse`/`postToolUse` (en otros eventos warning y se ignora). Regex inválida degrada a igualdad literal.
- `timeout`: default 10, clamp 1..60.

**Wire protocol:** stdin = una línea JSON `{"hook_event_name","tool_name","tool_input","session_id","cwd","extra":{...}}` con `cwd` = workspace root (NO el cwd del proceso). stdout opcional:
- `preToolUse` → `{"decision":"block","reason":"..."}` o `{"action":"block","message":"..."}` (normalizados) ⇒ tool result `Error: <msg>` + `postToolUse` con `status:"blocked"`.
- `userPromptSubmit` → `{"context":"texto"}` ⇒ se concatena al **contexto del mensaje de usuario** (`message.context`, mismo canal que las @menciones), nunca al system prompt (prefix cache).
- Todo lo demás / stdout no-JSON / exit≠0 / timeout ⇒ no-op logueado (**fail-open**). Exit≠0 igual parsea stdout (un script puede fallar Y bloquear).

**Consentimiento:** primera vez por par `(evento, command)` ⇒ diálogo nativo ("Este hook corre con tus credenciales completas. ¿Permitir?") con Permitir / Permitir siempre / Denegar. Aprobaciones en `IStorageService` scope APPLICATION, clave `openide.agent.hooksAllowlist`, entradas `{event, command, approvedAt, scriptMtime}`. Si el mtime del script cambió desde la aprobación ⇒ re-preguntar. Hook no aprobado = skipeado con warning en el log, jamás bloquea el turno.

### 2.3 `commands/*.md` (proyecto: `.openide/commands/`; global: `userRoamingDataHome/openideAgent/commands/`)

```markdown
---
description: Revisa el diff actual y sugiere mejoras
argument-hint: [rama-base]
---
Revisá los cambios contra $1 (default: master). Enfocate en: $ARGUMENTS
```

- **Slug = nombre de archivo** sin `.md`, validado con el mismo `NAME_RE` kebab-case de skills. Invocación: `/revisar-diff argumentos libres`.
- Frontmatter YAML plano key:value (mismo parser tolerante de `openideAgentSkills.ts`): `description` (para el menú), `argument-hint` (ghost text). Sin `model`/`allowed-tools` v1.
- Cuerpo: `$ARGUMENTS` = todo lo tipeado tras el slug; `$1..$9` = split por espacios (comillas respetadas); si el cuerpo no contiene `$ARGUMENTS` ni `$N` y hay args, se appendean al final como línea `Instrucción adicional: ...`.
- **Precedencia** en colisión de slug: proyecto > global. (No hay colisión con skills: no son comandos.)
- El historial guarda `{displayText: "/revisar-diff main", modelText: <expandido>}` — la UI muestra display, el modelo ve modelText, y memoria/títulos usan displayText.

### 2.4 Settings (settings.json) vs archivos — reparto final

| Dato | Dónde |
|---|---|
| Servers MCP, hooks, comandos | Archivos `.openide/` + globales (fuente de verdad, editables por UI y a mano) |
| `openide.agent.disabledSkills: string[]` | Setting (lista de exclusión; filtra índice del prompt y `skill_view`) |
| `openide.agent.hooks.enabled: boolean` (default true) | Setting (kill-switch global) |
| `openide.agent.mcp.enabled: boolean` (default true) | Setting (kill-switch global) |
| Allowlist de hooks aprobados | `IStorageService` APPLICATION (no es config, es estado de seguridad) |
| `openide.agent.toolAllowlist` | Ya existe, sin cambios; las tools MCP entran con clave `exec:mcp_<server>_<tool>` estándar |

---

## 3. Arquitectura por feature

### 3.1 MCP client

**Nuevos — `src/vs/platform/openideAgentHost/`** (contrato+main, patrón `openideBrowser`):

| Archivo | Responsabilidad |
|---|---|
| `common/openideAgentHost.ts` | `IOpenideAgentHostService` + `OPENIDE_AGENT_HOST_CHANNEL`. Métodos MCP: `mcpConnect(id, config) → {tools, serverInfo}`, `mcpCallTool(id, tool, args, timeoutMs) → McpToolResult`, `mcpDisconnect(id)`, `mcpStatus() → McpServerStatus[]`; evento `onDidChangeMcpServerStatus`. Método hooks: `execHook(req: {command, stdinJson, timeoutMs, cwd}) → {exitCode, stdout, stderr, timedOut}`. Tipos: `McpServerConfig`, `McpToolInfo {name, description, inputSchema, annotations?}`, `McpToolResult {text, isError}`. Validaciones puras compartidas (nombre, URL, env). |
| `electron-main/openideAgentHostMain.ts` | Implementación. **Stdio:** `spawn` con env = whitelist (PATH, HOME, LANG, TERM, XDG_*, vars Windows) + env explícito del config; resolución de `npx`/`node` contra ese PATH; framing JSON-RPC 2.0 un-objeto-por-línea (`initialize` → capabilities → `tools/list` solo si `capabilities.tools`); stderr a `<logsHome>/openide-mcp-<server>.log`; kill del process tree en disconnect/shutdown. **HTTP:** fetch con preflight de Content-Type (allow `application/json`/`text/event-stream`, si no error claro "la URL parece una página web"). Timeouts por call con AbortSignal. Redacción de valores de `env`/`headers` en todo error devuelto. Estado por server: `connecting | connected | error | disconnected` + contador de fallos (3 consecutivos ⇒ `error` con parking; reconexión al llamar `mcpConnect` de nuevo). |

**Nuevos — workbench:**

| Archivo | Responsabilidad |
|---|---|
| `browser/openideAgentMcp.ts` | `OpenideMcpManager`: (1) lee y mergea mcp.json proyecto+global con `IFileService` (try/catch-devuelve-vacío estilo skills); (2) `ProxyChannel.toService` al canal del host; (3) por cada server `enabled` conecta en background al primer `runMessages` (lazy-eager: no bloquear el arranque del IDE; espera acotada 1.5s solo la primera vez, después lo que ya esté conectado); (4) registra cada tool como `IAgentTool` en el `OpenideToolRegistry`: nombre `mcp_<server>_<tool>` sanitizado, guard de colisión (skip + warning, **nunca pisar** una built-in), `risk = annotations.readOnlyHint ? 'safe' : 'exec'`, `approvalInfo {server, tool}`, `invoke` = `mcpCallTool` con resultado string (`text` o `Error: ...`); (5) aplica `tools.include/exclude`; (6) al evento de status `error/disconnected` **deregistra** las tools del server (nunca tools fantasma en el prompt — necesita `deregisterTool()` nuevo en el registry); (7) `reload()` público: disconnect all + re-read + reconnect (lo llama la UI y el comando "Agente: Recargar MCP"). |

**Tocados:**
- `src/vs/code/electron-main/app.ts` — **1 statement** junto a las líneas 1201-1205: `mainProcessElectronServer.registerChannel(OPENIDE_AGENT_HOST_CHANNEL, ProxyChannel.fromService(new OpenideAgentHostMainService(logService), disposables))`.
- `browser/openideTools.ts` — agregar `deregisterTool(name)` y `hasTool(name)` (aditivo).
- `browser/openideAgentService.ts` — ctor: instanciar `OpenideMcpManager` y `registerTools(this.tools)` (junto a `browserAutomation`, líneas 276-286); sumar prefijo `mcp_` al set `EXCLUDED` de `runSubAgent` (línea 1231) — los subagentes no ven tools MCP en v1.
- `browser/openideAgent.contribution.ts` — settings `openide.agent.mcp.enabled` + Action2 "Recargar servidores MCP".

### 3.2 /Comandos

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `browser/openideAgentCommands.ts` | `OpenideAgentCommands`: `scan() → SlashCommand[] {slug, description, argumentHint, filePath, scope: 'project'|'global'}` (walk de ambos dirs, frontmatter, dedupe con precedencia proyecto); `resolve(inputText) → {slug, args} | undefined` (regex `^\/([a-z0-9][a-z0-9-]*)(\s+(.*))?$`); `expand(slug, args) → {displayText, modelText}` con `$ARGUMENTS`/`$1..$9`; `create(slug)` escribe template y devuelve URI para abrir en editor; `delete(slug)`. Caché por mtime de dir, invalidada por watcher de `IFileService`. |

**Tocados:**
- `browser/openideChatHtml.ts` — clon de la maquinaria de @: div `#slashMenu` (junto a `#mentionMenu`, línea ~633), CSS (junto a 512-514), `slashTokenAtCaret` con regex anclada a inicio de input (`/^\/([a-z0-9-]*)$/` sobre texto antes del caret — barras dobles en el fuente TS), listener en `input` (junto a 2650), debounce 120ms → `postMessage {type:'commandQuery', q}`, handler `commandSuggest` con guard anti-stale por token (patrón 2728-2736), keydown ArrowUp/Down/Enter/Tab/Escape ANTES del Enter-envía (junto a 2653-2662), accept = reescribir textarea a `/slug ` + ghost del `argument-hint`. **Sin template literals ni `${}` en el script embebido — solo concatenación con `+`** (header del archivo, líneas 12-15). Cierre en `closeMenus` (2171).
- `browser/openideChatView.ts` — case `'commandQuery'` en el switch (junto a 276-287) → responde `{type:'commandSuggest', q, items:[{slug, description, hint}]}`; en `handleSend`: si `commands.resolve(text)` matchea, expandir y mandar `modelText` al motor + `displayText` a la UI/historial. Comando inexistente ⇒ mensaje de sistema "comando desconocido: /x (¿quisiste decir /y?)" sin gastar turno.
- `common/openideAgentTypes.ts` — `IChatMessage` gana campo opcional `displayText` (aditivo, no rompe nada).

### 3.3 Hooks

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `browser/openideAgentHooks.ts` | `OpenideAgentHooks`: loader/merge de hooks.json (proyecto+global), parse defensivo (evento desconocido = warning + skip, sugerencia por distancia de edición); `dispatch(event, payload) → HookOutcome[]`; agregadores: `getBlockMessage(outcomes)` (primer block gana, orden determinista: proyecto antes que global, orden del array), `getInjectedContext(outcomes)` (join `\n\n`); consentimiento (QuickPick nativo + storage APPLICATION + mtime check vía `IFileService.stat`); `has(event)` como gate barato; eventos observadores (`postToolUse`, `stop`, `sessionStart`, `subagentStop`) se despachan **fire-and-forget**; `preToolUse` y `userPromptSubmit` son awaited (bloquean como mucho `timeout` seg); `testHook(event, entry)` con payloads sintéticos para la UI. Ejecución real vía `IOpenideAgentHostService.execHook`. |

**Tocados:**
- `browser/openideAgentService.ts` — call sites en `runMessages`: `preToolUse` inmediatamente **antes** del approval gate (líneas 1158-1176; block ⇒ mismo camino que `decision === 'deny'`: tool result de error + `continue` + `postToolUse status:'blocked'`); `postToolUse` tras `this.tools.invoke` (1178) con `{result: cap 8k chars, duration_ms}`; `stop` junto al emit de `'done'`; `subagentStop` al cerrar `runSubAgent`; `sessionStart` en el primer `runMessages` de una sesión. HARDLINE_DENY no se mueve: sigue dentro del ApprovalManager y corre igual aunque un hook no bloquee.
- `browser/openideChatView.ts` — `userPromptSubmit` en `handleSend`: el `{"context"}` devuelto se appendea a `message.context` (mismo vehículo que `buildMentionContext`, línea 542).
- `electron-main/openideAgentHostMain.ts` — implementar `execHook` (spawn shell:false + shlex propio, stdin write + end, captura stdout/stderr con cap 64k, timeout con kill del tree, `{exitCode, stdout, timedOut}`).
- `browser/openideAgent.contribution.ts` — setting `openide.agent.hooks.enabled`.

### 3.4 Skills (solo gaps)

**Tocados:**
- `browser/openideAgentSkills.ts` — `deleteSkill(name)` (`fileService.del` recursivo del dir) y filtro por `openide.agent.disabledSkills` en `listSkills`/`buildPromptBlock`/`readSkill` (skill deshabilitada: fuera del índice y `skill_view` responde "deshabilitada, reactivala en Extensiones del Agente").
- `browser/openideAgentService.ts` — exponer `listSkills/saveSkill/deleteSkill/toggleSkill` en `IOpenideAgentService` para la UI.
- `browser/openideAgent.contribution.ts` — setting `openide.agent.disabledSkills`.

### 3.5 UI "Extensiones del Agente"

**Nuevos (trío patrón Providers):**

| Archivo | Responsabilidad |
|---|---|
| `browser/openideAgentExtensionsInput.ts` | `EditorInput` singleton readonly, scheme `openide-agent-extensions`, + `IEditorSerializer` trivial. |
| `browser/openideAgentExtensionsEditor.ts` | Extiende `OpenideOverlayWebviewEditor`. `postState()` con el estado completo: `{tab, skills[], mcp: {servers[], status[]}, hooks: {entries[], approvals[]}, commands[]}`. Suscripto a `onDidChangeMcpServerStatus` + watchers de config para refresh reactivo. `onMessage`: `toggleSkill`, `deleteSkill`, `newSkill`, `saveMcpServer` (upsert por-server, **no** rewrite del archivo entero salvo el bloque del server), `removeMcpServer`, `toggleMcpServer`, `testMcpServer`, `reloadMcp`, `approveHook`, `revokeHook`, `testHook`, `openHooksJson`/`openMcpJson`/`openCommandFile` (abren el archivo en un editor normal — el modo avanzado es el editor de texto del IDE, gratis), `newCommand`, `deleteCommand`, `setScope` (proyecto/global). Abre en `MODAL_GROUP`. |
| `browser/openideAgentExtensionsHtml.ts` | HTML embebido (codicons vía `buildCodiconCss`, **sin template literals en el `<script>`**). Anatomía en §4. |

**Tocados:**
- `browser/openideAgent.contribution.ts` — `registerEditorPane` + serializer + Action2 "Agente: Extensiones del Agente".
- `src/vs/workbench/contrib/preferences/browser/settingsLayout.ts` — sub-entradas bajo la sección `openideAgent` existente: `openideAgent/extensions` con los ids `openide.agent.disabledSkills`, `openide.agent.mcp.enabled`, `openide.agent.hooks.enabled` (mínimo diff, misma forma que providers).
- `src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts` — interceptor: click en la entrada del TOC abre el editor overlay (copiar el patrón providers ya presente; diff de ~5 líneas).

---

## 4. UI: anatomía y flujos

Una sola página **"Extensiones del Agente"**, overlay webview-editor en MODAL_GROUP. Layout: header con título + selector de scope (**Proyecto | Global** — decide qué archivos se editan; pill mostrando la ruta activa) + fila de tabs de texto: **Skills · MCP · Hooks · Comandos**. Debajo, panel scrolleable max-width. Primitivas visuales: filas grid `[1fr|auto]` (título bold + descripción muted | control), pills, empty states centrados con hint + botón de acción, toasts de éxito/error (mismo lenguaje visual que la página Proveedores).

### Tab Skills
- Búsqueda + lista plana de filas: nombre kebab + descripción (cap 300) + **Switch** (toggle optimista contra `disabledSkills`; revert en error; toast "aplica a partir del próximo mensaje") + menú ⋯ (Abrir SKILL.md, Eliminar con confirm).
- Botón "Nueva skill": pide nombre (validado NAME_RE inline), crea el template y abre el SKILL.md en un editor normal.
- Nota fija: "Las skills las carga el modelo automáticamente cuando son relevantes (skill_view)".

### Tab MCP
- **Master-detail** (lista izquierda 16rem | detalle): cada server = nombre + pill de transporte (stdio/http inferido) + **pill de estado en vivo** (`Conectado (N tools)` verde / `Conectando…` / `Error` rojo con tooltip del mensaje / `Deshabilitado` gris) alimentado por `onDidChangeMcpServerStatus`.
- Detalle: **form tipado por transporte** (stdio: command + args multilinea + env KEY=value con inputs password; http: URL + headers) con validación inline (nombre, URL http(s), duplicados) + acordeón "JSON avanzado" (textarea mono con la entry cruda, para timeout/include/exclude) + Switch enabled + botones **Probar** (connect + tools/list ⇒ "✓ N tools: a, b, c…" o el error redactado) / Guardar / Quitar (confirm).
- Header del tab: "Nuevo server", "Recargar todos" (llama `reload()`; banner "los cambios aplican al próximo mensaje del turno en curso"), "Abrir mcp.json".
- Guardar hace **upsert por server** (no PUT del archivo entero desde estado stale).

### Tab Hooks
- Agrupado por evento (heading uppercase + descripción de una línea de qué puede hacer ese evento). Filas: `command` mono truncado + pill matcher (si hay) + **pill de consentimiento**: `Aprobado` / `Pendiente` (botón Aprobar ⇒ mismo diálogo que la primera ejecución) / `Modificado desde aprobación` (ámbar, botón Re-aprobar) + botones **Probar** (corre con payload sintético y muestra exit/stdout/parsed en un `<pre>` expandible) y **Revocar**.
- Alta/edición: botón "Editar hooks.json" (abre el archivo; la página se refresca por watcher). No hay form de alta v1 — el JSON es la fuente de verdad y es chico.
- Banner superior si `openide.agent.hooks.enabled` está off.

### Tab Comandos
- Lista de filas: `/slug` mono + description + pill de scope (proyecto/global) + hint de args muted + ⋯ (Abrir .md, Eliminar).
- "Nuevo comando": nombre validado ⇒ template con frontmatter ⇒ abre el .md.
- Preview inline al seleccionar: cuerpo renderizado + ejemplo de expansión con args dummy.

---

## 5. Plan de implementación en fases (cada una termina con `npm run compile` verde)

**Orden elegido: MCP → Comandos → Hooks → UI.** Fundamento: MCP es el mayor valor (tools reales en el loop) y define el servicio de main que hooks reutiliza; Comandos es 100% renderer, barato y visible, y no depende de nada (se adelanta a Hooks para tener una win rápida sin tocar main de nuevo); Hooks reusa `execHook` del canal ya registrado (cero cambios extra en `app.ts`); la UI va última porque necesita los tres modelos de datos y servicios estabilizados — y las features son usables sin UI (archivos a mano) desde su propia fase.

**Fase 1 — Host service en main + canal IPC** *(infra, sin comportamiento visible)*
- NUEVOS: `platform/openideAgentHost/common/openideAgentHost.ts`, `platform/openideAgentHost/electron-main/openideAgentHostMain.ts` (MCP stdio+HTTP completo; `execHook` con implementación real ya incluida — es chica y evita re-tocar main después).
- TOCADOS: `code/electron-main/app.ts` (1 registerChannel).
- Verificación: compile + smoke con un server de prueba desde devtools.

**Fase 2 — Tools MCP en el loop del chat**
- NUEVOS: `contrib/openideAgent/browser/openideAgentMcp.ts`.
- TOCADOS: `openideTools.ts` (`deregisterTool`/`hasTool`), `openideAgentService.ts` (ctor + EXCLUDED), `openideAgent.contribution.ts` (setting kill-switch + Action2 "Recargar MCP").
- Resultado usable: `.openide/mcp.json` a mano ⇒ tools `mcp_*` con approval gate en el chat.

**Fase 3 — /Comandos en el composer**
- NUEVOS: `browser/openideAgentCommands.ts`.
- TOCADOS: `openideChatHtml.ts` (slashMenu clonando mentionMenu), `openideChatView.ts` (commandQuery + expansión en handleSend), `common/openideAgentTypes.ts` (`displayText`).
- Resultado usable: `.openide/commands/*.md` ⇒ autocomplete + expansión con `$ARGUMENTS`.

**Fase 4 — Hooks en el lifecycle**
- NUEVOS: `browser/openideAgentHooks.ts`.
- TOCADOS: `openideAgentService.ts` (call sites preToolUse/postToolUse/stop/sessionStart/subagentStop), `openideChatView.ts` (userPromptSubmit), `openideAgent.contribution.ts` (setting).
- Resultado usable: `.openide/hooks.json` ⇒ block/inject/observe con consentimiento.

**Fase 5 — UI "Extensiones del Agente"**
- NUEVOS: `browser/openideAgentExtensionsInput.ts`, `browser/openideAgentExtensionsEditor.ts`, `browser/openideAgentExtensionsHtml.ts`.
- TOCADOS: `openideAgentSkills.ts` (deleteSkill + disabledSkills), `openideAgentService.ts` (exponer skills API), `openideAgent.contribution.ts` (pane + serializer + Action2 + setting disabledSkills), `settingsLayout.ts`, `settingsEditor2.ts` (interceptor).
- Resultado: administración completa de los 4 subsistemas.

**Fase 6 — Robustez y pulido**
- TOCADOS: `openideAgentHostMain.ts` (backoff de reconexión + parking a los 3 fallos + keepalive ping opcional + `notifications/tools/list_changed` ⇒ evento ⇒ re-registro diff en `openideAgentMcp.ts`), `openideAgentMcp.ts` (watcher de mcp.json con debounce ⇒ reload), `openideAgentExtensionsHtml.ts` (estados finos), redacción de secretos revisada end-to-end, cap de tools MCP en el prompt (warning en UI si >40 tools activas).
- Cierre: typecheck, build real desde la fuente canónica y verificación funcional.

---

## 6. Riesgos y trampas

1. **IPC / ProxyChannel:** los eventos del servicio main deben llamarse `onDid*` para que ProxyChannel los propague; payloads solo JSON-serializable (nada de Map/Error crudos — los `McpToolResult` son POJOs). Si algún día hace falta streaming de notificaciones por-call, usar el patrón de canal custom de `openideRequestIpc.ts` y recordar su trampa: VSBuffer solo serializa nativo a **nivel tope** del payload.
2. **Procesos zombies:** servers stdio spawneados en main sobreviven al cierre de la ventana ⇒ atar el ciclo de vida al canal (dispose de los disposables de `app.ts`) + kill del process tree en `mcpDisconnect` y en shutdown del main. Probar el caso "npx que spawnea node hijo".
3. **CSP / webview:** cero recursos externos; **jamás template literals ni `${}` dentro del `<script>` embebido** (se los come el template literal TS exterior — bug silencioso, header de `openideChatHtml.ts`); regex en el script con barras dobles en el fuente. El overlay editor manda estado por `postState()` completo — no acumular deltas.
4. **Aprobaciones:** doble gate deliberado — hook preToolUse (fail-open, del usuario para el agente) y ApprovalManager (fail-closed, del IDE para el usuario). Documentar que un hook NO puede auto-aprobar (no existe `{"decision":"approve"}` v1) y que HARDLINE_DENY es inapelable. Tools MCP `readOnlyHint` ⇒ `safe` implica que se ven en plan/ask y saltean el gate: confiar en la anotación es una decisión — mitigada porque include/exclude y enabled son del usuario.
5. **Tokens del system prompt:** las definitions de tools MCP entran en cada request; 5 servers × 20 tools revienta el presupuesto. Mitigación: include/exclude en config, cap blando con warning en UI (>40 tools), descripciones truncadas a 1k chars al registrar. El contexto inyectado por `userPromptSubmit` va al mensaje de usuario (preserva prefix cache) con cap 8k chars.
6. **Timeouts colgando el turno:** `preToolUse`/`userPromptSubmit` son awaited ⇒ default 10s clamp 60; los observadores fire-and-forget. Tool-call MCP default 120s pero el loop ya emite eventos — mostrar "esperando mcp_x_y…" y respetar el cancel del run (AbortSignal hasta el main).
7. **Configs concurrentes:** la UI hace upserts por entrada, nunca rewrite del archivo desde estado viejo; watcher + refresh reactivo para ediciones a mano en paralelo.
8. **Snapshot congelado por run:** skills/memoria/hooks/comandos se leen al inicio de cada `runMessages` — cambios mid-run aplican al mensaje siguiente; la UI lo comunica ("aplica al próximo mensaje").
9. **Archivos compartidos:** `app.ts` y `settingsLayout.ts` requieren cambios mínimos y explícitos. `settingsEditor2.ts` no se usa como punto de extensión de OpenIDE.
10. **Historial envenenado:** sin `{displayText, modelText}` los /comandos expandidos contaminan memoria/títulos; por eso está en el modelo de datos desde la Fase 3, no como retrofit.
