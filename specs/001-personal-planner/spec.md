# Feature Specification: Mi planificación

**Feature Branch**: `feat/personal-planner`

**Created**: 2026-10-21

**Status**: Accepted scope supplied by user

## User Scenarios & Testing

### User Story 1 — Hoy y progreso (P1)

Consultar compromisos, tareas reales, estimaciones, registros y entregas. Asociar áreas y asignaturas a proyectos o etiquetas existentes. Evaluar objetivos diarios por fecha local; no inferir aprobados a partir de horas.

Acceptance: datos activos y archivados se deduplican por identificador; padres agregados no duplican subtareas; datos ausentes se explican. Estados vacíos y fallos visibles. El objetivo de un día no se compensa con otro.

### User Story 2 — Capacidad y escenarios (P1)

Editar jornada, compromisos recurrentes/puntuales, bloques de estudio, descanso, desplazamientos, márgenes, excepciones y trabajos extra. Ver capacidad laboral separada de personal; formación laboral reserva solo jornada laboral.

Acceptance: unión de intervalos ocupados; solapamientos y contigüidad se informan por separado; trabajo extra recalcula capacidad y tareas afectadas, sin mover calendario. Disponibilidad parcial cuando falten márgenes. Alternativas son propuestas revisables.

### User Story 3 — Configuración y privacidad (P1)

Importar perfil privado y editarlo mediante formularios. Conservar configuración al reabrir y manejar fallos de guardado. La versión pública usa valores neutros y datos ficticios.

Acceptance: ZIP no contiene horarios, objetivos o registros personales. Perfil fuera de Git. Configuración editada persiste mediante almacenamiento de usuario soportado. Interfaz española accesible con teclado y temas nativos.

## Requirements

- FR-001: Leer tareas, archivos, proyectos y etiquetas mediante API soportada; nunca escribir seguimiento interno.
- FR-002: Separar previsto, registrado y completado; identificar registros incompletos.
- FR-003: Semanas desde lunes y fechas Europe/Madrid, contemplando cambios de horario y límites del día lógico del anfitrión.
- FR-004: Objetivos, asignaturas, entregas, fechas provisionales, exclusiones y preparación editables; ninguna carga no confirmada se convierte en obligación.
- FR-005: Crear y quitar trabajos extra; informar exceso de carga y posibles alternativas sin modificaciones automáticas.
- FR-006: Instalación mediante ZIP en versión compatible, instrucciones españolas y licencia/créditos conservados.

## Key Entities

Perfil versionado; áreas/asignaturas con asociaciones; objetivos; compromisos con recurrencia o fecha y exclusiones; entregas; snapshot de tareas; intervalos y conflictos derivados.

## Edge Cases

API o archivo no disponible, guardado rechazado, perfil malformado/futuro, claves de día ya agregadas sin timestamps, padre sin hijos disponibles, repetición de identificadores, referencias borradas, día de 23/25 horas, eventos nocturnos, horario local inexistente/ambiguo, contigüidad sin transición y tareas sin fecha/hora.

## Success Criteria

Los nueve escenarios de verificación solicitados tienen prueba automatizada proporcional; integración real y simulada se distinguen. Paquete reproducible e importable; ningún dato privado aparece en código público. Límites no verificables se documentan sin inventar resultados.

## Alcance actualizado: producto general configurable

Solicitud posterior sustituye áreas personales obligatorias por actividades generales creadas por usuario. Se conserva integración, privacidad y verificaciones del alcance inicial. El producto debe iniciar vacío o con demostración ficticia opcional. Ningún identificador o nombre personal dirige lógica.

- FR-007: Crear, editar, ordenar, pausar y archivar actividades con id estable, presentación, prioridad, estimación, fecha límite y asociaciones nativas.
- FR-008: Versionar objetivos y estados desde una fecha, conservando evaluación pasada e historial de registros.
- FR-009: Configurar zona horaria, ventanas disponibles, ausencias/vacaciones, vigencia de rutinas, restricciones de actividad y bloques flexibles sin ocupación automática.
- FR-010: Editar una ocurrencia mediante exclusión y reemplazo; editar futuras dividiendo serie desde fecha inclusiva, sin alterar pasado.
- FR-011: Migrar perfil previo sin pérdida de ids ni asociaciones; rechazar versiones desconocidas y persistir solo tras guardado exitoso.

Aceptación: vaciar perfil no impide crear una actividad nueva; renombrar no rompe atribución; pausa/archivo eliminan nueva demanda sin borrar registros; cambios futuros conservan pasado; vacaciones laborales suspenden jornada sin bloquear automáticamente tiempo personal; ventanas disponibles no son eventos ocupados; propuestas de flexibles respetan prioridad y restricciones.
