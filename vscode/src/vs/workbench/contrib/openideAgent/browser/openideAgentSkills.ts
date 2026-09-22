/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — agent skills (Anthropic's Agent Skills standard, agentskills.io).
 *  Each skill is a standard `.agents/skills/<name>/SKILL.md` install (Skills CLI) or a legacy
 *  `.openide/skills/<name>/SKILL.md` directory, with minimal YAML frontmatter
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
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { isContributionEnabled } from '../../chat/common/enablement.js';
import { getCanonicalPluginCommandId, IAgentPluginService } from '../../chat/common/plugins/agentPluginService.js';

export interface ISkillInfo {
	readonly name: string;
	readonly description: string;
	readonly location: 'builtin' | 'openide' | 'agents' | 'plugin';
	readonly scope: 'project' | 'global';
	/** Human-readable source shown in capability and settings surfaces. */
	readonly origin?: string;
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

/** Synced from .openide/skills/openide-canvas/SKILL.md via dev/sync-canvas-skill.mjs. */
export const BUILTIN_CANVAS_SKILL = `---
name: openide-canvas
description: "Create or edit an OpenIDE Canvas: structured UI designs, wireframes, whiteboards, animations, 3D scenes, or standalone .canvas.tsx visuals. Use when a visual artifact is the deliverable. Load before canvas_write or editing .canvas.tsx."
---

# OpenIDE Canvas

Canvas has two formats. Choose by what the user needs to do with the result:

- **Structured design** (\`.openide/designs/<id>/design.json\`): choose this for editable screens, mockups, mobile flows, presentations, documents, whiteboards, animation or 3D scenes. The user can inspect nodes, adjust tokens and test local interactions in the editor. Use \`canvas_templates\`, \`canvas_create\`, \`canvas_inspect\`, \`canvas_patch\`, \`canvas_preview\`, \`canvas_import\`, \`canvas_export\` and \`canvas_handoff\`.
- **Standalone TSX** (\`.openide/canvases/<name>.canvas.tsx\`): choose this for a visual explanation, comparison, architecture view, audit, chart, table or interactive decision aid built from the \`openide/canvas\` SDK. Use \`canvas_list\`, \`canvas_read\`, \`canvas_write\` and \`canvas_open\`. It is an OpenIDE JSX renderer, not a full React app or a structured design.

Honor a format/device already chosen in the Canvas gallery or by the user. If the requested format matters and is genuinely unclear, call \`canvas_templates\` and offer the relevant choices before creating a file. Match the user's language in visible labels. Do not create a Canvas merely because a task mentions UI or a table: use it when the visual artifact helps the user review or use the result.

## Structured design workflow

1. For a new design, call \`canvas_templates\`, choose the closest template and \`canvas_create\`. For an existing design, locate it with \`canvas_list\` if needed, then call \`canvas_inspect\`. Work from the returned \`path\`, stable node/screen IDs and \`revision\`; do not infer IDs from labels or a screenshot.
2. Preserve the user's content and project identity. Use **wireframe** fidelity for hierarchy and flows with short generic labels. Use **mockup** fidelity for realistic product copy and the project's tokens. If available, import DTCG/Tokens Studio color JSON with \`canvas_import\`; otherwise inspect the existing tokens before choosing colors. Do not replace a brand palette with editor colors.
3. Make focused, atomic \`canvas_patch\` batches with \`expectedRevision\`. Reinspect after every successful mutation before a later dependent edit. If a revision conflict occurs, reinspect and rebase the intended change on the new document; do not blindly replay a stale patch. Use \`undo\`/\`redo\` only when they match the user's requested edit.
4. Give controls an actual local action when the prototype calls for one (\`navigate\`, \`overlay\`, \`close\`, \`back\`, \`submit\`, \`toggle\`). Test the main path and an invalid or empty form state in Play mode. Screenshots show appearance, not interaction correctness.
5. Call \`canvas_preview\` to inspect the rendered result after meaningful visual edits. Compare it with \`canvas_inspect\`: check hierarchy, readable text, clipping, alignment, token use, and responsive behavior at the relevant mobile/tablet/desktop sizes. Fix specific defects and repeat the preview. A preview writes a JPEG and may require the IDE's configured write approval.
6. Export only when a file is needed (\`canvas_export\`: \`html\`, \`pdf\`, \`pptx\`, \`svg\`, \`obj\` as appropriate). For implementation, use \`canvas_handoff\` to produce a revision-specific brief; a handoff does not implement the design or complete a plan/goal. Report the design path, revision, interactions tested and any limits.

For spatial work, use \`whiteboard\` with positioned nodes and paths. For motion, use \`animation\` with 0.1–60 second keyframes and inspect the timeline; HTML/SVG preserve motion while PDF/PPTX are static. For 3D, use \`scene3d\` with primitives or a bounded OBJ mesh; OBJ export contains geometry, not materials or video. \`canvas_import\` accepts workspace PNG/JPEG/passive SVG, OBJ and supported token JSON. Do not claim Figma sync, GLB/video export, arbitrary web fonts or network-loaded assets.

## Standalone TSX workflow

1. For an edit, call \`canvas_list\` and \`canvas_read\` first; preserve unrelated content and state keys. Write the complete source with \`canvas_write\` and open it with \`auto_open\` or \`canvas_open\`.
2. Use exactly one \`.openide/canvases/<kebab-name>.canvas.tsx\` file. Import only from \`openide/canvas\`; no npm packages, builtins, fetch, network, dynamic imports, helper files or external CSS. Default-export one top-level component and embed only the data needed for this artifact.
3. Compose with \`Stack\`, \`Row\`, \`Grid\`, headings, \`Text\`, \`Card\`, \`Table\`, charts, inputs, \`Choice\` and other exported SDK components. Use \`Wireframe\`, \`WireframeBox\`, \`WireframeLine\` and \`WireframeText\` only for low-fidelity wireframes. Use \`useHostTheme()\` for custom colors so light, dark and high-contrast themes remain legible. Avoid ASCII/TUI drawings, decorative gradients and repeated cards without information value.
4. For charts and tables, identify the metric, units, time range and source. Distinguish observed data from assumptions or examples. Prefer a compact layout that stays readable in a narrow editor pane; avoid empty placeholders or invented metrics.
5. Persist meaningful local state with \`useCanvasState(key, default)\`. For decisions, let \`Choice\` change selection first; provide an explicit \`Button\` that calls \`useCanvasAction()\` with \`canvasChoice\` to put a short, editable label in the chat composer. Selection alone must not submit. Do not put secrets or large data in that label.
6. Treat the \`canvas_write\` check as syntax/SDK-import validation only. Open the result, inspect the rendered layout and exercise each interaction before delivery; fix runtime errors rather than claiming a successful write proves behavior.

Example of a confirmed choice:

\`\`\`tsx
import { Stack, H1, Choice, Button, useCanvasState, useCanvasAction } from 'openide/canvas';

export default function Options() {
  const [selected, setSelected] = useCanvasState('direction', '');
  const action = useCanvasAction();
  return <Stack gap={16}>
    <H1>Choose a direction</H1>
    <Choice id="compact" title="Compact" selected={selected === 'compact'} onSelect={() => setSelected('compact')} />
    <Choice id="spacious" title="Spacious" selected={selected === 'spacious'} onSelect={() => setSelected('spacious')} />
    <Button variant="primary" disabled={!selected} onClick={() => action({ type: 'canvasChoice', choiceId: selected, label: \`I prefer the \${selected} option\` })}>Use this option</Button>
  </Stack>;
}
\`\`\`

In the final response, link the real artifact file and state what was visually inspected and what was actually tested. If a preview or interaction test could not run, say so plainly.
`;

export class OpenideAgentSkills {
	/** Current name → file/directory resolution. Refreshed on list, it allows operating
	 *  indistinctly on legacy OpenIDE skills or standard Agent Skills. */
	private readonly resolvedSkillFiles = new Map<string, URI>();
	private readonly resolvedSkillDirs = new Map<string, URI>();
	private readonly readOnlySkillNames = new Set<string>();

	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly configurationService: IConfigurationService,
		private readonly globalSkillsRoot: URI,
		private readonly pluginService?: IAgentPluginService,
		private readonly legacyGlobalSkillsRoot?: URI,
		private readonly workspaceTrust?: IWorkspaceTrustManagementService,
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

	private agentsSkillUri(name: string): URI | undefined {
		const root = this.agentsSkillsRoot();
		return root ? joinPath(root, name, 'SKILL.md') : undefined;
	}

	/** URI of a skill's SKILL.md (the extensions UI opens it in a normal editor). */
	fileUri(name: string): URI | undefined {
		return this.resolvedSkillFiles.get(name) ?? (NAME_RE.test(name) ? this.agentsSkillUri(name) ?? this.skillUri(name) : undefined);
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
		const workspaceTrusted = !this.workspaceTrust || this.workspaceTrust.isWorkspaceTrusted();
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
		this.readOnlySkillNames.clear();
		const out: ISkillInfo[] = [...builtin];
		const seen = new Set(out.map(skill => skill.name));
		for (const source of [
			{ root: agentsRoot, location: 'agents' as const, scope: 'project' as const },
			{ root: openideRoot, location: 'openide' as const, scope: 'project' as const },
			{ root: this.globalSkillsRoot, location: 'agents' as const, scope: 'global' as const },
			{ root: this.legacyGlobalSkillsRoot, location: 'openide' as const, scope: 'global' as const },
		]) {
			if (!source.root) {
				continue;
			}
			if (source.scope === 'project' && !workspaceTrusted) {
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
					if (seen.has(name)) {
						continue; // Earlier sources have priority; the portable .agents layout comes first.
					}
					seen.add(name);
					this.resolvedSkillFiles.set(name, file);
					this.resolvedSkillDirs.set(name, child.resource);
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

		for (const plugin of this.pluginService?.plugins.get() ?? []) {
			if (!isContributionEnabled(plugin.enablement.get())) {
				continue;
			}
			const scope = this.contextService.getWorkspaceFolder(plugin.uri) ? 'project' : 'global';
			if (scope === 'project' && !workspaceTrusted) {
				continue;
			}
			for (const skill of plugin.skills.get()) {
				const name = getCanonicalPluginCommandId(plugin, skill.name);
				if (!name || seen.has(name)) {
					continue;
				}
				seen.add(name);
				this.resolvedSkillFiles.set(name, skill.uri);
				this.readOnlySkillNames.add(name);
				const disabled = disabledSet.has(name);
				if (disabled && !includeDisabled) {
					continue;
				}
				out.push({
					name,
					description: (skill.description ?? '').slice(0, INDEX_DESC_CAP),
					disabled,
					location: 'plugin',
					scope,
					origin: `Plugin · ${plugin.label}`,
				});
				if (out.length >= INDEX_MAX_SKILLS && !includeDisabled) {
					return out;
				}
			}
		}
		return out;
	}

	/** Full content of a skill (for skill_view). Disabled ⇒ an error message (the only consumer is
	 *  the tool, which returns it verbatim to the model). */
	async readSkill(name: string): Promise<string | undefined> {
		if (name === 'openide-canvas') {
			return this.disabledSet().has(name) ? `Error: skill "${name}" is disabled.` : BUILTIN_CANVAS_SKILL;
		}
		let uri = this.resolvedSkillFiles.get(name);
		if (!uri) {
			await this.listSkills(true);
			uri = this.resolvedSkillFiles.get(name);
			if (!uri && (!this.workspaceTrust || this.workspaceTrust.isWorkspaceTrusted())) {
				uri = this.agentsSkillUri(name) ?? this.skillUri(name);
			}
		}
		if (!uri || (!NAME_RE.test(name) && !this.readOnlySkillNames.has(name))) {
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
		if (!this.resolvedSkillDirs.has(name) && !this.readOnlySkillNames.has(name)) {
			await this.listSkills(true);
		}
		if (this.readOnlySkillNames.has(name)) {
			return false;
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

	/** Creates or updates a portable Agent Skill (used by the MODEL via skill_save). */
	async saveSkill(name: string, description: string, content: string): Promise<string> {
		if (this.workspaceTrust && !this.workspaceTrust.isWorkspaceTrusted()) {
			return 'Error: project skills are disabled until this workspace is trusted.';
		}
		if (!NAME_RE.test(name)) {
			return `Error: invalid skill name "${name}" (kebab-case: a-z, 0-9 and hyphens; no -- and no hyphen at either end).`;
		}
		if (!description.trim()) {
			return 'Error: description is required (what it does + WHEN to use it, with keywords).';
		}
		if (!content.trim()) {
			return 'Error: content is empty.';
		}
		const root = this.agentsSkillsRoot();
		const uri = this.agentsSkillUri(name);
		if (!root || !uri) {
			return 'Error: no folder is open (skills live in .agents/skills inside the workspace).';
		}
		const existed = await this.fileService.exists(uri);
		const doc = `---\nname: ${name}\ndescription: ${description.trim().replace(/\n+/g, ' ')}\n---\n\n${content.trim()}\n`;
		await this.fileService.writeFile(uri, VSBuffer.fromString(doc));
		this.resolvedSkillFiles.set(name, uri);
		this.resolvedSkillDirs.set(name, joinPath(root, name));
		this.readOnlySkillNames.delete(name);
		return `OK: skill "${name}" ${existed ? 'updated' : 'created'} at .agents/skills/${name}/SKILL.md.`;
	}

	/** System prompt block: compact index + creation guide (progressive disclosure tier 1). */
	async buildPromptBlock(): Promise<string> {
		const skills = await this.listSkills();
		const guide = 'CREATION: when you solve a hard problem, discover a project convention or repeat a configuration/recipe, save it as a skill with skill_save (kebab-case name; description = what it does + WHEN to use it, with keywords). A skill is a reusable PROCEDURE — loose facts go to the memory tool. Prefer UPDATING an existing skill over creating a similar one. Do NOT capture: things you already know how to do, transient errors already fixed, rules overfitted to a single case.';
		if (!skills.length) {
			return '\n\nPROJECT SKILLS: none yet. ' + guide;
		}
		const index = skills.map(s => `- ${s.name}: ${s.description || '(no description)'}`).join('\n');
		return '\n\nPROJECT SKILLS (portable procedures in .agents/skills; legacy .openide/skills remains readable):\nBefore tackling the task, scan this list; if a skill applies, you MUST load it with skill_view before continuing.\n' + index + '\n' + guide;
	}
}
