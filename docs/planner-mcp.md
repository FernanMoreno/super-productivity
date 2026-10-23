# MCP del planificador configurable

Esta adaptación amplía el MCP nativo de Electron. La interfaz y los asistentes utilizan las mismas operaciones de `packages/personal-planner-core`, los mismos datos adicionales en `pluginUserData` y los servicios nativos para tareas y tiempo. No añade un backend ni una copia independiente de las tareas.

Los controles generales de cronómetro, tiempo, notas, proyectos, etiquetas, inactividad, ajustes, sincronización y actualización se describen en [Controles de la aplicación mediante MCP](mcp-application-controls.md).

La ampliación **0.5 está en desarrollo local**. Esta referencia describe su código; la validación publicada en [VALIDACION-LIMITES.md](../packages/plugin-dev/personal-planner/VALIDACION-LIMITES.md) corresponde a **0.4.0** y no acredita automáticamente las funciones nuevas. Consulta [el alcance de verificación](#verificación) antes de instalar un paquete.

## Compatibilidad y conexión

La base inspeccionada es Super Productivity de desarrollo 19.2.0, commit `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`. La etiqueta original inspeccionada `v19.2.0` no contiene este MCP nativo: el número de versión no basta. Se necesita una compilación compatible de este fork y el plugin actualizado. Importar solamente el ZIP del plugin no incorpora un servidor a la aplicación publicada.

El endpoint es `http://127.0.0.1:3876/mcp`, Streamable HTTP. La aplicación Electron debe permanecer abierta; puede estar minimizada. La página web no incorpora este listener. REST y MCP tienen interruptores, claves y permisos independientes, aunque comparten el puerto. La ruta interna `/assistant/planner` exige procedencia MCP introducida por el proceso principal; no es una API REST pública.

Consulta [conexiones y stdio](planner-mcp-clients.md) para Codex, Claude Code, OpenCode y Claude Desktop. Tras actualizar la aplicación, vuelve a conectar el cliente para renovar las herramientas descubiertas. La configuración del transporte es común para todas ellas; no se añade otra credencial para revisión o historial. El acceso remoto queda fuera de esta integración.

## Herramientas y permisos

En las tablas, **consulta** significa `planner:read` + `tasks:read` + `tasks:read_history`. Estos permisos permiten utilizar el archivo para las métricas; no incluyen notas. Las capacidades de escritura se comprueban además en la aplicación. Cada herramienta utiliza objetos JSON y rechaza campos no admitidos.

| Herramienta                | Parámetros principales                                                | Permisos                                        | Resultado y efecto                                                                                                             |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `planner_activities`       | Ninguno                                                               | `planner:read`                                  | Perfil y su `revision`; sin tareas ni notas.                                                                                   |
| `planner_query`            | `from`, `to`                                                          | Consulta                                        | Capacidad, conflictos, carga, tareas y progreso de 1 a 93 días incluidos. No modifica datos.                                   |
| `planner_next`             | `date?`, `now?`, `availableMinutes?`, `contextAreaId?`, `limit?`      | Consulta                                        | Hasta tres próximas acciones con motivos y datos pendientes. No inicia temporizadores ni programa tareas.                      |
| `planner_review`           | `from`, `to`, `reviewId?`                                             | Consulta                                        | Tabla de previsto/registrado, incidencias y sesión guardada. Leer no crea ni termina una revisión.                             |
| `planner_review_advance`   | `operationId`, `expectedRevision`, `command` y sus campos             | Consulta + `planner:write`                      | Guarda avances, decisiones y preferencias de revisión; véase el contrato inferior.                                             |
| `planner_edit`             | `operationId`, `baseRevision`, `command: {type,payload}`              | `planner:read`, `planner:write`                 | Configuración validada contra la revisión del perfil, con vigencias cuando corresponde.                                        |
| `planner_task`             | `operationId`, `taskId?`, `fields?`; o `command` y campos del comando | `tasks:read`, `tasks:write`                     | Crear/actualizar, dividir o archivar mediante servicios nativos.                                                               |
| `planner_log_time`         | `operationId`, `activityId`, `taskId`, `date`, `durationMs`           | Consulta + `time:write`                         | Añade tiempo nativo a una tarea hoja activa asociada a la actividad.                                                           |
| `planner_correct_time`     | Los mismos IDs y fecha, `durationMs`, `expectedDurationMs`            | Consulta + `time:write`                         | Establece el total de ese día, incluido cero, si coincide el total anterior esperado. No añade esa duración al total anterior. |
| `planner_prepare`          | `from`, `to`                                                          | Consulta                                        | Propuesta provisional con IDs, motivos, conflictos y caducidad; no modifica tareas ni bloques.                                 |
| `planner_proposal_adjust`  | `proposalId`, `changes: [{itemId,start,end?}]`                        | Consulta                                        | Nueva propuesta ajustada y validada; no aplica sus cambios.                                                                    |
| `planner_apply`            | `operationId`, `proposalId`, `selection`                              | Consulta + `planner:write`                      | Aplica exclusivamente los IDs de propuesta seleccionados. Para calendario nativo requiere además `tasks:write`.                |
| `planner_reorganizations`  | `historyId?`, `limit?`                                                | Consulta                                        | Historial durable; devuelve `entries` o una `entry`, sin repetir cambios.                                                      |
| `planner_prepare_undo`     | `historyId`, `selection?`                                             | Consulta                                        | Propuesta inversa revisable. No deshace por sí misma; utiliza después `planner_apply`.                                         |
| `planner_operation_status` | `action`, `operationId`                                               | `planner:read` y permisos de la acción original | Consulta un recibo durable sin repetir la modificación.                                                                        |

Las herramientas originales mantienen sus permisos: `get_status`, `list_tasks`, `get_task`, `list_projects`, `list_tags`, `create_task`. La captura `create_task` no tiene la protección de `operationId` de `planner_task`; repetirla puede duplicar la tarea. `tasks:read_notes` sigue siendo una capacidad independiente. Las herramientas de planificación no devuelven notas.

Las fechas `YYYY-MM-DD` representan días civiles del perfil. Las duraciones nativas y `start`/`end` de los ajustes utilizan **milisegundos**; estos últimos son instantes Unix, no cadenas de hora local. Los objetivos y `availableMinutes` usan **minutos**. `operationId` admite 8–80 letras ASCII, números, `_` o `-`; los IDs de entidades, 1–200 de esos caracteres. Los IDs son estables aunque cambien los nombres.

## Recomendaciones y revisión

`planner_next` acepta una fecha, un instante `now`, contexto de actividad y 1–1440 minutos disponibles. `limit` admite 1–3. `contextAreaId: null` elimina el contexto guardado únicamente para esa consulta. Cada alternativa indica `mode: "now"` o `"planned"`; `viable: false` conserva el motivo de exclusión y no autoriza a empezar esa tarea ahora. Las opciones para fechas futuras se presentan como planificación. Se conservan las advertencias de disponibilidad parcial. Una recomendación vacía no significa que no existan tareas: puede faltar un hueco, una estimación o una asociación válida.

`planner_review` devuelve una `revision` del estado de revisión y una `profileRevision` independiente. Usa la primera como `expectedRevision` al avanzar; `baseRevision` de `planner_edit` corresponde al perfil y no es intercambiable.

| `planner_review_advance.command` | Campos específicos               | Efecto                                                                                                                                              |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`                          | `from`, `to`                     | Captura una referencia del plan conocido e inicia una sesión sin marcarla terminada.                                                                |
| `decide`                         | `reviewId`, `itemId`, `decision` | Guarda `keep`, `reschedule`, `split`, `pause`, `archive` o `correct_time` para una incidencia. No ejecuta implícitamente la acción sobre una tarea. |
| `finish`                         | `reviewId`                       | Termina explícitamente la sesión cuando sus incidencias tienen decisión.                                                                            |
| `task_state`                     | `taskId`, `taskState`            | Guarda estado auxiliar `active`, `paused` o `blocked` para la planificación; no cambia por sí mismo la completitud nativa.                          |
| `preferences`                    | `preferences`                    | Actualiza `contextAreaId` y/o `availableMinutes`; null elimina la preferencia.                                                                      |

Cada avance lleva un `operationId` propio. Las decisiones se conservan al reabrir. Sin una referencia previa no se inventa qué se había previsto: las filas históricas y sus diferencias mantienen esa falta de información. Las horas registradas siguen derivándose de las tareas nativas, incluidas las archivadas cuando corresponda.

## Tareas y tiempo

Crear/actualizar utiliza `fields`: `title`, `isDone`, `timeEstimate`, `projectId`, `tagIds`, `dueDay` o `dueWithTime`. Las dos últimas alternativas no pueden enviarse juntas. `moveScope` permite declarar `occurrence` o `series` cuando la operación recurrente lo requiere. Los títulos se guardan literalmente, sin analizar hashtags como instrucciones.

Los comandos explícitos utilizan `taskId` y excluyen `fields`/`moveScope`:

- `command: "split"`: `children` de 2–50 elementos con `title` y `timeEstimate` opcional. Requiere una tarea superior pendiente sin subtareas. No admite dividir una plantilla recurrente mediante esta integración.
- `command: "archive"`: archiva la tarea superior y sus subtareas por el flujo nativo. No acepta `children`; detén su temporizador y el de sus subtareas antes de archivar.

`expected` opcional permite comprobar `isDone`, `dueDay`, `dueWithTime`, `timeSpent`, `timeEstimate` y `subTaskIds` antes de esos comandos. No permite editar dichos campos mediante la instantánea.

`planner_log_time` añade entre 1 y 86.400.000 ms. `planner_correct_time` establece entre 0 y 86.400.000 ms, comprobando `expectedDurationMs` en ese mismo intervalo. Ambos requieren una actividad asociada, una tarea hoja y una fecha no futura compatible con el calendario del anfitrión. Corregir una tarea archivada no está soportado en este flujo: utiliza el registro nativo. Al registrar o corregir una duración manual se conoce el día y el total, no sus extremos horarios. El registro manual utiliza la vía nativa de backfill incluso para hoy: no inventa una sesión que termine en el instante de la petición. Los temporizadores nativos mantienen su comportamiento propio.

## Ajustar, aplicar y deshacer

Preparar y ajustar son consultas sin cambios de calendario. `planner_proposal_adjust` recibe IDs de elementos existentes y devuelve **otro `proposalId`**. Puede mover inicio/fin dentro del intervalo revisado. Para tareas nativas mantiene la duración derivada de su estimación restante; cambia la estimación mediante la operación de tarea si esa es la intención. Los datos nativos esperados provienen de la propuesta original, no del cliente.

Revisa motivos y conflictos, elige únicamente IDs de la propuesta devuelta y aplica esa selección en el mismo canal que la preparó (panel o MCP). Los datos y recibos son compartidos; las propuestas provisionales mantienen sesiones separadas de autorización. Tareas nativas y bloques del planificador se aplican **por separado**; no existe una transacción conjunta para ambos tipos. Al aplicar se revalidan permisos, perfil, tareas, archivo y contexto de calendarios conocidos.

Una aplicación crea historial durable con identidad, estado y campos de planificación anteriores/posteriores. `historyId` corresponde a su `operationId`. `planner_reorganizations` admite un ID o una lista de hasta 100 entradas, por defecto 20. Sus estados son `pending`, `confirmed`, `uncertain` y `rejected`; no equivalen sin más a los estados del recibo.

Para deshacer, consulta una entrada **confirmada**, prepara su inversa y revisa sus cambios seleccionables. `selection` de `planner_prepare_undo` se refiere a IDs de cambios del historial; la selección posterior de `planner_apply` utiliza los IDs de la nueva propuesta. Si un campo afectado cambió después, la inversa lo identifica como incompatible y no lo sobreescribe. Restaurar la planificación conserva el tiempo registrado y los campos ajenos al cambio. No restaura copias completas de tareas ni perfiles. Una inversa no admite ajuste manual de horario.

## Comandos de configuración

Obtén primero `revision` mediante `planner_activities`. `planner_edit` admite:

| `command.type`        | `payload`                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity.create`     | `name`, `id` opcional. Crea una actividad vacía y editable.                                                                                                                                                                                 |
| `activity.update`     | `id`, `updates`. Metadatos: `name`, `color`, `icon`, `priority`, `parentAreaId`, `projectIds`, `tagIds`, `workTime`, `estimateMinutes`, `plannedDate`, `dueDate`, `startDate`, `endDate`, `allowedWeekdays`, `earliest`, `latest`, `order`. |
| `activity.goals`      | `id`, `from`, `goals: {dailyMinutes,weeklyMinutes,targetHours}`. Usa null para un objetivo no definido.                                                                                                                                     |
| `activity.state`      | `id`, `from`, `state`: `active`, `paused` o `archived`.                                                                                                                                                                                     |
| `activity.completion` | `id`, `from`, `status`: `pending`, `in-progress` o `completed`. No se deduce de las horas registradas.                                                                                                                                      |
| `activity.reorder`    | `ids`: todos los IDs, sin duplicados, en el orden deseado.                                                                                                                                                                                  |
| `commitment.create`   | `commitment`: ID opcional, `title`, `kind`, `date` puntual o `weekdays` recurrentes, `start`, `end`, `startDate`/`endDate` opcionales, `scope` y `areaId` cuando corresponda.                                                               |
| `commitment.edit`     | `id`, `updates`, `scope`: `occurrence` o `future`, `date`. Una ocurrencia crea una excepción; las futuras dividen la vigencia conservando el pasado.                                                                                        |
| `commitment.skip`     | `id`, `date`: excluye una ocurrencia.                                                                                                                                                                                                       |
| `commitment.remove`   | `id`, `from`: termina la recurrencia desde esa fecha conservando su historial.                                                                                                                                                              |
| `deadline.upsert`     | `collection`: `deadlines` o `milestones`; `value` con ID opcional, `title`, `date`, `areaId` y demás campos admitidos por el formulario.                                                                                                    |
| `deadline.remove`     | `collection`, `id`.                                                                                                                                                                                                                         |
| `preferences.update`  | `timezone`, `weekStartsOn` (0 domingo…6 sábado) y/o `preferences` parcial: `hourFormat` (`24h`/`12h`), `sessionMinutes` (1–480), `transitionMinutes` (0–240). Conserva los campos omitidos.                                                 |
| `completeness.update` | Banderas `sleep`, `commute`, `meal`, `buffer`. Declarar un margen completo no inventa su horario.                                                                                                                                           |
| `exclusion.upsert`    | `value` con `areaId`, `start` y `end`: periodo excluido de formación.                                                                                                                                                                       |
| `exclusion.remove`    | `index` del periodo mostrado en el perfil.                                                                                                                                                                                                  |

Los tipos de compromiso reutilizan el formulario: `work`, `busy`, `study`, `sleep`, `commute`, `meal`, `buffer`, `extra`, `available`, `absence`, `flexible`. `scope` puede ser `all`, `work` o `personal`. `weekdays` utiliza 0 domingo a 6 sábado. Las horas usan `HH:mm`. Los compromisos pueden cruzar medianoche; una hora inexistente o ambigua requiere corrección y se muestra como advertencia. La aplicación de propuestas rechaza extremos ambiguos y bloques de 24 horas o más: deben dividirse explícitamente.

Ejemplo ficticio de petición tras consultar el perfil:

```json
{
  "operationId": "objetivo-ficticio-001",
  "baseRevision": "REVISION_DEVUELTA_POR_LA_APLICACION",
  "command": {
    "type": "activity.goals",
    "payload": {
      "id": "actividad-ficticia",
      "from": "2027-01-04",
      "goals": { "dailyMinutes": 25, "weeklyMinutes": null, "targetHours": null }
    }
  }
}
```

Los esquemas descubiertos y `model.mjs` son la fuente de verdad de campos y límites. Los comandos no incluyen reemplazo arbitrario de perfil desde MCP: la importación completa continúa siendo una acción de la interfaz.

## Resultados, concurrencia e historial

`planner_operation_status({action, operationId})` consulta un recibo sin repetir la modificación. `action` es `edit`, `task`, `log_time` o `apply`. Requiere `planner:read` y los permisos de la operación original, comprobados también después de la lectura. Devuelve estado, `receiptState` y únicamente los identificadores/duraciones/revisión confirmados; nunca el contenido de la petición. `not_found` y un recibo pendiente no demuestran que sea seguro volver a ejecutar. Los recibos corruptos producen `DATA_CORRUPT`.

`planner_task` admite `fields.dueWithTime` (milisegundos Unix positivos) o `fields.dueDay`; no ambos en una misma petición. `null` desprograma. Cambiar una tarea con hora a una fecha usa la planificación nativa y limpia su recordatorio. Cambiar una hora conserva el desfase de un recordatorio existente. Para cambiar de proyecto una tarea recurrente hay que indicar `moveScope: "occurrence"` o `"series"`: la segunda opción utiliza la operación nativa para la configuración y sus instancias activas/archivadas. No es una transacción indivisible; un fallo después de comenzar devuelve resultado incierto.

Las propuestas identifican `target: "commitment"` o `"native-task"`. Estas últimas muestran `taskId`, franja y motivo, conservan ocupados los huecos de tareas no seleccionadas y se aplican mediante acciones nativas. Aplicarlas requiere además `tasks:write`. Una selección no puede mezclar ambos destinos: aplícalos por separado y prepara otra propuesta después de cada cambio. El panel utiliza estas mismas operaciones mediante `plannerOperation`, con identidad del plugin vinculada por el anfitrión; no necesita habilitar MCP para utilizar su interfaz.

Una mutación devuelve `status`: `applied`, `rejected`, `conflict` o `uncertain`. Las consultas devuelven datos estructurados. Los errores del transporte también pueden utilizar `isError` y un código. No interpretes una respuesta HTTP 200 como prueba de que una modificación fue aplicada.

- `INVALID_ARGUMENTS`: datos inválidos, tarea no asociada, campo no permitido, fecha o duración incompatible. Corrige la petición.
- `NOT_PERMITTED`: falta una capacidad o el acceso está deshabilitado. No se evita utilizando stdio.
- `STALE_DATA`: cambió el perfil desde `baseRevision`; vuelve a consultar y decide qué conservar.
- `STALE_PLAN`: cambiaron las tareas/configuración, caducó la propuesta o se recargó la aplicación. Prepara otra propuesta y revísala antes de aplicarla.
- `UNSUPPORTED_OPERATION`: el flujo no admite esa tarea o acción; por ejemplo, corrección de una tarea archivada o división de una plantilla recurrente. No se simula éxito.
- `OPERATION_ID_REUSED`: ese ID corresponde a otros parámetros.
- `OUTCOME_UNKNOWN`: no se puede confirmar el resultado durable. Consulta los datos; conserva el mismo `operationId`. No generes uno nuevo para repetir a ciegas.
- `APP_UNAVAILABLE`, archivo inaccesible o error de datos: abre la aplicación o resuelve el fallo. No se sustituye el archivo por una lista vacía para inventar métricas.
- `RESPONSE_TOO_LARGE`: reduce el intervalo consultado o el límite del historial. Una respuesta perdida después de una mutación exige comprobar su resultado.

La reserva de cada operación se guarda antes de ejecutar la modificación. Las acciones consultables son `edit`, `task`, `log_time`, `apply`, `review_advance` y `correct_time`. Los recibos `op-*` quedan separados del perfil; importar un perfil no los borra. Si se pierde la confirmación después de despachar, el recibo pendiente impide repetir automáticamente. No hay una transacción distribuida que abarque tarea, perfil y recibo: se prioriza no duplicar y se informa de la incertidumbre. Los recibos no caducan automáticamente; ocupan almacenamiento adicional. Eliminar todos los datos del plugin elimina también esta protección histórica.

El compare-and-swap comprueba el perfil justo antes de despachar y serializa escritores cooperantes en un renderizador. Las propuestas comprueban además las referencias de estado nativo/configuración y la generación de archivo después de las esperas. Una actualización concurrente puede invalidarlas de forma conservadora. No se promete CAS distribuido entre instalaciones sincronizadas; una réplica remota sigue la resolución nativa del proyecto. No apliques simultáneamente la misma reorganización desde equipos distintos.

Las propuestas viven en memoria durante 15 minutos, con un máximo de 100 pendientes. Reiniciar invalida las no aplicadas; los recibos, la revisión y el historial guardados sobreviven. Un borrador de interfaz no convierte una propuesta caducada en aplicable. Reservar un bloque no completa una tarea, curso ni examen. Los cambios de objetivo/estado y recurrencias futuras conservan sus vigencias anteriores.

## Verificación

La validación de 0.4.0 está conservada en [VALIDACION-LIMITES.md](../packages/plugin-dev/personal-planner/VALIDACION-LIMITES.md). Para 0.5 se ejecutaron 32 pruebas Node del contrato MCP (validación, permisos, recibos y forwarding); son pruebas con respuestas simuladas, no una prueba final de la aplicación ni de todos los clientes. Las nuevas pruebas Angular, interfaz y Electron deben figurar con sus resultados efectivos en la entrega de 0.5. No se hereda automáticamente el resultado previo.

Consulta también [el flujo guiado](planner-guided.md). Las fuentes del contrato son [las herramientas](../electron/mcp/planner-tools.ts), [las operaciones](../packages/personal-planner-core/operations.mjs) y [la revisión compartida](../packages/personal-planner-core/workbench-operations.mjs).

## Datos temporales y privacidad

Los registros se agregan según las reglas comprobadas de padres/subtareas y archivos, sin duplicar IDs. Los objetivos diarios se evalúan por fecha; acumular horas otra fecha no los satisface. Si el día lógico o la zona de registro del anfitrión no coincide con el día civil del perfil, la métrica diaria/semanal se muestra como incompleta y el registro manual incompatible se rechaza. No se adivina una redistribución histórica.

Los perfiles, recibos y registros son datos de usuario, no ejemplos públicos. Las pruebas usan actividades ficticias. Las credenciales quedan fuera del repositorio y los paquetes. El adaptador nunca escribe la clave en stdout ni la incluye en errores de configuración.

Los agregados históricos por día no contienen instantes originales suficientes para reconstruir viajes o cambios anteriores de zona horaria; la coincidencia actual del calendario no demuestra la procedencia de todo el histórico. Se mantiene esta carencia explícita. Las lecturas fallidas del archivo y los datos comprimidos corruptos se propagan como errores; no se presentan como un perfil o un histórico vacío.

Los cambios necesarios en el núcleo son acotados: API genérica de comparación/guardado durable (la API previa no ofrece escritura condicional entre UI y MCP), guardia de generación de archivo para impedir aplicar propuestas contra datos que cambiaron durante una espera, y las rutas/herramientas MCP nativas. El calendario, las métricas y la validación permanecen en el paquete puro compartido; no se añade un modelo paralelo de tareas, un backend ni campos de seguimiento internos.
