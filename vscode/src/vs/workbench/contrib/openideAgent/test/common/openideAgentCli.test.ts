/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildClaudeMcpConfig, buildExecutableProbe, buildOpencodeMcpConfig, buildOpenideCliLaunch, parseExecutableProbe, getOpenideCli, IOpenideMcpEndpoint, OPENIDE_MCP_TOOL_TIMEOUT_MS, groupOpenideSessions, isSafeProviderSessionId, OPENIDE_CLI_CATALOG, openideSessionGroupOf, reduceOpenideCliStatus, stripClaudeResumeArgs } from '../../common/openideAgentCliCatalog.js';
import { OPENIDE_PROVIDER_BRANDS } from '../../common/openideProviderBranding.js';

suite('OpenIDE CLI sessions — catálogo, resume, estado y agrupación', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('el catálogo no repite ids ni binarios y cada entrada tiene ícono', () => {
		const ids = new Set(OPENIDE_CLI_CATALOG.map(cli => cli.id));
		const binaries = new Set(OPENIDE_CLI_CATALOG.map(cli => cli.binary));
		assert.strictEqual(ids.size, OPENIDE_CLI_CATALOG.length);
		assert.strictEqual(binaries.size, OPENIDE_CLI_CATALOG.length);
		assert.ok(OPENIDE_CLI_CATALOG.every(cli => cli.icon.length > 0));
		// A key that is NOT in the brand map still renders — as the initials of whatever label it
		// was handed — so a typo'd or renamed id degrades to a monogram in silence. The popover
		// and the dock's view tabs both paint from here, which is where that showed up.
		for (const cli of OPENIDE_CLI_CATALOG) {
			assert.ok(OPENIDE_PROVIDER_BRANDS[cli.icon], `${cli.id}: ícono "${cli.icon}" no está en OPENIDE_PROVIDER_BRANDS`);
		}
		assert.strictEqual(getOpenideCli('claude')?.name, 'Claude Code');
		assert.strictEqual(getOpenideCli('nope'), undefined);
	});

	test('resume de Claude: agrega --resume <id> y quita los resume/continue previos', () => {
		const claude = getOpenideCli('claude')!;
		const withPrior = { ...claude, launchArgs: ['--resume', 'old', '--continue', '-r=x', '--model', 'opus'] };
		const launch = buildOpenideCliLaunch(withPrior, '/usr/bin/claude', 'abc-123');
		assert.deepStrictEqual(launch.args, ['--model', 'opus', '--resume', 'abc-123']);
		assert.strictEqual(launch.executable, '/usr/bin/claude');
	});

	test('stripClaudeResumeArgs no toca -r<id> pegado ni flags ajenos', () => {
		assert.deepStrictEqual(stripClaudeResumeArgs(['-rfoo', '--verbose', '-r', '--other']), ['-rfoo', '--verbose', '--other']);
	});

	test('resume de Codex y opencode usan su propia forma; amp no resume', () => {
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', 'sess').args, ['resume', 'sess']);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', 'sess').args, ['--session', 'sess']);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('amp')!, 'amp', 'sess').args, []);
	});

	test('un id de sesión con caracteres raros nunca llega a argv', () => {
		assert.strictEqual(isSafeProviderSessionId('abc-DEF_1.2'), true);
		assert.strictEqual(isSafeProviderSessionId('a b'), false);
		assert.strictEqual(isSafeProviderSessionId('$(rm -rf)'), false);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', 'x y').args, []);
	});

	test('transiciones de estado: hooks mandan, la heurística solo sin hooks', () => {
		assert.strictEqual(reduceOpenideCliStatus('needs-input', { type: 'launched' }, false), 'in-progress');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'quiet' }, false), 'needs-input');
		assert.strictEqual(reduceOpenideCliStatus('needs-input', { type: 'output' }, false), 'in-progress');
		// With hooks the output heuristic is inert.
		assert.strictEqual(reduceOpenideCliStatus('needs-input', { type: 'output' }, true), 'needs-input');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'quiet' }, true), 'in-progress');
		assert.strictEqual(reduceOpenideCliStatus('needs-input', { type: 'hook:prompt' }, true), 'in-progress');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'hook:stop' }, true), 'needs-input');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'hook:stop', failed: true }, true), 'failed');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'hook:notification' }, true), 'needs-input');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'exit', code: 0 }, false), 'completed');
		assert.strictEqual(reduceOpenideCliStatus('in-progress', { type: 'exit', code: 1 }, true), 'failed');
		// A finished session does not wake up on late output.
		assert.strictEqual(reduceOpenideCliStatus('completed', { type: 'output' }, false), 'completed');
	});

	test('agrupación por recencia: hoy, ayer, 7 días, 30 días, más viejas', () => {
		const now = new Date(2026, 7, 24, 15, 0, 0).getTime();
		const day = 24 * 60 * 60 * 1000;
		assert.strictEqual(openideSessionGroupOf(now - 60_000, now), 'today');
		assert.strictEqual(openideSessionGroupOf(now - day, now), 'yesterday');
		assert.strictEqual(openideSessionGroupOf(now - 3 * day, now), 'week');
		assert.strictEqual(openideSessionGroupOf(now - 20 * day, now), 'month');
		assert.strictEqual(openideSessionGroupOf(now - 90 * day, now), 'older');
		const groups = groupOpenideSessions([
			{ id: 'a', updatedAt: now - 90 * day },
			{ id: 'b', updatedAt: now - 60_000 },
			{ id: 'c', updatedAt: now - 3 * day },
			{ id: 'd', updatedAt: now - 10 },
		], now);
		assert.deepStrictEqual(groups.map(group => group.group), ['today', 'week', 'older']);
		assert.deepStrictEqual(groups[0].sessions.map(session => session.id), ['d', 'b']);
	});

	suite('sonda de ejecutables', () => {

		test('una sola orden cubre todo el catálogo', () => {
			// One per agent went through the SAME shared terminal: seven concurrent commands trample
			// each other's output, every listener resolves with whichever finished first and reads
			// someone else's answer. That was the bug where the picker offered one CLI with four
			// installed.
			const probe = buildExecutableProbe(['claude', 'codex']);
			assert.equal(probe.split('command -v').length - 1, 2);
			assert.ok(probe.includes('command -v claude'));
			assert.ok(probe.includes('command -v codex'));
		});

		test('solo usa lo que sh, bash, zsh y fish entienden igual', () => {
			// The login shell is whichever the user picked, and fish does not parse an sh `for`.
			const probe = buildExecutableProbe(['claude']);
			assert.equal(/\bfor\b|\bdone\b|\$\(|`|\[\[/.test(probe), false, probe);
		});

		test('un nombre que no es un binario no entra al comando', () => {
			assert.equal(buildExecutableProbe(['claude; rm -rf /']), '');
		});

		test('en Windows habla cmd, no sh', () => {
			// El shell de login lo elige el sistema: main lo corre por ComSpec, y cmd encadena con
			// `&`, no con `;`. Mandarle sintaxis de sh devuelve cero binarios sin decir por qué.
			const probe = buildExecutableProbe(['claude'], true);
			assert.ok(probe.includes('where claude'));
			assert.equal(probe.includes('command -v'), false);
			assert.equal(probe.includes(';'), false);
		});

		test('reparte cada ruta al binario correcto', () => {
			const output = [
				'/home/u/.local/bin/claude', 'OPENIDE_BIN_MARK claude',
				'/home/u/.npm-global/bin/codex', 'OPENIDE_BIN_MARK codex',
				'OPENIDE_BIN_MARK amp',
			].join('\n');
			const found = parseExecutableProbe(['claude', 'codex', 'amp'], output);
			assert.equal(found.get('claude'), '/home/u/.local/bin/claude');
			assert.equal(found.get('codex'), '/home/u/.npm-global/bin/codex');
			assert.equal(found.get('amp'), undefined);
		});

		test('el ruido del prompt no se confunde con una ruta', () => {
			const output = ['nihuel@host ~/proj>', '/usr/bin/claude', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), '/usr/bin/claude');
		});

		test('una ruta que no termina en el nombre pedido se descarta', () => {
			// The capture drags the tail of a previous command; starting with / is not enough.
			const output = ['/otra/cosa/distinta', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), undefined);
		});

		test('la marca de un binario que no pedimos no rompe el reparto', () => {
			const output = ['/usr/bin/otro', 'OPENIDE_BIN_MARK otro', '/usr/bin/claude', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), '/usr/bin/claude');
		});

		test('una salida vacía deja todo en undefined, no rompe', () => {
			const found = parseExecutableProbe(['claude', 'codex'], '');
			assert.equal(found.size, 2);
			assert.equal(found.get('claude'), undefined);
		});
	});

	suite('inyección del MCP de OpenIDE', () => {

		const endpoint: IOpenideMcpEndpoint = {
			name: 'openide',
			url: 'http://127.0.0.1:41234/mcp',
			token: 'a3f1c2d4e5f60718293a4b5c6d7e8f90',
			tokenEnvVar: 'OPENIDE_MCP_TOKEN',
			configFile: '/tmp/openide-mcp/s1.json',
		};

		test('el token NUNCA viaja en argv', () => {
			// On Linux any process can read argv through /proc, and this token opens tools that read
			// and write the user's files. It is the whole reason for the file and the env var.
			for (const cli of OPENIDE_CLI_CATALOG) {
				const launch = buildOpenideCliLaunch(cli, cli.binary, undefined, endpoint);
				assert.ok(!launch.args.some(arg => arg.includes(endpoint.token)), cli.id);
			}
		});

		test('claude recibe la ruta del config, no el JSON', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', undefined, endpoint);
			assert.deepStrictEqual(launch.args, ['--mcp-config', '/tmp/openide-mcp/s1.json']);
			assert.deepStrictEqual(launch.env, {});
		});

		test('sin archivo escrito, claude se lanza sin tools de OpenIDE en vez de fallar', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', undefined, { ...endpoint, configFile: undefined });
			assert.deepStrictEqual(launch.args, []);
		});

		test('codex lee el bearer de un env var', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', undefined, endpoint);
			assert.deepStrictEqual(launch.args, [
				'-c', 'mcp_servers.openide.url="http://127.0.0.1:41234/mcp"',
				'-c', 'mcp_servers.openide.bearer_token_env_var="OPENIDE_MCP_TOKEN"',
				'-c', `mcp_servers.openide.tool_timeout_sec=${OPENIDE_MCP_TOOL_TIMEOUT_MS / 1000}`,
			]);
			assert.deepStrictEqual(launch.env, { OPENIDE_MCP_TOKEN: endpoint.token });
		});

		test('los flags de MCP van ANTES del subcomando de resume', () => {
			// `codex resume <id>` is a subcommand: a global option placed after it gets parsed by the
			// subcommand and codex rejects it. The order is correctness, not style.
			const launch = buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', 'abc123', endpoint);
			assert.strictEqual(launch.args[0], '-c');
			assert.deepStrictEqual(launch.args.slice(-2), ['resume', 'abc123']);
		});

		test('opencode recibe la config por env, no por argv', () => {
			// OPENCODE_CONFIG names a file loaded BETWEEN the global and the project one, so the
			// user's servers, providers and keys survive. Verified against opencode 1.17.12: it shows
			// up as "✓ openide connected" in `opencode mcp list`.
			const launch = buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', undefined, endpoint);
			assert.deepStrictEqual(launch.args, []);
			assert.deepStrictEqual(launch.env, { OPENCODE_CONFIG: '/tmp/openide-mcp/s1.json' });
		});

		test('sin archivo escrito, opencode tampoco recibe env', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', undefined, { ...endpoint, configFile: undefined });
			assert.deepStrictEqual(launch.env, {});
		});

		test('cada CLI que toma archivo declara su propia forma', () => {
			// The shape and the key are the CLI's call, not the writer's: claude wants mcpServers and
			// opencode wants mcp/remote. Sharing one builder would misconfigure one of the two.
			const claude = JSON.parse(buildClaudeMcpConfig(endpoint));
			const opencode = JSON.parse(buildOpencodeMcpConfig(endpoint));
			assert.ok(claude.mcpServers.openide);
			assert.equal(opencode.mcp.openide.type, 'remote');
			assert.equal(opencode.mcp.openide.enabled, true);
			assert.equal(opencode.mcp.openide.headers.Authorization, `Bearer ${endpoint.token}`);
		});

		test('un CLI sin mecanismo por sesión se lanza igual, sin inyectar nada', () => {
			const amp = getOpenideCli('amp')!;
			assert.strictEqual(amp.mcpInjection, undefined);
			const launch = buildOpenideCliLaunch(amp, 'amp', undefined, endpoint);
			assert.deepStrictEqual(launch.args, []);
			assert.deepStrictEqual(launch.env, {});
		});

		test('el config de claude lleva el bearer, el endpoint y un timeout generoso', () => {
			const parsed = JSON.parse(buildClaudeMcpConfig(endpoint));
			assert.deepStrictEqual(parsed.mcpServers.openide, {
				type: 'http',
				url: endpoint.url,
				headers: { Authorization: `Bearer ${endpoint.token}` },
				timeout: OPENIDE_MCP_TOOL_TIMEOUT_MS,
			});
		});

		test('el timeout se fija por server, no por proceso', () => {
			// MCP_TOOL_TIMEOUT is global to the CLI process: raising it would silently change the
			// behaviour of EVERY MCP server the user configured, not only ours.
			for (const cli of OPENIDE_CLI_CATALOG) {
				const launch = buildOpenideCliLaunch(cli, cli.binary, undefined, endpoint);
				assert.equal(launch.env.MCP_TOOL_TIMEOUT, undefined, cli.id);
			}
		});

		test('una revisión humana entra cómoda en el techo que pedimos', () => {
			// Measured against Claude Code 2.1.245: a parked call was still alive at 269s with the
			// default values. This stops depending on that luck.
			assert.ok(OPENIDE_MCP_TOOL_TIMEOUT_MS >= 10 * 60_000);
		});
	});
});
