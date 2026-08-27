/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE update signature tests.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { generateKeyPairSync, sign } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyOpenideArtifact, verifyOpenideManifestSignature } from '../../node/openideUpdateVerifier.js';

suite('OpenIDE update verifier', () => {
	test('verifies exact Ed25519 bytes and key id', () => {
		const keys = generateKeyPairSync('ed25519');
		const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
		const bytes = Buffer.from('{"schemaVersion":2}\n');
		const detached = JSON.stringify({ keyId: 'test-key', algorithm: 'ed25519', signature: sign(null, bytes, keys.privateKey).toString('base64') });
		verifyOpenideManifestSignature(bytes, detached, 'test-key', publicKey);
		assert.throws(() => verifyOpenideManifestSignature(Buffer.from('{}'), detached, 'test-key', publicKey), /no es válida/);
		assert.throws(() => verifyOpenideManifestSignature(bytes, detached, 'other-key', publicKey), /no confiable/);
	});

	test('verifies artifact size and sha256', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'openide-update-'));
		try {
			const file = join(dir, 'artifact'); await writeFile(file, 'openide');
			await verifyOpenideArtifact(file, 7, '56af8173aabc34142e964a57dc4244cbfdd6b32af2dfddfa07e5711c06219705');
			await assert.rejects(() => verifyOpenideArtifact(file, 8, '56af8173aabc34142e964a57dc4244cbfdd6b32af2dfddfa07e5711c06219705'), /tamaño/);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
});
