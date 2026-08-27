#!/usr/bin/env node
/**
 * The Ed25519 key that signs OpenIDE's update manifests.
 *
 * `openide-version.json` pins the PUBLIC half, and every shipped client carries it. A manifest is
 * only installed when its signature verifies against that exact key, which means the pinned public
 * key and the private key held in the `OPENIDE_UPDATE_PRIVATE_KEY` secret are one pair: replace one
 * without the other and every update is rejected as forged. That failure is silent from CI's side —
 * releases publish fine, and only an already-installed IDE ever notices.
 *
 * So this tool exists to make the pair verifiable instead of assumed.
 *
 *   node dev/update-signing-key.mjs new <path>     generate a key, print only its PUBLIC half
 *   node dev/update-signing-key.mjs public <path>  print the public half of an existing key
 *   node dev/update-signing-key.mjs check <path>   does this key match the pinned public key?
 *
 * The private key is NEVER printed: it is written to <path> with owner-only permissions, and the
 * only thing that reaches the terminal is the public half. A terminal is scrollback, a screen
 * share and a shell history at once.
 */
import { generateKeyPairSync, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION_FILE = 'openide-version.json';

/** The exact shape the client parses: base64 of the 44-byte SPKI DER. */
function publicKeyBase64(privateKeyPem) {
	const spki = createPublicKey(privateKeyPem).export({ format: 'der', type: 'spki' });
	return spki.toString('base64');
}

function readPrivateKey(file) {
	if (!file) { fail('Missing <path> to the private key.'); }
	if (!fs.existsSync(file)) { fail(`No such file: ${file}`); }
	const pem = fs.readFileSync(file, 'utf8');
	// The easy mistake, and the one worth naming: pasting the PUBLIC key. Both are PEM, both look
	// like a key, and the public one is the half that gets shown around — it is in
	// `openide-version.json` and in every explanation of how this works. Without this check the
	// failure is an OpenSSL stack trace that names nothing.
	if (/BEGIN PUBLIC KEY/.test(pem)) {
		fail('That is a PUBLIC key. The secret needs the PRIVATE half — the file whose header says BEGIN PRIVATE KEY.');
	}
	if (!/BEGIN (PRIVATE|ED25519 PRIVATE) KEY/.test(pem)) {
		fail('This does not look like a PEM private key. It should start with "-----BEGIN PRIVATE KEY-----".');
	}
	return pem;
}

function pinnedPublicKey() {
	const config = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
	return { keyId: config.updater.keyId, publicKey: config.updater.publicKey };
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

const [command, target] = process.argv.slice(2);

if (command === 'new') {
	if (!target) { fail('Usage: node dev/update-signing-key.mjs new <path>'); }
	if (fs.existsSync(target)) { fail(`${target} already exists. Refusing to overwrite a signing key.`); }
	// Inside the repository a stray key is one `git add -A` away from being published forever.
	const inRepo = !path.relative(process.cwd(), path.resolve(target)).startsWith('..');
	if (inRepo) {
		console.error(`Warning: ${target} is inside the repository. Keep signing keys outside it.`);
	}
	const { privateKey } = generateKeyPairSync('ed25519');
	const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
	fs.writeFileSync(target, pem, { mode: 0o600 });
	console.log(`Private key written to ${target} (mode 600). It was NOT printed — open the file to copy it.`);
	console.log('');
	console.log('Put this in openide-version.json under updater.publicKey:');
	console.log('');
	console.log(`  ${publicKeyBase64(pem)}`);
	console.log('');
	console.log('Then paste the FILE CONTENTS into the OPENIDE_UPDATE_PRIVATE_KEY repository secret.');
	process.exit(0);
}

if (command === 'public') {
	console.log(publicKeyBase64(readPrivateKey(target)));
	process.exit(0);
}

if (command === 'check') {
	const pem = readPrivateKey(target);
	const derived = publicKeyBase64(pem);
	const pinned = pinnedPublicKey();
	// A real sign/verify round trip, not just a string compare: it also proves the key is usable
	// for the algorithm the client verifies with, which a matching string alone would not.
	const probe = Buffer.from('openide-update-key-selftest');
	let usable = false;
	try {
		usable = verify(null, probe, createPublicKey(pem), sign(null, probe, pem));
	} catch (error) {
		fail(`This key cannot sign: ${error instanceof Error ? error.message : String(error)}`);
	}
	console.log(`keyId in ${VERSION_FILE}: ${pinned.keyId}`);
	console.log(`pinned public key:  ${pinned.publicKey}`);
	console.log(`this key's public:  ${derived}`);
	console.log('');
	if (!usable) { fail('This key cannot sign and verify Ed25519. It is not a usable Ed25519 private key.'); }
	if (derived === pinned.publicKey) {
		console.log('MATCH — this is the key the shipped clients trust. Paste it as OPENIDE_UPDATE_PRIVATE_KEY.');
		process.exit(0);
	}
	console.log('MISMATCH — clients pinned to the key above would reject anything signed with this one.');
	console.log(`Either use the key that matches, or set updater.publicKey in ${VERSION_FILE} to this key's public half`);
	console.log('and ship that change before publishing a release signed with it.');
	process.exit(1);
}

fail('Usage: node dev/update-signing-key.mjs <new|public|check> <path>');
