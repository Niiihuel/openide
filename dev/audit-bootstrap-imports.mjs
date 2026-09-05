// Bootstrap imports resolve before Electron installs the node_modules.asar hooks.
import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(path.join(root, 'vscode/package.json'))('typescript');
const output = path.resolve(process.argv[2] || path.join(root, 'vscode/out-vscode-min'));
let failures = 0;
for (const name of ['main.js', 'cli.js', 'bootstrap-fork.js']) {
	const file = path.join(output, name);
	const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) { continue; }
		const specifier = statement.moduleSpecifier;
		if (!specifier || !ts.isStringLiteral(specifier)) { continue; }
		if (isBuiltin(specifier.text) || ['electron', 'original-fs'].includes(specifier.text)) { continue; }
		console.error(`${file}: static import '${specifier.text}' requires resolution before ASAR support is installed`);
		failures++;
	}
}
if (failures) { process.exitCode = 1; }
else { console.log('Packaged bootstrap imports: OK'); }
