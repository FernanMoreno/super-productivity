# Revisión de composición

Superficies revisadas: panel iframe, API del plugin, servicio de operaciones del anfitrión, núcleo puro, servicios nativos, op-log/archivo, servidor MCP, adaptador stdio, clientes y distribución.

El perfil y los recibos permanecen en el namespace del plugin; tareas y tiempo permanecen en sus modelos nativos. Las dos instancias UI/MCP comparten algoritmos y almacenamiento y mantienen separadas sus autorizaciones y propuestas temporales. La identidad del plugin la vincula el anfitrión; deshabilitarlo invalida lecturas pendientes y futuras escrituras. Deshabilitar MCP no impide una operación explícita desde el panel.

Las consultas revisan permisos al volver de esperas. Los cambios confirmados no se ocultan después de escribir. Los recibos se reservan antes de la operación, no caducan silenciosamente, y los resultados inciertos no se reejecutan. La lectura corrupta se rechaza. La selección del usuario, revisión de perfil, huella de tareas/recordatorios y guardas síncronas se comprueban antes del despacho.

El calendario nativo conserva acciones independientes por tarea, sus efectos locales y sus límites de conflicto; no afirma atomicidad de todo el flujo. Se documenta un fallo parcial como incierto. No se añade un nuevo tipo de operación ni un campo persistido obligatorio; los hooks opcionales del movimiento de serie conservan la ruta de los consumidores anteriores. El API del plugin crece explícitamente y necesita el fork compatible.

Pruebas reales cubren UI→servicio→op-log→IndexedDB→MCP y la dirección inversa; SDK HTTP/stdio y clientes administrativos; persistencia y reintento; aplicación con MCP deshabilitado; permisos, propuestas obsoletas y cierre de la aplicación. Fixtures separados cubren fallos parciales, revocación durante esperas, dobles envíos y configuración distinta. Las tareas archivadas/padres se verifican además contra las reglas de agregación de fuente.

La distribución tiene staging nuevo, allowlist pública, cierre de dependencias contrastado con lockfile y preflight del preload. Windows separa la identidad del fork. Las pruebas no instalan el NSIS ni alteran asociaciones del sistema: usan perfiles temporales y el flag explícito de exclusión de registro.

Composición programática: PASS. Graphify: 329 nodos/917 aristas, fuente contrastada; DAG puro del plugin verificado. Revisión ECC independiente corrigió carreras de permisos, calendario lógico, perfil, lectura deshabilitada, resultado incierto y clasificación previa al primer despacho. La revisión ECC final no encuentra hallazgos P1/P2 accionables. Los límites informativos/distribuidos se documentan en la validación, sin afirmar garantías que el modelo no ofrece.

Conocimiento durable: contratos y resultados quedan en estos documentos. No se escribe en un vault de otro proyecto ni se copia allí el grafo generado. Datos personales y credenciales permanecen fuera del repositorio y los artefactos públicos.

Cierre: 477 pruebas Node; 17.959 Angular Berlin aprobadas y 2 pendientes; 6.038 LA canónico y 14 pendientes; 163 LA focalizado final sin pendientes. Las dos baterías amplias preceden al último ajuste de lectura vacía; el frontend final y el lote de 163 casos lo verifican. Electron empaquetado Linux final y smoke nativo Windows final aprobados con perfiles ficticios. NSIS construido sin ejecutar instalación.
