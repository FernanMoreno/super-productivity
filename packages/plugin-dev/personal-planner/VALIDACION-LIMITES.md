# Validación del planificador 0.4.0

Fecha: 21 de octubre de 2026. Base: Super Productivity de desarrollo 19.2.0, commit upstream `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`. La publicación upstream con el mismo número no incorpora este MCP. MIT y créditos originales conservados.

## Aplicación y clientes reales

- **Linux x64 empaquetado:** prueba Electron completa aprobada contra el ejecutable de la distribución final. Perfil temporal ficticio. Importación del ZIP, lectura real de tareas, tiempo registrado una sola vez ante reintentos, recibos, cambio UI→MCP y MCP→UI, rechazo de propuestas obsoletas, programación nativa seleccionada y persistencia tras recarga. También se preparó y aplicó una tarea nativa desde el panel con el acceso MCP deshabilitado; al habilitarlo de nuevo la consulta confirmó el cambio.
- **Windows nativo:** aplicación desempaquetada de la distribución NSIS arrancada y cerrada con perfil temporal. Angular, preload, IPC, ubicación de datos aislada y MCP nativo comprobados. Descubrimiento filtrado y consulta de actividades vacías aprobados. El instalador NSIS se construyó, pero no se ejecutó una instalación en el perfil del usuario. Panel completo y registros de tiempo en Windows no se acreditan con este smoke.
- **Codex CLI 0.163.0:** descubrimiento y `planner_query` reales contra el paquete Linux mediante app-server. Sin iniciar turnos ni llamar a modelos.
- **Claude Code 2.1.303 y OpenCode 2.0.18:** autenticación y descubrimiento administrativos reales contra ese mismo paquete. Sus interfaces administrativas inspeccionadas no expusieron una llamada manual a herramientas; no se atribuye esa comprobación. También pasaron dos fixtures HTTP separados.
- **SDK MCP oficial 1.32.1:** llamadas reales por Streamable HTTP y por el adaptador stdio con archivo privado de clave.
- **Claude Desktop 1.20186.1.0:** arranque real con perfil Windows aislado y adaptador stdio. Permaneció en la página de login y no inició MCP durante la observación. Pendiente probarlo con sesión iniciada; no se usaron credenciales personales.

Todas las credenciales de prueba se generaron en memoria o archivos temporales privados, y se eliminaron al terminar. Las pruebas no modificaron la aplicación ni la configuración personal abiertas.

## Comprobaciones automatizadas

| Comprobación | Resultado |
| --- | --- |
| Angular completo, Europe/Berlin, una sola ejecución | 17.959 aprobadas, 2 benchmarks pendientes, 0 fallos. Auditoría: 17.961 identificadores descubiertos, sin duplicados y ejecución completa. |
| Angular focalizado final America/Los_Angeles: servicios nativos, puente, persistencia, CAS y CalDAV | 163 aprobadas, sin pendientes ni fallos. Incluye los dos casos finales: cadena vacía presente y tipo persistido inválido. Regresiones observadas primero en rojo y después verdes. |
| Subconjunto Angular canónico America/Los_Angeles | 6.038 aprobadas, 14 pendientes, 0 fallos; 6.052 identificadores descubiertos sin duplicados. |
| Núcleo y plugin en America/Los_Angeles | 95 aprobadas: fechas civiles, cambios de hora, unión de ocupaciones, capacidad laboral/personal, archivo, padres/subtareas y propuestas. |
| Navegador con API simulada | Cuatro fixtures aprobados. Incluyen temas, móvil, teclado, estados vacíos/errores, recurrencias, borradores y cambios externos; resultado incierto y doble envío con espera controlada. |
| Paquetes compartidos upstream | 282 sync-core, 95 shared-schema y 467 sync-providers aprobadas. |
| Herramientas de notas de publicación | 33 aprobadas. |
| Typecheck API, checkFile, lint del repositorio y composición | Aprobados. El tipo API ignorado por ESLint raíz se verifica con su propio typecheck. |
| Construcción de paquetes y producción | 29/29 paquetes, frontend de producción y compilación canónica Electron aprobados. |

Electron/Node, núcleo, contratos y pipeline: **477 pruebas aprobadas**, sin fallos. La batería completa de Berlín y el subconjunto canónico LA se ejecutaron antes del último ajuste de lectura vacía; la compilación de producción y las 163 pruebas focalizadas verifican ese ajuste final. No se atribuye una segunda ejecución completa al código final. Graphify actualizado: 329 nodos y 917 aristas sobre 26 archivos del alcance; extracción AST sin llamadas a modelos. Las conclusiones se contrastaron con fuente y pruebas reales.

## Fallos encontrados y corregidos

1. La dependencia CalDAV instalada en el caché omitía el parche que ya existía en el repositorio. Se reprodujeron 47 aprobadas y 1 fallo, se aplicó ese parche existente y la batería completa quedó verde. No se cambió CalDAV para acomodar un entorno incorrecto.
2. Un valor persistido presente pero vacío se confundía con ausencia y podía provocar reintentos CAS recursivos; ahora se conserva y valida. Los tipos persistidos inválidos se rechazan. La lectura comprimida corrupta y el archivo inaccesible se presentaban como ausencia de datos. Ahora los errores se propagan y el panel distingue falta de información de cero registros.
3. Se corrigieron carreras de revocación de permisos, cambios de perfil/día lógico, guardas de propuestas, y doble envío durante una aplicación pendiente.
4. Un `tsc` aislado sobrescribía el preload empaquetado y rompía `window.ea`. La compilación canónica lo reconstruye; el nuevo preflight rechaza ese paquete antes de distribuirlo. Se comprobó después el preload y MCP reales en Linux y Windows.
5. El límite inicial de seis minutos cortó la suite general mientras avanzaba. La repetición completa con un límite mayor terminó sin fallos. No se declara aprobada la ejecución interrumpida ni se debilitaron aserciones.

## Alcance y condiciones reales

La integración local requiere mantener abierta la aplicación Electron; puede estar minimizada. La página web no contiene un listener MCP. Los distintos asistentes locales usan la misma instancia y los mismos datos.

La comparación condicional protege escritores del mismo renderizador. La sincronización offline entre equipos sigue usando los contratos nativos de última escritura por entidad; no proporciona exclusión distribuida ni exactamente una vez entre equipos desconectados. Los recibos pendientes conservan la protección contra duplicados y comunican incertidumbre; su consulta no inventa una confirmación perdida.

Los agregados diarios nativos no contienen sesiones originales que permitan reconstruir retrospectivamente otra zona o frontera lógica de día. La disponibilidad sigue marcada como parcial hasta que el usuario configure o declare no aplicables sueño, desplazamientos, comidas y márgenes. Son datos que deben aportarse, no errores que puedan corregirse inventándolos.

Las selecciones nativas y los bloques propios se aplican por separado. Los cambios de serie reutilizan el flujo nativo, que abarca configuración e instancias activas/archivadas y puede quedar parcialmente confirmado ante un fallo: se devuelve `OUTCOME_UNKNOWN`. No se promete una transacción entre varias entidades y el recibo.

El instalador Windows no tiene firma digital. El helper Wayland se compila e incluye en Linux; WSLg no anuncia el protocolo `ext-idle-notify`, por lo que no acredita eventos de inactividad. El binario generado requiere glibc 2.34 o posterior.
