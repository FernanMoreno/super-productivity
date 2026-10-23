# Distribución reproducible del planificador

Este flujo prepara una aplicación mínima con el frontend y Electron ya compilados. No modifica las dependencias raíz ni instala o inicia la aplicación del usuario. La carpeta temporal contiene exclusivamente una lista permitida de archivos públicos y las dependencias realmente importadas por Electron; cada versión instalada se comprueba contra `package-lock.json`.

Desde la raíz, con las dependencias del proyecto instaladas y las compilaciones habituales terminadas:

```sh
node --test tools/planner-distribution/pipeline.test.cjs
node tools/planner-distribution/build.cjs all
# También: linux o windows; segundo argumento opcional: directorio de salida.
```

Las versiones de la aplicación, Electron y dependencias provienen del proyecto y su lockfile. Se reutilizan `electron-builder.yaml`, los hooks originales y los recursos de instalación. Cada ejecución crea un staging nuevo en `.tmp/planner-distribution`; los artefactos quedan en sus carpetas `linux` y `win32`. No se publica nada (`publish: never`).

Linux requiere Rust/Cargo y las bibliotecas de desarrollo necesarias para el ayudante Wayland. Se incluye `~/.cargo/bin` en PATH y se exige que el build bloqueado del ayudante termine correctamente. El ZIP incorpora el wrapper y el ejecutable del ayudante mediante el hook original.

Windows desde WSL utiliza Node nativo de Windows (`C:\Program Files\nodejs\node.exe`; configurable con `SP_WINDOWS_NODE`, ruta WSL). Necesita interoperabilidad WSL y `wslpath`. El staging predeterminado debe estar en una unidad de Windows, como el checkout bajo `/mnt/c`. Electron-builder se ejecuta mediante ese Node y descarga Electron para Windows y las herramientas NSIS; no necesita Wine. Se genera un instalador NSIS x64 sin firma digital. No se ejecuta el instalador. Si aparecen addons `.node` en las dependencias, el flujo falla y exige un rebuild específico de Windows.

El frontend debe actualizarse mediante el proceso de compilación habitual antes de una entrega final. Generar un instalador no equivale a probarlo en una sesión de Windows ni a verificar el protocolo Wayland con un compositor real. Para pruebas manuales posteriores use una máquina/perfil aislado; una instalación normal puede registrar protocolos del producto.

Referencias: [CLI electron-builder 26](https://www.electron.build/v26/docs/cli/), [Windows electron-builder 26](https://www.electron.build/v26/docs/win/). La configuración efectiva se conserva como `builder-request.json` dentro del staging generado; no contiene credenciales ni datos personales.

El instalador Windows usa identidad de fork: `com.super-productivity.personal-planner`, nombre de paquete `super-productivity-planner` y nombre visible `Super Productivity Planner`. Su instalación, desinstalación y carpeta de datos predeterminada quedan separadas del producto original. No importa automáticamente datos anteriores. Linux conserva la identidad upstream para mantener los hooks y las convenciones del escritorio originales; para pruebas use `--user-data-dir` independiente. La API REST/MCP sigue usando los puertos locales del producto: dos instancias no pueden ocupar el mismo puerto simultáneamente.

Puede seleccionar un frontend compilado independiente sin reemplazar el servido actualmente:

```sh
SP_PLANNER_FRONTEND_DIR=/ruta/al/frontend-compilado node tools/planner-distribution/build.cjs all
```

El origen necesita `browser/index.html` y `3rdpartylicenses.txt`; se instala dentro de `.tmp/angular-dist` del staging y se rechazan enlaces simbólicos. La ruta relativa se interpreta desde el directorio de ejecución.

Para un arranque portátil o de prueba que no cambie asociaciones del sistema, añada `--no-protocol-registration`. Este argumento omite únicamente el registro de `superproductivity://`; mantiene la recepción de enlaces existentes. Combínelo con `--user-data-dir` apuntando a un directorio temporal nuevo.

`smoke-windows.cjs`, ejecutado con Node de Windows y la ruta al EXE **desempaquetado**, verifica una página Angular real mediante CDP local, con un perfil temporal nuevo y registro de protocolos desactivado. Rechaza instaladores y builds sin el argumento de exclusión; cierra únicamente su propio proceso y borra únicamente su perfil temporal. No imprime contenido de tareas, registros ni credenciales.

El ayudante Linux generado en este entorno requiere glibc 2.34 o posterior (símbolos comprobados con `readelf --version-info`). Para soportar distribuciones anteriores hay que compilarlo en una base compatible; incluir el ELF no garantiza compatibilidad con cualquier distribución. WSLg permite arrancar el binario, pero su compositor no anuncia `ext-idle-notify`, por lo que este entorno no verifica eventos de inactividad de ese protocolo.

El smoke comprueba también el puente `window.ea`, la respuesta IPC de acceso a asistentes y que la carpeta de datos activa sea exactamente el perfil temporal. Con `--mcp` genera una credencial efímera en memoria, concede únicamente `planner:read`, comprueba `initialize`, el filtrado de herramientas y un perfil vacío mediante HTTP nativo de Windows. Requiere que el puerto 3876 esté libre; desactiva el acceso al terminar y elimina el perfil temporal. No equivale a validar el panel del plugin.

El preflight rechaza un `electron/preload.js` sin empaquetar que importe módulos distintos de `electron`. La compilación canónica necesaria es `npm run electron:build`: ejecutar solamente `tsc` sobrescribe el bundle de preload y produce una aplicación incompatible con el sandbox.
