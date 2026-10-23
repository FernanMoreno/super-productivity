# Plan técnico

Clasificación: significativa, incluye diagnóstico de fallos. Secuencia: especificación, plan, tareas, Graphify, inspección de fuente, reproducción, pruebas y cambios acotados.

Se reutiliza el prior art de specs/001-personal-planner/research.md: propuestas revisables, objetivos configurables y calendario existente. La demanda es explícita; no se añade otro calendario ni backend.

Agentes ECC exclusivamente Codex: arquitectura y edición nativa; recuperación e integridad; clientes administrativos sin inferencia; construcción y distribución; diagnóstico CalDAV. El integrador mantiene contratos comunes, interfaz, documentación y pruebas de composición. Cada agente recibe archivos exclusivos antes de editar.

La capa pura compartida sigue siendo packages/personal-planner-core. Las escrituras nativas pasan por servicios de tareas y persistencia; Electron verifica permisos. El plugin conserva únicamente configuración adicional. La construcción Windows y Linux usa dependencias existentes y staging reproducible para evitar omisiones con node_modules enlazado.

Conocimiento: el vault configurado por entorno no coincide con el registro de este proyecto. No escribir allí; los contratos y decisiones de este trabajo quedan en el repositorio, sin información personal.

Pruebas primero para regresiones y operaciones nuevas. Las suites Angular se ejecutan en serie para evitar presión de memoria y desconexiones. Se prueban perfiles ficticios aislados; no se reinicia ni modifica la instancia del usuario durante las verificaciones.
