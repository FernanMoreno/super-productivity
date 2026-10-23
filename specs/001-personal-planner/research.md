# Investigación

Decisión: plugin iframe; la API actual ofrece tareas activas/archivadas, proyectos, etiquetas, selección de tareas y persistencia de usuario. El iframe requiere recursos inline porque se sirve mediante srcdoc.
Alternativas: modificación Angular nativa aumenta superficie compartida sin necesidad demostrada; aplicación externa pierde integración solicitada. Se elige plugin sin cambios del núcleo.
Fuente: docs/plugin-development.md y packages/plugin-api/src/types.ts del checkout. El mapper conserva campos internos de lectura; tiempos en milisegundos. Se verificará semántica de agregación directamente en reducers y utilidades.

## Prior art (documentación de proveedores, octubre de 2026)

| Aplicación                                                                                                          | Idea relevante                     | Decisión                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Microsoft To Do](https://support.microsoft.com/en-US/ToDo/my-day-and-suggestions)                                  | Mi día y sugerencias revisables    | Adoptar consulta diaria y propuestas; no mover tareas automáticamente.                                           |
| [Todoist](https://lp-regional-test.todoist.com/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9) | Objetivos diarios editables        | Adoptar objetivos configurables por fecha; no adoptar rachas, puntuaciones ni equivalencia entre tareas y horas. |
| [TickTick](https://help.ticktick.com/articles/7055782166172532736)                                                  | Consulta de calendario y objetivos | Adoptar lectura semanal de bloques; no introducir suscripciones, backend ni integración de calendarios externa.  |

La demanda proviene del usuario de este fork. No se propone añadir este panel al producto original. Se conserva el planificador nativo y se acota la nueva persistencia al plugin.

## Hallazgo de persistencia en aplicación real

Regresión reproducida dos veces con datos ficticios: crear actividad y guardar objetivo, recibir confirmación, recargar inmediatamente, perder la segunda edición. Fuente: bridge sin await y servicio devuelve Promise.resolve para cola de 1 s; load lee esa cola, por lo que no certifica durabilidad. ECC verificó también el contador de captura: flush drena fallos; debe comprobarse hasUnrecoveredPersistFailure. Corrección mínima de núcleo necesaria; no modifica protocolo de sync ni agrega otra fuente de verdad.
