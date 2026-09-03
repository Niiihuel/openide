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
description: Create, edit or debug HTML/CSS visual artifacts and interactive .canvas.tsx wireframes in OpenIDE. You MUST load it before canvas_write or before touching .canvas.tsx; use it for wireframes, comparing options, architecture, audits, charts and standalone tables.
---

# OpenIDE Canvas

A Canvas is a live HTML/CSS visual document that opens next to the chat. Prefer it when the answer is a standalone artifact: UI wireframes, option comparisons, visual structure, architecture, audits, timelines, charts or large tables.

## Visual principle

Generate visual HTML/CSS, not ASCII art or TUI. To represent an interface or a structure use semantic wireframes: boxes, lines, hierarchy and short labels. The goal is to communicate structure and decisions, not to copy specific final content.

- Use Wireframe, WireframeBox, WireframeLine and WireframeText for mockups.
- Keep content generic: Navigation, Title, Form, Primary action; do not invent long product copy.
- Use Choice whenever there are alternatives the user has to select.
- Do not draw interfaces with │ ─ ┌ ┐ [ ] characters or monospace blocks.
- Neutral palette, native to the host: never hardcode neon, purple, gradients or loud shadows.

## Mandatory workflow

1. To edit an existing one, call canvas_list and canvas_read; preserve whatever does not change.
2. Create or update the real file with canvas_write; never paste TSX as a substitute.
3. A canvas is exactly .openide/canvases/<kebab-name>.canvas.tsx, with no helpers and no external CSS.
4. Import only from openide/canvas. No npm, builtins, fetch, network or dynamic imports.
5. Default-export exactly one top-level component and embed the data inline.
6. Do not render empty placeholders: if there is no data for the whole artifact, do not create it.
7. Charts/tables must state metric, axes/units, source and time range.
8. Available: Stack, Row, Grid, Spacer, Divider, H1/H2/H3, Text, Card/CardHeader/CardBody, Button, Link, Pill, Stat, Callout, Code, Table, charts, TodoList, DiffView, CollapsibleSection, inputs, Wireframe, WireframeBox, WireframeLine, WireframeText y Choice.
9. Every color must come from useHostTheme(). Flat/minimal design: no gradients, box-shadow, decorative emojis, rainbow coloring or walls of identical cards.
10. useCanvasState(key, default) persists selection/state. useCanvasAction() dispatches actions to the host.

## Selectable options pattern

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
    <H1>Pick a direction</H1>
    <Text tone="secondary">Structural comparison; the final content is defined later.</Text>
    <Choice id="a" title="Option A" description="Two-column structure" selected={selected === 'a'} onSelect={() => choose('a', 'Option A — two-column structure')} />
    <Choice id="b" title="Option B" description="Single-column linear flow" selected={selected === 'b'} onSelect={() => choose('b', 'Option B — single-column linear flow')} />
  </Stack>;
}
\`\`\`

On selection, OpenIDE puts label into the chat composer as visible, editable text; the user confirms Send. Do not put secrets or huge content in label.

## Wireframe pattern

\`\`\`tsx
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
\`\`\`

Before delivering, check hierarchy, reasonable responsiveness, absence of TUI/neon and that every Choice has a clear ID/label. Treat the canvas_write TypeScript check as authoritative. In the final answer include an absolute link to the .canvas.tsx and tell the user they can open it next to the chat.
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
			return this.disabledSet().has(name) ? `Error: skill "${name}" is disabled.` : BUILTIN_CANVAS_SKILL;
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
			return `Error: skill "${name}" is disabled — the user can re-enable it in "Extensiones del Agente".`;
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
			return `Error: invalid skill name "${name}" (kebab-case: a-z, 0-9 and hyphens; no -- and no hyphen at either end).`;
		}
		if (!description.trim()) {
			return 'Error: description is required (what it does + WHEN to use it, with keywords).';
		}
		if (!content.trim()) {
			return 'Error: content is empty.';
		}
		const uri = this.skillUri(name);
		if (!uri) {
			return 'Error: no folder is open (skills live in .openide/skills inside the workspace).';
		}
		const existed = await this.fileService.exists(uri);
		const doc = `---\nname: ${name}\ndescription: ${description.trim().replace(/\n+/g, ' ')}\n---\n\n${content.trim()}\n`;
		await this.fileService.writeFile(uri, VSBuffer.fromString(doc));
		return `OK: skill "${name}" ${existed ? 'updated' : 'created'} at .openide/skills/${name}/SKILL.md.`;
	}

	/** System prompt block: compact index + creation guide (progressive disclosure tier 1). */
	async buildPromptBlock(): Promise<string> {
		const skills = await this.listSkills();
		const guide = 'CREATION: when you solve a hard problem, discover a project convention or repeat a configuration/recipe, save it as a skill with skill_save (kebab-case name; description = what it does + WHEN to use it, with keywords). A skill is a reusable PROCEDURE — loose facts go to the memory tool. Prefer UPDATING an existing skill over creating a similar one. Do NOT capture: things you already know how to do, transient errors already fixed, rules overfitted to a single case.';
		if (!skills.length) {
			return '\n\nPROJECT SKILLS: none yet. ' + guide;
		}
		const index = skills.map(s => `- ${s.name}: ${s.description || '(no description)'}`).join('\n');
		return '\n\nPROJECT SKILLS (reusable procedures in .openide/skills and .agents/skills):\nBefore tackling the task, scan this list; if a skill applies, you MUST load it with skill_view before continuing.\n' + index + '\n' + guide;
	}
}
