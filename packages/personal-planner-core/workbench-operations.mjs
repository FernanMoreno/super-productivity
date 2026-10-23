import { validDate } from './model.mjs';
import { localDay, weekDays } from './schedule.mjs';
import {
  emptyWorkbench,
  nextActions,
  capturePlan,
  weeklyRows,
  observePlan,
  reviewIssues,
  unallocatedRecordedTaskIds,
} from './workbench.mjs';

export const WORKBENCH_KEY = 'workbench-v1';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const decisions = new Set([
  'keep',
  'reschedule',
  'split',
  'pause',
  'archive',
  'correct_time',
]);
const states = new Set(['active', 'paused', 'blocked']);

export function createWorkbenchOperations({
  ports,
  load,
  authorize,
  journal,
  range,
  revision,
  contextRevision,
  PlannerError,
}) {
  const error = (code, message) => new PlannerError(code, message);
  const ensure = (ok, message) => {
    if (!ok) throw error('INVALID_ARGUMENTS', message);
  };
  const decode = (raw) => {
    if (raw === null) return emptyWorkbench();
    let state;
    try {
      state = JSON.parse(raw);
      if (
        !record(state) ||
        state.schemaVersion !== 1 ||
        state.action !== 'review_advance' ||
        ['baselines', 'sessions', 'taskMeta', 'observations', 'preferences'].some(
          (k) => !record(state[k]),
        )
      )
        throw Error();
      if (
        state.preferences.contextAreaId !== null &&
        state.preferences.contextAreaId !== undefined &&
        typeof state.preferences.contextAreaId !== 'string'
      )
        throw Error();
      const available = state.preferences.availableMinutes;
      if (
        available !== null &&
        available !== undefined &&
        (!Number.isFinite(available) || available <= 0 || available > 1440)
      )
        throw Error();
      for (const b of Object.values(state.baselines))
        if (
          !record(b) ||
          typeof b.id !== 'string' ||
          !validDate(b.from) ||
          !validDate(b.to) ||
          b.from > b.to ||
          !Number.isFinite(b.capturedAt) ||
          (b.timezone !== undefined && typeof b.timezone !== 'string') ||
          (b.days !== undefined &&
            (!record(b.days) ||
              Object.entries(b.days).some(
                ([date, d]) =>
                  !validDate(date) ||
                  !record(d) ||
                  !Number.isFinite(d.capturedAt) ||
                  !['captured', 'unknown-before-capture'].includes(d.provenance) ||
                  (d.timezone !== undefined && typeof d.timezone !== 'string'),
              ))) ||
          !Array.isArray(b.rows) ||
          b.rows.some(
            (r) =>
              !record(r) ||
              typeof r.taskId !== 'string' ||
              typeof r.title !== 'string' ||
              !validDate(r.date) ||
              (r.provenance !== undefined &&
                !['captured', 'unknown-before-capture'].includes(r.provenance)) ||
              (r.plannedMs !== null &&
                (!Number.isSafeInteger(r.plannedMs) || r.plannedMs < 0)),
          )
        )
          throw Error();
      for (const s of Object.values(state.sessions))
        if (
          !record(s) ||
          typeof s.id !== 'string' ||
          !validDate(s.from) ||
          !validDate(s.to) ||
          !Array.isArray(s.items) ||
          s.items.some((i) => !record(i) || typeof i.id !== 'string') ||
          !record(s.decisions) ||
          Object.values(s.decisions).some(
            (d) =>
              !record(d) || !decisions.has(d.decision) || !Number.isFinite(d.reviewedAt),
          ) ||
          !Number.isFinite(s.startedAt) ||
          (s.reviewedAt !== null && !Number.isFinite(s.reviewedAt))
        )
          throw Error();
      for (const m of Object.values(state.taskMeta))
        if (!record(m) || !states.has(m.state) || !Number.isFinite(m.updatedAt))
          throw Error();
      for (const o of Object.values(state.observations))
        if (
          !record(o) ||
          !Number.isFinite(o.firstObservedAt) ||
          !Number.isSafeInteger(o.postponements) ||
          o.postponements < 0 ||
          (o.lastPlannedDay !== null && !validDate(o.lastPlannedDay))
        )
          throw Error();
      return state;
    } catch {
      throw error(
        'DATA_CORRUPT',
        'La revisión guardada no es válida. No se han reemplazado sus datos.',
      );
    }
  };
  const read = async () => {
    const raw = await ports.read(WORKBENCH_KEY);
    return { raw, state: decode(raw), revision: await revision(raw) };
  };
  const datesFor = (args, p) => {
    if (args.from !== undefined || args.to !== undefined)
      return range(args.from, args.to);
    return weekDays(localDay(Date.now(), p.timezone), p.weekStartsOn);
  };
  const snapshotGuard = (snapshot) => {
    if (typeof snapshot.assertCurrent !== 'function')
      throw error(
        'DATA_UNAVAILABLE',
        'El anfitrión no puede verificar los cambios antes de guardar.',
      );
    return snapshot.assertCurrent;
  };
  const commit = async (current, next, snapshot, action = 'review_advance') => {
    await authorize(action);
    if ((await load()).raw !== current.profileRaw)
      return {
        status: 'conflict',
        code: 'STALE_DATA',
        message: 'La configuración cambió antes de guardar la revisión.',
      };
    const guard = snapshotGuard(snapshot);
    if (
      !(await ports.cas(WORKBENCH_KEY, current.raw, JSON.stringify(next), guard, action))
    )
      return {
        status: 'conflict',
        code: 'STALE_DATA',
        message: 'La revisión cambió. Recarga antes de continuar.',
      };
    return { status: 'applied', revision: await revision(JSON.stringify(next)) };
  };
  const dailyBaseline = (state, dates, fallback = null) => {
    const rows = [],
      days = {},
      sources = Object.values(state.baselines),
      used = [];
    for (const date of dates) {
      const source = sources
        .filter((b) => b.from <= date && b.to >= date)
        .sort(
          (a, b) =>
            (a.days?.[date]?.capturedAt ?? a.capturedAt) -
            (b.days?.[date]?.capturedAt ?? b.capturedAt),
        )[0];
      if (source) {
        used.push(source);
        days[date] = source.days?.[date] || {
          capturedAt: source.capturedAt,
          provenance:
            source.rows.find((r) => r.date === date)?.provenance ||
            'unknown-before-capture',
        };
        rows.push(...source.rows.filter((r) => r.date === date));
      } else if (fallback) {
        days[date] = fallback.days[date];
        rows.push(...fallback.rows.filter((r) => r.date === date));
      } else days[date] = { capturedAt: null, provenance: 'unknown-before-capture' };
    }
    if (!used.length && !fallback) return null;
    return {
      ...(fallback || used[0]),
      id: fallback?.id || `view-${dates[0]}-${dates.at(-1)}`,
      from: dates[0],
      to: dates.at(-1),
      rows,
      days,
    };
  };
  const capture = (state, profile, snapshot, dates, now) => {
    const next = observePlan(state, snapshot, now),
      key = `${dates[0]}..${dates.at(-1)}`;
    if (!Object.hasOwn(next.baselines, key))
      next.baselines = {
        ...next.baselines,
        [key]: dailyBaseline(next, dates, capturePlan(profile, snapshot, dates, now)),
      };
    return { state: next, baseline: next.baselines[key] };
  };
  const api = {
    async next(args = {}) {
      await authorize('next');
      const current = await load(),
        work = await read();
      if (args.date !== undefined) ensure(validDate(args.date), 'Fecha inválida.');
      if (args.now !== undefined) ensure(Number.isFinite(args.now), 'Instante inválido.');
      if (args.availableMinutes !== undefined)
        ensure(
          Number.isFinite(args.availableMinutes) &&
            args.availableMinutes > 0 &&
            args.availableMinutes <= 1440,
          'Minutos disponibles inválidos.',
        );
      if (args.limit !== undefined)
        ensure(
          Number.isInteger(args.limit) && args.limit >= 1 && args.limit <= 3,
          'El límite debe estar entre 1 y 3.',
        );
      if (args.contextAreaId !== undefined)
        ensure(
          args.contextAreaId === null ||
            current.profile.areas.some((a) => a.id === args.contextAreaId),
          'Contexto no encontrado.',
        );
      const snapshot = await ports.snapshot(current.profile),
        result = nextActions(current.profile, snapshot, work.state, args);
      await authorize('next');
      return { ...result, revision: work.revision, profileRevision: current.revision };
    },
    async review(args) {
      await authorize('review');
      const current = await load(),
        dates = datesFor(args, current.profile),
        work = await read(),
        snapshot = await ports.snapshot(current.profile);
      const baseline =
        work.state.baselines[`${dates[0]}..${dates.at(-1)}`] ||
        dailyBaseline(work.state, dates);
      const session = args.reviewId
        ? work.state.sessions[args.reviewId]
        : Object.values(work.state.sessions)
            .filter(
              (s) =>
                s.from === dates[0] && s.to === dates.at(-1) && s.reviewedAt === null,
            )
            .sort((a, b) => b.startedAt - a.startedAt)[0] || null;
      if (args.reviewId)
        ensure(
          session && session.from === dates[0] && session.to === dates.at(-1),
          'La revisión no corresponde a este intervalo.',
        );
      const rows = weeklyRows(current.profile, snapshot, baseline, dates);
      const unknownRecordedTaskIds = unallocatedRecordedTaskIds(snapshot, dates[0]);
      await authorize('review');
      return {
        revision: work.revision,
        profileRevision: current.revision,
        timezone: current.profile.timezone,
        baseline,
        baselineMissing:
          !baseline || dates.some((d) => baseline.days?.[d]?.capturedAt === null),
        rows,
        unknownRecordedTaskIds,
        issues: reviewIssues(
          current.profile,
          snapshot,
          work.state,
          dates,
          Date.now(),
          baseline,
        ),
        session: session || null,
        taskMeta: work.state.taskMeta,
        preferences: work.state.preferences,
        warnings: [
          ...(snapshot.warnings || []),
          ...(!baseline
            ? [
                'No hay plan previo capturado para este intervalo; no se inventa una planificación histórica.',
              ]
            : []),
          ...(rows.some((r) => r.actualIncluded !== false && r.actualMs === null)
            ? [
                'Hay duraciones diarias desconocidas o zonas horarias distintas; no se inventan registros.',
              ]
            : []),
          ...(unknownRecordedTaskIds.length
            ? [
                'Hay tareas con duración registrada que no se puede distribuir con fiabilidad entre días; no se inventan filas ni ceros.',
              ]
            : []),
        ],
        actualReliable:
          snapshot.civilDaysReliable !== false &&
          unknownRecordedTaskIds.length === 0 &&
          rows.every((r) => r.actualIncluded === false || r.actualMs !== null),
      };
    },
    async captureBaseline(args = {}) {
      await authorize('review_advance');
      const current = await load(),
        dates = datesFor(args, current.profile),
        work = await read(),
        snapshot = await ports.snapshot(current.profile);
      const captured = capture(work.state, current.profile, snapshot, dates, Date.now());
      const result = await commit(
        { ...work, profileRaw: current.raw },
        captured.state,
        snapshot,
      );
      return {
        ...result,
        ...(result.status === 'applied' ? { baselineId: captured.baseline.id } : {}),
      };
    },
    async reviewAdvance(args) {
      return journal('review_advance', args, async () => {
        await authorize('review_advance');
        const current = await load(),
          work = await read();
        if (args.expectedRevision !== work.revision)
          return { status: 'conflict', code: 'STALE_DATA', revision: work.revision };
        const snapshot = await ports.snapshot(current.profile),
          now = Date.now();
        let next = observePlan(work.state, snapshot, now),
          reviewId;
        if (args.command === 'start') {
          const dates = range(args.from, args.to),
            captured = capture(next, current.profile, snapshot, dates, now);
          next = captured.state;
          reviewId = crypto.randomUUID();
          const session = {
            id: reviewId,
            from: dates[0],
            to: dates.at(-1),
            startedAt: now,
            baselineId: captured.baseline.id,
            items: reviewIssues(
              current.profile,
              snapshot,
              next,
              dates,
              now,
              captured.baseline,
            ),
            decisions: {},
            reviewedAt: null,
          };
          next.sessions = { ...next.sessions, [reviewId]: session };
        } else if (args.command === 'decide' || args.command === 'finish') {
          reviewId = args.reviewId;
          ensure(
            typeof reviewId === 'string' && Object.hasOwn(next.sessions, reviewId),
            'Revisión no encontrada.',
          );
          const session = structuredClone(next.sessions[reviewId]);
          ensure(session.reviewedAt === null, 'La revisión ya está terminada.');
          if (args.command === 'decide') {
            ensure(
              session.items.some((i) => i.id === args.itemId) &&
                decisions.has(args.decision),
              'Elemento o decisión inválidos.',
            );
            session.decisions = {
              ...session.decisions,
              [args.itemId]: { decision: args.decision, reviewedAt: now },
            };
          } else {
            ensure(
              session.items.every((i) => Object.hasOwn(session.decisions, i.id)),
              'Quedan elementos sin revisar.',
            );
            session.reviewedAt = now;
          }
          next.sessions = { ...next.sessions, [reviewId]: session };
        } else if (args.command === 'task_state') {
          ensure(
            typeof args.taskId === 'string' &&
              snapshot.byId.has(args.taskId) &&
              states.has(args.taskState),
            'Tarea o estado inválidos.',
          );
          next.taskMeta = {
            ...next.taskMeta,
            [args.taskId]: { state: args.taskState, updatedAt: now },
          };
        } else if (args.command === 'preferences') {
          const p = args.preferences;
          ensure(
            record(p) &&
              Object.keys(p).every((k) =>
                ['contextAreaId', 'availableMinutes'].includes(k),
              ),
            'Preferencias inválidas.',
          );
          if (p.contextAreaId !== undefined)
            ensure(
              p.contextAreaId === null ||
                current.profile.areas.some((a) => a.id === p.contextAreaId),
              'Contexto no encontrado.',
            );
          if (p.availableMinutes !== undefined)
            ensure(
              p.availableMinutes === null ||
                (Number.isFinite(p.availableMinutes) &&
                  p.availableMinutes > 0 &&
                  p.availableMinutes <= 1440),
              'Duración inválida.',
            );
          next.preferences = { ...next.preferences, ...p };
        } else throw error('INVALID_ARGUMENTS', 'Comando de revisión no disponible.');
        const result = await commit({ ...work, profileRaw: current.raw }, next, snapshot);
        return { ...result, ...(reviewId ? { reviewId } : {}) };
      });
    },
    async correctTime(args) {
      return journal('correct_time', args, async () => {
        await authorize('correct_time');
        ensure(
          typeof args.taskId === 'string' &&
            typeof args.activityId === 'string' &&
            validDate(args.date),
          'Faltan tarea, actividad o fecha válidas.',
        );
        for (const key of ['durationMs', 'expectedDurationMs'])
          ensure(
            Number.isSafeInteger(args[key]) && args[key] >= 0 && args[key] <= 86400000,
            'La duración debe ser un total de milisegundos entre 0 y 24 horas.',
          );
        const current = await load(),
          snapshot = await ports.snapshot(current.profile),
          guard = snapshotGuard(snapshot);
        if (snapshot.civilDaysReliable === false)
          throw error(
            'UNSUPPORTED_OPERATION',
            'El calendario civil del anfitrión no permite corregir duraciones diarias con fiabilidad.',
          );
        if ((await load()).raw !== current.raw)
          throw error('STALE_DATA', 'La configuración cambió antes de corregir tiempo.');
        guard();
        await authorize('correct_time');
        return ports.native(
          'correct_time',
          { ...args, assertCurrent: guard },
          current.profile,
        );
      });
    },
  };
  return api;
}
