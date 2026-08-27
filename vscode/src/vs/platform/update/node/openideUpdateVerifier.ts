/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE signed update verifier. Detached signatures use Ed25519 over exact manifest bytes.
 *--------------------------------------------------------------------------------------------*/

import { createHash, createPublicKey, verify } from 'crypto';
import { open } from 'fs/promises';

export interface IOpenideDetachedSignature {
	readonly keyId: string;
	readonly algorithm: 'ed25519';
	readonly signature: string;
}

export class OpenideUpdateVerificationError extends Error {
	constructor(readonly code: string, message: string) { super(message); this.name = 'OpenideUpdateVerificationError'; }
}

export function parseOpenideDetachedSignature(raw: string): IOpenideDetachedSignature {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { throw new OpenideUpdateVerificationError('invalid-signature', 'La firma no es JSON válido.'); }
	if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new OpenideUpdateVerificationError('invalid-signature', 'Formato de firma inválido.'); }
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some(key => !['keyId', 'algorithm', 'signature'].includes(key)) || typeof record.keyId !== 'string' || record.algorithm !== 'ed25519' || typeof record.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.signature)) { throw new OpenideUpdateVerificationError('invalid-signature', 'Campos de firma inválidos.'); }
	return { keyId: record.keyId, algorithm: 'ed25519', signature: record.signature };
}

function publicKeyFromBase64(base64: string) {
	let der: Buffer;
	try { der = Buffer.from(base64, 'base64'); } catch { throw new OpenideUpdateVerificationError('invalid-key', 'Clave pública inválida.'); }
	if (der.length !== 44) { throw new OpenideUpdateVerificationError('invalid-key', 'La clave pública Ed25519 debe ser SPKI DER.'); }
	try {
		const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
		if (key.asymmetricKeyType !== 'ed25519') { throw new Error('wrong key type'); }
		return key;
	} catch { throw new OpenideUpdateVerificationError('invalid-key', 'No se pudo cargar la clave pública Ed25519.'); }
}

export function verifyOpenideManifestSignature(manifestBytes: Uint8Array, signatureText: string, expectedKeyId: string, publicKeyBase64: string): void {
	const detached = parseOpenideDetachedSignature(signatureText);
	if (detached.keyId !== expectedKeyId) { throw new OpenideUpdateVerificationError('wrong-key', 'La firma usa una clave no confiable.'); }
	const signature = Buffer.from(detached.signature, 'base64');
	if (signature.length !== 64 || !verify(null, manifestBytes, publicKeyFromBase64(publicKeyBase64), signature)) { throw new OpenideUpdateVerificationError('bad-signature', 'La firma del manifest no es válida.'); }
}

export async function verifyOpenideArtifact(path: string, expectedSize: number, expectedSha256: string): Promise<void> {
	const file = await open(path, 'r');
	try {
		const info = await file.stat();
		if (info.size !== expectedSize) { throw new OpenideUpdateVerificationError('size-mismatch', 'El artefacto descargado tiene un tamaño inesperado.'); }
		const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let position = 0;
		while (position < info.size) { const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, info.size - position), position); if (!bytesRead) { break; } hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
		if (position !== info.size || hash.digest('hex') !== expectedSha256.toLowerCase()) { throw new OpenideUpdateVerificationError('hash-mismatch', 'El SHA-256 del artefacto no coincide.'); }
	} finally { await file.close(); }
}
