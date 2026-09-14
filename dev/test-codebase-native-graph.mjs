// Copyright (c) OpenIDE. Licensed under the MIT License.
// Differential graph finalization: native partitioning must preserve existing import semantics.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { detectCommunities, finalizeCodebaseCommunities } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseCommunities.js';
import { resolveInternalImport, isInternalSpecifier, ALIAS_URI_PREFIX, PACKAGE_URI_PREFIX } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseImports.js';
import { INDEXER_PROVIDERS, mergeExtractions } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseMemoryProviders.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = fileURLToPath(new URL(`../vscode/native/bin/openide-codebase${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let nextId = 0;
const send = async request => {
	child.stdin.write(JSON.stringify(request) + '\n');
	const line = await lines.next();
	assert.equal(line.done, false, 'native graph process exited before returning a result');
	const result = JSON.parse(line.value);
	assert.equal(result.error, undefined, JSON.stringify(result));
	return result;
};
const native = async fixture => {
	await send({ version: 1, id: ++nextId, method: 'graphUpdate', params: { reset: true, files: [] } });
	const files = Object.entries(fixture.payloads).map(([uri, payload]) => ({ uri, ...payload }));
	for (let offset = 0; offset < files.length; offset += 20) {
		await send({ version: 1, id: ++nextId, method: 'graphUpdate', params: { files: files.slice(offset, offset + 20) } });
	}
	return (await send({ version: 1, id: ++nextId, method: 'graphFinalize', params: { fileUris: fixture.uris } })).result;
};

const fileNode = uri => ({ id: `${uri}::file`, uri, kind: 'file', name: uri.split('/').at(-1) });
const graph = (names, connections = []) => {
	const uris = names.map(name => `file:///workspace/${name}`);
	const payloads = Object.fromEntries(uris.map(uri => [uri, { nodes: [fileNode(uri)], edges: [] }]));
	for (const [a, b] of connections) {
		payloads[uris[a]].edges.push({ source: fileNode(uris[a]).id, target: fileNode(uris[b]).id });
	}
	return { uris, payloads };
};
const addImport = (fixture, importer, specifier, id = `synthetic:${specifier}`, syntheticUri = `${ALIAS_URI_PREFIX}${specifier}`) => {
	const uri = fixture.uris[importer], payload = fixture.payloads[uri];
	payload.nodes.push({ id, uri: syntheticUri, kind: 'module', qualifiedName: specifier });
	payload.edges.push({ source: fileNode(uri).id, target: id });
};
const oracle = ({ uris, payloads }, previous = []) => {
	const known = new Set(uris), uriByNode = new Map(), fileByUri = new Map(), pending = new Map();
	for (const uri of uris) {
		for (const node of payloads[uri]?.nodes ?? []) {
			uriByNode.set(node.id, node.uri.startsWith(ALIAS_URI_PREFIX) || node.uri.startsWith(PACKAGE_URI_PREFIX) ? node.uri : uri);
			if (node.kind === 'file' && node.uri === uri) { fileByUri.set(uri, node.id); }
			if (node.kind === 'module' && node.qualifiedName && isInternalSpecifier(node.qualifiedName)) { pending.set(node.id, { importer: uri, specifier: node.qualifiedName }); }
		}
	}
	const aliases = {};
	for (const [id, { importer, specifier }] of pending) {
		const resolved = resolveInternalImport(importer, specifier, known), fileId = resolved && fileByUri.get(resolved);
		if (fileId && fileId !== id) { aliases[id] = fileId; }
	}
	const edges = [], degreeByUri = new Map();
	for (const uri of uris) {
		for (const edge of payloads[uri]?.edges ?? []) {
			const source = uriByNode.get(aliases[edge.source] ?? edge.source), target = uriByNode.get(aliases[edge.target] ?? edge.target);
			if (source && target && source !== target && known.has(source) && known.has(target)) {
				edges.push({ source, target });
				degreeByUri.set(source, (degreeByUri.get(source) ?? 0) + 1);
				degreeByUri.set(target, (degreeByUri.get(target) ?? 0) + 1);
			}
		}
	}
	const communities = detectCommunities(uris, edges, degreeByUri, uri => uri.split('/').at(-1) ?? uri, previous);
	return { aliases, communities, degreeByUri: Object.fromEntries(degreeByUri) };
};
const normalizeGroups = groups => groups.map(group => [...group].sort()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
let checks = 0;
const compare = async (name, fixture) => {
	const expected = oracle(fixture), result = await native(fixture);
	assert.deepEqual(result.aliases, expected.aliases, `${name}: aliases`);
	assert.deepEqual(result.degreeByUri, expected.degreeByUri, `${name}: projected degree`);
	assert.deepEqual(normalizeGroups(result.groups), normalizeGroups(expected.communities.map(c => c.members)), `${name}: partition`);
	for (const previous of [[], expected.communities.map((community, index) => ({ ...community, id: 17 + index * 3 }))]) {
		const actual = finalizeCodebaseCommunities(result.groups, new Map(Object.entries(result.degreeByUri)), uri => uri.split('/').at(-1) ?? uri, previous);
		assert.deepEqual(actual, oracle(fixture, previous).communities, `${name}: locale metadata and stable IDs`);
	}
	checks++;
	return result;
};

try {
	await compare('empty', graph([]));
	await compare('unicode ordering and isolated files', graph(['a.ts', 'A.ts', '\uE000.ts', '𐀀.ts', 'á.ts', '_x.ts', '-x.ts', 'foo.ts', 'foo.ts/a.ts']));
	const imports = graph(['main.ts', 'lib/x.ts', 'lib/x.js', 'src/lib/x.ts', 'lib/index.ts', 'missing.ts', 'src/main.ts', 'lib/deep.tsx', 'lib/😀.ts']);
	for (const specifier of ['./lib/x', './lib/x.js', './lib/deep.js', '@/lib/x', '~/lib', '#/lib/😀', './missing', './absent', '@/absent', 'react', '@scope/pkg', '/', '@/']) { addImport(imports, 0, specifier); }
	// Globally shared synthetic ID is deliberately overwritten by a later importer, as in TS.
	addImport(imports, 0, './lib/x', 'same-relative-id', 'file:///workspace/lib/x');
	addImport(imports, 6, '../lib/index', 'same-relative-id', 'file:///workspace/lib/index');
	delete imports.payloads[imports.uris[5]];
	await compare('candidate extensions, ambiguous aliases, global synthetic IDs and missing payload', imports);

	let seed = 0x7631a;
	const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
	for (let trial = 0; trial < 100; trial++) {
		const size = 4 + Math.floor(random() * 170), connections = [];
		for (let a = 0; a < size; a++) {
			for (let b = 0; b < size; b++) {
				const probability = Math.floor(a / 12) === Math.floor(b / 12) ? 0.23 : 0.007;
				if (random() < probability) { connections.push([a, b]); if (random() < 0.08) { connections.push([a, b]); } }
			}
		}
		if (trial % 3 === 0) { for (let i = 1; i < size; i++) { connections.push([0, i]); } }
		const fixture = graph(Array.from({ length: size }, (_, i) => `${i % 2 ? 'lib' : 'src'}/${i}.ts`), connections);
		if (trial % 2) { fixture.uris.reverse(); }
		await compare(`seeded partition ${trial}`, fixture);
	}
	// A low-cohesion connected community and p99 hub case exercise the post-passes.
	await compare('large cycle', graph(Array.from({ length: 240 }, (_, i) => `cycle/${i}.ts`), Array.from({ length: 240 }, (_, i) => [i, (i + 1) % 240])));
	await compare('all hubs', graph(['hub/a', 'hub/b', 'hub/c'], Array.from({ length: 80 }, (_, i) => [i % 3, (i + 1) % 3])));

	const paths = execFileSync('rg', ['--files', 'vscode/src/vs/platform/openideCodebase', 'vscode/src/vs/code/electron-utility/sharedProcess/contrib'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(path => path.endsWith('.ts')).sort();
	const real = { uris: [], payloads: {} };
	for (const path of paths) {
		const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
		const uri = `file:///workspace/${path}`, source = { content, uri, language: 'typescript', workspaceKey: 'file:///workspace' };
		real.uris.push(uri);
		real.payloads[uri] = mergeExtractions(INDEXER_PROVIDERS.filter(provider => provider.supports(source)).map(provider => provider.extract(source)));
	}
	await compare('real indexed project', real);
	const aliasHeavy = graph(Array.from({ length: 2_000 }, (_, index) => `packages/pkg${index}/entry.ts`));
	for (let index = 0; index < aliasHeavy.uris.length; index++) {
		addImport(aliasHeavy, index, `@/pkg${(index + 1) % aliasHeavy.uris.length}/entry`);
	}
	await compare('large aliased workspace', aliasHeavy);
	const measurements = [];
	for (const [name, fixture] of [['real', real], ['alias-heavy', aliasHeavy]]) {
		let start = performance.now();
		for (let i = 0; i < 3; i++) { await native(fixture); }
		const uploadAndFinalizeMs = (performance.now() - start) / 3;
		start = performance.now();
		for (let i = 0; i < 3; i++) { oracle(fixture); }
		const legacyMs = (performance.now() - start) / 3;
		start = performance.now();
		for (let i = 0; i < 3; i++) {
			await send({ version: 1, id: ++nextId, method: 'graphFinalize', params: { fileUris: fixture.uris } });
		}
		const residentFinalizeMs = (performance.now() - start) / 3;
		measurements.push({ name, files: fixture.uris.length, uploadAndFinalizeMs, residentFinalizeMs, legacyMs });
	}
	console.log(JSON.stringify({ checks, measurements, methodology: 'Three warm runs; no disk persistence or renderer work. Native upload+finalize includes JSON transport; resident finalize reuses uploaded payloads. TS final labels/IDs remain host-side in both paths.' }));
	console.log('PASS: imports, alias ambiguity, Unicode ordering, duplicate edges, hub reinsertion, split passes and real graph partition parity.');
} finally {
	child.stdin.end();
	child.kill();
}
