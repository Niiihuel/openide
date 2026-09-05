#!/usr/bin/env node
// Promotion verifies the exact signed bytes and downloaded release artifacts before advertising them.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = ['linux/x64/appimage', 'win32/x64/user', 'win32/arm64/user'];

export async function verifyReleaseFeed(feed, assets, tag, metadata, repository = 'Niiihuel/openide') {
	assert.equal(tag, `v${metadata.version}`, 'Tag does not match the checked-out product');
	assert.equal(metadata.channel, 'stable');
	const key = createPublicKey({ key: Buffer.from(metadata.updater.publicKey, 'base64'), format: 'der', type: 'spki' });
	const expectedFiles = targets.flatMap(target => [`stable/${target}/latest.json`, `stable/${target}/latest.json.minisig`]).sort();
	const files = readdirSync(feed, { recursive: true, withFileTypes: true }).filter(file => file.isFile())
		.map(file => path.relative(feed, path.join(file.parentPath, file.name)).split(path.sep).join('/')).sort();
	assert.deepEqual(files, expectedFiles, 'Incomplete or unexpected update feed');
	const assetNames = readdirSync(assets);
	for (const platform of ['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
		assert(assetNames.some(name => name.includes(platform) && /\.(AppImage|exe|zip|deb|rpm|tar\.gz)$/.test(name)), `Missing ${platform} binary`);
	}
	for (const target of targets) {
		const file = path.join(feed, 'stable', target, 'latest.json');
		const bytes = readFileSync(file);
		const signature = JSON.parse(readFileSync(`${file}.minisig`, 'utf8'));
		assert.equal(signature.keyId, metadata.updater.keyId);
		assert.equal(signature.algorithm, 'ed25519');
		assert(verify(null, bytes, key, Buffer.from(signature.signature, 'base64')), `Invalid signature: ${target}`);
		const manifest = JSON.parse(bytes);
		assert.equal(manifest.schemaVersion, 2);
		assert.equal(manifest.product, 'openide');
		assert.equal(manifest.channel, 'stable');
		assert.equal(manifest.productVersion, metadata.version);
		assert.equal(manifest.codeOssVersion, metadata.codeOss.version);
		assert.equal(manifest.minimumUpdaterVersion, metadata.updater.minimumUpdaterVersion);
		assert.equal(manifest.buildVersion, createHash('sha1').update(`${metadata.version}:${metadata.codeOss.commit}`).digest('hex'));
		assert.equal(`${manifest.platform}/${manifest.architecture}/${manifest.target}`, target);
		const url = new URL(manifest.artifact.url);
		const name = decodeURIComponent(url.pathname.split('/').at(-1));
		assert.equal(path.basename(name), name, 'Invalid artifact name');
		assert.equal(url.href, `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`);
		const artifact = path.join(assets, name);
		assert.equal(statSync(artifact).size, manifest.artifact.size, `Size mismatch: ${name}`);
		const hash = createHash('sha256');
		for await (const chunk of createReadStream(artifact)) { hash.update(chunk); }
		assert.equal(hash.digest('hex'), manifest.artifact.sha256, `Hash mismatch: ${name}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const [feed, assets, tag] = process.argv.slice(2);
	assert(feed && assets && tag, 'Usage: node dev/verify-release-feed.mjs <feed> <assets> <tag>');
	await verifyReleaseFeed(feed, assets, tag, JSON.parse(readFileSync('openide-version.json', 'utf8')), process.env.GH_REPO || process.env.GITHUB_REPOSITORY || 'Niiihuel/openide');
	console.log(`Verified signed feed and release artifacts for ${tag}`);
}
