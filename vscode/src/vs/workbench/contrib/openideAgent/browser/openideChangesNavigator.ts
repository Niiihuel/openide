/* Copyright (c) OpenIDE. Licensed under the MIT License. */

import { t } from './../common/openideStrings.js';
import { $, append } from '../../../../base/browser/dom.js';
import { IObjectTreeElement, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchObjectTree } from '../../../../platform/list/browser/listService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { createFileIconThemableTreeContainerScope } from '../../files/browser/views/explorerView.js';
import type { IOpenideReviewFile } from './openideChangesEditor.js';

interface ChangeNode { id: string; name: string; resource: URI; file?: IOpenideReviewFile; children: Map<string, ChangeNode> }
interface Template { label: IResourceLabel; totals: HTMLElement }
class ChangeRenderer implements ITreeRenderer<ChangeNode, FuzzyScore, Template> {
	readonly templateId = 'openideChangeFile';
	constructor(private readonly labels: ResourceLabels) { }
	renderTemplate(container: HTMLElement): Template {
		container.classList.add('openide-changes-tree-row');
		return { label: this.labels.create(append(container, $('.openide-changes-tree-label'))), totals: append(container, $('.openide-changes-tree-totals')) };
	}
	renderElement(node: ITreeNode<ChangeNode, FuzzyScore>, _index: number, template: Template): void {
		const { file, resource, name } = node.element;
		template.label.setResource({ resource, name }, { fileKind: file ? FileKind.FILE : FileKind.FOLDER, fileDecorations: { colors: true, badges: true } });
		template.totals.replaceChildren();
		if (file?.added !== undefined) { append(template.totals, $('span.openide-agent-window-changes-added', undefined, `+${file.added}`)); }
		if (file?.removed !== undefined) { append(template.totals, $('span.openide-agent-window-changes-removed', undefined, `−${file.removed}`)); }
	}
	disposeTemplate(template: Template): void { template.label.dispose(); }
}

/** Native virtualized file tree. Filtering never discards the user's folder state. */
export class OpenideChangesNavigator extends Disposable {
	readonly domNode: HTMLElement;
	private readonly tree: WorkbenchObjectTree<ChangeNode, FuzzyScore>;
	private updating = false;
	private width = -1;
	private height = -1;
	private readonly leaves = new Map<string, ChangeNode>();
	private collapsed = new Set<string>();
	constructor(parent: HTMLElement, open: (file: IOpenideReviewFile) => void,
		@IInstantiationService instantiation: IInstantiationService,
		@IThemeService theme: IThemeService,
	) {
		super();
		this.domNode = append(parent, $('.openide-changes-navigator'));
		this._register(createFileIconThemableTreeContainerScope(this.domNode, theme));
		const labels = this._register(instantiation.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		this.tree = this._register(instantiation.createInstance(WorkbenchObjectTree<ChangeNode, FuzzyScore>, 'OpenideChangesNavigator', this.domNode,
			{ getHeight: () => 28, getTemplateId: () => 'openideChangeFile' }, [new ChangeRenderer(labels)], {
				identityProvider: { getId: node => node.id },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: node => node.name },
				accessibilityProvider: { getWidgetAriaLabel: () => t('openide.review.tree'), getAriaLabel: node => node.file?.path ?? node.name },
				multipleSelectionSupport: false, horizontalScrolling: false,
			}));
		this._register(this.tree.onDidOpen(event => { if (event.element?.file) { open(event.element.file); } }));
		this._register(this.tree.onDidChangeCollapseState(event => {
			if (this.updating || !event.node.element) { return; }
			if (event.node.collapsed) { this.collapsed.add(event.node.element.id); } else { this.collapsed.delete(event.node.element.id); }
		}));
	}
	setFiles(files: readonly IOpenideReviewFile[], collapsed: Set<string>, filtering: boolean): void {
		this.collapsed = collapsed;
		const roots = new Map<string, ChangeNode>();
		this.leaves.clear();
		// Absolute paths share a workspace prefix; omit that prefix from the visual tree.
		const paths = files.map(file => file.path.replace(/\\/g, '/').split('/').filter(Boolean));
		let prefix = 0;
		if (files.length && files.every(file => file.path.startsWith('/'))) {
			while (paths.every(parts => parts.length > prefix + 1 && parts[prefix] === paths[0][prefix])) { prefix++; }
		}
		files.forEach((file, index) => {
			const parts = paths[index].slice(prefix); let children = roots;
			for (let depth = 0; depth < parts.length; depth++) {
				const leaf = depth === parts.length - 1;
				const id = leaf ? file.resource.toString() : paths[index].slice(0, prefix + depth + 1).join('/');
				let node = children.get(id);
				if (!node) {
					let resource = file.resource;
					for (let up = parts.length - 1; up > depth; up--) { resource = dirname(resource); }
					node = { id, name: parts[depth], resource, file: leaf ? file : undefined, children: new Map() }; children.set(id, node);
				}
				if (leaf) { this.leaves.set(file.resource.toString(), node); }
				children = node.children;
			}
		});
		const elements = (nodes: Map<string, ChangeNode>): IObjectTreeElement<ChangeNode>[] => [...nodes.values()]
			.sort((a, b) => Number(!!a.file) - Number(!!b.file) || compareFileNames(a.name, b.name))
			.map(node => ({ element: node, collapsible: !node.file, collapsed: !filtering && collapsed.has(node.id), children: elements(node.children) }));
		this.updating = true;
		try { this.tree.setChildren(null, elements(roots)); } finally { this.updating = false; }
		this.layout();
	}
	updateStats(files: readonly IOpenideReviewFile[]): void {
		for (const file of files) { const node = this.leaves.get(file.resource.toString()); if (node) { node.file = file; } }
		this.tree.rerender();
	}
	layout(): void {
		const width = this.domNode.clientWidth; const height = this.domNode.clientHeight;
		if (width === this.width && height === this.height) { return; }
		this.width = width; this.height = height;
		this.tree.layout(height, width);
	}
}
