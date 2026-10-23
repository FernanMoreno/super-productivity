import { areaGoalsOn, areaStateOn, areaCompletionOn, validDate } from './model.mjs';
import { localDay, weekDays, addDays, availability, restricted } from './schedule.mjs';
export function taskSnapshot(active, archived) {
  const byId = new Map();
  for (const [list, isArchive] of [
    [archived, true],
    [active, false],
  ])
    for (const t of list) byId.set(t.id, { ...t, archived: isArchive });
  const warnings = [];
  const leaves = [...byId.values()].filter((t) => {
    if (!t.subTaskIds?.length) return true;
    if (t.subTaskIds.some((id) => !byId.has(id)))
      warnings.push(`Subtareas no disponibles de «${t.title}»; totales parciales.`);
    return false;
  });
  const chain = (t) => {
    const out = [],
      seen = new Set();
    while (t && !seen.has(t.id)) {
      out.push(t);
      seen.add(t.id);
      t = byId.get(t.parentId);
    }
    return out;
  };
  const matches = (t, a) =>
    chain(t).some(
      (v) =>
        a.projectIds.includes(v.projectId) ||
        v.tagIds?.some((id) => a.tagIds.includes(id)),
    );
  const snapshot = {
    byId,
    leaves,
    warnings,
    hasIncompleteTasks: warnings.length > 0,
    matches,
    chain,
  };
  snapshot.dailyForArea = (area, day) => areaMetrics(snapshot, area, day).dailyMinutes;
  snapshot.plannedDay = (task) => scheduledDay(task, snapshot);
  return snapshot;
}
export function scheduledDay(t, snapshot) {
  for (const item of snapshot.chain(t))
    if (item.dueDay || item.dueWithTime)
      return item.dueWithTime
        ? localDay(item.dueWithTime, snapshot.timezone)
        : item.dueDay;
  return null;
}
export function areaMetrics(snapshot, area, day) {
  const tasks = snapshot.leaves.filter((t) => snapshot.matches(t, area));
  const days = weekDays(day, snapshot.weekStartsOn ?? 1),
    daily = Object.fromEntries(days.map((d) => [d, 0]));
  let total = 0,
    unknown = false;
  for (const t of tasks) {
    total += t.timeSpent || 0;
    if (!t.timeSpentOnDay && t.timeSpent > 0) unknown = true;
    if (
      Math.abs(
        Object.values(t.timeSpentOnDay || {}).reduce((s, v) => s + v, 0) -
          (t.timeSpent || 0),
      ) > 1
    )
      unknown = true;
    for (const date of days) daily[date] += (t.timeSpentOnDay?.[date] || 0) / 60000;
  }
  const incomplete = snapshot.hasIncompleteTasks || unknown;
  const pending = tasks.filter((t) => !t.isDone && !t.archived);
  return {
    tasks,
    pending,
    totalMinutes: total / 60000,
    dailyMinutes: incomplete ? null : (daily[day] ?? 0),
    daily: incomplete ? null : daily,
    weeklyMinutes: incomplete ? null : Object.values(daily).reduce((s, v) => s + v, 0),
    incomplete,
    plannedMinutes: pending
      .filter((t) => days.includes(scheduledDay(t, snapshot)))
      .reduce((s, t) => s + (t.timeEstimate || 0) / 60000, 0),
    completed: tasks.filter((t) => t.isDone).length,
  };
}

/** Union of stable associations across an activity tree; each task is still counted once. */
export function effectiveArea(profile, area) {
  const included = [area],
    ids = new Set([area.id]);
  for (let i = 0; i < included.length; i++)
    for (const child of profile.areas.filter((a) => a.parentAreaId === included[i].id))
      if (!ids.has(child.id)) {
        included.push(child);
        ids.add(child.id);
      }
  return {
    ...area,
    projectIds: [...new Set(included.flatMap((a) => a.projectIds))],
    tagIds: [...new Set(included.flatMap((a) => a.tagIds))],
  };
}

/** A deadline is a pacing aid, never evidence of course completion. */
export function goalPace(profile, snapshot, area, day, goal = {}) {
  const dueDate = goal.date || area.dueDate,
    hours = goal.hours ?? areaGoalsOn(area, day).targetHours;
  const out = {
    dueDate: dueDate || null,
    remainingMinutes: null,
    daysRemaining: null,
    requiredMinutesPerDay: null,
    availableMinutes: null,
    partial: true,
    warnings: [],
    status: 'unconfigured',
  };
  if (!validDate(dueDate) || hours == null) return out;
  if (!validDate(day) || !Number.isFinite(hours) || hours < 0)
    return {
      ...out,
      status: 'unknown',
      warnings: ['Falta una fecha u objetivo numérico válido.'],
    };
  if (dueDate < day)
    return {
      ...out,
      status: 'past',
      daysRemaining: 0,
      warnings: ['La fecha objetivo ya ha pasado; conserva el dato y revísalo.'],
    };
  const mapped = effectiveArea(profile, area),
    metrics = areaMetrics(snapshot, mapped, day);
  out.daysRemaining =
    Math.round(
      (Date.parse(dueDate + 'T12:00Z') - Date.parse(day + 'T12:00Z')) / 86400000,
    ) + 1;
  if ((!mapped.projectIds.length && !mapped.tagIds.length) || metrics.incomplete)
    return {
      ...out,
      status: 'unknown',
      warnings: ['Faltan asociaciones o registros completos para calcular el ritmo.'],
    };
  out.remainingMinutes = Math.max(0, hours * 60 - metrics.totalMinutes);
  out.requiredMinutesPerDay = out.remainingMinutes / out.daysRemaining;
  out.status = 'configured';
  if (out.daysRemaining > 366)
    return {
      ...out,
      warnings: ['Capacidad no calculada para horizontes de más de 366 días.'],
    };
  out.availableMinutes = 0;
  out.partial = false;
  for (let date = day; date <= dueDate; date = addDays(date, 1)) {
    const capacity = availability(profile, date, snapshot);
    out.partial ||= capacity.partial;
    if (
      areaStateOn(area, date) !== 'active' ||
      areaCompletionOn(area, date) === 'completed' ||
      profile.trainingExclusions.some(
        (e) => e.areaId === area.id && date >= e.start && date <= e.end,
      )
    )
      continue;
    try {
      const free = restricted(
        area.workTime ? capacity.workFree : capacity.personalFree,
        area,
        date,
        profile.timezone,
      );
      out.availableMinutes += free.reduce((total, [s, e]) => total + (e - s) / 60000, 0);
    } catch (error) {
      out.partial = true;
      out.warnings.push(error.message);
    }
  }
  if (out.partial)
    out.warnings.push(
      'La disponibilidad es parcial; el ritmo no garantiza que el objetivo sea viable.',
    );
  return out;
}
