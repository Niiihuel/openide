#!/usr/bin/env node
/**
 * Extract the Reicon drawings that have a semantic Codicon equivalent. The generated subset is
 * intentionally small and deterministic; OpenIDE keeps its own codepoints and runtime has no
 * dependency on Reicon.
 *
 * Usage: node import_reicon_reference.mjs /path/to/reicon/data/icon-data.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sourcePath = path.resolve(process.argv[2] || '');
if (!sourcePath || !fs.existsSync(sourcePath)) {
	throw new Error('Pass the path to Reicon data/icon-data.json.');
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const codicons = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@vscode/codicons/src/template/mapping.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(here, 'openide-icon-policy.json'), 'utf8'));
const reicons = new Map();
for (const [category, value] of Object.entries(source.categories || {})) {
	for (const [name, icon] of Object.entries(value.icons || {})) {
		reicons.set(name, { category, ...icon });
	}
}

// Codicon names are API identifiers. These aliases translate editor-specific vocabulary into
// the closest Reicon concept; they do not change the public id used by extensions.
const aliases = {
	'add-small': 'plus',
	'browser': 'browser-code',
	'chrome-close': 'x',
	'chrome-maximize': 'square',
	'chrome-minimize': 'minus',
	'chrome-restore': 'copy',
	'clear-all': 'trash',
	'close-all': 'x-circle',
	'collapse-all': 'arrows-in',
	'comment-discussion': 'chat-dots',
	'console': 'browser-terminal',
	'debug-console': 'browser-terminal',
	'editor-layout': 'layout',
	'empty-window': 'window2',
	'files': 'files-2',
	'folder-opened': 'folder-open',
	'gear-compact': 'settings',
	'go-to-file': 'file-search',
	'go-to-search': 'search',
	'kebab-horizontal': 'dots-horizontal',
	'kebab-vertical': 'dots-vertical',
	'layout-activitybar-left': 'sidebar-left2',
	'layout-activitybar-right': 'sidebar-right2',
	'layout-centered': 'layout',
	'layout-menubar': 'sidebar-top2',
	'layout-panel': 'sidebar-bottom2',
	'layout-panel-center': 'sidebar-bottom2',
	'layout-panel-dock': 'sidebar-bottom2',
	'layout-panel-justify': 'sidebar-bottom2',
	'layout-panel-left': 'sidebar-left2',
	'layout-panel-off': 'sidebar-bottom2',
	'layout-panel-right': 'sidebar-right2',
	'layout-sidebar-left': 'sidebar-left2',
	'layout-sidebar-left-dock': 'sidebar-left2',
	'layout-sidebar-left-off': 'sidebar-left2',
	'layout-sidebar-right': 'sidebar-right2',
	'layout-sidebar-right-dock': 'sidebar-right2',
	'layout-sidebar-right-off': 'sidebar-right2',
	'layout-statusbar': 'sidebar-bottom2',
	'list-flat': 'list',
	'list-selection': 'list-check',
	'menu': 'menu2',
	'multiple-windows': 'window2',
	'new-file': 'file-plus',
	'new-folder': 'folder-plus',
	'open-in-window': 'window-pointer',
	'output': 'browser-terminal',
	'panel-close': 'x',
	'panel-maximize': 'square',
	'panel-restore': 'copy',
	'preview': 'eye',
	'remove-close': 'x',
	'repl': 'browser-terminal',
	'search-large': 'search',
	'settings-gear': 'settings',
	'sidebar-right': 'sidebar-right2',
	'split-horizontal': 'arrows-left-right',
	'split-vertical': 'arrows-up-down',
	'terminal': 'browser-terminal',
	'terminal-bash': 'browser-terminal',
	'terminal-cmd': 'browser-terminal',
	'terminal-debian': 'browser-terminal',
	'terminal-git-bash': 'browser-terminal',
	'terminal-linux': 'browser-terminal',
	'terminal-powershell': 'browser-terminal',
	'terminal-secure': 'browser-terminal',
	'terminal-tmux': 'browser-terminal',
	'terminal-ubuntu': 'browser-terminal',
	'three-bars': 'menu2',
	'window-active': 'window-pointer',
	'window-compact': 'window2',
};

const removableSuffixes = /-(?:compact|large|outline|small)$/;
const semanticSuffixes = new Set(policy.semanticSuffixes);
function hasSuffix(name, suffix) {
	return name.endsWith('-' + suffix);
}
function preserveCodicon(name) {
	return policy.preserveCodiconNames.includes(name)
		|| policy.preserveCodiconPrefixes.some(prefix => name.startsWith(prefix));
}
function candidates(name) {
	const out = [aliases[name], name];
	if (semanticSuffixes.size && [...semanticSuffixes].some(suffix => hasSuffix(name, suffix))) {
		return out.filter(Boolean);
	}
	if (hasSuffix(name, policy.filledSuffix)) {
		const base = name.slice(0, -(policy.filledSuffix.length + 1));
		out.push(aliases[base], base);
	}
	let base = name;
	while (removableSuffixes.test(base)) {
		base = base.replace(removableSuffixes, '');
		out.push(aliases[base], base);
	}
	return out.filter(Boolean);
}

const glyphs = {};
for (const [codepoint, names] of Object.entries(codicons)) {
	if (names.some(preserveCodicon)) {
		continue;
	}
	let selected;
	for (const name of names) {
		selected = candidates(name).find(candidate => reicons.has(candidate));
		if (selected) {
			break;
		}
	}
	if (!selected) {
		continue;
	}
	const icon = reicons.get(selected);
	const explicitlyFilled = names.some(name => hasSuffix(name, policy.filledSuffix));
	const outline = explicitlyFilled
		? (icon.weights?.Filled?.code || icon.weights?.Outline?.code || '')
		: (icon.weights?.Outline?.code || '');
	glyphs[codepoint] = {
		name: selected,
		category: icon.category,
		outline,
		filled: icon.weights?.Filled?.code || icon.weights?.Outline?.code || '',
	};
}

const output = {
	source: 'Reicon (https://reicon.dev, https://github.com/dqev/reicon)',
	license: 'MIT — Copyright (c) 2025 REICON; see REICON-LICENSE.txt',
	version: source.version,
	glyphs,
};
fs.writeFileSync(path.join(here, 'reicon-reference.json'), `${JSON.stringify(output)}\n`);
console.log(`Extracted ${Object.keys(glyphs).length}/${Object.keys(codicons).length} semantic Reicon pairs.`);
