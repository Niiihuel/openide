/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as typescript from 'typescript';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../../../platform/files/node/diskFileSystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService, Workspace, WorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { OpenideCanvasService } from '../../browser/openideCanvasService.js';

suite('OpenIDE Canvas persistence and compiler', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let files: FileService;
	let service: OpenideCanvasService;
	let opened: unknown[];
	let project: string;
	setup(async () => {
		project = await mkdtemp(join(tmpdir(), 'canvas-service-test-'));
		(globalThis as unknown as { ts: typeof typescript }).ts = typescript;
		files = disposables.add(new FileService(new NullLogService()));
		disposables.add(files.registerProvider('file', disposables.add(new DiskFileSystemProvider(new NullLogService()))));
		opened = [];
		service = disposables.add(new OpenideCanvasService(files, upcastPartial<IWorkspaceContextService>({ getWorkspace: () => new Workspace('canvas-test', [new WorkspaceFolder({ uri: URI.file(project), name: 'canvas-test', index: 0 })], false, null, () => false) }), upcastPartial<ICommandService>({ executeCommand: async (...args) => { opened.push(args); return undefined as never; } })));
	});
	teardown(async () => { await rm(project, { recursive: true, force: true }); delete (globalThis as unknown as { ts?: typeof typescript }).ts; });
	test('creation, reopen, export and Markdown handoff share the persisted revision', async () => {
		const created = await service.createDesign('mobile', 'Checkout');
		await service.open(created.path);
		assert.equal(opened.length, 1);
		const next = await service.patchDesign(created.path, 1, [{ type: 'setNode', id: 'heading', text: 'Pay now' }]);
		assert.equal((await service.readDesign(created.path)).revision, next.revision);
		const exported = await service.exportDesign(created.path);
		const html = (await files.readFile(URI.file(exported.path))).value.toString();
		assert(html.includes('Pay now'));
		assert(html.includes('"standalone":true'));
		const brief = URI.joinPath(service.resolve(created.path)!, '..', 'DESIGN.md');
		await files.writeFile(brief, VSBuffer.fromString('Use our existing checkout component.'));
		const handoff = await service.handoffDesign(created.path);
		assert(handoff.markdown.includes('Use our existing checkout component.'));
		assert(handoff.markdown.includes('Design revision: 2'));
		assert.deepEqual(await service.list(), [created.path]);
	});
	test('concurrent agents cannot overwrite one another with the same revision', async () => {
		const created = await service.createDesign('wireframe', 'Concurrent');
		const results = await Promise.allSettled(['First', 'Second'].map(text => service.patchDesign(created.path, 1, [{ type: 'setNode', id: 'heading', text }])));
		assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
		assert.equal((await service.readDesign(created.path)).revision, 2);
		assert.equal((await service.readDesign(created.path)).document.screens[0].nodes[0].text, 'First');
	});
	test('invalid edits leave the file unchanged and do not poison the write queue', async () => {
		const created = await service.createDesign('wireframe', 'Atomic');
		await assert.rejects(service.patchDesign(created.path, 1, [{ type: 'removeScreen', id: 'detail' }]));
		assert.equal((await service.readDesign(created.path)).revision, 1);
		await service.patchDesign(created.path, 1, [{ type: 'setNode', id: 'heading', text: 'Recovered' }]);
		assert.equal((await service.readDesign(created.path)).revision, 2);
	});
	test('oversized UTF-8 history is rejected before it makes the design unreadable', async () => {
		const created = await service.createDesign('blank', 'Storage limit');
		let file = await service.patchDesign(created.path, 1, Array.from({ length: 60 }, (_, i) => ({ type: 'addNode' as const, screenId: 'main', node: { id: `node-${i}`, kind: 'text' as const, text: '🙂'.repeat(2000), token: 'text', spacing: 10, size: 14, children: [] } })));
		let rejected = false;
		for (let i = 0; i < 8; i++) {
			try { file = await service.patchDesign(created.path, file.revision, [{ type: 'setDocument', text: `Revision ${i}` }]); }
			catch (error) { assert.match(String(error), /2 MB/); rejected = true; break; }
		}
		assert(rejected);
		assert.equal((await service.readDesign(created.path)).revision, file.revision);
		assert((await files.readFile(service.resolve(created.path)!)).value.byteLength <= 2_000_000);
	});
	test('paths are confined to the workspace design and canvas directories', async () => {
		for (const path of ['/etc/design.json', '../.openide/designs/x/design.json', '.openide/designs/x/../../settings.json']) {
			assert.equal(service.resolve(path), undefined);
			await assert.rejects(service.readDesign(path));
		}
		await assert.rejects(service.createDesign('mobile', ''));
	});
	test('imported images persist locally, survive undo/redo and export without source dependencies', async () => {
		const created = await service.createDesign('whiteboard', 'Images');
		const source = URI.file(join(project, 'logo.svg'));
		await files.writeFile(source, VSBuffer.fromString('<svg width="100" height="80"><rect width="100" height="80" fill="#abcdef"/></svg>'));
		const imported = await service.importDesign(created.path, 1, source.fsPath, 'image');
		assert.equal(imported.document.assets!.length, 1);
		await files.del(source);
		assert.equal(Object.keys(await service.designAssets(created.path)).length, 1);
		await service.patchDesign(created.path, 2, 'undo');assert.equal(Object.keys(await service.designAssets(created.path)).length, 0);
		await service.patchDesign(created.path, 3, 'redo');assert.equal(Object.keys(await service.designAssets(created.path)).length, 1);
		const exported = await service.exportDesign(created.path, 'html');assert.match((await files.readFile(URI.file(exported.path))).value.toString(), /data:image\/svg\+xml;base64/);
	});
	test('invalid imports and stale revisions do not mutate a design', async () => {
		const created = await service.createDesign('whiteboard', 'Import conflicts');
		const source=URI.file(join(project,'bad.svg'));await files.writeFile(source,VSBuffer.fromString('<svg onload="alert(1)"/>'));
		await assert.rejects(service.importDesign(created.path,1,source.fsPath,'image'),/passive/);
		await assert.rejects(service.importDesign(created.path,0,source.fsPath,'image'),/Design changed/);
		await assert.rejects(service.importDesign(created.path,1,'/etc/passwd','image'),/workspace/);
		assert.equal((await service.readDesign(created.path)).revision,1);
	});
	test('CLI imports cannot follow a symlink outside the workspace', async () => {
		const outside=await mkdtemp(join(tmpdir(),'canvas-external-'));
		try {await writeFile(join(outside,'asset.svg'),'<svg><rect/></svg>');await symlink(outside,join(project,'linked'));
			const created=await service.createDesign('whiteboard','Confined');await assert.rejects(service.importDesign(created.path,1,'linked/asset.svg','image'),/resolve inside the workspace/);
		} finally {await rm(outside,{recursive:true,force:true});}
	});

	test('asset symlinks cannot redirect imports or exports outside the workspace', async () => {
		const outside=await mkdtemp(join(tmpdir(),'canvas-asset-external-'));
		try {
			const created=await service.createDesign('whiteboard','Asset boundary');
			const design=service.resolve(created.path)!;const folder=URI.joinPath(design,'..','assets');
			await symlink(outside,folder.fsPath);
			const source=URI.file(join(project,'safe.svg'));await files.writeFile(source,VSBuffer.fromString('<svg width="100" height="100"><rect/></svg>'));
			await assert.rejects(service.importDesign(created.path,1,source.fsPath,'image'),/assets must resolve inside/);
			const svg='<svg width="100" height="100"><rect/></svg>';await writeFile(join(outside,'external.svg'),svg);
			await service.patchDesign(created.path,1,[{type:'addAsset',asset:{id:'external',name:'External',path:'assets/external.svg',mime:'image/svg+xml',bytes:svg.length}}]);
			await assert.rejects(service.designAssets(created.path),/assets must resolve inside/);
		} finally {await rm(outside,{recursive:true,force:true});}
	});

	test('OBJ and token imports retain geometry and reject a missing destination atomically', async () => {
		const created=await service.createDesign('scene3d','Models');const source=URI.file(join(project,'triangle.obj'));
		await files.writeFile(source,VSBuffer.fromString('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'));
		await assert.rejects(service.importDesign(created.path,1,source.fsPath,'obj','missing'));
		const result=await service.importDesign(created.path,1,source.fsPath,'obj');assert.equal(result.document.screens[0].nodes[1].object3d!.faces!.length,1);
		const exported=await service.exportDesign(created.path,'obj');assert.match((await files.readFile(URI.file(exported.path))).value.toString(),/f 9 10 11/);
	});

	test('compiler supports named aliases and ignores import-like text in comments', () => {
		const result = service.compile(`import { Text as Label } from 'openide/canvas';\n// import evil from 'evil';\nexport default function App() { return <Label>Hello</Label>; }`);
		assert.deepEqual(result.errors, []);
		assert(result.code?.includes('Text: Label'));
	});
	test('compiler rejects unknown SDK exports and unsupported module forms', () => {
		for (const source of ["import {Missing} from 'openide/canvas';", "import Text from 'openide/canvas';", "import * as Canvas from 'openide/canvas';", "import {Text} from 'react';", "export {Text} from 'openide/canvas';", "import('openide/canvas');"]) {
			assert(service.compile(source + '\nexport default function App(){return null}').errors.length > 0, source);
		}
		assert(service.compile('export default function App(){ return <div> }').errors.length > 0);
	});
});
