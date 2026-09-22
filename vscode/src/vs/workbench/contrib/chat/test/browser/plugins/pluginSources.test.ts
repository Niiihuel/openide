/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, encodeBase64, VSBuffer } from '../../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { joinPath } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IRequestContext, IRequestOptions } from '../../../../../../base/parts/request/common/request.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../../../platform/notification/test/common/testNotificationService.js';
import { IProgressService } from '../../../../../../platform/progress/common/progress.js';
import { IRequestService } from '../../../../../../platform/request/common/request.js';
import { RegistryPluginSource } from '../../../browser/pluginSources.js';
import { IMarketplacePlugin, IRegistryPluginSource, MarketplaceType, parseMarketplaceReference, PluginSourceKind } from '../../../common/plugins/pluginMarketplaceService.js';
import { readPluginInstallReceipt } from '../../../common/plugins/pluginInstallTransaction.js';
import { computePluginArtifactSha256, derivePluginPublisherKeyId, IPluginPublisherIdentity, IPluginReleaseManifest, signPluginReleaseManifest } from '../../../common/plugins/pluginSupplyChain.js';

interface IKeyFixture {
	readonly privateKey: CryptoKey;
	readonly keyId: string;
	readonly publisher: IPluginPublisherIdentity;
}

interface IArtifactInputFile {
	readonly path: string;
	readonly content: string;
	readonly mode?: number;
}

interface IPluginFixture {
	readonly plugin: IMarketplacePlugin;
	readonly artifactBytes: VSBuffer;
}

class QueueRequestService implements Partial<IRequestService> {
	declare readonly _serviceBrand: undefined;
	readonly requests: IRequestOptions[] = [];
	private readonly _responses: { readonly body: VSBuffer; readonly headers: Record<string, string> }[] = [];

	queue(body: VSBuffer, headers: Record<string, string> = { 'content-type': 'application/vnd.openide.plugin+json' }): void {
		this._responses.push({ body, headers });
	}

	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.requests.push(options);
		const response = this._responses.shift();
		if (!response) {
			throw new Error(`Unexpected request for ${options.url}`);
		}
		return {
			res: { statusCode: 200, headers: response.headers },
			stream: bufferToStream(response.body),
		};
	}
}

suite('RegistryPluginSource', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const cacheRoot = URI.from({ scheme: Schemas.inMemory, path: '/cache' });
	let fileService: FileService;
	let requestService: QueueRequestService;
	let source: RegistryPluginSource;
	let keys: IKeyFixture;

	suiteSetup(async () => {
		const generated = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
		assert.ok('privateKey' in generated);
		const publicKey = encodeBase64(VSBuffer.wrap(new Uint8Array(await crypto.subtle.exportKey('raw', generated.publicKey))), false, true);
		const keyId = await derivePluginPublisherKeyId(publicKey);
		keys = {
			privateKey: generated.privateKey,
			keyId,
			publisher: {
				schemaVersion: 1,
				publisherId: 'acme',
				displayName: 'Acme Tools',
				principal: { issuer: 'https://identity.example.test/', subject: 'account-42' },
				keys: [{
					keyId,
					algorithm: 'ed25519',
					publicKey,
					state: 'active',
					createdAt: '2026-01-01T00:00:00.000Z',
				}],
			},
		};
	});

	setup(() => {
		fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
		requestService = new QueueRequestService();
		const progressService = {
			withProgress: async (_options: unknown, callback: (...args: unknown[]) => Promise<unknown>) => callback(),
		} as unknown as IProgressService;
		source = new RegistryPluginSource(
			fileService,
			new NullLogService(),
			new TestNotificationService(),
			progressService,
			requestService as unknown as IRequestService,
		);
	});

	test('verifies and transactionally installs an immutable signed artifact', async () => {
		const fixture = await createPluginFixture(keys, '1.0.0');
		requestService.queue(fixture.artifactBytes);

		const installUri = await source.ensure(cacheRoot, fixture.plugin);

		assert.strictEqual(installUri.path, '/cache/registry/https_plugins.example.test/openide/acme/lint-tools');
		assert.strictEqual((await fileService.readFile(joinPath(installUri, 'skills/lint/SKILL.md'))).value.toString(), '# Lint\n');
		assert.strictEqual(requestService.requests.length, 1);
		assert.strictEqual(requestService.requests[0].url, fixture.plugin.sourceDescriptor.kind === PluginSourceKind.Registry ? fixture.plugin.sourceDescriptor.url : undefined);
		assert.strictEqual(requestService.requests[0].followRedirects, 0);

		const receipt = await readPluginInstallReceipt(fileService, installUri);
		const descriptor = fixture.plugin.sourceDescriptor as IRegistryPluginSource;
		assert.deepStrictEqual({
			publisherId: receipt?.provenance.publisherId,
			artifactSha256: receipt?.provenance.artifactSha256,
			signingKeyId: receipt?.provenance.signingKeyId,
			pluginVersion: receipt?.provenance.pluginVersion,
		}, {
			publisherId: 'acme',
			artifactSha256: descriptor.artifactSha256,
			signingKeyId: keys.keyId,
			pluginVersion: '1.0.0',
		});
	});

	test('uses a verified receipt only when it identifies the exact release', async () => {
		const fixture = await createPluginFixture(keys, '1.0.0');
		requestService.queue(fixture.artifactBytes);

		const first = await source.ensure(cacheRoot, fixture.plugin);
		const second = await source.ensure(cacheRoot, fixture.plugin);

		assert.strictEqual(first.toString(), second.toString());
		assert.strictEqual(requestService.requests.length, 1);
	});

	test('preserves the previous install when downloaded bytes fail the signed digest', async () => {
		const first = await createPluginFixture(keys, '1.0.0');
		requestService.queue(first.artifactBytes);
		const installUri = await source.ensure(cacheRoot, first.plugin);
		const second = await createPluginFixture(keys, '2.0.0');
		const tampered = VSBuffer.fromString(second.artifactBytes.toString().replace('"schemaVersion":1', '"schemaVersion":2'));
		assert.strictEqual(tampered.byteLength, second.artifactBytes.byteLength);
		requestService.queue(tampered);

		await assert.rejects(() => source.update(cacheRoot, second.plugin, { silent: true }), /SHA-256 verification/);

		const installedManifest = JSON.parse((await fileService.readFile(joinPath(installUri, 'plugin.json'))).value.toString());
		assert.strictEqual(installedManifest.version, '1.0.0');
	});

	test('rejects unsafe paths without writing outside staging', async () => {
		const fixture = await createPluginFixture(keys, '1.0.0', [
			{ path: '../escape', content: 'escape' },
		]);
		requestService.queue(fixture.artifactBytes);

		await assert.rejects(() => source.ensure(cacheRoot, fixture.plugin), /path.*unsafe|path.*portable/i);

		assert.strictEqual(await fileService.exists(URI.from({ scheme: Schemas.inMemory, path: '/cache/escape' })), false);
		assert.strictEqual(await fileService.exists(source.getInstallUri(cacheRoot, fixture.plugin.sourceDescriptor)), false);
	});

	test('rejects executable mode because artifact schema v1 cannot materialize it portably', async () => {
		const fixture = await createPluginFixture(keys, '1.0.0', [
			{ path: 'scripts/run.sh', content: '#!/bin/sh\n', mode: 0o755 },
		]);
		requestService.queue(fixture.artifactBytes);

		await assert.rejects(() => source.ensure(cacheRoot, fixture.plugin), /unsupported mode/);
	});

	test('rejects transport metadata that disagrees with the signed artifact', async () => {
		const fixture = await createPluginFixture(keys, '1.0.0');
		requestService.queue(fixture.artifactBytes, { 'content-type': 'application/json' });

		await assert.rejects(() => source.ensure(cacheRoot, fixture.plugin), /Content-Type/);

		requestService.queue(fixture.artifactBytes, {
			'content-type': 'application/vnd.openide.plugin+json',
			'content-length': String(fixture.artifactBytes.byteLength + 1),
		});
		await assert.rejects(() => source.ensure(cacheRoot, fixture.plugin), /Content-Length/);
	});
});

async function createPluginFixture(keys: IKeyFixture, version: string, additionalFiles: readonly IArtifactInputFile[] = [{ path: 'skills/lint/SKILL.md', content: '# Lint\n' }]): Promise<IPluginFixture> {
	const pluginManifest = JSON.stringify({
		$schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
		name: 'lint-tools',
		version,
	});
	const inputs: IArtifactInputFile[] = [
		{ path: 'plugin.json', content: pluginManifest },
		...additionalFiles,
	];
	inputs.sort((left, right) => left.path === right.path ? 0 : left.path < right.path ? -1 : 1);
	const files = await Promise.all(inputs.map(async input => {
		const contents = VSBuffer.fromString(input.content);
		return {
			path: input.path,
			mode: input.mode ?? 0o644,
			size: contents.byteLength,
			sha256: await computePluginArtifactSha256(contents),
			content: encodeBase64(contents, true, false),
		};
	}));
	const artifactBytes = VSBuffer.fromString(JSON.stringify({ schemaVersion: 1, files }));
	const artifactSha256 = await computePluginArtifactSha256(artifactBytes);
	const release: IPluginReleaseManifest = {
		schemaVersion: 1,
		publisherId: 'acme',
		pluginId: 'lint-tools',
		version,
		signingKeyId: keys.keyId,
		createdAt: '2026-01-02T00:00:00.000Z',
		artifact: {
			mediaType: 'application/vnd.openide.plugin+json',
			size: artifactBytes.byteLength,
			sha256: artifactSha256,
		},
	};
	const url = `https://plugins.example.test/openide/v1/publishers/acme/plugins/lint-tools/versions/${version}/artifact`;
	const marketplaceReference = parseMarketplaceReference('https://plugins.example.test/openide/v1/marketplace.json');
	assert.ok(marketplaceReference);
	const sourceDescriptor: IRegistryPluginSource = {
		kind: PluginSourceKind.Registry,
		url,
		artifactSha256,
		release,
		signature: await signPluginReleaseManifest(release, keys.privateKey),
		publisher: keys.publisher,
	};
	return {
		artifactBytes,
		plugin: {
			name: 'acme/lint-tools',
			description: 'Lint tools',
			version,
			source: url,
			sourceDescriptor,
			marketplace: marketplaceReference.displayLabel,
			marketplaceReference,
			marketplaceType: MarketplaceType.OpenPlugin,
		},
	};
}
