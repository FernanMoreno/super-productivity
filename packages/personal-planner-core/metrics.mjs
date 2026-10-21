import { localDay, weekDays } from './schedule.mjs';
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
