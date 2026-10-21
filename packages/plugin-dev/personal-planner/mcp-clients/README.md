# Ejemplos de clientes MCP

Estos archivos contienen únicamente configuraciones de transporte y rutas de ejemplo. No incluyen claves, horarios ni datos de usuario. Sustituye las rutas antes de utilizarlos y combina la entrada con tu configuración existente: no reemplaces todo el archivo del cliente.

- `claude-code.http.json`: entrada para `.mcp.json`; necesita `SP_ACCESS_KEY` en el entorno del cliente.
- `codex.http.toml`: bloque para la configuración de Codex 0.163.0; necesita `SP_ACCESS_KEY` en su entorno.
- `opencode-v2.http.json`: configuración de OpenCode 2.0.18. V2 usa `mcp.servers`, no la estructura de V1.
- `claude-desktop.stdio.json`: puente local con un archivo privado que contiene la clave MCP. En macOS utiliza rutas absolutas POSIX.
- `claude-desktop.env-file.json`: alternativa con un archivo de entorno privado, para Node con `--env-file` (20.6.0 o posterior).
- `codex.stdio.toml` y `opencode-v2.stdio.json`: alternativa stdio cuando conviene leer la clave desde un archivo externo.

Escoge HTTP o stdio para cada conexión; no actives ambas entradas con el mismo propósito. El transporte no cambia los permisos concedidos por la aplicación.

Consulta [la guía completa](../../../../docs/planner-mcp-clients.md) para versiones compatibles, instalación, permisos y verificación. La versión publicada 19.2.0 original no incorpora este MCP; hace falta la aplicación Electron de esta adaptación o una compilación compatible.
