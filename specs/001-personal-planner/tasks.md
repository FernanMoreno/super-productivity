# Tasks: Mi planificación

## Setup y fundamentos

- [x] T001 Confirmar instrucciones, licencia, fork personal y rama.
- [x] T002 Consultar Graphify y contrastar API, tiempos, archivo y persistencia con código.
- [x] T003 Pruebas primero de metrics/schedule en packages/plugin-dev/personal-planner/tests.

## US1 Hoy y progreso

- [x] T004 [US1] Implementar adapter.mjs, metrics.mjs y renderizado de tareas/objetivos.
- [x] T005 [US1] Manejar cargas, errores parciales, permisos, vacíos y día lógico.

## US2 Capacidad y escenarios

- [x] T006 [US2] Implementar schedule.mjs con unión, conflictos, contigüidad y DST.
- [x] T007 [US2] Formularios de compromisos, excepciones y extra; exceso y propuestas revisables.

## US3 Configuración y privacidad

- [x] T008 [US3] Implementar model.mjs y formularios/importación/exportación con guardado confirmado.
- [x] T009 [US3] Perfil privado fuera de Git; README español, licencia y ZIP reproducible.

## Integración

- [x] T010 Pruebas de contrato, navegador y app real cuando posible; checks de composición.
- [x] T011 Revisión independiente, corregir hallazgos, revisar diff y privacidad antes de PR borrador al fork.

Dependencias: T001/T002 antes T003; T004/T006/T008 tras T003; T005/T007/T009 tras sus módulos; T010/T011 al final. Métricas y horario admiten trabajo separado, pero escrituras en checkout se mantienen seriales. Estrategia incremental: primero motor y datos, luego UI, finalmente composición.

## Generalización solicitada posteriormente

- [x] T012 Modelo v2, inicio vacío/demo y migración sin ids personales obligatorios.
- [x] T013 Vigencias, estados/objetivos por fecha, ventanas, ausencias, flexibles y edición de ocurrencias/futuras.
- [x] T014 Formularios generales de actividades, orden, presentación, prioridad y restricciones.
- [x] T015 Pruebas de migración y nuevos escenarios, revisión ECC con Codex e integración real final.

## Corrección esencial tras integración

- [x] T016 Corregir confirmación prematura del núcleo, cancelación, errores y acciones diferidas durante sync; 926 pruebas relevantes pasan y checkFile valida los cuatro TS.
- [x] T017 Repetir integración real sobre compilación estática, entregar paquete local y registrar resultado.

Evidencia final: 59 pruebas de motor/adapter, dos recorridos de UI simulada, 926 pruebas del núcleo relacionado, contrato/arquitectura/ZIP, composición y recorrido real de ZIP→API→IndexedDB→temporizador. La batería general conserva un fallo CalDAV ajeno reproducido por separado. Detalle y límites en VALIDACION.md.
