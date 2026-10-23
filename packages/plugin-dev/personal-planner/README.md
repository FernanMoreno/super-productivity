# Mi planificación

Plugin general de planificación y seguimiento para Super Productivity. Permite configurar actividades, compromisos, disponibilidad y objetivos que cambian con el tiempo. Empieza vacío; los horarios y nombres pertenecen a los datos del usuario, no a la lógica del producto.

Sin backend, servicios de pago ni dependencias de ejecución. Reutiliza tareas, proyectos, etiquetas, registros y temporizador nativos. La versión 0.5.0 comparte el motor de planificación con el MCP nativo del fork y añade comparación de revisiones al guardado durable. No crea otra fuente de tareas o registros.

## Instalación

Base comprobada: **Super Productivity 19.2.0**, commit `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`. Base local de esta ampliación: `ff317dd24420e5a46f9ca570daa6fd18089effa7`. Resultados de la entrega actual: [VALIDACION-0.5.md](VALIDACION-0.5.md). Las validaciones 0.4 y anteriores no prueban automáticamente los cambios 0.5.

El plugin **0.5.0 requiere este fork con `compareAndSwapSyncedData` y `plannerOperation`**. El número 19.2.0 por sí solo no basta: la publicación original no contiene el MCP nativo de la base de desarrollo inspeccionada. El ZIP añade el panel; las herramientas MCP requieren además el anfitrión Electron compilado con esta adaptación. El paquete web anterior 0.2.0 no contiene esa integración.

Conexión desde Codex, Claude Code, OpenCode y Claude Desktop: [guía de clientes](../../../docs/planner-mcp-clients.md). Herramientas, parámetros, permisos y límites: [contrato MCP](../../../docs/planner-mcp.md). Activa el acceso del asistente y sus permisos en Ajustes de Electron; REST conserva su clave independiente.

1. Genera u obtén `dist/personal-planner.zip`.
2. En Super Productivity abre **Ajustes > Plugins**, selecciona el ZIP y acepta el aviso de instalación de la aplicación. Mantén el plugin activado.
3. Abre **Mi planificación** en el menú lateral; la ruta es `#/plugins/personal-planner/index`.
4. Crea la primera actividad desde Configuración. También puedes cargar una demostración ficticia opcional o importar un perfil privado JSON.
5. Selecciona la zona horaria y el primer día de semana. Si lo necesitas, cambia también el idioma del anfitrión a Español en sus ajustes de localización; el plugin utiliza el idioma y las traducciones del anfitrión, con catálogos español e inglés incluidos. Para el recorrido inicial en español selecciona Español en la aplicación.
6. Vincula actividades a proyectos o etiquetas existentes. Pulsa una tarea del panel para abrir su detalle nativo y usar su temporizador.

La demostración crea solamente configuración ficticia del plugin; no crea tareas ni registros falsos en la aplicación. Un perfil personal preparado para una instalación concreta se entrega fuera del repositorio. No lo copies a Git ni lo publiques. Windows puede acceder a una carpeta privada de WSL mediante `\\wsl.localhost\Ubuntu\home\<usuario>\...`.

## Recorrido básico

1. En **Configuración**, crea una actividad ficticia como «Lectura», vincúlala a un proyecto nativo y define un objetivo diario editable.
2. Configura disponibilidad, jornada si procede y márgenes; marca los datos conocidos o no aplicables. El aviso de disponibilidad parcial permanece mientras falte información.
3. Crea una tarea nativa con estimación y fecha. Consulta Hoy, Semana y Objetivos. Usa su detalle nativo para iniciar el temporizador o registra una duración desde MCP.
4. En **Qué hago ahora**, elige contexto y tiempo disponible; consulta hasta tres acciones con motivos. Puedes abrir otra tarea manualmente. Bloquear o pausar una tarea es metadato del planificador, no completarla ni detener silenciosamente su temporizador.
5. En **Revisión**, consulta la semana e inicia una sesión. Revisa asuntos, guarda decisiones y vuelve después: el progreso persiste. «Revisado», tarea realizada y minutos registrados son hechos distintos.
6. En la tabla semanal compara previsto con registrado; introduce el total real de minutos para una tarea hoja activa. Se comprueba el valor anterior y se usa el servicio nativo. Cero elimina su duración de ese día; no se inventa una hora de inicio. Para tareas archivadas utiliza el registro nativo.
7. Prepara una propuesta, ajusta fecha/hora, selecciona y aplica. Consulta **Historial** para conocer antes/después y preparar una reversión; selecciona los cambios compatibles y confirma cualquier conflicto pendiente.
8. Habilita MCP local y sus permisos en Ajustes; sigue la [guía MCP](../../../docs/planner-mcp-clients.md) para realizar la misma consulta y modificación desde tu asistente. No necesita una API de modelos propia.

El navegador puede utilizar el panel sobre el frontend actualizado del fork, pero el listener MCP requiere Electron abierta. El servidor web antiguo de otra versión no se actualiza importando solo el ZIP: el anfitrión también necesita estas operaciones.

## Revisión, comparación y recuperación

La revisión identifica tareas sin actividad, aplazamientos observados repetidamente, previsiones sin registros, proyectos activos sin próxima acción y metas con datos insuficientes o poco avance. Puedes mantener, reprogramar, dividir, pausar, completar y archivar explícitamente, corregir duración o crear una próxima tarea. Dividir sigue la regla nativa: el primer hijo hereda el historial; no reparte tiempo retroactivamente. La división recurrente se remite a la interfaz nativa para evitar modificar plantillas futuras sin alcance explícito.

El plan previo se captura al iniciar la revisión o antes de aplicar una reorganización. Se conserva la primera observación por día, incluso al cambiar el intervalo consultado. No se presenta una estimación actual como planificación histórica de días anteriores; se indica desconocido. Cambiar posteriormente la zona no reconstruye un baseline comparable.

Cada reorganización tiene identificador durable. Deshacer restaura únicamente los campos de planificación correspondientes: conserva tiempo posterior, completitud, títulos y otros cambios ajenos. Un campo planificado que ya no coincide produce conflicto; se puede seleccionar la parte compatible. La comparación detecta diferencias actuales, no demuestra que nunca haya existido una edición intermedia con el mismo valor final. Una operación parcial o sin confirmación durable conserva resultado incierto.

Si pierdes conexión, reabre el panel y consulta el recibo por su identificador antes de volver a actuar. Los avisos pendientes no reejecutan peticiones. Historial permite inspeccionar una reorganización por ese identificador. No restaures toda la base para deshacer una planificación. Conserva copias privadas usando la exportación/restauración nativa; el JSON del panel exporta sus ajustes, mientras revisiones, recibos e historial adicional forman parte del almacenamiento nativo del usuario.

## Aplicación local empaquetada

La entrega 0.5 incluye `Super-Productivity-Planner-Setup-x64-0.5.0.exe` para Windows y `super-productivity-planner-linux-x64-0.5.0.zip` para Linux. El primero instala un fork con identidad propia; empieza sin importar datos personales. El NSIS no está firmado. La comprobación Windows arranca el ejecutable desempaquetado con perfil sintético, sin ejecutar el instalador sobre un perfil personal.

El ZIP del plugin requiere ese anfitrión compatible. En el primer inicio selecciona **Español** en la localización nativa y activa/importa **Mi planificación** en Plugins. Para migrar tareas e historial usa exportación/restauración nativa; para ajustes del planificador usa su JSON. Haz una copia privada antes de actualizar. Una exportación de ajustes del plugin no sustituye la copia nativa de revisiones, recibos e histórico.

Linux requiere glibc 2.34 o posterior y las bibliotecas habituales de Electron. Si mantienes otra instancia abierta, usa rutas XDG y `--user-data-dir` independientes: el bloqueo de instancia se adquiere antes de aplicar ese argumento. `--no-protocol-registration` evita cambiar asociaciones del sistema. No habilites el listener MCP en dos instancias simultáneas en el mismo puerto.

## Actividades y objetivos

Cada actividad tiene un identificador estable. Puedes cambiar nombre, icono, color, orden y prioridad sin romper sus asociaciones. Permite actividades superiores y subactividades de cualquier nombre, evitando ciclos. Las asociaciones usan proyecto **o** etiqueta; Ctrl/Cmd permite selección múltiple.

Desde su formulario puedes configurar:

- Estado activo, pausado o archivado; progreso manual pendiente, en curso o completado.
- Objetivos diarios, semanales y totales. Un campo vacío no impone obligación.
- Fecha desde la que se aplican los objetivos, el estado y el progreso manual. Las revisiones anteriores se conservan.
- Inicio y fin de vigencia, fecha límite, estimación para una próxima reserva y fecha prevista opcional.
- Días permitidos y horas mínima/máxima para propuestas.
- Uso de capacidad laboral o personal.

Pausar o archivar detiene nuevas demandas del área y sus bloques vinculados durante esa vigencia, conservando el historial. Las tareas nativas pendientes siguen existiendo y mantienen su carga: gestiona su fecha/estado desde Super Productivity si también deseas cambiarlas. El progreso completado es una decisión manual; las horas nunca acreditan por sí solas un curso o examen superado.

Los objetivos totales comparan la meta vigente con el histórico devuelto por la API. Cambiar la meta no reinicia los registros. Cambiar asociaciones puede reclasificar el histórico: se usan las asociaciones actuales, que no tienen revisiones temporales en esta versión.

## Compromisos, disponibilidad y recurrencias

Añade bloques fijos o flexibles con fecha puntual, o deja la fecha vacía y elige días semanales. Inicio y fin de vigencia son inclusivos. Si la hora final es anterior a la inicial, termina al día siguiente. Las ausencias pueden ocupar días completos.

- **Jornada laboral:** define capacidad laboral y tiempo ocupado por trabajo.
- **Compromiso, estudio, entrenamiento u otros:** usa un título libre y el tipo apropiado; un bloque de estudio puede cubrir demanda de su actividad.
- **Franja disponible:** limita los huecos elegibles en su ámbito. No es tiempo ocupado ni genera conflictos. Una rutina semanal de disponibilidad no convierte los días sin ventana en días enteros libres.
- **Ausencia o vacaciones:** el ámbito laboral suspende jornada y permite utilizar ese tiempo como personal. El ámbito personal bloquea tiempo personal; ambos bloquea las dos capacidades.
- **Actividad flexible:** especifica duración y ventana posible. Genera carga y propuestas, sin ocupar tiempo automáticamente.
- **Sueño, desplazamiento, comida o margen:** reserva bloques explícitos. La unión de intervalos evita restarlos dos veces.

Al editar una rutina elige:

- **Solo una ocurrencia:** indica su fecha original. Se excluye de la serie y se crea un reemplazo puntual; puedes moverlo a otra fecha. También puedes omitir solo esa ocurrencia.
- **Esta y futuras desde una fecha:** termina la serie anterior el día previo y crea una sucesora. El pasado y las excepciones anteriores se conservan. Puedes cambiar días, horas, final de vigencia y excepciones futuras.

Las fechas excluidas se refieren al día original de inicio, también en bloques nocturnos. Las tareas recurrentes nativas se gestionan en Super Productivity: el plugin reutiliza las instancias ya creadas y no genera otra serie ni duplica registros. El MCP permite mover una ocurrencia o una serie nativa completa entre proyectos mediante un alcance explícito. Los cambios de rutina con fecha efectiva del panel siguen conservando sus propias vigencias.

## Panel y propuestas

**Hoy** muestra disponibilidad restante desde el instante actual (o capacidad total si consultas una fecha futura), duraciones de tareas pendientes sin hueco conocido, compromisos, tareas previstas, estimaciones, registros en la fecha, objetivos diarios, entregas e incidencias. El selector de fecha permite revisar otras fechas; cada objetivo diario se evalúa por separado. Una tarea prevista se identifica como planificación, no como entrega confirmada; puedes añadir entregas explícitas.

**Objetivos y progreso** distingue tiempo previsto, tiempo registrado y tareas completadas. Incluye tareas activas y archivadas sin duplicar identificadores ni sumar otra vez los agregados de padres y subtareas.

**Disponibilidad semanal** separa capacidad laboral y personal, une ocupaciones y diferencia solapamientos de contigüidad. Las horas inexistentes o ambiguas por cambio horario se muestran para corregirlas, sin elegir silenciosamente una interpretación. Días de 23 o 25 horas se calculan con su duración real.

Las propuestas respetan prioridad, vigencia, fecha límite, días y ventanas configuradas. Una estimación sin fecha busca una reserva en la semana; si ya hay tareas nativas pendientes asociadas se mantiene esa fuente de planificación. Las propuestas requieren huecos continuos y no fragmentan automáticamente una sesión.

**Revisar bloque propuesto** abre un formulario. Solo al guardar se reserva un bloque del plugin; no mueve tareas ni modifica el calendario nativo. Añadir o quitar trabajo extra recalcula huecos, carga y tareas afectadas. Con datos de descanso incompletos, los resultados y alternativas siguen siendo parciales.

**Preparar propuesta de la semana** utiliza las operaciones compartidas del anfitrión. Muestra por separado los destinos «Calendario nativo» y «Bloque del planificador», sin seleccionar cambios automáticamente. Marca las alternativas que aceptes y pulsa **Aplicar selección revisada**. Aplica un solo tipo de destino por vez; después de cambiar datos prepara otra propuesta. Una revisión obsoleta se rechaza. El panel puede utilizar estas operaciones con MCP deshabilitado.

Si se pierde conexión o confirmación, conserva el identificador mostrado y utiliza **Consultar una operación tras perder conexión** en Configuración. Un recibo pendiente o inexistente no autoriza repetir con otro identificador; uno final muestra el resultado confirmado sin volver a escribir.

**Actualizar datos** consulta de nuevo las tareas y asociaciones sin borrar formularios pendientes. Reabrir el panel carga la configuración guardada. Guarda cada formulario antes de editar otro; el guardado reconstruye la configuración visible.

## Persistencia, migración y privacidad

El guardado con revisión del fork compara el perfil antes de despachar y espera el flush del op-log; rechaza cancelaciones y fallos durables. Si se están aplicando cambios de sincronización remota, el guardado se rechaza para reintentar al finalizar; no se confirma un buffer en memoria. No se añaden campos de sync ni otra base de datos. El perfil se guarda como datos del usuario mediante `compareAndSwapSyncedData` y `loadSyncedData`. La clave `profile-v1` conserva su nombre por compatibilidad; el contenido actual usa `schemaVersion: 2`. Los perfiles anteriores se migran al leer o importar, preservando identificadores, asociaciones, objetivos y horarios. La migración no escribe hasta un guardado del usuario. Versiones desconocidas o JSON inválido se rechazan sin reemplazar datos.

Exporta una copia privada antes de importar otro perfil o desinstalar. Importar reemplaza solamente la configuración del plugin; conserva los recibos `op-*` de operaciones. Los borradores abiertos rechazan revisiones obsoletas y no se sobrescriben por cambios del asistente. El almacenamiento del anfitrión usa última escritura por clave: evita editar el perfil simultáneamente desde varios dispositivos. Sus datos pueden entrar en sincronización, copias y exportaciones de Super Productivity.

El ZIP incluye solo manifiesto, interfaz, traducciones español/inglés, licencia y créditos. Nunca incluye perfiles, tareas, capturas ni fixtures. El plugin no hace llamadas de red.

Límites verificados:

- Las lecturas del perfil y del archivo propagan los errores del anfitrión. Un dato comprimido corrupto no se presenta como perfil vacío; un archivo inaccesible produce métricas incompletas y un aviso.
- `timeSpentOnDay` contiene agregados por día lógico, sin sesiones originales. Para certificar objetivos por día civil deben coincidir zona del dispositivo y del perfil, con inicio de día del anfitrión a 00:00. Cambiar ajustes no reconstruye registros antiguos.
- No se proyectan repeticiones nativas futuras aún no creadas. Los eventos externos disponibles se leen de la caché y filtros nativos, se deduplican por proveedor/identidad/alias y vínculo a tarea, y no se copian a compromisos. Referencia, cobertura incompleta, caché y errores se distinguen; consultar el planificador no inicia nuevas peticiones a calendarios. El cambio de proyecto de una serie se ofrece con alcance explícito; el panel no fabrica instancias futuras.
- Una tarea puede pertenecer a varias actividades no relacionadas. El panel avisa; sus métricas no se deben sumar entre sí. La carga asigna cada tarea una sola vez.
- Objetivos semanales y acumulados se muestran como métricas; el buscador propone objetivos diarios y estimaciones flexibles, sin optimizador global ni modificaciones silenciosas.

## Desarrollo y actualización

La construcción del ZIP necesita Python 3 disponible como `python3`. Usa la versión de Node indicada por `.nvmrc` para desarrollo del anfitrión. Desde la raíz:

```bash
cd packages/plugin-dev
npm ci
npm run test --workspace personal-planner
npm run build --workspace personal-planner
npm run check --workspace personal-planner
npx playwright install chromium
npm run test:browser --workspace personal-planner
```

`test:browser` usa API simulada y datos ficticios, incluyendo creación, orden, archivo temporal y edición de recurrencias. Para integración real arranca `npm run startFrontend -- --port 4255` desde la raíz y ejecuta `npm run test:app --workspace personal-planner` desde `packages/plugin-dev`. Se necesita Chromium y sus bibliotecas del sistema. Puedes indicar otro servidor con `PLANNER_APP_URL`.

Para reproducir el paquete web, desde la raíz ejecuta `npm run buildFrontend:dev -- --extract-licenses`; después, desde `packages/plugin-dev`, `npm run package:host --workspace personal-planner`. El empaquetador solo admite la compilación estática, licencia, guía y ZIP del plugin, sin datos del navegador.

Para actualizar, exporta el perfil, instala el nuevo ZIP con el mismo identificador `personal-planner`, abre el panel y verifica asociaciones y objetivos. Ninguna edición cotidiana exige cambiar código, compilar o reinstalar.

## Licencia y créditos

Adaptación mediante plugin de [Super Productivity](https://github.com/super-productivity/super-productivity), de Johannes Millan y sus colaboradores. Se conserva su licencia MIT y se incluye el LICENSE original en el ZIP. No se publica una release ni una PR contra el proyecto original.

## Alcance local y ampliaciones posteriores

Esta ampliación se entrega en una rama y paquetes locales. No publica repositorios, PR, releases ni servicios remotos. Conserva MIT y créditos originales. Requiere la misma instancia Electron para los asistentes locales; cada credencial y capacidad REST/MCP sigue separada.

Quedan como ampliaciones: límites WIP, dependencias completas, estimaciones sugeridas por historial comparable, integración opcional ActivityWatch, plantillas temporales y acceso MCP remoto. No hay infraestructura anticipada para ellas.
