/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { OpenideChatComposerChips } from '../../browser/chat/openideChatComposerChips.js';
import { ModelRowRenderer, ModelSectionRenderer } from '../../browser/chat/openideChatModelPickerRows.js';
import { OpenideChatVoiceBar } from '../../browser/chat/openideChatVoiceBar.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { createMenuContent, createMenuEmpty, createMenuRow, createMenuSection, createMenuSeparator, OpenideComposerPopover } from '../../browser/chat/openideComposerMenu.js';
import { createOpenideElement } from '../../browser/openideDom.js';
import { createProviderIcon } from '../../browser/openideProviderIcons.js';

suite('OpenIDE auxiliary window DOM', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function auxiliaryDocument(): Document {
		const document = mainWindow.document.implementation.createHTMLDocument('Auxiliary window');
		// Match AuxiliaryWindowService's guard on this isolated document, without replacing a
		// global document or changing the test runner's window.
		document.createElement = () => { throw new Error('Auxiliary document creation is forbidden'); };
		return document;
	}

	test('shared menu and provider nodes retain main-context prototypes and auxiliary ownership', () => {
		const document = auxiliaryDocument();
		const nodes = [
			createMenuContent(document),
			createMenuEmpty(document, 'Empty'),
			createMenuSection(document, 'Models'),
			createMenuSeparator(document),
			createMenuRow(document, { label: 'Model', icon: 'check', detail: 'Detail', keybinding: 'Enter', submenu: true, active: true }),
			createProviderIcon(document, 'unrecognized-provider', 'Local'),
			createProviderIcon(document, 'openai'),
		];
		const elements = nodes.flatMap(node => [node, ...Array.from(node.querySelectorAll('*'))]);
		assert.deepStrictEqual(elements.map(element => ({ owner: element.ownerDocument === document, mainPrototype: element instanceof mainWindow.HTMLElement })), elements.map(() => ({ owner: true, mainPrototype: true })));
	});

	test('composer chips, recording controls and recycled model rows render in a guarded document', () => {
		const document = auxiliaryDocument();
		const host = createOpenideElement(document, 'div');
		document.body.appendChild(host);
		const chips = store.add(new OpenideChatComposerChips(host, NullHoverService, () => undefined, () => undefined));
		chips.addReference({ path: 'src/index.ts' });
		chips.addCapability({ kind: 'skill', name: 'review' });
		chips.addLinks(['https://example.com/']);
		const voice = store.add(new OpenideChatVoiceBar(host, NullHoverService, { cancel: () => undefined, stop: () => undefined, send: () => undefined }));
		voice.setState('recording');
		voice.setLevel(.5);
		const section = new ModelSectionRenderer(() => undefined).renderTemplate(host);
		store.add(section.store);
		const row = new ModelRowRenderer(() => undefined).renderTemplate(host);
		store.add(row.store);
		assert.deepStrictEqual({
			references: chips.references.length,
			capabilities: chips.capabilities.length,
			links: chips.links.length,
			voiceControls: voice.domNode.querySelectorAll('button').length,
			modelRows: host.querySelectorAll('.openide-mp-row').length,
			owned: Array.from(host.querySelectorAll('*')).every(element => element.ownerDocument === document),
		}, { references: 1, capabilities: 1, links: 1, voiceControls: 3, modelRows: 1, owned: true });
	});

	test('composer autocomplete can keep keyboard focus in its textarea', () => {
		const document = mainWindow.document;
		const host = createOpenideElement(document, 'div');
		host.className = 'monaco-workbench';
		document.body.appendChild(host);
		const anchor = createOpenideElement(document, 'div');
		const prompt = createOpenideElement(document, 'textarea');
		anchor.appendChild(prompt);
		host.appendChild(anchor);
		store.add({ dispose: () => host.remove() });
		let focusDelegate: (() => void) | undefined;
		const service = upcastPartial<IContextViewService>({
			showContextView: delegate => {
				focusDelegate = delegate.focus;
				return { close: () => delegate.onHide?.() };
			},
		});
		const popover = store.add(new OpenideComposerPopover(service));
		popover.show(anchor, { initialFocus: () => prompt.focus({ preventScroll: true }), render: () => undefined });
		focusDelegate?.();
		assert.strictEqual(document.activeElement, prompt);
	});

	test('popover uses the anchor workbench even when another window has focus', () => {
		const document = auxiliaryDocument();
		const workbench = createOpenideElement(document, 'div');
		workbench.className = 'monaco-workbench';
		document.body.appendChild(workbench);
		const anchor = createOpenideElement(document, 'button');
		workbench.appendChild(anchor);
		const containers: (HTMLElement | undefined)[] = [];
		const service = upcastPartial<IContextViewService>({
			showContextView: (delegate, container) => {
				containers.push(container);
				return { close: () => delegate.onHide?.() };
			},
		});
		const popover = store.add(new OpenideComposerPopover(service));
		popover.show(anchor, { render: () => undefined });
		const browserHost = createOpenideElement(document, 'div');
		popover.show(anchor, { container: browserHost, render: () => undefined });
		assert.deepStrictEqual(containers, [workbench, browserHost]);
	});
});
