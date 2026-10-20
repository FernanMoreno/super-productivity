# Equipo ECC con Codex

Guías de rol: cache compartida ECC, commit b92f181b. Solo Codex; no se realizan nuevas consultas a Claude. Agentes de análisis solo lectura; el integrador es único propietario de escrituras en el checkout.

| Trabajo               | Propietario                 | Estado    | Alcance                          | Criterio de aceptación                                  |
| --------------------- | --------------------------- | --------- | -------------------------------- | ------------------------------------------------------- |
| Arquitectura genérica | ecc_architect               | Revisado  | Modelo y límites, solo lectura   | Contrato v2 y migración sin personalización obligatoria |
| Recurrencias/API      | ecc_recurrence              | Revisado  | API y calendario, solo lectura   | Capacidades verificadas y semántica pasado/futuro       |
| Implementación        | Codex integrador            | En curso  | Plugin, pruebas y documentación  | Pruebas de dominio, contrato e integración real         |
| Revisión final        | ECC code-reviewer con Codex | Pendiente | Diff y composición, solo lectura | Hallazgos corregidos y pruebas repetidas                |

Decisiones integradas: ids estables; estados/objetivos con vigencia; ventanas separadas de ocupación; ámbito explícito de ausencias; no duplicar recurrencia ni tiempos nativos. No hay ramas de agentes pendientes de fusionar ni nuevos skills compartidos necesarios.

El calendario se implementó por ecc_recurrence en un worktree separado y se integró por copia revisada. ECC code-reviewer verificó modelos temporales, recurrencias y composición; el último hallazgo P1 sobre acciones diferidas de sync quedó cerrado tras guard antes de dispatch y regresión con bandera real. El integrador ejecuta las pruebas; la revisión estática no se cuenta como ejecución.

Validación final del integrador: 59 pruebas de plugin; 926 de plugins/captura/flush; dos recorridos simulados y recorrido real sobre compilación estática del fork, incluida recarga inmediata tras guardados rápidos. No quedan ramas de implementación sin integrar.
