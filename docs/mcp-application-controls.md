# Controles de la aplicación mediante MCP

Esta ampliación local añade controles nativos al servidor MCP de Electron. La aplicación debe estar abierta. Utiliza la conexión y credencial existentes; vuelve a conectar el cliente después de actualizar para renovar su catálogo. Los permisos nuevos se conceden en Ajustes → acceso de asistentes y empiezan desactivados en perfiles existentes.

| Herramienta                | Comandos                                                 | Permisos                                                                                     |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `task_manage`              | lectura, metadatos, programación, plazos y ciclo de vida | `tasks:read`; escritura: `tasks:write`; archivo: también `tasks:read_history`                |
| `task_structure`           | subtareas, orden y secciones nativas                     | `tasks:read`; escritura: `tasks:write`; nueva subtarea: también `tasks:capture`              |
| `task_attachment`          | `read`, `add`, `update`, `remove`                        | `tasks:read`; escritura: `tasks:write` + `tasks:write_notes`; leer notas: `tasks:read_notes` |
| `task_repeat`              | `read`, `read_template`, `set`, `remove`                 | `tasks:read`; escritura: `tasks:write`; notas: permisos independientes                       |
| `task_timer`               | `status`, `start`, `pause`, `stop`                       | `tasks:read`; escrituras: `timer:write`                                                      |
| `task_time`                | `add`, `set`                                             | `tasks:read` + `time:write`                                                                  |
| `task_notes`               | `read`, `write`                                          | `tasks:read`; lectura: `tasks:read_notes`; escritura: `tasks:write_notes`                    |
| `project_manage`           | `create`, `update`, `archive`, `reopen`                  | `tasks:read` + `projects:write`                                                              |
| `tag_manage`               | `create`, `update`, `delete`                             | `tasks:read` + `tags:write`                                                                  |
| `idle_review`              | `status`, `discard`, `track_break`, `track_task`         | `idle:read`; resolver: `idle:write` + `time:write`; tarea: también `tasks:read`              |
| `app_settings`             | `read`, `update`                                         | `settings:read`; actualizar: también `settings:write`; plantilla de notas: permisos de notas |
| `app_sync`                 | `status`, `run`                                          | `sync:read`; ejecutar: también `sync:write`                                                  |
| `app_update`               | `status`, `check`, `install`                             | `updates:read`; comprobar/instalar: también `updates:write`                                  |
| `control_operation_status` | `status`                                                 | `tasks:read` y todos los permisos de la operación original                                   |

Las escrituras requieren un `operationId` estable de 8–80 letras, números, guiones o guiones bajos. Reutiliza el mismo identificador solo para la misma petición. El registro local evita repetir una operación confirmada incluso tras reiniciar la aplicación. Un resultado `OUTCOME_UNKNOWN` o pendiente exige inspeccionar el estado: no se vuelve a ejecutar y no debe sortearse usando un identificador nuevo.

## Repetición de tareas

`task_repeat.read` recibe `taskId` y devuelve `schedule`, `repeatCfgId` y `revision` (`null` si todavía no hay repetición), junto a la fecha de la ocurrencia actual. No devuelve notas. Para crear o cambiar la serie usa `set` con `taskId`, `cycle` (`daily`, `weekly`, `monthly`, `yearly`), `startDay` (`YYYY-MM-DD`), `expectedRevision` copiado de la lectura y `operationId`. `every` admite 1–99 y vale 1 si se omite. `weekdays` admite días distintos `mon`…`sun` solo en ciclos semanales; si se omite se utiliza el día de la semana del comienzo.

Ejemplo: `{"command":"set","taskId":"ID_REAL","cycle":"weekly","every":1,"weekdays":["wed","fri"],"startDay":"2026-10-28","expectedRevision":null,"operationId":"english-repeat-20261028"}`. Después vuelve a leer para obtener la revisión vigente.

La configuración pertenece a la serie nativa: cambiar su calendario puede recolocar su última ocurrencia pendiente, igual que la interfaz. Conserva el historial completado y las opciones omitidas. No permite repetición independiente de subtareas. La lectura requiere `tasks:read`; escribir también `tasks:write`.

`set` admite además `startTime` (`HH:mm`), `reminder` (identificador nativo), `repeatUntilDay` (último día inclusive), `paused`, `skipOverdue`, `repeatFromCompletionDate`, `waitForCompletion`, `monthlyWeekOfMonth` + `monthlyWeekday`, `monthlyLastDay` y `deletedInstanceDates`. `null` borra hora, recordatorio, fin, anclajes o excepciones opcionales. Las excepciones afectan a la generación; no borran ocurrencias ya creadas. Cambiar de ciclo elimina anclajes incompatibles; omitirlos al mantener un ciclo mensual conserva el anclaje existente.

`template` modifica explícitamente los valores de futuras ocurrencias: `title`, `timeEstimate`, `priority`, `tagIds`, `notes`, `shouldInheritSubtasks`, `disableAutoUpdateSubtasks` y `subTaskTemplates` (`title`, `timeEstimate`, `notes`). `read` devuelve una revisión opaca y metadatos sin notas; `read_template` también devuelve notas y exige `tasks:read_notes`. Escribir notas o reemplazar plantillas de subtareas exige `tasks:write_notes`. Crear una serie sigue heredando los valores de su tarea como en la interfaz.

Al editar la hora de una serie existente, `applyTo:"future"` es el valor predeterminado; `applyTo:"current"` actualiza también la hora de la ocurrencia identificada sin cambiar su día lógico ni estimación. Crear una serie puede reprogramar su primera ocurrencia por el comportamiento nativo. El fin no elimina tareas históricas ni pendientes ya creadas. `remove` recibe `taskId`, `expectedRevision` y `operationId`: elimina la repetición y conserva las tareas.

## Edición completa de tareas

`task_manage.read` recibe `taskId` y devuelve campos seguros y `revision`. Sin identificador lista tareas con `limit` (1–200), `offset` y `nextOffset`; `location:"archive"` descubre el archivo con permiso de historial. Toda escritura requiere `taskId`, `expectedRevision` copiado de la lectura y `operationId`. Lee nuevamente tras cada cambio.

- `update`: `fields` admite `title` literal, `timeEstimate` en milisegundos, prioridad nativa `1`, `2`, `3` o `null`, `created` y `doneOn` en Unix ms. Las estimaciones padre se derivan de sus hijos; `doneOn` solo corresponde a tareas terminadas. La prioridad del tablero es independiente.
- `complete`, `reopen`, `wont_do`: utilizan el ciclo de vida nativo. Cambiar la fecha de finalización conserva la marca de «no se hará» cuando corresponda.
- `schedule`, `deadline`: exactamente uno de `day` (`YYYY-MM-DD`) o `at` (Unix ms); `remindAt` opcional, `null` lo borra. Horario programado y fecha límite son independientes. `unschedule` y `clear_deadline` borran cada uno por separado.
- `move_project` recibe `projectId` y mueve esta tarea y sus hijos; no modifica la serie. `set_tags` recibe `tagIds` de etiquetas ordinarias existentes.
- `duplicate` copia una tarea principal pendiente y sus hijos, respetando títulos literales. Requiere también `tasks:capture`, `tasks:read_notes` y `tasks:write_notes`; no copia tiempo trabajado, repetición, adjuntos ni plazos.
- `archive` y `restore` conservan el árbol nativo. Para modificar o borrar una tarea archivada, restáurala primero: así se utilizan las mismas transiciones y protección de concurrencia de las tareas activas.
- `delete` requiere además `confirm:true`; elimina la tarea y sus hijos por la vía nativa, sin abrir una confirmación en pantalla.

`task_structure` permite añadir una sola subtarea con `add_subtask` (`taskId` del padre, `title` literal), moverla con `reparent` (`parentId`, `afterTaskId`), separarla con `detach`, ordenar con `reorder` y asignar o quitar una sección con `set_section`. No admite ciclos ni subtareas anidadas. El orden utiliza un ancla explícita (`afterTaskId`, `null` para el principio) y un contexto, nunca la pantalla activa. Las listas `UNDONE`, `DONE`, `BACKLOG` conservan su semántica nativa; mover al listado regular no equivale a programar para Hoy. Las secciones nativas son distintas de las columnas del tablero.

`task_structure.read` devuelve la revisión, hermanos, contextos, listas y secciones disponibles. `contextType` es `PROJECT` o `TAG`; `contextId` identifica el proyecto o etiqueta. Las secciones siguen los contextos admitidos por la aplicación (proyectos y Hoy). Reordenar una lista no completa ni reabre tareas: utiliza los comandos de ciclo de vida para ello.

`task_attachment` lee y modifica referencias `FILE`, `LINK`, `IMG`, `COMMAND` y `NOTE`. `add` recibe `attachment` con `type` y `path`; `update` recibe `attachmentId` y campos parciales; `remove` recibe `attachmentId`. Las lecturas omiten `NOTE` salvo `includeNotes:true` con permiso de notas. No abre, descarga, sube ni ejecuta el destino; tampoco borra archivos físicos.

## Tareas y tiempo

`task_timer.start` recibe `taskId`; puede reabrir o programar la tarea y seleccionar una subtarea, igual que la interfaz. `pause` y `stop` paran la medición sin borrar tiempo. `expectedCurrentTaskId` permite rechazar un cambio si otra tarea empezó entretanto. Iniciar rechaza si la medición está desactivada.

`task_time` recibe `taskId`, `date` (`YYYY-MM-DD`) y `duration` en milisegundos. `add` suma; `set` reemplaza el total de ese día y admite cero. No se aceptan fechas futuras ni tiempo propio en tareas padre con subtareas. Cada total diario está limitado a 24 horas; `expectedDuration` protege frente a cambios desde la lectura anterior. Estas herramientas generales no necesitan vincular una actividad del planificador.

`task_notes.write` reemplaza las notas y admite `expectedNotes`. Las notas están limitadas a 8192 caracteres por petición; la lectura informa `truncated` si hay más. No utiliza silenciosamente una nota truncada como expectativa completa.

Proyectos y etiquetas reciben `fields` con `title`, `icon` o `color`; actualizar, archivar, reabrir y eliminar reciben `id`. No se pueden modificar estructuras internas ni eliminar las etiquetas del sistema. Archivar conserva el proyecto y sus tareas; no se expone eliminación destructiva de proyectos.

## Inactividad

Consulta `idle_review.status` y utiliza su `reviewId` y `idleTime` como `expectedIdleTime` al resolver. El periodo debe estar detenido para revisión. MCP cierra el diálogo real por su vía nativa; no despacha un resultado paralelo que pueda registrarse otra vez desde la ventana. `track_task` añade `taskId` y reanuda esa tarea según el comportamiento nativo. `discard` conserva la confirmación de contadores que corresponda: `pendingCounterConfirmation` informa si queda una decisión en la interfaz.

## Ajustes, sincronización y actualización

`app_settings.read` devuelve las preferencias integradas admitidas de `appFeatures`, `localization`, `misc`, `tasks`, `shortSyntax`, `evaluation`, `idle`, `takeABreak`, `pomodoro`, `flowtime`, `keyboard`, `localBackup`, `sound`, `timeTracking`, `reminder`, `schedule` y `focusMode`. Puede limitarse por `section`; sin sección devuelve el catálogo completo. `taskWidget` y `focusModeLocal` se guardan solo en este dispositivo.

Lee primero el ajuste y copia su valor actual en `expected`; después envía el nuevo valor en `changes`. Ambos objetos deben contener exactamente las mismas claves. Los cambios compartidos pasan por la configuración nativa; el MCP rechaza escrituras obsoletas, claves desconocidas y actualizaciones parciales con valores incorrectos.

Los tiempos de horario usan `H:mm` o `HH:mm`; las duraciones y las reglas de Flowtime usan milisegundos. Los volúmenes de sonido admiten enteros de 0 a 100; el porcentaje de descanso Flowtime, de 1 a 100; la opacidad del widget, de 10 a 100. El primer día de la semana admite 0–6; la hora del aviso de fecha límite, 0–23. Los sonidos, idiomas, formato de fecha, recordatorios, modo Flowtime y preset de prioridad se limitan a las opciones de la interfaz. Las teclas rápidas integradas admiten texto o `null` para quitarlas. `minIdleTime` admite 60 000–86 400 000 ms; el máximo de copias locales usa el rango de la configuración nativa.

`tasks.notesTemplate` se omite por defecto. Añade `includeNotesTemplate: true` a una lectura de todos los ajustes o de `tasks` para incluirlo; esa lectura requiere `tasks:read_notes`. Modificarlo requiere `tasks:read_notes` y `tasks:write_notes`. Sin permiso de lectura, el MCP omite su contenido incluso en las respuestas a otros cambios de ajustes.

No devuelve ni modifica claves de acceso, contraseñas, proveedores de sincronización, cifrado, permisos MCP, ajustes de plugins, rutas/imagenes, CSS o temas personalizados, referencias a proyectos/páginas ni teclas rápidas de plugins.

`app_sync.run` solicita una sincronización normal del proveedor ya configurado. Devuelve estados como `disabled`, `not_ready`, `busy`, `completed`, `handled_error` o `attention_required`. No configura credenciales ni fuerza una sustitución de datos remotos/locales.

`app_update.check` devuelve el resultado real de la consulta nativa: `available`, `up_to_date`, `busy`, `error` o `unsupported`, con versión/enlace cuando procede. **Esta compilación no tiene instalador automático**: `install` devuelve explícitamente `unsupported`. No descarga ni ejecuta un instalador arbitrario ni sustituye automáticamente este fork.

## Verificación de desarrollo

Contratos y transporte: `npm run test:electron`. Operaciones y registro: `node --test src/app/features/assistant-control/*.cjs src/app/core/update-check/update-check.node.test.cjs`. La prueba `e2e/electron/assistant-controls-smoke.cjs` utiliza la aplicación empaquetada con un perfil vacío y entidades ficticias; ejercita descubrimiento HTTP/stdio, servicios nativos, resolución de inactividad y repetición tras reinicio. Consulta los resultados reales en `specs/007-mcp-controls/validation.md`.
