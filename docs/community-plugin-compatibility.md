# Compatibilidad de plugins comunitarios

Validación: 22/10/2026. Aplicación modificada: Super Productivity 19.2.0, con espacio de trabajo por proyecto y agrupación por fechas. Las pruebas se ejecutaron en perfiles desechables, tareas ficticias y un servidor local; no se configuraron cuentas externas ni una bóveda personal.

## Resultado

| Plugin y artefacto                        | Resultado comprobado                                                                                                                                                                                                                                                                                | Límites                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bulk Add Tasks 0.1.2                      | ZIP original instalado por el formulario nativo; previsualización e importación de proyecto, padre/hijo, etiquetas y notas. Las tareas aparecen en la lista reorganizada. 39/39 pruebas upstream.                                                                                                   | Las subtareas heredan contexto/etiquetas del padre; la previsualización upstream no debe interpretarse como permiso para etiquetas independientes de subtarea.                                                                                                                                |
| Date Range Reporter 1.13.0                | ZIP original instalado; informe de tarea nativa completada con 10 min, guardado, reapertura y reinicio real de Electron. 128/128 pruebas upstream.                                                                                                                                                  | Umbral predeterminado de 5 min puede ocultar registros pequeños. El filtro de vencidas requiere dueDay.                                                                                                                                                                                       |
| QuestArc 2.2.0-compat.1                   | Adaptación instalada; interfaz, puente de mensajes, evento nativo de completar una tarea, recompensa normal de10 XP y personalizada de25 XP, con persistencia tras reiniciar. Ocho pruebas de regresión/artefacto y recorrido real de plantilla en Electron.                                        | Corregido el fallo upstream que ignoraba reward.xp ya guardado en las notas de tareas compiladas. No recalcula puntos antiguos. Recurrencias nativas no verificadas. El árbol upstream HEAD difiere de la versión publicada y sus fallos de pruebas/typecheck no se presentan como resueltos. |
| Obsidian 1.4.2 original -> 1.4.2-compat.1 | Adaptación mantenida en packages/plugin-dev/obsidian-issue-provider-compat. Instalación/registro en el host real, llamadas de la misma definición contra HTTP local, marcadores estables, creación de checkbox en modo both y ausencia de PUT tras HTTP500. 16/16 regresiones y typecheck estricto. | No se verificó una bóveda real ni el flujo completo de enlace/importación/actualización del adaptador nativo. No resuelve ediciones externas simultáneas: el protocolo usa GET/PUT de nota completa sin escritura condicional.                                                                |

La reorganización no bloqueó los flujos comprobados. Los plugins originales que funcionaron no se duplicaron. La adaptación de Obsidian conserva su ID original y sustituye al proveedor original; no se deben cargar ambas versiones a la vez.

## Fallos de Obsidian reproducidos y corregidos

- Lecturas fallidas 401/500 no se tratan como nota inexistente; solo404 permite inicializar.
- El modo both agrega checkboxes y conserva la nota existente.
- Crear una nota con un nombre ya existente aborta sin sobrescribirla; también se rechazan errores de autenticación/servidor.
- Las colas y la caché reciente se aíslan por URL y origen, sin incluir claves secretas en las claves de almacenamiento.
- La antigua cola sin origen permanece intacta y no se reproduce automáticamente contra un destino desconocido.
- La reproducción de cola es única por origen y conserva cambios añadidos durante la espera HTTP, incluso una versión más reciente del mismo elemento.

## Evidencia y reproducibilidad

Ejecutar con Node24 y el Electron empaquetado local, sin otra instancia que ocupe el puerto3876:

```text
node e2e/electron/community-plugin-smoke.cjs /ruta/al/superproductivity-bin
npm --prefix packages/plugin-dev/obsidian-issue-provider-compat test
npm --prefix packages/plugin-dev/obsidian-issue-provider-compat run build
npm --prefix packages/plugin-dev ci --dry-run --ignore-scripts --no-audit --no-fund
```

El smoke requiere los ZIP originales descargados en sus rutas de auditoría declaradas al principio del script; no descarga ni ejecuta versiones flotantes. El ZIP adaptado se construye desde el paquete local. Solo el perfil ficticio habilita todos los permisos MCP y usa un plugin de inspección generado para las pruebas. Ese plugin no se instala en el perfil personal.

El proveedor Obsidian se prueba usando la definición realmente registrada en el host y peticiones HTTP reales, pero invocada desde la sonda de prueba. No equivale a una prueba completa del adaptador de tareas enlazadas. El contrato HTTP se contrastó además con main.js del compañero obsidian-sp-provider1.1.1, commit99b74be231baf595f0856d91748bf2d656a04da8: 16 comprobaciones contra su servidor HTTP real y una Vault de Obsidian simulada en memoria. Auth, CORS, rutas, respuestas404/401/500 y JSON coinciden con el fixture; search devuelve un array directamente.

El resultado final de Electron contiene cinco escenarios aprobados y reinicio real. Los mensajes de consola no indican cero errores: uno es el HTTP500 inyectado deliberadamente; otro corresponde a /assets/sync-config-default-override.json, un archivo opcional del host que SyncConfigService ya maneja con fallback. No son fallos de carga de estos plugins.

## Versiones y procedencia

### Instalación permanente autorizada

El 22/10/2026, tras la autorización «ponlas en la versión final», se instalaron y activaron los cuatro ZIP evaluados en el perfil personal de la aplicación instalada: Bulk Add Tasks0.1.2, Date Range Reporter1.13.0, QuestArc2.2.0 y Obsidian1.4.2-compat.1. Se verificaron versiones, activación y ausencia de errores de carga tras un reinicio real; las interfaces de Bulk, Reporter y QuestArc abrieron correctamente. Los permisos MCP se conservaron y la comparación completa de las32 tareas con una captura inmediatamente anterior a la instalación coincidió. La aplicación quedó abierta mediante su lanzador habitual.

Obsidian está instalado, pero no se configuró una conexión a una bóveda personal. La limitación de XP personalizado de QuestArc detectada entonces se corrigió e instaló posteriormente, como se detalla a continuación. No se instaló la sonda usada en las pruebas ni se habilitaron permisos adicionales.

### Corrección posterior del XP personalizado de QuestArc

Por petición explícita del usuario se creó packages/plugin-dev/quest-arc-compat, versión2.2.0-compat.1. La compilación de plantilla ya conserva el valor en notes.reward.xp; el primer límite incorrecto era el consumidor de la recompensa, que solo releía el título limpio. La corrección prioriza ese campo existente, después la etiqueta del título y finalmente10 XP. No añade modelos, migraciones ni permisos y conserva el mismo ID del plugin. Sirve también para tareas previamente compiladas que conservan los datos de recompensa en las notas; no reconstruye XP histórico ya otorgado.

Las pruebas ejecutan el script publicado real con su compilador y hooks: el original falla en25/0 XP y tareas existentes, mientras que la adaptación pasa ocho comprobaciones de recompensa, recarga y empaquetado. El recorrido Electron crea una plantilla real, comprueba que el título queda limpio y las notas contienen25 XP, completa la tarea nativa y verifica el incremento10→35 y su persistencia tras reinicio. El smoke de seis escenarios también conserva la compatibilidad de los otros plugins.

Se actualizó únicamente QuestArc en el perfil personal, se comprobó la versión y activación tras reiniciar, y los datos sincronizados propios del plugin coincidieron exactamente antes/después. Las32 tareas y permisos MCP se conservaron. ZIP instalado SHA256 BFEBABC1FF46D5046231AE3A295486A21766E21FDB7697642E60E777A884EAF8. La reconstrucción fija el hash del ZIP original y exige una única coincidencia del cambio; mantiene los recursos originales sin modificaciones y añade la procedencia en COMPATIBILITY.md.

- Bulk: https://github.com/InitialCrow/bulk-add-tasks-plugin/releases/tag/v0.1.2; commitff474e95fc95e3e67cf79c59d7247576873e6307. ZIP7908f4484dc1b8ebe03b716e79f091f0d2c495194ddfa6098ad9e28aabf7740d.
- Reporter: https://github.com/dougcooper/sp-reporter/releases/tag/v1.13.0; commitfd1c657fb9e4e3c5904329c99cd04677b0af3ffa. ZIPeb5473dbe165560899e628876ca6f5787426be31825cd54706f2d39fe2b3a2f1.
- QuestArc: https://codeberg.org/Nexumia/QuestArc/releases/tag/v2.2.0; tag commit00a9a72f6e8eae8120c17d9cf21202ff752c7f1f.
- Obsidian: https://codeberg.org/sinenomine/sp-obsidian/releases/tag/v1.4.2; tag commitc1bafe127ceafaf0c3cc4bc9bd7b89e743c2b20c. El snapshot67af99452e2240191835f216bc054a833bb3595a genera el mismo JavaScript publicado. ZIP adaptado BA61651370C30540C081B0AAD87A1D532A1F97C68237B03FB0BDE6F2EB961E67.

## Licencias y composición

Bulk contiene licencia MIT completa. Reporter declara MIT en package.json pero no incluye un archivo LICENSE independiente; no se copió su código al producto. Obsidian y QuestArc declaran MIT en sus README sin aviso independiente completo. La adaptación de Obsidian conserva autor/procedencia, incluye los términos MIT y documenta la ausencia del aviso original separado. La adaptación posterior de QuestArc conserva su ZIP publicado, autoría y recursos originales, sin rediseñar ni atribuirse sus ilustraciones; documenta su procedencia y la declaración MIT upstream.

Se añadieron únicamente los metadatos de enlace/workspace del nuevo paquete al lock existente. El build conserva LICENSE y README mediante superProductivity.pluginAssets; una instalación limpia npmci en modo dry-run ya no falla. Se preservó el trabajo previo y no se cambiaron APIs ni modelos del host. No se añadieron dependencias de ejecución.

Graphify generó y se verificó el impacto de PluginAPI -> PluginBridgeService -> registro/carga/iframe/adaptador nativo contra el código real. No requiere regenerar las relaciones del host tras esta adaptación: el host no se modificó. Se ejecutó project-composition-check SuperPro y revisión independiente de composición. Ver también specs/013-plugin-compatibility.
