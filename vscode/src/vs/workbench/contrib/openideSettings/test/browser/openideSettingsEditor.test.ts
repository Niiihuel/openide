/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { OpenideSettingsEditor } from '../../browser/openideSettingsEditor.js';
import { OpenideSettingsModel } from '../../browser/openideSettingsModel.js';
import { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../browser/openideSettingsSection.js';
import { IOpenideSettingItem, IOpenideSettingsNavigationEntry, IOpenideSettingsViewState } from '../../common/openideSettingsTypes.js';

/** Exercise the real rendering and lifecycle methods without constructing unrelated services. */
interface ITestableSettingsEditor {
	root: HTMLElement;
	content: HTMLElement;
	title: HTMLElement;
	count: HTMLElement;
	rowHovers: DisposableStore;
	rowWidgets: DisposableStore;
	modelListeners: DisposableStore;
	renderedSection: MutableDisposable<IDisposable>;
	sectionNeedsRender: boolean;
	settingsModel: Pick<OpenideSettingsModel, 'viewState' | 'items' | 'groupItems' | 'activeNavigationLabel' | 'surfaceMatchesQuery' | 'setState' | 'setModel'>;
	renderLimit: number;
	renderHandle: number | undefined;
	searchRender: { cancel(): void };
	_input: object | undefined;
	sectionForCategory(category: string): IOpenideSettingsSection | undefined;
	sectionNavigationEntry(category: string): IOpenideSettingsNavigationEntry | undefined;
	renderBreadcrumb(): void;
	renderRow(parent: HTMLElement, item: IOpenideSettingItem): void;
	renderAll(): void;
	renderItems(): void;
	scheduleRender(reset: boolean): void;
	setEditorVisible(visible: boolean): void;
	clearInput(): void;
}

suite('OpenIDE Settings live section retention', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(retainOnRefresh = true) {
		const root = document.body.appendChild($('.openide-settings'));
		store.add(toDisposable(() => root.remove()));
		const contexts: IOpenideSettingsSectionContext[] = [];
		let disposals = 0;
		let nativeRows: IOpenideSettingItem[] = [];
		const state: IOpenideSettingsViewState = { category: 'openideAgent/providers', query: '', target: ConfigurationTarget.USER_LOCAL };
		const createSection = (): IOpenideSettingsSection => ({
			ownedSettings: [], ...(retainOnRefresh ? { retainOnRefresh: true } : {}),
			render: (container, context) => {
				contexts.push(context);
				append(container, $('input.provider-key', { type: 'text', 'aria-label': 'Fixture key' }));
				return toDisposable(() => { disposals++; });
			},
			dispose: () => { },
		});
		let section: IOpenideSettingsSection | undefined = createSection();
		const editor = Object.create(OpenideSettingsEditor.prototype) as ITestableSettingsEditor;
		editor.root = root;
		editor.content = append(root, $('.openide-settings-list'));
		editor.title = append(root, $('h1'));
		editor.count = append(root, $('span'));
		editor.rowHovers = store.add(new DisposableStore());
		editor.rowWidgets = store.add(new DisposableStore());
		editor.modelListeners = store.add(new DisposableStore());
		editor.renderedSection = store.add(new MutableDisposable<IDisposable>());
		editor.sectionNeedsRender = false;
		editor.renderLimit = 180;
		editor.renderHandle = undefined;
		editor.searchRender = { cancel: () => { } };
		editor._input = {};
		editor.settingsModel = {
			viewState: state,
			items: () => nativeRows,
			groupItems: items => items.length ? [{ label: 'Native settings', items: [...items] }] : [],
			activeNavigationLabel: 'Providers',
			surfaceMatchesQuery: () => false,
			setState: next => { Object.assign(state, next); },
			setModel: () => { },
		};
		editor.sectionForCategory = () => section;
		editor.sectionNavigationEntry = () => undefined;
		editor.renderBreadcrumb = () => { };
		editor.renderRow = (parent, item) => { append(parent, $('.native-row', undefined, item.key)); };
		editor.renderAll = () => editor.renderItems();
		store.add(toDisposable(() => {
			if (editor.renderHandle !== undefined) { cancelAnimationFrame(editor.renderHandle); }
		}));
		return {
			editor, state, contexts, disposals: () => disposals,
			input: () => editor.content.querySelector<HTMLInputElement>('input.provider-key')!,
			setRows: (present: boolean) => { nativeRows = present ? [upcastPartial<IOpenideSettingItem>({ key: 'fixture.native' })] : []; },
			replaceSection: () => { section = createSection(); },
			removeSection: () => { section = undefined; },
		};
	}

	async function nextFrame(): Promise<void> {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
	}

	test('refreshing the same live section preserves the input, focus, selection and draft', () => {
		const f = fixture();
		f.editor.renderItems();
		const input = f.input();
		input.value = 'fixture-secret'; input.focus(); input.setSelectionRange(3, 9);
		f.editor.renderItems(); f.editor.renderItems();
		assert.deepStrictEqual({
			renders: f.contexts.length, disposals: f.disposals(), sameNode: f.input() === input,
			focused: document.activeElement === input, value: f.input().value,
			selection: [input.selectionStart, input.selectionEnd],
		}, { renders: 1, disposals: 0, sameNode: true, focused: true, value: 'fixture-secret', selection: [3, 9] });
	});

	test('a category, search query or scope change remounts the section', () => {
		const f = fixture();
		f.editor.renderItems();
		const nodes = [f.input()];
		f.state.category = 'openideAgent/providers/local'; f.editor.renderItems(); nodes.push(f.input());
		f.state.query = 'local'; f.editor.renderItems(); nodes.push(f.input());
		f.state.target = ConfigurationTarget.WORKSPACE; f.editor.renderItems(); nodes.push(f.input());
		assert.deepStrictEqual({
			uniqueNodes: new Set(nodes).size, disposals: f.disposals(),
			contexts: f.contexts.map(context => [context.category, context.query, context.scope]),
		}, {
			uniqueNodes: 4, disposals: 3,
			contexts: [
				['openideAgent/providers', '', 'user'], ['openideAgent/providers/local', '', 'user'],
				['openideAgent/providers/local', 'local', 'user'], ['openideAgent/providers/local', 'local', 'workspace'],
			],
		});
	});

	test('only an explicitly opted-in section can retain its DOM', () => {
		const f = fixture(false);
		f.editor.renderItems();
		const input = f.input();
		f.editor.renderItems();
		assert.deepStrictEqual({ renders: f.contexts.length, replaced: f.input() !== input, disposals: f.disposals() }, { renders: 2, replaced: true, disposals: 1 });
	});

	test('native rows always refresh and are removed when a page becomes section-only', () => {
		const f = fixture();
		f.setRows(true); f.editor.renderItems();
		const input = f.input();
		f.editor.renderItems();
		assert.notStrictEqual(f.input(), input);
		f.setRows(false); f.editor.renderItems();
		assert.deepStrictEqual({ renders: f.contexts.length, nativeRows: f.editor.content.querySelectorAll('.native-row').length, disposals: f.disposals() }, { renders: 3, nativeRows: 0, disposals: 2 });
		const retained = f.input();
		f.editor.renderItems();
		assert.strictEqual(f.input(), retained);
	});

	test('replacing a section instance or navigating away releases its render resources', () => {
		const f = fixture();
		f.editor.renderItems();
		const input = f.input();
		f.replaceSection(); f.editor.renderItems();
		assert.notStrictEqual(f.input(), input);
		f.removeSection(); f.editor.renderItems();
		assert.deepStrictEqual({ inputs: f.editor.content.querySelectorAll('input').length, disposals: f.disposals() }, { inputs: 0, disposals: 2 });
	});

	test('an explicit reset invalidates retention while an ordinary scheduled refresh preserves it', async () => {
		const f = fixture();
		f.editor.renderItems();
		const input = f.input();
		f.editor.scheduleRender(false); await nextFrame();
		assert.strictEqual(f.input(), input);
		f.editor.scheduleRender(true); await nextFrame();
		assert.deepStrictEqual({ replaced: f.input() !== input, renders: f.contexts.length, disposals: f.disposals() }, { replaced: true, renders: 2, disposals: 1 });
	});

	test('hiding a resource-owning section disposes it and remounts on reveal', () => {
		const f = fixture();
		f.editor.renderItems();
		const input = f.input();
		f.editor.setEditorVisible(false);
		assert.strictEqual(f.disposals(), 1);
		f.editor.setEditorVisible(true);
		assert.deepStrictEqual({ replaced: f.input() !== input, renders: f.contexts.length, pending: f.editor.sectionNeedsRender }, { replaced: true, renders: 2, pending: false });
	});

	test('clearing the input releases the section and invalidates retained DOM', () => {
		const f = fixture();
		f.editor.renderItems();
		const input = f.input();
		f.editor.clearInput();
		f.editor._input = {};
		f.editor.renderItems();
		assert.deepStrictEqual({ replaced: f.input() !== input, renders: f.contexts.length, disposals: f.disposals() }, { replaced: true, renders: 2, disposals: 1 });
	});
});
