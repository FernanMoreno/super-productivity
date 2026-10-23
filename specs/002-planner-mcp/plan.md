# Diseño

Conocimiento: contratos durables se documentan en repositorio; consultar vault registrado SuperPro sin copiar perfiles. Arquitectura significativa, APIs y persistencia: Spec Kit, Graphify, pruebas primero y revisión ECC.

1. MCP nativo de Electron sobre127.0.0.1:3876/mcp. Conservar seis tools y permisos existentes. Añadir tools acotadas del planificador y scopes separados para perfil, histórico, tareas y tiempo. Ruta feature exclusivamente source=mcp; permiso vuelve a comprobarse en app antes de escritura.
2. Extraer núcleo puro MJS a packages/personal-planner-core con declaraciones de tipos para Angular. Plugin reexporta módulos compatibles; renderer importa núcleo real, sin copia de algoritmo.
3. Comparación y escritura genérica de datos propios del plugin en servicio nativo, serializada por clave y durable; exponer compareAndSwapSyncedData en API de plugins. UI confirma revisión, actualiza perfil mediante operación común y recarga ante hook/refresco sin borrar formularios sucios.
4. Propuestas temporales con ID, revisión/huella de datos nativos, selección de bloques y vencimiento; aplicación CAS vuelve a evaluar contexto. No mueve calendario nativo.
5. Recibos por operación persistidos como metadatos del plugin. Reserva durable antes de mutación nativa, resultado durable después; pendiente implica OUTCOME_UNKNOWN en reintento tras caída. No prometer transacción distribuida ni exactamente una vez tras cualquier fallo. Perfil y tareas usan sus servicios nativos.
6. Reutilizar adaptador stdio tools/mcpb; añadir soporte seguro de credencial externa/configuración por cliente y pruebas sin modelos. Documentar requisitos de Electron y ausencia de MCP en web.

Propiedad final: agentes ECC Codex trabajaron en herramientas nativas, clientes/adaptador y ruta renderer con archivos asignados; las primeras porciones se aislaron en worktrees y se integraron por copia revisada. El integrador mantuvo el núcleo/CAS, pruebas reales, empaquetado y publicación; la revisión independiente fue de solo lectura. Se respetaron cambios existentes y no se usaron modelos de otros asistentes.
