# Revisión de composición

## Límites e invariantes

- API nativa → adapter: llamadas soportadas, límites de espera y fallos parciales explícitos; archivo puede ocultar errores. Tareas/tiempos nativos son única fuente de verdad.
- adapter → métricas: ms, ID único, hojas y herencia de asociaciones; días nativos agregados no se reconstruyen sin sesiones. Perfil y dispositivo deben coincidir para certificar día civil.
- modelo → horario: configuración versionada con IDs estables; unión de ocupaciones, separación laboral/personal, vigencias/recurrencias y DST. Reservas aceptadas acreditan demanda sin duplicarla; incertidumbre jerárquica permanece visible.
- UI → persistencia: validar antes de guardar, conservar formulario ante rechazo, confirmar tras promesa; migración solo se escribe al guardar. Importar reemplaza configuración, no tareas.
- cola del anfitrión → store/op-log/IndexedDB: coalescencia por entidad con último valor; lotes independientes extraídos antes de esperar; generación cancela escrituras borradas; cadenas no dejan rechazos huérfanos. Puente espera flush fuera del lock y comprueba indicador de fallo. Durante aplicación remota se rechaza antes de dispatch porque la cola diferida no participa en el contador.
- sync: formato, acción, clasificación y metadatos existentes; ninguna migración ni nueva operación. Última escritura por clave; concurrencia de edición multidispositivo no se resuelve por campo.
- recursos: sin backend ni llamadas de red del plugin; assets y licencia empaquetados con allowlist; perfiles fuera de Git. Contextos Chromium de pruebas aislados se cierran al terminar.

## Evidencia

Grafo API/plugin y subsistema plugins generado con Graphify; métodos y caminos importantes contrastados con fuente. Checks de arquitectura/imports/contrato y ZIP incluyen control negativo. Pruebas del motor e interfaz cruzan asociaciones, jerarquías, recurrencias, cambios temporales y reservas. Integración real cruza ZIP, iframe, API, NgRx, op-log, IndexedDB, temporizador y tema. Un fallo real de recarga motivó el parche acotado del núcleo.

ECC revisó arquitectura y calendario, después el diff de persistencia. Se corrigió el hallazgo adicional de acciones diferidas durante sync; su regresión usa la bandera real del metarreductor. No se simula éxito multidispositivo ni disco fallido real. La batería general tiene un fallo CalDAV independiente reproducido; detalle en VALIDACION.md.

Decisión de conocimiento: contratos durables quedan en README, VALIDACION y esta especificación; no se copian perfiles ni se duplica documentación en vault. Ningún skill compartido necesita cambios.
