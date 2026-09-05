/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — what each custom Settings surface offers, expressed as data.
 *
 *  The AI Agent pages are not config keys: they are files on disk, accounts and live state.
 *  Settings search looks at the configuration schema, so ALL of that was invisible — searching
 *  for "mcp", "skill" or "hook" did not find the page that manages them.
 *
 *  This module is the index of those surfaces. It is deliberately neutral: it imports NO UI, so
 *  navigation, search and the pages cannot drift apart (an architecture test enforces it).
 *  When adding a surface, add its entry here too.
 *--------------------------------------------------------------------------------------------*/

import { t } from '../../openideAgent/common/openideStrings.js';
import { IOpenideSettingsSearchEntry } from './openideSettingsSearch.js';

/**
 * A FUNCTION and not a const map: `title` and `description` are read through `t()`, so a module
 * level constant would freeze whatever `openide.language` was at import time. The caller rebuilds
 * it on every render, which is also when the language can have changed.
 *
 * `keywords` stay bilingual on purpose and are NOT translated: someone typing "provider" on a
 * Spanish UI, or "proveedor" on an English one, should still find the page. They are match fodder,
 * never displayed.
 */
export function openideSettingsSurfaceSearch(): ReadonlyMap<string, readonly IOpenideSettingsSearchEntry[]> {
	return new Map<string, readonly IOpenideSettingsSearchEntry[]>([
		['openideAgent/subagents', [
			{ title: t('settings.surface.subagents'), description: t('settings.surface.subagents.desc'), keywords: ['subagente', 'subagent', 'agente', 'agent', 'delegar', 'especialista', 'prompt'] },
		]],
		['openideAgent/import', [
			{ title: t('settings.nav.agent.import'), description: t('settings.import.desc'), keywords: ['importar', 'import', 'migrar', 'migrate', 'traer', 'vscode', 'vs code', 'cursor', 'windsurf', 'antigravity', 'claude', 'codex', 'opencode', 'gemini', 'settings', 'ajustes', 'keybindings', 'atajos', 'snippets', 'extensiones', 'extensions', 'mcp', 'reglas', 'rules'] },
		]],
		['openideAgent/projectMap', [
			{ title: t('settings.nav.agent.projectMap'), description: t('settings.surface.projectMap.desc'), keywords: ['project map', 'mapa', 'indice', 'índice', 'indexar', 'codebase', 'grafo', 'graph', 'simbolos', 'símbolos', 'imports', 'memoria', 'memory', 'notas', 'notes', 'MEMORY.md', 'contexto'] },
		]],
		['openideAgent/skills', [
			{ title: t('settings.nav.agent.skills'), description: t('settings.surface.skills.desc'), keywords: ['skill', 'skills', 'habilidad', 'instalar', 'install', 'md', 'frontmatter', 'marketplace'] },
		]],
		['openideAgent/rules', [
			{ title: t('settings.nav.agent.rules'), description: t('settings.surface.rules.desc'), keywords: ['regla', 'rules', 'instrucciones', 'AGENTS.md', 'CLAUDE.md', 'convenciones', 'memoria'] },
		]],
		['openideAgent/commands', [
			{ title: t('settings.nav.agent.commands'), description: t('settings.surface.commands.desc'), keywords: ['comando', 'command', 'slash', '/', 'prompt', 'atajo'] },
		]],
		['openideAgent/hooks', [
			{ title: t('settings.nav.agent.hooks'), description: t('settings.surface.hooks.desc'), keywords: ['hook', 'hooks', 'evento', 'event', 'pre', 'post', 'matcher', 'shell', 'automatizar'] },
		]],
		['openideAgent/quickCommands', [
			{ title: t('settings.nav.agent.quickCommands'), description: t('settings.surface.quickCommands.desc'), keywords: ['comando rapido', 'comando rápido', 'quick command', 'accion', 'acción', 'seleccion', 'selección', 'atajo'] },
		]],
		['openideAgent/providers', [
			{ title: t('settings.nav.agent.providers'), description: t('settings.surface.providers.desc'), keywords: ['proveedor', 'provider', 'modelo', 'model', 'api key', 'apikey', 'token', 'oauth', 'cuenta', 'account', 'login', 'iniciar sesion', 'iniciar sesión', 'anthropic', 'claude', 'openai', 'gpt', 'codex', 'suscripcion', 'suscripción'] },
		]],
		['openideAgent/mcp', [
			{ title: t('settings.nav.agent.mcp'), description: t('settings.surface.mcp.desc'), keywords: ['mcp', 'model context protocol', 'servidor', 'server', 'herramienta', 'tool', 'stdio', 'sse', 'http'] },
		]],
		['openideAgent/voice', [
			{ title: t('settings.nav.agent.voice'), description: t('settings.surface.voice.desc'), keywords: ['voz', 'voice', 'dictado', 'dictation', 'dictar', 'dictate', 'microfono', 'micrófono', 'microphone', 'mic', 'hablar', 'speech', 'transcripcion', 'transcripción', 'transcription', 'audio', 'whisper', 'stt'] },
		]],
		['workbench/language', [
			{ title: t('settings.nav.language'), description: t('settings.surface.language.desc'), keywords: ['idioma', 'language', 'locale', 'español', 'spanish', 'english', 'inglés', 'ingles', 'paquete de idioma', 'language pack', 'traduccion', 'traducción'] },
		]],
	]);
}
