/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — MCP server (stdio) for the diagram engine, for EXTENSION chats
 *  (Claude Code, etc.). It is a STANDALONE entry point, run with
 *          node <install>/out/vs/workbench/contrib/openideAgent/node/openideDiagramsMcpServer.js
 *  (the "OpenIDE Agent: copy diagram MCP configuration" command builds the snippet with the
 *  right path). Protocol: JSON-RPC 2.0 over stdin/stdout, one JSON message per line
 *  (MCP's stdio transport). Backend only: it parses and lays out — rendering is the client's job.
 *--------------------------------------------------------------------------------------------*/

import { layoutNodeMap, NODE_MAP_KINDS, parseNodeMap } from '../common/diagrams/openideNodeMaps.js';
import { looksLikeSeqMap, parseSeqMap } from '../common/diagrams/openideSeqMap.js';
import { DIAGRAM_KINDS, layoutGraph, parseDiagramSource, parseFlowchart, parseMindmap, parseStateDiagram } from '../common/diagrams/openideDiagramEngine.js';

interface IJsonRpcRequest {
	jsonrpc: '2.0';
	id?: number | string | null;
	method: string;
	params?: any;
}

const SERVER_INFO = { name: 'openide-diagrams', version: '1.0.0' };

const TOOLS = [
	{
		name: 'diagram_parse',
		description: 'Parsea una fuente mermaid (flowchart/graph, stateDiagram, mindmap, pie, gantt, sequenceDiagram, timeline, journey, quadrantChart, gitGraph) al spec tipado del motor de diagramas de OpenIDE. Familia "graph" incluye el layout con posiciones; familia "chart" devuelve el spec del chart. Usalo para validar un diagrama antes de mostrarlo o para obtener su estructura.',
		inputSchema: {
			type: 'object',
			properties: { source: { type: 'string', description: 'Fuente mermaid del diagrama' } },
			required: ['source'],
		},
	},
	{
		name: 'diagram_layout',
		description: 'Computa SOLO el layout por capas (posiciones x/y de nodos y aristas) de un diagrama de la familia graph (flowchart, stateDiagram o mindmap). Para charts usá diagram_parse.',
		inputSchema: {
			type: 'object',
			properties: { source: { type: 'string', description: 'Fuente mermaid (familia graph)' } },
			required: ['source'],
		},
	},
	{
		name: 'diagram_kinds',
		description: 'Lista los tipos de diagrama que soporta el motor de OpenIDE.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'map_validate',
		description: 'Valida un mapa tipado de OpenIDE (JSON, modelo de Archify) y devuelve ok:true con un resumen, o diagnostics [{code, severity, subject, message, fix?}] para reparar y reintentar. Cuatro tipos, elegí por lo que se cuenta: "archmap" (componentes/infra) y "flowmap" (procesos; group = carril) y "lifemap" (estados/ciclos de vida) comparten la forma {type, title?, nodes:[{id, label, kind, sublabel?, group?, emphasis?}], edges:[{from, to, label?, dashed?}]} y difieren solo en kinds (archmap: frontend|backend|database|cloud|security|messagebus|external · flowmap: start|step|decision|tool|end|failure · lifemap: initial|active|waiting|terminal|failure); "seqmap" (secuencia) es {type:"seqmap", title?, actors:[{id, label, kind como archmap, sublabel?}], steps:[{from, to, label, reply?, dashed?}]} y el orden de steps ES el tiempo. El layout es automático y determinista (no hay posiciones que autorear). Cuando pase la validación, emitilo en el chat dentro de un fence con el nombre del tipo (```archmap, ```flowmap, ```lifemap, ```seqmap) y OpenIDE lo dibuja como grafo de nodos con la misma piel. Mantené ≤ 12 nodos primarios, un camino principal claro y labels cortos.',
		inputSchema: {
			type: 'object',
			properties: { source: { type: 'string', description: 'El JSON completo del mapa (con su campo type)' } },
			required: ['source'],
		},
	},
];

function textResult(value: unknown): any {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] };
}

function errorResult(message: string): any {
	return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

function callTool(name: string, args: any): any {
	if (name === 'diagram_kinds') {
		return textResult({ kinds: DIAGRAM_KINDS });
	}
	const source = String(args?.source ?? '');
	if (!source.trim()) {
		return errorResult('source vacío');
	}
	if (name === 'diagram_parse') {
		const result = parseDiagramSource(source);
		return result ? textResult(result) : errorResult('el texto no es un diagrama soportado');
	}
	if (name === 'map_validate') {
		if (looksLikeSeqMap(source)) {
			const parsed = parseSeqMap(source);
			if (!parsed.spec) {
				return textResult({ ok: false, diagnostics: parsed.diagnostics, kinds: NODE_MAP_KINDS.archmap });
			}
			return textResult({
				ok: true,
				warnings: parsed.diagnostics,
				summary: { type: 'seqmap', actors: parsed.spec.actors.length, steps: parsed.spec.steps.length },
			});
		}
		const parsed = parseNodeMap(source);
		if (!parsed.spec) {
			return textResult({ ok: false, diagnostics: parsed.diagnostics, kinds: NODE_MAP_KINDS });
		}
		const layout = layoutNodeMap(parsed.spec);
		return textResult({
			ok: true,
			warnings: parsed.diagnostics,
			summary: {
				type: parsed.spec.type,
				nodes: parsed.spec.nodes.length,
				edges: parsed.spec.edges.length,
				groups: layout.hulls.map(hull => hull.label),
			},
		});
	}
	if (name === 'diagram_layout') {
		const spec = parseFlowchart(source) ?? parseStateDiagram(source) ?? parseMindmap(source);
		if (!spec || !spec.nodes.length) {
			return errorResult('el texto no es un diagrama de la familia graph (flowchart/state/mindmap)');
		}
		return textResult({ spec, layout: layoutGraph(spec) });
	}
	return errorResult(`tool desconocida: ${name}`);
}

function handle(req: IJsonRpcRequest): any | undefined {
	switch (req.method) {
		case 'initialize':
			return {
				protocolVersion: req.params?.protocolVersion ?? '2024-11-05',
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			};
		case 'ping':
			return {};
		case 'tools/list':
			return { tools: TOOLS };
		case 'tools/call':
			try {
				return callTool(String(req.params?.name ?? ''), req.params?.arguments ?? {});
			} catch (e) {
				return errorResult(e instanceof Error ? e.message : String(e));
			}
		default:
			return undefined; // método no soportado
	}
}

function send(msg: unknown): void {
	process.stdout.write(JSON.stringify(msg) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	let idx: number;
	while ((idx = buffer.indexOf('\n')) !== -1) {
		const line = buffer.slice(0, idx).trim();
		buffer = buffer.slice(idx + 1);
		if (!line) { continue; }
		let req: IJsonRpcRequest;
		try { req = JSON.parse(line); } catch { continue; }
		if (req.id === undefined || req.id === null) {
			continue; // notificación (p.ej. notifications/initialized): sin respuesta
		}
		const result = handle(req);
		if (result === undefined) {
			send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `método no soportado: ${req.method}` } });
		} else {
			send({ jsonrpc: '2.0', id: req.id, result });
		}
	}
});
process.stdin.on('end', () => process.exit(0));
