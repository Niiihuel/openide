// esbuild preserves Unicode regex literals; the production bundler rejects code points > U+00FF.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('vscode/package.json'));
const ts = require('typescript');
let failures = 0;
function visitDirectory(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'test') { visitDirectory(file); }
			continue;
		}
		if (!/\.tsx?$/.test(file) || /\.d\.ts$/.test(file)) { continue; }
		const source = fs.readFileSync(file, 'utf8');
		if (!/[^\x00-\xFF]/.test(source)) { continue; }
		const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		function visit(node) {
			if (ts.isRegularExpressionLiteral(node) && /[^\x00-\xFF]/.test(node.text)) {
				console.error(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: use Unicode escapes in regex literals for production minification`);
				failures++;
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
}
visitDirectory('vscode/src');
if (failures) { process.exitCode = 1; }
else { console.log('Production regular expressions: OK'); }
