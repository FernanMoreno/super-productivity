# Revisión de composición

Estado: **PASS WITH RISKS para la integración revisada; aceptación y entrega finales pendientes**. Esta revisión no declara completadas T010 ni T011.

## Alcance y fronteras

Se revisaron el motor compartido del planificador, revisión semanal y siguientes acciones, propuestas ajustables e histórico de reorganizaciones, los puertos nativos, el anfitrión Angular, los esquemas MCP y el panel del plugin. Graphify informó 414 nodos, 1186 aristas y 27 archivos; las rutas relevantes se contrastaron con el código. El grafo orienta la revisión y no sustituye las pruebas ejecutables.

- UI y MCP consumen las mismas operaciones y validaciones. El plugin habilitado y los permisos MCP se comprueban en sus fronteras correspondientes; una autorización MCP no sustituye la autorización del plugin.
- Tareas, proyectos, etiquetas y tiempo siguen perteneciendo a los servicios nativos. El plugin conserva únicamente configuración, revisión, recibos e histórico adicionales mediante la persistencia existente. No se añade backend ni una segunda copia editable de los registros nativos.
- La revisión mantiene el plan capturado por día. Un cambio de intervalo no vuelve a capturar los días ya observados. El pasado anterior a una captura y los registros cuya fecha civil no puede certificarse permanecen desconocidos.
- Preparar o ajustar propuestas no mueve tareas. Aplicar exige selección explícita, comprobación de vigencia y guardas finales. Una selección no mezcla cambios nativos y compromisos del plugin como si existiera una transacción entre ambos almacenes.
- El histórico durable guarda diferencias de planificación antes de invocar la mutación. Undo comprueba los campos de planificación afectados y conserva cambios posteriores de tiempo, finalización, título y otros campos. Los elementos con conflictos se presentan por separado y no se deshacen silenciosamente.
- Los identificadores de operación y recibos protegen los reintentos locales. Un resultado perdido o un fallo de persistencia posterior a una mutación confirmada se representa como incierto; no se convierte en rechazo ni autoriza una repetición automática.
- El panel persiste el identificador pendiente antes de enviar una mutación. Al reabrirse consulta el recibo; no reproduce la petición. La selección de otra semana no reutiliza la sesión de la semana anterior.

## Evidencia disponible

Las cifras siguientes corresponden a los lotes comunicados por sus ejecutores durante esta integración; no se suman entre sí porque algunos se solapan.

| Comprobación                      | Resultado y alcance                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lote Node integrado               | 631/631 correctas. Incluye contratos y regresiones de los módulos cambiados; no equivale a aceptación en Electron.                                                                     |
| Core con zona Los Ángeles         | 84/84 correctas.                                                                                                                                                                       |
| Plugin                            | 74 pruebas unitarias y 5 escenarios de navegador correctos. Los navegadores usan fixtures y puertos simulados, aunque ejercitan operaciones compartidas reales.                        |
| Revisión independiente focalizada | 30/30 correctas: workbench, operaciones de revisión y helpers del panel.                                                                                                               |
| Angular focalizado                | 395 correctas; después 11/11 del importador ZIP con tres regresiones nuevas y 25/25 de rutas tras corregir doneOn.                                                                     |
| Frontend y paquetes finales       | Frontend final aprobado, seis assets contrastados byte a byte, Linux ZIP y Windows NSIS construidos. Dos recorridos reales en el binario Linux final y smoke Windows nativo aprobados. |

Los contratos se verificaron con esquemas y pruebas ejecutables del proyecto, sin añadir una plataforma de pruebas contractuales externa. No se atribuyen a esta versión las ejecuciones históricas de clientes o de otros paquetes. Las pruebas con fixtures permiten reproducir carreras y fallos, pero no certifican por sí solas IndexedDB, IPC, importación del ZIP ni el comportamiento de los clientes contra el paquete final.

## Fallos encontrados y correcciones contrastadas

- Una actividad antecesora podía ocultar las restricciones de su descendiente. La selección ahora prioriza la asociación más específica; el contexto del padre sigue agrupando descendientes.
- Un cambio posterior a un calendario civil compatible podía hacer pasar por fiable un día histórico incompatible. La procedencia diaria conserva el desconocimiento original.
- Dividir una tarea podía eliminar su estimación del plan capturado. Se conserva la previsión original sin volver a sumar el tiempo agregado del padre junto al de los hijos.
- Una duración sin distribución diaria podía desaparecer de la tabla y producir un indicador global de fiabilidad positivo. Ahora se informa de los identificadores afectados y de la fiabilidad incompleta, sin inventar fechas ni filas.
- Una revocación posterior a la aplicación nativa podía clasificar el resultado como rechazado al fallar el guardado del histórico o recibo. El resultado pasa a incierto; la revisión independiente contrastó la reproducción y la corrección.
- Cambiar de semana reutilizaba el identificador de la revisión anterior y bloqueaba la consulta. Se descarta ese identificador al cambiar el intervalo; el escenario de navegador con el core real comprobó volver a la sesión anterior.
- La importación real detectó un HTML de aproximadamente 167 KB rechazado por un límite de 100 KB. `PluginService` utiliza ahora el límite de código existente de 5 MB para HTML. El manifiesto mantiene 100 KB. Pruebas Angular focalizadas 11/11 aprobadas; se importa en Electron real. La entrega repite el recorrido completo sobre la fuente final.

## Límites y cierre

La protección CAS y los recibos no constituyen una transacción distribuida entre dispositivos desconectados. Un recibo pendiente no demuestra que una mutación nativa haya sido aplicada, ni que pueda repetirse. Una propuesta es temporal; tras reiniciar puede ser necesario prepararla de nuevo, mientras que histórico y recibos son durables. Undo compara el estado de planificación disponible, sin reconstruir cambios intermedios que ya no figuran en ese estado.

Los registros nativos agregados por día no contienen necesariamente horas de inicio ni una procedencia temporal suficiente para reconstruir sesiones antiguas. El plan capturado tampoco reconstruye previsiones anteriores a su primera observación. Se mantienen estados desconocidos cuando falta esa información.

Cerrados los recorridos reales sobre el binario final: revisión, sugerencias, corrección, ajuste/aplicación/undo, archivo/subtareas, permisos y recibos; cierre/reapertura completa conserva datos y marca de finalización. SDK HTTP/stdio y consulta Codex aprobados; Claude Code/OpenCode conectan administrativamente sin inferencia. Windows nativo verifica Angular/EA/IPC y MCP de lectura en perfil temporal; el NSIS no se ejecuta. Diff revisado, composición programática aprobada, entrega local con licencia, código y hashes. Claude Desktop requiere una sesión iniciada para su validación completa. No se ha autorizado ni realizado publicación como parte de este cierre.

## Correcciones posteriores comprobadas

- Importador ZIP: Angular focalizado 11/11, tres regresiones de tamaño; frontend corregido compilado.
- Una recarga real, antes de cualquier undo, cambiaba `doneOn` de una tarea completada desde MCP en 5–6 ms. El reductor local usaba Date.now y la captura durable añadía otra fecha. El puerto nativo fija explícitamente una marca en la primera transición a completado; copia inmutable para respetar Task readonly. Regresión ejecuta captura/reductor reales; 22/22 pruebas nativas Node y 25/25 rutas Angular, typecheck y frontend aprobados.
- Revisión independiente reprodujo en Chromium que corregir fila B decidía un asunto A. La intención ahora requiere sesión, tarea, fecha e intervalo coincidentes y tiene cancelación; limpia cambios de rango/sesión. La fuente se revisó independientemente y la prueba que fallaba pasó; el owner UI comprobó el caso correcto, cancelación, otra fecha y cambio de intervalo; construyó el ZIP definitivo y repitió 74 unitarias y cinco recorridos de navegador. No se atribuye esa reproducción a Electron real.

La arquitectura no cambió desde el refresco Graphify: estas correcciones añaden una marca nativa y guardas locales a los límites existentes. Se contrastaron contra la fuente; no requieren nuevo grafo para inferir relaciones nuevas. El vault ajeno a SuperPro no se utiliza; las decisiones durables quedan en esta especificación y en el informe de validación.

## Cierre reproducible

- Base local ff317dd24420e5a46f9ca570daa6fd18089effa7; rama feat/planner-review-local sin commits/push/publicación. Parches completo e incremental y tree hash identifican la fuente final en la entrega.
- Node conjunto final631/631; core84/84 Los Ángeles; plugin74 y cinco recorridos; Angular395 focalizadas, después11 importador y25 rutas; typecheck y checkFile16 aprobados.
- Linux ZIP SHA256 1a9c59dd119a147b5e3a2eb0322b10fce7924198fe5150b7a850ee1687c3892a. Windows NSIS SHA256 fb1fa13f8374265965096452bbd561282a486d2f496b420a6f13d1d274440726. ASAR:333 JS y assets del plugin idénticos a compilaciones congeladas.
- No se migran datos personales ni se reinicia o modifica la instancia anterior. La validación usa perfiles sintéticos y elimina sólo los suyos. Los paquetes no contienen perfiles, fixtures ni credenciales.
