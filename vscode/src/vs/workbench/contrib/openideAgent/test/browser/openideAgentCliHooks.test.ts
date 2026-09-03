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

suite('Openide CLI hooks — installation into settings.json', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('installs all five events, StopFailure included', () => {
		const merged = mergeOpenideClaudeHooks({});
		const hooks = hooksOf(merged);
		for (const event of ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'Notification']) {
			assert.strictEqual(ourCommands(hooks, event).length, 1, event);
		}
		assert.strictEqual(hooks['PreToolUse'][0].matcher, '*');
	});

	test('is idempotent: with everything installed it writes nothing', () => {
		const first = mergeOpenideClaudeHooks({})!;
		assert.strictEqual(mergeOpenideClaudeHooks(first), undefined);
	});

	test('the command bails when there is no OpenIDE session, and drains stdin', () => {
		const command = ourCommands(hooksOf(mergeOpenideClaudeHooks({})), 'Stop')[0];
		assert.ok(command.includes('OPENIDE_SESSION_ID'), 'guarded by env');
		assert.ok(command.includes('cat >/dev/null'), 'without draining stdin the CLI sees a broken pipe');
		assert.ok(command.includes('"openideSessionId":"%s"'), 'the id travels in the envelope');
		assert.ok(command.includes('.tmp" && mv'), 'it is written whole before the watcher sees it');
	});

	test('a hook of ours from an earlier version is REPLACED rather than added to', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		const stop = ourCommands(hooksOf(merged), 'Stop');
		assert.strictEqual(stop.length, 1);
		assert.ok(stop[0].includes('OPENIDE_SESSION_ID'));
	});

	test('foreign hooks on the same event are left intact', () => {
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

	test('a stale hook sharing a group with a foreign one leaves the foreign one in place', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { Stop: [{ matcher: 'x', hooks: [FOREIGN, { type: 'command', command: STALE_COMMAND }] }] } });
		const stop = hooksOf(merged)['Stop'];
		assert.deepStrictEqual(stop[0], { matcher: 'x', hooks: [FOREIGN] });
		assert.strictEqual(ourCommands(hooksOf(merged), 'Stop').length, 1);
	});

	test('a hook of ours on an event we no longer register is DELETED', () => {
		// An earlier version listened to SessionStart. That hook keeps dropping a payload per
		// event for every Claude on the machine, which is the pile the guard exists to stop.
		const merged = mergeOpenideClaudeHooks({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		assert.strictEqual(hooksOf(merged)['SessionStart'], undefined, 'with none of our hooks left the event does not leave an empty key');
	});

	test('cleaning up an event respects what the user already had there', () => {
		const merged = mergeOpenideClaudeHooks({ hooks: { SessionStart: [{ hooks: [FOREIGN] }, { hooks: [{ type: 'command', command: STALE_COMMAND }] }] } });
		assert.deepStrictEqual(hooksOf(merged)['SessionStart'], [{ hooks: [FOREIGN] }]);
	});

	test('a foreign event with nothing of ours is left untouched', () => {
		const settings = { hooks: { SessionStart: [{ hooks: [FOREIGN] }] } };
		const merged = mergeOpenideClaudeHooks(settings)!;
		assert.deepStrictEqual(hooksOf(merged)['SessionStart'], [{ hooks: [FOREIGN] }]);
		// And a second pass has nothing left to write.
		assert.strictEqual(mergeOpenideClaudeHooks(merged), undefined);
	});

	test('the rest of settings.json survives', () => {
		const merged = mergeOpenideClaudeHooks({ model: 'opus', permissions: { allow: ['Bash'] } })!;
		assert.strictEqual(merged['model'], 'opus');
		assert.deepStrictEqual(merged['permissions'], { allow: ['Bash'] });
	});
});

suite('Openide CLI hooks — payloads', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('every event maps to the reducer; StopFailure is a failed stop', () => {
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'UserPromptSubmit' }), { type: 'hook:prompt' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'PreToolUse' }), { type: 'hook:tool' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'Stop' }), { type: 'hook:stop' });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'StopFailure' }), { type: 'hook:stop', failed: true });
		assert.deepStrictEqual(claudeHookEventOf({ hook_event_name: 'Notification' }), { type: 'hook:notification' });
		assert.strictEqual(claudeHookEventOf({ hook_event_name: 'SubagentStop' }), undefined);
	});

	test('a drop with an envelope is read whole, with the dock session id', () => {
		const drop = JSON.stringify({ openideSessionId: 'dock-1', payload: { session_id: 'claude-9', cwd: '/repo', hook_event_name: 'Stop' } });
		assert.deepStrictEqual(parseClaudeHookDrop(drop), { sessionId: 'claude-9', cwd: '/repo', event: { type: 'hook:stop' }, openideSessionId: 'dock-1' });
	});

	test('a payload with no envelope (a stale hook, or a hand-launched Claude) is NOT ours', () => {
		const bare = JSON.stringify({ session_id: 'claude-9', cwd: '/repo', hook_event_name: 'Stop' });
		assert.strictEqual(parseClaudeHookDrop(bare), undefined);
	});

	test('an envelope with no id, or with an unknown event, is not ours either', () => {
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: '', payload: { session_id: 'c', hook_event_name: 'Stop' } })), undefined);
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: 'dock-1', payload: { session_id: 'c', hook_event_name: 'SessionStart' } })), undefined);
		assert.strictEqual(parseClaudeHookDrop(JSON.stringify({ openideSessionId: 'dock-1', payload: { hook_event_name: 'Stop' } })), undefined, 'without session_id there is no resume');
	});

	test('a half-written file throws, so the caller retries it', () => {
		assert.throws(() => parseClaudeHookDrop('{"openideSessionId":"dock-1","payload":{"session_id":'));
	});
});
