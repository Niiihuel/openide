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

suite('OpenIDE — la memoria compartida dentro del grafo', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseo', () => {
		test('cada bullet es una nota y guarda su línea', () => {
			const entries = parseCodebaseNotes('- uno\n- dos\n');
			assert.equal(entries.length, 2);
			assert.equal(entries[0].text, 'uno');
			assert.equal(entries[0].line, 1);
			assert.equal(entries[1].line, 2);
		});

		test('una línea continuada pertenece al bullet de arriba', () => {
			// Partir una frase envuelta en dos notas da dos medias verdades.
			const entries = parseCodebaseNotes('- una decisión larga\n  que sigue acá\n');
			assert.equal(entries.length, 1);
			assert.equal(entries[0].text, 'una decisión larga que sigue acá');
		});

		test('los headings no son notas, son el tema de las que vienen abajo', () => {
			const entries = parseCodebaseNotes('# Arquitectura\n\n- RLS es el único control de acceso\n');
			assert.equal(entries.length, 1);
			assert.equal(entries[0].section, 'Arquitectura');
		});

		test('la prosa suelta no entra al grafo', () => {
			const entries = parseCodebaseNotes('Esto es un párrafo cualquiera.\n\nOtro más.\n');
			assert.deepEqual(entries, []);
		});

		test('un archivo vacío no rompe', () => {
			assert.deepEqual(parseCodebaseNotes(''), []);
			assert.deepEqual(parseCodebaseNotes('\n\n\n'), []);
		});
	});

	suite('menciones', () => {
		test('solo lo marcado a propósito', () => {
			// No matching every capitalised word: that is how a note about a User flow ends up hanging
			// off an unrelated User class, and a wrongly placed edge is invisible once it is in the
			// graph.
			assert.deepEqual(extractNoteMentions('el `AuthService` valida contra [[src/db.ts]]'), ['AuthService', 'src/db.ts']);
			assert.deepEqual(extractNoteMentions('El AuthService valida los tokens'), []);
		});

		test('una mención repetida cuenta una sola vez', () => {
			assert.deepEqual(extractNoteMentions('`a` y otra vez `a`'), ['a']);
		});

		test('ruta y símbolo se distinguen por forma', () => {
			assert.ok(isPathMention('src/foo/bar.ts'));
			assert.ok(isPathMention('.openide/MEMORY.md'));
			assert.equal(isPathMention('AuthService'), false);
			assert.equal(isPathMention('npm run lint'), false);
		});
	});

	suite('extracción', () => {
		test('las notas nacen con provider authored y confianza 1', () => {
			// Not the indexer inferring something about the code: it is something a person wrote and
			// committed. That is why it outranks any extractor.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- una decisión\n');
			const note = nodes.find(node => node.kind === 'note')!;
			assert.equal(note.evidence.provider, 'authored');
			assert.equal(note.evidence.confidence, 1);
			assert.equal(note.evidence.verified, true);
		});

		test('el texto completo sobrevive aunque el nombre se recorte', () => {
			const largo = `- ${'x'.repeat(300)}`;
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, largo);
			const note = nodes.find(node => node.kind === 'note')!;
			assert.ok(note.name.length <= 81);
			assert.equal(note.documentation!.length, 300);
		});

		test('el archivo CONTIENE sus notas', () => {
			const { nodes, edges } = extractCodebaseNotes(KEY, NOTES_URI, '- uno\n- dos\n');
			assert.equal(nodes.filter(node => node.kind === 'note').length, 2);
			assert.equal(edges.filter(edge => edge.type === 'CONTAINS').length, 2);
		});

		test('acá NO se emiten ANNOTATES', () => {
			// The provider sees a single file, and an edge needs the target's id, which encodes the
			// target's uri. Resolving it here would be making it up.
			const { edges } = extractCodebaseNotes(KEY, NOTES_URI, '- mirá `AuthService`\n');
			assert.equal(edges.some(edge => edge.type === 'ANNOTATES'), false);
		});
	});

	suite('enlace contra el grafo entero', () => {
		test('un símbolo único se conecta', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el `AuthService` valida tokens\n');
			const graph = [...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')];
			const edges = linkCodebaseNotes(graph);
			assert.equal(edges.length, 1);
			assert.equal(edges[0].type, 'ANNOTATES');
			assert.equal(edges[0].evidence.provider, 'authored');
		});

		test('un símbolo AMBIGUO no se conecta a ninguno', () => {
			// Picking one of two would invent a relation nobody can audit afterwards.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con `Helper`\n');
			const graph = [
				...nodes,
				codeNode(`${ROOT}/src/a.ts`, 'class', 'Helper'),
				codeNode(`${ROOT}/src/b.ts`, 'class', 'Helper'),
			];
			assert.deepEqual(linkCodebaseNotes(graph), []);
		});

		test('un símbolo que no existe no deja arista colgando', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- mirá `NoExiste`\n');
			assert.deepEqual(linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/a.ts`, 'class', 'Otra')]), []);
		});

		test('una ruta se resuelve contra la raíz que sale del propio archivo de notas', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el esquema vive en `src/db.ts`\n');
			const edges = linkCodebaseNotes([...nodes, fileNode(`${ROOT}/src/db.ts`)]);
			assert.equal(edges.length, 1);
			assert.equal(edges[0].target, makeNodeId(KEY, `${ROOT}/src/db.ts`, 'file', `${ROOT}/src/db.ts`));
		});

		test('una ruta parcial sirve si nombra un solo archivo', () => {
			// Demanding the full path from the root would make the feature useless to someone writing
			// notes by hand.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ver `services/db.ts`\n');
			const edges = linkCodebaseNotes([...nodes, fileNode(`${ROOT}/src/services/db.ts`)]);
			assert.equal(edges.length, 1);
		});

		test('una ruta parcial ambigua tampoco conecta', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ver `db.ts`\n');
			const graph = [...nodes, fileNode(`${ROOT}/a/db.ts`), fileNode(`${ROOT}/b/db.ts`)];
			assert.deepEqual(linkCodebaseNotes(graph), []);
		});

		test('una nota no anota a otra nota', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- primera\n- mirá `primera`\n');
			assert.deepEqual(linkCodebaseNotes(nodes), []);
		});

		test('sin notas no hay trabajo ni aristas', () => {
			assert.deepEqual(linkCodebaseNotes([codeNode(`${ROOT}/src/a.ts`, 'class', 'A')]), []);
		});

		test('la misma mención dos veces da una sola arista', () => {
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- `A` y de nuevo `A`\n');
			const edges = linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/a.ts`, 'class', 'A')]);
			assert.equal(edges.length, 1);
		});
	});

	suite('modo de enlace configurable', () => {
		test('off deja las notas en el grafo pero sin relaciones', () => {
			// Turning linking off is not turning memory off: the note is still a node and queries still
			// return it, just unattached.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- el `AuthService` valida tokens\n');
			assert.deepEqual(linkCodebaseNotes([...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')], 'off'), []);
		});

		test('identifiers conecta una nota vieja escrita sin marcar', () => {
			// The case the mode exists for: notes written before any of this existed.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con AuthService cuando expira el token\n');
			const graph = [...nodes, codeNode(`${ROOT}/src/auth.ts`, 'class', 'AuthService')];
			assert.deepEqual(linkCodebaseNotes(graph, 'explicit'), []);
			assert.equal(linkCodebaseNotes(graph, 'identifiers').length, 1);
		});

		test('identifiers sigue exigiendo un único match', () => {
			// It widens what is ATTEMPTED, never what is accepted.
			const { nodes } = extractCodebaseNotes(KEY, NOTES_URI, '- ojo con AuthService acá\n');
			const graph = [
				...nodes,
				codeNode(`${ROOT}/src/a.ts`, 'class', 'AuthService'),
				codeNode(`${ROOT}/src/b.ts`, 'class', 'AuthService'),
			];
			assert.deepEqual(linkCodebaseNotes(graph, 'identifiers'), []);
		});

		test('una palabra común no cuenta como identificador', () => {
			assert.equal(looksLikeIdentifier('memoria'), false);
			assert.equal(looksLikeIdentifier('token'), false);
			assert.equal(looksLikeIdentifier('de'), false);
			assert.ok(looksLikeIdentifier('AuthService'));
			assert.ok(looksLikeIdentifier('parse_notes'));
			assert.ok(looksLikeIdentifier('memory.load'));
		});

		test('lo ya marcado no se cuenta dos veces', () => {
			assert.deepEqual(extractBareIdentifiers('el `AuthService` y también [[UserStore]]'), []);
		});

		test('el setting mal escrito cae al default en vez de apagar el enlace', () => {
			assert.equal(noteLinkingFromSetting('identifiers'), 'identifiers');
			assert.equal(noteLinkingFromSetting('off'), 'off');
			assert.equal(noteLinkingFromSetting('cualquier-cosa'), 'explicit');
			assert.equal(noteLinkingFromSetting(undefined), 'explicit');
		});
	});

	suite('identidad del archivo', () => {
		test('reconoce el archivo de memoria y su raíz', () => {
			assert.ok(isCodebaseNotesUri(NOTES_URI));
			assert.equal(isCodebaseNotesUri(`${ROOT}/src/MEMORY.md`), false);
			assert.equal(notesWorkspaceRoot(NOTES_URI), ROOT);
			assert.equal(notesWorkspaceRoot(`${ROOT}/src/a.ts`), undefined);
		});
	});
});
