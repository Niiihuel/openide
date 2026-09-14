# Objetivos persistentes en OpenIDE

GOAL conserva un resultado esperado, sus criterios y el progreso de una conversación. El fin de una respuesta no equivale a completar el objetivo: OpenIDE comprueba los criterios antes de continuar o cerrar.

## Uso

1. Elegí **Goal** en el menú `+`, escribí `/goal` en el compositor o usá **Run as Goal** en un plan.
2. Definí el objetivo y criterios observables. Un criterio `La regresión está cubierta :: npm test` configura un comando verificador. Un criterio sin comando necesita confirmación explícita desde la tarjeta.
3. Elegí el máximo de turnos. El valor inicial visible es 20; alcanzar el límite detiene la continuación, conserva el trabajo y permite ampliar el total al reanudar.
4. Usá la tarjeta junto a las terminales para pausar, reanudar, cancelar, revisar evidencia, abrir los documentos o comparar los cambios.

Guardar un comando como criterio autoriza su evaluación dentro del flujo del objetivo, conservando el modo de permisos de las herramientas. Un criterio debería comprobar el resultado concreto; que `npm test` pase solo demuestra lo que esa suite comprueba. Los requisitos visuales o semánticos pueden requerir revisión manual.

## Archivos y memoria

Cada objetivo tiene `.openide/goals/<id>/GOAL.md` y `REPORT.md`.

- **GOAL.md:** contrato editable con objetivo, criterios y referencia al plan. Al editarlo, guardarlo y reanudar, OpenIDE pide revisar la nueva versión e invalida la evidencia anterior. Marcar casillas o cambiar el estado en Markdown no certifica cumplimiento.
- **REPORT.md:** proyección generada del estado, turnos, criterios, evidencia vigente, evidencia histórica, actividad y enlaces a archivos. La IA aporta reportes breves mediante `goal_report`; los recibos del verificador se registran por separado.
- **Estado y snapshots:** quedan en almacenamiento local del host. Copiar los Markdown a otra máquina no inicia una ejecución. Tras una interrupción se requiere reanudar expresamente.

Project Map indexa objetivos, evidencia documental y relaciones con planes, archivos y notas existentes. Su estado se etiqueta como **reportado por el documento**; el grafo no valida criterios ni controla ejecuciones. Reindexar el mapa no elimina el contrato ni el diario del objetivo.

La memoria reutilizable sigue usando el sistema Markdown existente. El contexto del objetivo orienta al agente a guardar aprendizajes verificados con referencias a su objetivo y evidencia. Un reporte de actividad no se convierte automáticamente en una decisión duradera.

## Ejecución y comprobaciones

El supervisor pertenece a OpenIDE y funciona independientemente del modelo del harness nativo. Registra el turno antes de ejecutarlo, espera subagentes y comprueba comandos mediante la terminal con recibos del backend. Solo admite éxito con salida confirmada `0`, contrato vigente y archivos sin cambios posteriores a la comprobación.

Los archivos relevantes sin guardar impiden verificar el resultado. Una modificación posterior invalida evidencia previa. Los reportes generados y los índices derivados no se cuentan como progreso del objetivo.

Pausar o cancelar frena nuevas continuaciones y cancela el turno controlado. Un comando externo puede haber producido efectos antes de cancelarse: el objetivo no promete deshacerlos. En esta entrega, una terminal de fondo que siga viva impide el cierre automático; hay que detenerla cuando ya no sea necesaria y reanudar. No se intenta adivinar si un proceso es un servicio auxiliar.

Una conversación tiene como máximo un objetivo sin finalizar y un único ejecutor. Tras reinicio, el objetivo activo queda interrumpido. Los errores del almacenamiento y los conflictos de revisión bloquean la transición dependiente.

## CLIs

Las herramientas MCP `openide_goal_get` y `openide_goal_report` se anuncian con ejemplos de intención: consultar cómo va el objetivo o registrar un hito. El endpoint identifica la ventana, no autentica por sí solo qué conversación produjo un reporte. Por eso los reportes externos seleccionan `goal_id` y quedan marcados como declaraciones sin verificar; no pueden completar objetivos ni acreditar autoría de archivos.

El adaptador estructurado de Codex utiliza el ejecutable detectado y conserva su configuración y autenticación. El terminal y el controlador comparten un servidor privado por sesión. OpenIDE inicia y correlaciona turnos mediante el protocolo; no interpreta el silencio de la terminal como finalización ni activa simultáneamente el `/goal` del proveedor. La disponibilidad se muestra solo después de verificar la conexión.

Una CLI sin adaptador compatible mantiene documentos, lectura y reportes manuales. En esta entrega el transporte de Codex requiere sockets Unix; Windows usa seguimiento manual. Las solicitudes de permisos o interacción no soportadas interrumpen la continuación automática para atenderlas manualmente.

## Cambios del objetivo

**Changes** abre comparaciones históricas de solo lectura de ediciones nativas capturadas durante sus turnos. Conserva la primera versión anterior y la última posterior. Si la cadena no coincide, el archivo queda marcado con atribución incierta. Renombres y cambios producidos por procesos externos no se presentan como autoría exacta del agente.

Los cambios CLI siguen siendo observaciones del workspace y se revisan con el mecanismo de cambios CLI existente. El transporte estructurado delimita turnos; no transforma una observación en prueba de autoría.

La captura limita cada par de contenidos a 2 MiB y el índice a 500 archivos; continúa actualizando archivos ya incluidos. Las omisiones quedan registradas en el reporte. No se ofrece un reset global del repositorio como deshacer GOAL. La restauración existente por cambios revisados conserva sus propias comprobaciones.

## Límites de esta entrega

El presupuesto es por turnos. No se inventan tokens o costes de suscripciones cuando el proveedor no los informa. La repetición de reportes sin progreso bloquea la continuación; no hay un juez LLM adicional. Los logs operativos usan el diario local existente con cuotas: no es un servicio de ejecución 24/7 ni un archivo histórico ilimitado.

Para comparar decisiones y fuentes de diseño, ver [la investigación](goal-system-investigation.md).
