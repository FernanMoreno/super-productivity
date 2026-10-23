# Validación local 0.5.0

Actualización23/10/2026: el usuario autorizó posteriormente el commit y la
integración en la rama principal del fork. La verificación final y sus límites
están en [docs/fork-integration-validation.md](../../../docs/fork-integration-validation.md).
La descripción «sin commits nuevos ni publicación» siguiente corresponde al
estado de la validación inicial.

Base local: `ff317dd24420e5a46f9ca570daa6fd18089effa7`. Upstream de desarrollo: `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`, aplicación 19.2.0. El mismo número de una publicación original no demuestra compatibilidad. Esta ampliación se mantiene en `feat/planner-review-local`; sin commits nuevos ni publicación. Los entregables identifican el diff exacto y sus hashes.

## Reutilización y cambios esenciales

| Requisito                                                                     | Situación inicial y solución                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Tareas, proyectos, etiquetas, archivo, temporizador, exportación              | Reutilizados; siguen siendo la fuente nativa.                                                                     |
| Actividades, objetivos diarios/semanales/acumulados, recurrencias/excepciones | Perfil y formularios existentes ampliados con preferencias y proyección de ritmo.                                 |
| Capacidad laboral/personal y unión de intervalos                              | Motor existente ampliado con márgenes, caché externa deduplicada y capacidad restante desde ahora.                |
| Hoy, Semana y Objetivos                                                       | Ampliados sin sustituir vistas nativas ni crear otra base de tareas.                                              |
| Revisión retomable y tabla semanal prevista/real                              | Nuevos módulos compartidos y vistas. Baseline de primera observación, datos desconocidos explícitos.              |
| Qué hago ahora                                                                | Reglas locales comunes UI/MCP: hueco actual, contexto, restricciones, prioridad, vencimiento, objetivo y bloqueo. |
| Propuestas y reversión                                                        | Historial durable antes/después por campos, ajustes y reversión seleccionada con conflictos.                      |
| MCP/stdio/permisos/recibos                                                    | Transporte existente ampliado; sin servidor o API de modelos adicionales.                                         |
| Idioma y privacidad                                                           | Traducciones nativas en/es; configuración y registros separados del código.                                       |

Cambios nativos necesarios: puerto compartido de operaciones del plugin, exposición de caché de calendario sin refresco de red, marca opcional de registro manual como duración sin sesión y guardas al archivar. El importador ZIP aplica ahora al HTML el límite de código existente de 5 MB; conserva 100 KB para el manifiesto. El error se reprodujo al importar el panel real de 167 KB, antes de corregirlo. La primera transición a tarea completada transporta una marca `doneOn` explícita: la prueba real detectó una diferencia de 5–6 ms entre estado local y captura persistida durante la recarga, antes de cualquier undo; la regresión ejecuta el reductor y la captura nativos reales. La API anterior no cubría estos comportamientos con las garantías requeridas. No se añade un modelo paralelo de tiempo ni una versión nueva del wire de sincronización.

## Comprobaciones actuales

- Angular focalizado: **395/395** aprobadas, Europe/Berlin, sin pendientes; servicios nativos, archivo, calendario, puente, persistencia, rutas y reducers de tareas/tiempo. Informe audita identificadores y final completo.
- Importador ZIP Angular focalizado: **11/11**, incluidas tres regresiones nuevas: HTML 167 KB aceptado y cacheado; HTML superior a 5 MB rechazado; manifiesto superior a 100 KB rechazado.
- Rutas Angular tras la corrección final de `doneOn`: **25/25** aprobadas sobre la fuente inmutable; frontend y typecheck finales aprobados.
- Core final en America/Los_Angeles: **84/84** aprobadas, sin pendientes.
- Cierre conjunto Node/Electron/core/plugin: **631/631** aprobadas; incluye las nuevas pruebas de propuestas, permisos, recibos, duración cero, preservación de hechos posteriores y pipeline. Incluye las últimas correcciones de navegación de revisión y la estabilidad de la marca de finalización al persistir y reproducir una operación nativa.
- Typecheck real de la aplicación: `tsc -p src/tsconfig.app.json --noEmit --rootDir .` aprobado. Sin el override, el rootDir original restringido a src rechaza imports existentes de paquetes/Electron; no se modificó esa configuración para ocultarlo.
- `checkFile` final: 16 archivos TypeScript aprobados juntos. Compilación Electron canónica con helper Wayland y preload empaquetado. Frontend de producción corregido aprobado; avisos existentes de RouterLink sin uso y presupuesto inicial 5,86 MB frente a 5,50 MB.
- `project-composition-check SuperPro`: aprobado.
- Plugin: **74 pruebas unitarias y cinco recorridos de navegador aprobados**. Utilizan API simulada; el recorrido guiado ejecuta además el núcleo real. Empaquetado y contrato ZIP aprobados.
- Electron Linux final: **dos recorridos reales aprobados** contra el ejecutable empaquetado. Uno verifica tareas/tiempo, ZIP, UI↔MCP, permisos, recibos, propuestas y clientes; el otro revisión, recomendaciones, ajuste/historial/undo, archivo/subtareas y cierre/reapertura completa del proceso. Antes pasó también el recorrido guiado sobre staging.
- SDK oficial MCP **1.32.1**: conexión y herramientas por HTTP nativo y adaptador stdio contra Electron final, aprobado.
- Codex CLI **0.163.0**: descubrimiento y `planner_query` reales, aprobado. Claude Code **2.1.303** y OpenCode **2.0.18**: conexión administrativa real aprobada; sus comandos administrativos no permiten atribuirles llamadas a herramientas. Cero llamadas a modelos en estas comprobaciones.
- ZIP Linux, plugin y NSIS Windows finales construidos. **Smoke Windows nativo aprobado**: página Angular, puente EA/IPC, perfil temporal, MCP initialize, herramientas filtradas y lectura de actividades vacías; acceso desactivado al terminar, proceso y perfil de prueba eliminados. No equivale a ejecutar NSIS ni al recorrido completo del plugin en Windows; éste se comprueba en Electron Linux.

Las cifras de las baterías completas de 0.4 no se atribuyen a esta ampliación. Las pruebas usan exclusivamente perfiles sintéticos y no reinician ni modifican la instancia personal abierta.

## Casos de aceptación y tipo de evidencia

| Caso                            | Evidencia aprobada                                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Configuración desde interfaz | Cinco recorridos de navegador: vacío/demo, crear/editar/ordenar/archivar, nombres e IDs, preferencias. Electron real: editar objetivo UI y verlo en MCP, y al contrario.                                                            |
| 2–3. Vigencia y excepciones     | Núcleo y formularios en navegador con API simulada: una ocurrencia/futuras, conservación del tramo anterior, ausencia y excepciones.                                                                                                |
| 4–5. Capacidad/solapamientos    | Núcleo: unión, franjas contenidas, separación laboral/personal, contigüidad, márgenes, DST y capacidad restante; calendario con pruebas del servicio nativo y datos sintéticos.                                                     |
| 6. Archivo y jerarquías         | Electron real: minuto nativo heredado al dividir sin sumar padre e hijos, luego archivar otra tarea conserva exactamente el progreso. Núcleo verifica asociaciones múltiples y fecha civil.                                         |
| 7. Revisión retomable           | UI real guarda decisión, recarga y cierre/reapertura completa conservan sesión y decisiones; mantener no completa la tarea.                                                                                                         |
| 8–9. Qué hago ahora / sin hueco | MCP real devuelve candidato con razones y caso sin encaje; navegador con núcleo real verifica contexto, bloqueo manual y alternativas.                                                                                              |
| 10. Propuesta ajustada          | MCP real prepara, ajusta hora, selecciona y aplica; UI muestra el historial confirmado después de recargar.                                                                                                                         |
| 11. Reversión segura            | Electron real: registrar tiempo y completar después de aplicar, recargar y deshacer conserva duración, mapa diario, isDone y doneOn; una edición posterior del plan produce conflicto y se rechaza.                                 |
| 12. Persistencia                | Cerrar y volver a lanzar el proceso final conserva configuración/progreso, revisión, histórico, recibo y completitud; se consulta desde MCP y UI.                                                                                   |
| 13–14. MCP y datos compartidos  | Aplicación final en ejecución: tareas/objetivos, registro/corrección, propuestas/historial y lecturas en ambas direcciones.                                                                                                         |
| 15–16. Permisos y duplicados    | Descubrimiento filtrado y rechazo sin permiso; reintentos de creación/tiempo/apply/corrección no duplican. Repetir una corrección antigua a cero conserva la edición UI posterior a dos minutos. Recibo consultable tras reiniciar. |
| 17. Errores/conexión            | Aplicación cerrada deja de responder; adaptador, errores de datos y resultados inciertos cubiertos por pruebas contractuales y UI simulada. Una respuesta perdida no autoriza repetir automáticamente.                              |

La corrección de la intención de revisión tiene regresión roja/verde en Chromium con núcleo real y adaptador simulado: corregir B no revisa A; cubre coincidencia correcta, cancelación, fecha distinta y cambiar/retomar intervalo. No se atribuye esa reproducción a Electron. La tabla real se editó mediante el formulario del plugin contra tareas nativas.

## Condiciones y límites reales

- Electron debe permanecer abierta para el listener MCP local. La versión web no contiene dicho listener. No se añade acceso remoto.
- La caché externa utiliza filtros nativos y no acredita cobertura completa ni actualidad; se informa de disponibilidad provisional. La consulta no refresca proveedores. Una integración nativa de time-block habilitada puede sincronizar cambios de programación según su propia configuración; la adaptación no añade ni publica un servicio remoto.
- Los registros diarios no contienen las sesiones originales. Se distingue duración conocida de intervalo conocido. No se inventa la planificación pasada antes de su primera captura ni la procedencia civil que falta; una configuración actual compatible no repara un baseline conocido como incompatible.
- La corrección desde el panel/MCP se limita a tareas hoja activas; tareas archivadas se corrigen mediante el registro nativo. La división recurrente se remite a la interfaz nativa porque puede cambiar plantillas futuras.
- Archivar nativamente completa y retira la planificación. Una carrera durante el guardado del archivo conserva la tarea activa posterior y comunica incertidumbre; no promete una transacción entre archivo y tarea viva.
- Deshacer compara campos actuales con el resultado esperado, preserva tiempo/completitud y puede ser parcial. No detecta una edición intermedia que acabó con idéntico valor (ABA), ni ofrece CAS distribuido entre equipos offline.
- Propuestas UI y MCP tienen sesiones independientes: aplicar su identificador desde el mismo canal que la preparó. Los datos, reglas, historial y recibos son compartidos.
- Un recibo pendiente no confirma éxito ni autoriza repetir a ciegas. Los avisos no reejecutan cambios; el cierre manual exige comprobación explícita y conserva el identificador sin falsificar el recibo.
- Claude Desktop necesita validación con sesión iniciada. Codex y SDK tienen llamadas reales comprobadas; Claude Code/OpenCode tienen conexión administrativa comprobada y configuración preparada, sin inferencia. El instalador NSIS no tiene firma digital y no se instala sobre el perfil personal durante la prueba.

## Ampliaciones posteriores

Límites de tareas en curso; dependencias completas; estimaciones por historial comparable; ActivityWatch opcional; plantillas temporales de disponibilidad/objetivos; MCP remoto. Fuera del alcance obligatorio, sin infraestructura anticipada.

## Reproducción de las pruebas reales

Con Electron y frontend compilados y las bibliotecas de Chromium disponibles, el harness `e2e/electron/planner-mcp-smoke.cjs` acepta la ruta al ejecutable Electron empaquetado. Usa perfiles temporales sintéticos, desactiva el registro de protocolos y cierra únicamente su proceso. El puerto local 3876 debe estar libre; no cierres una instancia personal para obtenerlo.

Ejecuta dos recorridos independientes: sin `PLANNER_GUIDED` para tareas/tiempo, importación, propuestas y clientes; con `PLANNER_GUIDED=1` para revisión, baseline, correcciones, recomendaciones y reversión. Se separan para que el segundo recorrido capture su plan inicial antes de crear reorganizaciones: añadir una tarea posteriormente no reescribe el plan histórico.

Las variables opcionales `PLANNER_MCP_SDK_PATH`, `PLANNER_MCP_CODEX=1` y `PLANNER_MCP_ADMIN_CLIENTS=1` habilitan comprobaciones con los clientes disponibles. No realizan inferencia. Los adaptadores administrativos de Claude Code y OpenCode comprueban conexión, sin atribuirles llamadas a herramientas que sus comandos administrativos no ofrecen.
