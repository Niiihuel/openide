/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { validateAdvancedNode, validateAdvancedDocument, makeAdvancedTemplate, type DesignFrame, type DesignKeyframe, type DesignObject3D, type DesignAsset, type DesignSystem } from './openideDesignAdvanced.js';

export type DesignTemplate = 'wireframe' | 'mobile' | 'mockup' | 'slides' | 'document' | 'blank' | 'whiteboard' | 'animation' | 'scene3d';
export type DesignNodeKind = 'text' | 'button' | 'input' | 'box' | 'row' | 'stack' | 'image' | 'shape' | 'path' | 'model';
export type DesignAction = 'navigate' | 'overlay' | 'close' | 'back' | 'submit' | 'toggle';
export interface DesignNode {
	id: string;
	kind: DesignNodeKind;
	text: string;
	children: DesignNode[];
	token: string;
	spacing: number;
	size: number;
	action?: DesignAction;
	target?: string;
	frame?: DesignFrame;
	shape?: 'rectangle' | 'ellipse' | 'line' | 'arrow';
	points?: number[][];
	assetId?: string;
	sourcePath?: string;
	keyframes?: DesignKeyframe[];
	object3d?: DesignObject3D;
}
export interface DesignScreen {
	id: string;
	title: string;
	nodes: DesignNode[];
}
export interface DesignDocument {
	title: string;
	template: DesignTemplate;
	fidelity: 'wireframe' | 'mockup';
	device: 'mobile' | 'tablet' | 'desktop';
	tokens: Record<string, string>;
	screens: DesignScreen[];
	assets?: DesignAsset[];
	designSystem?: DesignSystem;
	duration?: number;
	comments: {
		id: string;
		nodeId: string;
		revision: number;
		text: string;
	}[];
}
export interface DesignFile {
	schemaVersion: 1;
	revision: number;
	document: DesignDocument;
	past: DesignDocument[];
	future: DesignDocument[];
}
export interface DesignOperation {
	type: 'setNode' | 'addNode' | 'removeNode' | 'moveNode' | 'addScreen' | 'duplicateScreen' | 'removeScreen' | 'setScreen' | 'setToken' | 'comment' | 'setDocument' | 'setAdvanced' | 'addAsset' | 'setSystem';
	id?: string;
	parentId?: string;
	screenId?: string;
	index?: number;
	node?: DesignNode;
	text?: string;
	token?: string;
	value?: string;
	spacing?: number;
	size?: number;
	action?: DesignAction | '';
	target?: string;
	device?: DesignDocument['device'];
	fidelity?: DesignDocument['fidelity'];
	frame?: DesignFrame;
	shape?: DesignNode['shape'];
	points?: number[][];
	assetId?: string;
	sourcePath?: string;
	keyframes?: DesignKeyframe[];
	object3d?: DesignObject3D;
	asset?: DesignAsset;
	designSystem?: DesignSystem;
	duration?: number;
}
export const DESIGN_TEMPLATES: readonly {
	id: DesignTemplate;
	title: string;
	description: string;
}[] = [
	{ id: 'wireframe', title: 'Wireframe', description: 'Web layout with a connected detail screen.' },
	{ id: 'mobile', title: 'Mobile app', description: 'A mobile form and a confirmation screen.' },
	{ id: 'mockup', title: 'UI mockup', description: 'A product interface using editable design tokens.' },
	{ id: 'slides', title: 'Presentation', description: 'Connected slides with forward and back actions.' },
	{ id: 'document', title: 'Document', description: 'An editable visual brief and conclusions.' },
	{ id: 'whiteboard', title: 'Whiteboard', description: 'Draw, arrange shapes and notes on a free canvas.' },
	{ id: 'animation', title: 'Animation', description: 'Edit keyframes, scrub time and export an animated SVG or HTML.' },
	{ id: 'scene3d', title: '3D Scene', description: 'Compose and orbit 3D primitives or OBJ meshes; export OBJ and HTML.' },
	{ id: 'blank', title: 'Blank', description: 'Start with one screen and add your own elements.' },
];
const ID = /^[a-zA-Z][\w-]{0,79}$/;
function fail(message: string): never { throw new Error(`Invalid design: ${message}`); }
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail('expected an object');
	}
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string { if (typeof value !== 'string' || value.length > max) {
	fail('text exceeds its limit or is missing');
} return value; }
export function validateDesign(value: unknown): DesignFile {
	if ((JSON.stringify(value)?.length ?? 0) > 2000000) {
		fail('document exceeds 2 MB');
	}
	const file = record(value);
	if (file.schemaVersion !== 1 || !Number.isSafeInteger(file.revision) || Number(file.revision) < 1) {
		fail('unsupported schema or revision');
	}
	const validateDocument = (value: unknown): DesignDocument => {
		const doc = record(value);
		text(doc.title, 200);
		if (!DESIGN_TEMPLATES.some(t => t.id === doc.template) || !['wireframe', 'mockup'].includes(String(doc.fidelity)) || !['mobile', 'tablet', 'desktop'].includes(String(doc.device))) {
			fail('unknown template, fidelity or device');
		}
		const tokens = record(doc.tokens);
		if (Object.keys(tokens).length > 30 || !['background', 'surface', 'text', 'accent'].every(key => key in tokens)) {
			fail('missing or excessive tokens');
		}
		for (const [key, value] of Object.entries(tokens)) {
			if (!ID.test(key) || typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
				fail('tokens must be named hex colors');
			}
		}
		if (!Array.isArray(doc.screens) || !doc.screens.length || doc.screens.length > 50) {
			fail('requires 1–50 screens');
		}
		const ids = new Set<string>();
		let count = 0;
		const addId = (id: unknown) => { if (typeof id !== 'string' || !ID.test(id) || ids.has(id)) {
			fail('IDs must be unique and stable');
		} ids.add(id); };
		const actions: Record<string, unknown>[] = [];
		const node = (value: unknown, depth: number): void => {
			const n = record(value);
			validateAdvancedNode(n);
			addId(n.id);
			count++;
			text(n.text);
			if (depth > 12 || count > 500 || !['text', 'button', 'input', 'box', 'row', 'stack', 'image', 'shape', 'path', 'model'].includes(String(n.kind))) {
				fail('unsupported node or tree limit');
			}
			if (!Object.hasOwn(tokens, String(n.token)) || !Number.isFinite(n.spacing) || Number(n.spacing) < 0 || Number(n.spacing) > 80 || !Number.isFinite(n.size) || Number(n.size) < 10 || Number(n.size) > 72) {
				fail('invalid node properties');
			}
			if (!Array.isArray(n.children)) {
				fail('children must be an array');
			}
			if (n.children.length && !['row', 'stack', 'box'].includes(String(n.kind))) {
				fail('this node cannot contain children');
			}
			if (n.action !== undefined) {
				if (!['navigate', 'overlay', 'close', 'back', 'submit', 'toggle'].includes(String(n.action))) {
					fail('unknown interaction');
				}
				actions.push(n);
			}
			for (const child of n.children) {
				node(child, depth + 1);
			}
		};
		for (const entry of doc.screens) {
			const screen = record(entry);
			addId(screen.id);
			text(screen.title, 200);
			if (!Array.isArray(screen.nodes)) {
				fail('screen nodes must be an array');
			}
			screen.nodes.forEach(n => node(n, 0));
		}
		const screens = new Set(doc.screens.map(s => record(s).id));
		for (const action of actions) {
			if (['navigate', 'overlay', 'submit'].includes(String(action.action)) && !screens.has(action.target)) {
				fail('interaction destination does not exist');
			}
		}
		if (!Array.isArray(doc.comments) || doc.comments.length > 200) {
			fail('invalid comments');
		}
		for (const entry of doc.comments) {
			const comment = record(entry);
			text(comment.text, 2000);
			if (!ids.has(String(comment.nodeId)) || !Number.isSafeInteger(comment.revision)) {
				fail('comment target is missing');
			}
		}
		validateAdvancedDocument(doc);
		return structuredClone(doc) as unknown as DesignDocument;
	};
	if (!Array.isArray(file.past) || !Array.isArray(file.future) || file.past.length > 30 || file.future.length > 30) {
		fail('invalid history');
	}
	return { schemaVersion: 1, revision: Number(file.revision), document: validateDocument(file.document), past: file.past.map(validateDocument), future: file.future.map(validateDocument) };
}
export function newDesign(template: DesignTemplate, title: string, device?: DesignDocument['device']): DesignFile {
	const make = (id: string, kind: DesignNodeKind, text: string, action?: DesignAction, target?: string): DesignNode => ({ id, kind, text, token: kind === 'button' ? 'accent' : 'text', size: kind === 'text' ? 24 : 14, spacing: 16, children: [], ...(action ? { action, target } : {}) });
	const primary: DesignScreen = { id: 'main', title: 'Main', nodes: template === 'blank' ? [] : [make('heading', 'text', title), make('description', 'text', template === 'slides' ? 'Introduce your main idea.' : 'Explore the flow and refine the content.')] };
	if (template === 'mobile') {
		primary.nodes.push(make('name', 'input', 'Name'), make('email', 'input', 'Email'));
	}
	if (template !== 'blank') {
		primary.nodes.push(make('continue', 'button', template === 'mobile' ? 'Submit' : 'Continue', template === 'mobile' ? 'submit' : 'navigate', 'detail'));
	}
	// Each template starts with useful structure, while remaining ordinary editable nodes.
	if (template === 'wireframe' || template === 'mockup') {
		const row = make('content-columns', 'row', '');
		const overview = make('overview', 'box', template === 'mockup' ? 'Project overview' : 'Main content');
		overview.children = [make('overview-title', 'text', template === 'mockup' ? 'Ready for your next release' : 'Section title'), make('overview-copy', 'text', template === 'mockup' ? 'Review your team’s work and prepare the next milestone.' : 'Describe the purpose of this section.')];
		const summary = make('summary', 'box', template === 'mockup' ? 'Activity' : 'Supporting content');
		summary.children = [make('summary-copy', 'text', template === 'mockup' ? '3 tasks ready for review' : 'Summary and next steps'), make('summary-toggle', 'button', 'Mark reviewed', 'toggle')];
		row.children = [overview, summary];
		primary.nodes.splice(2, 0, row);
	}
	else if (template === 'slides') {
		primary.nodes[1].text = 'A clear idea, a useful example, and the next step.';
		const agenda = make('agenda', 'box', 'Today’s story');
		agenda.children = [make('agenda-problem', 'text', '01 · The problem'), make('agenda-approach', 'text', '02 · Our approach'), make('agenda-impact', 'text', '03 · Expected impact')];
		primary.nodes.splice(2, 0, agenda);
	}
	else if (template === 'document') {
		primary.nodes[1].text = 'A visual brief for discussion and implementation.';
		const brief = make('brief', 'stack', '');
		brief.children = [make('brief-context', 'text', 'Context'), make('brief-context-copy', 'text', 'Describe the audience, constraints and desired outcome.'), make('brief-decision', 'text', 'Proposed decision'), make('brief-decision-copy', 'text', 'Explain the recommendation and the evidence that supports it.')];
		primary.nodes.splice(2, 0, brief);
	}
	const doc: DesignDocument = { title, template, fidelity: template === 'wireframe' || template === 'blank' ? 'wireframe' : 'mockup', device: device ?? (template === 'mobile' ? 'mobile' : 'desktop'), tokens: { background: '#f4f4f2', surface: '#ffffff', text: '#202321', accent: '#287457' }, screens: [primary], comments: [] };
	if (template !== 'blank') {
		doc.screens.push({ id: 'detail', title: template === 'mobile' ? 'Confirmation' : 'Detail', nodes: [make('detail-heading', 'text', template === 'mobile' ? 'Thank you' : 'Next screen'), make('back', 'button', 'Back', 'back')] });
	}
	makeAdvancedTemplate(doc);
	return validateDesign({ schemaVersion: 1, revision: 1, document: doc, past: [], future: [] });
}
export function findDesignNode(doc: DesignDocument, id: string): DesignNode | undefined {
	const find = (nodes: DesignNode[]): DesignNode | undefined => { for (const node of nodes) {
		if (node.id === id) {
			return node;
		}
		const child = find(node.children);
		if (child) {
			return child;
		}
	} return undefined; };
	for (const screen of doc.screens) {
		const node = find(screen.nodes);
		if (node) {
			return node;
		}
	}
	return undefined;
}
export function changeDesign(file: DesignFile, expectedRevision: number, operations: DesignOperation[] | 'undo' | 'redo'): DesignFile {
	if (expectedRevision !== file.revision) {
		throw new Error(`Design changed: expected revision ${expectedRevision}, current ${file.revision}. Read it again before editing.`);
	}
	const next = structuredClone(file);
	if (operations === 'undo' || operations === 'redo') {
		const from = operations === 'undo' ? next.past : next.future;
		const to = operations === 'undo' ? next.future : next.past;
		const document = from.pop();
		if (!document) {
			throw new Error(`Nothing to ${operations}.`);
		}
		to.push(next.document);
		next.document = document;
	}
	else {
		if (!Array.isArray(operations) || !operations.length || operations.length > 100) {
			fail('requires 1–100 operations');
		}
		next.past.push(structuredClone(next.document));
		next.past = next.past.slice(-30);
		next.future = [];
		const doc = next.document;
		const remove = (id: string): DesignNode => {
			const walk = (nodes: DesignNode[]): DesignNode | undefined => { const i = nodes.findIndex(n => n.id === id); if (i >= 0) {
				return nodes.splice(i, 1)[0];
			} for (const n of nodes) {
				const found = walk(n.children);
				if (found) {
					return found;
				}
			} return undefined; };
			for (const s of doc.screens) {
				const n = walk(s.nodes);
				if (n) {
					return n;
				}
			}
			return fail('node does not exist');
		};
		for (const op of operations) {
			if (op.type === 'setAdvanced') {
				const node = findDesignNode(doc, op.id ?? '') ?? fail('node does not exist');
				if (op.sourcePath === '') { delete node.sourcePath; }
				for (const prop of ['frame', 'shape', 'points', 'assetId', 'keyframes', 'object3d', 'sourcePath'] as const) { if (op[prop] !== undefined && !(prop === 'sourcePath' && op[prop] === '')) { Object.assign(node, { [prop]: structuredClone(op[prop]) }); } }
			} else if (op.type === 'addAsset') {
				doc.assets = [...(doc.assets ?? []), structuredClone(op.asset ?? fail('asset required'))];
			} else if (op.type === 'setSystem') {
				doc.designSystem = structuredClone(op.designSystem ?? fail('design system required'));
				doc.tokens = { ...doc.tokens, ...doc.designSystem.colors };
			} else if (op.type === 'setNode') {
				const node = findDesignNode(doc, op.id ?? '') ?? fail('node does not exist');
				for (const prop of ['text', 'token', 'spacing', 'size', 'target'] as const) {
					if (op[prop] !== undefined) {
						Object.assign(node, { [prop]: op[prop] });
					}
				}
				if (op.action === '') {
					delete node.action;
					delete node.target;
				}
				else if (op.action) {
					node.action = op.action;
				}
			}
			else if (op.type === 'addNode' || op.type === 'moveNode') {
				const node = op.type === 'addNode' ? structuredClone(op.node ?? fail('node required')) : remove(op.id ?? '');
				const parent = op.parentId ? findDesignNode(doc, op.parentId) : undefined;
				const list = op.parentId ? parent?.children : doc.screens.find(s => s.id === op.screenId)?.nodes;
				if (!list) {
					fail('destination does not exist');
				}
				list.splice(Math.max(0, op.index ?? list.length), 0, node);
			}
			else if (op.type === 'removeNode') {
				const n = remove(op.id ?? '');
				const removed = new Set<string>();
				const visit = (node: DesignNode) => { removed.add(node.id); node.children.forEach(visit); };
				visit(n);
				doc.comments = doc.comments.filter(c => !removed.has(c.nodeId));
			}
			else if (op.type === 'addScreen') {
				doc.screens.push({ id: op.id ?? '', title: op.text ?? 'Screen', nodes: [] });
			}
			else if (op.type === 'setScreen') {
				const screen = doc.screens.find(s => s.id === op.id) ?? fail('screen missing');
				screen.title = op.text ?? screen.title;
			}
			else if (op.type === 'duplicateScreen') {
				const source = doc.screens.find(s => s.id === op.screenId) ?? fail('screen missing');
				const copy = structuredClone(source);
				copy.id = op.id ?? '';
				copy.title = op.text ?? `${source.title} variant`;
				const rename = (n: DesignNode) => { n.id = `${copy.id}-${n.id}`; if (n.target === source.id)
					n.target = copy.id; n.children.forEach(rename); };
				copy.nodes.forEach(rename);
				doc.screens.push(copy);
			}
			else if (op.type === 'removeScreen') {
				const index = doc.screens.findIndex(s => s.id === op.id);
				if (index < 0)
					fail('screen missing');
				const removed = doc.screens.splice(index, 1)[0];
				const ids = new Set<string>([removed.id]);
				const visit = (n: DesignNode) => { ids.add(n.id); n.children.forEach(visit); };
				removed.nodes.forEach(visit);
				doc.comments = doc.comments.filter(c => !ids.has(c.nodeId));
			}
			else if (op.type === 'setToken') {
				if (!op.token || !ID.test(op.token) || ['__proto__', 'constructor', 'prototype'].includes(op.token)) {
					fail('invalid token');
				}
				doc.tokens[op.token] = op.value ?? '';
			}
			else if (op.type === 'comment') {
				doc.comments.push({ id: `comment-${file.revision}-${doc.comments.length}`, nodeId: op.id ?? '', revision: file.revision, text: op.text ?? '' });
			}
			else if (op.type === 'setDocument') {
				if (op.text !== undefined)
					doc.title = op.text;
				if (op.duration !== undefined) { doc.duration = op.duration; }
				if (op.device)
					doc.device = op.device;
				if (op.fidelity)
					doc.fidelity = op.fidelity;
			}
			else {
				fail('unknown operation');
			}
		}
	}
	next.revision++;
	return validateDesign(next);
}
export function designHandoff(file: DesignFile): string {
	const doc = file.document;
	const lines = [`# ${doc.title}`, '', `Design revision: ${file.revision}`, `Target: ${doc.device}; fidelity: ${doc.fidelity}`, '', '## Screens and interactions'];
	const node = (n: DesignNode, depth: number) => { lines.push(`${'  '.repeat(depth)}- ${n.id}: ${n.kind} — ${n.text}${n.sourcePath ? ` [implementation: ${n.sourcePath}]` : ''}${n.action ? ` [${n.action}${n.target ? ` → ${n.target}` : ''}]` : ''}`); n.children.forEach(c => node(c, depth + 1)); };
	for (const screen of doc.screens) {
		lines.push(`\n### ${screen.title} (${screen.id})`);
		screen.nodes.forEach(n => node(n, 0));
	}
	lines.push('\n## Design tokens', ...Object.entries(doc.tokens).map(([key, value]) => `- ${key}: ${value}`), '\n## Review comments', ...doc.comments.map(c => `- ${c.nodeId} (revision ${c.revision}): ${c.text}`), '\n## Acceptance criteria', '- Implement the documented screens and interactions using the project’s components.', '- Verify mobile and desktop layouts, keyboard navigation and form error/success states.', '- Capture browser evidence and verify the resulting code before marking a GOAL complete.', '- Save durable design decisions to project memory with this revision as provenance.', '- Link implementation files and verification evidence in the Plan/GOAL report.');
	return lines.join('\n') + '\n';
}
