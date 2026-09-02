/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { cliFile, ideExtensionsFile, ideUserDir, mergeKeybindings, mergeMcpJson, OPENIDE_IMPORT_SOURCES, parseExtensionsJson, parseMcpFromCodexToml, parseMcpFromJson } from '../../common/openideImportSources.js';

suite('OpenIDE — importar configuración de otros editores y CLIs', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const cursor = OPENIDE_IMPORT_SOURCES.find(s => s.id === 'cursor')!;
	const claude = OPENIDE_IMPORT_SOURCES.find(s => s.id === 'claude')!;
	const codex = OPENIDE_IMPORT_SOURCES.find(s => s.id === 'codex')!;

	test('las rutas siguen la plataforma', () => {
		assert.ok(cursor.kind === 'ide' && claude.kind === 'cli' && codex.kind === 'cli');
		if (cursor.kind !== 'ide' || claude.kind !== 'cli') { return; }
		assert.strictEqual(ideUserDir(cursor, { home: '/home/n', platform: 'linux' }), '/home/n/.config/Cursor/User');
		assert.strictEqual(ideUserDir(cursor, { home: '/Users/n', platform: 'darwin' }), '/Users/n/Library/Application Support/Cursor/User');
		assert.strictEqual(ideUserDir(cursor, { home: 'C:/Users/n', platform: 'win32' }), 'C:/Users/n/AppData/Roaming/Cursor/User');
		assert.strictEqual(ideExtensionsFile(cursor, { home: '/home/n', platform: 'linux' }), '/home/n/.cursor/extensions/extensions.json');
		assert.strictEqual(cliFile(claude, { home: '/home/n', platform: 'linux' }, 'mcp'), '/home/n/.claude.json');
		assert.strictEqual(cliFile(claude, { home: '/home/n', platform: 'linux' }, 'rules'), '/home/n/.claude/CLAUDE.md');
	});

	test('extensions.json da ids únicos en minúscula', () => {
		const text = JSON.stringify([{ identifier: { id: 'ms-python.Python' } }, { identifier: { id: 'ms-python.python' } }, { identifier: { id: 'bad' } }, {}]);
		assert.deepStrictEqual(parseExtensionsJson(text), ['ms-python.python']);
		assert.deepStrictEqual(parseExtensionsJson('nope'), []);
	});

	test('mcpServers de Claude Code y Gemini, mcp de opencode', () => {
		const claudeJson = JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'srv'], env: { A: '1', N: 2 } }, remote: { url: 'https://x' }, broken: {} } });
		assert.deepStrictEqual(parseMcpFromJson(claudeJson, 'claude-json'), {
			fs: { command: 'npx', args: ['-y', 'srv'], env: { A: '1' }, url: undefined },
			remote: { command: undefined, args: undefined, env: undefined, url: 'https://x' },
		});
		const opencodeJson = JSON.stringify({ mcp: { local: { type: 'local', command: ['bun', 'x', 'srv'], environment: { K: 'v' } } } });
		assert.deepStrictEqual(parseMcpFromJson(opencodeJson, 'opencode-json'), { local: { command: 'bun', args: ['x', 'srv'], env: { K: 'v' }, url: undefined } });
	});

	test('los servers por proyecto de Claude Code también cuentan, y el global gana por nombre', () => {
		const text = JSON.stringify({ mcpServers: { fs: { command: 'global' } }, projects: { '/a': { mcpServers: { fs: { command: 'project' }, gh: { command: 'gh-mcp' } } }, '/b': { mcpServers: { gh: { command: 'other' } } } } });
		const servers = parseMcpFromJson(text, 'claude-json');
		assert.deepStrictEqual(Object.keys(servers).sort(), ['fs', 'gh']);
		assert.strictEqual(servers.fs.command, 'global');
		assert.strictEqual(servers.gh.command, 'gh-mcp');
	});

	test('config.toml de Codex: tablas mcp_servers con args, env inline y sub-tabla env', () => {
		const toml = [
			'model = "o3"  # unrelated',
			'[mcp_servers.fs]',
			'command = "npx"',
			'args = ["-y", "server, with comma"]',
			'env = { A = "1", B = "two" }',
			'',
			'[mcp_servers.remote]',
			'url = "https://mcp.example"',
			'[mcp_servers.remote.env]',
			'TOKEN = "t"',
			'[other.table]',
			'command = "ignored"',
		].join('\n');
		assert.deepStrictEqual(parseMcpFromCodexToml(toml), {
			fs: { command: 'npx', args: ['-y', 'server, with comma'], env: { A: '1', B: 'two' }, url: undefined },
			remote: { command: undefined, args: undefined, env: { TOKEN: 't' }, url: 'https://mcp.example' },
		});
	});

	test('el mcp.json existente gana por nombre', () => {
		const merged = mergeMcpJson('{ "mcpServers": { "fs": { "command": "mine" } } }', { fs: { command: 'theirs' }, other: { url: 'https://o' } });
		const parsed = JSON.parse(merged.text);
		assert.strictEqual(merged.added, 1);
		assert.strictEqual(parsed.mcpServers.fs.command, 'mine');
		assert.strictEqual(parsed.mcpServers.other.url, 'https://o');
		assert.strictEqual(mergeMcpJson(undefined, { a: { command: 'x' } }).added, 1);
	});

	test('los atajos repetidos no se duplican', () => {
		const existing = [{ key: 'ctrl+k', command: 'a' }];
		const merged = mergeKeybindings(existing, [{ key: 'Ctrl+K', command: 'a' }, { key: 'ctrl+j', command: 'b', when: 'x' }, { nope: true }]);
		assert.strictEqual(merged.added, 1);
		assert.strictEqual(merged.entries.length, 2);
	});
});
