/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { consumeMcpJsonLines, isMcpToolAllowed, McpRequestBudget, MCP_MAX_JSONRPC_MESSAGE_BYTES, MCP_MAX_PENDING_REQUESTS, redactSecrets, sanitizeMcpStdioEnvironment, sanitizeMcpToolName, shlexSplit, validateMcpServerConfig } from '../../common/openideAgentHost.js';

suite('OpenIDE agent host', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('validates MCP transports and names', () => {
		assert.strictEqual(validateMcpServerConfig('local-server', { command: 'node' }), undefined);
		assert.strictEqual(validateMcpServerConfig('remote', { url: 'https://example.com/mcp' }), undefined);
		assert.match(validateMcpServerConfig('bad name', { command: 'node' }) ?? '', /inválido/);
		assert.match(validateMcpServerConfig('both', { command: 'node', url: 'https://example.com' }) ?? '', /excluyentes/);
		assert.match(validateMcpServerConfig('unsafe', { url: 'file:///tmp/mcp' }) ?? '', /http/);
	});

	test('sanitizes stdio environment and blocks Node injection variables', () => {
		const env = sanitizeMcpStdioEnvironment({
			PATH: '/usr/bin', HOME: '/home/test', XDG_CONFIG_HOME: '/tmp/config', SECRET_TOKEN: 'leak', NODE_OPTIONS: '--require malware', ELECTRON_RUN_AS_NODE: '1',
		}, { API_KEY: 'allowed', NODE_PATH: '/tmp/injected' });
		assert.deepStrictEqual(env, { PATH: '/usr/bin', HOME: '/home/test', XDG_CONFIG_HOME: '/tmp/config', API_KEY: 'allowed' });
		assert.match(validateMcpServerConfig('unsafe-env', { command: 'node', env: { NODE_OPTIONS: '--inspect' } }) ?? '', /bloqueada/);
		assert.match(validateMcpServerConfig('oversized-env', { command: 'node', env: { VALUE: 'x'.repeat(16_385) } }) ?? '', /demasiado grande/);
	});

	test('rejects excessive or invalid stdio arguments', () => {
		assert.match(validateMcpServerConfig('too-many-args', { command: 'node', args: Array.from({ length: 257 }, () => 'x') }) ?? '', /args inválidos/);
		assert.match(validateMcpServerConfig('nul-arg', { command: 'node', args: ['bad\0arg'] }) ?? '', /args inválidos/);
	});

	test('bounds MCP pending requests and releases capacity', () => {
		const budget = new McpRequestBudget();
		for (let index = 0; index < MCP_MAX_PENDING_REQUESTS; index++) { assert.strictEqual(budget.reserve(1), undefined); }
		assert.match(budget.reserve(1) ?? '', /cola MCP llena/);
		budget.release(1);
		assert.strictEqual(budget.reserve(1), undefined);
		budget.clear();
		assert.strictEqual(budget.pendingCount, 0);
		assert.match(budget.reserve(MCP_MAX_JSONRPC_MESSAGE_BYTES + 1) ?? '', /excede/);
	});

	test('parses bounded JSON-RPC lines and rejects oversized frames', () => {
		const first = consumeMcpJsonLines('', '{"id":1}\npartial');
		assert.deepStrictEqual(first.lines, ['{"id":1}']);
		assert.strictEqual(first.rest, 'partial');
		const second = consumeMcpJsonLines(first.rest, '-line\n');
		assert.deepStrictEqual(second.lines, ['partial-line']);
		assert.strictEqual(second.rest, '');
		assert.match(consumeMcpJsonLines('', 'x'.repeat(MCP_MAX_JSONRPC_MESSAGE_BYTES + 1)).error ?? '', /excede/);
	});

	test('applies MCP tool include/exclude consistently', () => {
		assert.strictEqual(isMcpToolAllowed({ command: 'node', tools: { include: [] } }, 'read'), true);
		assert.strictEqual(isMcpToolAllowed({ command: 'node', tools: { include: ['read'], exclude: ['read'] } }, 'read'), true);
		assert.strictEqual(isMcpToolAllowed({ command: 'node', tools: { exclude: ['delete'] } }, 'delete'), false);
		assert.match(validateMcpServerConfig('bad-tools', { command: 'node', tools: { include: 'read' as unknown as string[] } }) ?? '', /lista acotada/);
	});

	test('splits hook commands without shell expansion', () => {
		assert.deepStrictEqual(
			shlexSplit('node "script path.js" --name=\'Open IDE\' escaped\\ value'),
			['node', 'script path.js', '--name=Open IDE', 'escaped value'],
		);
	});

	test('sanitizes tool names and redacts non-trivial secrets', () => {
		assert.strictEqual(sanitizeMcpToolName('my-server', 'read.file'), 'mcp_my_server_read_file');
		assert.strictEqual(redactSecrets('token=super-secret; pin=123', ['super-secret', '123']), 'token=•••; pin=123');
	});
});
