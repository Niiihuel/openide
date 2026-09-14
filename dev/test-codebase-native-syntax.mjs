// Copyright (c) OpenIDE. Licensed under the MIT License.
// Opt-in syntax mode through the production bridge and full/incremental indexer.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NativeCodebase } from '../vscode/out/vs/platform/openideCodebase/node/openideNativeCodebase.js';
import { CancellationToken } from '../vscode/out/vs/base/common/cancellation.js';
import { FileService } from '../vscode/out/vs/platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../vscode/out/vs/platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../vscode/out/vs/platform/log/common/log.js';
import { CodebaseMemoryIndexer } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryIndexer.js';
import { CodebaseMemoryStorage } from '../vscode/out/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryStorage.js';
import { DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS } from '../vscode/out/vs/platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { VSBuffer } from '../vscode/out/vs/base/common/buffer.js';
import { URI } from '../vscode/out/vs/base/common/uri.js';
globalThis._VSCODE_FILE_ROOT = fileURLToPath(new URL('../vscode/out/', import.meta.url));
const executable = fileURLToPath(new URL(`../vscode/native/bin/openide-codebase${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const native = new NativeCodebase(executable);
const normalize = extraction => JSON.parse(JSON.stringify(extraction, (key, value) => key === 'indexedAt' ? 0 : value));
const fixture = (content, uri = 'file:///syntax/fixture.ts', language = 'typescript') => ({ content, uri, language, workspaceKey: 'file:///syntax' });
const names = result => result.extraction.nodes.map(node => node.name);
try {
 const source = fixture('// class Ghost {}\nexport class Real { method() {} }\nimport "./side-effect";');
 const [legacy] = await native.extract([source], true, CancellationToken.None);
 assert.ok(names(legacy).includes('Ghost'));
 const [syntax] = await native.extract([{ ...source, knownHash: legacy.hash, knownExtractionMode: legacy.extractionMode }], true, CancellationToken.None, true);
 assert.ok(syntax.extraction, 'enabling syntax cannot accept a regex-mode known hash');
 assert.equal(syntax.hash, legacy.hash, 'parser choice must not change a content hash');
 assert.equal(syntax.extractionMode, 'treeSitter');
 assert.ok(!names(syntax).includes('Ghost'));
 assert.ok(names(syntax).includes('method'));
 assert.ok(syntax.extraction.edges.some(edge => edge.type === 'IMPORTS'));
 assert.equal(syntax.extraction.nodes.find(node => node.name === 'Real').evidence.provider, 'treeSitter');
 const [unchanged] = await native.extract([{ ...source, knownHash: syntax.hash, knownExtractionMode: syntax.extractionMode }], true, CancellationToken.None, true);
 assert.equal(unchanged.unchanged, true);
 const [disabled] = await native.extract([{ ...source, knownHash: syntax.hash, knownExtractionMode: syntax.extractionMode }], true, CancellationToken.None, false);
 assert.ok(disabled.extraction, 'disabling syntax cannot accept a syntax-mode known hash');
 assert.ok(names(disabled).includes('Ghost'));
 // Unsupported languages retain the configured fallback; syntax works even with regex off.
 const [unsupported] = await native.extract([fixture('class Java {}', 'file:///syntax/Java.java', 'java')], true, CancellationToken.None, true);
 assert.equal(unsupported.extraction.nodes.find(node => node.name === 'Java').evidence.provider, 'regex');
 const [withoutRegex] = await native.extract([source], false, CancellationToken.None, true);
 assert.equal(withoutRegex.extraction.nodes.find(node => node.name === 'Real').evidence.provider, 'treeSitter');
 const beforeParses = await native.call('syntaxMetrics', {});
 const paths = [
  'vscode/src/vs/platform/openideCodebase/common/openideCodebaseMemoryProviders.ts',
  'vscode/src/vs/workbench/contrib/openideAgent/browser/openideCodebaseQueryService.ts',
  'vscode/src/vs/code/electron-utility/sharedProcess/contrib/openideCodebaseMemoryIndexer.ts',
 ];
 for (const relative of paths) {
  const content = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
  const uri = `file:///syntax/${relative}`;
  for (const version of [content, `${content}\nexport const __syntaxProbe = "é😀";\n`, `${content}\nexport const __syntaxProbe = "ê😁";\n`]) {
   const file = fixture(version, uri);
   const [incremental] = await native.extract([file], true, CancellationToken.None, true);
   const fresh = new NativeCodebase(executable);
   try {
    const [reparsed] = await fresh.extract([file], true, CancellationToken.None, true);
    assert.deepEqual(normalize(incremental.extraction), normalize(reparsed.extraction), relative);
   } finally { fresh.dispose(); }
  }
 }
 const afterParses = await native.call('syntaxMetrics', {});
 assert.ok(afterParses.incrementalParses >= beforeParses.incrementalParses + paths.length * 2, 'real-file edits must reuse edited syntax trees');
 assert.equal(native.getMetrics().fallbackBatches, 0);
} finally { native.dispose(); }

const files = new FileService(new NullLogService());
const provider = new InMemoryFileSystemProvider();
const registration = files.registerProvider('file', provider);
const folder = URI.file('/syntax-index');
const storage = new CodebaseMemoryStorage(files, URI.file('/syntax-storage'));
const indexer = new CodebaseMemoryIndexer(files, [folder], storage);
try {
 await files.createFolder(folder); await storage.setPersist(false);
 const uri = URI.joinPath(folder, 'entry.ts');
 const content = '// class Ghost {}\nexport const real = 1;';
 await files.writeFile(uri, VSBuffer.fromString(content));
 indexer.setOptions({ ...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, enableTreeSitter: false });
 assert.equal((await indexer.rebuildFull()).phase, 'idle');
 assert.ok((await storage.readFile(uri.toString())).nodes.some(node => node.name === 'Ghost'));
 indexer.setOptions({ ...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, enableTreeSitter: true });
 await indexer.indexIncremental([{ uri, content }], CancellationToken.None);
 const syntax = (await storage.readFile(uri.toString())).nodes;
 assert.ok(!syntax.some(node => node.name === 'Ghost'), 'setting change invalidates content-only known hash');
 const symbol = syntax.find(node => node.name === 'real');
 assert.equal(symbol.evidence.provider, 'treeSitter');
 indexer.setExternalExtraction(uri.toString(), { nodes: [{ ...symbol, evidence: { ...symbol.evidence, provider: 'documentSymbols', confidence: 0.9, verified: true }, signature: 'language server wins' }], edges: [] });
 await indexer.indexIncremental([{ uri, content: '// class Ghost {}\nexport const real = 2;' }], CancellationToken.None);
 assert.equal((await storage.readFile(uri.toString())).nodes.find(node => node.name === 'real').signature, 'language server wins');
 indexer.clearExternalExtractions();
 indexer.setOptions({ ...DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, enableTreeSitter: false });
 await indexer.indexIncremental([{ uri, content }], CancellationToken.None);
 assert.ok((await storage.readFile(uri.toString())).nodes.some(node => node.name === 'Ghost'));
 assert.equal(indexer.getMetrics().fallbackBatches, 0);
 console.log('PASS: opt-in syntax, mode-aware hashes, regex-disabled and unsupported fallback, real-file Unicode incremental/fresh parity, full/incremental indexer and language-server precedence.');
} finally { indexer.dispose(); storage.dispose(); registration.dispose(); provider.dispose(); files.dispose(); }
