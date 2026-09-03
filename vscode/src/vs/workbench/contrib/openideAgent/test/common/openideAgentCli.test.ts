/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OPENIDE_HOSTED_CLI_ENV_RESET, buildClaudeMcpConfig, buildExecutableProbe, buildOpencodeMcpConfig, buildOpenideCliLaunch, parseExecutableProbe, getOpenideCli, IOpenideMcpEndpoint, OPENIDE_MCP_TOOL_TIMEOUT_MS, groupOpenideSessions, isSafeProviderSessionId, OPENIDE_CLI_CATALOG, openideSessionGroupOf, reduceOpenideCliStatus, stripClaudeResumeArgs } from '../../common/openideAgentCliCatalog.js';
import { OPENIDE_PROVIDER_BRANDS } from '../../common/openideProviderBranding.js';

suite('OpenIDE CLI sessions — catalog, resume, state and grouping', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the catalog repeats no ids nor binaries, and every entry has an icon', () => {
		const ids = new Set(OPENIDE_CLI_CATALOG.map(cli => cli.id));
		const binaries = new Set(OPENIDE_CLI_CATALOG.map(cli => cli.binary));
		assert.strictEqual(ids.size, OPENIDE_CLI_CATALOG.length);
		assert.strictEqual(binaries.size, OPENIDE_CLI_CATALOG.length);
		assert.ok(OPENIDE_CLI_CATALOG.every(cli => cli.icon.length > 0));
		// A key that is NOT in the brand map still renders — as the initials of whatever label it
		// was handed — so a typo'd or renamed id degrades to a monogram in silence. The popover
		// and the dock's view tabs both paint from here, which is where that showed up.
		for (const cli of OPENIDE_CLI_CATALOG) {
			assert.ok(OPENIDE_PROVIDER_BRANDS[cli.icon], `${cli.id}: icon "${cli.icon}" is not in OPENIDE_PROVIDER_BRANDS`);
		}
		assert.strictEqual(getOpenideCli('claude')?.name, 'Claude Code');
		assert.strictEqual(getOpenideCli('nope'), undefined);
	});

	test('Claude resume: adds --resume <id> and drops any earlier resume/continue', () => {
		const claude = getOpenideCli('claude')!;
		const withPrior = { ...claude, launchArgs: ['--resume', 'old', '--continue', '-r=x', '--model', 'opus'] };
		const launch = buildOpenideCliLaunch(withPrior, '/usr/bin/claude', 'abc-123');
		assert.deepStrictEqual(launch.args, ['--model', 'opus', '--resume', 'abc-123']);
		assert.strictEqual(launch.executable, '/usr/bin/claude');
	});

	test('stripClaudeResumeArgs leaves an attached -r<id> and foreign flags alone', () => {
		assert.deepStrictEqual(stripClaudeResumeArgs(['-rfoo', '--verbose', '-r', '--other']), ['-rfoo', '--verbose', '--other']);
	});

	test('Codex and opencode resume in their own shapes; amp does not resume', () => {
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', 'sess').args, ['resume', 'sess']);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', 'sess').args, ['--session', 'sess']);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('amp')!, 'amp', 'sess').args, []);
	});

	test('a session id with odd characters never reaches argv', () => {
		assert.strictEqual(isSafeProviderSessionId('abc-DEF_1.2'), true);
		assert.strictEqual(isSafeProviderSessionId('a b'), false);
		assert.strictEqual(isSafeProviderSessionId('$(rm -rf)'), false);
		assert.deepStrictEqual(buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', 'x y').args, []);
	});

	test('state transitions: hooks win, the heuristic only applies without hooks', () => {
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

	test('grouping by recency: today, yesterday, 7 days, 30 days, older', () => {
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

	suite('executable probe', () => {

		test('a single command covers the whole catalog', () => {
			// One per agent went through the SAME shared terminal: seven concurrent commands trample
			// each other's output, every listener resolves with whichever finished first and reads
			// someone else's answer. That was the bug where the picker offered one CLI with four
			// installed.
			const probe = buildExecutableProbe(['claude', 'codex']);
			assert.equal(probe.split('command -v').length - 1, 2);
			assert.ok(probe.includes('command -v claude'));
			assert.ok(probe.includes('command -v codex'));
		});

		test('it only uses what sh, bash, zsh and fish all understand the same way', () => {
			// The login shell is whichever the user picked, and fish does not parse an sh `for`.
			const probe = buildExecutableProbe(['claude']);
			assert.equal(/\bfor\b|\bdone\b|\$\(|`|\[\[/.test(probe), false, probe);
		});

		test('a name that is not a binary never enters the command', () => {
			assert.equal(buildExecutableProbe(['claude; rm -rf /']), '');
		});

		test('on Windows it speaks cmd, not sh', () => {
			// The system picks the login shell: main runs it through ComSpec, and cmd chains with
			// `&`, not `;`. Handing it sh syntax returns zero binaries without saying why.
			const probe = buildExecutableProbe(['claude'], true);
			assert.ok(probe.includes('where claude'));
			assert.equal(probe.includes('command -v'), false);
			assert.equal(probe.includes(';'), false);
		});

		test('it hands each path to the right binary', () => {
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

		test('prompt noise is not mistaken for a path', () => {
			const output = ['nihuel@host ~/proj>', '/usr/bin/claude', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), '/usr/bin/claude');
		});

		test('a path that does not end in the requested name is discarded', () => {
			// The capture drags the tail of a previous command; starting with / is not enough.
			const output = ['/otra/cosa/distinta', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), undefined);
		});

		test('the marker of a binary we did not ask for does not break the split', () => {
			const output = ['/usr/bin/otro', 'OPENIDE_BIN_MARK otro', '/usr/bin/claude', 'OPENIDE_BIN_MARK claude'].join('\n');
			assert.equal(parseExecutableProbe(['claude'], output).get('claude'), '/usr/bin/claude');
		});

		test('empty output leaves everything undefined instead of throwing', () => {
			const found = parseExecutableProbe(['claude', 'codex'], '');
			assert.equal(found.size, 2);
			assert.equal(found.get('claude'), undefined);
		});
	});

	suite('OpenIDE MCP injection', () => {

		const endpoint: IOpenideMcpEndpoint = {
			name: 'openide',
			url: 'http://127.0.0.1:41234/mcp',
			token: 'a3f1c2d4e5f60718293a4b5c6d7e8f90',
			tokenEnvVar: 'OPENIDE_MCP_TOKEN',
			configFile: '/tmp/openide-mcp/s1.json',
		};

		test('the token NEVER travels in argv', () => {
			// On Linux any process can read argv through /proc, and this token opens tools that read
			// and write the user's files. It is the whole reason for the file and the env var.
			for (const cli of OPENIDE_CLI_CATALOG) {
				const launch = buildOpenideCliLaunch(cli, cli.binary, undefined, endpoint);
				assert.ok(!launch.args.some(arg => arg.includes(endpoint.token)), cli.id);
			}
		});

		test('claude receives the config path, not the JSON', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', undefined, endpoint);
			assert.deepStrictEqual(launch.args, ['--mcp-config', '/tmp/openide-mcp/s1.json']);
			assert.deepStrictEqual(launch.env, {});
		});

		test('with no file written, claude launches without OpenIDE tools instead of failing', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('claude')!, 'claude', undefined, { ...endpoint, configFile: undefined });
			assert.deepStrictEqual(launch.args, []);
		});

		test('codex reads the bearer from an env var', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', undefined, endpoint);
			assert.deepStrictEqual(launch.args, [
				'-c', 'mcp_servers.openide.url="http://127.0.0.1:41234/mcp"',
				'-c', 'mcp_servers.openide.bearer_token_env_var="OPENIDE_MCP_TOKEN"',
				'-c', `mcp_servers.openide.tool_timeout_sec=${OPENIDE_MCP_TOOL_TIMEOUT_MS / 1000}`,
			]);
			assert.deepStrictEqual(launch.env, { OPENIDE_MCP_TOKEN: endpoint.token });
		});

		test('the MCP flags go BEFORE the resume subcommand', () => {
			// `codex resume <id>` is a subcommand: a global option placed after it gets parsed by the
			// subcommand and codex rejects it. The order is correctness, not style.
			const launch = buildOpenideCliLaunch(getOpenideCli('codex')!, 'codex', 'abc123', endpoint);
			assert.strictEqual(launch.args[0], '-c');
			assert.deepStrictEqual(launch.args.slice(-2), ['resume', 'abc123']);
		});

		test('opencode receives the config through env, not through argv', () => {
			// OPENCODE_CONFIG names a file loaded BETWEEN the global and the project one, so the
			// user's servers, providers and keys survive. Verified against opencode 1.17.12: it shows
			// up as "✓ openide connected" in `opencode mcp list`.
			const launch = buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', undefined, endpoint);
			assert.deepStrictEqual(launch.args, []);
			assert.deepStrictEqual(launch.env, { OPENCODE_CONFIG: '/tmp/openide-mcp/s1.json' });
		});

		test('with no file written, opencode gets no env either', () => {
			const launch = buildOpenideCliLaunch(getOpenideCli('opencode')!, 'opencode', undefined, { ...endpoint, configFile: undefined });
			assert.deepStrictEqual(launch.env, {});
		});

		test('every CLI that takes a file declares its own shape', () => {
			// The shape and the key are the CLI's call, not the writer's: claude wants mcpServers and
			// opencode wants mcp/remote. Sharing one builder would misconfigure one of the two.
			const claude = JSON.parse(buildClaudeMcpConfig(endpoint));
			const opencode = JSON.parse(buildOpencodeMcpConfig(endpoint));
			assert.ok(claude.mcpServers.openide);
			assert.equal(opencode.mcp.openide.type, 'remote');
			assert.equal(opencode.mcp.openide.enabled, true);
			assert.equal(opencode.mcp.openide.headers.Authorization, `Bearer ${endpoint.token}`);
		});

		test('a CLI with no per-session mechanism still launches, injecting nothing', () => {
			const amp = getOpenideCli('amp')!;
			assert.strictEqual(amp.mcpInjection, undefined);
			const launch = buildOpenideCliLaunch(amp, 'amp', undefined, endpoint);
			assert.deepStrictEqual(launch.args, []);
			assert.deepStrictEqual(launch.env, {});
		});

		test('claude\'s config carries the bearer, the endpoint and a generous timeout', () => {
			const parsed = JSON.parse(buildClaudeMcpConfig(endpoint));
			assert.deepStrictEqual(parsed.mcpServers.openide, {
				type: 'http',
				url: endpoint.url,
				headers: { Authorization: `Bearer ${endpoint.token}` },
				timeout: OPENIDE_MCP_TOOL_TIMEOUT_MS,
			});
		});

		test('the timeout is set per server, not per process', () => {
			// MCP_TOOL_TIMEOUT is global to the CLI process: raising it would silently change the
			// behaviour of EVERY MCP server the user configured, not only ours.
			for (const cli of OPENIDE_CLI_CATALOG) {
				const launch = buildOpenideCliLaunch(cli, cli.binary, undefined, endpoint);
				assert.equal(launch.env.MCP_TOOL_TIMEOUT, undefined, cli.id);
			}
		});

		test('a human review fits comfortably under the ceiling we ask for', () => {
			// Measured against Claude Code 2.1.245: a parked call was still alive at 269s with the
			// default values. This stops depending on that luck.
			assert.ok(OPENIDE_MCP_TOOL_TIMEOUT_MS >= 10 * 60_000);
		});
	});

	suite('environment of a hosted CLI', () => {
		test('it clears Claude Code\'s nested-session markers, and only those', () => {
			for (const [key, value] of Object.entries(OPENIDE_HOSTED_CLI_ENV_RESET)) {
				assert.strictEqual(value, null, key);
				assert.match(key, /^CLAUDE/, key);
			}
			assert.ok('CLAUDE_CODE_CHILD_SESSION' in OPENIDE_HOSTED_CLI_ENV_RESET);
			assert.ok('CLAUDECODE' in OPENIDE_HOSTED_CLI_ENV_RESET);
			// What the user configures, and what the IDE sets to adopt the window, must survive.
			for (const kept of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SSE_PORT', 'ANTHROPIC_API_KEY']) {
				assert.ok(!(kept in OPENIDE_HOSTED_CLI_ENV_RESET), kept);
			}
		});

		test('what OpenIDE sets on purpose overrides the reset', () => {
			const env: Record<string, string | null> = { ...OPENIDE_HOSTED_CLI_ENV_RESET, OPENIDE_SESSION_ID: 's1', CLAUDE_CODE_SSE_PORT: '4321' };
			assert.strictEqual(env.CLAUDE_CODE_SSE_PORT, '4321');
			assert.strictEqual(env.CLAUDE_CODE_CHILD_SESSION, null);
		});
	});
});
