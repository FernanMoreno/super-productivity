import { emptyProfile, validateProfile, migrateProfile } from './model.mjs';
import { taskSnapshot } from './metrics.mjs';
const KEY = 'profile-v1';
export function createAdapter(api) {
  if (!api)
    throw new Error(
      'PluginAPI no disponible. Abre este panel dentro de Super Productivity.',
    );
  const call = async (name, args = []) => {
    if (typeof api[name] !== 'function')
      throw new Error(`API incompatible o sin acceso: ${name}.`);
    // The iframe bridge itself has a timeout. This also bounds direct test/host adapters.
    let timer;
    try {
      return await Promise.race([
        api[name](...args),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Tiempo de espera agotado')), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async load() {
      let raw;
      try {
        raw = await call('loadSyncedData', [KEY]);
      } catch {
        throw new Error(
          'No se puede cargar el perfil. Revisa acceso a datos y reintenta.',
        );
      }
      if (raw === null) return emptyProfile();
      let p;
      try {
        p = JSON.parse(raw);
      } catch {
        throw new Error('El perfil guardado no es JSON válido. No se ha reemplazado.');
      }
      return migrateProfile(p);
    },
    async save(p) {
      validateProfile(p);
      try {
        await call('persistDataSynced', [JSON.stringify(p), KEY]);
      } catch {
        throw new Error(
          'No se pudo guardar. Los cambios no están confirmados; conserva el formulario y reintenta.',
        );
      }
    },
    async snapshot(timezone = 'Europe/Madrid', weekStartsOn = 1) {
      const results = await Promise.allSettled(
        [
          'getTasks',
          'getArchivedTasks',
          'getAllProjects',
          'getAllTags',
          'getAppState',
        ].map((name) => call(name)),
      );
      if (results[0].status === 'rejected' || !Array.isArray(results[0].value))
        throw new Error(
          'No se pueden leer las tareas. Revisa permisos, versión de la aplicación o vuelve a cargar.',
        );
      const value = (i, fallback) =>
        results[i].status === 'fulfilled' ? results[i].value : fallback;
      const warnings = [];
      for (const [i, label] of [
        [1, 'archivo'],
        [2, 'proyectos'],
        [3, 'etiquetas'],
        [4, 'configuración del anfitrión'],
      ])
        if (results[i].status === 'rejected')
          warnings.push(`Sin acceso a ${label}; información parcial.`);
      const snapshot = taskSnapshot(value(0, []), value(1, []));
      if (results[1].status === 'rejected') snapshot.hasIncompleteTasks = true;
      snapshot.timezone = timezone;
      snapshot.weekStartsOn = weekStartsOn;
      const misc = value(4, {})?.globalConfig?.misc;
      const boundary =
        misc?.startOfNextDayTime ??
        (typeof misc?.startOfNextDay === 'number'
          ? `${String(misc.startOfNextDay).padStart(2, '0')}:00`
          : null);
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (boundary !== '00:00' || browserZone !== timezone)
        warnings.push(
          `Los registros usan días lógicos del anfitrión (${boundary ?? 'inicio desconocido'}, ${browserZone}). No se pueden reconstruir días civiles de la zona configurada sin sesiones originales. Ajusta el anfitrión para registros futuros.`,
        );
      warnings.push(
        'Historial: se incluyen archivos devueltos por la API. El anfitrión puede ocultar fallos de lectura del archivo devolviendo una lista vacía; el total histórico no puede certificarse completo.',
      );
      return {
        ...snapshot,
        projects: value(2, []),
        tags: value(3, []).filter((tag) => tag.id !== 'TODAY'),
        warnings: [...warnings, ...snapshot.warnings],
        civilDaysReliable: boundary === '00:00' && browserZone === timezone,
      };
    },
    async selectTask(id) {
      await call('selectTask', [id]);
    },
  };
}
