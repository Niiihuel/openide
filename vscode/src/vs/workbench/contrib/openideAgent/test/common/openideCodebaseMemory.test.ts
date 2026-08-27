/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { makeEdgeId, makeEvidence, makeNodeId, isVerifiedProvider } from '../../../../../code/common/openideCodebaseMemoryTypes.js';
import { deduplicateEdges, deduplicateNodes, isTestFilePath, regexCodebaseMemoryProvider } from '../../../../../code/common/openideCodebaseMemoryProviders.js';
import { detectCommunities, ICommunityGraphEdge } from '../../../../../code/common/openideCodebaseCommunities.js';
import { isRelativeSpecifier, packageNameOf, resolveRelativeImport } from '../../../../../code/common/openideCodebaseImports.js';
import { applySignal, classify, decayWeight, isExpired, learningKey } from '../../../../../code/common/openideCodebaseLearning.js';

suite('OpenIDE codebase memory', () => {
	test('creates deterministic node and edge ids', () => {
		assert.strictEqual(makeNodeId('workspace', 'file:///src/a.ts', 'function', 'run', 4), makeNodeId('workspace', 'file:///src/a.ts', 'function', 'run', 4));
		assert.strictEqual(makeEdgeId('a', 'CALLS', 'b'), 'a::CALLS::b');
	});

	test('marks language server evidence verified and regex evidence heuristic', () => {
		assert.strictEqual(isVerifiedProvider('callHierarchy'), true);
		assert.strictEqual(isVerifiedProvider('regex'), false);
		assert.strictEqual(makeEvidence('regex').confidence < makeEvidence('languageServer').confidence, true);
	});

	test('regex provider extracts files, symbols and materialized import modules', () => {
		const result = regexCodebaseMemoryProvider.extract({ uri: 'file:///src/a.ts', language: 'typescript', workspaceKey: 'w', content: "import { App } from './app';\nexport function run() {}\nconst value = 1" });
		assert.strictEqual(result.nodes.some(node => node.name === 'run'), true);
		assert.strictEqual(result.nodes.some(node => node.kind === 'module' && node.name === 'app'), true);
		assert.strictEqual(result.nodes.some(node => node.kind === 'constant' && node.name === 'value'), true);
		assert.strictEqual(result.edges.some(edge => edge.type === 'IMPORTS'), true);
		assert.strictEqual(deduplicateNodes(result.nodes).length, result.nodes.length);
		assert.strictEqual(deduplicateEdges(result.edges).length, result.edges.length);
	});

	test('regex provider never emits a relation without a materialized endpoint', () => {
		const result = regexCodebaseMemoryProvider.extract({ uri: 'file:///src/a.ts', language: 'typescript', workspaceKey: 'w', content: "import x from './x';" });
		const ids = new Set(result.nodes.map(node => node.id));
		assert.strictEqual(result.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)), true);
	});

	test('detects test files without matching lookalike names', () => {
		for (const uri of ['src/a.test.ts', 'src/a.spec.tsx', 'pkg/thing_test.go', 'tests/test_thing.py', 'src/FooTests.cs', 'src/BarTest.java']) {
			assert.strictEqual(isTestFilePath(uri), true, uri);
		}
		for (const uri of ['src/latest.py', 'src/contest.cs', 'src/greatest/x.py', 'src/testing.ts']) {
			assert.strictEqual(isTestFilePath(uri), false, uri);
		}
	});
});

suite('OpenIDE codebase communities', () => {
	// Two dense triangles joined by a single edge: the expected partition is 2 modules.
	const nodes = ['a.ts', 'b.ts', 'c.ts', 'x.ts', 'y.ts', 'z.ts'];
	const edges: ICommunityGraphEdge[] = [
		{ source: 'a.ts', target: 'b.ts' }, { source: 'b.ts', target: 'c.ts' }, { source: 'c.ts', target: 'a.ts' },
		{ source: 'x.ts', target: 'y.ts' }, { source: 'y.ts', target: 'z.ts' }, { source: 'z.ts', target: 'x.ts' },
		{ source: 'c.ts', target: 'x.ts' },
	];
	const degrees = new Map<string, number>();
	for (const edge of edges) {
		degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
		degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
	}
	const name = (id: string) => id;

	test('separates weakly connected clusters', () => {
		const communities = detectCommunities(nodes, edges, degrees, name);
		assert.strictEqual(communities.length, 2);
		const bucketOf = (id: string) => communities.findIndex(community => community.members.includes(id));
		assert.strictEqual(bucketOf('a.ts'), bucketOf('b.ts'));
		assert.notStrictEqual(bucketOf('a.ts'), bucketOf('y.ts'));
	});

	test('is deterministic: same graph yields identical ids, labels and members', () => {
		const first = detectCommunities(nodes, edges, degrees, name);
		// Different input order: the output must be byte-for-byte identical.
		const second = detectCommunities([...nodes].reverse(), [...edges].reverse(), degrees, name);
		assert.deepStrictEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
	});

	test('keeps ids stable across runs via greedy remap', () => {
		const previous = detectCommunities(nodes, edges, degrees, name).map(community => ({ ...community, id: community.id + 100 }));
		const next = detectCommunities(nodes, edges, degrees, name, previous);
		assert.deepStrictEqual(next.map(community => community.id).sort((a, b) => a - b), previous.map(community => community.id).sort((a, b) => a - b));
	});

	test('labels each community after its highest-degree member', () => {
		const communities = detectCommunities(nodes, edges, degrees, name);
		assert.strictEqual(communities.every(community => community.members.includes(community.label)), true);
	});

	test('handles an edgeless graph without losing nodes', () => {
		const communities = detectCommunities(['solo.ts', 'other.ts'], [], new Map(), name);
		assert.strictEqual(communities.flatMap(community => community.members).sort().join(','), 'other.ts,solo.ts');
	});
});

suite('OpenIDE codebase import resolution', () => {
	const known = new Set(['file:///r/src/app.ts', 'file:///r/src/lib/util.ts', 'file:///r/src/comp/index.tsx', 'file:///r/src/x.d.ts']);

	test('resolves relative specifiers to real files', () => {
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './app', known), 'file:///r/src/app.ts');
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './app.ts', known), 'file:///r/src/app.ts');
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './lib/util', known), 'file:///r/src/lib/util.ts');
		assert.strictEqual(resolveRelativeImport('file:///r/src/lib/a.ts', '../app', known), 'file:///r/src/app.ts');
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './comp', known), 'file:///r/src/comp/index.tsx');
		// import './app.js' points at the TypeScript source (ESM with an explicit extension)
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './app.js', known), 'file:///r/src/app.ts');
	});

	test('leaves unresolvable and bare specifiers alone', () => {
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', './noexiste', known), undefined);
		assert.strictEqual(resolveRelativeImport('file:///r/src/main.ts', 'react', known), undefined);
		assert.strictEqual(isRelativeSpecifier('react'), false);
		assert.strictEqual(isRelativeSpecifier('./a'), true);
		assert.strictEqual(isRelativeSpecifier('../a'), true);
	});

	test('extracts package names keeping the scope', () => {
		assert.strictEqual(packageNameOf('react'), 'react');
		assert.strictEqual(packageNameOf('lodash/get'), 'lodash');
		assert.strictEqual(packageNameOf('@scope/pkg'), '@scope/pkg');
		assert.strictEqual(packageNameOf('@scope/pkg/sub'), '@scope/pkg');
	});

	test('does not collapse the same specifier imported from different folders', () => {
		const multi = new Set(['file:///r/a/app.ts', 'file:///r/b/app.ts', 'file:///r/a/x.ts', 'file:///r/b/y.ts']);
		const first = resolveRelativeImport('file:///r/a/x.ts', './app', multi);
		const second = resolveRelativeImport('file:///r/b/y.ts', './app', multi);
		assert.strictEqual(first, 'file:///r/a/app.ts');
		assert.strictEqual(second, 'file:///r/b/app.ts');
		assert.notStrictEqual(first, second);
	});
});

suite('OpenIDE project map learning', () => {
	const DAY = 24 * 60 * 60 * 1000;
	const t0 = 1_700_000_000_000;

	test('halves the weight of a lesson every 30 days', () => {
		assert.strictEqual(decayWeight(t0, t0), 1);
		assert.strictEqual(decayWeight(t0, t0 + 30 * DAY), 0.5);
		assert.strictEqual(decayWeight(t0, t0 + 90 * DAY), 0.125);
	});

	test('classifies by corroboration and conflict', () => {
		const one = applySignal(undefined, 1, t0);
		assert.strictEqual(classify(one, t0), 'tentative');
		const two = applySignal(one, 1, t0);
		assert.strictEqual(classify(two, t0), 'preferred');
		assert.strictEqual(classify(applySignal(two, -1, t0), t0), 'contested');
		// Purely negative signal is not exposed: the model is never told "this is useless".
		assert.strictEqual(classify(applySignal(undefined, -1, t0), t0), undefined);
	});

	test('lets a preferred lesson decay back to tentative and then away', () => {
		const strong = applySignal(applySignal(undefined, 1, t0), 1, t0);
		assert.strictEqual(classify(strong, t0), 'preferred');
		assert.strictEqual(classify(strong, t0 + 40 * DAY), 'tentative');
		assert.strictEqual(classify(strong, t0 + 200 * DAY), undefined);
		assert.strictEqual(isExpired(strong, t0), false);
		assert.strictEqual(isExpired(strong, t0 + 200 * DAY), true);
	});

	test('decays prior signal before reinforcing', () => {
		const reinforced = applySignal(applySignal(undefined, 1, t0), 1, t0 + 30 * DAY);
		assert.strictEqual(reinforced.pos, 1.5); // la señal vieja ya valía 0.5
	});

	test('keys entities without the line number so lessons survive edits', () => {
		assert.strictEqual(learningKey('file:///a.ts', 'Foo.bar'), 'file:///a.ts#Foo.bar');
	});
});
