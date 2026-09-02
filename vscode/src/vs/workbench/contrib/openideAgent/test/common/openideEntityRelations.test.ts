/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }` — see openideCodebaseGraphLayout.test.ts.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { bucketFor, groupEntityRelations } from '../../common/diagrams/openideEntityRelations.js';
import { CodebaseMemoryRelationType, ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../../../../../code/common/openideCodebaseMemoryTypes.js';

/**
 * The drill-down reads the graph out loud, and direction is where the meaning lives: the same
 * IMPORTS edge is "importa" from one end and "importado por" from the other.
 */
suite('OpenIDE entity relations — what the drill-down reads out', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const evidence = { provider: 'ast' as const, confidence: 1, verified: true, indexedAt: 0 };
	const node = (id: string, degree = 0): ICodebaseMemoryNode =>
		({ id, kind: 'file', name: id, uri: `file:///${id}`, evidence, degree });
	const edge = (source: string, target: string, type: CodebaseMemoryRelationType): ICodebaseMemoryEdge =>
		({ source, target, type, evidence });

	test('the same edge reads in opposite directions from its two ends', () => {
		assert.strictEqual(bucketFor('IMPORTS', true), 'imports');
		assert.strictEqual(bucketFor('IMPORTS', false), 'importedBy');
		assert.strictEqual(bucketFor('CALLS', true), 'calls');
		assert.strictEqual(bucketFor('CALLS', false), 'usedBy');
		// Stored the other way around, so its reading flips too.
		assert.strictEqual(bucketFor('CALLED_BY', true), 'usedBy');
		assert.strictEqual(bucketFor('CALLED_BY', false), 'calls');
	});

	test('containment only reads downwards: the file you came from is not a relation', () => {
		assert.strictEqual(bucketFor('DEFINES', true), 'defines');
		assert.strictEqual(bucketFor('CONTAINS', true), 'defines');
		assert.strictEqual(bucketFor('DEFINES', false), 'related');
	});

	test('an unknown relation still has somewhere to go', () => {
		assert.strictEqual(bucketFor('ANNOTATES', true), 'related');
		assert.strictEqual(bucketFor('TESTED_BY', false), 'related');
	});

	test('buckets come in reading order: what it is, what it needs, who needs it', () => {
		const groups = groupEntityRelations('me', [
			{ edge: edge('other', 'me', 'IMPORTS'), node: node('other') },
			{ edge: edge('me', 'dep', 'IMPORTS'), node: node('dep') },
			{ edge: edge('me', 'sym', 'DEFINES'), node: node('sym') },
		]);
		assert.deepStrictEqual(groups.map(g => g.bucket), ['defines', 'imports', 'importedBy']);
	});

	test('two edges between the same pair are one row, and the biggest answer comes first', () => {
		const groups = groupEntityRelations('me', [
			{ edge: edge('me', 'dep', 'IMPORTS'), node: node('dep', 3) },
			{ edge: edge('me', 'dep', 'USES'), node: node('dep', 3) },
			{ edge: edge('me', 'big', 'IMPORTS'), node: node('big', 40) },
		]);
		const imports = groups.find(g => g.bucket === 'imports')!;
		assert.deepStrictEqual(imports.nodes.map(n => n.id), ['big', 'dep']);
	});

	test('an entity never lists itself, and empty buckets do not appear', () => {
		const groups = groupEntityRelations('me', [{ edge: edge('me', 'me', 'REFERENCES'), node: node('me') }]);
		assert.deepStrictEqual(groups, []);
	});

	test('a long list is capped so the panel stays a panel', () => {
		const relations = Array.from({ length: 30 }, (_, i) => ({ edge: edge('x' + i, 'me', 'IMPORTS'), node: node('x' + i, i) }));
		const groups = groupEntityRelations('me', relations, 5);
		assert.strictEqual(groups[0].nodes.length, 5);
		// The most connected survive the cap.
		assert.strictEqual(groups[0].nodes[0].id, 'x29');
	});
});
