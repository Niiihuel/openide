/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE update manifest tests.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { compareOpenideVersions, IOpenideUpdateManifestContext, parseOpenideUpdateManifest } from '../../common/openideUpdateManifest.js';

suite('OpenIDE update manifest', () => {
	const context: IOpenideUpdateManifestContext = { channel: 'stable', platform: 'linux', architecture: 'x64', target: 'appimage', currentVersion: '1.0.0', minimumUpdaterVersion: 1 };
	const valid = () => ({
		schemaVersion: 2, product: 'openide', channel: 'stable', platform: 'linux', architecture: 'x64', target: 'appimage',
		productVersion: '1.0.1', buildVersion: 'a'.repeat(40), codeOssVersion: '1.121.0', publishedAt: '2026-07-22T00:00:00.000Z', minimumUpdaterVersion: 1,
		artifact: { url: 'https://github.com/Niiihuel/openide/releases/download/v1.0.1/OpenIDE.AppImage', size: 42, sha256: 'b'.repeat(64)  },
	});

	test('parses a valid platform-bound manifest', () => assert.strictEqual(parseOpenideUpdateManifest(valid(), context).productVersion, '1.0.1'));
	test('rejects downgrade and cross target', () => {
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), productVersion: '1.0.0' }, context), /anti-rollback/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), platform: 'win32' }, context), /no coincide/);
	});
	test('rejects untrusted hosts and unknown fields', () => {
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), artifact: { ...valid().artifact, url: 'https://evil.invalid/a' } }, context), /no confiable/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), injected: true }, context), /no está permitido/);
	});
	test('accepts a codeOssVersion on a different line than the product version', () => {
		// OpenIDE versions itself independently of the Code OSS release it is built on: a 1.0.1
		// product shipping the 1.121 extension API is the normal case, not an error.
		assert.strictEqual(parseOpenideUpdateManifest({ ...valid(), codeOssVersion: '1.122.0' }, context).codeOssVersion, '1.122.0');
	});
	test('orders strict semver without unsafe number coercion', () => {
		assert.strictEqual(compareOpenideVersions('1.121.2', '1.121.1'), 1);
		assert.strictEqual(compareOpenideVersions('1.121.2-insider.20260722.2', '1.121.2-insider.20260722.1'), 1);
		assert.strictEqual(compareOpenideVersions('1.121.2', '1.121.2-insider.20260722.2'), 1);
		assert.strictEqual(compareOpenideVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
		assert.strictEqual(compareOpenideVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
		assert.throws(() => compareOpenideVersions('1.0.0-alpha..1', '1.0.0'));
		assert.throws(() => compareOpenideVersions('1.0.0-01', '1.0.0'));
	});
	test('rejects type coercion and channel mismatch', () => {
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), minimumUpdaterVersion: '1' }, context), /number/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), artifact: { ...valid().artifact, size: '42' } }, context), /number/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), publishedAt: '2026-99-99T00:00:00.000Z' }, context), /ISO-8601/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), codeOssVersion: '1.x' }, context), /codeOssVersion/);
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), buildVersion: 'c'.repeat(40) }, { ...context, highestSeenVersion: '1.0.1', highestSeenBuildVersion: 'a'.repeat(40), highestSeenArtifactSha256: 'b'.repeat(64) }), /identidad/);
		const insider = { ...context, channel: 'insider' as const, currentVersion: '1.0.0-insider.20260721.1' };
		assert.throws(() => parseOpenideUpdateManifest({ ...valid(), channel: 'insider', productVersion: '1.0.1' }, insider), /política/);
	});
});
