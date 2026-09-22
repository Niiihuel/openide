/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { URI } from '../../../../../../base/common/uri.js';
import { FileService } from '../../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { computePluginTreeDigest, PLUGIN_INSTALL_RECEIPT_FILENAME, readPluginInstallReceipt, runPluginInstallTransaction, verifyPluginInstall } from '../../../common/plugins/pluginInstallTransaction.js';

suite('PluginInstallTransaction', () => {
	const store = new DisposableStore();
	let fileService: FileService;

	setup(() => {
		fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.inMemory, store.add(new InMemoryFileSystemProvider())));
	});

	teardown(() => store.clear());

	function uri(path: string): URI {
		return URI.from({ scheme: Schemas.inMemory, path });
	}

	async function write(path: string, contents: string): Promise<void> {
		await fileService.writeFile(uri(path), VSBuffer.fromString(contents));
	}

	async function read(path: string): Promise<string> {
		return (await fileService.readFile(uri(path))).value.toString();
	}

	test('computes a deterministic digest independent of creation order and install metadata', async () => {
		await write('/first/z.txt', 'last');
		await write('/first/nested/a.txt', 'first');
		await write('/first/.git/HEAD', 'ref: refs/heads/one');
		await write(`/first/${PLUGIN_INSTALL_RECEIPT_FILENAME}`, '{"ignored":true}');

		await write('/second/nested/a.txt', 'first');
		await write('/second/z.txt', 'last');
		await write('/second/.git/HEAD', 'ref: refs/heads/two');

		const [first, second] = await Promise.all([
			computePluginTreeDigest(fileService, uri('/first')),
			computePluginTreeDigest(fileService, uri('/second')),
		]);

		assert.deepStrictEqual({ first, second, valid: /^sha256:[a-f0-9]{64}$/.test(first) }, {
			first,
			second: first,
			valid: true,
		});
	});

	test('verifies and atomically promotes a staged tree with a receipt', async () => {
		await write('/candidate/plugin.json', '{"name":"example"}');
		await write('/candidate/skills/example/SKILL.md', '# New');
		const expectedDigest = await computePluginTreeDigest(fileService, uri('/candidate'));
		await write('/installed/example/skills/example/SKILL.md', '# Old');

		const result = await runPluginInstallTransaction(fileService, {
			target: uri('/installed/example'),
			expectedDigest,
			provenance: { sourceKind: 'github', source: 'owner/example', revision: 'abc123' },
			prepare: async staging => { await fileService.copy(uri('/candidate'), staging); },
		});

		const receipt = await readPluginInstallReceipt(fileService, uri('/installed/example'));
		assert.deepStrictEqual({
			digest: result.digest,
			changed: result.changed,
			contents: await read('/installed/example/skills/example/SKILL.md'),
			receiptDigest: receipt?.treeDigest,
			verified: (await verifyPluginInstall(fileService, uri('/installed/example'), expectedDigest))?.treeDigest,
		}, {
			digest: expectedDigest,
			changed: true,
			contents: '# New',
			receiptDigest: expectedDigest,
			verified: expectedDigest,
		});
	});

	test('rejects a digest mismatch before mutating the previous install', async () => {
		await write('/installed/example/plugin.json', '{"name":"old"}');
		await write('/candidate/plugin.json', '{"name":"new"}');

		await assert.rejects(runPluginInstallTransaction(fileService, {
			target: uri('/installed/example'),
			expectedDigest: 'sha256:' + '0'.repeat(64),
			provenance: { sourceKind: 'url', source: 'https://example.test/plugin.git' },
			prepare: async staging => { await fileService.copy(uri('/candidate'), staging); },
		}), /digest mismatch/);

		assert.deepStrictEqual({
			contents: await read('/installed/example/plugin.json'),
			receipt: await readPluginInstallReceipt(fileService, uri('/installed/example')),
		}, {
			contents: '{"name":"old"}',
			receipt: undefined,
		});
	});

	test('restores the previous install when promotion fails after backup', async () => {
		await write('/installed/example/plugin.json', '{"name":"old"}');
		await write('/candidate/plugin.json', '{"name":"new"}');
		let injected = false;
		const failingFileService = {
			createFolder: (resource: URI) => fileService.createFolder(resource),
			resolve: (resource: URI) => fileService.resolve(resource),
			readFile: (resource: URI) => fileService.readFile(resource),
			writeFile: (resource: URI, contents: VSBuffer) => fileService.writeFile(resource, contents),
			exists: (resource: URI) => fileService.exists(resource),
			del: (resource: URI, options: { recursive?: boolean; useTrash?: boolean }) => fileService.del(resource, options),
			copy: (source: URI, target: URI, overwrite?: boolean) => fileService.copy(source, target, overwrite),
			move: async (source: URI, target: URI, overwrite?: boolean) => {
				if (!injected && source.path.includes('.plugin-staging-')) {
					injected = true;
					throw new Error('injected promotion failure');
				}
				return fileService.move(source, target, overwrite);
			},
		} as IFileService;

		await assert.rejects(runPluginInstallTransaction(failingFileService, {
			target: uri('/installed/example'),
			provenance: { sourceKind: 'github', source: 'owner/example' },
			prepare: async staging => { await failingFileService.copy(uri('/candidate'), staging); },
		}), /injected promotion failure/);

		assert.deepStrictEqual({ injected, contents: await read('/installed/example/plugin.json') }, {
			injected: true,
			contents: '{"name":"old"}',
		});
	});

	test('verification detects post-install tampering', async () => {
		await write('/candidate/plugin.json', '{"name":"example"}');
		await runPluginInstallTransaction(fileService, {
			target: uri('/installed/example'),
			provenance: { sourceKind: 'npm', source: '@example/plugin' },
			prepare: async staging => { await fileService.copy(uri('/candidate'), staging); },
		});
		await write('/installed/example/plugin.json', '{"name":"tampered"}');

		assert.strictEqual(await verifyPluginInstall(fileService, uri('/installed/example')), undefined);
	});
});
