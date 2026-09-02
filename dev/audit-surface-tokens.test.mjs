import assert from 'node:assert/strict';
import test from 'node:test';
import { auditScaleSource } from './audit-surface-tokens.mjs';

const css = (...lines) => lines.join('\n') + '\n';

test('accepts a stylesheet written on the --oi-* scale', () => {
	const source = css(
		'.a { border-radius: var(--oi-radius-md); border: 1px solid var(--oi-border); box-shadow: var(--oi-shadow); }',
		'.b { border-radius: 0 0 var(--oi-radius-sm) var(--oi-radius-sm); border-radius: 2px; border-radius: 50%; }',
		'.c { border-radius: var(--vscode-cornerRadius-xSmall, 2px); box-shadow: var(--vscode-shadow-lg, 0 2px 8px rgba(0, 0, 0, 0.36)); }',
		'/* a comment may say border-radius: 8px and rgba(128, 128, 128, 0.3) */',
	);
	assert.deepEqual(auditScaleSource('x.css', source), []);
});

test('flags px radii above 2px, direct cornerRadius tokens, the raw grey and literal shadows', () => {
	const source = css(
		'.a { border-radius: 8px; }',
		'.b { border-top-left-radius: var(--vscode-cornerRadius-small, 4px); }',
		'.c { background: rgba(128,128,128,.12); }',
		'.d { box-shadow: 0 1px 1px rgba(0, 0, 0, 0.12); }',
	);
	const found = auditScaleSource('x.css', source);
	assert.equal(found.length, 4);
	assert.match(found[0], /^x\.css:1: rule C\(a\).*8px/);
	assert.match(found[1], /^x\.css:2: rule C\(a\).*--vscode-cornerRadius/);
	assert.match(found[2], /^x\.css:3: rule C\(b\)/);
	assert.match(found[3], /^x\.css:4: rule C\(c\)/);
});

test('exempts the token block of the declaring file, and only that block', () => {
	const source = css(
		'export const X = `',
		':root, .monaco-workbench {',
		'\t--oi-border: rgba(128, 128, 128, 0.24);',
		'\t--oi-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));',
		'}',
		'.oi-x { background: rgba(128, 128, 128, 0.18); border-radius: 6px; }',
		'`;',
	);
	const found = auditScaleSource('surface.ts', source, { tokenBlock: true });
	assert.equal(found.length, 2);
	assert.match(found[0], /surface\.ts:6: rule C\(a\)/);
	assert.match(found[1], /surface\.ts:6: rule C\(b\)/);
});
