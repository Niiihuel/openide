/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OpenideChatConfirmationPart } from '../../browser/chat/parts/openideChatConfirmationPart.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { IOpenideChatConfirmationContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatContentPartContext } from '../../browser/chat/openideChatContentPart.js';
import { t } from '../../common/openideStrings.js';

/**
 * The approval card, which is the one part whose absence HANGS the product.
 *
 * The agent is parked on a promise until this resolves: a card that does not render, or a button
 * that resolves with the wrong string, is not a cosmetic bug — it is a turn that can never finish.
 *
 * Deterministic on purpose. It cannot be exercised end-to-end against a real model unless the
 * profile's permission mode is `ask`; with `auto-edit` or `auto-all` the engine never asks, so a
 * scenario run would silently prove nothing.
 */
suite('OpenIDE ChatConfirmationPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function content(overrides: Partial<IOpenideChatConfirmationContent> = {}): IOpenideChatConfirmationContent {
		return {
			kind: 'confirmation',
			requestId: 'req-1',
			tool: 'run_command',
			title: 'Ejecutar comando',
			detail: 'en el workspace',
			command: 'rm -rf build',
			risk: 'exec',
			...overrides,
		} as IOpenideChatConfirmationContent;
	}

	const menus = new WeakMap<OpenideChatConfirmationPart, HTMLElement>();
	function create(overrides: Partial<IOpenideChatConfirmationContent> = {}) {
		const resolved: { id: string; decision: string }[] = [];
		const agentService = {
			resolveApproval: (id: string, decision: string) => { resolved.push({ id, decision }); },
		} as unknown as IOpenideAgentService;
		const menu = document.createElement('div');
		const contextView = {
			showContextView(delegate: Parameters<IContextViewService['showContextView']>[0]) {
				const rendered = delegate.render(menu);
				return { close() { rendered?.dispose(); menu.replaceChildren(); delegate.onHide?.(); } };
			},
		} as unknown as IContextViewService;
		const part = store.add(new OpenideChatConfirmationPart(
			content(overrides),
			{} as IOpenideChatContentPartContext,
			agentService,
			contextView,
		));
		menus.set(part, menu);
		return { part, resolved };
	}

	const buttons = (part: OpenideChatConfirmationPart) =>
		[...part.domNode.querySelectorAll('button.openide-chat-abtn')] as HTMLButtonElement[];
	const scope = (part: OpenideChatConfirmationPart) =>
		part.domNode.querySelector('.openide-chat-approval-scope-trigger') as HTMLButtonElement;
	const scopeRows = (part: OpenideChatConfirmationPart) => {
		if (scope(part).getAttribute('aria-expanded') !== 'true') { scope(part).click(); }
		return [...menus.get(part)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
	};
	const labels: Record<string, string> = { once: t('chatSurface.approval.scopeOnce'), session: t('chatSurface.approval.scopeSession'), always: t('chatSurface.approval.scopeAlways') };
	const chooseScope = (part: OpenideChatConfirmationPart, decision: string) => {
		if (decision === 'deny') { return; }
		const row = scopeRows(part).find(row => row.textContent === labels[decision]);
		assert.ok(row, `scope ${decision} must be offered`);
		row.click();
		assert.strictEqual(scope(part).getAttribute('aria-expanded'), 'false');
	};

	const status = (part: OpenideChatConfirmationPart) =>
		part.domNode.querySelector('.openide-chat-approval-status')?.textContent ?? '';
	const offerHidden = (part: OpenideChatConfirmationPart) =>
		part.domNode.querySelector('.openide-chat-approval-actions')?.classList.contains('hidden') === true;

	test('keeps the reviewed action separate from the reachable decision controls', () => {
		const { part } = create();
		assert.deepStrictEqual({
			title: part.domNode.querySelector('.openide-chat-approval-head .openide-chat-approval-title')?.textContent,
			detail: part.domNode.querySelector('.openide-chat-approval-description')?.textContent,
			command: part.domNode.querySelector('.openide-chat-approval-cmd')?.textContent,
			bodyTabIndex: (part.domNode.querySelector('.openide-chat-approval-body') as HTMLElement).tabIndex,
			actionsInsideScroller: !!part.domNode.querySelector('.openide-chat-approval-body .openide-chat-approval-actions'),
			buttons: buttons(part).map(button => button.textContent),
		}, {
			title: 'Ejecutar comando', detail: 'en el workspace', command: 'rm -rf build',
			bodyTabIndex: 0, actionsInsideScroller: false,
			buttons: [t('chatSurface.approval.deny'), t('chatSurface.approval.allow')],
		});
	});

	test('the compact heading identifies the same tool as its execution card', () => {
		for (const [tool, icon] of [['run_command', 'terminal'], ['write_file', 'file'], ['browser_set_style', 'paintcan']]) {
			const { part } = create({ tool });
			const head = part.domNode.querySelector('.openide-chat-approval-head');
			assert.deepStrictEqual({
				text: head?.textContent,
				icon: head?.querySelector('.codicon')?.className,
				bodyTitle: part.domNode.querySelector('.openide-chat-approval-body .openide-chat-approval-title'),
				scopeLabel: scope(part).getAttribute('aria-label'),
			}, {
				text: 'Ejecutar comando', icon: `codicon codicon-${icon}`, bodyTitle: null,
				scopeLabel: t('chatSurface.approval.scope'),
			});
		}
	});

	test('a command repeated in the approval detail is only shown once', () => {
		const { part } = create({ detail: '  npm run dev  ', command: 'npm run dev' });
		assert.deepStrictEqual({
			detail: part.domNode.querySelector('.openide-chat-approval-description'),
			command: part.domNode.querySelector('.openide-chat-approval-cmd')?.textContent,
		}, { detail: null, command: 'npm run dev' });
	});

	test('defaults to one action and offers session and persistent scopes explicitly', () => {
		const { part, resolved } = create();
		assert.deepStrictEqual({ selected: scope(part).textContent, scopes: scopeRows(part).map(row => row.textContent), resolved }, {
			selected: labels.once, scopes: [labels.once, labels.session, labels.always], resolved: [],
		});
	});

	test('a sensitive path never offers persistent permission', () => {
		const { part } = create({ sensitive: true });
		assert.deepStrictEqual(scopeRows(part).map(row => row.textContent), [labels.once, labels.session]);
	});

	test('changing scope alone does not authorize the tool', () => {
		const { part, resolved } = create();
		chooseScope(part, 'always');

		assert.deepStrictEqual(resolved, []);
	});

	test('remembered scope explains the actual command or tool grant and announces height changes', () => {
		for (const [overrides, label] of [
			[{}, t('chatSurface.approval.scopeCommandHint')],
			[{ risk: 'write', tool: 'write_file', command: undefined }, t('chatSurface.approval.scopeToolHint')],
			[{ command: undefined }, t('chatSurface.approval.scopeToolHint')],
		] as const) {
			const { part } = create(overrides);
			const hint = part.domNode.querySelector('.openide-chat-approval-scope-hint') as HTMLElement;
			let changes = 0;
			store.add(part.onDidChangeHeight(() => changes++));
			for (const selected of ['session', 'always', 'once']) {
				chooseScope(part, selected);

				assert.deepStrictEqual({ hidden: hint.hidden, text: hint.textContent, description: scope(part).getAttribute('aria-description') }, {
					hidden: selected === 'once', text: selected === 'once' ? '' : label, description: selected === 'once' ? '' : label,
				});
			}
			assert.strictEqual(changes, 3);
		}
	});

	test('allow submits each scope using the service decision vocabulary', () => {
		for (const decision of ['once', 'session', 'always']) {
			const { part, resolved } = create();
			chooseScope(part, decision);
			buttons(part)[1].click();
			assert.deepStrictEqual(resolved, [{ id: 'req-1', decision }]);
		}
	});

	test('deny remains denial regardless of the selected scope', () => {
		const { part, resolved } = create();
		chooseScope(part, 'always');
		buttons(part)[0].click();
		assert.deepStrictEqual(resolved, [{ id: 'req-1', decision: 'deny' }]);
	});

	test('answering twice cannot resolve the same request twice', () => {
		const { part, resolved } = create();
		buttons(part)[1].click();
		buttons(part)[0].click();
		assert.deepStrictEqual(resolved, [{ id: 'req-1', decision: 'once' }]);
	});

	test('an old pending snapshot cannot reopen an answered request', () => {
		const { part, resolved } = create();
		buttons(part)[1].click();
		part.hasSameContent(content());
		buttons(part)[0].click();
		assert.deepStrictEqual({ resolved, offerHidden: offerHidden(part), status: status(part) }, {
			resolved: [{ id: 'req-1', decision: 'once' }], offerHidden: true, status: t('chatSurface.approval.allowed'),
		});
	});

	test('each decision leaves a distinct accessible record in the transcript', () => {
		for (const [decision, label] of [['once', t('chatSurface.approval.allowed')], ['session', t('chat.approval.allowedSession')], ['always', t('chatSurface.approval.allowedAlways')], ['deny', t('chatSurface.approval.denied')]] as const) {
			const { part } = create();
			chooseScope(part, decision);
			buttons(part)[decision === 'deny' ? 0 : 1].click();
			assert.deepStrictEqual({ status: status(part), hidden: offerHidden(part), live: part.domNode.querySelector('[role="status"]')?.getAttribute('aria-live') }, {
				status: label, hidden: true, live: 'polite',
			});
		}
	});

	test('a resolved event updates the card in place and announces its new height', () => {
		const { part } = create();
		let changes = 0;
		store.add(part.onDidChangeHeight(() => changes++));
		assert.strictEqual(part.hasSameContent(content({ decision: 'once' })), true);
		assert.deepStrictEqual({ status: status(part), offerHidden: offerHidden(part), changes }, {
			status: t('chatSurface.approval.allowed'), offerHidden: true, changes: 1,
		});
	});

	test('a resolution closes an open scope menu and prevents reopening it', () => {
		const { part, resolved } = create();
		scopeRows(part);
		assert.strictEqual(scope(part).getAttribute('aria-expanded'), 'true');
		part.hasSameContent(content({ decision: 'deny' }));
		assert.strictEqual(scope(part).getAttribute('aria-expanded'), 'false');
		scope(part).click();
		assert.strictEqual(menus.get(part)!.childElementCount, 0);
		assert.deepStrictEqual(resolved, []);
	});

	test('button and scope keys do not reach the transcript tree', () => {
		const { part, resolved } = create();
		const parent = document.createElement('div');
		parent.append(part.domNode);
		let bubbled = 0;
		parent.addEventListener('keydown', () => bubbled++);
		parent.addEventListener('keyup', () => bubbled++);
		for (const target of [scope(part), ...buttons(part)]) {
			for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Escape']) {
				for (const type of ['keydown', 'keyup']) {
					const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
					target.dispatchEvent(event);
					assert.strictEqual(event.defaultPrevented, false, `${type} ${key} must keep native behavior`);
				}
			}
		}
		assert.deepStrictEqual({ bubbled, resolved }, { bubbled: 0, resolved: [] });
	});

	test('workbench shortcuts remain available while approval controls have focus', () => {
		const { part } = create();
		const parent = document.createElement('div');
		parent.append(part.domNode);
		let bubbled = 0;
		parent.addEventListener('keydown', () => bubbled++);
		for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
			scope(part).dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, ...modifiers }));
		}
		assert.strictEqual(bubbled, 2);
	});

	test('a different request is a different card', () => {
		const { part } = create();
		assert.strictEqual(part.hasSameContent(content({ requestId: 'req-2' })), false);
	});

	test('a card without a command still presents its action', () => {
		const { part } = create({ command: undefined, detail: undefined });
		assert.deepStrictEqual({ command: part.domNode.querySelector('.openide-chat-approval-cmd'), title: part.domNode.querySelector('.openide-chat-approval-title')?.textContent }, {
			command: null, title: 'Ejecutar comando',
		});
	});
});
