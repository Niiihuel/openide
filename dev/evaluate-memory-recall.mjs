#!/usr/bin/env node
// Reproducible retrieval baseline; optional real Mem0 comparison requires an explicit endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { recallMemory } from '../vscode/out/vs/workbench/contrib/openideAgent/common/openideMemoryRecall.js';
import { OpenideMem0Adapter } from '../vscode/out/vs/platform/openideAgentHost/node/openideMem0Adapter.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'dev/fixtures/memory-recall.json'), 'utf8'));
const documents = fixtures.map((item, index) => ({ path: `.openide/memory/notes/mem_fixture${index}.md`, hash: `fixture-${index}`, record: { schema: 1, id: `mem_fixture${index}`, topic_key: item.topic, body: item.body, kind: 'decision', status: 'active', revision: 1, source_kind: 'native', source_session: 'evaluation', source_message: `request-${index}`, evidence_kind: 'inferred', operation_id: `fixture-${index}`, related: [], created: '', updated: '' } }));
const scope = `openide-evaluation:${randomUUID()}`;
const endpoint = process.env.OPENIDE_MEM0_ENDPOINT;
const adapter = () => new OpenideMem0Adapter(endpoint, scope, process.env.OPENIDE_MEM0_API_KEY);
const results = [];
try {
	if (endpoint) { for (const document of documents) { await adapter().put(document); } }
	for (const [index, fixture] of fixtures.entries()) {
		for (const query of fixture.queries) {
			const start = performance.now(); const text = recallMemory(documents, query, 600);
			const hits = [...text.matchAll(/\[(mem_fixture\d+)\]/g)].map(match => match[1]);
			const result = { query, expected: documents[index].record.id, lexicalHit: hits.includes(documents[index].record.id), rank: hits.indexOf(documents[index].record.id) + 1, tokens: Math.ceil(text.length / 4), milliseconds: performance.now() - start };
			if (endpoint) { const ids = await adapter().search(query, documents); const hybrid = recallMemory(documents, query, 600, false, ids); result.hybridHit = hybrid.includes(`[${documents[index].record.id}]`); }
			results.push(result);
		}
	}
	const times = results.map(row => row.milliseconds).sort((a, b) => a - b);
	const report = { cases: results.length, topics: documents.length, budgetTokens: 600, lexicalHitRate: results.filter(row => row.lexicalHit).length / results.length, p50Milliseconds: times[Math.floor(times.length * 0.5)], p95Milliseconds: times[Math.floor(times.length * 0.95)], budgetViolations: results.filter(row => row.tokens > 600).length, semantic: endpoint ? { hybridHitRate: results.filter(row => row.hybridHit).length / results.length } : 'Not measured: no real Mem0 endpoint configured. Contract tests are not semantic-quality evidence.', results };
	fs.mkdirSync(path.join(root, '.build/memory-implementation'), { recursive: true });
	fs.writeFileSync(path.join(root, '.build/memory-implementation/recall-evaluation.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
} finally { if (endpoint) { for (const document of documents) { await adapter().remove(document.record.id).catch(() => {}); } } }
