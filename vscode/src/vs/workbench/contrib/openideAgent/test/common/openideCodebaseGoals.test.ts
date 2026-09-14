/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { extractCodebaseGoals, isCodebaseGoalDocument, projectCodebaseGoals } from '../../../../../platform/openideCodebase/common/openideCodebaseGoals.js';
import { ICodebaseMemoryNode, makeEvidence } from '../../../../../platform/openideCodebase/common/openideCodebaseMemoryTypes.js';

suite('OpenIDE Goal graph projection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const uri = 'file:///repo/.openide/goals/goal-1/GOAL.md';
	const reportUri = 'file:///repo/.openide/goals/goal-1/REPORT.md';
	const contract = (revision = 1) => `---\nschema_version: 1\nid: goal-1\nrevision: ${revision}\nplan_ref: ".openide/plans/work.md"\n---\n\n# Goal\n\nImprove terminal identity\n\n## Acceptance criteria\n\n- C1: Tests pass\n\n[src/terminal.ts](src/terminal.ts)\n[Learning](.openide/memory/notes/terminal.md)\n[Outside](../secret.md)\n`;
	const report = '# Goal report\n\nImprove terminal identity\n\nStatus: completed\nContract revision: 1\n\n## Evidence\n\n- evidence-1 · C1 · verifier · run run-1\n  npm test passed\n\n## Activity\n\nChecked the terminal.\n';

	test('reindexing keeps identities but does not turn a claimed success into verified evidence', () => {
		const first = extractCodebaseGoals('ws', uri, contract());
		const rebuilt = extractCodebaseGoals('ws', uri, contract().replace('Improve terminal identity', 'Improve PTY identity'));
		const claimed = extractCodebaseGoals('ws', reportUri, report);
		const projection = projectCodebaseGoals([...rebuilt.nodes, ...claimed.nodes]);
		const goal = projection.nodes.find(node => node.kind === 'goal')!;
		assert.deepStrictEqual({ id: goal.id, status: goal.metadata!['reportedStatus'], verified: goal.evidence.verified, evidenceVerified: claimed.nodes.find(node => node.kind === 'goalEvidence')!.evidence.verified }, {
			id: first.nodes.find(node => node.kind === 'goal')!.id, status: 'completed', verified: false, evidenceVerified: false,
		});
	});

	test('links only existing workspace plan, file and note targets', () => {
		const extracted = extractCodebaseGoals('ws', uri, contract());
		const targets: ICodebaseMemoryNode[] = [
			{ id: 'plan', kind: 'file', name: 'Plan', uri: 'file:///repo/.openide/plans/work.md', degree: 0, evidence: makeEvidence('text') },
			{ id: 'code', kind: 'file', name: 'Code', uri: 'file:///repo/src/terminal.ts', degree: 0, evidence: makeEvidence('text') },
			{ id: 'note', kind: 'note', name: 'Learning', uri: 'file:///repo/.openide/memory/notes/terminal.md', degree: 0, evidence: makeEvidence('authored') },
			{ id: 'outside', kind: 'file', name: 'Secret', uri: 'file:///secret.md', degree: 0, evidence: makeEvidence('text') },
		];
		assert.deepStrictEqual(projectCodebaseGoals([...extracted.nodes, ...targets]).edges.map(edge => `${edge.type}:${edge.target}`).sort(), ['REFERENCES:code', 'REFERENCES:note', 'USES:plan']);
		assert.deepStrictEqual(projectCodebaseGoals(extracted.nodes).edges, []);
	});

	test('a revised or deleted contract cannot inherit completion links from an older report', () => {
		const claimed = extractCodebaseGoals('ws', reportUri, report);
		const changed = projectCodebaseGoals([...extractCodebaseGoals('ws', uri, contract(2)).nodes, ...claimed.nodes]);
		assert.deepStrictEqual({ status: changed.nodes.find(node => node.kind === 'goal')!.metadata!['reportedStatus'], hasEvidence: changed.edges.some(edge => edge.type === 'HAS_EVIDENCE'), orphanEdges: projectCodebaseGoals(claimed.nodes).edges.length }, { status: 'unknown', hasEvidence: false, orphanEdges: 0 });
	});

	test('requires matching canonical path and contract identity, and skips oversized prose', () => {
		assert.deepStrictEqual({ canonical: isCodebaseGoalDocument(uri), arbitrary: isCodebaseGoalDocument('file:///repo/random/GOAL.md'), mismatched: extractCodebaseGoals('ws', uri, contract().replace('id: goal-1', 'id: other')).nodes.some(node => node.kind === 'goal'), oversized: extractCodebaseGoals('ws', uri, 'x'.repeat(400 * 1024 + 1)).nodes.length }, { canonical: true, arbitrary: false, mismatched: false, oversized: 0 });
	});

	test('Markdown links resolve from the document and remain inside the workspace', () => {
		const docs = extractCodebaseGoals('ws', uri, contract() + '\n[Real](../../../src/terminal.ts)\n[Escape](../../../../secret.md)\n[Encoded Escape](%2e%2e/%2e%2e/%2e%2e/%2e%2e/secret.md)\n[Sibling](detail.md)\n');
		const targets: ICodebaseMemoryNode[] = [
			{ id: 'code', kind: 'file', name: 'Code', uri: 'file:///repo/src/terminal.ts', degree: 0, evidence: makeEvidence('text') },
			{ id: 'sibling', kind: 'file', name: 'Detail', uri: 'file:///repo/.openide/goals/goal-1/detail.md', degree: 0, evidence: makeEvidence('text') },
			{ id: 'legacy', kind: 'file', name: 'Other detail', uri: 'file:///repo/detail.md', degree: 0, evidence: makeEvidence('text') },
			{ id: 'outside', kind: 'file', name: 'Secret', uri: 'file:///secret.md', degree: 0, evidence: makeEvidence('text') },
		];
		assert.deepStrictEqual(projectCodebaseGoals([...docs.nodes, ...targets]).edges.map(edge => edge.target).sort(), ['code', 'sibling']);
	});

});
