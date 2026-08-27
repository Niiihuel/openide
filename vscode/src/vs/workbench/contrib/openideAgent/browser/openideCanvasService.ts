/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE Canvas — workspace storage, validation and TSX compilation. A canvas is one
 *  .openide/canvases/*.canvas.tsx file; no relative modules or network access are allowed.
 *--------------------------------------------------------------------------------------------*/

import type * as TypeScript from 'typescript';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

// The production workbench externalizes npm packages. TypeScript is loaded as a classic,
// same-origin script by workbench.html from the copy already shipped with the built-in
// extensions, which exposes its API through the global `ts` binding.
declare const ts: typeof TypeScript;

export interface IOpenideCanvasEvent { readonly path: string; readonly title: string; readonly created: boolean }
export interface IOpenideCanvasCompileResult { readonly code?: string; readonly errors: string[] }

export const IOpenideCanvasService = createDecorator<IOpenideCanvasService>('openideCanvasService');
export interface IOpenideCanvasService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCanvas: Event<IOpenideCanvasEvent>;
	resolve(path: string): URI | undefined;
	list(): Promise<string[]>;
	read(path: string): Promise<string>;
	write(name: string, source: string): Promise<{ path: string; created: boolean; diagnostics: string[] }>;
	compile(source: string): IOpenideCanvasCompileResult;
	stateUri(canvas: URI): URI;
	open(pathOrUri: string | URI): Promise<void>;
}

const CANVAS_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.canvas\.tsx$/;

export class OpenideCanvasService implements IOpenideCanvasService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeCanvas = new Emitter<IOpenideCanvasEvent>();
	readonly onDidChangeCanvas = this._onDidChangeCanvas.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) { }

	private root(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private dir(): URI | undefined { const root = this.root(); return root ? joinPath(root, '.openide', 'canvases') : undefined; }

	resolve(path: string): URI | undefined {
		const root = this.root();
		if (!root) { return undefined; }
		let uri: URI;
		try { uri = /^file:/i.test(path) ? URI.parse(path) : (path.startsWith('/') ? URI.file(path) : joinPath(root, path)); } catch { return undefined; }
		const rel = relativePath(root, uri);
		return rel && /^\.openide\/canvases\/[a-z0-9][a-z0-9-]*\.canvas\.tsx$/.test(rel.replace(/\\/g, '/')) ? uri : undefined;
	}

	async list(): Promise<string[]> {
		const dir = this.dir();
		if (!dir) { return []; }
		try {
			const entries = await this.fileService.resolve(dir);
			return (entries.children ?? []).filter(e => CANVAS_NAME.test(e.name)).map(e => `.openide/canvases/${e.name}`).sort();
		} catch { return []; }
	}

	async read(path: string): Promise<string> {
		const uri = this.resolve(path);
		if (!uri) { throw new Error('La ruta debe estar dentro de .openide/canvases y terminar en .canvas.tsx.'); }
		return (await this.fileService.readFile(uri)).value.toString();
	}

	async write(name: string, source: string): Promise<{ path: string; created: boolean; diagnostics: string[] }> {
		let file = name.trim().toLowerCase().replace(/\.canvas\.tsx$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		file += '.canvas.tsx';
		if (!CANVAS_NAME.test(file)) { throw new Error('Nombre inválido: usá kebab-case.'); }
		const dir = this.dir();
		if (!dir) { throw new Error('No hay una carpeta de workspace abierta.'); }
		const result = this.compile(source);
		if (result.errors.length) { throw new Error(result.errors.join('\n')); }
		const uri = joinPath(dir, file);
		let created = true;
		try { await this.fileService.stat(uri); created = false; } catch { /* nuevo */ }
		await this.fileService.writeFile(uri, VSBuffer.fromString(source));
		const path = `.openide/canvases/${file}`;
		this._onDidChangeCanvas.fire({ path, title: file.replace(/\.canvas\.tsx$/, '').replace(/-/g, ' '), created });
		return { path, created, diagnostics: result.errors };
	}

	compile(source: string): IOpenideCanvasCompileResult {
		const errors: string[] = [];
		const imports = [...source.matchAll(/import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g)];
		for (const match of imports) { if (match[1] !== 'openide/canvas') { errors.push(`Import no permitido: ${match[1]}. Usá solamente openide/canvas.`); } }
		if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(source) || /\bimport\s*\(/.test(source)) { errors.push('Canvas no permite red ni imports dinámicos.'); }
		const defaults = source.match(/\bexport\s+default\b/g)?.length ?? 0;
		if (defaults !== 1) { errors.push(`El canvas debe tener exactamente un default export (encontrados: ${defaults}).`); }
		if (!imports.length && /\bfrom\s+['"]/.test(source)) { errors.push('No se pudo validar un import del canvas.'); }
		if (errors.length) { return { errors }; }

		const names: string[] = [];
		for (const match of imports) {
			const clause = match[0].match(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from/);
			if (clause) {
				for (const part of clause[1].split(',')) {
					const value = part.trim().replace(/^type\s+/, '');
					if (!value) { continue; }
					const bits = value.split(/\s+as\s+/);
					if (bits[1] || !/^[A-Za-z_$][\w$]*$/.test(bits[0])) { names.push(bits[1] ?? bits[0]); } else { names.push(bits[0]); }
				}
			}
		}
		const withoutImports = source.replace(/import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]openide\/canvas['"]\s*;?/g, '');
		const result = ts.transpileModule(withoutImports, {
			compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'OpenideCanvas.h', jsxFragmentFactory: 'OpenideCanvas.Fragment', isolatedModules: true },
			reportDiagnostics: true,
			fileName: 'canvas.tsx',
		});
		for (const d of result.diagnostics ?? []) {
			const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
			const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
			errors.push(`${pos ? `L${pos.line + 1}:${pos.character + 1} ` : ''}${message}`);
		}
		if (errors.length) { return { errors }; }
		const prelude = `const { ${[...new Set(names)].join(', ')} } = OpenideCanvas;\nconst exports = {};\n`;
		return { code: `${prelude}${result.outputText}\nOpenideCanvas.mount(exports.default);`, errors };
	}

	stateUri(canvas: URI): URI { return canvas.with({ path: canvas.path.replace(/\.canvas\.tsx$/, '.canvas.data.json') }); }
	async open(pathOrUri: string | URI): Promise<void> {
		const uri = pathOrUri instanceof URI ? pathOrUri : this.resolve(pathOrUri);
		if (!uri) { throw new Error('Canvas inválido o fuera del workspace.'); }
		await this.commandService.executeCommand('openide.canvas.open', uri);
	}
}
