/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	extractCodebaseNotes,
	extractBareIdentifiers,
	extractNoteMentions,
	isCodebaseNotesUri,
	isPathMention,
	linkCodebaseNotes,
	looksLikeIdentifier,
	noteLinkingFromSetting,
	notesWorkspaceRoot,
	parseCodebaseNotes,
} from '../../../../../code/common/openideCodebaseNotes.js';
import { ICodebaseMemoryNode, makeEvidence, makeNodeId } from '../../../../../code/common/openideCodebaseMemoryTypes.js';

const ROOT = 'file:///repo';
const NOTES_URI = `${ROOT}/.openide/MEMORY.md`;
const KEY = 'ws';

function codeNode(uri: string, kind: ICodebaseMemoryNode['kind'], name: string): ICodebaseMemoryNode {
	return { id: makeNodeId(KEY, uri, kind, name), kind, name, qualifiedName: name, uri, evidence: makeEvidence('regex'), degree: 0 };
}

function fileNode(uri: string): ICodebaseMemoryNode {
	return { id: makeNodeId(KEY, uri, 'file', uri), kind: 'file', name: uri.split('/').pop()!, uri, evidence: makeEvidence('regex'), degree: 0 };
}

suite('OpenIDE — the shared memory inside the graph', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parsing', () => {
		test('every bullet is a note and remembers its line', () => {
			const entries = parseCodebaseNotes('- uno\n- dos\n');
			assert.equal(entries.length, 2);
			assert.equal(entries[0].text, 'uno');
			assert.equal(entries[0].line, 1);
			assert.equal(entries[1].line, 2);
		});

		test('a continued line belongs to the bullet above it', () => {
			// Splitting a wrapped sentence into two notes yields two half-truths.
			const entries = parseCodebaseNotes('- una decisión larga\n  que sigue acá\n');
			assert.equal(entries.length, 1);
			assert.equal(entries[0].text, 'una decisión larga que sigue acá');
		});

		test('headings are not notes, they are the topic of the ones below them', () => {
			const entries = parseCodebaseNotes('# Arquitectura\n\n- RLS es el único control de acceso\n');
			assert.equal(entries.length, 1);
			assert.equal(entries[0].section, 'Arquitectura');
		});

		test('loose prose does not enter the graph', () => {
			const entries = parseCodebaseNotes('Esto es un párrafo cualquiera.\n\nOtro más.\n');
			assert.deepEqual(entries, []);
		});

		test('an empty file does not break', () => {
			assert.deepEqual(parseCodebaseNotes(''), []);
			assert.deepEqual(parseCodebaseNotes('\n\n\n'), []);
		});
	});

	suite('mentions', () => {
		test('only what was marked on purpose', () => {
			// No matching every capitalised word: that is how a note about a User flow ends up hanging
			// off an unrelated User class, and a wrongly placed edge is invisible once it is in the
			// graph.
			assert.deepEqual(extractNoteMentions('el `AuthService` valida contra [[src/db.ts]]'), ['AuthService', 'src/db.ts']);
			assert.deepEqual(extractNoteMentions('El AuthService valida los tokens'), []);
		});

		test('a repeated mention counts only once', () => {
			assert.deepEqual(extractNoteMentions('`a` y otra vez `a`'), ['a']);
		});

		test('a path and a symbol are told apart by their shape', () => {
			assert.ok(isPathMention('src/foo/bar.ts'));
			assert.ok(isPathMention('.openide/MEMORY.md'));
			assert.equal(isPathMention('AuthService'), false);
			assert.equal(isPathMention('npm run lint'), false);
		});
	});

	suite('extraction', () => {
		test('notes are born with provider authored and confidence 1', () => {
			// Not the indexer inferring something about the code: it is something a person wrote and
			// committed. That is why it outranks any extractor.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- una decisión\n');
			const note = nodes.find(node => node.kind === 'note')!;
			assert.equal(note.evidence.provider, 'authored');
			assert.equal(note.evidence.confidence, 1);
			assert.equal(note.evidence.verified, true);
		});

		test('the full text survives even when the name is trimmed', () => {
			const largo = `- ${'x'.repeat(300)}`;
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, largo);
			const note = nodes.find(node => node.kind === 'note')!;
			assert.ok(note.name.length <= 81);
			assert.equal(note.documentation!.length, 300);
		});

		test('the file CONTAINS its notes', () => {
			const { nodes, edges } = extractCodebaseNotes(KEY, NOTES_URI, '- uno\n- dos\n');
			assert.equal(nodes.filter(node => node.kind === 'note').length, 2);
			assert.equal(edges.filter(edge => edge.type === 'CONTAINS').length, 2);
		});

		test('no ANNOTATES are emitted here', () => {
			// The provider sees a single file, and an edge needs the target's id, which encodes the
			// target's uri. Resolving it here would be making it up.
			const { edges } = extractCodebaseNotes(KEY, NOTES_URI, '- mirá `AuthService`\n');
			assert.equal(edges.some(edge => edge.type === 'ANNOTATES'), false);
		});
	});

	suite('linking against the whole graph', () => {
		test('a unique symbol is connected', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el `AuthService` valida tokens\n');
			const graph = [...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')];
			const edges = linkCodebaseNotes(graph);
			assert.equal(edges.length, 1);
			assert.equal(edges[0].type, 'ANNOTATES');
			assert.equal(edges[0].evidence.provider, 'authored');
		});

		test('an AMBIGUOUS symbol is connected to none of them', () => {
			// Picking one of two would invent a relation nobody can audit afterwards.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con `Helper`\n');
			const graph = [
				...nodes,
				codeNode(`${ROOT}/src/a.ts`, 'class', 'Helper'),
				codeNode(`${ROOT}/src/b.ts`, 'class', 'Helper'),
			];
			assert.deepEqual(linkCodebaseNotes(graph), []);
		});

		test('a symbol that does not exist leaves no dangling edge', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- mirá `NoExiste`\n');
			assert.deepEqual(linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/a.ts`, 'class', 'Otra')]), []);
		});

		test('a path resolves against the root derived from the notes file itself', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el esquema vive en `src/db.ts`\n');
			const edges = linkCodebaseNotes([...nodes, fileNode(`${ROOT}/src/db.ts`)]);
			assert.equal(edges.length, 1);
			assert.equal(edges[0].target, makeNodeId(KEY, `${ROOT}/src/db.ts`, 'file', `${ROOT}/src/db.ts`));
		});

		test('a partial path works as long as it names a single file', () => {
			// Demanding the full path from the root would make the feature useless to someone writing
			// notes by hand.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ver `services/db.ts`\n');
			const edges = linkCodebaseNotes([...nodes, fileNode(`${ROOT}/src/services/db.ts`)]);
			assert.equal(edges.length, 1);
		});

		test('an ambiguous partial path does not connect either', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ver `db.ts`\n');
			const graph = [...nodes, fileNode(`${ROOT}/a/db.ts`), fileNode(`${ROOT}/b/db.ts`)];
			assert.deepEqual(linkCodebaseNotes(graph), []);
		});

		test('a note does not annotate another note', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- primera\n- mirá `primera`\n');
			assert.deepEqual(linkCodebaseNotes(nodes), []);
		});

		test('with no notes there is no work and no edges', () => {
			assert.deepEqual(linkCodebaseNotes([codeNode(`${ROOT}/src/a.ts`, 'class', 'A')]), []);
		});

		test('the same mention twice yields a single edge', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- `A` y de nuevo `A`\n');
			const edges = linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/a.ts`, 'class', 'A')]);
			assert.equal(edges.length, 1);
		});
	});

	suite('configurable linking mode', () => {
		test('off keeps the notes in the graph but without relations', () => {
			// Turning linking off is not turning memory off: the note is still a node and queries still
			// return it, just unattached.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el `AuthService` valida tokens\n');
			assert.deepEqual(linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')], 'off'), []);
		});

		test('identifiers connects an old note written without any markers', () => {
			// The case the mode exists for: notes written before any of this existed.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con AuthService cuando expira el token\n');
			const graph = [...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')];
			assert.deepEqual(linkCodebaseNotes(graph, 'explicit'), []);
			assert.equal(linkCodebaseNotes(graph, 'identifiers').length, 1);
		});

		test('identifiers still demands a single match', () => {
			// It widens what is ATTEMPTED, never what is accepted.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con AuthService acá\n');
			const graph = [
				...nodes,
				codeNode(`${ROOT}/src/a.ts`, 'class', 'AuthService'),
				codeNode(`${ROOT}/src/b.ts`, 'class', 'AuthService'),
			];
			assert.deepEqual(linkCodebaseNotes(graph, 'identifiers'), []);
		});

		test('a common word does not count as an identifier', () => {
			assert.equal(looksLikeIdentifier('memoria'), false);
			assert.equal(looksLikeIdentifier('token'), false);
			assert.equal(looksLikeIdentifier('de'), false);
			assert.ok(looksLikeIdentifier('AuthService'));
			assert.ok(looksLikeIdentifier('parse_notes'));
			assert.ok(looksLikeIdentifier('memory.load'));
		});

		test('what is already marked is not counted twice', () => {
			assert.deepEqual(extractBareIdentifiers('el `AuthService` y también [[UserStore]]'), []);
		});

		test('a misspelled setting falls back to the default instead of disabling linking', () => {
			assert.equal(noteLinkingFromSetting('identifiers'), 'identifiers');
			assert.equal(noteLinkingFromSetting('off'), 'off');
			assert.equal(noteLinkingFromSetting('cualquier-cosa'), 'explicit');
			assert.equal(noteLinkingFromSetting(undefined), 'explicit');
		});
	});

	suite('file identity', () => {
		test('it recognizes the memory file and its root', () => {
			assert.ok(isCodebaseNotesUri(NOTES_URI));
			assert.equal(isCodebaseNotesUri(`${ROOT}/src/MEMORY.md`), false);
			assert.equal(notesWorkspaceRoot(NOTES_URI), ROOT);
			assert.equal(notesWorkspaceRoot(`${ROOT}/src/a.ts`), undefined);
		});
	});
});
