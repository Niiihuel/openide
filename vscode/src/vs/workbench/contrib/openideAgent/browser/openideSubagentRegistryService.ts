/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — live registry of Markdown definitions. It scans a single level, gives precedence to
 *  the workspace and exposes immutable clones so a run keeps its snapshot.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { cloneSubagentDefinition, ISubagentDefinition, SubagentScope } from '../common/openideSubagentTypes.js';
import { ISubagentDefinitionService } from './openideSubagentDefinitionService.js';

const MARKER_OWNER = 'openide-subagents';

export const ISubagentRegistryService = createDecorator<ISubagentRegistryService>('openideSubagentRegistryService');

export interface ISubagentRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRegistry: Event<readonly ISubagentDefinition[]>;
	initialize(): Promise<void>;
	whenReady(): Promise<void>;
	reload(): Promise<void>;
	list(): readonly ISubagentDefinition[];
	get(nameOrId: string): ISubagentDefinition | undefined;
}

interface ISource { readonly root: URI; readonly scope: SubagentScope; readonly priority: number }

const BUILTIN_SUBAGENTS: readonly ISubagentDefinition[] = [
	{
		id: 'builtin:explore',
		name: 'explore',
		description: 'Explora en solo lectura un área autocontenida y devuelve evidencia compacta. Úsalo proactivamente para búsquedas voluminosas o un frente independiente.',
		model: 'default',
		profile: 'research',
		readonly: true,
		isBackground: true,
		tools: ['project_map_query', 'codebase_explore', 'codebase_search', 'codebase_callers', 'read_file', 'batch_read', 'list_files', 'find_files', 'search_text', 'get_diagnostics', 'memory_graph_impact', 'memory_graph_path', 'memory_graph_related_tests'],
		systemPrompt: 'Sos el especialista Explore incorporado de OpenIDE. Investigá únicamente el alcance delegado, sin editar ni ejecutar comandos. Priorizá el índice semántico y búsquedas dirigidas. Devolvé un resumen corto con hallazgos, evidencia ruta:línea, incertidumbres y el siguiente paso recomendado. No vuelques archivos completos.',
		resource: URI.parse('openide-builtin:/agents/explore.md'),
		scope: 'imported',
		version: 1,
	},
	{
		id: 'builtin:debugger',
		name: 'debugger',
		description: 'Especialista de diagnóstico en solo lectura. Aísla causa raíz desde síntomas, logs, diagnósticos y flujo de código; no implementa la corrección.',
		model: 'default',
		profile: 'debug',
		readonly: true,
		isBackground: false,
		tools: ['project_map_query', 'codebase_explore', 'codebase_search', 'codebase_callers', 'read_file', 'batch_read', 'list_files', 'find_files', 'search_text', 'get_diagnostics', 'memory_graph_impact', 'memory_graph_path', 'memory_graph_related_tests'],
		systemPrompt: 'Sos el especialista Debugger incorporado de OpenIDE. No edites. Separá síntomas de causas: reconstruí el flujo, contrastá al menos una hipótesis alternativa y devolvé causa raíz probable, evidencia ruta:línea, nivel de confianza, cambio mínimo sugerido y prueba de regresión. Si la evidencia no alcanza, decilo explícitamente.',
		resource: URI.parse('openide-builtin:/agents/debugger.md'),
		scope: 'imported',
		version: 1,
	},
	{
		id: 'builtin:code-reviewer',
		name: 'code-reviewer',
		description: 'Revisa un cambio acotado en solo lectura buscando defectos concretos, regresiones y validación faltante.',
		model: 'default',
		profile: 'review',
		readonly: true,
		isBackground: false,
		tools: ['read_file', 'batch_read', 'search_text', 'find_files', 'get_diagnostics', 'codebase_callers', 'memory_graph_impact', 'memory_graph_related_tests'],
		systemPrompt: 'Sos el especialista Code Reviewer incorporado de OpenIDE. Revisá sólo el alcance delegado. Priorizá bugs observables, seguridad, concurrencia, contratos rotos y tests faltantes; omití preferencias cosméticas. Cada hallazgo debe incluir severidad, evidencia ruta:línea y corrección concreta. Cerrá con VERDICT: PASS o VERDICT: BLOCK.',
		resource: URI.parse('openide-builtin:/agents/code-reviewer.md'),
		scope: 'imported',
		version: 1,
	},
];

export class SubagentRegistryService extends Disposable implements ISubagentRegistryService {
	declare readonly _serviceBrand: undefined;
	private definitions = new Map<string, ISubagentDefinition>(BUILTIN_SUBAGENTS.map(definition => [definition.name, cloneSubagentDefinition(definition)]));
	private readonly watches = new Map<string, IDisposable>();
	private reloadPromise: Promise<void> | undefined;
	private reloadDirty = false;
	private initialized = false;
	private readonly _onDidChangeRegistry = this._register(new Emitter<readonly ISubagentDefinition[]>());
	readonly onDidChangeRegistry = this._onDidChangeRegistry.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ISubagentDefinitionService private readonly definitionService: ISubagentDefinitionService,
	) {
		super();
		this._register(this.fileService.onDidFilesChange(event => {
			if (this.sources().some(source => event.affects(source.root))) { void this.reload(); }
		}));
	}

	private sources(): ISource[] {
		const sources: ISource[] = [
			{ root: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'agents'), scope: 'user', priority: 1 },
		];
		const folder = this.contextService.getWorkspace().folders[0];
		if (folder) {
			sources.push({ root: joinPath(folder.uri, '.cursor', 'agents'), scope: 'imported', priority: 0 });
			sources.push({ root: joinPath(folder.uri, '.openide', 'agents'), scope: 'workspace', priority: 2 });
		}
		return sources.sort((a, b) => a.priority - b.priority);
	}

	async initialize(): Promise<void> { await this.reload(); }
	async whenReady(): Promise<void> { if (this.reloadPromise) { await this.reloadPromise; } else if (!this.initialized) { await this.reload(); } }

	reload(): Promise<void> {
		if (this.reloadPromise) { this.reloadDirty = true; return this.reloadPromise; }
		this.reloadPromise = (async () => {
			do { this.reloadDirty = false; await this.doReload(); } while (this.reloadDirty);
			this.initialized = true;
		})().finally(() => { this.reloadPromise = undefined; });
		return this.reloadPromise;
	}

	private async doReload(): Promise<void> {
		// The built-in specialists make delegation work from the very first launch.
		// An imported, user or workspace definition with the same name replaces them.
		const next = new Map<string, ISubagentDefinition>(BUILTIN_SUBAGENTS.map(definition => [definition.name, cloneSubagentDefinition(definition)]));
		const seenResources = new Set<string>();
		for (const source of this.sources()) {
			const key = source.root.toString();
			if (!this.watches.has(key)) {
				try { this.watches.set(key, this.fileService.watch(source.root)); } catch { /* dir optional */ }
			}
			let children;
			try { children = (await this.fileService.resolve(source.root)).children ?? []; } catch { continue; }
			for (const child of children) {
				if (child.isDirectory || !child.name.toLowerCase().endsWith('.md')) { continue; }
				seenResources.add(child.resource.toString());
				try {
					const parsed = await this.definitionService.read(child.resource, source.scope);
					this.markerService.changeOne(MARKER_OWNER, child.resource, parsed.diagnostics.map(item => ({
						severity: item.severity === 'error' ? MarkerSeverity.Error : MarkerSeverity.Warning,
						message: item.message,
						startLineNumber: item.startLine,
						startColumn: item.startColumn,
						endLineNumber: item.endLine,
						endColumn: item.endColumn,
					})));
					if (parsed.definition) { next.set(parsed.definition.name, cloneSubagentDefinition(parsed.definition)); }
				} catch (error) {
					this.markerService.changeOne(MARKER_OWNER, child.resource, [{ severity: MarkerSeverity.Error, message: error instanceof Error ? error.message : String(error), startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }]);
				}
			}
		}
		for (const old of this.definitions.values()) {
			if (!seenResources.has(old.resource.toString())) { this.markerService.remove(MARKER_OWNER, [old.resource]); }
		}
		this.definitions = next;
		this._onDidChangeRegistry.fire(this.list());
	}

	list(): readonly ISubagentDefinition[] {
		return Object.freeze([...this.definitions.values()].map(cloneSubagentDefinition).sort((a, b) => a.name.localeCompare(b.name)));
	}

	get(nameOrId: string): ISubagentDefinition | undefined {
		const found = this.definitions.get(nameOrId) ?? [...this.definitions.values()].find(item => item.id === nameOrId);
		return found ? cloneSubagentDefinition(found) : undefined;
	}

	override dispose(): void {
		for (const watch of this.watches.values()) { watch.dispose(); }
		this.watches.clear();
		super.dispose();
	}
}
