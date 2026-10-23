# MCP del planificador configurable

Esta adaptación amplía el servidor MCP nativo de Electron. No añade backend ni copia las tareas a otra base de datos. El panel y el servidor importan `packages/personal-planner-core`: modelos, validación de perfiles, calendario, métricas y operaciones. La persistencia adicional utiliza `pluginUserData` y el historial/sincronización existentes. Las tareas y el tiempo se modifican mediante los servicios nativos.

## Compatibilidad

La base inspeccionada es `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`, con número de aplicación 19.2.0. La etiqueta publicada `v19.2.0` no incluye `electron/mcp/mcp-tools.ts`; el número de versión no basta. Instala una compilación de este fork con estos cambios, además del plugin actualizado. El ZIP del plugin por sí solo no añade el servidor a una aplicación publicada.

REST y MCP comparten listener local pero tienen interruptores y claves independientes. REST no permite llamar a `/assistant/planner`; esta ruta interna exige procedencia MCP añadida por el proceso principal. La interfaz web no contiene dicho listener. No se admite acceso remoto en esta versión.

Consulta [conexiones y adaptador stdio](planner-mcp-clients.md) para Codex, Claude Code, OpenCode y Claude Desktop. El servicio debe estar habilitado en la aplicación y esta debe permanecer abierta. Sus permisos se comprueban al descubrir herramientas, antes de ejecutar y antes de guardar. Una petición ya despachada puede terminar aunque se revoque la clave mientras llega su respuesta.

## Herramientas

Todas las entradas son objetos JSON. Las fechas son días civiles `YYYY-MM-DD` del perfil; las duraciones nativas están en milisegundos. Los identificadores no dependen del nombre de una actividad. No se aceptan notas ni campos internos de seguimiento.

| Herramienta          | Parámetros                                                  | Permisos                                           | Resultado y efecto                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planner_activities` | Ninguno                                                     | `planner:read`                                     | Perfil configurable y `revision`. Sin tareas ni notas.                                                                                                                                                   |
| `planner_query`      | `from`, `to`                                                | `planner:read`, `tasks:read`, `tasks:read_history` | De 1 a 93 días incluidos: capacidad laboral/personal, conflictos, carga, tareas previstas, progreso y advertencias. Incluye archivo. No modifica datos.                                                  |
| `planner_edit`       | `operationId`, `baseRevision`, `command: {type,payload}`    | `planner:read`, `planner:write`                    | Valida un cambio de configuración contra la revisión leída. Conserva vigencias mediante los comandos fechados.                                                                                           |
| `planner_task`       | `operationId`, `taskId` opcional, `fields`                  | `tasks:read`, `tasks:write`                        | Sin `taskId`, crea una tarea; con él, actualiza una tarea activa. Campos: `title`, `isDone`, `timeEstimate`, `projectId`, `tagIds`, `dueDay` (fecha o null), `dueWithTime` (milisegundos Unix o null); alcance recurrente opcional `moveScope` fuera de `fields`. No analiza sintaxis de hashtags del título. |
| `planner_log_time`   | `operationId`, `activityId`, `taskId`, `date`, `durationMs` | Los tres permisos de consulta y `time:write`       | Añade tiempo a una tarea nativa asociada a la actividad. Solo tareas hoja activas, fechas compatibles y duración válida; utiliza el seguimiento nativo y confirma persistencia.                          |
| `planner_prepare`    | `from`, `to`                                                | Los tres permisos de consulta                      | Devuelve `proposalId`, caducidad, bloques identificados, motivos y conflictos pendientes. No guarda bloques ni mueve tareas.                                                                             |
| `planner_apply`      | `operationId`, `proposalId`, `selection` (IDs de bloques)   | Los tres permisos de consulta y `planner:write`    | Guarda exclusivamente los bloques seleccionados, tras revisar que las dependencias siguen vigentes. Para tareas nativas requiere además `tasks:write` y utiliza su programación nativa.                  |

| `planner_operation_status` | `action`, `operationId` | `planner:read` y permisos de la acción original | Consulta el recibo durable sin repetir la modificación; devuelve estado o error estructurado. |

Los permisos nuevos empiezan desactivados. Las herramientas originales siguen disponibles según sus permisos: `get_status`, `list_tasks`, `get_task`, `list_projects`, `list_tags`, `create_task`. Esta última es captura en Inbox y **no** ofrece la protección de `operationId` de `planner_task`; utiliza la herramienta nueva para reintentos protegidos. `tasks:read_notes` sigue siendo independiente.

`operationId` debe contener entre 8 y 80 letras ASCII, números, `_` o `-`. Debe mantenerse al repetir exactamente la misma petición. Los IDs de entidades admiten entre 1 y 200 de esos caracteres. No reutilices un ID de operación con otros parámetros.

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
| `preferences.update`  | `timezone` y/o `weekStartsOn` (0 domingo, 1 lunes, …).                                                                                                                                                                                      |
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
- `OPERATION_ID_REUSED`: ese ID corresponde a otros parámetros.
- `OUTCOME_UNKNOWN`: no se puede confirmar el resultado durable. Consulta los datos; conserva el mismo `operationId`. No generes uno nuevo para repetir a ciegas.
- `APP_UNAVAILABLE`, archivo inaccesible o error de datos: abre la aplicación o resuelve el fallo. No se sustituye el archivo por una lista vacía para inventar métricas.
- `RESPONSE_TOO_LARGE`: reduce el intervalo consultado. Una respuesta perdida después de una mutación exige comprobar su resultado.

La reserva de cada operación se guarda antes de ejecutar la modificación. Los recibos `op-*` quedan separados del perfil; importar un perfil no los borra. Si se pierde la confirmación después de despachar, el recibo pendiente impide repetir automáticamente. No hay una transacción distribuida que abarque tarea, perfil y recibo: se prioriza no duplicar y se informa de la incertidumbre. Los recibos no caducan automáticamente; ocupan almacenamiento adicional. Eliminar todos los datos del plugin elimina también esta protección histórica.

El compare-and-swap comprueba el perfil justo antes de despachar y serializa escritores cooperantes en un renderizador. Las propuestas comprueban además las referencias de estado nativo/configuración y la generación de archivo después de las esperas. Una actualización concurrente puede invalidarlas de forma conservadora. No se promete CAS distribuido entre instalaciones sincronizadas; una réplica remota sigue la resolución nativa del proyecto. No apliques simultáneamente la misma reorganización desde equipos distintos.

Las propuestas viven en memoria durante 15 minutos, con un máximo de 100 pendientes. Reiniciar invalida las no aplicadas; los recibos ya guardados sobreviven. Reservar un bloque no completa una tarea, curso ni examen. Los cambios de objetivo/estado y recurrencias futuras conservan sus vigencias anteriores.

## Datos temporales y privacidad

Los registros se agregan según las reglas comprobadas de padres/subtareas y archivos, sin duplicar IDs. Los objetivos diarios se evalúan por fecha; acumular horas otra fecha no los satisface. Si el día lógico o la zona de registro del anfitrión no coincide con el día civil del perfil, la métrica diaria/semanal se muestra como incompleta y el registro manual incompatible se rechaza. No se adivina una redistribución histórica.

Los perfiles, recibos y registros son datos de usuario, no ejemplos públicos. Las pruebas usan actividades ficticias. Las credenciales quedan fuera del repositorio y los paquetes. El adaptador nunca escribe la clave en stdout ni la incluye en errores de configuración.

Los agregados históricos por día no contienen instantes originales suficientes para reconstruir viajes o cambios anteriores de zona horaria; la coincidencia actual del calendario no demuestra la procedencia de todo el histórico. Se mantiene esta carencia explícita. Las lecturas fallidas del archivo y los datos comprimidos corruptos se propagan como errores; no se presentan como un perfil o un histórico vacío.

Los cambios necesarios en el núcleo son acotados: API genérica de comparación/guardado durable (la API previa no ofrece escritura condicional entre UI y MCP), guardia de generación de archivo para impedir aplicar propuestas contra datos que cambiaron durante una espera, y las rutas/herramientas MCP nativas. El calendario, las métricas y la validación permanecen en el paquete puro compartido; no se añade un modelo paralelo de tareas, un backend ni campos de seguimiento internos.
