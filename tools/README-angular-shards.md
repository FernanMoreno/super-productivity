# Verificación Angular por particiones

El ejecutor opcional utiliza la partición nativa de `karma-jasmine`, con seis
procesos y navegadores consecutivos. Cada partición carga la misma lista completa
de pruebas y ejecuta su intervalo. Conserva las aserciones, los tiempos de espera
de Karma y los errores de la configuración habitual. No cambia `npm test`.

```bash
node tools/test-angular-shards.cjs
```

La zona predeterminada es `Europe/Berlin`. Se respeta una variable `TZ` explícita.
El límite predeterminado de seis minutos por proceso incluye la compilación. Al
superarlo, el ejecutor termina su propio árbol de procesos y devuelve un error.
Se pueden ajustar los límites sin modificar las pruebas:

```bash
TZ=America/Los_Angeles node tools/test-angular-shards.cjs --shards=6 --timeout-ms=360000 -- --include='src/app/util/**/*.spec.ts'
```

Los argumentos después de `--` se pasan a Angular. Un filtro `--include` verifica
únicamente su selección; no equivale a una ejecución completa. El ejecutor rechaza
sobrescribir la configuración de Karma, el navegador o `--watch`.

Las pruebas usan una semilla reproducible (`248163`, ajustable mediante `--seed`).
El resumen JSON distingue pruebas aprobadas, fallidas, pendientes y deshabilitadas.
Comprueba que todas las particiones descubren los mismos identificadores y nombres
y que ninguna prueba activa se ejecuta dos veces. Una partición incompleta, una
salida distinta de cero o un informe ausente hacen fallar el comando. Los informes
se conservan en la carpeta temporal que imprime al comenzar.
Durante la ejecución se actualiza un informe provisional cada dos segundos,
incluyendo la última prueba iniciada. Conserva `completed: false` hasta que Karma
confirma el final del navegador. Un límite de tiempo agotado significa que la
validación quedó incompleta; no demuestra que haya fallado una aserción.

El contenedor de Karma también conecta el diagnóstico existente que identifica la
prueba en ejecución cuando se desconecta el navegador. Una ejecución satisfactoria
por particiones demuestra esa ejecución; no demuestra que una ejecución monolítica
desconectada haya dejado de tener un problema de orden o recursos.

Este comando cubre las pruebas Angular, no las pruebas de paquetes, herramientas,
Electron ni las comprobaciones de traducciones. Deben ejecutarse aparte según el
alcance del cambio. Pruebas del propio ejecutor:

```bash
node --test tools/test-angular-shards.test.cjs
```
