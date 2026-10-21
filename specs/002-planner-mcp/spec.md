# Planificador configurable por MCP

Extensión de la adaptación 0.2.0 sobre Super Productivity19.2.0, commit6e402be. El usuario solicita usar interfaz y asistentes diferentes sobre los mismos datos, con permisos efectivos, revisión de reorganizaciones, vigencia e idempotencia. Solo Codex/ECC ejecuta trabajo; las pruebas de clientes no delegan razonamiento a otros modelos.

## Requisitos

- Reutilizar MCP Electron nativo, credencial independiente de REST y permisos locales desactivados inicialmente. No crear servidor de datos paralelo ni exponer blobs arbitrarios.
- Compartir modelo, validación, métricas, horario y operaciones entre plugin y renderer nativo. Persistir solo perfil y metadatos de operaciones; tareas/tiempos permanecen nativos.
- Consultar perfil, intervalos, progreso, conflictos/carga; gestionar actividades/objetivos/compromisos por identificador y fecha efectiva; crear/actualizar tareas y registrar tiempo mediante servicios soportados.
- Preparar reorganización sin modificar compromisos, devolver diferencias y motivos; aplicar selección explícita tras verificar huella de perfil y tareas. Rechazar propuesta obsoleta, sin cambiar silenciosamente la distribución.
- Serializar mutaciones locales y usar comparación de revisión también en interfaz, importación y MCP. Reintentos con operationId no duplican mutaciones; contenido distinto con mismo ID se rechaza. Un recibo pendiente tras caída produce resultado incierto y nunca reejecución automática.
- Diferenciar aplicado, rechazado, conflicto e incierto. Esperar flush durable. Revalidar permisos antes de mutar; una revocación posterior no debe ocultar resultado aplicado e invitar duplicado.
- Usar adaptador stdio existente para Desktop; configuraciones de HTTP/stdio con secretos externos para Codex, Claude Code, OpenCode y Desktop. Clientes y SDK comprobados se distinguen de configuración documental.

## Aceptación

Descubrimiento limitado a permisos; lectura actual; cambios MCP visibles en panel y manuales en siguiente consulta; rechazo sin permiso; reintento protegido; stale proposal; historial al editar futuras; desconexión comprensible; perfiles ficticios distintos. Integración real Electron/IPC/MCP/IndexedDB y transporte SDK/CLI donde sea viable. El servidor debe requerir app abierta, manteniendo loopback y credenciales fuera de código/logs.
