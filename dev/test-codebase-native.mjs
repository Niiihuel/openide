// Copyright (c) OpenIDE. Licensed under the MIT License.
// Differential test and bounded transport benchmark against the production TypeScript providers.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { NativeCodebase } from '../vscode/out/vs/platform/openideCodebase/node/openideNativeCodebase.js';
import { CancellationToken, CancellationTokenSource } from '../vscode/out/vs/base/common/cancellation.js';
import { INDEXER_PROVIDERS, mergeExtractions } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseMemoryProviders.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root,'vscode/native/bin',`openide-codebase${process.platform==='win32'?'.exe':''}`);
const normalize = extraction => JSON.parse(JSON.stringify(extraction, (key,value)=>key==='indexedAt'?0:value));
const legacy = (file,regex) => mergeExtractions(INDEXER_PROVIDERS.filter(p=>(regex||p.id!=='regex')&&p.supports(file)).map(p=>p.extract(file)));
const hash = content => { let h=0x811c9dc5; for(let i=0;i<content.length;i++) h=Math.imul(h^content.charCodeAt(i),0x01000193);return (h>>>0).toString(36); };
const fixture = (content,uri='file:///fixture/main.ts',language='typescript')=>({content,uri,language,workspaceKey:'file:///fixture'});
const files = [
 fixture(''),fixture('// 😀 á漢字\nexport const dinero = 4;\r\nexport async function run() {}\nconst café=1;\nconst yield=2;'),
 fixture('import {x} from "./local";\nimport type {Y} from "@/types";\nimport * as a from "~/foo";\nimport z from "#/bar";\nimport p from "@scope/pkg/a";\nimport q from "@scope/pkg/b";\nimport r from "react/jsx-runtime";\nimport r2 from "react";'),
 fixture('export default class A {}\nexport\uFEFFconst B=1;\nfunction $thing(){}\nconst _a=2;\nimport x,{y} from "../a";', 'file:///fixture/main.test.ts'),
 ...['python','rust','csharp','go','java','tsx','jsx','javascript','cpp'].map(language=>fixture('class Example {}\nfn run() {}\nexport const number = 4;\n',`file:///fixture/test_name.${language==='python'?'py':language}`,language)),
];
const collectTypeScriptFiles = async directory => {
 const entries=await readdir(path.join(root,directory),{withFileTypes:true});
 const nested=await Promise.all(entries.map(entry=>{
  const relativePath=path.join(directory,entry.name);
  return entry.isDirectory()?collectTypeScriptFiles(relativePath):entry.isFile()&&entry.name.endsWith('.ts')?[relativePath]:[];
 }));
 return nested.flat();
};
const paths = (await Promise.all([
 'vscode/src/vs/platform/openideCodebase',
 'vscode/src/vs/workbench/contrib/openideAgent',
 'vscode/src/vs/code/electron-utility/sharedProcess/contrib'
].map(collectTypeScriptFiles))).flat().sort();
for(const p of paths) {const content=await readFile(path.join(root,p),'utf8');if(Buffer.byteLength(content)<100_000) files.push(fixture(content,`file:///fixture/${p}`));}
const native = new NativeCodebase(executable);
const report = {files:files.length, parity:[], measurements:[], methodology:'Identical production extraction. Rust includes stdio, serialization and deserialization; TS runs providers in process. Warm OS cache. No disk walk, persistence, renderer, total process memory or GUI FPS measured.'};
try {
 for(const regex of [true,false]) {
  for(let i=0;i<files.length;i+=20) {
   const batch=files.slice(i,i+20);
   const results=await native.extract(batch,regex,CancellationToken.None);
   assert.ok(results,JSON.stringify(native.getMetrics()));
   for(let j=0;j<batch.length;j++) {
    assert.equal(results[j].hash,hash(batch[j].content),batch[j].uri);
    assert.deepEqual(normalize(results[j].extraction),normalize(legacy(batch[j],regex)),batch[j].uri);
   }
  }
  report.parity.push({regex,files:files.length});
 }
 const cached=files.slice(0,20).map(file=>({...file,knownHash:hash(file.content)}));
 assert.ok((await native.extract(cached,true,CancellationToken.None)).every(r=>r.unchanged && !r.extraction));
 const cts=new CancellationTokenSource();cts.cancel();
 await assert.rejects(native.extract(files.slice(0,1),true,cts.token),/cancel/i);cts.dispose();
 assert.ok(await native.extract(files.slice(0,1),true,CancellationToken.None));
 // Cancel CPU work already dispatched, then reuse the same bridge with a fresh child.
 const activeCancel=new CancellationTokenSource();
 const heavy=Array.from({length:10},(_,i)=>fixture(Array.from({length:3000},(_,j)=>`export const value${j} = ${j};`).join('\n'),`file:///fixture/slow${i}.ts`));
 const running=native.extract(heavy,true,activeCancel.token);
 setTimeout(()=>activeCancel.cancel(),5);
 await assert.rejects(running,/cancel/i);activeCancel.dispose();
 assert.ok(await native.extract(files.slice(0,1),true,CancellationToken.None),'restart after cancelling active native work');
 const missing=new NativeCodebase(path.join(root,'vscode/native/bin/missing-fixture'));
 try {assert.equal(await missing.extract(files.slice(0,1),true,CancellationToken.None),undefined);assert.equal(missing.getMetrics().fallbackBatches,1);}finally{missing.dispose();}
 for(const [name,batch] of [['real',files.slice(15,35)],['many-definitions',[fixture(Array.from({length:4000},(_,i)=>`export const value${i} = ${i};`).join('\n'))]]]) {
  const times={name,ts:[],rust:[]};
  for(let i=0;i<6;i++){
   let start=performance.now();batch.map(f=>legacy(f,true));let ts=performance.now()-start;
   start=performance.now();assert.ok(await native.extract(batch,true,CancellationToken.None));let rust=performance.now()-start;
   if(i){times.ts.push(ts);times.rust.push(rust);}
  }
  report.measurements.push(times);
 }
 // Child failure, protocol violation and cancellation must settle requests, then permit recovery.
 const tmp=await mkdtemp(path.join(os.tmpdir(),'openide-native-test-'));
 try {
  if(process.platform!=='win32'){
   const script=path.join(tmp,'engine');
   await writeFile(script,'#!/bin/sh\nexec sleep 10\n',{mode:0o755});
   const slow=new NativeCodebase(script), cancellation=new CancellationTokenSource();
   const waiting=slow.extract(files.slice(0,1),true,cancellation.token);setTimeout(()=>cancellation.cancel(),30);
   await assert.rejects(waiting,/cancel/i);slow.dispose();cancellation.dispose();
   await writeFile(script,'#!/bin/sh\nprintf \'{"version":99,"id":1,"files":[]}\\n\'\n');
   const invalid=new NativeCodebase(script);assert.equal(await invalid.extract(files.slice(0,1),true,CancellationToken.None),undefined);invalid.dispose();
  }
 }finally{await rm(tmp,{recursive:true,force:true});}
 report.metrics=native.getMetrics();
 assert.equal(report.metrics.fallbackBatches,0);
 await mkdir(path.join(root,'.build/codebase-native'),{recursive:true});
 await writeFile(path.join(root,'.build/codebase-native/results.json'),JSON.stringify(report,null,2));
 console.log(`PASS: ${files.length} files × 2 provider modes; UTF-16 hashes, ordered graph parity, cache, cancellation, failure recovery.`);
 console.log(JSON.stringify(report.measurements));
}finally{native.dispose();}
