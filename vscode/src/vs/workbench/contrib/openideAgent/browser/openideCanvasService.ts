/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *  OpenIDE Canvas — workspace storage, validation and TSX compilation. A canvas is one
 *  .openide/canvases/*.canvas.tsx file; no relative modules or network access are allowed.
 *--------------------------------------------------------------------------------------------*/
import { parseDesignObj, parseDesignSystem, exportDesignObj } from '../common/openideDesignAdvanced.js';
import { exportDesignSvg, validateDesignSvg } from '../common/openideDesignSvg.js';
import { basename } from '../../../../base/common/resources.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type * as TypeScript from 'typescript';
import { generateUuid } from '../../../../base/common/uuid.js';
import { DesignFile, DesignOperation, DesignTemplate, DesignDocument, newDesign, validateDesign, changeDesign, designHandoff } from '../common/openideDesign.js';
import { getOpenideDesignHtml } from './openideDesignHtml.js';
import { VSBuffer, encodeBase64 } from '../../../../base/common/buffer.js';
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
export interface IOpenideCanvasEvent {
	readonly path: string;
	readonly title: string;
	readonly created: boolean;
}
export interface IOpenideCanvasCompileResult {
	readonly code?: string;
	readonly errors: string[];
}
export const IOpenideCanvasService = createDecorator<IOpenideCanvasService>('openideCanvasService');
export interface IOpenideCanvasService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCanvas: Event<IOpenideCanvasEvent>;
	previewDesign(path: string, targetWindowId?: number): Promise<string>;
	resolve(path: string): URI | undefined;
	list(): Promise<string[]>;
	read(path: string): Promise<string>;
	write(name: string, source: string): Promise<{
		path: string;
		created: boolean;
		diagnostics: string[];
	}>;
	createDesign(template: DesignTemplate, title: string, device?: DesignDocument['device']): Promise<{
		path: string;
		revision: number;
	}>;
	readDesign(path: string): Promise<DesignFile>;
	patchDesign(path: string, expectedRevision: number, operations: DesignOperation[] | 'undo' | 'redo'): Promise<DesignFile>;
	designAssets(path: string): Promise<Record<string, string>>;
	designHtml(path: string, pages?: boolean, nonce?: string): Promise<string>;
	importDesign(path: string, expectedRevision: number, sourcePath: string, kind: 'image' | 'tokens' | 'obj', screenId?: string, selectedFile?: boolean): Promise<DesignFile>;
	exportDesign(path: string, format?: 'html' | 'pdf' | 'pptx' | 'svg' | 'obj'): Promise<{
		path: string;
		revision: number;
	}>;
	handoffDesign(path: string): Promise<{
		path: string;
		markdown: string;
		revision: number;
	}>;
	compile(source: string): IOpenideCanvasCompileResult;
	stateUri(canvas: URI): URI;
	open(pathOrUri: string | URI, targetWindowId?: number): Promise<void>;
}
const CANVAS_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.canvas\.tsx$/;
export class OpenideCanvasService extends Disposable implements IOpenideCanvasService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidChangeCanvas = this._register(new Emitter<IOpenideCanvasEvent>());
	readonly onDidChangeCanvas = this._onDidChangeCanvas.event;
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
	) { super(); }
	private encodeDesign(file: DesignFile): VSBuffer {
		const buffer = VSBuffer.fromString(JSON.stringify(file, null, 2) + '\n');
		if (buffer.byteLength > 2_000_000) { throw new Error('Design and undo history exceed the 2 MB storage limit.'); }
		return buffer;
	}
	private root(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private readonly designWrites = new Map<string, Promise<unknown>>();
	private dir(): URI | undefined { const root = this.root(); return root ? joinPath(root, '.openide', 'canvases') : undefined; }
	resolve(path: string): URI | undefined {
		const root = this.root();
		if (!root) {
			return undefined;
		}
		let uri: URI;
		try {
			uri = /^file:/i.test(path) ? URI.parse(path) : (path.startsWith('/') ? URI.file(path) : joinPath(root, path));
		}
		catch {
			return undefined;
		}
		const rel = relativePath(root, uri);
		return rel && /^\.openide\/(?:canvases\/[a-z0-9][a-z0-9-]*\.canvas\.tsx|designs\/[a-z0-9][a-z0-9-]*\/design\.json)$/.test(rel.replace(/\\/g, '/')) ? uri : undefined;
	}
	async list(): Promise<string[]> {
		const root = this.root();
		if (!root) {
			return [];
		}
		const items: string[] = [];
		try {
			const dir = await this.fileService.resolve(joinPath(root, '.openide', 'canvases'));
			items.push(...(dir.children ?? []).filter(e => CANVAS_NAME.test(e.name)).map(e => `.openide/canvases/${e.name}`));
		}
		catch { }
		try {
			const dir = await this.fileService.resolve(joinPath(root, '.openide', 'designs'));
			for (const entry of dir.children ?? []) {
				if (entry.isDirectory && await this.fileService.exists(joinPath(entry.resource, 'design.json')))
					items.push(`.openide/designs/${entry.name}/design.json`);
			}
		}
		catch { }
		return items.sort();
	}
	async createDesign(template: DesignTemplate, title: string, device?: DesignDocument['device']): Promise<{
		path: string;
		revision: number;
	}> {
		const root = this.root();
		if (!root)
			throw new Error('Open a workspace before creating a Canvas.');
		if (typeof title !== 'string' || !title.trim())
			throw new Error('A design needs a title.');
		const file = newDesign(template, title.trim(), device);
		const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design'}-${generateUuid().slice(0, 8)}`;
		const path = `.openide/designs/${id}/design.json`;
		const uri = joinPath(root, path);
		await this.fileService.createFolder(joinPath(root, '.openide', 'designs', id));
		await this.fileService.writeFile(uri, this.encodeDesign(file), { atomic: { postfix: '.design-write' } });
		await this.fileService.writeFile(joinPath(uri, '..', 'DESIGN.md'), VSBuffer.fromString(designHandoff(file)));
		this._onDidChangeCanvas.fire({ path, title, created: true });
		return { path, revision: file.revision };
	}
	async readDesign(path: string): Promise<DesignFile> {
		const uri = this.resolve(path);
		if (!uri || !uri.path.endsWith('/design.json'))
			throw new Error('Expected a design inside .openide/designs.');
		const source = await this.fileService.readFile(uri, { limits: { size: 2000000 } });
		return validateDesign(JSON.parse(source.value.toString()));
	}
	async patchDesign(path: string, expectedRevision: number, operations: DesignOperation[] | 'undo' | 'redo'): Promise<DesignFile> {
		const uri = this.resolve(path);
		if (!uri || !uri.path.endsWith('/design.json'))
			throw new Error('Invalid design path.');
		const key = uri.toString();
		const previous = this.designWrites.get(key) ?? Promise.resolve();
		const operation = previous.catch(() => { }).then(async () => {
			if (this.resolve(path)?.toString() !== key)
				throw new Error('Workspace changed.');
			const source = await this.fileService.readFile(uri, { limits: { size: 2000000 } });
			const next = changeDesign(validateDesign(JSON.parse(source.value.toString())), expectedRevision, operations);
			await this.fileService.writeFile(uri, this.encodeDesign(next), { etag: source.etag, mtime: source.mtime, atomic: { postfix: '.design-write' } });
			this._onDidChangeCanvas.fire({ path, title: next.document.title, created: false });
			return next;
		});
		this.designWrites.set(key, operation);
		try {
			return await operation;
		}
		finally {
			if (this.designWrites.get(key) === operation)
				this.designWrites.delete(key);
		}
	}
	async previewDesign(path: string, targetWindowId?: number): Promise<string> {
		const uri = this.resolve(path); if (!uri || !uri.path.endsWith('/design.json')) { throw new Error('Expected a structured design.'); }
		const capture = await this.commandService.executeCommand<string>('openide.canvas.preview', uri, targetWindowId);
		if (!capture) { throw new Error('Canvas preview is unavailable.'); }
		return capture;
	}
	private async assertLocalAsset(uri: URI): Promise<void> {
		const root = this.root();
		const [actualRoot, actual] = await Promise.all([root ? this.fileService.realpath(root) : undefined, this.fileService.realpath(uri)]);
		const relative = actualRoot && actual ? relativePath(actualRoot, actual) : undefined;
		if (!relative || relative.startsWith('..')) { throw new Error('Canvas assets must resolve inside the workspace.'); }
	}

	private async assetData(file: DesignFile, uri: URI): Promise<Record<string,string>> {
		const assets: Record<string,string> = {};
		for(const asset of file.document.assets??[]){const assetUri=joinPath(uri,'..',asset.path);await this.assertLocalAsset(assetUri);const content=await this.fileService.readFile(assetUri,{limits:{size:5_000_000}});if(content.value.byteLength!==asset.bytes){throw new Error(`Asset changed: ${asset.name}. Import it again.`);}if(asset.mime==='image/svg+xml'){validateDesignSvg(content.value.toString());}assets[asset.id]=`data:${asset.mime};base64,${encodeBase64(content.value)}`;}
		return assets;
	}
	async designAssets(path: string): Promise<Record<string,string>> { const uri = this.resolve(path); if(!uri){throw new Error('Invalid design.');} return this.assetData(await this.readDesign(path), uri); }
	async designHtml(path: string, pages = false, nonce = generateUuid().replace(/-/g, '')): Promise<string> {
		const uri=this.resolve(path);if(!uri){throw new Error('Invalid Canvas path.');}const file=await this.readDesign(path);return getOpenideDesignHtml(nonce,{...file,past:[],future:[]},pages,await this.assetData(file,uri),pages);
	}
	async importDesign(path: string, expectedRevision: number, sourcePath: string, kind: 'image' | 'tokens' | 'obj', screenId?: string, selectedFile = false): Promise<DesignFile> {
		const uri=this.resolve(path);const root=this.root();if(!uri||!root){throw new Error('Invalid design.');}const source=/^file:/i.test(sourcePath)?URI.parse(sourcePath):sourcePath.startsWith('/')?URI.file(sourcePath):joinPath(root,sourcePath);
		const relative=relativePath(root,source);if(source.scheme!=='file'||(!selectedFile&&(!relative||relative.startsWith('..')))){throw new Error('CLI imports must read files inside the workspace. Choose a file in the IDE to import from elsewhere.');}
		if(!selectedFile){const [realRoot,realSource]=await Promise.all([this.fileService.realpath(root),this.fileService.realpath(source)]);const actual=realRoot&&realSource?relativePath(realRoot,realSource):undefined;if(!actual||actual.startsWith('..')){throw new Error('CLI imports must resolve inside the workspace.');}}
		const file=await this.readDesign(path);if(file.revision!==expectedRevision){throw new Error('Design changed. Inspect its current revision before importing.');}const target=screenId??file.document.screens[0].id;
		const bytes=(await this.fileService.readFile(source,{limits:{size:5_000_000}})).value;
		if(kind==='tokens'){const system=parseDesignSystem(bytes.toString(),basename(source));system.source=basename(source);return this.patchDesign(path,expectedRevision,[{type:'setSystem',designSystem:system}]);}
		const id='asset-'+generateUuid().slice(0,8);
		if(kind==='obj'){return this.patchDesign(path,expectedRevision,[{type:'addNode',screenId:target,node:{id,kind:'model',text:basename(source),children:[],token:'accent',spacing:0,size:16,object3d:parseDesignObj(bytes.toString())}}]);}
		if(kind!=='image'){throw new Error('Unknown import kind.');}
		let mime:'image/png'|'image/jpeg'|'image/svg+xml';let ext:string;
		if(bytes.buffer[0]===137&&bytes.buffer[1]===80&&bytes.buffer[2]===78&&bytes.buffer[3]===71){mime='image/png';ext='png';if(bytes.byteLength<33||bytes.buffer[4]!==13||bytes.buffer[5]!==10||bytes.buffer[6]!==26||bytes.buffer[7]!==10||bytes.readUInt32BE(12)!==0x49484452||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16_000_000){throw new Error('PNG exceeds the 16 megapixel decode budget.');}}
		else if(bytes.buffer[0]===255&&bytes.buffer[1]===216){mime='image/jpeg';ext='jpg';let found=false;for(let i=2;i+8<bytes.byteLength;){if(bytes.buffer[i]!==255){i++;continue;}const marker=bytes.buffer[i+1];if([192,193,194].includes(marker)){const h=(bytes.buffer[i+5]<<8)|bytes.buffer[i+6],w=(bytes.buffer[i+7]<<8)|bytes.buffer[i+8];if(!w||!h||w*h>16_000_000){throw new Error('JPEG exceeds the 16 megapixel decode budget.');}found=true;break;}const length=(bytes.buffer[i+2]<<8)|bytes.buffer[i+3];if(length<2){break;}i+=2+length;}if(!found){throw new Error('Unsupported or malformed JPEG.');}}
		else{validateDesignSvg(bytes.toString());mime='image/svg+xml';ext='svg';}
		if(mime!=='image/svg+xml'&&typeof createImageBitmap==='function'){let decoded:ImageBitmap;try{decoded=await createImageBitmap(new Blob([Uint8Array.from(bytes.buffer)],{type:mime}));}catch{throw new Error('Image data cannot be decoded.');}const pixels=decoded.width*decoded.height;decoded.close();if(!pixels||pixels>16_000_000){throw new Error('Image exceeds the 16 megapixel decode budget.');}}
		const asset={id,name:basename(source),path:`assets/${id}.${ext}`,mime,bytes:bytes.byteLength};const output=joinPath(uri,'..',asset.path);
		await this.fileService.createFolder(joinPath(output,'..'));
		await this.assertLocalAsset(joinPath(output,'..'));
		await this.fileService.writeFile(output,bytes);
		try{return await this.patchDesign(path,expectedRevision,[{type:'addAsset',asset},{type:'addNode',screenId:target,node:{id:'image-'+generateUuid().slice(0,8),kind:'image',text:asset.name,children:[],token:'text',spacing:0,size:16,assetId:id,frame:['whiteboard','animation'].includes(file.document.template)?{x:80,y:80,width:320,height:240,rotation:0}:undefined}}]);}catch(error){await this.fileService.del(output).catch(()=>{});throw error;}
	}
	async exportDesign(path: string, format: 'html' | 'pdf' | 'pptx' | 'svg' | 'obj' = 'html'): Promise<{path:string;revision:number}> {
		if(!['html','pdf','pptx','svg','obj'].includes(format)){throw new Error('Unsupported export format.');}
		const uri=this.resolve(path);if(!uri){throw new Error('Invalid design path.');}const file=await this.readDesign(path);const output=joinPath(uri,'..',`export-r${file.revision}.${format}`);const assets=await this.assetData(file,uri);
		let buffer: VSBuffer;
		if(format==='svg'){buffer=VSBuffer.fromString(exportDesignSvg(file.document,assets));}
		else if(format==='obj'){buffer=VSBuffer.fromString(exportDesignObj(file.document));}
		else{const html=getOpenideDesignHtml(generateUuid().replace(/-/g,''),{...file,past:[],future:[]},true,assets,format!=='html');if(format==='html'){buffer=VSBuffer.fromString(html);}else{const result=await this.commandService.executeCommand<VSBuffer>('openide.canvas.exportDocument',{html,format,title:file.document.title});if(!result){throw new Error('Native document export is unavailable.');}buffer=result;}}
		if((await this.readDesign(path)).revision!==file.revision){throw new Error('Design changed during export. Retry with the current revision.');}
		await this.fileService.writeFile(output,buffer);return {path:output.fsPath,revision:file.revision};
	}

	async handoffDesign(path: string): Promise<{
		path: string;
		markdown: string;
		revision: number;
	}> {
		const uri = this.resolve(path);
		if (!uri)
			throw new Error('Invalid design path.');
		const file = await this.readDesign(path);
		let intent = '';
		try {
			intent = (await this.fileService.readFile(joinPath(uri, '..', 'DESIGN.md'), { limits: { size: 100000 } })).value.toString();
		}
		catch { /* Optional user-maintained brief. */ }
		const output = joinPath(uri, '..', `HANDOFF-r${file.revision}.md`);
		const markdown = `Design source: ${path}\n\n${designHandoff(file)}${intent ? '\n\n## Original design brief\n\n' + intent : ''}`;
		await this.fileService.writeFile(output, VSBuffer.fromString(markdown));
		return { path: output.fsPath, markdown, revision: file.revision };
	}
	async read(path: string): Promise<string> {
		const uri = this.resolve(path);
		if (!uri) {
			throw new Error('The path must be inside .openide/canvases and end in .canvas.tsx.');
		}
		return (await this.fileService.readFile(uri)).value.toString();
	}
	async write(name: string, source: string): Promise<{
		path: string;
		created: boolean;
		diagnostics: string[];
	}> {
		let file = name.trim().toLowerCase().replace(/\.canvas\.tsx$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		file += '.canvas.tsx';
		if (!CANVAS_NAME.test(file)) {
			throw new Error('Invalid name: use kebab-case.');
		}
		const dir = this.dir();
		if (!dir) {
			throw new Error('No workspace folder is open.');
		}
		const result = this.compile(source);
		if (result.errors.length) {
			throw new Error(result.errors.join('\n'));
		}
		const uri = joinPath(dir, file);
		let created = true;
		try {
			await this.fileService.stat(uri);
			created = false;
		}
		catch { /* nuevo */ }
		await this.fileService.writeFile(uri, VSBuffer.fromString(source));
		const path = `.openide/canvases/${file}`;
		this._onDidChangeCanvas.fire({ path, title: file.replace(/\.canvas\.tsx$/, '').replace(/-/g, ' '), created });
		return { path, created, diagnostics: result.errors };
	}
	compile(source: string): IOpenideCanvasCompileResult {
		const errors: string[] = [];
		const sdk = new Set('Stack Row Grid Spacer Divider H1 H2 H3 Text Card CardHeader CardBody Button Link Pill Stat Callout Code Table mergeStyle BarChart LineChart PieChart useHostTheme useCanvasState useCanvasAction TextInput Select Checkbox Toggle CollapsibleSection UsageBar DiffStats DiffView TodoList TodoListCard Wireframe WireframeBox WireframeLine WireframeText Choice PromptButton'.split(' '));
		const file = ts.createSourceFile('canvas.tsx', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
		const names: string[] = [];
		const edits: {
			start: number;
			end: number;
		}[] = [];
		let defaults = 0;
		for (const statement of file.statements) {
			if (ts.isImportDeclaration(statement)) {
				const clause = statement.importClause;
				if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'openide/canvas' || !clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
					errors.push('Use named imports only from openide/canvas.');
					continue;
				}
				for (const entry of clause.namedBindings.elements) {
					const imported = (entry.propertyName ?? entry.name).text;
					if (!sdk.has(imported)) {
						errors.push(`Unknown Canvas export: ${imported}.`);
					}
					if (!clause.isTypeOnly && !entry.isTypeOnly) {
						names.push(imported === entry.name.text ? imported : `${imported}: ${entry.name.text}`);
					}
				}
				edits.push({ start: statement.getFullStart(), end: statement.end });
			}
			if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
				defaults++;
			}
			else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
				defaults++;
			}
			if (ts.isExportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
				errors.push('Module re-exports and require imports are not supported.');
			}
		}
		const visit = (node: TypeScript.Node): void => {
			if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(node.expression.text)))) {
				errors.push('Canvas allows neither network nor dynamic imports.');
			}
			ts.forEachChild(node, visit);
		};
		visit(file);
		if (defaults !== 1) {
			errors.push(`The canvas must have exactly one default export (found: ${defaults}).`);
		}
		if (errors.length) {
			return { errors };
		}
		let withoutImports = source;
		for (const edit of edits.reverse()) {
			withoutImports = withoutImports.slice(0, edit.start) + '\n'.repeat((withoutImports.slice(edit.start, edit.end).match(/\n/g) ?? []).length) + withoutImports.slice(edit.end);
		}
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
		if (errors.length) {
			return { errors };
		}
		const prelude = `const { ${[...new Set(names)].join(', ')} } = OpenideCanvas;\nconst exports = {};\n`;
		return { code: `${prelude}${result.outputText}\nOpenideCanvas.mount(exports.default);`, errors };
	}
	stateUri(canvas: URI): URI { return canvas.with({ path: canvas.path.replace(/\.canvas\.tsx$/, '.canvas.data.json') }); }
	async open(pathOrUri: string | URI, targetWindowId?: number): Promise<void> {
		const uri = pathOrUri instanceof URI ? pathOrUri : this.resolve(pathOrUri);
		if (!uri) {
			throw new Error('Invalid canvas, or outside the workspace.');
		}
		await this.commandService.executeCommand('openide.canvas.open', uri, targetWindowId);
	}
}
