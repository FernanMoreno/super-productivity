# Validación y límites

Base: Super Productivity **19.2.0**, commit `78139c531c808bab7c46ef96fd0fbb0a3b6f7d6d`. La rama `feat/personal-planner` añade el plugin 0.2.0 y una corrección mínima de confirmación durable. MIT y créditos originales conservados. Entorno: WSL/Linux, Chromium headless 149, Node 24.19.0; el desarrollo habitual debe usar `.nvmrc`.

## Motor y contratos

59 pruebas automatizadas con datos ficticios: migración, historial de objetivos/estados/progreso, asociaciones estables, archivo y deduplicación por ID, padres/subtareas, días civiles y semana configurable, DST de 23/25 horas y horas ambiguas/inexistentes, unión de intervalos, capacidad laboral/personal, contigüidad y solapamiento, añadir/quitar trabajo extra, ausencias, ventanas, flexibles, propuestas, recurrencias individuales/futuras y estados vacíos/error.

Las pruebas también pasan con `TZ=America/Los_Angeles`; las fechas del perfil siguen su zona IANA. Cobertura del motor de horario en esa ejecución: 99,17 % líneas y 94,65 % ramas. No equivale a cobertura de toda la aplicación.

`npm run check` verifica grafo de imports sin ciclos con control negativo, dirección de dependencias, métodos en tipos/iframe reales y contenido del ZIP. Dos compilaciones consecutivas producen el mismo SHA-256. ZIP limitado a manifiesto, interfaz autocontenida, LICENSE y NOTICE; sin perfiles ni fixtures.

## Interfaz con API simulada

Dos recorridos Playwright/Chromium comprueban inicio vacío/demo, tareas y registros, creación y orden de actividades, edición temporal, archivo, recurrencias, reservas revisadas, importación/persistencia simulada, recarga, rechazo de acceso/guardado, ausencia de API, escape de contenido, teclado, móvil y temas. La API simulada no prueba IndexedDB ni el puente real.

## Integración real y núcleo

El recorrido `tests/in-app.mjs` importa el ZIP desde Ajustes > Plugins en un contexto aislado, activa la ruta, crea tarea/etiqueta ficticias mediante API pública, vincula una actividad, guarda dos ediciones rápidas, recarga inmediatamente, registra tiempo mediante el temporizador nativo, consulta ese registro y abre el detalle nativo. También verifica los dos temas del anfitrión. **Resultado final: pasa** sobre la compilación estática del fork servida localmente, con API, op-log e IndexedDB reales. No toca una instalación personal.

Esta prueba detectó pérdida de la segunda edición en la base original: el puente no esperaba la promesa y la cola de coalescencia confirmaba antes del despacho. El fork mantiene acciones y formato, pero espera cada lote, el flush existente y el indicador de fallos durables. Durante aplicación remota rechaza el guardado para reintentar, evitando confirmar acciones diferidas fuera del contador. No modifica el protocolo de sincronización.

La batería ampliada final de plugins, captura del op-log y flush obtuvo **926 éxitos, 0 fallos**. `checkFile` pasó sobre los cuatro archivos TypeScript modificados. Los tests del núcleo comprueban confirmación aplazada, último valor coalescido, cancelación, nuevo lote durante despacho, propagación de errores, rechazo durante aplicación remota y espera del flush. La sincronización entre dos dispositivos y fallos reales de disco no se han probado de extremo a extremo.

## Batería general y alcance

La batería general ejecutada antes de la corrección del núcleo obtuvo **17.922 éxitos, 1 fallo y 2 omitidas** en Europe/Berlin. El fallo es `CaldavClientService._get_client`: respuesta de red con propiedad `map` indefinida. Se reprodujo por separado en código sin modificar: **47 éxitos, el mismo fallo**. Esa interrupción impidió la segunda pasada general en America/Los_Angeles. No se atribuye ese fallo al plugin ni se afirma que toda la batería general esté verde.

La revisión ECC con agentes Codex corrigió hallazgos de versiones temporales, recurrencias, carga jerárquica, reservas flexibles y durabilidad. Graphify se contrastó con los métodos de API, almacenamiento, captura y flush reales. El checker global de composición valida el proyecto registrado; los checks específicos anteriores cubren el plugin.

## Límites funcionales

- El ZIP puede importarse en la base 19.2.0; la confirmación durable exige el anfitrión de este fork. Se entrega una compilación web local de desarrollo del anfitrión corregido, con licencias de terceros; no es un instalador de escritorio ni se ha validado para despliegue público.
- Las propuestas son revisables y se guardan como bloques del plugin. No se mueve el calendario nativo ni se editan series nativas.
- El archivo puede ocultar errores devolviendo una lista vacía. El panel advierte que el histórico no se puede certificar completo.
- Los días lógicos nativos no se pueden redistribuir por zona a partir de agregados. El panel explica requisitos y datos desconocidos.
- Las asociaciones actuales reclasifican el histórico; solo objetivos, estado y progreso manual tienen revisiones temporales.
- El buscador reserva sesiones continuas por prioridad; no optimiza globalmente ni fragmenta automáticamente. Un presupuesto jerárquico con restricciones individuales incompatibles se señala como estimación parcial.
- Persistencia por clave con última escritura ganadora: no editar simultáneamente el mismo perfil desde varios dispositivos.
- Descanso, desplazamientos y márgenes sin definir mantienen la capacidad como parcial.

El perfil personal opcional se entrega fuera del repositorio y del ZIP. Las verificaciones de sus casos se realizan localmente; sus horarios y objetivos no se incluyen en esta documentación.

## Artefacto del anfitrión

`npm run buildFrontend:dev -- --extract-licenses` terminó correctamente. El paquete web incluye esa compilación, licencias originales/de terceros, plugin instalable y guías; no incluye datos del navegador. La integración real final se ejecutó sirviendo su directorio estático con Python 3. El servidor de desarrollo con polling en WSL agotó el tiempo de navegación; esa ejecución fallida no se cuenta como validación funcional. Los plugins opcionales preinstalados de upstream no se construyeron: sus manifiestos ausentes producen avisos 404; el plugin personal se importa y prueba desde su ZIP.
