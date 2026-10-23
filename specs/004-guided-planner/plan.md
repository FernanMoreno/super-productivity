# Plan técnico

Clasificación significativa. Spec Kit, Graphify previo contrastado con fuente, TDD de comportamiento, pruebas contractuales/integradas, composición y revisión ECC antes de entregar. Constitución de Spec Kit aún contiene plantilla, no reglas ratificadas; prevalecen AGENTS y AI_WORKFLOW. Vault de entorno no coincide con registro: no acceder, conclusiones durables en documentos locales.

## Arquitectura

Motor puro packages/personal-planner-core con módulos pequeños de revisión/siguientes acciones y reorganización. Operaciones comparten lectura/guardado/journal existentes. El anfitrión PlannerOperationsService enrutará ambos consumidores, puertos nativos invocarán servicios actuales para tareas y tiempo. MCP expone esquemas y permisos, sin otra API de modelos. UI iframe amplía formularios y traducción del host.

## Etapas y propiedad

1 Inspección y tabla de reutilización; rama local y especificación.
2 Perfil/preferencias y capacidad/calendarios externos, sin otra fuente de verdad nativa.
3 Revisión retomable/tabla semanal y siguiente acción pura; UI con formularios y explicaciones.
4 Propuesta ajustable y undo por campos con histórico durable; revisión de conflictos y guardas.
5 Wiring host/MCP compartido y permisos/recibos.
6 Pruebas proporcionales, app real aislada, clientes disponibles, build y paquetes locales, README/recuperación.

Agentes ECC Codex con archivos exclusivos; no agentes Claude, inferencia externa ni publicación. Dependencias y builds existentes; Angular serial, no reinstalar raíz ni tocar instancia del usuario. Contratos y fixtures sintéticos antes de implementar; red/green para riesgos de tiempo, concurrencia, permisos y undo.

## Validación

Pruebas core/plugin/MCP/native, checkFile de TS modificados en una invocación, typecheck API cuando aplique, build consumidor, browser fixtures y Electron real/IndexedDB/MCP. Check arquitectura plugin/ciclos, composición registrada, diff final y revisión independiente. Repetir solo alcance afectado; informar límites y no atribuir pruebas previas al código nuevo.
