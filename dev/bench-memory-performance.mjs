// Copyright (c) OpenIDE. Licensed under the MIT License.
// Research harness: uses compiled production classes; creates only temporary fixtures.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { OpenideMemoryOwner } from '../vscode/out/vs/platform/openideAgentHost/node/openideMemoryOwner.js';
import { serializeMemoryRecord } from '../vscode/out/vs/platform/openideCodebase/common/openideMemoryRecord.js';
import { recallMemory } from '../vscode/out/vs/workbench/contrib/openideAgent/common/openideMemoryRecall.js';
import { CodebaseMemoryStorage } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.js';
import { URI } from '../vscode/out/vs/base/common/uri.js';
const output = process.env.OPENIDE_BENCHMARK_OUTPUT ? pathToFileURL(path.resolve(process.env.OPENIDE_BENCHMARK_OUTPUT)) : new URL('../.build/performance-cli-investigation/benchmark.json', import.meta.url);
await fs.mkdir(new URL('.', output), {recursive:true});
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'openide-perf-'));
const report = { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model, platform: os.platform(), methodology: 'Warm OS cache. Nine timed samples after one warmup for reads. Production classes from vscode/out. Synthetic notes ~2KB each; no provider, IPC, graph projection or GUI in memory timings. Storage insertion uses persistence off to isolate manifest CPU; three independent fresh stores per size. Fixture creation excluded.', memory: [], storage: [] };
const ms = async fn => { const start = performance.now(); const value = await fn(); return { ms: performance.now()-start, value }; };
const stats = values => { const sorted = values.toSorted((a,b)=>a-b); return { p50: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.ceil(sorted.length*.95)-1], samples: values }; };
const bench = async fn => { await fn(); const values=[]; for(let i=0;i<9;i++) values.push((await ms(fn)).ms); return stats(values); };
try {
if (process.env.STORAGE_ONLY) report.memory = JSON.parse(await fs.readFile(output, 'utf8')).memory;
for(const [notes,sessions] of (process.env.STORAGE_ONLY ? [] : [[0,0],[50,0],[200,0],[500,0],[500,200]])) {
 const root=path.join(fixture,`notes-${notes}-${sessions}`), profile=path.join(root,'profile');
 await fs.mkdir(profile,{recursive:true});
 for(const folder of ['notes','sessions']) await fs.mkdir(path.join(root,'.openide/memory',folder),{recursive:true});
 let firstId; let bytes=0;
 for(let i=0;i<notes+sessions;i++) {
  const id=`mem_${String(i).padStart(8,'0')}`; firstId ??= id;
  const record={schema:1,id,topic_key:`payments/topic-${i}`,kind:i<notes?'decision':'session',status:'active',revision:1,created:'2026-09-06T00:00:00Z',updated:'2026-09-06T00:00:00Z',source_kind:'native',source_session:'session',source_message:'fixture',evidence_kind:'inferred',operation_id:`fixture-${i}`,related:[],body:('# Retry policy\nReuse idempotency keys. Bound exponential payment backoff.\n'.repeat(24))};
  const text=serializeMemoryRecord(record); bytes+=Buffer.byteLength(text); await fs.writeFile(path.join(root,'.openide/memory',i<notes?'notes':'sessions',`${id}.md`),text);
 }
 const owner=new OpenideMemoryOwner(profile); await owner.setWorkspace([root]);
 const list=await bench(()=>owner.request({action:'list'}));
 const docs=(await owner.request({action:'list'})).documents; assert.equal(docs.length,notes+sessions);
 const rank=await bench(()=>recallMemory(docs,'payment retry backoff',600));
 const get=firstId ? await bench(()=>owner.request({action:'get',id:firstId})) : undefined;
 const twoScans=await bench(async()=>{await owner.request({action:'list'}); await owner.request({action:'list'});});
 const burst=await ms(()=>Promise.all(Array.from({length:4},()=>owner.request({action:'list'}))));
 report.memory.push({notes,sessions,bytes,list,get,rank,twoScans,fourConcurrentListsMs:burst.ms});
 owner.dispose(); console.log(JSON.stringify(report.memory.at(-1)));
}
for(const count of [500,2000,5000]) {
 const samples=[];
 for(let repeat=0;repeat<3;repeat++) {
  const storage=new CodebaseMemoryStorage({del:async()=>{}}, URI.file(path.join(fixture,'storage')));
  await storage.setPersist(false); await storage.load('fixture');
  const result=await ms(async()=>{for(let i=0;i<count;i++) {const uri=`file:///fixture/file-${i}.ts`; await storage.writeFile(uri,'hash','typescript',{uri,nodes:[],edges:[]});}});
  assert.equal(storage.getStats().fileCount,count); samples.push(result.ms); storage.dispose();
 }
 report.storage.push({files:count,insertTotalMs:stats(samples)}); console.log(JSON.stringify(report.storage.at(-1)));
}
} finally { await fs.rm(fixture,{recursive:true,force:true}); await fs.writeFile(output,JSON.stringify(report,null,2)); }
