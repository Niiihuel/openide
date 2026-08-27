/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
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

	function create(overrides: Partial<IOpenideChatConfirmationContent> = {}) {
		const resolved: { id: string; decision: string }[] = [];
		const agentService = {
			resolveApproval: (id: string, decision: string) => { resolved.push({ id, decision }); },
		} as unknown as IOpenideAgentService;
		const part = store.add(new OpenideChatConfirmationPart(
			content(overrides),
			{} as IOpenideChatContentPartContext,
			agentService,
		));
		return { part, resolved };
	}

	const buttons = (part: OpenideChatConfirmationPart) =>
		[...part.domNode.querySelectorAll('button.openide-chat-abtn')] as HTMLButtonElement[];
	const labels = (part: OpenideChatConfirmationPart) => buttons(part).map(b => b.textContent?.trim());
	const status = (part: OpenideChatConfirmationPart) =>
		part.domNode.querySelector('.openide-chat-approval-status')?.textContent ?? '';

	test('says what it is about to run', () => {
		const { part } = create();
		assert.strictEqual(part.domNode.querySelector('.openide-chat-approval-title')?.textContent, 'Ejecutar comando');
		assert.strictEqual(part.domNode.querySelector('.openide-chat-approval-description')?.textContent, 'en el workspace');
		// The command is the one thing the user is actually judging.
		assert.strictEqual(part.domNode.querySelector('.openide-chat-approval-cmd')?.textContent, 'rm -rf build');
	});

	test('offers the four decisions the service understands', () => {
		const { part } = create();
		assert.deepStrictEqual(labels(part), ['Permitir', t('chat.approval.session'), 'Permitir siempre', 'Rechazar']);
	});

	test('a sensitive path never offers "always"', () => {
		// The whole point of marking a path sensitive is that the answer is given again next time.
		const { part } = create({ sensitive: true });
		assert.deepStrictEqual(labels(part), ['Permitir', t('chat.approval.session'), 'Rechazar']);
	});

	/**
	 * The decision strings are the service's vocabulary, and a wrong one fails SILENTLY.
	 *
	 * `resolveApproval` accepts `once` | `session` | `always` and maps anything else to `deny`. The
	 * primary button used to send `allow`, so "Permitir" told the agent the user had refused — no
	 * error, no log, the tool just never ran. This is the assert that caught it.
	 */
	test('each button resolves the run with a decision the service accepts', () => {
		const accepted = ['once', 'session', 'always'];
		for (const [index, decision] of [[0, 'once'], [1, 'session'], [2, 'always'], [3, 'deny']] as const) {
			const { part, resolved } = create();
			buttons(part)[index].click();
			assert.deepStrictEqual(resolved, [{ id: 'req-1', decision }], `boton ${index}`);
			if (index < 3) {
				assert.ok(accepted.includes(resolved[0].decision), `${resolved[0].decision} se convertiria en deny`);
			}
		}
	});

	test('answering twice cannot resolve the same request twice', () => {
		// `resolveApproval` settles a promise; a second call for one request is a protocol error.
		const { part, resolved } = create();
		buttons(part)[0].click();
		buttons(part)[3].click();
		assert.deepStrictEqual(resolved, [{ id: 'req-1', decision: 'once' }]);
	});

	test('the answered card stays on screen, disabled, saying what was decided', () => {
		// Removing it would erase the only record of what the user authorised.
		const { part } = create();
		buttons(part)[2].click();
		assert.strictEqual(part.domNode.classList.contains('decided'), true);
		assert.strictEqual(buttons(part).every(b => b.disabled), true);
		assert.strictEqual(status(part), 'Permitido siempre');
	});

	test('each decision reads back differently, including "this session"', () => {
		for (const [index, label] of [[0, 'Permitido'], [1, t('chat.approval.allowedSession')], [2, 'Permitido siempre'], [3, 'Rechazado']] as const) {
			const { part } = create();
			buttons(part)[index].click();
			assert.strictEqual(status(part), label);
		}
	});

	test('a decision that arrives from the model applies in place', () => {
		// The card must not blink out and back while the run continues, so the same part absorbs it.
		const { part } = create();
		assert.strictEqual(part.hasSameContent(content({ decision: 'once' })), true);
		assert.strictEqual(status(part), 'Permitido');
		assert.strictEqual(buttons(part).every(b => b.disabled), true);
	});

	test('a different request is a different card', () => {
		const { part } = create();
		assert.strictEqual(part.hasSameContent(content({ requestId: 'req-2' })), false);
	});

	test('a card with no command still renders its head', () => {
		const { part } = create({ command: undefined, detail: undefined });
		assert.strictEqual(part.domNode.querySelector('.openide-chat-approval-cmd'), null);
		assert.strictEqual(part.domNode.querySelector('.openide-chat-approval-title')?.textContent, 'Ejecutar comando');
		assert.deepStrictEqual(labels(part), ['Permitir', t('chat.approval.session'), 'Permitir siempre', 'Rechazar']);
	});
});
