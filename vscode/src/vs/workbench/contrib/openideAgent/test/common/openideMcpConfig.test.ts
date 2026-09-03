/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import {
	inspectMcpConfig,
	MCP_SECRET_MASK,
	mergeMcpSecrets,
	parseMcpPaste,
	redactMcpEntry,
	splitCommandLine,
	suggestNameFromCommand,
	writeMcpServer,
} from '../../common/openideMcpConfig.js';

suite('OpenIDE MCP config', () => {

	suite('inspectMcpConfig', () => {
		test('a missing file is not the same as a broken one', () => {
			// If broken JSON looks the same as "you have not configured anything yet", the servers
			// vanish and nobody finds out why.
			const ausente = inspectMcpConfig(undefined);
			const roto = inspectMcpConfig('{ "mcpServers": { "a": }');
			assert.strictEqual(ausente.exists, false);
			assert.strictEqual(ausente.invalid, false);
			assert.strictEqual(roto.exists, true);
			assert.strictEqual(roto.invalid, true);
		});

		test('an empty file is valid: it was just created', () => {
			const vacio = inspectMcpConfig('');
			assert.strictEqual(vacio.exists, true);
			assert.strictEqual(vacio.invalid, false);
			assert.deepStrictEqual(vacio.servers, {});
		});

		test('a file without mcpServers is valid and simply has none', () => {
			const sinClave = inspectMcpConfig('{ "otraCosa": 1 }');
			assert.strictEqual(sinClave.invalid, false);
			assert.deepStrictEqual(sinClave.servers, {});
		});

		test('mcpServers of the wrong shape is invalid, not empty', () => {
			assert.strictEqual(inspectMcpConfig('{ "mcpServers": [] }').invalid, true);
			assert.strictEqual(inspectMcpConfig('[]').invalid, true);
		});

		test('reads the servers it finds', () => {
			const config = inspectMcpConfig('{ "mcpServers": { "github": { "command": "npx" } } }');
			assert.deepStrictEqual(Object.keys(config.servers), ['github']);
		});
	});

	suite('writeMcpServer', () => {
		const base = JSON.stringify({ mcpServers: { github: { command: 'npx' }, notion: { url: 'https://x/mcp' } } });

		test('touching one server leaves the others untouched', () => {
			// The file is hand-edited in parallel: rewriting it wholesale from a stale state would
			// erase another server's changes.
			const out = JSON.parse(writeMcpServer(base, 'github', { command: 'node', args: ['s.js'] }));
			assert.deepStrictEqual(out.mcpServers.github, { command: 'node', args: ['s.js'] });
			assert.deepStrictEqual(out.mcpServers.notion, { url: 'https://x/mcp' });
		});

		test('renaming drops the old key', () => {
			const out = JSON.parse(writeMcpServer(base, 'gh', { command: 'npx' }, 'github'));
			assert.strictEqual('github' in out.mcpServers, false);
			assert.deepStrictEqual(out.mcpServers.gh, { command: 'npx' });
			assert.strictEqual('notion' in out.mcpServers, true);
		});

		test('removing deletes only that entry', () => {
			const out = JSON.parse(writeMcpServer(base, 'github', undefined));
			assert.deepStrictEqual(Object.keys(out.mcpServers), ['notion']);
		});

		test('a broken or missing file starts from scratch instead of failing', () => {
			assert.deepStrictEqual(JSON.parse(writeMcpServer('{ roto', 'a', { command: 'x' })).mcpServers, { a: { command: 'x' } });
			assert.deepStrictEqual(JSON.parse(writeMcpServer(undefined, 'a', { command: 'x' })).mcpServers, { a: { command: 'x' } });
		});

		test('other top-level keys of the file survive', () => {
			const out = JSON.parse(writeMcpServer('{ "$schema": "x", "mcpServers": {} }', 'a', { command: 'x' }));
			assert.strictEqual(out.$schema, 'x');
		});

		test('the file ends with a newline', () => {
			assert.strictEqual(writeMcpServer(base, 'a', { command: 'x' }).endsWith('\n'), true);
		});
	});

	suite('secrets', () => {
		test('the shown copy never carries the real values', () => {
			const shown = redactMcpEntry({ command: 'npx', env: { TOKEN: 'ghp_real', OTHER: 'x' } } as any);
			assert.strictEqual(shown.env.TOKEN, MCP_SECRET_MASK);
			assert.strictEqual(shown.env.OTHER, MCP_SECRET_MASK);
			assert.strictEqual(shown.command, 'npx');
		});

		test('saving an untouched mask keeps the stored secret', () => {
			const merged = mergeMcpSecrets({ env: { TOKEN: MCP_SECRET_MASK } }, { command: 'npx', env: { TOKEN: 'ghp_real' } } as any);
			assert.strictEqual(merged.env.TOKEN, 'ghp_real');
		});

		test('typing over the mask replaces the secret', () => {
			const merged = mergeMcpSecrets({ env: { TOKEN: 'nuevo' } }, { env: { TOKEN: 'viejo' } } as any);
			assert.strictEqual(merged.env.TOKEN, 'nuevo');
		});

		test('a mask with nothing stored is dropped, not saved as bullets', () => {
			// Saving '•••' as the real value would leave the server trying to authenticate with it.
			const merged = mergeMcpSecrets({ env: { NUEVA: MCP_SECRET_MASK } }, undefined);
			assert.strictEqual('env' in merged, false);
		});

		test('headers follow the same rule as env', () => {
			const merged = mergeMcpSecrets({ headers: { Authorization: MCP_SECRET_MASK } }, { headers: { Authorization: 'Bearer x' } } as any);
			assert.strictEqual(merged.headers.Authorization, 'Bearer x');
		});
	});

	suite('parseMcpPaste', () => {
		test('accepts the mcpServers block from a README', () => {
			const parsed = parseMcpPaste('{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "pkg"] } } }');
			assert.strictEqual(typeof parsed === 'string', false);
			assert.deepStrictEqual(Object.keys(parsed as object), ['github']);
		});

		test('accepts the VS Code shape and drops its type field', () => {
			const parsed = parseMcpPaste('{ "servers": { "gh": { "type": "stdio", "command": "npx" } } }') as any;
			assert.deepStrictEqual(Object.keys(parsed), ['gh']);
			assert.strictEqual('type' in parsed.gh, false);
		});

		test('accepts a bare entry under the empty name', () => {
			const parsed = parseMcpPaste('{ "command": "npx", "args": ["x"] }') as any;
			assert.deepStrictEqual(Object.keys(parsed), ['']);
		});

		test('accepts serverUrl as url', () => {
			const parsed = parseMcpPaste('{ "serverUrl": "https://x/mcp" }') as any;
			assert.strictEqual(parsed[''].url, 'https://x/mcp');
			assert.strictEqual('serverUrl' in parsed[''], false);
		});

		test('tolerates the trailing comma of a copy-pasted snippet', () => {
			const parsed = parseMcpPaste('{ "mcpServers": { "a": { "command": "npx" }, } }');
			assert.strictEqual(typeof parsed === 'string', false);
		});

		test('drops entries with neither command nor url', () => {
			const parsed = parseMcpPaste('{ "mcpServers": { "ok": { "command": "npx" }, "vacia": { "note": 1 } } }') as any;
			assert.deepStrictEqual(Object.keys(parsed), ['ok']);
		});

		test('failures come back as the message the user should read', () => {
			assert.strictEqual(typeof parseMcpPaste('no es json'), 'string');
			assert.strictEqual(typeof parseMcpPaste('[1,2]'), 'string');
			assert.strictEqual(typeof parseMcpPaste('{ "mcpServers": { "a": { "note": 1 } } }'), 'string');
		});
	});

	suite('command line', () => {
		test('respects quotes when splitting', () => {
			assert.deepStrictEqual(splitCommandLine('npx -y "@scope/pkg name"'), ['npx', '-y', '@scope/pkg name']);
			assert.deepStrictEqual(splitCommandLine("node 'mi server.js'"), ['node', 'mi server.js']);
		});

		test('suggests a name from the package, not from the runner', () => {
			assert.strictEqual(suggestNameFromCommand(['npx', '-y', '@modelcontextprotocol/server-github']), 'github');
			assert.strictEqual(suggestNameFromCommand(['uvx', 'mcp-server-fetch']), 'fetch');
			assert.strictEqual(suggestNameFromCommand(['node', '/ruta/notion-mcp']), 'notion');
		});

		test('falls back to a usable name when there is nothing to read', () => {
			assert.strictEqual(suggestNameFromCommand(['-y', '--flag']), 'mi-server');
		});
	});
});
