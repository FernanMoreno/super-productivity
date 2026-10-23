# Contratos compartidos UI/MCP

Se conserva createPlannerOperations(ports) y plannerOperation(action,params). Solo el plugin personal-planner habilitado puede usar las acciones del panel, independientemente de MCP. MCP aplica scopes dinámicos en proceso principal y renderizador.

- next: consulta de hasta tres sugerencias con razones, contexto, capacidad y alternativas.
- review: consulta de sesión/asuntos/tabla semanal y su revisión.
- review_advance: persistir comienzo/decisión/estado manual con operationId y revisión esperada. No completa una tarea por marcarla revisada.
- correct_time: duración absoluta de una fecha y tarea asociada a actividad; expectedDurationMs, durationMs y operationId. Cero permitido; no hora de inicio.
- proposal_adjust: ajustar intervalos de una propuesta existente sin mutar usuario; nueva propuesta y validación de capacidad/restricciones.
- history: consultar diferencias y estados de reorganizaciones durables.
- prepare_undo: preparar propuesta inversa con conflictos por elemento, para apply seleccionado.
- apply/task/edit/log_time/operation_status: reutilizados, con recibos extendidos. task añade split/archive explícitos cuando sus servicios nativos lo permiten. Archivo nativo completa, por lo que la UI debe nombrarlo expresamente. Dividir no reparte el tiempo histórico arbitrariamente: lo hereda el primer hijo según la regla nativa.

Los esquemas ejecutables y las pruebas contractuales son la referencia definitiva de parámetros. No se añade un servidor MCP: Electron ofrece Streamable HTTP local y el adaptador stdio mantiene la misma implementación.
