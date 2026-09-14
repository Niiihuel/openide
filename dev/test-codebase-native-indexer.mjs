// Copyright (c) OpenIDE. Licensed under the MIT License.
// Full/incremental index integration using real FileService and an in-memory filesystem.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FileService } from '../vscode/out/vs/platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../vscode/out/vs/platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../vscode/out/vs/platform/log/common/log.js';
import { CodebaseMemoryIndexer } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryIndexer.js';
import { CodebaseMemoryStorage } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.js';
import { DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { VSBuffer } from '../vscode/out/vs/base/common/buffer.js';
import { URI } from '../vscode/out/vs/base/common/uri.js';
import { CancellationToken, CancellationTokenSource } from '../vscode/out/vs/base/common/cancellation.js';
globalThis._VSCODE_FILE_ROOT=fileURLToPath(new URL('../vscode/out/',import.meta.url));
const files=new FileService(new NullLogService()), provider=new InMemoryFileSystemProvider();
const registration=files.registerProvider('file',provider), folder=URI.file('/native-fixture');
const storage=new CodebaseMemoryStorage(files,URI.file('/storage'));
const indexer=new CodebaseMemoryIndexer(files,[folder],storage);
const write=async (name,content)=>{const uri=URI.joinPath(folder,name);await files.writeFile(uri,VSBuffer.fromString(content));return uri;};
try{
 await files.createFolder(folder);await storage.setPersist(false);
 indexer.setOptions({...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS,indexTests:false,exclude:['ignored']});
 const a=await write('a.ts','export const alpha = 1;');
 const b=await write('b.ts','import {alpha} from "./a";\nexport function beta() {}');
 await write('a.test.ts','export const excludedTest = 0;');
 await files.createFolder(URI.joinPath(folder,'ignored'));await write('ignored/c.ts','export const excluded = 0;');
 await write('secret.ts','const API_KEY = "fixture-value";');
 assert.equal((await indexer.rebuildFull()).phase,'idle');
 assert.equal(indexer.getMetrics().nativeBatches,1);
 assert.equal(indexer.getMetrics().fallbackBatches,0);
 assert.deepEqual(Object.keys(storage.getManifest().files).sort(),[a.toString(),b.toString()]);
 const before=(await storage.readFile(a.toString())).nodes;
 assert.ok(before.some(n=>n.name==='alpha'));
 await indexer.indexIncremental([{uri:a,content:'export const alpha = 1;'}],CancellationToken.None);
 assert.deepEqual((await storage.readFile(a.toString())).nodes,before,'unchanged file retains existing evidence');
 // Unsaved content from the caller wins; it is not reread from the filesystem by Rust.
 await indexer.indexIncremental([{uri:a,content:'export function unsaved() {}'}],CancellationToken.None);
 assert.ok((await storage.readFile(a.toString())).nodes.some(n=>n.name==='unsaved'));
 // Preserve event ordering and purge deletions before recreation.
 await indexer.indexIncremental([{uri:a,content:'const first=1;'},{uri:a,deleted:true},{uri:a,content:'const last=2;'}],CancellationToken.None);
 assert.deepEqual((await storage.readFile(a.toString())).nodes.filter(n=>n.kind!=='file').map(n=>n.name),['last']);
 await indexer.indexIncremental([{uri:a,content:'const duplicateFirst=1;'},{uri:a,content:'const duplicateLast=2;'}],CancellationToken.None);
 assert.deepEqual((await storage.readFile(a.toString())).nodes.filter(n=>n.kind!=='file').map(n=>n.name),['duplicateLast']);
 const node=(await storage.readFile(a.toString())).nodes.find(n=>n.kind==='constant');
 indexer.setExternalExtraction(a.toString(),{nodes:[{...node,evidence:{...node.evidence,provider:'documentSymbols',confidence:0.9,verified:true},signature:'verified signature'}],edges:[]});
 await indexer.indexIncremental([{uri:a,content:'const duplicateLast=3;'}],CancellationToken.None);
 assert.equal((await storage.readFile(a.toString())).nodes.find(n=>n.kind==='constant').signature,'verified signature');
 await indexer.indexIncremental([{uri:b,deleted:true}],CancellationToken.None);
 assert.equal(await storage.readFile(b.toString()),undefined);
 const cts=new CancellationTokenSource();cts.cancel();
 const saved=storage.getManifest();assert.equal((await indexer.rebuildFull(cts.token)).phase,'cancelled');
 assert.deepEqual(storage.getManifest(),saved,'cancelled rebuild does not clear the live index');cts.dispose();
 assert.equal(indexer.getMetrics().fallbackBatches,0);
 console.log('PASS: native full/incremental indexing, cached hash, unsaved content, ordered duplicate/delete/recreate, exclusions, secrets, language-server precedence and cancellation.');
 console.log(JSON.stringify(indexer.getMetrics()));
}finally{indexer.dispose();storage.dispose();registration.dispose();provider.dispose();files.dispose();}
