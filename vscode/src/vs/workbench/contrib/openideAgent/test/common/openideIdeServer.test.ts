/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	IDE_AUTH_TOKEN_RE,
	IDE_COMPAT_TOOLS,
	IDE_PORT_MAX,
	IDE_PORT_MIN,
	IDE_NOTIFY_CONNECTED,
	IDE_PROTOCOL_VERSION,
	IDE_RPC_INVALID_REQUEST,
	IDE_RPC_PARSE_ERROR,
	ideClosedDiffTabs,
	ideRpcError,
	ideRpcNotification,
	ideRpcResult,
	isValidIdeLockFile,
	jsonText,
	parseIdeRpc,
	stableIdePort,
	text,
} from '../../../../../platform/openideAgentHost/common/openideIdeServer.js';

/**
 * These are not our shapes to choose. Every assertion here pins something an external CLI
 * already expects, so a "cleanup" that changes one of them shows up as a failing test instead
 * of as an agent that silently stops seeing the IDE.
 */
suite('OpenIDE IDE server — wire contract', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('lockfile', () => {
		const valid = {
			pid: 4242,
			workspaceFolders: ['/home/u/proj'],
			ideName: 'OpenIDE',
			transport: 'ws',
			authToken: 'a3f1c2d4e5f60718293a4b5c6d7e8f90',
		};

		test('accepts what we write', () => {
			assert.strictEqual(isValidIdeLockFile(valid), true);
		});

		test('rejects a token that is not 128 bits of hex', () => {
			// A short or non-hex token means somebody generated it with something other than the
			// CSPRNG, and a weak token here is worse than failing to start.
			assert.strictEqual(isValidIdeLockFile({ ...valid, authToken: 'abc' }), false);
			assert.strictEqual(isValidIdeLockFile({ ...valid, authToken: 'A3F1C2D4E5F60718293A4B5C6D7E8F90' }), false);
		});

		test('rejects empty workspaceFolders', () => {
			// This field decides which window a CLI adopts; empty means it would adopt any.
			assert.strictEqual(isValidIdeLockFile({ ...valid, workspaceFolders: [''] }), false);
			assert.strictEqual(isValidIdeLockFile({ ...valid, workspaceFolders: 'x' }), false);
		});

		test('rejects a transport we do not serve', () => {
			assert.strictEqual(isValidIdeLockFile({ ...valid, transport: 'sse' }), false);
		});

		test('the token regexp matches exactly what randomBytes(16).toString(hex) makes', () => {
			assert.strictEqual(IDE_AUTH_TOKEN_RE.test('0'.repeat(32)), true);
			assert.strictEqual(IDE_AUTH_TOKEN_RE.test('0'.repeat(31)), false);
			assert.strictEqual(IDE_AUTH_TOKEN_RE.test('0'.repeat(33)), false);
		});
	});

	suite('JSON-RPC framing', () => {
		test('a request round-trips', () => {
			const parsed = parseIdeRpc('{"jsonrpc":"2.0","id":7,"method":"tools/list"}');
			assert.ok(parsed.ok);
			assert.strictEqual(parsed.request.method, 'tools/list');
			assert.strictEqual(parsed.request.id, 7);
		});

		test('a notification keeps its missing id', () => {
			// The id being absent is the ONLY thing that says "do not answer this"; defaulting it
			// to null here would make the server reply to notifications, which is a violation.
			const parsed = parseIdeRpc('{"jsonrpc":"2.0","method":"notifications/initialized"}');
			assert.ok(parsed.ok);
			assert.strictEqual(parsed.request.id, undefined);
		});

		test('broken JSON is a parse error, not a throw', () => {
			const parsed = parseIdeRpc('{ not json');
			assert.ok(!parsed.ok);
			assert.strictEqual(parsed.error.code, IDE_RPC_PARSE_ERROR);
		});

		test('a message without jsonrpc 2.0 is an invalid request', () => {
			const parsed = parseIdeRpc('{"method":"tools/list"}');
			assert.ok(!parsed.ok);
			assert.strictEqual(parsed.error.code, IDE_RPC_INVALID_REQUEST);
		});

		test('an id that is neither string nor number is rejected', () => {
			const parsed = parseIdeRpc('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}');
			assert.ok(!parsed.ok);
		});

		test('responses and notifications serialize to the shapes the CLI parses', () => {
			assert.strictEqual(ideRpcResult(1, { ok: true }), '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
			assert.strictEqual(ideRpcError(1, { code: -32601, message: 'nope' }), '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"nope"}}');
			assert.strictEqual(ideRpcNotification('selection_changed', { a: 1 }), '{"jsonrpc":"2.0","method":"selection_changed","params":{"a":1}}');
		});

		test('a null id answers with null rather than dropping the field', () => {
			assert.strictEqual(ideRpcError(null, { code: -32700, message: 'x' }), '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"x"}}');
		});
	});

	suite('tool results', () => {
		test('text is a bare content block', () => {
			assert.deepStrictEqual(text('FILE_SAVED'), { content: [{ type: 'text', text: 'FILE_SAVED' }] });
		});

		test('jsonText double-encodes on purpose', () => {
			// The payload is a JSON *string* inside a text block. That is what the VS Code
			// extension emits and what the model is trained to unpack; structured content here
			// would be cleaner and would break the reader.
			const result = jsonText({ success: true, lineCount: 42 });
			assert.strictEqual(result.content.length, 1);
			const block = result.content[0];
			assert.strictEqual(block.type, 'text');
			assert.strictEqual(block.type === 'text' ? block.text : '', '{"success":true,"lineCount":42}');
		});

		test('closeAllDiffTabs answers with the exact sentinel', () => {
			assert.strictEqual(ideClosedDiffTabs(0), 'CLOSED_0_DIFF_TABS');
			assert.strictEqual(ideClosedDiffTabs(3), 'CLOSED_3_DIFF_TABS');
		});
	});

	suite('tool catalogue', () => {
		test('carries the twelve tools the extension registers', () => {
			assert.strictEqual(IDE_COMPAT_TOOLS.length, 12);
		});

		test('names match the extension exactly, snake_case outlier included', () => {
			// camelCase everywhere except close_tab. Not a typo — renaming it silently removes a
			// tool the CLI calls by that literal name.
			const names = IDE_COMPAT_TOOLS.map(tool => tool.name);
			assert.deepStrictEqual(names, [
				'openFile', 'openDiff', 'getCurrentSelection', 'getLatestSelection', 'getOpenEditors',
				'getWorkspaceFolders', 'getDiagnostics', 'checkDocumentDirty', 'saveDocument',
				'close_tab', 'closeAllDiffTabs', 'executeCode',
			]);
		});

		test('close_tab is registered but withheld from tools/list', () => {
			const hidden = IDE_COMPAT_TOOLS.filter(tool => tool.hidden).map(tool => tool.name);
			assert.deepStrictEqual(hidden, ['close_tab']);
		});

		test('openDiff is the only blocking tool', () => {
			const blocking = IDE_COMPAT_TOOLS.filter(tool => tool.blocking).map(tool => tool.name);
			assert.deepStrictEqual(blocking, ['openDiff']);
		});

		test('every tool declares an object input schema', () => {
			for (const tool of IDE_COMPAT_TOOLS) {
				assert.strictEqual(tool.inputSchema.type, 'object', tool.name);
				assert.ok(tool.description.length > 0, tool.name);
			}
		});

		test('required arguments match the extension', () => {
			const byName = new Map(IDE_COMPAT_TOOLS.map(tool => [tool.name, tool]));
			assert.deepStrictEqual(byName.get('openFile')!.inputSchema.required, ['filePath']);
			assert.deepStrictEqual(byName.get('openDiff')!.inputSchema.required, ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name']);
			assert.deepStrictEqual(byName.get('close_tab')!.inputSchema.required, ['tab_name']);
			// getDiagnostics takes an OPTIONAL uri: requiring it would break "diagnostics for
			// everything", which is how the agent asks whether the workspace is healthy.
			assert.strictEqual(byName.get('getDiagnostics')!.inputSchema.required, undefined);
		});
	});

	suite('stable port per workspace', () => {
		test('the same folders always yield the same port', () => {
			// It is the whole point: a registration written today by a CLI with no per-session hook has
			// to still point here tomorrow.
			assert.strictEqual(stableIdePort(['/home/u/proj']), stableIdePort(['/home/u/proj']));
		});

		test('the order of the folders does not change the port', () => {
			assert.strictEqual(stableIdePort(['/a', '/b']), stableIdePort(['/b', '/a']));
		});

		test('different projects land on different ports', () => {
			assert.notStrictEqual(stableIdePort(['/home/u/uno']), stableIdePort(['/home/u/dos']));
		});

		test('the separator keeps two partitions from colliding', () => {
			assert.notStrictEqual(stableIdePort(['ab', 'c']), stableIdePort(['a', 'bc']));
		});

		test('it always lands inside the discovery range', () => {
			for (const folders of [['/'], ['/a'], ['/muy/largo/'.repeat(30)], [], ['á', 'ñ']]) {
				const port = stableIdePort(folders);
				assert.ok(port >= IDE_PORT_MIN && port <= IDE_PORT_MAX, `${folders}: ${port}`);
				assert.ok(Number.isInteger(port));
			}
		});
	});

	test('ide_connected is spelled the way the live CLI sends it', () => {
		// Recorded off a real Claude Code 2.1.245 session; it appears in no spec. Renaming this
		// costs the pid, which is the only link between a connection and the process we spawned.
		assert.strictEqual(IDE_NOTIFY_CONNECTED, 'ide_connected');
	});

	test('the protocol version is the one the reference implementations report', () => {
		// 2024-11-05, not the 2025-03-26 the protocol doc names: claiming a version whose
		// semantics we do not implement risks a client turning on something we never answer.
		assert.strictEqual(IDE_PROTOCOL_VERSION, '2024-11-05');
	});
});
