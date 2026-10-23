# Planificador personal local: revisión y decisiones reversibles

Base: ff317dd24420e5a46f9ca570daa6fd18089effa7, plugin 0.4.0; MIT. Rama local feat/planner-review-local. No commits, publicación, PR, releases ni servicios remotos en este encargo.

## Escenarios y pruebas de usuario

P1: Configurar desde la interfaz actividades/objetivos/horarios editables; conservar identificadores y pasado al modificar futuras ocurrencias. Empezar vacío o con demo ficticia. Reutilizar las capacidades existentes y cubrir las brechas verificadas.

P1: Abrir una revisión de un intervalo, atender asuntos, interrumpirla y continuar tras reinicio. Marcar revisado no completa tareas ni inventa tiempo. Señalar tareas sin clasificar, aplazadas desde que se observa su planificación, actividades previstas sin registro, proyectos sin próxima acción y objetivos en riesgo. Mantener, reprogramar, dividir, pausar, archivar y corregir duración mediante operaciones compatibles.

P1: Ver tabla semanal por tarea/día con plan previo persistido y duración real editable sin inventar instantes. Reorganizar después no altera la comparación capturada. Incluye tareas archivadas para lectura, sin doble suma de padres/subtareas/etiquetas.

P1: Sugerir hasta tres acciones viables usando hueco, contexto, estimación, vencimiento, prioridad, metas y bloqueo manual. Explicar motivos y permitir otra elección. Sin hueco o tarea válida, devolver razón; conservar márgenes y descansos. Misma función pura UI/MCP, sin modelos.

P1: Preparar propuesta, ajustar franjas y seleccionar, comprobar revisiones, aplicar con identificador durable, consultar diferencias y deshacer por selección. Revertir solamente planificación; conservar tiempo, completado y cambios ajenos posteriores. Conflictos por campo explicados y reversión parcial explícita; nunca restauración global.

P1: Consultar y modificar desde MCP local autenticado contra Electron y reflejar cambios en panel. Herramientas de revisión, siguientes acciones, corrección y undo con permisos en host/servidor y reintentos protegidos. Mantener adaptador stdio común y ejemplos sin claves.

## Requisitos funcionales

FR01 Configuración general editable y exportable, español inicial, locale del anfitrión, temas, teclado, móvil, errores y vacíos claros.
FR02 Capacidad por unión de intervalos, laboral/personal y ámbitos configurables, excepción/vigencia/ausencias/márgenes; distinguir contigüidad de conflicto. Eventos externos nativos identificados/deduplicados; fallo de lectura provisional explícito.
FR03 Tiempo en ms nativos y día civil compatible; distinguir duración de intervalo conocido. No escribir campos de tracking directamente.
FR04 Metadatos adicionales separados de tareas/proyectos/tiempo; persistencia y recibos existentes con revisión condicional. Compatibilidad con perfiles previos.
FR05 Revisiones guardan elementos, decisiones, fecha y baseline; historia de aplazamiento solo desde observación, no inventada retroactivamente.
FR06 Reorganizaciones conservan before/after de campos planificados, recibos y estado; undo conserva posteriores hechos nativos y verifica guardas antes del despacho.
FR07 Integración local existente; REST y MCP independientes; credenciales/datos privados fuera del código/artefactos. Publicar herramientas implementadas y probadas solamente.

## Criterios de éxito

Completar instalar/configurar actividad y objetivo/planificar/registrar/revisar/consultar y modificar con MCP con perfil sintético. Verificar los 17 escenarios del encargo, separados en pruebas puras, simuladas y reales. Entregar ZIP y host local compatibles, README ES, ejemplos, versiones, resultados y límites concretos.

## Supuestos y exclusiones

No se requieren cuentas nuevas ni llamadas a modelos. Offline-first, misma máquina. No reconstruir sesiones o aplazamientos históricos inexistentes. No acceso remoto, WIP, dependencias completas, ActivityWatch, estimación aprendida ni plantillas temporales. No modificar instancia personal abierta.
