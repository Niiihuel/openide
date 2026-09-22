/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { encodeBase64, VSBuffer } from '../../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	assertPluginReleaseVersionIsImmutable,
	canonicalizePluginReleaseManifest,
	computePluginArtifactSha256,
	createPluginReleasePromotion,
	derivePluginPublisherKeyId,
	IPluginPublisherIdentity,
	IPluginReleaseManifest,
	IPluginReleaseRecord,
	parsePluginPublisherIdentity,
	parsePluginReleaseManifest,
	PluginSupplyChainError,
	signPluginReleaseManifest,
	transitionPluginReleaseState,
	validatePluginReleasePromotionHistory,
	verifyPluginArtifactSha256,
	verifyPluginPublisherIdentity,
	verifyPluginReleaseSignature,
} from '../../../common/plugins/pluginSupplyChain.js';

suite('Plugin supply chain', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	interface IKeyFixture {
		readonly privateKey: CryptoKey;
		readonly publicKey: string;
		readonly keyId: string;
		readonly publisher: IPluginPublisherIdentity;
	}

	async function createKeyFixture(): Promise<IKeyFixture> {
		const generated = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
		assert.ok('privateKey' in generated);
		const publicKey = encodeBase64(VSBuffer.wrap(new Uint8Array(await crypto.subtle.exportKey('raw', generated.publicKey))), false, true);
		const keyId = await derivePluginPublisherKeyId(publicKey);
		return {
			privateKey: generated.privateKey,
			publicKey,
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
	}

	function manifest(keyId: string, version = '1.0.0', artifactSha256 = 'a'.repeat(64)): IPluginReleaseManifest {
		return {
			schemaVersion: 1,
			publisherId: 'acme',
			pluginId: 'lint-tools',
			version,
			signingKeyId: keyId,
			createdAt: '2026-01-02T00:00:00.000Z',
			artifact: {
				mediaType: 'application/vnd.openide.plugin+zip',
				size: 42,
				sha256: artifactSha256,
			},
		};
	}

	async function releaseRecord(fixture: IKeyFixture, version: string, digest: string, state: IPluginReleaseRecord['state'] = 'published'): Promise<IPluginReleaseRecord> {
		const release = manifest(fixture.keyId, version, digest);
		return {
			manifest: release,
			signature: await signPluginReleaseManifest(release, fixture.privateKey),
			state,
			stateChangedAt: '2026-01-02T00:01:00.000Z',
		};
	}

	function hasErrorCode(error: unknown, code: PluginSupplyChainError['code']): boolean {
		return error instanceof PluginSupplyChainError && error.code === code;
	}

	test('uses a deterministic canonical payload and SHA-256 artifact digest', async () => {
		const keyId = `sha256:${'b'.repeat(64)}`;
		const release = manifest(keyId, '1.2.3', 'c'.repeat(64));

		assert.deepStrictEqual({
			canonical: canonicalizePluginReleaseManifest(release),
			digest: await computePluginArtifactSha256(new TextEncoder().encode('hello')),
			matches: await verifyPluginArtifactSha256(new TextEncoder().encode('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'),
		}, {
			canonical: `["openide.plugin-release.v1",1,"acme","lint-tools","1.2.3","${keyId}","2026-01-02T00:00:00.000Z","application/vnd.openide.plugin+zip",42,"${'c'.repeat(64)}"]`,
			digest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
			matches: true,
		});
	});

	test('strictly validates and freezes publisher and release documents', async () => {
		const fixture = await createKeyFixture();
		const publisher = parsePluginPublisherIdentity(fixture.publisher);
		const release = parsePluginReleaseManifest(manifest(fixture.keyId));

		assert.deepStrictEqual({
			verifiedPublisherId: (await verifyPluginPublisherIdentity(publisher)).publisherId,
			publisherFrozen: Object.isFrozen(publisher) && Object.isFrozen(publisher.keys) && Object.isFrozen(publisher.keys[0]),
			releaseFrozen: Object.isFrozen(release) && Object.isFrozen(release.artifact),
		}, {
			verifiedPublisherId: 'acme',
			publisherFrozen: true,
			releaseFrozen: true,
		});

		assert.throws(
			() => parsePluginReleaseManifest({ ...release, unexpected: true }),
			error => hasErrorCode(error, 'unknown-field'),
		);
		assert.throws(
			() => parsePluginReleaseManifest({ ...release, version: '1.0.0+mutable-coordinate' }),
			error => hasErrorCode(error, 'invalid-version'),
		);
		await assert.rejects(
			verifyPluginPublisherIdentity({
				...publisher,
				keys: [{ ...publisher.keys[0], keyId: `sha256:${'0'.repeat(64)}` }],
			}),
			error => hasErrorCode(error, 'invalid-key'),
		);
	});

	test('signs and verifies Ed25519 over the canonical immutable payload', async () => {
		const fixture = await createKeyFixture();
		const release = manifest(fixture.keyId);
		const signature = await signPluginReleaseManifest(release, fixture.privateKey);

		await verifyPluginReleaseSignature(release, signature, fixture.publisher);
		await assert.rejects(
			verifyPluginReleaseSignature({ ...release, artifact: { ...release.artifact, sha256: 'd'.repeat(64) } }, signature, fixture.publisher),
			error => hasErrorCode(error, 'bad-signature'),
		);
		await assert.rejects(
			verifyPluginReleaseSignature(release, signature, {
				...fixture.publisher,
				keys: [{
					...fixture.publisher.keys[0],
					state: 'revoked',
					revokedAt: '2026-01-03T00:00:00.000Z',
				}],
			}),
			error => hasErrorCode(error, 'revoked-key'),
		);
	});

	test('makes same-version uploads idempotent but rejects changed immutable content', () => {
		const release = manifest(`sha256:${'b'.repeat(64)}`);

		assert.doesNotThrow(() => assertPluginReleaseVersionIsImmutable(release, { ...release, artifact: { ...release.artifact } }));
		assert.doesNotThrow(() => assertPluginReleaseVersionIsImmutable(release, { ...release, version: '1.0.1', artifact: { ...release.artifact, sha256: 'd'.repeat(64) } }));
		assert.throws(
			() => assertPluginReleaseVersionIsImmutable(release, { ...release, artifact: { ...release.artifact, sha256: 'd'.repeat(64) } }),
			error => hasErrorCode(error, 'version-conflict'),
		);
	});

	test('enforces draft, staged, published, and terminal yanked transitions', async () => {
		const fixture = await createKeyFixture();
		const draft = await releaseRecord(fixture, '1.0.0', 'a'.repeat(64), 'draft');
		const staged = transitionPluginReleaseState(draft, 'staged', '2026-01-02T00:02:00.000Z');
		const published = transitionPluginReleaseState(staged, 'published', '2026-01-02T00:03:00.000Z');
		const yanked = transitionPluginReleaseState(published, 'yanked', '2026-01-02T00:04:00.000Z');

		assert.deepStrictEqual({
			states: [draft.state, staged.state, published.state, yanked.state],
			immutablePayload: canonicalizePluginReleaseManifest(draft.manifest) === canonicalizePluginReleaseManifest(yanked.manifest),
			frozen: Object.isFrozen(yanked),
		}, {
			states: ['draft', 'staged', 'published', 'yanked'],
			immutablePayload: true,
			frozen: true,
		});
		assert.throws(
			() => transitionPluginReleaseState(draft, 'published', '2026-01-02T00:02:00.000Z'),
			error => hasErrorCode(error, 'invalid-transition'),
		);
		assert.throws(
			() => transitionPluginReleaseState(yanked, 'published', '2026-01-02T00:05:00.000Z'),
			error => hasErrorCode(error, 'invalid-transition'),
		);
	});

	test('models rollback as a new promotion of exact previously published bytes', async () => {
		const fixture = await createKeyFixture();
		const v1 = await releaseRecord(fixture, '1.0.0', '1'.repeat(64));
		const v2 = await releaseRecord(fixture, '2.0.0', '2'.repeat(64));
		const first = createPluginReleasePromotion(v1, 'stable', [], 'publish', '2026-01-03T00:00:00.000Z');
		const second = createPluginReleasePromotion(v2, 'stable', [first], 'publish', '2026-01-04T00:00:00.000Z');
		const history = Object.freeze([first, second]);
		const before = JSON.stringify(history);
		const rollback = createPluginReleasePromotion(v1, 'stable', history, 'rollback', '2026-01-05T00:00:00.000Z');

		assert.deepStrictEqual({
			rollback,
			historyUnchanged: JSON.stringify(history) === before,
			validatedLength: validatePluginReleasePromotionHistory([...history, rollback]).length,
		}, {
			rollback: {
				schemaVersion: 1,
				sequence: 3,
				publisherId: 'acme',
				pluginId: 'lint-tools',
				channel: 'stable',
				version: '1.0.0',
				artifactSha256: '1'.repeat(64),
				kind: 'rollback',
				promotedAt: '2026-01-05T00:00:00.000Z',
				previous: { version: '2.0.0', artifactSha256: '2'.repeat(64) },
			},
			historyUnchanged: true,
			validatedLength: 3,
		});

		const neverPromoted = await releaseRecord(fixture, '0.9.0', '9'.repeat(64));
		assert.throws(
			() => createPluginReleasePromotion(neverPromoted, 'stable', history, 'rollback', '2026-01-05T00:00:00.000Z'),
			error => hasErrorCode(error, 'invalid-promotion'),
		);
		const yanked = transitionPluginReleaseState(v1, 'yanked', '2026-01-02T00:02:00.000Z');
		assert.throws(
			() => createPluginReleasePromotion(yanked, 'stable', history, 'rollback', '2026-01-05T00:00:00.000Z'),
			error => hasErrorCode(error, 'invalid-promotion'),
		);
	});

	test('rejects promotion history that mutates an existing version digest', async () => {
		const fixture = await createKeyFixture();
		const v1 = await releaseRecord(fixture, '1.0.0', '1'.repeat(64));
		const v2 = await releaseRecord(fixture, '2.0.0', '2'.repeat(64));
		const first = createPluginReleasePromotion(v1, 'stable', [], 'publish', '2026-01-03T00:00:00.000Z');
		const second = createPluginReleasePromotion(v2, 'stable', [first], 'publish', '2026-01-04T00:00:00.000Z');
		const forgedRollback = {
			...first,
			sequence: 3,
			kind: 'rollback' as const,
			artifactSha256: 'f'.repeat(64),
			promotedAt: '2026-01-05T00:00:00.000Z',
			previous: { version: second.version, artifactSha256: second.artifactSha256 },
		};

		assert.throws(
			() => validatePluginReleasePromotionHistory([first, second, forgedRollback]),
			error => hasErrorCode(error, 'version-conflict'),
		);
	});
});
