# Puente MCP local para Super Productivity

Este adaptador conecta clientes stdio, incluido Claude Desktop, con el endpoint MCP de la aplicación Electron abierta: `http://127.0.0.1:3876/mcp`. Reenvía JSON-RPC como líneas JSON; no crea otro backend ni almacena tareas, perfiles o claves. No llama a ningún modelo.

La aplicación decide las herramientas y los permisos. La versión publicada 19.2.0 original no contiene este endpoint; utiliza la adaptación compatible. La aplicación debe permanecer abierta, también funciona minimizada. El frontend web de desarrollo en el puerto 4255 no ofrece MCP.

## Uso como extensión de Desktop

1. En Super Productivity, habilita el acceso del asistente en Ajustes, concede los permisos necesarios y genera una clave MCP `sp_mcp_`. Es independiente de la clave REST.
2. Crea un archivo privado, fuera del repositorio, que contenga únicamente esa clave. Limita sus permisos al usuario actual.
3. Ejecuta `node tools/mcpb/pack.js`. Se genera `dist/super-productivity.mcpb`.
4. Instala el archivo en las extensiones de Claude Desktop y selecciona el archivo de clave. También se puede introducir la clave en el campo sensible de la extensión; el archivo tiene prioridad.

El paquete solo contiene una lista explícita de archivos públicos. Nunca copies el archivo privado al directorio de la extensión ni al paquete.

## Uso por stdio sin extensión

Configura el cliente para ejecutar `node /RUTA/tools/mcpb/server/index.js`, con una de estas variables:

- `SP_ACCESS_KEY_FILE`: ruta absoluta a un archivo privado con la clave. Tiene prioridad.
- `SP_ACCESS_KEY`: clave MCP en el entorno del proceso.
- `SP_MCP_URL`: opcional; por defecto `http://127.0.0.1:3876/mcp`. Solo acepta HTTP con dirección literal de loopback, ruta `/mcp` y sin credenciales, consulta o fragmento. No permite servidores externos ni sigue redirecciones.

Node 18 o posterior es suficiente. Para usar el argumento de Node `--env-file=/RUTA_PRIVADA/archivo.env`, hace falta Node 20.6.0 o posterior; el archivo queda fuera de Git. Desktop puede no heredar las variables de una terminal: el archivo de clave evita esa dependencia.

El puente no envía encabezado `Origin`, no escribe claves o encabezados en stdout/stderr y no reintenta solicitudes. Un timeout o una respuesta perdida después de una llamada a herramienta puede devolver `OUTCOME_UNKNOWN`: revisa el estado o utiliza el mismo `operationId` si la herramienta lo admite; no repitas una modificación a ciegas.

## Comprobaciones

```bash
node --test tools/mcpb/tests/bridge.test.cjs
node tools/mcpb/tests/client-discovery.cjs --parser-only
```

La primera orden usa un servidor HTTP simulado con datos ficticios. La segunda comprueba analizadores de configuración con una URL de servidor ficticio, sin consultas a modelos ni cambios en la configuración real de los clientes. No inicia descubrimiento MCP de los clientes. Ninguna sustituye una prueba contra Electron.

Ejemplos públicos y guía: `packages/plugin-dev/personal-planner/mcp-clients/` y `docs/planner-mcp-clients.md` en el repositorio. Los clientes con transporte HTTP pueden acceder directamente al mismo endpoint, sin este adaptador.
