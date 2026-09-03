/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pure parser/serializer for the .openide/agents/*.md format. The accepted dialect is
 *  deliberadamente acotado: scalars, booleans y arrays de strings. No ejecuta tags YAML.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IParsedSubagentDefinition, ISubagentDefinition, ISubagentDefinitionDiagnostic, SubagentScope } from './openideSubagentTypes.js';

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const KNOWN_KEYS = new Set(['name', 'model', 'profile', 'description', 'readonly', 'is_background', 'background', 'tools']);

interface IRawFrontmatter {
	name?: unknown;
	model?: unknown;
	profile?: unknown;
	description?: unknown;
	readonly?: unknown;
	is_background?: unknown;
	background?: unknown;
	tools?: unknown;
}

function scalar(value: string): string | boolean {
	const trimmed = value.trim();
	if (trimmed === 'true') { return true; }
	if (trimmed === 'false') { return false; }
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) { return trimmed.slice(1, -1).replace(/''/g, "'"); }
	return trimmed;
}

function diagnostic(message: string, line: number, severity: 'error' | 'warning' = 'error'): ISubagentDefinitionDiagnostic {
	return { severity, message, startLine: line, startColumn: 1, endLine: line, endColumn: Number.MAX_SAFE_INTEGER };
}

function parseFrontmatter(lines: readonly string[], diagnostics: ISubagentDefinitionDiagnostic[]): IRawFrontmatter {
	const raw: IRawFrontmatter = {};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line.trim() || line.trimStart().startsWith('#')) { continue; }
		const match = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
		if (!match) { diagnostics.push(diagnostic('Sintaxis de frontmatter inválida.', index + 2)); continue; }
		const key = match[1];
		if (!KNOWN_KEYS.has(key)) { diagnostics.push(diagnostic(`Propiedad desconocida: ${key}.`, index + 2, 'warning')); continue; }
		let value: unknown = scalar(match[2] ?? '');
		if (key === 'tools') {
			const tools: string[] = [];
			const rawToolsValue = String(match[2] ?? '').trim();
			if (rawToolsValue && !rawToolsValue.startsWith('[')) { diagnostics.push(diagnostic('tools debe ser una lista YAML o un array inline.', index + 2)); }
			if (rawToolsValue.startsWith('[')) {
				const inline = String(match[2]).trim();
				if (!inline.endsWith(']')) { diagnostics.push(diagnostic('Array inline de tools sin cierre ].', index + 2)); }
				else { tools.push(...inline.slice(1, -1).split(',').map(part => String(scalar(part))).filter(Boolean)); }
			} else {
				while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
					index++;
					tools.push(String(scalar(lines[index].replace(/^\s+-\s+/, ''))).trim());
				}
			}
			value = tools;
		}
		(raw as Record<string, unknown>)[key] = value;
	}
	return raw;
}

export function parseSubagentDefinition(content: string, resource: URI, scope: SubagentScope, version: number): IParsedSubagentDefinition {
	const diagnostics: ISubagentDefinitionDiagnostic[] = [];
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return { diagnostics: [diagnostic('La definición debe comenzar con frontmatter --- .', 1)], frontmatterStart: 0, frontmatterEnd: 0 };
	}
	const delimiter = /^---\s*$/gm;
	delimiter.lastIndex = 4;
	const closing = delimiter.exec(normalized);
	const end = closing?.index ?? -1;
	if (end < 0) {
		return { diagnostics: [diagnostic('El frontmatter no tiene cierre --- .', 1)], frontmatterStart: 0, frontmatterEnd: 0 };
	}
	const closeEnd = normalized.indexOf('\n', end);
	const promptStart = closeEnd < 0 ? normalized.length : closeEnd + 1;
	const raw = parseFrontmatter(normalized.slice(4, end).split('\n'), diagnostics);
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	const description = typeof raw.description === 'string' ? raw.description.trim() : '';
	const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'default';
	const profileValues = ['planning', 'debug', 'implementation', 'review', 'simple-fix', 'research', 'general'] as const;
	const profile = typeof raw.profile === 'string' && profileValues.includes(raw.profile.trim() as typeof profileValues[number]) ? raw.profile.trim() as typeof profileValues[number] : undefined;
	if (raw.profile !== undefined && !profile) { diagnostics.push(diagnostic('profile debe ser planning, debug, implementation, review, simple-fix, research o general.', 2)); }
	const readonly = typeof raw.readonly === 'boolean' ? raw.readonly : true;
	const backgroundValue = raw.is_background ?? raw.background;
	const isBackground = typeof backgroundValue === 'boolean' ? backgroundValue : false;
	const tools = Array.isArray(raw.tools) ? [...new Set(raw.tools.map(String).map(tool => tool.trim()).filter(Boolean))] : [];
	if (!name) { diagnostics.push(diagnostic('La propiedad name es obligatoria.', 2)); }
	else if (!NAME_RE.test(name)) { diagnostics.push(diagnostic('name debe usar kebab-case, 1–64 caracteres.', 2)); }
	if (!description) { diagnostics.push(diagnostic('La propiedad description es obligatoria.', 2)); }
	if (raw.readonly !== undefined && typeof raw.readonly !== 'boolean') { diagnostics.push(diagnostic('readonly debe ser boolean.', 2)); }
	if (backgroundValue !== undefined && typeof backgroundValue !== 'boolean') { diagnostics.push(diagnostic('is_background debe ser boolean.', 2)); }
	if (raw.background !== undefined) { diagnostics.push(diagnostic('background es un alias de compatibilidad; al guardar se usa is_background.', 2, 'warning')); }
	if (diagnostics.some(item => item.severity === 'error')) {
		return { diagnostics, frontmatterStart: 0, frontmatterEnd: promptStart };
	}
	const definition: ISubagentDefinition = {
		id: `${scope}:${name}`,
		name,
		description,
		model,
		profile,
		readonly,
		isBackground,
		tools,
		systemPrompt: normalized.slice(promptStart),
		resource,
		scope,
		version,
	};
	return { definition, diagnostics, frontmatterStart: 0, frontmatterEnd: promptStart };
}

function quote(value: string): string {
	return /^(?:true|false|null|~)$/i.test(value) || /[:#\[\]{},&*!|>'"%@`\n]/.test(value) || value !== value.trim() ? JSON.stringify(value) : value;
}

export function serializeSubagentDefinition(definition: Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>): string {
	const lines = [
		'---',
		`name: ${quote(definition.name)}`,
		`model: ${quote(definition.model || 'default')}`,
		...(definition.profile ? [`profile: ${definition.profile}`] : []),
		`description: ${quote(definition.description)}`,
		`readonly: ${definition.readonly}`,
		`is_background: ${definition.isBackground}`,
		'tools:',
		...definition.tools.map(tool => `  - ${quote(tool)}`),
		'---',
	];
	return lines.join('\n') + '\n' + definition.systemPrompt;
}

export function updateSubagentDefinition(content: string, resource: URI, scope: SubagentScope, version: number, patch: Partial<Pick<ISubagentDefinition, 'name' | 'model' | 'profile' | 'description' | 'readonly' | 'isBackground' | 'tools' | 'systemPrompt'>>): string {
	const parsed = parseSubagentDefinition(content, resource, scope, version);
	if (!parsed.definition) { throw new Error(parsed.diagnostics.map(item => item.message).join(' ')); }
	return serializeSubagentDefinition({ ...parsed.definition, ...patch });
}
