# Integración en el fork — 23/10/2026

Petición explícita del usuario: guardar todos los cambios, subirlos a
FernanMoreno/super-productivity e integrarlos en su rama principal, master.
La base remota comprobada fue78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d;
feat/planner-review-local ya incluía tres commits posteriores y los cambios
pendientes de las especificaciones004–013. No se incorporaron temporales,
perfiles personales, dependencias instaladas ni credenciales.

## Verificación de la versión que se integra

Se preparó una copia exacta de los archivos pendientes con dependencias nativas
de Windows: WSL no puede montar su disco por ERROR_SHARING_VIOLATION. Se comparó
su contenido con los archivos preparados para el commit, sin diferencias.

El hook local de commit tampoco pudo arrancar: npx no encuentra pretty-quick
en las dependencias originales de WSL. Se ejecutaron el formato de todos los
archivos preparados y las validaciones equivalentes en la copia de Windows;
se exceptúan los hooks únicamente para esta operación de Git, sin cambiar su
configuración. Después del formato se repitieron256 regresiones adicionales,
todas aprobadas.

- npm test: PASS. Paquetes y herramientas de release aprobados; Angular18.034
  pruebas aprobadas y dos omitidas por la suite existente; segunda pasada de
  fechas en America/Los_Angeles6.054 aprobadas. Registro local
  .tmp/final-fork-npm-test-green.log.
- Electron:471 pruebas aprobadas. Cinco pruebas existentes que crean enlaces
  simbólicos no pudieron ejecutarse con los permisos de Windows; se excluyeron
  explícitamente en la repetición, sin modificar sus casos ni afirmar cobertura.
- Regresiones adicionales del planificador, adaptadores y operaciones
  nativas:253 aprobadas; empaquetado:3 aprobadas. Trello:38 aprobadas y typecheck
  correcto. Comprobación de arquitectura/API/ZIP del planificador:PASS.
- Compilación de paquetes:31/31 aprobados. checkFile correcto en los archivos
  TS/SCSS aplicables y reparaciones finales; t.const.ts es generado y no se
  presentó su exclusión de ESLint como un resultado de lint.
- Lint completo de TypeScript, SCSS, variables CSS y reglas locales:PASS.
  Herramientas:119 aprobadas; un caso adicional de enlaces simbólicos falló por
  EPERM y se excluyó expresamente en la repetición. Iconos macOS:12 aprobadas.
- Revisión independiente final:PASS WITH RISKS, sin bloqueos de código.
  No fue posible repetir project-composition-check ni comprobaciones reales de
  Electron/Linux en esta sesión. Las validaciones anteriores por funcionalidad
  siguen documentadas en sus respectivas especificaciones.

## Reparaciones encontradas antes de integrar

Se actualizaron los dobles de prueba de Ajustes, Calendario, Historial y el
panel de tareas para las nuevas dependencias de navegación/plugins. El test
HTTP MCP ahora reconoce rutas de módulos tanto en Windows como en Linux.
La regla global de acciones de diálogo reduce su especificidad para conservar
el espaciado intencional del diálogo de planificación; no se debilitó su prueba.

La adaptación de QuestArc conserva el ZIP subible y su identidad, pero reutiliza
skipCopy del empaquetador para evitar copiarla como un plugin de fábrica no
registrado. Su regresión falla antes del cambio y pasa después. Los scripts de
ZIP seleccionan python en Windows/python3 en Linux y convierten la URL del ZIP
en ruta nativa antes de invocar Python.

Los cambios conservan los contratos y propietarios de datos existentes; estas
reparaciones no añaden esquemas, migraciones ni permisos. La revisión de límites
incluye permisos MCP, diario de operaciones, propiedad nativa de tareas y
recursos de plugins. La falta de WSL y las seis pruebas de enlaces simbólicos
son límites de esta comprobación, no resultados aprobados.
