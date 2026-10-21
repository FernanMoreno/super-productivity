# Cierre de limitaciones del planificador

## Demanda

El usuario pide corregir las limitaciones comunicadas de la versión 0.3.0 utilizando agentes ECC de Codex. Se conserva el fork y la configuración editable, sin servicios nuevos ni datos personales publicados.

## Escenarios y aceptación

1. Una propuesta seleccionada puede programar tareas nativas mediante servicios compatibles. Preparar no modifica datos; aplicar comprueba revisiones, permisos e historial y nunca mueve compromisos silenciosamente.
2. Las tareas con hora y las recurrentes pueden editarse con semántica explícita compatible con los servicios nativos; las operaciones no soportadas se identifican antes de escribir.
3. Una operación puede consultarse por identificador después de perder conexión. Un reintento conserva la protección contra duplicados y nunca convierte incertidumbre en éxito inventado.
4. Los errores de lectura no se interpretan como perfil vacío. La interfaz permite completar los datos necesarios para disponibilidad y muestra su procedencia y carencias.
5. Se amplían las pruebas administrativas reales de clientes disponibles y se entrega un paquete Windows cuando las herramientas del entorno permiten construirlo. La compatibilidad preparada y la comprobada se distinguen.
6. Los fallos reproducidos de la suite general se corrigen por su causa y se verifica el alcance afectado; no se marca una ejecución interrumpida como aprobada.
7. Se preservan datos existentes y compatibilidad de sincronización. La historia que el modelo nunca almacenó no se reconstruye con suposiciones. El acceso local sigue requiriendo aplicación abierta; la versión web no recibe credenciales ni servidor por simulación.

## Límites de integridad

No se puede deducir el horario personal que falta ni recuperar marcas históricas que no fueron guardadas. La corrección consiste en permitir configurar, identificar y gestionar esas carencias. La sincronización offline no ofrece exclusión mutua distribuida: no se anuncia CAS entre equipos sin un protocolo que la garantice. No se debilitan validaciones para ocultar estos hechos.
