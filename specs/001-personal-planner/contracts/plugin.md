# Contrato de integración

API: getTasks, getArchivedTasks, getAllProjects, getAllTags, getAppState (configuración del día lógico), loadSyncedData y persistDataSynced. selectTask abre detalle y reutiliza temporizador nativo. Datos entran como snapshot; objetos recibidos nunca se mutan. Perfil pertenece exclusivamente al almacenamiento del plugin. Fallos parciales del archivo impiden afirmar totales históricos completos. El plugin no mueve ni completa tareas automáticamente.

## Confirmación durable

`persistDataSynced` conserva firma y clave. En el fork corregido, su promesa espera el lote coalescido, despacho y flush durable existente; un fallo de disco o cancelación rechaza. La interfaz anuncia guardado únicamente tras resolver esa promesa. La versión base sin parche no ofrece esta garantía: leer el dato inmediatamente tampoco la demuestra porque devuelve memoria pendiente.
