import { validateProfile } from './model.mjs';
import { createPlannerOperations } from '../../../personal-planner-core/operations.mjs';
import { taskSnapshot } from './metrics.mjs';
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
  let knownRevision;
  const operations = createPlannerOperations({
    read: (key) => call('loadSyncedData', [key]),
    cas: (key, expected, value) =>
      call('compareAndSwapSyncedData', [expected, value, key]),
    snapshot: (profile) => adapter.snapshot(profile.timezone, profile.weekStartsOn),
    native: async () => {
      throw Error('Usa los controles nativos para tareas y tiempo.');
    },
  });
  const adapter = {
    operation: (action, params = {}) => call('plannerOperation', [action, params]),
    async loadWorkflowUiState() {
      const raw = await call('loadSyncedData', ['workflow-ui-state-v1']);
      const value = raw === null ? { pending: [] } : JSON.parse(raw);
      if (!value || !Array.isArray(value.pending))
        throw Error('Estado del panel no válido.');
      return { raw, value };
    },
    async saveWorkflowUiState(raw, value) {
      const next = JSON.stringify(value);
      if (!(await call('compareAndSwapSyncedData', [raw, next, 'workflow-ui-state-v1'])))
        throw Error(
          'El estado del panel cambió en otra ventana; vuelve a abrir la revisión.',
        );
      return next;
    },
    async loadUiState() {
      const raw = await call('loadSyncedData', ['ui-state-v1']);
      if (raw === null) return { raw, value: { pending: [] } };
      const value = JSON.parse(raw);
      if (!value || !Array.isArray(value.pending))
        throw Error('Estado del panel no válido.');
      return { raw, value };
    },
    async saveUiState(raw, value) {
      const next = JSON.stringify(value);
      if (!(await call('compareAndSwapSyncedData', [raw, next, 'ui-state-v1'])))
        throw Error(
          'El estado del panel cambió en otra ventana; vuelve a abrir la revisión.',
        );
      return next;
    },
    prepare: (params) => call('plannerOperation', ['prepare', params]),
    apply: (params) => call('plannerOperation', ['apply', params]),
    operationStatus: (params) => operations.operationStatus(params),
    async loadState() {
      try {
        const state = await operations.activities();
        knownRevision = state.revision;
        return state;
      } catch (error) {
        throw new Error(
          'No se puede cargar el perfil. Revisa acceso a datos, versión y formato del perfil; no se ha reemplazado.',
        );
      }
    },
    async load() {
      return (await adapter.loadState()).profile;
    },
    async save(profile, { baseRevision, operationId = crypto.randomUUID() } = {}) {
      validateProfile(profile);
      if (typeof api.compareAndSwapSyncedData !== 'function')
        throw Error(
          'API no compatible: falta compareAndSwapSyncedData. Actualiza la aplicación para guardar con protección de revisión.',
        );
      if (baseRevision === undefined)
        baseRevision = knownRevision ?? (await adapter.loadState()).revision;
      const result = await operations.edit({
        baseRevision,
        operationId,
        command: { type: 'profile.replace', payload: profile },
      });
      if (result.status === 'applied') {
        knownRevision = result.revision;
        return result;
      }
      const message =
        result.status === 'conflict'
          ? 'La configuración cambió fuera de este formulario. Conserva tus cambios y carga la configuración actual antes de volver a guardarlos.'
          : result.message ||
            'No se pudo guardar con confirmación durable. Conserva el formulario y el identificador de operación; no repitas la modificación con otro identificador.';
      const error = Object.assign(new Error(`${message} Operación: ${operationId}`), {
        code: result.code || 'OUTCOME_UNKNOWN',
        operationId,
        result,
      });
      throw error;
    },
    watch(onChange) {
      if (typeof api.registerHook !== 'function') return;
      // Receipt keys emit the same hook; the UI compares profile revisions before rendering.
      try {
        Promise.resolve(
          api.registerHook('persistedDataChanged', () => onChange(false)),
        ).catch(() => {});
        for (const hook of ['anyTaskUpdate', 'currentTaskChange', 'projectListUpdate'])
          Promise.resolve(api.registerHook(hook, () => onChange(true))).catch(() => {});
      } catch {
        /* Polling still reloads external changes. */
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
      let calendar = { calendarEvents: [], calendarWarnings: [] };
      try {
        if (typeof api.plannerOperation !== 'function')
          throw Error('calendar API missing');
        calendar = await call('plannerOperation', ['calendar_snapshot', {}]);
        if (!Array.isArray(calendar?.calendarEvents))
          throw Error('calendar result missing');
      } catch {
        calendar = {
          calendarEvents: [],
          calendarWarnings: ['Calendarios nativos no disponibles; capacidad parcial.'],
        };
      }
      warnings.push(...(calendar.calendarWarnings || []));
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
      return {
        ...snapshot,
        calendarEvents: calendar.calendarEvents,
        calendarWarnings: calendar.calendarWarnings || [],
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
  return adapter;
}
