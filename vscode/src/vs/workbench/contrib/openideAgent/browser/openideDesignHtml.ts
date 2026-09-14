/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { t } from './../common/openideStrings.js';
import { OPENIDE_DESIGN_CHROME_CSS } from './openideCanvasChromeCss.js';
import { createDesignGeometry } from '../common/openideDesignAdvanced.js';
import { createAdvancedDesignRuntime } from './openideDesignAdvancedRuntime.js';
import { DESIGN_TEMPLATES, DesignFile, DesignNode, DesignOperation } from '../common/openideDesign.js';
/** This function is serialized into the isolated preview; keep all runtime dependencies inside. */
function designRuntime(): void {
	const globals = globalThis as unknown as {
		__design: {
			file?: DesignFile;
			templates: typeof DESIGN_TEMPLATES;
			nonce: string;
			standalone: boolean;
			labels: Record<string, string>;
			assets: Record<string, string>;
			pages?: boolean;
		};
		__designAdvanced: ReturnType<typeof createAdvancedDesignRuntime>;
		acquireVsCodeApi?: () => {
			postMessage(value: object): void;
		};
	};
	const config = globals.__design;
	const advanced = globals.__designAdvanced;
	const labelText = (label: string) => config.labels[label] ?? label;
	let zoom = 100, drawing = false, playMotion = !!(config.standalone && config.file?.document.template === 'animation' && !matchMedia('(prefers-reduced-motion: reduce)').matches), time = 0, yaw = 0, pitch = 0;
	let animationFrame = 0;
	const freeform = () => !!file && ['whiteboard', 'animation', 'scene3d'].includes(file.document.template);
	const host = config.standalone ? undefined : globals.acquireVsCodeApi?.();
	let file = config.file;
	let screenId = file?.document.screens[0].id ?? '';
	let selected = '';
	let playing = config.standalone;
	let overlay = '';
	const navigation: string[] = [];
	const values: Record<string, string> = {};
	const toggles = new Set<string>();
	let pending = false;
	const requestDraft = { title: '', details: '', template: '' };
	let notice = '';
	let size = file?.document.device ?? 'desktop';
	const $ = <K extends keyof HTMLElementTagNameMap>(tag: K, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
		const el = document.createElement(tag);
		if (text !== undefined)
			el.textContent = text;
		parent?.appendChild(el);
		return el;
	};
	const root = document.getElementById('design')!;
	const send = (message: object) => host?.postMessage({ ...message, documentId: config.nonce });
	const button = (parent: HTMLElement, label: string, action: () => void, disabled = false) => { const el = $('button', parent, labelText(label)); el.type = 'button'; el.className = 'oi-btn'; el.disabled = disabled; el.onclick = action; return el; };
	const change = (operations: DesignOperation[] | 'undo' | 'redo') => {
		if (!file || pending)
			return;
		pending = true;
		notice = 'Saving…';
		send({ type: 'designChange', expectedRevision: file.revision, operations });
		render();
	};
	const field = (parent: HTMLElement, label: string, value: string, apply: (value: string) => void, type = 'text') => { const wrap = $('label', parent); $('span', wrap, labelText(label)); const input = $('input', wrap); input.className = 'oi-field'; input.type = type; input.setAttribute('aria-label', labelText(label)); input.value = value; input.onchange = () => apply(input.value); return input; };
	const select = (parent: HTMLElement, label: string, options: {
		value: string;
		label: string;
	}[], value: string, apply: (value: string) => void) => {
		const wrap = $('label', parent);
		$('span', wrap, labelText(label));
		const el = $('select', wrap);
		el.className = 'oi-field';
		el.setAttribute('aria-label', labelText(label));
		for (const item of options) {
			const opt = $('option', el, labelText(item.label));
			opt.value = item.value;
		}
		el.value = value;
		el.onchange = () => apply(el.value);
		return el;
	};
	const uid = () => `node-${crypto.randomUUID().slice(0, 8)}`;
	const find = (nodes: DesignNode[], id: string): DesignNode | undefined => {
		for (const node of nodes) {
			if (node.id === id)
				return node;
			const match = find(node.children, id);
			if (match)
				return match;
		}
		return undefined;
	};
	const selectedNode = () => file?.document.screens.map(s => find(s.nodes, selected)).find(Boolean);
	function interact(node: DesignNode): void {
		if (!node.action) {
			notice = 'This element has no interaction yet.';
			render();
			return;
		}
		if (node.action === 'submit') {
			const required = Array.from(root.querySelectorAll<HTMLInputElement>('.preview input'));
			if (required.some(input => !input.value.trim())) {
				notice = 'Complete the form before continuing.';
				required.find(input => !input.value.trim())?.focus();
				const status = document.getElementById('design-status');
				if (status)
					status.textContent = notice;
				return;
			}
		}
		if ((node.action === 'navigate' || node.action === 'submit') && node.target) {
			navigation.push(screenId);
			screenId = node.target;
			overlay = '';
		}
		else if (node.action === 'overlay') {
			overlay = node.target ?? '';
		}
		else if (node.action === 'close') {
			overlay = '';
		}
		else if (node.action === 'back') {
			screenId = navigation.pop() ?? file!.document.screens[0].id;
			overlay = '';
		}
		else if (node.action === 'toggle') {
			if (toggles.has(node.id))
				toggles.delete(node.id);
			else
				toggles.add(node.id);
		}
		notice = '';
		render();
	}
	function paintNode(node: DesignNode, parent: HTMLElement): void {
		const doc = file!.document;
		const el = $('div', parent);
		el.dataset.node = node.id;
		el.className = `design-node kind-${node.kind}`;
		el.style.padding = `${node.spacing}px`;
		el.style.fontSize = `${node.size}px`;
		el.style.gap = `${node.spacing}px`;
		const color = doc.fidelity === 'wireframe' ? '#343434' : doc.tokens[node.token];
		el.style.color = color;
		if (!playing) {
			el.tabIndex = 0;
			el.setAttribute('role', 'button');
			el.setAttribute('aria-label', `${node.kind}: ${node.text}`);
			el.onclick = e => { e.stopPropagation(); selected = node.id; render(); };
			el.onkeydown = e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					selected = node.id;
					render();
				}
			};
			if (node.id === selected)
				el.classList.add('selected');
		}
		if (advanced.paint(el, node, doc, config.assets)) { }
		else if (node.kind === 'input') {
			const label = $('label', el);
			$('span', label, node.text);
			const input = $('input', label);
			input.placeholder = node.text;
			input.value = values[node.id] ?? '';
			input.disabled = !playing;
			input.oninput = () => { values[node.id] = input.value; };
		}
		else if (node.kind === 'button') {
			const control = button(el, node.text, () => interact(node));
			control.disabled = !playing;
			control.style.background = doc.fidelity === 'wireframe' ? '#444444' : doc.tokens[node.token];
			control.style.color = '#ffffff';
			if (node.action === 'toggle')
				control.setAttribute('aria-pressed', String(toggles.has(node.id)));
		}
		else if (node.text) {
			$('div', el, node.text);
		}
		if (playing && node.action && node.kind !== 'button' && node.kind !== 'input') {
			el.tabIndex = 0;
			el.setAttribute('role', 'button');
			el.onclick = e => { e.stopPropagation(); interact(node); };
			el.onkeydown = e => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					interact(node);
				}
			};
		}
		if (node.kind === 'row') {
			el.style.display = 'flex';
			el.style.flexWrap = 'wrap';
		}
		else if (node.children.length) {
			el.style.display = 'flex';
			el.style.flexDirection = 'column';
		}
		if (node.kind === 'box') {
			el.style.border = '1px solid currentColor';
			el.style.borderRadius = `${doc.designSystem?.radius ?? 8}px`;
			el.style.background = doc.fidelity === 'wireframe' ? '#ffffff' : doc.tokens.surface;
		}
		if (!playing && freeform() && node.frame && !drawing && node.kind !== 'model') {
			el.onpointerdown = e => {
				if (e.button !== 0) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				selected = node.id;
				const start = { x: e.clientX, y: e.clientY };
				const origin = { ...node.frame! };
				let dx = 0, dy = 0;
				el.setPointerCapture(e.pointerId);
				el.onpointermove = event => { dx = (event.clientX - start.x) * 100 / zoom; dy = (event.clientY - start.y) * 100 / zoom; el.style.left = `${origin.x + dx}px`; el.style.top = `${origin.y + dy}px`; };
				el.onpointerup = event => { el.releasePointerCapture(event.pointerId); el.onpointermove = null; el.onpointerup = null; if (Math.abs(dx) + Math.abs(dy) > 1) {
					change([{ type: 'setAdvanced', id: node.id, frame: { ...origin, x: Math.max(-10000, Math.min(10000, origin.x + dx)), y: Math.max(-10000, Math.min(10000, origin.y + dy)) } }]);
				}
				else {
					render();
				} };
				el.onpointercancel = () => { el.onpointermove = null; el.onpointerup = null; el.style.left = `${origin.x}px`; el.style.top = `${origin.y}px`; };
			};
		}
		for (const child of node.children)
			paintNode(child, el);
	}
	function gallery(): void {
		const welcome = $('section', root);
		welcome.className = 'gallery oi-column';
		$('h1', welcome, labelText('What should we create?'));
		$('p', welcome, labelText('Choose a format and take it to chat. You can add details before sending.')).className = 'oi-desc';
		const grid = $('fieldset', welcome);
		grid.className = 'templates';
		$('legend', grid, labelText('Canvas format'));
		for (const entry of config.templates) {
			const item = $('label', grid);
			item.className = 'oi-choice canvas-template';
			item.dataset.template = entry.id;
			const radio = $('input', item);
			radio.type = 'radio'; radio.name = 'canvas-template'; radio.value = entry.id;
			radio.checked = requestDraft.template === entry.id;
			const copy = $('span', item);
			$('strong', copy, labelText(entry.title));
			$('small', copy, labelText(entry.description));
			radio.onchange = () => { requestDraft.template = entry.id; continueButton.disabled = pending || !requestDraft.template; };
		}
		const fields = $('div', welcome);
		fields.className = 'canvas-request-fields';
		const name = field(fields, 'Project title (optional)', requestDraft.title, value => { requestDraft.title = value; });
		name.maxLength = 200;
		name.oninput = () => { requestDraft.title = name.value; };
		select(fields, 'Device', [{ value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'mobile', label: 'Mobile' }], size, value => { size = value as typeof size; });
		const detailsLabel = $('label', welcome, labelText('What do you want to create? (optional)'));
		const details = $('textarea', detailsLabel);
		details.className = 'oi-field'; details.rows = 3; details.maxLength = 3000; details.value = requestDraft.details;
		details.oninput = () => { requestDraft.details = details.value; };
		const actions = $('div', welcome); actions.className = 'canvas-request-actions';
		const continueButton = button(actions, 'Continue in chat', () => {
			if (!requestDraft.template || pending) { return; }
			pending = true; continueButton.disabled = true;
			send({ type: 'designRequest', template: requestDraft.template, title: requestDraft.title.trim(), details: requestDraft.details.trim(), device: size });
		}, pending || !requestDraft.template);
		continueButton.classList.add('primary');
		const status = $('p', welcome, notice); status.setAttribute('role', 'status');
	}
	function render(): void {
		cancelAnimationFrame(animationFrame);
		root.replaceChildren();
		if (config.pages) {
			root.style.cssText = 'display:block;height:auto;overflow:visible';
		}
		if (!file) {
			gallery();
			return;
		}
		if (!file.document.screens.some(s => s.id === screenId))
			screenId = file.document.screens[0].id;
		if (config.pages) {
			for (const screen of file.document.screens) {
				const paper = $('section', root);
				paper.className = 'export-page';
				paper.style.cssText = `position:relative;width:1100px;min-height:${freeform() ? 700 : 600}px;background:${file.document.tokens.background};color:${file.document.tokens.text};font-family:${file.document.designSystem?.fontFamily ?? 'system-ui'}`;
				paper.dataset.screen = screen.id;
				paper.setAttribute('aria-label', screen.title);
				const content = $('div', paper);
				content.style.cssText = freeform() ? 'position:relative;width:1100px;height:700px' : 'padding:24px';
				if (file.document.template === 'scene3d') {
					advanced.scene(content, screen.nodes, file.document);
				}
				else {
					screen.nodes.forEach(node => paintNode(node, content));
				}
			}
			return;
		}
		const toolbar = $('header', root);
		$('strong', toolbar, file.document.title);
		button(toolbar, playing ? 'Design' : 'Play', () => { playing = !playing; overlay = ''; notice = ''; render(); }, config.standalone);
		select(toolbar, 'Viewport', [{ value: 'mobile', label: 'Mobile · 390' }, { value: 'tablet', label: 'Tablet · 768' }, { value: 'desktop', label: 'Desktop · 1100' }], size, value => { size = value as typeof size; render(); });
		if (!config.standalone) {
			button(toolbar, 'Undo', () => change('undo'), pending || !file.past.length);
			button(toolbar, 'Redo', () => change('redo'), pending || !file.future.length);
			const menu = $('details', toolbar);
			menu.className = 'file-menu';
			$('summary', menu, labelText('File & delivery'));
			const actions = $('div', menu);
			actions.className = 'file-actions';
			button(actions, 'Capture editor', () => send({ type: 'designCapture' }), pending);
			button(actions, 'Export HTML', () => send({ type: 'designExport' }), pending);
			button(actions, 'Prepare Plan', () => send({ type: 'designHandoff', goal: false }), pending);
			button(actions, 'Create GOAL', () => send({ type: 'designHandoff', goal: true }), pending);
			select(actions, 'Export format', [{ value: 'html', label: 'HTML' }, { value: 'pdf', label: 'PDF' }, { value: 'pptx', label: 'PowerPoint' }, { value: 'svg', label: 'SVG' }, { value: 'obj', label: 'OBJ (3D)' }], 'html', format => send({ type: 'designExport', format }));
			button(actions, 'Import Image', () => send({ type: 'designImport', kind: 'image', expectedRevision: file!.revision, screenId }), pending);
			button(actions, 'Import Tokens', () => send({ type: 'designImport', kind: 'tokens', expectedRevision: file!.revision, screenId }), pending);
			button(actions, 'Import OBJ', () => send({ type: 'designImport', kind: 'obj', expectedRevision: file!.revision, screenId }), pending);
		}
		if (freeform()) {
			select(toolbar, 'Zoom', [50, 75, 100, 125, 150, 200].map(n => ({ value: String(n), label: `${n}%` })), String(zoom), v => { zoom = Number(v); render(); });
			if (!config.standalone && file.document.template !== 'scene3d') {
				button(toolbar, drawing ? 'Select' : 'Draw', () => { drawing = !drawing; render(); }, pending);
			}
			if (file.document.template === 'animation') {
				if (!config.standalone) {
					const duration = field(toolbar, 'Duration', String(file.document.duration ?? 5), v => change([{ type: 'setDocument', duration: Number(v) }]), 'number');
					duration.min = '.1';
					duration.max = '60';
					duration.step = '.1';
				}
				button(toolbar, playMotion ? 'Pause Motion' : 'Play Motion', () => { playMotion = !playMotion; render(); });
				const scrub = field(toolbar, 'Time', String(time), v => { time = Number(v); render(); }, 'range');
				scrub.dataset.motionTime = 'true';
				scrub.min = '0';
				scrub.max = String(file.document.duration ?? 5);
				scrub.step = '.01';
				scrub.oninput = () => { time = Number(scrub.value); advanced.animate(root, file!.document.screens.find(s => s.id === screenId)!.nodes, time); };
			}
		}
		const body = $('div', root);
		body.className = `workspace ${config.standalone ? 'standalone' : ''}`;
		const nav = $('nav', body);
		nav.setAttribute('aria-label', 'Screens');
		$('h2', nav, 'Screens');
		for (const screen of file.document.screens) {
			const b = button(nav, screen.title, () => { screenId = screen.id; selected = ''; overlay = ''; notice = ''; render(); });
			b.dataset.screen = screen.id;
			b.setAttribute('aria-current', String(screen.id === screenId));
		}
		if (!config.standalone) {
			button(nav, 'Add screen', () => change([{ type: 'addScreen', id: `screen-${crypto.randomUUID().slice(0, 8)}`, text: 'New screen' }]), pending);
			button(nav, 'Delete screen', () => change([{ type: 'removeScreen', id: screenId }]), pending || file!.document.screens.length === 1);
			button(nav, 'Duplicate variant', () => change([{ type: 'duplicateScreen', screenId, id: `variant-${crypto.randomUUID().slice(0, 8)}` }]), pending);
		}
		const stage = $('main', body);
		stage.className = 'stage';
		const preview = $('div', stage);
		preview.className = 'preview';
		preview.style.width = `${size === 'mobile' ? 390 : size === 'tablet' ? 768 : 1100}px`;
		preview.style.background = file.document.fidelity === 'wireframe' ? '#f5f5f5' : file.document.tokens.background;
		preview.style.color = file.document.tokens.text;
		if (file.document.designSystem) {
			preview.style.fontFamily = file.document.designSystem.fontFamily;
			preview.style.fontSize = `${file.document.designSystem.fontSize}px`;
			preview.style.lineHeight = String(file.document.designSystem.lineHeight);
		}
		if (freeform()) {
			preview.style.width = '1100px';
			preview.style.height = '700px';
			preview.style.padding = '0';
			preview.style.zoom = String(zoom / 100);
			preview.classList.add('freeform');
		}
		const screen = file.document.screens.find(s => s.id === screenId)!;
		preview.setAttribute('aria-label', screen.title);
		if (file.document.template === 'scene3d') {
			advanced.scene(preview, screen.nodes, file.document, yaw, pitch, id => { selected = id; render(); });
			preview.onpointerdown = e => { const start = { x: e.clientX, y: e.clientY, yaw, pitch }; let moved = false; preview.setPointerCapture(e.pointerId); preview.onpointermove = event => { if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 3) {
				return;
			} moved = true; yaw = start.yaw + (event.clientX - start.x) * .4; pitch = Math.max(-85, Math.min(85, start.pitch + (event.clientY - start.y) * .4)); preview.replaceChildren(); advanced.scene(preview, screen.nodes, file!.document, yaw, pitch); }; preview.onpointerup = event => { preview.releasePointerCapture(event.pointerId); preview.onpointermove = null; if (!moved) {
				const target = (e.target as Element).closest('[data-object]');
				if (target) {
					selected = target.getAttribute('data-object') ?? '';
				}
			} render(); }; };
		}
		else {
			for (const node of screen.nodes) {
				paintNode(node, preview);
			}
		}
		if (drawing && !playing) {
			preview.onpointerdown = e => { if (e.button !== 0) {
				return;
			} e.preventDefault(); const bounds = preview.getBoundingClientRect(); const points: number[][] = []; const path = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); path.setAttribute('viewBox', '0 0 1100 700'); path.style.cssText = 'position:absolute;inset:0;width:1100px;height:700px;pointer-events:none'; const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', file!.document.tokens.accent); line.setAttribute('stroke-width', '3'); path.appendChild(line); preview.appendChild(path); preview.setPointerCapture(e.pointerId); const add = (event: PointerEvent) => { if (points.length >= 2000) {
				return;
			} points.push([(event.clientX - bounds.x) * 100 / zoom, (event.clientY - bounds.y) * 100 / zoom]); line.setAttribute('points', points.map(p => p.join(',')).join(' ')); }; add(e); preview.onpointermove = add; preview.onpointerup = event => { preview.releasePointerCapture(event.pointerId); preview.onpointermove = null; preview.onpointerup = null; path.remove(); if (points.length > 1) {
				change([{ type: 'addNode', screenId, node: { id: uid(), kind: 'path', text: '', children: [], token: 'accent', spacing: 8, size: 16, points, frame: { x: 0, y: 0, width: 1100, height: 700, rotation: 0 } } }]);
			} }; preview.onpointercancel = () => { preview.onpointermove = null; path.remove(); }; };
		}
		if (file.document.template === 'animation') {
			advanced.animate(preview, screen.nodes, time);
			let previous = 0;
			const start = performance.now() - time * 1000;
			const tick = (now: number) => { if (document.hidden || !playMotion) {
				return;
			} if (now - previous >= 1000 / 30) {
				previous = now;
				time = ((now - start) / 1000) % (file!.document.duration ?? 5);
				advanced.animate(preview, screen.nodes, time);
				const scrub = root.querySelector<HTMLInputElement>('input[data-motion-time]');
				if (scrub) {
					scrub.value = String(time);
				}
			} animationFrame = requestAnimationFrame(tick); };
			if (playMotion) {
				animationFrame = requestAnimationFrame(tick);
			}
		}
		if (!screen.nodes.length)
			$('p', preview, playing ? 'This screen has no elements.' : 'Add your first element from the inspector.');
		if (overlay) {
			const modal = $('div', preview);
			modal.className = 'overlay';
			const content = $('div', modal);
			content.setAttribute('role', 'dialog');
			content.setAttribute('aria-label', 'Prototype overlay');
			button(content, 'Close', () => { overlay = ''; render(); });
			file.document.screens.find(s => s.id === overlay)?.nodes.forEach(n => paintNode(n, content));
		}
		if (!config.standalone && !playing) {
			const inspector = $('aside', body);
			$('h2', inspector, 'Inspector');
			field(inspector, 'Screen title', screen.title, text => change([{ type: 'setScreen', id: screenId, text }]));
			select(inspector, 'Fidelity', [{ value: 'wireframe', label: 'Wireframe' }, { value: 'mockup', label: 'Mockup' }], file.document.fidelity, value => change([{ type: 'setDocument', fidelity: value as 'wireframe' | 'mockup' }]));
			const add = $('div', inspector);
			add.className = 'add-elements';
			for (const kind of (freeform() ? ['text', 'shape', 'model'] : ['text', 'button', 'input', 'box', 'row', 'stack']) as DesignNode['kind'][]) {
				button(add, `+ ${kind}`, () => { const parent = selectedNode(); change([{ type: 'addNode', screenId, parentId: parent && ['row', 'stack', 'box'].includes(parent.kind) ? parent.id : undefined, node: { id: uid(), kind, text: kind === 'row' || kind === 'stack' ? '' : kind, children: [], token: kind === 'button' ? 'accent' : 'text', spacing: file!.document.designSystem?.spacing ?? 12, size: file!.document.designSystem?.fontSize ?? 16, ...(freeform() ? { frame: { x: 80, y: 80, width: 240, height: 160, rotation: 0 } } : {}), ...(kind === 'shape' ? { shape: 'rectangle' as const } : {}), ...(kind === 'model' ? { object3d: { primitive: 'box' as const, position: [0, 0, 0], rotation: [20, 30, 0], scale: [1, 1, 1] } } : {}) } }]); }, pending);
			}
			const node = selectedNode();
			if (node) {
				if (node.frame) {
					for (const property of ['x', 'y', 'width', 'height', 'rotation'] as const) {
						field(inspector, `Frame ${property}`, String(node.frame[property]), v => change([{ type: 'setAdvanced', id: node.id, frame: { ...node.frame!, [property]: Number(v) } }]), 'number');
					}
				}
				if (node.kind === 'shape') {
					select(inspector, 'Shape', ['rectangle', 'ellipse', 'line', 'arrow'].map(value => ({ value, label: value })), node.shape ?? 'rectangle', shape => change([{ type: 'setAdvanced', id: node.id, shape: shape as DesignNode['shape'] }]));
				}
				if (node.object3d) {
					const object = node.object3d;
					select(inspector, 'Primitive', ['box', 'sphere', 'cylinder', ...(object.primitive === 'mesh' ? ['mesh'] : [])].map(value => ({ value, label: value })), object.primitive, primitive => change([{ type: 'setAdvanced', id: node.id, object3d: { ...object, primitive: primitive as typeof object.primitive } }]));
					for (const property of ['position', 'rotation', 'scale'] as const) {
						for (let axis = 0; axis < 3; axis++) {
							field(inspector, `${property} ${'XYZ'[axis]}`, String(object[property][axis]), v => { const vector = [...object[property]]; vector[axis] = Number(v); change([{ type: 'setAdvanced', id: node.id, object3d: { ...object, [property]: vector } }]); }, 'number');
						}
					}
				}
				if (file.document.template === 'animation') {
					$('h3', inspector, `Keyframes · ${time.toFixed(2)}s`);
					let values = { time, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
					const existing = node.keyframes?.find(k => Math.abs(k.time - time) < .02);
					if (existing) {
						values = { ...existing };
					}
					for (const property of ['x', 'y', 'rotation', 'scale', 'opacity'] as const) {
						field(inspector, `Keyframe ${property}`, String(values[property]), v => { values[property] = Number(v); }, 'number');
					}
					button(inspector, 'Save Keyframe', () => { const keys = (node.keyframes ?? []).filter(k => Math.abs(k.time - time) >= .02); keys.push({ ...values, time }); keys.sort((a, b) => a.time - b.time); change([{ type: 'setAdvanced', id: node.id, keyframes: keys }]); }, pending);
					button(inspector, 'Delete Keyframe', () => change([{ type: 'setAdvanced', id: node.id, keyframes: (node.keyframes ?? []).filter(k => Math.abs(k.time - time) >= .02) }]), pending || !existing);
				}
				$('h3', inspector, node.id);
				field(inspector, 'Implementation file', node.sourcePath ?? '', sourcePath => change([{ type: 'setAdvanced', id: node.id, sourcePath: sourcePath.trim() }]));
				field(inspector, 'Text', node.text, text => change([{ type: 'setNode', id: node.id, text }]));
				select(inspector, 'Color token', Object.keys(file.document.tokens).map(value => ({ value, label: value })), node.token, token => change([{ type: 'setNode', id: node.id, token }]));
				const slider = (label: string, property: 'size' | 'spacing', max: number) => {
					const wrap = $('label', inspector);
					$('span', wrap, `${label}: ${node[property]}`);
					const input = $('input', wrap);
					input.type = 'range';
					input.min = property === 'size' ? '10' : '0';
					input.max = String(max);
					input.value = String(node[property]);
					input.oninput = () => {
						const element = preview.querySelector<HTMLElement>(`[data-node="${node.id}"]`);
						if (element)
							element.style[property === 'size' ? 'fontSize' : 'padding'] = `${input.value}px`;
					};
					input.onchange = () => change([{ type: 'setNode', id: node.id, [property]: Number(input.value) }]);
				};
				slider('Spacing', 'spacing', 80);
				slider('Text size', 'size', 72);
				select(inspector, 'On click', ['', 'navigate', 'overlay', 'close', 'back', 'submit', 'toggle'].map(value => ({ value, label: value || 'No action' })), node.action ?? '', action => change([{ type: 'setNode', id: node.id, action: action as DesignNode['action'], target: node.target ?? file!.document.screens[0].id }]));
				if (node.action && ['navigate', 'overlay', 'submit'].includes(node.action))
					select(inspector, 'Destination', file.document.screens.map(s => ({ value: s.id, label: s.title })), node.target ?? '', target => change([{ type: 'setNode', id: node.id, target }]));
				button(inspector, 'Move to top of screen', () => change([{ type: 'moveNode', id: node.id, screenId, index: 0 }]), pending);
				button(inspector, 'Delete element', () => change([{ type: 'removeNode', id: node.id }]), pending);
				const comment = field(inspector, 'Comment', '', () => { });
				button(inspector, 'Save comment', () => {
					if (comment.value.trim())
						change([{ type: 'comment', id: node.id, text: comment.value.trim() }]);
				}, pending);
				for (const entry of file.document.comments.filter(c => c.nodeId === node.id))
					$('p', inspector, `r${entry.revision}: ${entry.text}`);
			}
			$('h3', inspector, 'Project colors');
			for (const [token, value] of Object.entries(file.document.tokens)) {
				field(inspector, token, value, value => change([{ type: 'setToken', token, value }]), 'color');
			}
		}
		const status = $('footer', root, notice || `Saved · revision ${file.revision}`);
		status.id = 'design-status';
		status.setAttribute('role', 'status');
	}
	document.addEventListener('visibilitychange', () => { if (document.hidden) {
		cancelAnimationFrame(animationFrame);
		playMotion = false;
	}
	else if (file?.document.template === 'animation') {
		render();
	} });
	window.addEventListener('pagehide', () => cancelAnimationFrame(animationFrame));
	window.addEventListener('message', event => {
		const message = event.data;
		if (message?.documentId !== config.nonce)
			return;
		if (message.type === 'designResult') {
			const assetsChanged = message.assets && (Object.keys(message.assets).length !== Object.keys(config.assets).length || Object.keys(message.assets).some(key => message.assets[key] !== config.assets[key]));
			if (message.assets) {
				config.assets = message.assets;
			}
			if (message.file && file && message.file.revision <= file.revision && !pending && !message.error && !message.message && !assetsChanged)
				return;
			const active = document.activeElement;
			const draft = active instanceof HTMLInputElement && active.type === 'text' ? { label: active.getAttribute('aria-label'), value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
			pending = false;
			if (message.file && (!file || message.file.revision >= file.revision)) {
				file = message.file;
			}
			notice = message.error || message.message || '';
			render();
			if (draft?.label) {
				const input = Array.from(root.querySelectorAll('input')).find(el => el.getAttribute('aria-label') === draft.label);
				if (input) {
					input.value = draft.value;
					input.focus();
					input.setSelectionRange(draft.start, draft.end);
				}
			}
		}
	});
	render();
	requestAnimationFrame(() => requestAnimationFrame(() => send({ type: 'designReady' })));
}
export function getOpenideDesignHtml(nonce: string, file?: DesignFile, standalone = false, assets: Record<string, string> = {}, pages = false): string {
	const labels: Record<string, string> = {
		'File & delivery': t('openide.canvas.file_delivery'),
		'Export format': t('openide.canvas.export_format'),
		'Import Image': t('openide.canvas.import_image'),
		'Import Tokens': t('openide.canvas.import_tokens'),
		'Import OBJ': t('openide.canvas.import_obj'),
		'Zoom': t('openide.canvas.zoom'),
		'Select': t('openide.canvas.select'),
		'Draw': t('openide.canvas.draw'),
		'Duration': t('openide.canvas.duration'),
		'Pause Motion': t('openide.canvas.pause_motion'),
		'Play Motion': t('openide.canvas.play_motion'),
		'Time': t('openide.canvas.time'),
		'Shape': t('openide.canvas.shape'),
		'Primitive': t('openide.canvas.primitive'),
		'Save Keyframe': t('openide.canvas.save_keyframe'),
		'Delete Keyframe': t('openide.canvas.delete_keyframe'),
		'Implementation file': t('openide.canvas.implementation_file'),
		'Frame x': t('openide.canvas.frame_x'),
		'Frame y': t('openide.canvas.frame_y'),
		'Frame width': t('openide.canvas.frame_width'),
		'Frame height': t('openide.canvas.frame_height'),
		'Frame rotation': t('openide.canvas.frame_rotation'),
		'Keyframe x': t('openide.canvas.keyframe_x'),
		'Keyframe y': t('openide.canvas.keyframe_y'),
		'Keyframe rotation': t('openide.canvas.keyframe_rotation'),
		'Keyframe scale': t('openide.canvas.keyframe_scale'),
		'Keyframe opacity': t('openide.canvas.keyframe_opacity'),
		'position X': t('openide.canvas.position_x'),
		'position Y': t('openide.canvas.position_y'),
		'position Z': t('openide.canvas.position_z'),
		'rotation X': t('openide.canvas.rotation_x'),
		'rotation Y': t('openide.canvas.rotation_y'),
		'rotation Z': t('openide.canvas.rotation_z'),
		'scale X': t('openide.canvas.scale_x'),
		'scale Y': t('openide.canvas.scale_y'),
		'scale Z': t('openide.canvas.scale_z'),
		'Undo': t('openide.canvas.undo'),
		'Redo': t('openide.canvas.redo'),
		'Export HTML': t('openide.canvas.export_html'),
		'Capture editor': t('openide.canvas.capture_editor'),
		'Prepare Plan': t('openide.canvas.prepare_plan'),
		'Create GOAL': t('openide.canvas.create_goal'),
		'Screen title': t('openide.canvas.screen_title'),
		'Add screen': t('openide.canvas.add_screen'),
		'Delete screen': t('openide.canvas.delete_screen'),
		'Duplicate variant': t('openide.canvas.duplicate_variant'),
		'Fidelity': t('openide.canvas.fidelity'),
		'Viewport': t('openide.canvas.viewport'),
		'Color token': t('openide.canvas.color_token'),
		'Text': t('openide.canvas.text'),
		'Comment': t('openide.canvas.comment'),
		'Save comment': t('openide.canvas.save_comment'),
		'On click': t('openide.canvas.on_click'),
		'Destination': t('openide.canvas.destination'),
		'Delete element': t('openide.canvas.delete_element'),
		'Move to top of screen': t('openide.canvas.move_to_top_of_screen'),
		'Create Canvas': t('openide.canvas.create_canvas'),
		'Project title': t('openide.canvas.project_title'),
		'Device': t('openide.canvas.device'),
		'Design': t('openide.canvas.design'),
		'Play': t('openide.canvas.play'),
		'Whiteboard': t('openide.canvas.whiteboard'),
		'Animation': t('openide.canvas.animation'),
		'3D Scene': t('openide.canvas.3d_scene'),
	};
	Object.assign(labels, {
		'What should we create?': t('openide.canvas.request.0'),
		'Choose a format and take it to chat. You can add details before sending.': t('openide.canvas.request.1'),
		'Canvas format': t('openide.canvas.request.2'),
		'Project title (optional)': t('openide.canvas.request.3'),
		'What do you want to create? (optional)': t('openide.canvas.request.4'),
		'Continue in chat': t('openide.canvas.request.5'),
	});
	const data = JSON.stringify({ file, templates: DESIGN_TEMPLATES, nonce, standalone, assets, pages, labels }).replace(/</g, '\\u003c');
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';"><style nonce="${nonce}">
.file-menu{position:relative}.file-menu summary{cursor:pointer;padding:6px 10px;border-radius:4px;list-style:none}.file-menu summary:hover{background:var(--vscode-list-hoverBackground,#333)}.file-actions{position:absolute;right:0;top:100%;z-index:20;display:flex;flex-direction:column;width:230px;max-height:65vh;overflow:auto;padding:10px;background:var(--vscode-editor-background,#181818);border:1px solid var(--vscode-panel-border,#555);box-shadow:0 4px 16px #0005}.file-actions button{text-align:left}.file-actions label{margin:6px 0}header input[type=number]{width:70px}@page{size:landscape;margin:0}@media print{#design{display:block!important;height:auto!important;overflow:visible!important}.export-page{break-after:page;break-inside:avoid}.export-page:last-child{break-after:auto}}.export-page{overflow:hidden}.freeform{background-image:radial-gradient(#8884 1px,transparent 1px);background-size:20px 20px}.freeform .design-node{cursor:move}*{box-sizing:border-box}#design{display:flex;flex-direction:column;height:100vh;overflow:hidden}header,footer{flex-shrink:0}nav{overflow:auto}.gallery{overflow:auto;width:100%}body{margin:0;color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#181818);font:13px/1.5 system-ui}button,input,select{font:inherit}button{border:1px solid var(--vscode-panel-border,#555);border-radius:5px;padding:6px 10px;background:transparent;color:inherit;cursor:pointer}button:hover,button[aria-pressed=true],button[aria-current=true]{background:var(--vscode-list-hoverBackground,#333)}button:focus-visible,input:focus-visible,select:focus-visible,.design-node:focus-visible{outline:2px solid var(--vscode-focusBorder,#66aaff);outline-offset:2px}button:disabled{opacity:.5;cursor:default}header{display:flex;align-items:center;gap:8px;padding:12px;flex-wrap:wrap;border-bottom:1px solid #555}header strong{margin-right:auto}header label{display:flex;align-items:center;gap:6px}label{display:flex;flex-direction:column;gap:4px;margin:8px 0}input,select{padding:6px;border:1px solid #666;border-radius:4px;background:var(--vscode-input-background,#292929);color:inherit;min-width:0}h1{font-size:28px;font-weight:550}h2{font-size:15px}h3{font-size:13px;overflow-wrap:anywhere}nav{padding:16px;border-right:1px solid #555;display:flex;flex-direction:column;gap:8px}aside{padding:16px;overflow:auto;border-left:1px solid #555}aside input{width:100%}.workspace{display:grid;grid-template-columns:140px minmax(0,1fr) 220px;flex:1;min-height:0}.workspace.standalone,.workspace:has(.stage:last-child){grid-template-columns:140px minmax(0,1fr)}.stage{padding:16px;overflow:auto;min-width:0}.preview{min-height:600px;padding:24px;position:relative;margin:auto;font-family:system-ui;max-width:none}.design-node{min-width:0;overflow-wrap:anywhere;position:relative}.design-node.selected{outline:2px solid #3589e8;outline-offset:-2px}.design-node.kind-row>.design-node{flex:1}.design-node input{background:#fff;color:#222}.overlay{position:absolute;inset:0;background:#0008;display:flex;align-items:center;justify-content:center}.overlay>div{background:#fff;color:#222;padding:24px;max-width:90%;border-radius:8px}.add-elements{display:flex;flex-wrap:wrap;gap:5px}footer{position:sticky;bottom:0;padding:8px 16px;background:var(--vscode-editor-background,#181818);border-top:1px solid #555}.gallery{max-width:980px;margin:40px auto;padding:24px}.gallery>label{max-width:500px}.templates{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin:24px 0}.templates button{text-align:left;padding:16px}.templates strong,.templates small{display:block}.templates small{margin-top:6px;opacity:.7}.mini{height:100px;border:1px solid #777;padding:12px;margin-bottom:16px}.mini span{display:block;height:10px;background:#7776;margin-bottom:10px}.mini span:first-child{width:60%;height:18px}.mini.mobile{width:65px;margin-left:auto;margin-right:auto;border-radius:10px}.primary{background:var(--vscode-button-background,#327055);color:var(--vscode-button-foreground,#fff)}@media(max-width:650px){.workspace{grid-template-columns:110px minmax(0,1fr);grid-template-rows:minmax(200px,1fr) minmax(160px,.7fr)}aside{grid-column:1/-1;grid-row:2;border-top:1px solid #555}.stage{padding:12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
${standalone ? '' : OPENIDE_DESIGN_CHROME_CSS}
</style></head><body><div id="design"></div><script nonce="${nonce}">globalThis.__designAdvanced=(${createAdvancedDesignRuntime.toString()})((${createDesignGeometry.toString()})());globalThis.__design=${data};(${designRuntime.toString()})();</script></body></html>`;
}
