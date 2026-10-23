# Inicio rápido

Usar este fork con la corrección de confirmación durable. Desde la raíz, instalar dependencias con la versión de Node de `.nvmrc` y ejecutar `npm run startFrontend -- --port 4255`.

Desde `packages/plugin-dev`, ejecutar `npm ci`, `npm run test --workspace personal-planner`, `npm run build --workspace personal-planner` y `npm run check --workspace personal-planner`. Instalar Chromium mediante `npx playwright install chromium`; ejecutar `npm run test:browser --workspace personal-planner` (API simulada) y `npm run test:app --workspace personal-planner` con el anfitrión arrancado (API y almacenamiento reales).

Importar `personal-planner/dist/personal-planner.zip` en Ajustes > Plugins y abrir Mi planificación. Crear actividades o importar un perfil privado; la demostración opcional usa datos ficticios. Exportar copia privada antes de actualizar.
