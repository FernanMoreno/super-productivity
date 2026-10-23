# Planificación y revisión guiadas

Este flujo usa las operaciones comunes del panel y del [MCP local](planner-mcp.md). La ampliación 0.5 se desarrolla sobre el planificador configurable; el [informe de 0.4.0](../packages/plugin-dev/personal-planner/VALIDACION-LIMITES.md) describe la validación anterior, no la de estas funciones nuevas.

## Preparar una situación propia

Empieza con un perfil vacío o una demostración ficticia. Crea actividades y vincúlalas a proyectos o etiquetas existentes. Configura disponibilidad, compromisos, objetivos y su fecha de entrada en vigor. Los nombres y horarios son datos editables: cambiar de actividad no exige recompilar. Puedes ajustar el formato visual de 12/24 horas, la duración de sesión y el margen de transición. La hora visual no cambia los instantes guardados ni convierte una duración de sesión en tiempo registrado.

Las estimaciones, los minutos registrados y la completitud se muestran por separado. Declara los márgenes que falten o márcalos como no aplicables; mientras no estén definidos, conserva el aviso de disponibilidad parcial. Los calendarios externos se leen de la caché nativa y mantienen advertencias de actualización/cobertura. Actualízalos mediante la aplicación cuando corresponda: consultar el planificador no inicia una descarga de esos proveedores.

## Elegir qué hacer ahora

Consulta `planner_next` con el tiempo disponible y, si lo necesitas, una actividad como contexto. Devuelve hasta tres alternativas con motivos. Distingue las acciones viables ahora de las propuestas para otra fecha; una alternativa excluida mantiene su explicación y no se convierte en una acción inmediata. El estado auxiliar pausado/bloqueado evita tratar todas las tareas pendientes como igualmente disponibles; no completa ni archiva tareas nativas.

Revisa las advertencias antes de elegir. Si no hay una acción adecuada, corrige estimaciones, asociaciones o disponibilidad. Pedir recomendaciones no inicia el temporizador. Utiliza los controles nativos para empezar una sesión.

## Revisar un intervalo y retomar después

1. Consulta `planner_review` para el intervalo. Conserva su `revision` y distingue el tiempo registrado del plan capturado.
2. Inicia la sesión con `planner_review_advance`, `command: "start"`, fechas, `expectedRevision` e identificador de operación.
3. Para cada incidencia, guarda una decisión con `command: "decide"`, su `reviewId` e `itemId`. Las opciones son conservar, reprogramar, dividir, pausar, archivar o corregir tiempo.
4. Ejecuta por separado los cambios concretos que hayas decidido. Una decisión guardada no mueve la tarea ni cambia su registro.
5. Termina explícitamente con `command: "finish"` cuando todas las incidencias tengan decisión.

Tras cada avance, utiliza la revisión devuelta para el siguiente. Al reabrir, consulta la sesión guardada; no crees otra para simular que se terminó. Si faltaba una captura del plan, no se inventan estimaciones históricas para calcular una desviación.

Para registrar tiempo nuevo, `planner_log_time` añade una duración. Para corregir un día, `planner_correct_time` establece su total y exige el total anterior esperado. Por ejemplo, cambiar a 25 minutos significa `durationMs: 1500000`; no añade otros 25 minutos. Elige siempre la tarea hoja asociada: el tiempo de las tareas superiores se deriva de sus subtareas. Estos ajustes conocen una duración y un día, no una hora de inicio/fin; no crean sesiones horarias ficticias, tampoco al registrar minutos de hoy.

## Revisar una reorganización

Prepara una propuesta para el intervalo y examina sus motivos, destinos y conflictos. Puedes ajustar sus instantes con `planner_proposal_adjust`; conserva el nuevo `proposalId` que devuelve. El ajuste no mueve tareas. Para una tarea nativa, su duración continúa dependiendo de la estimación restante.

Selecciona únicamente los cambios aceptados y aplica esos IDs. Las reservas propias y las tareas del calendario nativo se aplican por separado. La aplicación rechaza una propuesta obsoleta en lugar de sustituirla silenciosamente por otra.

Después puedes consultar `planner_reorganizations`. Para deshacer una entrada confirmada, utiliza `planner_prepare_undo`, revisa la inversa y aplica su selección. Los cambios posteriores incompatibles permanecen protegidos. Este historial restaura únicamente los campos de planificación afectados; no borra tiempo registrado ni recupera una copia completa del perfil.

## Recuperar una respuesta perdida

Conserva la acción y el `operationId`. Consulta su recibo mediante `planner_operation_status`; no envíes de nuevo una mutación con otro ID para averiguar si la primera funcionó.

Un recibo pendiente, incierto o ausente requiere revisar el estado actual. Reabrir la aplicación conserva recibos, sesiones de revisión e historial durables; una propuesta provisional caducada debe prepararse y revisarse otra vez. Los distintos asistentes locales se conectan a los mismos datos mediante [la configuración de cliente](planner-mcp-clients.md).
