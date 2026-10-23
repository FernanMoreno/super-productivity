# Controles de la aplicación mediante MCP

Esta ampliación local añade diez herramientas al servidor MCP de Electron. La aplicación debe estar abierta. Utiliza la conexión y credencial existentes; vuelve a conectar el cliente después de actualizar para renovar su catálogo. Los permisos nuevos se conceden en Ajustes → acceso de asistentes y empiezan desactivados en perfiles existentes.

| Herramienta                | Comandos                                         | Permisos                                                                        |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `task_timer`               | `status`, `start`, `pause`, `stop`               | `tasks:read`; escrituras: `timer:write`                                         |
| `task_time`                | `add`, `set`                                     | `tasks:read` + `time:write`                                                     |
| `task_notes`               | `read`, `write`                                  | `tasks:read`; lectura: `tasks:read_notes`; escritura: `tasks:write_notes`       |
| `project_manage`           | `create`, `update`, `archive`, `reopen`          | `tasks:read` + `projects:write`                                                 |
| `tag_manage`               | `create`, `update`, `delete`                     | `tasks:read` + `tags:write`                                                     |
| `idle_review`              | `status`, `discard`, `track_break`, `track_task` | `idle:read`; resolver: `idle:write` + `time:write`; tarea: también `tasks:read` |
| `app_settings`             | `read`, `update`                                 | `settings:read`; actualizar: también `settings:write`                           |
| `app_sync`                 | `status`, `run`                                  | `sync:read`; ejecutar: también `sync:write`                                     |
| `app_update`               | `status`, `check`, `install`                     | `updates:read`; comprobar/instalar: también `updates:write`                     |
| `control_operation_status` | `status`                                         | `tasks:read` y todos los permisos de la operación original                      |

Las escrituras requieren un `operationId` estable de 8–80 letras, números, guiones o guiones bajos. Reutiliza el mismo identificador solo para la misma petición. El registro local evita repetir una operación confirmada incluso tras reiniciar la aplicación. Un resultado `OUTCOME_UNKNOWN` o pendiente exige inspeccionar el estado: no se vuelve a ejecutar y no debe sortearse usando un identificador nuevo.

## Tareas y tiempo

`task_timer.start` recibe `taskId`; puede reabrir o programar la tarea y seleccionar una subtarea, igual que la interfaz. `pause` y `stop` paran la medición sin borrar tiempo. `expectedCurrentTaskId` permite rechazar un cambio si otra tarea empezó entretanto. Iniciar rechaza si la medición está desactivada.

`task_time` recibe `taskId`, `date` (`YYYY-MM-DD`) y `duration` en milisegundos. `add` suma; `set` reemplaza el total de ese día y admite cero. No se aceptan fechas futuras ni tiempo propio en tareas padre con subtareas. Cada total diario está limitado a 24 horas; `expectedDuration` protege frente a cambios desde la lectura anterior. Estas herramientas generales no necesitan vincular una actividad del planificador.

`task_notes.write` reemplaza las notas y admite `expectedNotes`. Las notas están limitadas a 8192 caracteres por petición; la lectura informa `truncated` si hay más. No utiliza silenciosamente una nota truncada como expectativa completa.

Proyectos y etiquetas reciben `fields` con `title`, `icon` o `color`; actualizar, archivar, reabrir y eliminar reciben `id`. No se pueden modificar estructuras internas ni eliminar las etiquetas del sistema. Archivar conserva el proyecto y sus tareas; no se expone eliminación destructiva de proyectos.

## Inactividad

Consulta `idle_review.status` y utiliza su `reviewId` y `idleTime` como `expectedIdleTime` al resolver. El periodo debe estar detenido para revisión. MCP cierra el diálogo real por su vía nativa; no despacha un resultado paralelo que pueda registrarse otra vez desde la ventana. `track_task` añade `taskId` y reanuda esa tarea según el comportamiento nativo. `discard` conserva la confirmación de contadores que corresponda: `pendingCounterConfirmation` informa si queda una decisión en la interfaz.

## Ajustes, sincronización y actualización

`app_settings.read` devuelve exclusivamente las preferencias admitidas de `misc`, `tasks`, `timeTracking` e `idle`. Puede limitarse por `section`. `update` requiere `section`, `changes` y `expected` con exactamente las mismas claves; utiliza los valores leídos y `null` si el campo no existía. `minIdleTime` admite 60 000–86 400 000 ms. No devuelve ni modifica claves de acceso, contraseñas, proveedores o cifrado.

`app_sync.run` solicita una sincronización normal del proveedor ya configurado. Devuelve estados como `disabled`, `not_ready`, `busy`, `completed`, `handled_error` o `attention_required`. No configura credenciales ni fuerza una sustitución de datos remotos/locales.

`app_update.check` devuelve el resultado real de la consulta nativa: `available`, `up_to_date`, `busy`, `error` o `unsupported`, con versión/enlace cuando procede. **Esta compilación no tiene instalador automático**: `install` devuelve explícitamente `unsupported`. No descarga ni ejecuta un instalador arbitrario ni sustituye automáticamente este fork.

## Verificación de desarrollo

Contratos y transporte: `npm run test:electron`. Operaciones y registro: `node --test src/app/features/assistant-control/*.cjs src/app/core/update-check/update-check.node.test.cjs`. La prueba `e2e/electron/assistant-controls-smoke.cjs` utiliza la aplicación empaquetada con un perfil vacío y entidades ficticias; ejercita descubrimiento HTTP/stdio, servicios nativos, resolución de inactividad y repetición tras reinicio. Consulta los resultados reales en `specs/007-mcp-controls/validation.md`.
