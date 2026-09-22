#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRegistryServer } from './registry-server.mjs';
import {
	loadPublisherPrivateKey,
	normalizeRegistryBase,
	promotePluginRelease,
	registerPublisher,
	rollbackPluginRelease,
	stagePluginRelease,
	uploadPluginRelease,
	yankPluginRelease,
} from './registry-client.mjs';
import { publicKeyBase64Url, publisherKeyId } from './registry-lib.mjs';

const [command, ...rawArgs] = process.argv.slice(2);

try {
	const args = parseArgs(rawArgs);
	switch (command) {
		case 'keygen':
			await keygen(args);
			break;
		case 'serve':
			await serve(args);
			break;
		case 'register':
			await register(args);
			break;
		case 'upload':
			await upload(args);
			break;
		case 'stage':
			await transition(args, stagePluginRelease);
			break;
		case 'promote':
			await transition(args, promotePluginRelease);
			break;
		case 'rollback':
			await transition(args, rollbackPluginRelease);
			break;
		case 'yank':
			await transition(args, yankPluginRelease);
			break;
		default:
			usage(command ? `Unknown command '${command}'.` : undefined);
	}
} catch (error) {
	process.stderr.write(`plugin-registry: ${error?.message ?? String(error)}\n`);
	process.exitCode = 1;
}

async function keygen(args) {
	const privatePath = resolve(required(args, 'private'));
	const publicPath = resolve(required(args, 'public'));
	if (privatePath === publicPath) {
		throw new Error('--private and --public must use different paths.');
	}
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	await Promise.all([mkdir(dirname(privatePath), { recursive: true }), mkdir(dirname(publicPath), { recursive: true })]);
	await writeFile(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
	await chmod(privatePath, 0o600);
	const publicKeyBase64 = publicKeyBase64Url(publicKey);
	await writeFile(publicPath, `${publicKeyBase64}\n`, { flag: 'wx', mode: 0o644 });
	print({ privateKey: privatePath, publicKey: publicPath, keyId: publisherKeyId(publicKeyBase64) });
}

async function serve(args) {
	const root = resolve(required(args, 'root'));
	const host = args.host ?? '127.0.0.1';
	const port = numberArg(args.port ?? '8787', '--port', 0, 65_535);
	const publicBaseUrl = args['public-url'] ? normalizeRegistryBase(args['public-url']) : undefined;
	const adminToken = process.env.OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN;
	const { server } = await createRegistryServer({ root, name: args.name, adminToken, publicBaseUrl });
	await new Promise((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(port, host, resolveListen);
	});
	const address = server.address();
	process.stdout.write(`OpenIDE plugin registry listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : String(address)}\n`);
	const shutdown = signal => {
		process.stdout.write(`Stopping registry (${signal})...\n`);
		server.close(error => {
			if (error) {
				process.stderr.write(`${error.message}\n`);
				process.exitCode = 1;
			}
		});
	};
	process.once('SIGINT', () => shutdown('SIGINT'));
	process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function register(args) {
	const adminToken = process.env.OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN;
	if (!adminToken) {
		throw new Error('OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN is required.');
	}
	const publicKey = (await readFile(resolve(required(args, 'public-key')), 'utf8')).trim();
	print(await registerPublisher({
		registry: required(args, 'registry'),
		adminToken,
		publisher: required(args, 'publisher'),
		displayName: required(args, 'display-name'),
		principal: { issuer: required(args, 'issuer'), subject: required(args, 'subject') },
		publicKey,
	}));
}

async function upload(args) {
	const privateKey = await loadPublisherPrivateKey(resolve(required(args, 'private-key')));
	const options = {
		registry: required(args, 'registry'),
		publisher: required(args, 'publisher'),
		pluginDirectory: resolve(required(args, 'plugin')),
		version: args.version,
		privateKey,
	};
	const uploaded = await uploadPluginRelease(options);
	const results = { uploaded };
	if (args.stage || args.promote) {
		results.staged = await stagePluginRelease({ ...options, name: uploaded.name, version: uploaded.version });
	}
	if (args.promote) {
		results.published = await promotePluginRelease({ ...options, name: uploaded.name, version: uploaded.version });
	}
	print(results);
}

async function transition(args, operation) {
	const privateKey = await loadPublisherPrivateKey(resolve(required(args, 'private-key')));
	print(await operation({
		registry: required(args, 'registry'),
		publisher: required(args, 'publisher'),
		name: required(args, 'plugin'),
		version: required(args, 'version'),
		privateKey,
	}));
}

function parseArgs(values) {
	const result = {};
	for (let index = 0; index < values.length; index++) {
		const token = values[index];
		if (!token.startsWith('--')) {
			throw new Error(`Unexpected argument '${token}'.`);
		}
		const key = token.slice(2);
		if (!key || Object.hasOwn(result, key)) {
			throw new Error(`Invalid or duplicate option '${token}'.`);
		}
		const next = values[index + 1];
		if (!next || next.startsWith('--')) {
			result[key] = true;
		} else {
			result[key] = next;
			index++;
		}
	}
	return result;
}

function required(args, name) {
	const value = args[name];
	if (typeof value !== 'string' || !value) {
		throw new Error(`--${name} is required.`);
	}
	return value;
}

function numberArg(value, label, minimum, maximum) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
	}
	return parsed;
}

function print(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(error) {
	if (error) {
		process.stderr.write(`${error}\n\n`);
	}
	process.stderr.write(`Usage:
  cli.mjs keygen --private <key.pem> --public <key.pub>
  cli.mjs serve --root <dir> [--name <id>] [--host <host>] [--port <port>] [--public-url <https-url>]
  cli.mjs register --registry <url> --publisher <id> --display-name <name> --issuer <https-url> --subject <id> --public-key <key.pub>
  cli.mjs upload --registry <url> --publisher <id> --plugin <dir> [--version <semver>] --private-key <key.pem> [--stage] [--promote]
  cli.mjs stage|promote|rollback|yank --registry <url> --publisher <id> --plugin <name> --version <semver> --private-key <key.pem>

Environment:
  OPENIDE_PLUGIN_REGISTRY_ADMIN_TOKEN   Required by serve and register (minimum 24 characters).
`);
	process.exitCode = 2;
}
