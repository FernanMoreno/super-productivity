# Modelo de datos v2

El perfil es configuración de usuario, separado de las entidades nativas. `schemaVersion: 2`, zona IANA y primer día de semana configurables; inicio vacío y demostración ficticia opcional. La clave persistente sigue siendo `profile-v1` para conservar instalaciones previas.

Actividades: identificador estable, nombre, presentación, orden, prioridad, jerarquía sin ciclos, asociaciones por identificadores de proyectos/etiquetas, ámbito laboral/personal, vigencias, estimación, fecha prevista/límite y restricciones horarias. Objetivos diarios/semanales/totales, estado activo/pausado/archivado y progreso manual tienen revisiones efectivas desde una fecha. Las asociaciones actuales reclasifican el histórico; no se versionan.

Compromisos: bloques puntuales o semanales con vigencia inclusiva, exclusiones por fecha, ámbito, tipo y duración/ventana flexible. Una ocurrencia editada excluye el inicio original y crea reemplazo puntual. Una edición futura termina la serie anterior y crea sucesora conservando identificador de serie. Reservas aceptadas identifican la actividad o el bloque flexible de origen para evitar demanda duplicada.

Entregas/hitos, exclusiones de formación y datos pendientes de descanso/márgenes completan el perfil. Los registros de tiempo y las tareas nunca se copian a esta configuración: se consultan por API, se deduplican por ID y se agregan hojas con herencia de asociaciones.

Validación en carga/importación y antes de persistir: tipos, fechas/horas, rangos, referencias e identificadores únicos. Migración v1→v2 preserva IDs y datos; versiones desconocidas se rechazan. La migración no escribe hasta guardar. El formulario y el perfil anterior se conservan ante error.

## Corrección mínima del anfitrión

La prueba real detectó confirmación prematura: el puente ignoraba la promesa y las escrituras coalescidas resolvían estando solo en memoria. Se mantiene el mismo modelo, acciones, límite y coalescencia. El servicio confirma tras despacho, rechaza cancelaciones, y el puente espera la escritura durable del op-log y comprueba errores persistentes. No cambia el esquema ni el protocolo de sincronización.
