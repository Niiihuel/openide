/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import '../../browser/chat/media/openideChatMenus.css';
import { Emitter } from '../../../../../base/common/event.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewDelegate, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { OpenideChatModelPicker } from '../../browser/chat/openideChatModelPicker.js';
import { IOpenidePickerGroup, IOpenidePickerModel } from '../../common/openidePickerModels.js';

suite('OpenIDE ChatModelPicker selection', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the virtual viewport bounded through filtering, compressed frames and resize', async () => {
		const models: IOpenidePickerModel[] = Array.from({ length: 60 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index}`, context: '', toolCall: true, reasoning: false, input: [], output: [], costIn: '', costOut: '', hasCost: false, efforts: [], toggle: false }));
		const group: IOpenidePickerGroup = { id: 'provider', label: 'Provider', defaultModel: models[0].id, models };
		const service: ConstructorParameters<typeof OpenideChatModelPicker>[0] = {
			describeModel: () => group.models[0], getConnectedModelGroups: async () => [group], getActiveProviderId: () => group.id, getModel: () => models[0].id,
			getReasoningEfforts: () => ({}), getReasoningEffort: () => '', setReasoningEffort: async () => { },
			getFastMode: () => false, getFastModeCapability: () => ({ supported: false }), setFastMode: async () => { },
			getCollapsedSections: () => [], getPickerFavorites: () => [], getPickerRecents: () => [],
			toggleCollapsedSection: async () => { }, togglePickerFavorite: async () => { }, findProvider: () => undefined,
			setActiveProvider: async () => { }, setModel: async () => { }, recordPickerUse: async () => { },
		};
		const anchor = document.createElement('button');
		document.body.appendChild(anchor);
		store.add({ dispose: () => anchor.remove() });
		let panel!: HTMLElement;
		const context = {
			showContextView(delegate: IContextViewDelegate) {
				panel = document.createElement('div');
				panel.style.cssText = 'width:320px;max-height:420px;--oi-scroll-inset:6px;--oi-radius-item:7px;--oi-radius-control:7px;--oi-radius-popover:12px;';
				document.body.appendChild(panel);
				const rendered = delegate.render(panel);
				return { close: () => { rendered.dispose(); panel.remove(); delegate.onHide?.(); } };
			}, layout() { },
		} as unknown as IContextViewService;
		const picker = store.add(new OpenideChatModelPicker(service, context, {} as ICommandService, () => { }, { choose: async () => { } }));
		picker.toggle(anchor);
		await timeout(0);
		const host = panel.querySelector<HTMLElement>('.openide-mp-list')!;
		const body = panel.querySelector<HTMLElement>('.openide-mp-models-content')!;
		const input = panel.querySelector<HTMLInputElement>('.openide-menu-search')!;
		const filter = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
		const searchRow = panel.querySelector<HTMLElement>('.openide-menu-search-row')!;
		const footer = panel.querySelector<HTMLElement>('.openide-mp-foot')!;
		const firstRow = host.querySelector<HTMLElement>('.openide-mp-row')!;
		const footerRow = footer.querySelector<HTMLElement>('.openide-menu-row')!;
		assert.strictEqual(getComputedStyle(panel).borderRadius, '12px');
		assert.strictEqual(getComputedStyle(firstRow).borderRadius, '7px');
		assert.strictEqual(getComputedStyle(searchRow).borderRadius, '7px');
		assert.strictEqual(getComputedStyle(footer).borderTopWidth, '0px', 'Footer has no independent full-width divider');
		assert.ok(Math.abs(firstRow.getBoundingClientRect().left - footerRow.getBoundingClientRect().left) <= 1, 'List and footer actions share an inset');
		assert.ok(Math.abs(searchRow.getBoundingClientRect().left - firstRow.getBoundingClientRect().left) <= 1, 'Search aligns with the shared rows');
		const bounded = () => {
			assert.ok(host.offsetHeight > 0 && host.offsetHeight < 420, `Bounded viewport, got ${host.offsetHeight}`);
			assert.ok(host.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1, 'The list fits inside its body');
			assert.strictEqual(body.scrollTop, 0, 'Search/header never scroll with the models');
		};
		bounded();
		const initialHeight = host.offsetHeight;
		// A morph compresses the body before a provider event or keystroke repaints it.
		panel.style.height = '120px';
		for (let index = 0; index < 5; index++) { filter('Model'); }
		panel.style.removeProperty('height');
		bounded();
		assert.strictEqual(host.offsetHeight, initialHeight, 'Repeated paints cannot inflate their own height budget');
		filter('Model 59');
		assert.ok(host.offsetHeight < initialHeight);
		filter('missing model');
		assert.strictEqual(host.offsetHeight, 0);
		filter('');
		bounded();
		panel.style.maxHeight = '260px';
		await timeout(100);
		bounded();
		assert.ok(host.offsetHeight < initialHeight, 'Container resize recomputes the viewport without a keystroke');
		panel.style.maxHeight = '420px';
		window.dispatchEvent(new Event('resize'));
		assert.strictEqual(host.offsetHeight, initialHeight, 'A larger viewport restores the available list space');
		const headerTop = input.getBoundingClientRect().top;
		for (let index = 0; index < 60; index++) {
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
		}
		assert.ok(Array.from(host.querySelectorAll('.openide-mp-name')).some(row => row.textContent === 'Model 59'), 'Navigation can reveal the last virtual model');
		assert.strictEqual(input.getBoundingClientRect().top, headerTop);
		bounded();
	});

	test('serializes provider and model changes across close and reopen without navigating the new menu', async () => {
		const pending = new DeferredPromise<void>();
		const calls: string[] = [];
		let provider = 'first';
		let model = 'a';
		const makeModel = (id: string): IOpenidePickerModel => ({ id, name: id, context: '', toolCall: true, reasoning: false, input: [], output: [], costIn: '', costOut: '', hasCost: false, efforts: [], toggle: false });
		const groups: IOpenidePickerGroup[] = [
			{ id: 'first', label: 'First', defaultModel: 'default', models: [makeModel('a')] },
			{ id: 'second', label: 'Second', defaultModel: 'default', models: [makeModel('b')] },
		];
		const service: ConstructorParameters<typeof OpenideChatModelPicker>[0] = {
			describeModel: () => groups[0].models[0], getConnectedModelGroups: async () => groups,
			getActiveProviderId: () => provider,
			getModel: () => model,
			getFastMode: () => false, getFastModeCapability: () => ({ supported: false }), setFastMode: async () => { calls.push('unexpected-fast'); },
			getReasoningEfforts: () => ({}), getReasoningEffort: () => '', setReasoningEffort: async () => { },
			getCollapsedSections: () => [], getPickerFavorites: () => [], getPickerRecents: () => [],
			toggleCollapsedSection: async () => { }, togglePickerFavorite: async () => { },
			findProvider: () => undefined,
			setActiveProvider: async id => { calls.push(`provider:${id}`); await pending.p; provider = id; },
			setModel: async id => { calls.push(`model:${provider}/${id}`); model = id; },
			recordPickerUse: async () => { },
		};
		const anchor = document.createElement('button');
		document.body.appendChild(anchor);
		store.add({ dispose: () => anchor.remove() });
		let panel: HTMLElement;
		const context = {
			showContextView(delegate: IContextViewDelegate) {
				panel = document.createElement('div');
				panel.style.width = '320px';
				document.body.appendChild(panel);
				const node = panel;
				const rendered = delegate.render(node);
				return { close: () => { rendered.dispose(); node.remove(); delegate.onHide?.(); } };
			},
			layout() { },
		} as unknown as IContextViewService;
		const picker = store.add(new OpenideChatModelPicker(service, context, {} as ICommandService, () => { }));
		const openModels = async () => {
			picker.toggle(anchor);
			await timeout(0);
			assert.strictEqual(panel.querySelector('.openide-mp-advanced'), null);
			assert.strictEqual(panel.querySelector('.openide-mp-effort-slider'), null);
			const fast = panel.querySelector<HTMLButtonElement>('.openide-mp-fast')!;
			assert.strictEqual(fast.getAttribute('aria-disabled'), 'true'); fast.click();
			panel.querySelector<HTMLButtonElement>('.openide-mp-model-toggle')!.click();
		};
		const choose = (name: string) => {
			const row = Array.from(panel.querySelectorAll<HTMLElement>('.openide-mp-name')).find(element => element.textContent === name);
			assert.ok(row, `Model ${name} should be visible`);
			row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		};

		await openModels();
		const list = panel!.querySelector<HTMLElement>('.openide-mp-list')!;
		const hovered = Array.from(list.querySelectorAll<HTMLElement>('.openide-mp-name')).find(row => row.textContent === 'b')!;
		hovered.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		assert.ok(list.querySelector('.monaco-list-row.focused'));
		list.dispatchEvent(new MouseEvent('mouseleave'));
		assert.strictEqual(list.querySelector('.monaco-list-row.focused'), null, 'Moving the pointer to the footer clears mouse focus');
		panel!.querySelector<HTMLInputElement>('.openide-menu-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
		const keyboardFocus = list.querySelector('.monaco-list-row.focused');
		assert.ok(keyboardFocus);
		assert.strictEqual(list.classList.contains('openide-mp-keyboard-focus'), true);
		list.dispatchEvent(new MouseEvent('mouseleave'));
		assert.strictEqual(list.querySelector('.monaco-list-row.focused'), keyboardFocus, 'Pointer exit preserves actual arrow-key focus');
		hovered.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		assert.strictEqual(list.classList.contains('openide-mp-keyboard-focus'), false);
		list.dispatchEvent(new MouseEvent('mouseleave'));
		choose('b');
		choose('a');
		assert.deepStrictEqual(calls, ['provider:second']);
		picker.close();
		await openModels();
		assert.strictEqual(panel!.getAttribute('aria-busy'), 'true');
		choose('a');
		assert.deepStrictEqual(calls, ['provider:second']);
		await pending.complete();
		await timeout(0);
		assert.deepStrictEqual(calls, ['provider:second', 'model:second/b']);
		assert.strictEqual(panel!.getAttribute('aria-busy'), 'false');
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-panel')!.hidden, true);
		choose('a');
		await timeout(0);
		assert.deepStrictEqual(calls, ['provider:second', 'model:second/b', 'provider:first', 'model:first/a']);
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-panel')!.hidden, false);
	});

	test('refreshes a cold selected model when discovery supplies its reasoning levels', async () => {
		const discovery = new DeferredPromise<IOpenidePickerGroup[]>();
		const model: IOpenidePickerModel = { id: 'reasoner', name: 'Reasoner', context: '', toolCall: true, reasoning: true, input: [], output: [], costIn: '', costOut: '', hasCost: false, efforts: ['low', 'high'], toggle: false };
		const group: IOpenidePickerGroup = { id: 'provider', label: 'Provider', defaultModel: model.id, models: [model] };
		const service: ConstructorParameters<typeof OpenideChatModelPicker>[0] = {
			describeModel: () => ({ ...model, efforts: [] }), getConnectedModelGroups: () => discovery.p,
			getActiveProviderId: () => group.id, getModel: () => model.id,
			findProvider: () => ({ id: group.id, label: group.label, company: 'Fixture', protocol: 'openai', auth: 'apiKey', defaultModel: model.id }),
			getReasoningEfforts: () => ({}), getReasoningEffort: () => 'high', setReasoningEffort: async () => { },
			getFastMode: () => false, getFastModeCapability: () => ({ supported: false }), setFastMode: async () => { },
			getCollapsedSections: () => [], getPickerFavorites: () => [], getPickerRecents: () => [],
			toggleCollapsedSection: async () => { }, togglePickerFavorite: async () => { },
			setActiveProvider: async () => { }, setModel: async () => { }, recordPickerUse: async () => { },
		};
		const anchor = document.createElement('button'); document.body.append(anchor);
		store.add({ dispose: () => anchor.remove() });
		let panel!: HTMLElement;
		const context = {
			showContextView(delegate: IContextViewDelegate) {
				panel = document.createElement('div'); document.body.append(panel);
				const rendered = delegate.render(panel);
				return { close: () => { rendered.dispose(); panel.remove(); delegate.onHide?.(); } };
			}, layout() { },
		} as unknown as IContextViewService;
		const picker = store.add(new OpenideChatModelPicker(service, context, {} as ICommandService, () => { }));
		picker.toggle(anchor);
		assert.strictEqual(panel.querySelector('.openide-mp-effort-model')?.textContent, model.name);
		assert.strictEqual(panel.querySelector('.openide-mp-effort-slider'), null);
		await discovery.complete([group]); await timeout(0);
		assert.ok(panel.querySelector('.openide-mp-effort-slider'), 'Late catalog metadata enables the supported levels');
		assert.strictEqual(panel.querySelector<HTMLInputElement>('.openide-mp-effort-slider')!.value, '2');
	});

	test('reset updates the saved slider in place through service events and native click bubbling, preserving Fast', async () => {
		const discovery = new DeferredPromise<IOpenidePickerGroup[]>();
		const changes = store.add(new Emitter<void>());
		let serviceChanges = 0;
		let fastMode = false;
		let effort = 'low';
		const writes: string[] = [];
		const model: IOpenidePickerModel = { id: 'reasoner', name: 'Reasoner', context: '', toolCall: true, reasoning: true, input: [], output: [], costIn: '', costOut: '', hasCost: false, efforts: ['low', 'high'], toggle: false };
		const group: IOpenidePickerGroup = { id: 'priority-provider', label: 'Priority', defaultModel: model.id, models: [model] };
		const service: ConstructorParameters<typeof OpenideChatModelPicker>[0] = {
			describeModel: () => group.models[0], getConnectedModelGroups: () => discovery.p, getActiveProviderId: () => group.id, getModel: () => model.id,
			getReasoningEfforts: () => ({}), getReasoningEffort: () => effort,
			setReasoningEffort: async (value, provider, modelId) => { effort = value; writes.push(`effort:${provider}/${modelId}:${value}`); changes.fire(); },
			getFastMode: () => fastMode, getFastModeCapability: () => ({ supported: true, serviceTier: 'priority' }),
			setFastMode: async (enabled, provider, modelId) => { fastMode = enabled; writes.push(`fast:${provider}/${modelId}:${enabled}`); changes.fire(); },
			getCollapsedSections: () => [], getPickerFavorites: () => [], getPickerRecents: () => [],
			toggleCollapsedSection: async () => { }, togglePickerFavorite: async () => { }, findProvider: () => ({ id: group.id, label: group.label, company: 'Fixture', protocol: 'openai', auth: 'apiKey', defaultModel: model.id }),
			setActiveProvider: async () => { }, setModel: async () => { }, recordPickerUse: async () => { },
		};
		const anchor = document.createElement('button'); document.body.append(anchor);
		store.add({ dispose: () => anchor.remove() });
		store.add(changes.event(() => { serviceChanges++; anchor.textContent = `${effort}:${fastMode}`; }));
		let panel: HTMLElement;
		let nativeDelegate: IContextViewDelegate;
		const context = {
			showContextView(delegate: IContextViewDelegate) {
				nativeDelegate = delegate;
				panel = document.createElement('div'); panel.style.width = '260px'; document.body.append(panel);
				const node = panel; const rendered = delegate.render(node);
				node.addEventListener('keydown', event => delegate.onDOMEvent?.(event, node));
				return { close: () => { rendered.dispose(); node.remove(); delegate.onHide?.(); } };
			}, layout() { },
		} as unknown as IContextViewService;
		const picker = store.add(new OpenideChatModelPicker(service, context, {} as ICommandService, () => { }));
		picker.toggle(anchor);
		const initialSlider = panel!.querySelector('.openide-mp-effort-slider');
		assert.ok(initialSlider, 'The selected model controls render before provider discovery resolves');
		assert.strictEqual(panel!.querySelector('[role="status"]'), null);
		await discovery.complete([group]);
		await timeout(0);
		assert.strictEqual(panel!.querySelector('.openide-mp-effort-slider'), initialSlider, 'Discovery keeps the controls and focus stable');
		assert.strictEqual(panel!.querySelector('.openide-mp-advanced'), null);
		assert.strictEqual(panel!.querySelector('.openide-mp-effort-back'), null);
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-track')!.classList.contains('is-fast'), false);
		const fast = panel!.querySelector<HTMLButtonElement>('.openide-mp-fast')!;
		assert.strictEqual(fast.getAttribute('aria-pressed'), 'false'); fast.click();
		await timeout(0);
		assert.deepStrictEqual(writes, ['fast:priority-provider/reasoner:true']);
		assert.strictEqual(panel!.querySelector<HTMLButtonElement>('.openide-mp-fast')!.getAttribute('aria-pressed'), 'true');
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-track')!.classList.contains('is-fast'), true);
		const reset = panel!.querySelector<HTMLButtonElement>('.openide-mp-reset')!;
		const slider = panel!.querySelector<HTMLInputElement>('.openide-mp-effort-slider')!;
		let resetClick: Event | undefined;
		reset.addEventListener('click', event => { resetClick = event; }, { once: true });
		reset.focus(); reset.click(); await timeout(0);
		assert.ok(resetClick);
		// Browsers can process resolved promises between native bubbling listeners. Deliver the
		// original target after service events and the awaited update, as ContextView receives it.
		nativeDelegate!.onDOMEvent?.(resetClick, panel!);
		assert.strictEqual(panel!.isConnected, true, 'Reset remains inside the same open context view');
		assert.strictEqual(panel!.querySelector('.openide-mp-reset'), reset);
		assert.strictEqual(panel!.querySelector('.openide-mp-effort-slider'), slider);
		assert.strictEqual(document.activeElement, slider);
		assert.strictEqual(serviceChanges, 2);
		assert.deepStrictEqual(writes, ['fast:priority-provider/reasoner:true', 'effort:priority-provider/reasoner:']);
		assert.strictEqual(slider.value, '0');
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-track')!.classList.contains('is-fast'), true);
		assert.strictEqual(reset.disabled, true);
		// A later edit is committed normally; synchronizing Reset must update the slider's own
		// committed value as well as its DOM, otherwise choosing the old level would be ignored.
		slider.value = '1'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change'));
		await timeout(0);
		assert.strictEqual(writes[writes.length - 1], 'effort:priority-provider/reasoner:low');
		assert.strictEqual(reset.disabled, false);
		panel!.querySelector<HTMLButtonElement>('.openide-mp-model-toggle')!.click();
		panel!.querySelector<HTMLInputElement>('.openide-menu-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.strictEqual(panel!.querySelector<HTMLElement>('.openide-mp-effort-panel')!.hidden, false);
		panel!.querySelector<HTMLButtonElement>('.openide-mp-model-toggle')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.strictEqual(panel!.isConnected, false);
		assert.strictEqual(document.activeElement, anchor);
	});

});
