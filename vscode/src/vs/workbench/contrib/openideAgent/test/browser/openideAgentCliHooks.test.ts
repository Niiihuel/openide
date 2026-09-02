/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { claudeHookEventOf, mergeOpenideClaudeHooks, parseClaudeHookDrop } from '../../browser/openideAgentCliHooks.js';

type Hooks = Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;

function hooksOf(settings: Record<string, unknown> | undefined): Hooks {
	return (settings?.['hooks'] ?? {}) as Hooks;
}

function ourCommands(hooks: Hooks, event: string): string[] {
	return (hooks[event] ?? []).flatMap(group => group.hooks.map(hook => hook.command)).filter(command => command.includes('.openide/agent-hooks/claude'));
}

/** The command an OpenIDE older than the session guard wrote, as it sits in real settings files. */
const STALE_COMMAND = `/bin/sh -c 'mkdir -p "$HOME/.openide/agent-hooks/claude" && cat > "$HOME/.openide/agent-hooks/claude/$(date +%s%N)-$$.json"'`;

const FOREIGN = { type: 'command', command: '/bin/sh /home/user/.orca/agent-hooks/claude-hook.sh', timeout: 10 };

suite('Openide CLI hooks — instalación en settings.json', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('instala los cinco eventos, StopFailure incluido', () => {
		const merged = mergeOpenideClaudeHooks({});
		const hooks = hooksOf(merged);
		for (const event of ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'Notification']) {
			assert.strictEqual(ourCommands(hooks, event).length, 1, event);
		}
		assert.strictEqual(hooks['PreToolUse'][0].matcher, '*');
	});

	test('es idempotente: con todo instalado no escribe', () => {
		const first = mergeOpenideClaudeHooks({})!;
		assert.strictEqual(mergeOpenideClaudeHooks(first), undefined);
	});

	test('el comando corta cuando no hay sesión de OpenIDE y drena stdin', () => {
		const command = ourCommands(hooksOf(mergeOpenideClaudeHooks({})), 'Stop')[0];
		assert.ok(command.includes('OPENIDE_SESSION_ID'), 'guard por env');
		assert.ok(command.includes('cat >/dev/null'), 'sin drenar stdin el CLI ve un pipe roto');
		assert.ok(command.includes('"openideSessionId":"%s"'), 'el id viaja en el sobre');
		assert.ok(command.includes('.tmp" && mv'), 'se escribe entero antes de que el watcher lo vea');
	});

	test('un hook nuestro de una versión anterior se REEMPLAZA en vez de sumarse', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		const stop = ourCommands(hooksOf(merged), 'Stop');
		assert.strictEqual(stop.length, 1);
		assert.ok(stop[0].includes('OPENIDE_SESSION_ID'));
	});

	test('los hooks ajenos del mismo evento quedan intactos', () => {
		const merged = mergeOpenideClaudeHooks({
			hooks: {
				Stop: [
					{ hooks: [FOREIGN] },
					{ hooks: [{ type: 'command', command: STALE_COMMAND }] },
				],
			},
		});
		const stop = hooksOf(merged)['Stop'];
		assert.deepStrictEqual(stop[0], { hooks: [FOREIGN] });
		assert.strictEqual(stop.length, 2);
	});

	test('un hook viejo que compartía grupo con uno ajeno deja el ajeno en su lugar', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { Stop: [{ matcher: 'x', hooks: [FOREIGN, { type: 'command', command: STALE_COMMAND }] }] } });
		const stop = hooksOf(merged)['Stop'];
		assert.deepStrictEqual(stop[0], { matcher: 'x', hooks: [FOREIGN] });
		assert.strictEqual(ourCommands(hooksOf(merged), 'Stop').length, 1);
	});

	test('un hook nuestro en un evento que ya no registramos se BORRA', () => {
		// An earlier version listened to SessionStart. That hook keeps dropping a payload per
		// event for every Claude on the machine, which is the pile the guard exists to stop.
		const merged = mergeOpenideClaudeHooks({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		assert.strictEqual(hooksOf(merged)['SessionStart'], undefined, 'sin hooks propios el evento no deja una llave vacía');
	});

	test('al limpiar un evento ajeno se respeta lo que el usuario tenía ahí', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { SessionStart: [{ hooks: [FOREIGN] }, { hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		assert.deepStrictEqual(hooksOf(merged)['SessionStart'], [{ hooks: [FOREIGN] }]);
	});

	test('un evento ajeno sin nada nuestro no se toca', () => {
		const settings = { hooks: { SessionStart: [{ hooks: [FOREIGN] }] } };
		const merged = mergeOpenideClaudeHooks(settings)!;
		assert.deepStrictEqual(hooksOf(merged)['SessionStart'], [{ hooks: [FOREIGN] }]);
		// And a second pass has nothing left to write.
		assert.strictEqual(mergeOpenideClaudeHooks(merged), undefined);
	});

	test('el resto del settings.json sobrevive', () => {
		const merged = mergeOpenideClaudeHooks({ model: 'opus', permissions: { allow: ['Bash'] } })!;
		assert.strictEqual(merged['model'], 'opus');
		assert.deepStrictEqual(merged['permissions'], { allow: ['Bash'] });
	});
});

suite('Openide CLI hooks — payloads', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('cada evento mapea al reductor; StopFailure es un stop fallido', () => {
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'UserPromptSubmit' }), { type: 'hook:prompt' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'PreToolUse' }), { type: 'hook:tool' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'Stop' }), { type: 'hook:stop' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'StopFailure' }), { type: 'hook:stop', failed: true });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'Notification' }), { type: 'hook:notification' });
		assert.strictEqual(claudeHookEventOf({ hook_event_name: 'SubagentStop' }), undefined);
	});

	test('un drop con sobre se lee entero, con el id de la sesión del dock', () => {
		const drop = JSON.stringify({ openideSessionId: 'dock-1', payload: { session_id: 'claude-9', cwd: '/repo', hook_event_name: 'Stop' } });
		assert.deepStrictEqual(parseClaudeHookDrop(drop), { sessionId: 'claude-9', cwd: '/repo', event: { type: 'hook:stop' }, openideSessionId: 'dock-1' });
	});

	test('un payload sin sobre (hook viejo, o un Claude lanzado a mano) NO es nuestro', () => {
		const bare = JSON.stringify({ session_id: 'claude-9', cwd: '/repo', hook_event_name: 'Stop' });
		assert.strictEqual(parseClaudeHookDrop(bare), undefined);
	});

	test('un sobre sin id, o con un evento desconocido, tampoco', () => {
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: '', payload: { session_id: 'c', hook_event_name: 'Stop' } })), undefined);
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: 'dock-1', payload: { session_id: 'c', hook_event_name: 'SessionStart' } })), undefined);
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: 'dock-1', payload: { hook_event_name: 'Stop' } })), undefined, 'sin session_id no hay resume');
	});

	test('un archivo a medio escribir lanza, para que el llamador lo reintente', () => {
		assert.throws(() => parseClaudeHookDrop('{"openideSessionId":"dock-1","payload":{"session_id":'));
	});
});
