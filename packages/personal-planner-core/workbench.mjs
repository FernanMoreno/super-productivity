import { areaGoalsOn, areaStateOn } from './model.mjs';
import { effectiveArea, areaMetrics } from './metrics.mjs';
import {
  availability,
  subtract,
  restricted,
  instant,
  addDays,
  localDay,
  weekDays,
} from './schedule.mjs';

const MS = 60000;
const pending = (s) => s.leaves.filter((t) => !t.isDone && !t.archived);
const remaining = (t) => Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0));
const linked = (p, s, t) => p.areas.filter((a) => s.matches(t, effectiveArea(p, a)));
const mostSpecific = (profile, areas) => {
  const ancestorOf = (ancestor, area) => {
    const seen = new Set();
    while (area?.parentAreaId && !seen.has(area.id)) {
      seen.add(area.id);
      if (area.parentAreaId === ancestor.id) return true;
      area = profile.areas.find((a) => a.id === area.parentAreaId);
    }
    return false;
  };
  return areas.filter((a) => !areas.some((other) => ancestorOf(a, other)));
};
const metaState = (s, w, t) =>
  s
    .chain(t)
    .map((a) =>
      s.workflowBlockedTaskIds?.includes(a.id) ? 'blocked' : w.taskMeta[a.id]?.state,
    )
    .find((state) => ['blocked', 'paused'].includes(state)) || 'active';
const taskTime = (s, t) => {
  for (const item of s.chain(t)) {
    if (item.dueWithTime) return item.dueWithTime;
    if (item.dueDay) return null;
  }
  return null;
};
const taskDue = (s, t) =>
  s.chain(t).find((a) => a.deadlineDay || a.deadlineWithTime) || t;
const knownActual = (s, t, day) => {
  if (!t || s.civilDaysReliable === false || s.hasIncompleteTasks) return null;
  const values = t.timeSpentOnDay;
  if (!values && (t.timeSpent || 0) > 0) return null;
  if (
    Math.abs(
      Object.values(values || {}).reduce((sum, value) => sum + value, 0) -
        (t.timeSpent || 0),
    ) > 1
  )
    return null;
  const value = values?.[day] ?? 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
export const unallocatedRecordedTaskIds = (snapshot, date) =>
  snapshot.leaves
    .filter(
      (task) => (task.timeSpent || 0) > 0 && knownActual(snapshot, task, date) === null,
    )
    .map((task) => task.id)
    .sort();
export function emptyWorkbench() {
  return {
    schemaVersion: 1,
    action: 'review_advance',
    baselines: {},
    sessions: {},
    taskMeta: {},
    observations: {},
    preferences: { contextAreaId: null, availableMinutes: null },
  };
}
export function capturePlan(profile, snapshot, dates, capturedAt = Date.now()) {
  return {
    id: crypto.randomUUID(),
    from: dates[0],
    to: dates.at(-1),
    capturedAt,
    timezone: profile.timezone,
    provenance: 'captured',
    days: Object.fromEntries(
      dates.map((date) => [
        date,
        {
          capturedAt,
          timezone: profile.timezone,
          provenance:
            date < localDay(capturedAt, profile.timezone)
              ? 'unknown-before-capture'
              : 'captured',
          ...(snapshot.civilDaysReliable === false ? { missing: 'civil_calendar' } : {}),
        },
      ]),
    ),
    rows: snapshot.leaves.flatMap((t) =>
      dates
        .filter((day) => snapshot.plannedDay(t) === day)
        .map((date) => ({
          taskId: t.id,
          title: t.title,
          date,
          plannedMs:
            snapshot.civilDaysReliable === false ||
            date < localDay(capturedAt, profile.timezone)
              ? null
              : Math.max(0, t.timeEstimate || 0),
          provenance:
            date < localDay(capturedAt, profile.timezone)
              ? 'unknown-before-capture'
              : 'captured',
          activityIds: linked(profile, snapshot, t).map((a) => a.id),
        })),
    ),
  };
}
export function weeklyRows(profile, snapshot, baseline, dates) {
  const planned = new Map(
    (baseline?.rows || []).map((row) => [`${row.taskId}:${row.date}`, row]),
  );
  const taskIds = new Set([
    ...snapshot.leaves.map((t) => t.id),
    ...(baseline?.rows || []).map((r) => r.taskId),
  ]);
  const rows = [];
  for (const taskId of taskIds)
    for (const date of dates) {
      const t = snapshot.byId.get(taskId),
        before = planned.get(`${taskId}:${date}`);
      // A former leaf keeps its captured forecast after a split. Its current
      // aggregate duration is excluded: only child leaves contribute actual time.
      const aggregate = !!t?.subTaskIds?.length;
      if (aggregate && !before) continue;
      const baselineZone = baseline?.days?.[date]?.timezone || baseline?.timezone;
      const zoneChanged = baselineZone && baselineZone !== profile.timezone;
      const historicalMissing = baseline?.days?.[date]?.missing;
      const actualMs =
        aggregate || zoneChanged || historicalMissing
          ? null
          : knownActual(snapshot, t, date);
      if (!before && !actualMs && snapshot.plannedDay(t || { id: taskId }) !== date)
        continue;
      const provenance =
        before?.provenance ||
        baseline?.days?.[date]?.provenance ||
        (baseline && date >= localDay(baseline.capturedAt, profile.timezone)
          ? 'captured'
          : 'unknown-before-capture');
      rows.push({
        taskId,
        title: t?.title ?? before?.title ?? taskId,
        date,
        plannedMs:
          provenance === 'unknown-before-capture' || baseline?.days?.[date]?.missing
            ? null
            : before
              ? before.plannedMs
              : 0,
        provenance,
        actualMs,
        ...(aggregate ? { aggregate: true, actualIncluded: false } : {}),
        ...(actualMs === null
          ? {
              missing: aggregate
                ? 'aggregate_actual_in_children'
                : zoneChanged
                  ? 'timezone_changed'
                  : historicalMissing || 'daily_time',
            }
          : {}),
        archived: !!t?.archived,
        available: !!t,
        activityIds: t
          ? linked(profile, snapshot, t).map((a) => a.id)
          : before?.activityIds || [],
      });
    }
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.taskId.localeCompare(b.taskId),
  );
}
export function observePlan(state, snapshot, now = Date.now()) {
  const next = structuredClone(state);
  for (const t of pending(snapshot)) {
    const date = snapshot.plannedDay(t),
      prior = Object.hasOwn(next.observations, t.id) ? next.observations[t.id] : null;
    next.observations = {
      ...next.observations,
      [t.id]: {
        firstObservedAt: prior?.firstObservedAt ?? now,
        lastObservedAt: now,
        lastPlannedDay: date,
        postponements:
          (prior?.postponements || 0) +
          (prior?.lastPlannedDay && date && date > prior.lastPlannedDay ? 1 : 0),
      },
    };
  }
  return next;
}
export function reviewIssues(
  profile,
  snapshot,
  state,
  dates,
  now = Date.now(),
  baseline = null,
) {
  const issues = [],
    today = localDay(now, profile.timezone),
    tasks = pending(snapshot);
  const issueIds = new Set();
  const add = (kind, id, message, extra = {}) => {
    const key = `${kind}:${id}`;
    if (issueIds.has(key)) return;
    issueIds.add(key);
    issues.push({ id: key, kind, message, ...extra });
  };
  for (const t of tasks) {
    if (!linked(profile, snapshot, t).length)
      add(
        'unclassified',
        t.id,
        'Tarea sin actividad vinculada; asígnala o manténla sin clasificar.',
        { taskId: t.id },
      );
    const observed = state.observations[t.id];
    if (observed?.postponements >= 2)
      add(
        'repeated_postponement',
        t.id,
        `Se han observado ${observed.postponements} aplazamientos desde el primer registro del planificador.`,
        {
          taskId: t.id,
          count: observed.postponements,
          observedSince: observed.firstObservedAt,
        },
      );
  }
  for (const row of weeklyRows(profile, snapshot, baseline, dates))
    if (row.date < today && row.plannedMs > 0 && row.actualMs === 0)
      add(
        'planned_without_actual',
        `${row.taskId}:${row.date}`,
        'Había tiempo previsto y no hay duración registrada para ese día.',
        { taskId: row.taskId, date: row.date },
      );
  const projects = Array.isArray(snapshot.projects)
    ? snapshot.projects
    : Object.values(snapshot.projects || {});
  for (const p of projects.filter((p) => !p.isArchived && !p.archived))
    if (
      !tasks.some(
        (t) =>
          snapshot.chain(t).some((v) => v.projectId === p.id) &&
          metaState(snapshot, state, t) === 'active',
      )
    )
      add(
        'project_without_action',
        p.id,
        'El proyecto no tiene una próxima tarea activa; decide si añadirla, pausarlo o archivarlo.',
        { projectId: p.id },
      );
  for (const a of profile.areas)
    for (const date of dates.filter(
      (day) => day <= today && areaStateOn(a, day) === 'active',
    )) {
      const goals = areaGoalsOn(a, date),
        m = areaMetrics(snapshot, effectiveArea(profile, a), date);
      const mapped = effectiveArea(profile, a);
      if (
        (goals.dailyMinutes || goals.weeklyMinutes) &&
        !mapped.projectIds.length &&
        !mapped.tagIds.length
      ) {
        add(
          'goal_data_missing',
          `${a.id}:association`,
          'Vincula proyectos o etiquetas para poder calcular el progreso de este objetivo.',
          { activityId: a.id, missing: 'activity_association' },
        );
        continue;
      }
      if (
        (goals.dailyMinutes || goals.weeklyMinutes) &&
        (snapshot.civilDaysReliable === false || m.dailyMinutes === null)
      ) {
        add(
          'goal_data_missing',
          `${a.id}:daily-time`,
          'Los registros disponibles no permiten certificar el tiempo por día civil.',
          { activityId: a.id, missing: 'daily_time' },
        );
        continue;
      }
      if (
        goals.dailyMinutes > 0 &&
        snapshot.civilDaysReliable !== false &&
        m.dailyMinutes !== null &&
        m.dailyMinutes < goals.dailyMinutes
      )
        add(
          'goal_risk',
          `${a.id}:${date}`,
          'El objetivo diario todavía no está cubierto por tiempo registrado; revisa su viabilidad.',
          {
            activityId: a.id,
            date,
            remainingMinutes: goals.dailyMinutes - m.dailyMinutes,
          },
        );
      if (
        goals.weeklyMinutes > 0 &&
        date === weekDays(date, profile.weekStartsOn).at(-1) &&
        snapshot.civilDaysReliable !== false &&
        m.weeklyMinutes !== null &&
        m.weeklyMinutes < goals.weeklyMinutes
      )
        add(
          'goal_risk',
          `${a.id}:week:${date}`,
          'El objetivo semanal no está cubierto por tiempo registrado al cerrar la semana.',
          {
            activityId: a.id,
            date,
            goalPeriod: 'weekly',
            remainingMinutes: goals.weeklyMinutes - m.weeklyMinutes,
          },
        );
    }
  return issues;
}
export function nextActions(profile, snapshot, state, args = {}) {
  const now = args.now ?? Date.now(),
    date = args.date || localDay(now, profile.timezone);
  const capacity = availability(profile, date, snapshot);
  const availableMinutes = args.availableMinutes ?? state.preferences.availableMinutes;
  const contextAreaId = Object.hasOwn(args, 'contextAreaId')
    ? args.contextAreaId
    : state.preferences.contextAreaId;
  const dayStart = instant(date, '00:00', profile.timezone),
    dayEnd = instant(addDays(date, 1), '00:00', profile.timezone);
  const from = Math.max(dayStart, now),
    until = Math.min(dayEnd, availableMinutes ? from + availableMinutes * MS : dayEnd);
  const timed = pending(snapshot).flatMap((t) =>
    taskTime(snapshot, t)
      ? [
          {
            taskId: t.id,
            interval: [taskTime(snapshot, t), taskTime(snapshot, t) + remaining(t)],
          },
        ]
      : [],
  );
  const currentDay = date === localDay(now, profile.timezone);
  const bounded = (windows, taskId) =>
    subtract(
      windows,
      timed.filter((t) => t.taskId !== taskId).map((t) => t.interval),
    )
      .map(([s, e]) => [Math.max(s, from), Math.min(e, until)])
      .filter(([s, e]) => e > s);
  const alternatives = pending(snapshot)
    .map((t) => {
      const areas = mostSpecific(profile, linked(profile, snapshot, t)).sort(
        (a, b) =>
          (a.priority || 3) - (b.priority || 3) || (a.order || 0) - (b.order || 0),
      );
      const active = areas.filter((a) => areaStateOn(a, date) === 'active'),
        area = active[0] || areas[0];
      const scope = area?.workTime ? 'work' : 'personal',
        minutes = remaining(t) / MS,
        reasons = [];
      const context = contextAreaId
        ? profile.areas.find((a) => a.id === contextAreaId)
        : null;
      const stateName = metaState(snapshot, state, t);
      if (stateName === 'blocked') reasons.push('Tarea bloqueada manualmente.');
      if (stateName === 'paused') reasons.push('Tarea pausada manualmente.');
      if (areas.length && !active.length)
        reasons.push('La actividad está pausada, archivada o fuera de vigencia.');
      if (
        contextAreaId &&
        (!context || !snapshot.matches(t, effectiveArea(profile, context)))
      )
        reasons.push('No coincide con el contexto seleccionado.');
      if (!Number.isFinite(minutes) || minutes <= 0)
        reasons.push('Falta una estimación pendiente positiva.');
      let windows = bounded(
        capacity[scope === 'work' ? 'workFree' : 'personalFree'],
        t.id,
      );
      if (area)
        try {
          windows = restricted(windows, area, date, profile.timezone);
        } catch {
          windows = [];
          reasons.push(
            'La franja de actividad contiene una hora local ambigua o inexistente. Revisa su configuración.',
          );
        }
      const slot = windows.find(([s, e]) => e - s >= remaining(t));
      if (currentDay && slot && slot[0] !== from)
        reasons.push(
          'No cabe ahora; este hueco posterior es una propuesta revisable para otro momento.',
        );
      if (!slot)
        reasons.push(
          'No hay un hueco continuo suficiente respetando compromisos y márgenes.',
        );
      const viable = reasons.length === 0;
      const due = taskDue(snapshot, t),
        deadline = due.deadlineWithTime
          ? localDay(due.deadlineWithTime, profile.timezone)
          : due.deadlineDay;
      let score = 10 * (6 - (area?.priority || 3));
      if (viable) {
        reasons.push(
          `Cabe en un hueco ${scope === 'work' ? 'laboral' : 'personal'} de ${minutes} minutos.`,
        );
        reasons.push(`Prioridad ${area?.priority || 3} de la actividad.`);
        if (deadline) {
          reasons.push(`Vencimiento: ${deadline}.`);
          score += deadline <= date ? 100 : deadline <= addDays(date, 2) ? 50 : 0;
        }
        if (area && snapshot.civilDaysReliable !== false) {
          const goal = areaGoalsOn(area, date).dailyMinutes,
            actual = areaMetrics(
              snapshot,
              effectiveArea(profile, area),
              date,
            ).dailyMinutes;
          if (goal && actual !== null && actual < goal) {
            reasons.push('Ayuda a un objetivo diario pendiente.');
            score += 20;
          }
        }
        if (!areas.length)
          reasons.push(
            'Sin actividad vinculada; puedes clasificarla durante la revisión.',
          );
        if (capacity.partial)
          reasons.push(
            'Propuesta provisional: la disponibilidad todavía contiene datos pendientes.',
          );
      }
      return {
        taskId: t.id,
        title: t.title,
        activityId: area?.id ?? null,
        remainingMinutes: minutes,
        slot: slot ? { start: slot[0], end: slot[0] + remaining(t), scope } : null,
        viable,
        mode: currentDay ? 'now' : 'planned',
        reasons,
        score,
      };
    })
    .sort(
      (a, b) =>
        Number(b.viable) - Number(a.viable) ||
        b.score - a.score ||
        a.taskId.localeCompare(b.taskId),
    );
  const candidates = alternatives
    .filter((t) => t.viable)
    .slice(0, Math.min(3, args.limit || 3));
  return {
    date,
    candidates,
    alternatives: alternatives.slice(0, 50),
    alternativeCount: alternatives.length,
    emptyReason: candidates.length
      ? null
      : alternatives.length
        ? 'No hay tareas válidas con un hueco suficiente; revisa las alternativas o la configuración.'
        : 'No hay tareas pendientes. Crea una tarea o revisa tus proyectos.',
    warnings: [
      ...(snapshot.warnings || []),
      ...capacity.warnings,
      ...(capacity.partial
        ? [
            'Disponibilidad parcial: revisa sueño, desplazamientos, comidas, márgenes y datos pendientes.',
          ]
        : []),
    ],
    partial: capacity.partial,
  };
}
