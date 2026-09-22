/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_CLI_INTEGRATION_STRINGS = {
	'cli.integration.unknown': { es: 'Terminal abierta · estado sin verificar', en: 'Terminal open · status unverified' },
	'cli.integration.working': { es: 'Trabajando', en: 'Working' },
	'cli.integration.completed': { es: 'Turno completado', en: 'Turn completed' },
	'cli.integration.failed': { es: 'El turno terminó con un error', en: 'Turn ended with an error' },
	'cli.integration.permission': { es: 'Espera tu permiso en la terminal', en: 'Waiting for your permission in the terminal' },
	'cli.integration.question': { es: 'Tiene una pregunta en la terminal', en: 'Has a question in the terminal' },
	'cli.integration.prompt': { es: 'Listo para tu próximo mensaje', en: 'Ready for your next message' },
	'cli.integration.hooks': { es: 'Estado recibido del CLI', en: 'Status reported by the CLI' },
	'cli.integration.control': { es: 'Estado recibido de la conexión de control', en: 'Status reported by the control connection' },
	'cli.integration.unverified': { es: 'Este CLI no informó su estado. La salida y el silencio no indican si está esperando.', en: 'This CLI has not reported its status. Output and silence do not tell us whether it is waiting.' },
	'cli.integration.hooksPending': { es: 'Esperando el primer evento del CLI. Si los hooks se instalaron recién, reiniciá esta terminal.', en: 'Waiting for the first CLI event. If hooks were just installed, restart this terminal.' },
	'cli.integration.resumeFailed': { es: '{0} no pudo reabrir esta conversación. Se conserva su identidad para reintentar; revisá si sigue abierta en otra terminal.', en: '{0} could not reopen this conversation. Its identity is preserved for retry; check whether it is still open in another terminal.' },
	'cli.integration.capabilities': { es: 'Entrada: texto, archivos de texto y fragmentos. Las imágenes se adjuntan desde el CLI.', en: 'Input: text, text files and snippets. Attach images from the CLI.' },
	'cli.composer.route': { es: 'Borrador para {0}', en: 'Draft for {0}' },
	'cli.composer.placeholder': { es: 'Escribí o agregá contexto para este CLI…', en: 'Write or add context for this CLI…' },
	'cli.composer.paste': { es: 'Pegar en {0}', en: 'Paste into {0}' },
	'cli.composer.hint': { es: 'Se pega sin enviar. Revisalo y enviá desde la terminal.', en: 'Pastes without submitting. Review and submit from the terminal.' },
	'cli.composer.attach': { es: 'Agregar texto', en: 'Add text' },
	'cli.composer.attachTitle': { es: 'Agregar un archivo de texto al borrador', en: 'Add a text file to the draft' },
	'cli.composer.fileTooLarge': { es: 'El archivo supera los 128 KiB. Agregá un fragmento desde el editor.', en: 'The file exceeds 128 KiB. Add a snippet from the editor.' },
	'cli.composer.binaryFile': { es: 'Este archivo no es texto. Adjuntalo directamente desde el CLI.', en: 'This file is not text. Attach it directly from the CLI.' },
	'cli.composer.pasteFailed': { es: 'No se pudo pegar. El borrador sigue disponible.', en: 'Could not paste. Your draft is still available.' },
	'cli.composer.pasteUnsupported': { es: 'Este CLI no habilitó el pegado de varias líneas. El borrador se conserva; usá su entrada de terminal.', en: 'This CLI has not enabled multiline paste. Your draft is preserved; use its terminal input.' },
	'cli.composer.fileFailed': { es: 'No se pudo leer el archivo.', en: 'Could not read the file.' },
	'cli.composer.pasting': { es: 'Pegando…', en: 'Pasting…' },
} as const;
