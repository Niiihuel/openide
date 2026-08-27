/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — agent skills (Anthropic's Agent Skills standard, agentskills.io).
 *  Each skill is either our own `.openide/skills/<name>/SKILL.md` directory or a standard
 *  `.agents/skills/<name>/SKILL.md` install (Skills CLI), with minimal YAML frontmatter
 *  (name + description) and a markdown body. Progressive disclosure: ONLY the name+description
 *  index goes to the system prompt; the body is loaded on demand with the skill_view tool. The
 *  modelo CREA/actualiza skills con skill_save (convenciones, configs repetidas, soluciones
 *  to hard problems) — the matching is done by the LLM reading the descriptions.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface ISkillInfo {
	readonly name: string;
	readonly description: string;
	readonly location: 'builtin' | 'openide' | 'agents';
	readonly scope: 'project' | 'global';
	/** In the `openide.agent.disabledSkills` exclusion list: out of the index and out of skill_view. */
	readonly disabled: boolean;
}

/** EXCLUSION list (settings): enabled is computed — a new skill is born enabled. */
const DISABLED_SKILLS_KEY = 'openide.agent.disabledSkills';

/** Only the first N chars of a SKILL.md are read to build the index (with limits independent of the model). */
const INDEX_HEAD_CHARS = 4000;
/** Cap on the description in the prompt index (Claude Code truncates at ~1.5k; we are shorter). */
const INDEX_DESC_CAP = 300;
/** Maximum number of skills listed in the index (prompt budget). */
const INDEX_MAX_SKILLS = 30;
/** Valid name per the spec: kebab-case, 1-64 chars, no -- and no leading/trailing -. */
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;

const BUILTIN_CANVAS_SKILL = `---
name: openide-canvas
description: Crear, editar o depurar artefactos visuales HTML/CSS y wireframes interactivos .canvas.tsx en OpenIDE. DEBES cargarla antes de canvas_write o tocar .canvas.tsx; usala para wireframes, comparar opciones, arquitectura, audits, charts y tablas standalone.
---

# OpenIDE Canvas

Un Canvas es un documento visual HTML/CSS vivo que se abre junto al chat. Priorizalo cuando la respuesta sea un artefacto standalone: wireframes de UI, comparación de opciones, estructura visual, arquitectura, auditorías, timelines, charts o tablas grandes.

## Principio visual

Generá HTML/CSS visual, no arte ASCII ni TUI. Para representar una interfaz o estructura usá wireframes semánticos: cajas, líneas, jerarquía y labels breves. El objetivo es comunicar estructura y decisiones, no copiar contenido final específico.

- Usá Wireframe, WireframeBox, WireframeLine y WireframeText para mockups.
- Mantené contenido genérico: Navegación, Título, Formulario, Acción principal; no inventes textos de producto largos.
- Usá Choice cuando haya alternativas que el usuario deba seleccionar.
- No dibujes interfaces con caracteres │ ─ ┌ ┐ [ ] ni bloques monospace.
- Paleta neutral y nativa del host: nunca hardcodees neón, violeta, gradientes o sombras llamativas.

## Workflow obligatorio

1. Para editar uno existente, llamá canvas_list y canvas_read; preservá lo que no cambia.
2. Creá o actualizá el archivo real con canvas_write; nunca pegues TSX como sustituto.
3. Un canvas es exactamente .openide/canvases/<kebab-name>.canvas.tsx, sin helpers ni CSS externo.
4. Importá solamente desde openide/canvas. Sin npm, builtins, fetch, red ni imports dinámicos.
5. Default-exportá exactamente un componente top-level y embebé los datos inline.
6. No renderices placeholders vacíos: si no hay datos para el artefacto entero, no lo crees.
7. Charts/tablas deben indicar métrica, ejes/unidades, fuente y rango temporal.
8. Disponibles: Stack, Row, Grid, Spacer, Divider, H1/H2/H3, Text, Card/CardHeader/CardBody, Button, Link, Pill, Stat, Callout, Code, Table, charts, TodoList, DiffView, CollapsibleSection, inputs, Wireframe, WireframeBox, WireframeLine, WireframeText y Choice.
9. Todos los colores deben venir de useHostTheme(). Diseño flat/minimal: sin gradients, box-shadow, emojis decorativos, rainbow coloring ni paredes de cards idénticas.
10. useCanvasState(key, default) persiste selección/estado. useCanvasAction() despacha acciones al host.

## Patrón de opciones seleccionables

\`\`\`tsx
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
\`\`\`

Al seleccionar, OpenIDE lleva label al composer del chat como texto visible y editable; el usuario confirma Enviar. No incluyas secretos ni contenido enorme en label.

## Patrón wireframe

\`\`\`tsx
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
\`\`\`

Antes de entregar, verificá jerarquía, responsividad razonable, ausencia de TUI/neón y que cada Choice tenga ID/label claros. Tratá el TypeScript check de canvas_write como autoritativo. En la respuesta final incluí un link absoluto al .canvas.tsx y aclarale que puede abrirlo junto al chat.
`;

export class OpenideAgentSkills {
	/** Current name → file/directory resolution. Refreshed on list, it allows operating
	 *  indistinctly on OpenIDE's own skills or ones installed by the Skills CLI. */
	private readonly resolvedSkillFiles = new Map<string, URI>();
	private readonly resolvedSkillDirs = new Map<string, URI>();

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly configurationService: IConfigurationService,
		private readonly globalSkillsRoot: URI,
	) { }

	private skillsRoot(): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'skills') : undefined;
	}

	private agentsSkillsRoot(): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.agents', 'skills') : undefined;
	}

	private skillUri(name: string): URI | undefined {
		const root = this.skillsRoot();
		return root ? joinPath(root, name, 'SKILL.md') : undefined;
	}

	/** URI of a skill's SKILL.md (the extensions UI opens it in a normal editor). */
	fileUri(name: string): URI | undefined {
		return NAME_RE.test(name) ? (this.resolvedSkillFiles.get(name) ?? this.skillUri(name)) : undefined;
	}

	/** Set of disabled skills (the settings exclusion list). */
	private disabledSet(): Set<string> {
		const raw = this.configurationService.getValue<string[]>(DISABLED_SKILLS_KEY);
		return new Set(Array.isArray(raw) ? raw.map(String) : []);
	}

	/** Adds/removes from the exclusion list (the extensions UI switch). */
	async setDisabled(name: string, disabled: boolean): Promise<void> {
		const set = this.disabledSet();
		if (disabled) {
			set.add(name);
		} else {
			set.delete(name);
		}
		await this.configurationService.updateValue(DISABLED_SKILLS_KEY, [...set].sort());
	}

	/** Parses a SKILL.md's minimal YAML frontmatter: flat key: value pairs + block scalars
	 *  (`description: >` / `|` with the following indented lines — Claude Code uses them). */
	private parseFrontmatter(content: string): { name?: string; description?: string } {
		if (!content.startsWith('---')) {
			return {};
		}
		const end = content.indexOf('\n---', 3);
		if (end < 0) {
			return {};
		}
		const out: { name?: string; description?: string } = {};
		const lines = content.slice(3, end).split('\n');
		for (let i = 0; i < lines.length; i++) {
			const m = lines[i].match(/^(name|description):\s*(.*?)\s*$/);
			if (!m) {
				continue;
			}
			const key = m[1] as 'name' | 'description';
			let value = m[2];
			const block = value.match(/^([>|])[+-]?$/); // block scalar: el valor son las líneas indentadas siguientes
			if (block) {
				const parts: string[] = [];
				while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
					parts.push(lines[i + 1].trim());
					i++;
				}
				value = parts.filter(p => p).join(block[1] === '>' ? ' ' : '\n');
			}
			out[key] = value.replace(/^['"]|['"]$/g, '');
		}
		return out;
	}

	/** Lists the workspace skills (lightweight index: head frontmatter only). By default it
	 *  FILTERS the disabled ones (that is what the prompt sees); the UI asks for includeDisabled=true. */
	async listSkills(includeDisabled = false): Promise<ISkillInfo[]> {
		const disabledSet = this.disabledSet();
		const builtinDisabled = disabledSet.has('openide-canvas');
		const builtin: ISkillInfo[] = builtinDisabled && !includeDisabled ? [] : [{ name: 'openide-canvas', description: (this.parseFrontmatter(BUILTIN_CANVAS_SKILL).description ?? '').slice(0, INDEX_DESC_CAP), disabled: builtinDisabled, location: 'builtin', scope: 'global' }];
		const openideRoot = this.skillsRoot();
		const agentsRoot = this.agentsSkillsRoot();
		if (!openideRoot && !agentsRoot && !this.globalSkillsRoot) {
			return builtin;
		}
		this.resolvedSkillFiles.clear();
		this.resolvedSkillDirs.clear();
		const out: ISkillInfo[] = [...builtin];
		const seen = new Set(out.map(skill => skill.name));
		for (const source of [
			{ root: openideRoot, location: 'openide' as const, scope: 'project' as const },
			{ root: agentsRoot, location: 'agents' as const, scope: 'project' as const },
			{ root: this.globalSkillsRoot, location: 'agents' as const, scope: 'global' as const },
		]) {
			if (!source.root) {
				continue;
			}
			let children;
			try {
				children = (await this.fileService.resolve(source.root)).children ?? [];
			} catch {
				continue;
			}
			for (const child of children) {
				if (!child.isDirectory) {
					continue;
				}
				try {
					const file = joinPath(child.resource, 'SKILL.md');
					const content = (await this.fileService.readFile(file)).value.toString().slice(0, INDEX_HEAD_CHARS);
					const fm = this.parseFrontmatter(content);
					const description = (fm.description ?? '').slice(0, INDEX_DESC_CAP);
					const name = fm.name && NAME_RE.test(fm.name) ? fm.name : child.name;
					if (seen.has(name) && !includeDisabled) {
						continue; // una skill propia de .openide tiene prioridad sobre la universal
					}
					if (!seen.has(name)) {
						seen.add(name);
						this.resolvedSkillFiles.set(name, file);
						this.resolvedSkillDirs.set(name, child.resource);
					}
					const disabled = disabledSet.has(name) || disabledSet.has(child.name);
					if (disabled && !includeDisabled) {
						continue;
					}
					out.push({ name, description, disabled, location: source.location, scope: source.scope });
				} catch {
					// directorio sin SKILL.md: se ignora
				}
				if (out.length >= INDEX_MAX_SKILLS && !includeDisabled) {
					return out; // el cap es presupuesto de PROMPT; la UI lista todas
				}
			}
		}
		return out;
	}

	/** Full content of a skill (for skill_view). Disabled ⇒ an error message (the only consumer is
	 *  the tool, which returns it verbatim to the model). */
	async readSkill(name: string): Promise<string | undefined> {
		if (!NAME_RE.test(name)) {
			return undefined;
		}
		if (name === 'openide-canvas') {
			return this.disabledSet().has(name) ? `Error: la skill "${name}" está deshabilitada.` : BUILTIN_CANVAS_SKILL;
		}
		let uri = this.resolvedSkillFiles.get(name);
		if (!uri) {
			await this.listSkills(true);
			uri = this.resolvedSkillFiles.get(name) ?? this.skillUri(name);
		}
		if (!uri) {
			return undefined;
		}
		if (this.disabledSet().has(name)) {
			return `Error: la skill "${name}" está deshabilitada — el usuario puede reactivarla en "Extensiones del Agente".`;
		}
		try {
			return (await this.fileService.readFile(uri)).value.toString();
		} catch {
			return undefined;
		}
	}

	/** Deletes a whole skill, both our own (.openide) and CLI-installed ones (.agents). */
	async deleteSkill(name: string): Promise<boolean> {
		if (!NAME_RE.test(name) || name === 'openide-canvas') {
			return false;
		}
		if (!this.resolvedSkillDirs.has(name)) {
			await this.listSkills(true);
		}
		const dir = this.resolvedSkillDirs.get(name) ?? (this.skillsRoot() ? joinPath(this.skillsRoot()!, name) : undefined);
		if (!dir) {
			return false;
		}
		try {
			await this.fileService.del(dir, { recursive: true });
			return true;
		} catch {
			return false;
		}
	}

	/** Creates or updates a skill (used by the MODEL via skill_save). */
	async saveSkill(name: string, description: string, content: string): Promise<string> {
		if (!NAME_RE.test(name)) {
			return `Error: nombre de skill inválido "${name}" (kebab-case: a-z, 0-9 y guiones; sin -- ni guiones en los bordes).`;
		}
		if (!description.trim()) {
			return 'Error: la description es obligatoria (qué hace + CUÁNDO usarla, con keywords).';
		}
		if (!content.trim()) {
			return 'Error: content vacío.';
		}
		const uri = this.skillUri(name);
		if (!uri) {
			return 'Error: no hay carpeta abierta (las skills viven en .openide/skills del workspace).';
		}
		const existed = await this.fileService.exists(uri);
		const doc = `---\nname: ${name}\ndescription: ${description.trim().replace(/\n+/g, ' ')}\n---\n\n${content.trim()}\n`;
		await this.fileService.writeFile(uri, VSBuffer.fromString(doc));
		return `OK: skill "${name}" ${existed ? 'actualizada' : 'creada'} en .openide/skills/${name}/SKILL.md.`;
	}

	/** System prompt block: compact index + creation guide (progressive disclosure tier 1). */
	async buildPromptBlock(): Promise<string> {
		const skills = await this.listSkills();
		const guide = 'CREACIÓN: cuando resuelvas un problema difícil, descubras una convención del proyecto o repitas una configuración/receta, guardala como skill con skill_save (name kebab-case; description = qué hace + CUÁNDO usarla, con keywords). Una skill es un PROCEDIMIENTO reutilizable — los hechos sueltos van a la tool memory. Preferí ACTUALIZAR una skill existente antes que crear una parecida. NO captures: cosas que ya sabés hacer, errores transitorios ya resueltos, reglas sobreajustadas a un caso único.';
		if (!skills.length) {
			return '\n\nSKILLS DEL PROYECTO: todavía no hay. ' + guide;
		}
		const index = skills.map(s => `- ${s.name}: ${s.description || '(sin descripción)'}`).join('\n');
		return '\n\nSKILLS DEL PROYECTO (procedimientos reutilizables en .openide/skills y .agents/skills):\nAntes de encarar la tarea escaneá esta lista; si una skill aplica, DEBES cargarla con skill_view antes de seguir.\n' + index + '\n' + guide;
	}
}
