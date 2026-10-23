# Gestión de tareas en Mi planificación

Abre un **proyecto → Tablero**. Las tarjetas son las mismas tareas nativas de Super Productivity. El panel guarda únicamente su organización, dependencias, criterios y plantillas en `personal-planner:workflow-v1`. Las conexiones externas están en **Ajustes → Integraciones**.

- **Entrada, Preparada, En curso, Bloqueada, Hecha**: mueve con el selector y el botón, o arrastra una tarjeta. Moverla a En curso no inicia el temporizador. Mostrar subtareas permite organizar también los pasos de una plantilla.
- **Dependencias y bloqueos**: Editar tarea permite seleccionar requisitos, indicar un motivo de bloqueo y su fecha de revisión. Los ciclos se rechazan. Un requisito desaparecido o archivado necesita revisión. Los requisitos incompletos y los bloqueos impiden preparar, iniciar o completar la tarea.
- **Límite de trabajo en curso**: empieza en dos tareas, configurable entre una y veinte. También se cuenta la tarea que esté cronometrándose. El panel advierte si otras vistas nativas superan el límite.
- **Criterios de finalización**: completa la lista antes de mover la tarea a Hecha. Se comprueba también la finalización automática del padre al terminar su última subtarea. Los cambios realizados desde otras vistas nativas se reflejan y las discrepancias aparecen en revisión.
- **Plantillas**: guarda pasos con sus minutos y criterios, revisa el proyecto y confirma su creación. Se crea una tarea nativa con subtareas; los títulos se conservan literalmente. Una plantilla guardada no crea tareas por sí sola.
- **Planificar semana**: selecciona tareas estimadas, revisa fechas y capacidad laboral/personal y confirma las asignaciones. Incluye subtareas, respeta dependencias y descuenta compromisos y trabajo ya programado. La disponibilidad incompleta se identifica y requiere aceptación explícita.
- **Revisión del trabajo**: revisa tareas vencidas, bloqueadas, sin estimación o con criterios pendientes; edita, desbloquea o registra su revisión. Dividir y reprogramar utilizan la revisión guiada existente.

## MCP

`workflow_query` lee `board`, `templates`, `week`, `review`, `integrations` o `receipt`. `workflow_command` exige un `operationId` estable, `baseRevision` y `nativeRevision` obtenidos de una consulta reciente, más `command:{type,payload}`. `week.apply` también exige el `weekRevision` de la propuesta. Los comandos admitidos están en `electron/shared-with-frontend/workflow-contract.model.ts`.

Lecturas: `planner:read` y `tasks:read`. Escrituras: además `planner:write` y `tasks:write`. Consultar proveedores o vincular una incidencia necesita `issues:read`; sincronizar su estado remoto necesita además `issues:write`. Estos dos permisos nuevos empiezan desactivados.

Los cambios se registran primero como pendientes. Una repetición con el mismo identificador devuelve su recibo y no vuelve a crear tareas. Una interrupción después del primer cambio puede dejar un resultado incierto: consulta `workflow_query` con `view:receipt` y el mismo `operationId`, y revisa las tareas. No cambies de identificador para repetir una operación incierta. Una edición obsoleta conserva el formulario y requiere actualizar los datos. El diario evita reintentos locales; no representa una transacción distribuida entre dispositivos.

## Trello y Jira

Las credenciales y conexiones pertenecen a los proveedores nativos en **Ajustes → Integraciones**. Instalar o autorizar un plugin de ChatGPT no configura automáticamente esos proveedores. El panel muestra los proveedores habilitados disponibles; no afirma conexión donde no existe.

Se puede guardar un enlace HTTPS sin conectar una cuenta. Vincular una incidencia a una tarea existente requiere un proveedor configurado y comprueba que la misma incidencia no esté asociada a otra tarea activa o archivada. No crea otra tarea ni reemplaza su título.

Los cambios remotos son explícitos y se verifican después de enviarlos. Jira usa las transiciones que permite la incidencia y respeta el ajuste nativo de transiciones; las que requieren campos adicionales no son compatibles. Trello permite abrir/cerrar tarjetas y mover una tarjeta abierta a otra lista activa de su mismo tablero. Requiere una dirección de sincronización que permita escritura. El selector de listas es independiente de las columnas locales de Super Productivity; mover una tarjeta no completa la tarea ni modifica su título o temporizador.

Para moverla por MCP, consulta `workflow_query` con `view:integrations` y `taskId`. El resultado incluye `boardId`, `listId`, `lists` y `moveSupported`. Envía `workflow_command` con `command:{type:"integration.move",payload:{taskId,targetListId,expectedListId,expectedBoardId}}` y las revisiones de la consulta. Se comprueban de nuevo la tarjeta y la lista antes del PUT y se verifica el destino después. No se transfieren tarjetas entre tableros ni se mueven tarjetas/listas archivadas. Un resultado incierto conserva su recibo y no se repite automáticamente. Los errores de los proveedores se reducen a códigos seguros y no exponen credenciales.

Las pruebas de proveedores utilizan datos ficticios. Una cuenta sin configurar requiere autorización y configuración antes de verificar la sincronización real.

## Espacio de trabajo

Mi planificación reúne Hoy, Tareas, Calendario, Objetivos, Revisión y Ajustes en una navegación lateral. En pantallas pequeñas, la navegación se sitúa arriba. Los formularios permanecen montados al cambiar de apartado; los avisos de operaciones pendientes siguen accesibles. El tablero abre los detalles de cada tarea en un editor separado, con opción de continuar o descartar el borrador.
