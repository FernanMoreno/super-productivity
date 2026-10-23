# Datos y límites

El perfil del plugin conserva schemaVersion 2 y añade preferencias opcionales con defaults. Tareas/proyectos/etiquetas/tiempo permanecen en modelos nativos; no hay modelo paralelo de registros.

Workbench: clave propia con versión, sesiones de revisión identificadas y fechadas, decisiones por IDs estables, estado manual de pausa/bloqueo por tarea y baseline semanal. Primera observación no acredita plan histórico anterior: previsto desconocido se distingue de cero. Baselines son duraciones diarias y procedencia, nunca instantes inventados. Aplazamientos solo los observados desde esta funcionalidad.

Reorganización: registro durable por operationId con selección, razones, estado y deltas de planificación antes/después. Guardar antes de despachar y confirmar después de flush; fallo intermedio conserva incertidumbre. Campo-grupo nativo: dueDay/dueWithTime/remindAt, no tiempo/completitud/título. Los bloques creados se eliminan solo si siguen iguales; un bloque editado posteriormente provoca conflicto. Undo es otra propuesta y aplicación seleccionada, no rollback global. La comparación protege valores actuales, no detecta historia ABA inexistente.

Calendario: proyección de caché nativa filtrada, sin copiar eventos a compromisos ni iniciar HTTP adicional. Identidad provider/event/legacyIds y vínculos nativos. Cobertura/actualización no certificadas se informan como provisional. La huella de caché/exclusiones se comprueba al despachar.

Recibos de operaciones siguen protegiendo reintentos. Estados: applied/rejected/conflict/uncertain; reserva pendiente no autoriza repetir. Datos privados y claves fuera de los ejemplos/paquetes.
