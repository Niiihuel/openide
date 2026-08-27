import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildWebviewCodiconCss } from './generate_webview_codicon_css.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const opentype = require(path.join(root, 'node_modules/opentype.js'));
const mapping = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@vscode/codicons/src/template/mapping.json'), 'utf8'));
const upstreamCss = fs.readFileSync(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.css'), 'utf8');
const base = opentype.loadSync(path.join(root, 'node_modules/@vscode/codicons/dist/codicon.ttf'));
const regular = opentype.loadSync(path.join(root, 'resources/openide-icons/openide-codicon.ttf'));
const filled = opentype.loadSync(path.join(root, 'resources/openide-icons/openide-codicon-filled.ttf'));
const reference = JSON.parse(fs.readFileSync(path.join(root, 'resources/openide-icons/reicon-reference.json'), 'utf8'));
const overrides = JSON.parse(fs.readFileSync(path.join(root, 'resources/openide-icons/openide-icon-overrides.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(root, 'resources/openide-icons/openide-icon-policy.json'), 'utf8'));
const brandPrefixes = [
	'anthropic', 'apple', 'azure', 'claude', 'code-oss', 'copilot', 'docker', 'gemini',
	'github', 'gitlab', 'google', 'meta', 'microsoft', 'mistral', 'openai', 'twitter', 'xai',
];

const codepointById = new Map();
for (const [rawCodepoint, aliases] of Object.entries(mapping)) {
	for (const alias of aliases) {
		codepointById.set(alias, Number(rawCodepoint));
	}
}
const publicCssCodepoints = new Map();
for (const match of upstreamCss.matchAll(/\.codicon-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g)) {
	publicCssCodepoints.set(match[1], Number.parseInt(match[2], 16));
}
for (const [id, codepoint] of publicCssCodepoints) {
	const character = String.fromCodePoint(codepoint);
	for (const [label, font] of [['regular', regular], ['filled', filled]]) {
		assert.notEqual(font.charToGlyphIndex(character), 0, `${label} is missing CSS Codicon ${id}`);
		if (id !== 'blank') {
			assert.ok(font.charToGlyph(character).path.commands.length, `${label} rendered CSS Codicon ${id} as blank`);
		}
	}
}

function glyphPath(font, codepoint) {
	return JSON.stringify(font.charToGlyph(String.fromCodePoint(codepoint)).path.commands);
}

function assertDistinct(firstId, secondId, reason) {
	const firstCodepoint = codepointById.get(firstId);
	const secondCodepoint = codepointById.get(secondId);
	assert.notEqual(firstCodepoint, undefined, `unknown Codicon ${firstId}`);
	assert.notEqual(secondCodepoint, undefined, `unknown Codicon ${secondId}`);
	assert.notEqual(glyphPath(regular, firstCodepoint), glyphPath(regular, secondCodepoint), reason);
}

for (const [rawCodepoint, aliases] of Object.entries(mapping)) {
	const codepoint = Number(rawCodepoint);
	const character = String.fromCodePoint(codepoint);
	const canonical = aliases[0];
	for (const [label, font] of [['regular', regular], ['filled', filled]]) {
		assert.notEqual(font.charToGlyphIndex(character), 0, `${label} is missing ${canonical} (${rawCodepoint})`);
		if (canonical !== 'blank') {
			assert.ok(font.charToGlyph(character).path.commands.length, `${label} rendered ${canonical} as blank`);
		}
	}

	if (aliases.some(alias => brandPrefixes.some(prefix => alias === prefix || alias.startsWith(`${prefix}-`)))) {
		const expected = glyphPath(base, codepoint);
		assert.equal(glyphPath(regular, codepoint), expected, `regular modified brand ${canonical}`);
		assert.equal(glyphPath(filled, codepoint), expected, `filled modified brand ${canonical}`);
	}
}

// Public filled IDs must remain visually distinct from their outline counterpart even though the
// companion font is selected separately for OpenIDE's own active controls.
for (const [rawCodepoint, aliases] of Object.entries(mapping)) {
	const canonical = aliases[0];
	const suffix = `-${policy.filledSuffix}`;
	if (!canonical.endsWith(suffix) || !reference.glyphs[rawCodepoint]) {
		continue;
	}
	const baseId = canonical.slice(0, -suffix.length);
	if (codepointById.has(baseId)) {
		assertDistinct(canonical, baseId, `${canonical} collapsed onto ${baseId}`);
	}
}

// Status modifiers may only use a Reicon drawing when that drawing retains the same modifier.
// Otherwise the generator preserves the normalized Codicon geometry.
for (const [rawCodepoint, aliases] of Object.entries(mapping)) {
	const canonical = aliases[0];
	const sourceName = reference.glyphs[rawCodepoint]?.name || '';
	for (const suffixName of policy.semanticSuffixes) {
		const suffix = `-${suffixName}`;
		if (canonical.endsWith(suffix) && !sourceName.endsWith(suffix)) {
			const baseId = canonical.slice(0, -suffix.length);
			if (codepointById.has(baseId)) {
				assertDistinct(canonical, baseId, `${canonical} lost its ${suffixName} state`);
			}
		}
	}
}

for (const prefix of policy.preserveCodiconPrefixes) {
	const baseId = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
	for (const id of codepointById.keys()) {
		if (id.startsWith(prefix) && codepointById.has(baseId)) {
			assertDistinct(id, baseId, `${id} collapsed onto ${baseId}`);
		}
	}
}
for (const [id, distinctId] of Object.entries(policy.distinctFrom)) {
	assertDistinct(id, distinctId, `${id} collapsed onto ${distinctId}`);
}

let changedFromCodicon = 0;
let separatelyDrawnFilled = 0;
for (const rawCodepoint of Object.keys(reference.glyphs)) {
	const character = String.fromCodePoint(Number(rawCodepoint));
	const basePath = JSON.stringify(base.charToGlyph(character).path.commands);
	const regularPath = JSON.stringify(regular.charToGlyph(character).path.commands);
	const filledPath = JSON.stringify(filled.charToGlyph(character).path.commands);
	if (basePath !== regularPath) {
		changedFromCodicon++;
	}
	if (regularPath !== filledPath) {
		separatelyDrawnFilled++;
	}
}
assert.ok(changedFromCodicon >= 150, `only ${changedFromCodicon} reference glyphs differ from Codicon`);
assert.ok(separatelyDrawnFilled >= 150, `only ${separatelyDrawnFilled} glyphs have a distinct filled drawing`);

for (const [rawCodepoint, override] of Object.entries(overrides.glyphs)) {
	const character = String.fromCodePoint(Number(rawCodepoint));
	const regularGlyph = regular.charToGlyph(character);
	const filledGlyph = filled.charToGlyph(character);
	assert.notEqual(JSON.stringify(regularGlyph.path.commands), JSON.stringify(base.charToGlyph(character).path.commands), `${override.name} still matches Codicon`);
	assert.notEqual(JSON.stringify(regularGlyph.path.commands), JSON.stringify(filledGlyph.path.commands), `${override.name} has no distinct active drawing`);
	const bounds = regularGlyph.getBoundingBox();
	const maxOpticalWidth = override.maxOpticalWidth ?? 235;
	assert.ok(bounds.x2 - bounds.x1 <= maxOpticalWidth, `${override.name} exceeds the ${maxOpticalWidth}-unit optical width (${bounds.x2 - bounds.x1})`);
	const filledBounds = filledGlyph.getBoundingBox();
	const maxActiveOpticalWidth = override.maxActiveOpticalWidth ?? 245;
	assert.ok(filledBounds.x2 - filledBounds.x1 <= maxActiveOpticalWidth, `${override.name} active state exceeds the ${maxActiveOpticalWidth}-unit optical width (${filledBounds.x2 - filledBounds.x1})`);
}

// OpenIDE-owned icons share one runtime table. They must occupy unused upstream slots and have a
// matching named override so a Codicon update cannot silently replace either side of the contract.
const productIconModule = fs.readFileSync(path.join(root, 'src/vs/workbench/common/openideProductIcons.ts'), 'utf8');
const productIcons = [...productIconModule.matchAll(/'([^']+)': 0x([0-9a-f]+),/g)]
	.map(match => ({ id: match[1], codepoint: Number.parseInt(match[2], 16) }));
assert.ok(productIcons.length, 'no OpenIDE product icons found');
assert.equal(new Set(productIcons.map(icon => icon.id)).size, productIcons.length, 'duplicate OpenIDE product icon id');
assert.equal(new Set(productIcons.map(icon => icon.codepoint)).size, productIcons.length, 'duplicate OpenIDE product icon codepoint');
for (const { id, codepoint } of productIcons) {
	const character = String.fromCodePoint(codepoint);
	assert.equal(base.charToGlyphIndex(character), 0, `${id} collides with upstream codepoint 0x${codepoint.toString(16)}`);
	assert.equal(overrides.glyphs[String(codepoint)]?.name, id, `${id} has no matching named override`);
	assert.notEqual(regular.charToGlyphIndex(character), 0, `regular is missing ${id}`);
	assert.notEqual(filled.charToGlyphIndex(character), 0, `filled is missing ${id}`);
}
const privateOverrides = Object.entries(overrides.glyphs)
	.filter(([rawCodepoint]) => !mapping[rawCodepoint] && base.charToGlyphIndex(String.fromCodePoint(Number(rawCodepoint))) === 0)
	.map(([rawCodepoint, override]) => `${override.name}:${rawCodepoint}`)
	.sort();
const declaredPrivateIcons = productIcons.map(icon => `${icon.id}:${icon.codepoint}`).sort();
assert.deepEqual(privateOverrides, declaredPrivateIcons, 'private font overrides and runtime product icons differ');

const webviewCss = fs.readFileSync(path.join(root, 'resources/openide-icons/codicon-webview.css'), 'utf8');
assert.equal(webviewCss, buildWebviewCodiconCss(), 'codicon-webview.css is stale');
// Something has to actually consume the `filled` variant, or FontForge drops it silently and the
// composer's mode chip is left with the outline glyph. It used to live in `openideChatHtml.ts`,
// which disappeared when the chat moved to native DOM; the consumer is the composer now. The
// assertion is relaxed to the two classes separately because native composes them in two places
// (creating the icon and rebuilding its className) rather than in a single literal.
const composerControls = fs.readFileSync(path.join(root, 'src/vs/workbench/contrib/openideAgent/browser/chat/openideChatComposerControls.ts'), 'utf8');
assert.match(composerControls, /codicon-filled/, 'no explicit filled icon consumer');
assert.match(composerControls, /openide-mode-agent/, 'the mode chip no longer names its own icon');

// El alias público json/bracket comparte glyph interno con symbol-namespace en Codicon. Esta
// aserción evita que FontForge vuelva a descartar silenciosamente una de las dos llaves.
for (const [label, font] of [['regular', regular], ['filled', filled]]) {
	const bracesBounds = font.charToGlyph(String.fromCodePoint(60175)).getBoundingBox();
	assert.ok(bracesBounds.x1 < 80 && bracesBounds.x2 > 220, `${label} braces are not optically symmetric`);
}

console.log(`OpenIDE icons valid: ${new Set(publicCssCodepoints.values()).size} public codepoints; ${changedFromCodicon} styled glyphs, ${separatelyDrawnFilled} distinct filled states, ${Object.keys(overrides.glyphs).length} optical overrides, ${productIcons.length} collision-free private icons, protected brands and semantic variants unchanged.`);
