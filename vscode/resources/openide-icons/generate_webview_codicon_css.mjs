#!/usr/bin/env node
/** Build the static Codicon compatibility stylesheet used by extension-owned webviews. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export function buildWebviewCodiconCss() {
	const upstream = fs.readFileSync(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.css'), 'utf8');
	const fontFace = `@font-face {
	font-family: "codicon";
	font-display: block;
	src: url("./openide-codicon.ttf") format("truetype");
}`;
	return upstream.replace(/@font-face\s*\{[\s\S]*?\n\}/, fontFace);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const outputPath = path.join(here, 'codicon-webview.css');
	const css = buildWebviewCodiconCss();
	if (process.argv.includes('--check')) {
		if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== css) {
			throw new Error('resources/openide-icons/codicon-webview.css is stale; regenerate it.');
		}
		console.log('OpenIDE webview Codicon CSS is up to date.');
	} else {
		fs.writeFileSync(outputPath, css);
		console.log('Generated resources/openide-icons/codicon-webview.css');
	}
}
