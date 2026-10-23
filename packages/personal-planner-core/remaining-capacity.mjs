import { availability, subtract } from './schedule.mjs';

/** Time still free after `now`. Date-only estimates remain unassigned durations,
 * never guessed intervals. The same projection serves Today and MCP queries. */
export function remainingCapacity(profile, snapshot, day, now = Date.now()) {
  if (!Number.isFinite(now)) throw Error('Instante de consulta inválido.');
  const capacity = availability(profile, day, snapshot);
  const from = Math.max(capacity.start, Math.min(capacity.end, now));
  const intervals = [];
  let unslottedTaskMinutes = 0;
  let unknownEstimates = 0;
  for (const task of snapshot.leaves) {
    if (task.isDone || task.archived) continue;
    const duration = Math.max(0, (task.timeEstimate || 0) - (task.timeSpent || 0));
    let start = null;
    for (const ancestor of snapshot.chain(task)) {
      if (ancestor.dueWithTime) {
        start = ancestor.dueWithTime;
        break;
      }
      if (ancestor.dueDay) break;
    }
    if (start && duration) intervals.push([start, start + duration]);
    else if (snapshot.plannedDay(task) === day) {
      if (duration) unslottedTaskMinutes += duration / 60000;
      else if (!task.timeEstimate) unknownEstimates++;
    }
  }
  const clip = (windows) =>
    subtract(windows, intervals)
      .map(([start, end]) => [Math.max(start, from), end])
      .filter(([start, end]) => end > start);
  const workFree = clip(capacity.workFree);
  const personalFree = clip(capacity.personalFree);
  const minutes = (windows) =>
    windows.reduce((sum, [start, end]) => sum + (end - start) / 60000, 0);
  return {
    date: day,
    from,
    to: capacity.end,
    workMinutes: minutes(workFree),
    personalMinutes: minutes(personalFree),
    workFree,
    personalFree,
    unslottedTaskMinutes,
    partial: capacity.partial || unknownEstimates > 0,
    warnings: [
      ...capacity.warnings,
      ...(unknownEstimates
        ? ['Hay tareas sin estimación; no se conoce toda la carga pendiente de asignar.']
        : []),
    ],
  };
}
