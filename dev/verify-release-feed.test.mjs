import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyReleaseFeed } from './verify-release-feed.mjs';

function fixture(t) {
	const root = mkdtempSync(path.join(os.tmpdir(), 'openide-release-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const feed = path.join(root, 'feed');
	const assets = path.join(root, 'assets');
	mkdirSync(assets);
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const metadata = { version: '1.2.0', channel: 'stable', codeOss: { version: '1.136.1', commit: 'a'.repeat(40) }, updater: { keyId: 'test', minimumUpdaterVersion: 1, publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') } };
	const files = [];
	for (const target of ['linux/x64/appimage', 'win32/x64/user', 'win32/arm64/user']) {
		const [platform, architecture, kind] = target.split('/');
		const name = `OpenIDE-${platform}-${architecture}-1.2.0.${platform === 'linux' ? 'AppImage' : 'exe'}`;
		const data = Buffer.from(`binary ${target}`);
		writeFileSync(path.join(assets, name), data);
		const file = path.join(feed, 'stable', target, 'latest.json');
		mkdirSync(path.dirname(file), { recursive: true });
		const manifest = { schemaVersion: 2, product: 'openide', channel: 'stable', productVersion: '1.2.0', codeOssVersion: '1.136.1', minimumUpdaterVersion: 1, buildVersion: createHash('sha1').update(`1.2.0:${metadata.codeOss.commit}`).digest('hex'), platform, architecture, target: kind, artifact: { url: `https://github.com/Niiihuel/openide/releases/download/v1.2.0/${name}`, size: data.length, sha256: createHash('sha256').update(data).digest('hex') } };
		files.push(file);
		writeFileSync(file, JSON.stringify(manifest));
	}
	writeFileSync(path.join(assets, 'OpenIDE-linux-arm64-1.2.0.tar.gz'), 'arm');
	const resign = () => {
		for (const file of files) {
			writeFileSync(`${file}.minisig`, JSON.stringify({ algorithm: 'ed25519', keyId: 'test', signature: sign(null, readFileSync(file), privateKey).toString('base64') }));
		}
	};
	resign();
	return { feed, assets, files, metadata, resign, check: (tag = 'v1.2.0') => verifyReleaseFeed(feed, assets, tag, metadata) };
}

test('accepts a complete signed feed matching the downloaded binaries', async t => {
	await fixture(t).check();
});
test('rejects a different tag or trusted signing key', async t => {
	const f = fixture(t);
	await assert.rejects(f.check('v1.1.0'), /Tag/);
	f.metadata.updater.publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
	await assert.rejects(f.check(), /Invalid signature/);
});
test('rejects changed signed bytes and a missing platform', async t => {
	const f = fixture(t);
	writeFileSync(f.files[0], readFileSync(f.files[0], 'utf8') + ' ');
	await assert.rejects(f.check(), /Invalid signature/);
	f.resign();
	rmSync(f.files[1]);
	await assert.rejects(f.check(), /Incomplete/);
});
test('rejects a corrupted release binary', async t => {
	const f = fixture(t);
	writeFileSync(path.join(f.assets, 'OpenIDE-linux-x64-1.2.0.AppImage'), 'binary LINUX/x64/appimage');
	await assert.rejects(f.check(), /Hash mismatch/);
});
test('rejects a signed manifest pointing at another release', async t => {
	const f = fixture(t);
	const manifest = JSON.parse(readFileSync(f.files[0], 'utf8'));
	manifest.artifact.url = manifest.artifact.url.replace('/v1.2.0/', '/v1.1.0/');
	writeFileSync(f.files[0], JSON.stringify(manifest));
	f.resign();
	await assert.rejects(f.check());
});
