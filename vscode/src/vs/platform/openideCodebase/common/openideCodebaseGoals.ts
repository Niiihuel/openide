/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { extractNoteMentions } from './openideCodebaseNotes.js';
import { ICodebaseMemoryEdge, ICodebaseMemoryNode, makeEvidence, makeNodeId } from './openideCodebaseMemoryTypes.js';

function document(uri: string): { root: URI; id?: string; kind: 'goal' | 'report' | 'plan' } | undefined {
	const resource = URI.parse(uri);
	const goal = /^(.*)\/\.openide\/goals\/([\w-]{1,128})\/(GOAL|REPORT)\.md$/.exec(resource.path);
	if (goal) { return { root: resource.with({ path: goal[1] }), id: goal[2], kind: goal[3] === 'GOAL' ? 'goal' : 'report' }; }
	const plan = /^(.*)\/\.openide\/plans\/[^/]+\.md$/.exec(resource.path);
	return plan ? { root: resource.with({ path: plan[1] }), kind: 'plan' } : undefined;
}

/** These documents are indexed as bounded prose, independently of the code extension allowlist. */
export function isCodebaseGoalDocument(uri: string): boolean { return !!document(uri); }

function reference(root: URI, value: string, origin?: string): string | undefined {
	let path = value.trim().replace(/^<|>$/g, '').replace(/#.*$/, '');
	try { path = decodeURIComponent(path); } catch { return undefined; }
	if (!path || /^(?:[a-z][\w+.-]*:|\/)/i.test(path) || path.includes('\\')) { return undefined; }
	const base = origin ? URI.joinPath(URI.parse(origin), '..') : root;
	const target = URI.joinPath(base, path);
	const rootPrefix = root.path.endsWith('/') ? root.path : root.path + '/';
	if (target.scheme !== root.scheme || target.authority !== root.authority || !target.path.startsWith(rootPrefix)) { return undefined; }
	return target.toString();
}

/** A document projection is not a verifier receipt, even if the text says "completed". */
export function extractCodebaseGoals(workspaceKey: string, uri: string, content: string): { nodes: ICodebaseMemoryNode[]; edges: ICodebaseMemoryEdge[] } {
	const source = document(uri);
	if (!source || content.length > 400 * 1024) { return { nodes: [], edges: [] }; }
	const evidence = makeEvidence('text');
	const fileId = makeNodeId(workspaceKey, uri, 'file', uri);
	const file: ICodebaseMemoryNode = { id: fileId, kind: 'file', name: URI.parse(uri).path.split('/').pop()!, uri, evidence, degree: 0 };
	const nodes: ICodebaseMemoryNode[] = [file];
	const edges: ICodebaseMemoryEdge[] = [];
	if (source.kind === 'plan') { return { nodes, edges }; }
	const goalId = makeNodeId(workspaceKey, source.root.toString(), 'goal', source.id!);
	const referenceUris = [...new Set(extractNoteMentions(content).slice(0, 200).map(value => reference(source.root, value)).filter((value): value is string => !!value))];
	// Markdown links resolve relative to the document. Older reports used workspace paths;
	// fall back only if the proper document-relative destination is not present in the graph.
	const referenceCandidates = Array.from(content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g), match =>
		[reference(source.root, match[1], uri), reference(source.root, match[1])].filter((value): value is string => !!value)).slice(0, 200);
	if (source.kind === 'goal') {
		const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
		if (!frontmatter || /^id:\s*([^\s]+)\s*$/m.exec(frontmatter[1])?.[1] !== source.id) { return { nodes, edges }; }
		const body = content.slice(frontmatter[0].length).replace(/^\s*# Goal\s*\n/, '').trim();
		const objective = body.split(/\n## /)[0].trim();
		const revision = Number(/^revision:\s*(\d+)\s*$/m.exec(frontmatter[1])?.[1] ?? 0);
		const planRaw = /^plan_ref:\s*(.+)$/m.exec(frontmatter[1])?.[1];
		let plan: string | undefined;
		if (planRaw) { try { const parsed: unknown = JSON.parse(planRaw); if (typeof parsed === 'string') { plan = reference(source.root, parsed); } } catch { plan = reference(source.root, planRaw); } }
		nodes.push({ id: goalId, kind: 'goal', name: objective.split('\n')[0].slice(0, 100) || source.id!, uri, documentation: objective,
			evidence, degree: 0, metadata: { goalId: source.id, contractRevision: revision, contractPath: uri, planUri: plan, referenceUris, referenceCandidates, provenance: 'document_projection', reportedStatus: 'unknown' } });
		edges.push({ source: fileId, target: goalId, type: 'CONTAINS', evidence });
	} else {
		const status = /^Status: (active|paused|blocked|interrupted|limit_reached|failed|completed|cancelled)\s*$/m.exec(content)?.[1] ?? 'unknown';
		const revision = Number(/^Contract revision:\s*(\d+)\s*$/m.exec(content)?.[1] ?? 0);
		nodes[0] = { ...file, metadata: { goalId: source.id, goalNodeId: goalId, reportedStatus: status, contractRevision: revision, referenceUris, referenceCandidates, provenance: 'document_projection' } };
		const section = /(?:^|\n)## Evidence\r?\n([\s\S]*?)(?:\n## |$)/.exec(content)?.[1] ?? '';
		const seen = new Set<string>();
		for (const match of section.matchAll(/^- ([\w-]+) · ([\w-]+) · (user|verifier) · run ([^\n]*)\n[ \t]+([^\n]*)/gm)) {
			if (seen.has(match[1]) || seen.size >= 200) { continue; }
			seen.add(match[1]);
			const id = makeNodeId(workspaceKey, source.root.toString(), 'goalEvidence', `${source.id}:${match[1]}`);
			nodes.push({ id, kind: 'goalEvidence', name: match[5].slice(0, 100) || match[1], uri, documentation: match[5], evidence, degree: 0,
				metadata: { goalNodeId: goalId, evidenceId: match[1], criterionId: match[2], claimedSource: match[3], claimedRunId: match[4], contractRevision: revision, provenance: 'document_projection' } });
			edges.push({ source: fileId, target: id, type: 'CONTAINS', evidence });
		}
	}
	return { nodes, edges };
}

/** Rebuilt on snapshot reads: deleted contracts and missing targets never leave dangling relations. */
export function projectCodebaseGoals(input: readonly ICodebaseMemoryNode[]): { nodes: ICodebaseMemoryNode[]; edges: ICodebaseMemoryEdge[] } {
	const goals = new Map(input.filter(node => node.kind === 'goal').map(node => [node.id, node]));
	const reports = new Map(input.filter(node => node.kind === 'file' && typeof node.metadata?.['goalNodeId'] === 'string').map(node => [String(node.metadata!['goalNodeId']), node]));
	const targets = new Map<string, ICodebaseMemoryNode>();
	for (const node of input) { if (node.kind === 'file' || node.kind === 'note') { if (!targets.has(node.uri) || node.kind === 'note') { targets.set(node.uri, node); } } }
	const edges: ICodebaseMemoryEdge[] = [];
	const evidence = makeEvidence('text');
	const nodes = input.map(node => {
		if (node.kind !== 'goal') { return node; }
		const report = reports.get(node.id);
		const revisionMatches = report?.metadata?.['contractRevision'] === node.metadata?.['contractRevision'];
		const planUri = node.metadata?.['planUri'];
		const plan = typeof planUri === 'string' ? targets.get(planUri) : undefined;
		if (plan) { edges.push({ source: node.id, target: plan.id, type: 'USES', evidence }); }
		const refs = [...(Array.isArray(node.metadata?.['referenceUris']) ? node.metadata!['referenceUris'] : []), ...(Array.isArray(report?.metadata?.['referenceUris']) ? report!.metadata!['referenceUris'] : [])];
		const candidates = [...(Array.isArray(node.metadata?.['referenceCandidates']) ? node.metadata!['referenceCandidates'] : []), ...(Array.isArray(report?.metadata?.['referenceCandidates']) ? report!.metadata!['referenceCandidates'] : [])];
		for (const choices of candidates) {
			if (!Array.isArray(choices)) { continue; }
			const chosen = choices.find(value => typeof value === 'string' && targets.has(value));
			if (chosen) { refs.push(chosen); }
		}
		for (const uri of new Set(refs)) { const target = typeof uri === 'string' ? targets.get(uri) : undefined; if (target) { edges.push({ source: node.id, target: target.id, type: 'REFERENCES', evidence }); } }
		if (report) { edges.push({ source: node.id, target: report.id, type: 'REFERENCES', evidence }); }
		return { ...node, metadata: { ...node.metadata, reportedStatus: revisionMatches ? report?.metadata?.['reportedStatus'] : 'unknown', reportRevisionMatches: !!revisionMatches } };
	});
	for (const node of input) {
		if (node.kind !== 'goalEvidence') { continue; }
		const goal = goals.get(String(node.metadata?.['goalNodeId']));
		if (goal && node.metadata?.['contractRevision'] === goal.metadata?.['contractRevision']) { edges.push({ source: goal.id, target: node.id, type: 'HAS_EVIDENCE', evidence }); }
	}
	return { nodes, edges };
}
