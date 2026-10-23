# Conectar asistentes con Mi planificación

La aplicación Electron de esta adaptación ofrece un único endpoint MCP local, `http://127.0.0.1:3876/mcp`. La interfaz y los clientes acceden al mismo perfil y a las tareas y registros nativos. El adaptador stdio de `tools/mcpb` cambia el transporte; no crea otro servidor de datos.

La aplicación debe permanecer abierta; puede estar minimizada. El frontend web de desarrollo en `http://localhost:4255` no contiene el listener REST/MCP de Electron. Un conector ejecutado en la nube no puede alcanzar el `127.0.0.1` de tu ordenador. Para Claude Desktop utiliza la conexión local stdio o MCPB, no un conector remoto de claude.ai.

## Versión necesaria

El número `19.2.0` por sí solo no demuestra compatibilidad: la publicación original del 11 de octubre de 2026 no contiene el MCP nativo. La base de desarrollo `78139c5`, del 20 de octubre de 2026, sí contiene el transporte MCP. Las herramientas de planificación requieren además los cambios de esta adaptación. Conserva el commit de la compilación instalada junto con el resultado de sus pruebas.

Los ejemplos se revisaron con Codex CLI **0.163.0**, OpenCode **2.0.18**, Claude Code **2.1.303** y Node **24.19.0**. La lectura de ayuda de un cliente no equivale a una conexión con Electron. El servidor negocia actualmente el protocolo MCP clásico; no fuerces la revisión 2026-07-28 en el cliente.

## Habilitar acceso y preparar la clave

1. Abre la aplicación Electron compatible y habilita acceso del asistente en Ajustes.
2. Concede únicamente los permisos necesarios y genera una clave MCP. Empieza por `sp_mcp_` y es independiente de la clave REST.
3. Guarda la clave fuera del repositorio. Para el puente stdio puede usarse un archivo privado que contenga únicamente la clave y un salto de línea opcional; configura su ruta absoluta como `SP_ACCESS_KEY_FILE`.
4. Para conexiones HTTP directas define `SP_ACCESS_KEY` en el entorno del cliente antes de abrirlo. La clave no debe aparecer en JSON, TOML público, capturas, logs ni historial de órdenes. Utiliza entrada oculta o el gestor de secretos de tu sistema para cargarla.

En POSIX limita el archivo privado con `chmod 600 /RUTA_PRIVADA/super-productivity-mcp.token`. En Windows ajusta su ACL para que solo tu usuario tenga acceso. Son rutas de ejemplo: no copies la clave a los directorios de ejemplos o distribución.

## Permisos y herramientas

El transporte no amplía los permisos. La aplicación filtra el descubrimiento y comprueba las capacidades al ejecutar acciones. Los permisos originales son `tasks:read`, `tasks:read_notes` y `tasks:capture`; este último permite capturar una tarea en Inbox, no modificar cualquier tarea.

La adaptación añade `planner:read`, `planner:write`, `tasks:read_history`, `tasks:write` y `time:write`, para separar perfil, histórico, tareas y registro manual. Revisa los nombres y descripciones que devuelve `tools/list` en la compilación instalada. Las nuevas herramientas son:

- `planner_activities`: actividades configuradas.
- `planner_query`: consultas de planificación, progreso y disponibilidad.
- `planner_edit`: cambios de configuración con validación y fecha efectiva.
- `planner_task`: operaciones sobre tareas nativas.
- `planner_log_time`: registro mediante seguimiento nativo, con protección frente a reintentos.
- `planner_prepare`: preparar propuestas revisables sin aplicar cambios.
- `planner_apply`: aplicar la selección explícita de una preparación todavía vigente.
- `planner_operation_status`: consultar el recibo durable de una operación sin repetirla; requiere los permisos de su acción original.

No se debe suponer que todas estarán disponibles con una clave de solo lectura. Los errores de datos incompletos, archivo inaccesible o revisión obsoleta deben conservarse visibles. Los parámetros concretos se consultan en los esquemas descubiertos; los ejemplos de cliente no duplican esos contratos.

## Claude Code

Combina [claude-code.http.json](../packages/plugin-dev/personal-planner/mcp-clients/claude-code.http.json) con `.mcp.json` en el proyecto donde quieras utilizarlo. El encabezado conserva la referencia literal `${SP_ACCESS_KEY}`; Claude Code la expande desde su entorno. Puede pedir aprobación para el servidor del proyecto antes de conectarlo.

También puedes configurar un servidor HTTP con `claude mcp add`, pero no introduzcas una clave literal en sus argumentos. Para comprobar la configuración y la conexión utiliza `claude mcp get super-productivity` o `claude mcp list`. Las órdenes de administración MCP no necesitan consultar un modelo. La sintaxis y expansión corresponden a la [documentación oficial de Claude Code](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json).

## Codex CLI 0.163.0

Combina [codex.http.toml](../packages/plugin-dev/personal-planner/mcp-clients/codex.http.toml) con la configuración de Codex. Usa `bearer_token_env_var = "SP_ACCESS_KEY"`: se guarda el nombre de la variable, no su valor. La alternativa de CLI verificada localmente es:

```bash
codex mcp add super_productivity --url http://127.0.0.1:3876/mcp --bearer-token-env-var SP_ACCESS_KEY
codex mcp get super_productivity --json
```

La primera orden modifica la configuración del cliente cuando tú la ejecutas; combina o elimina entradas existentes según corresponda. `mcp get` demuestra que la entrada se interpreta, no que se haya completado descubrimiento o ejecutado una herramienta. Las opciones se comprobaron con `codex mcp add --help` y `codex mcp get --help` de la versión indicada, sin consultas a modelos.

Si prefieres archivo de clave, utiliza [codex.stdio.toml](../packages/plugin-dev/personal-planner/mcp-clients/codex.stdio.toml), sustituyendo las rutas absolutas al script y al archivo privado.

## OpenCode 2.0.18

Combina [opencode-v2.http.json](../packages/plugin-dev/personal-planner/mcp-clients/opencode-v2.http.json) con `opencode.json` o `opencode.jsonc`. **V2 utiliza `mcp.servers`**; no utilices la estructura directa bajo `mcp` de los ejemplos V1. Deshabilitar una entrada se hace con `disabled: true`.

La entrada utiliza `oauth: false`, puesto que la autenticación es una clave de la aplicación, y `codemode: false` para exponer las herramientas directamente. Conserva literal `Bearer {env:SP_ACCESS_KEY}` en el encabezado. Son las opciones de la [guía oficial V2 de MCP](https://dev.opencode.ai/v2/docs/mcp-servers/) y de su [referencia de configuración](https://dev.opencode.ai/v2/docs/config/).

Para comprobar la conexión ejecuta `opencode mcp list`. No inicia una consulta a un modelo. Si prefieres archivo externo, [opencode-v2.stdio.json](../packages/plugin-dev/personal-planner/mcp-clients/opencode-v2.stdio.json) ejecuta el mismo adaptador local. No habilites HTTP y stdio simultáneamente para la misma conexión.

## Claude Desktop: stdio o MCPB

Para configuración manual, combina [claude-desktop.stdio.json](../packages/plugin-dev/personal-planner/mcp-clients/claude-desktop.stdio.json) con `claude_desktop_config.json`. Sustituye las dos rutas de ejemplo. En Windows JSON requiere duplicar las barras inversas; en macOS utiliza rutas absolutas POSIX y un ejecutable Node accesible desde Desktop. Las rutas del sistema donde se ejecuta Desktop son las relevantes: una ruta WSL no es automáticamente una ruta ejecutable de Windows.

Desktop puede no heredar el entorno de una terminal. `SP_ACCESS_KEY_FILE` evita esa dependencia. Otra opción es [claude-desktop.env-file.json](../packages/plugin-dev/personal-planner/mcp-clients/claude-desktop.env-file.json), con [Node 20.6.0 o posterior](https://nodejs.org/en/blog/release/v20.6.0) y un archivo privado de entorno. Este archivo puede definir `SP_ACCESS_KEY_FILE=/RUTA_PRIVADA/super-productivity-mcp.token`. Node carga el archivo antes de ejecutar el adaptador; no se procesa mediante shell.

La conexión manual sigue la [guía oficial de servidores locales MCP](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers). Para instalar como extensión:

```bash
node tools/mcpb/pack.js
```

Instala `dist/super-productivity.mcpb` en Desktop. El manifiesto ofrece archivo externo o un campo sensible para la clave; el archivo tiene prioridad. El formato y los campos sensibles siguen la [especificación oficial MCPB](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md). Nunca añadas el archivo de clave al paquete.

## Errores y reintentos

- `CONFIGURATION_ERROR`: revisa la ruta del archivo privado, formato de clave y URL de loopback. No se devuelve el contenido del archivo.
- Rechazo de clave/HTTP 401: genera una clave MCP válida y actualiza el entorno o archivo. La clave REST no sirve para MCP.
- Permiso rechazado: ajusta las capacidades en la aplicación; cambiar de transporte no las evita.
- Aplicación no disponible: abre Electron y habilita acceso del asistente. El frontend web no sustituye ese proceso.
- `OUTCOME_UNKNOWN`: la petición puede haber modificado datos antes de perderse la respuesta. El adaptador **no reintenta**. Comprueba el estado y, cuando la herramienta admita idempotencia, conserva el mismo `operationId`; no generes otro para repetir a ciegas.
- Propuesta obsoleta: vuelve a preparar y revisar. No apliques automáticamente una propuesta recalculada.

El adaptador usa un plazo total de 60 segundos, superior al presupuesto de captura nativo de 45 segundos. Las llamadas a herramientas con respuesta perdida se consideran inciertas aunque fueran de lectura; es una clasificación conservadora para no duplicar modificaciones. No añade `Origin`, sigue únicamente la URL local configurada y no sigue redirecciones.

## Qué se ha comprobado

Ejecuta las pruebas desde la raíz del checkout:

```bash
node --test tools/mcpb/tests/bridge.test.cjs
node tools/mcpb/tests/client-discovery.cjs --parser-only
```

Las pruebas del adaptador utilizan HTTP simulado y datos ficticios: formato JSON por líneas, orden de respuestas, autenticación, ausencia de `Origin`, lectura de clave externa, errores, timeout y ausencia de reintentos. No contienen horarios personales.

El segundo comando comprueba únicamente el analizador. Para autenticación y descubrimiento reales, sin inferencia y con perfiles temporales, utiliza:

```bash
SP_TEST_ADMIN_CLIENTS=1 node --test tools/mcpb/tests/admin-client-runtime.test.cjs
```

Este último utiliza HTTP ficticio y comprueba que Claude Code y OpenCode realizan `initialize` y `tools/list`. OpenCode se ejecuta como un servidor privado temporal: evita depender del servicio de fondo de `mcp list`, cuyo bloqueo previo no se ha diagnosticado completamente. Ninguno de estos clientes expuso una llamada manual a herramientas mediante sus comandos administrativos inspeccionados.

Las pruebas reales de la aplicación, IPC, persistencia y cliente MCP deben documentarse separadamente con sus resultados. Ninguna lectura de ayuda o simulación demuestra por sí sola que la aplicación instalada soporte estas herramientas.

## Cambios compartidos y formularios abiertos

El panel vuelve a leer el perfil ante cambios externos y al actualizar. Si estás editando, conserva los campos locales y la revisión con la que abriste el formulario. Un guardado obsoleto se rechaza; la acción «Descartar borrador y cargar configuración actual» es explícita. Copia primero lo que quieras conservar del borrador.

Los guardados del panel utilizan las mismas operaciones validadas que MCP, con revisión y `operationId`; no sustituyen directamente el perfil sin comprobar su versión. Si una aplicación antigua no ofrece comparación y guardado, el panel explica que hay que actualizarla y no utiliza una escritura sin protección como alternativa.

Las propuestas que se revisan en el formulario manual también comprueban cambios de perfil y tareas antes de guardar. La operación MCP `planner_apply` añade la comprobación nativa final del anfitrión. El formulario manual no constituye una transacción atómica con el temporizador nativo: al configurar una reserva, revisa los conflictos visibles y el estado actual.

La prueba Electron puede incluir Codex con `PLANNER_MCP_CODEX=1` y Claude Code/OpenCode con `PLANNER_MCP_ADMIN_CLIENTS=1`. Codex ejecuta una consulta mediante app-server sin iniciar turnos; los otros dos realizan conexión y descubrimiento administrativos. El SDK oficial MCP prueba llamadas HTTP y stdio. Los resultados efectivamente obtenidos se documentan en [VALIDACION-LIMITES.md](../packages/plugin-dev/personal-planner/VALIDACION-LIMITES.md).

Claude Desktop 1.20186.1.0 se arrancó con `CLAUDE_USER_DATA_DIR` aislado en Windows. Permaneció en la pantalla de inicio de sesión y no inició MCP durante la observación. No se utilizaron credenciales personales: falta comprobar el cliente después de iniciar sesión. Las instrucciones stdio y MCPB quedan preparadas, y el transporte se prueba separadamente con el SDK oficial.
