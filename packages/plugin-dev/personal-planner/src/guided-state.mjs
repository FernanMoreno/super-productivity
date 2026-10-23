import { areaMetrics } from './metrics.mjs';
import { wallClock } from './i18n.mjs';
import { instant, addDays, localDay } from './schedule.mjs';
export const confirmed = (result) =>
  ['applied', 'rejected', 'conflict'].includes(result?.status);
export function pendingOperation(action, params, operationId) {
  return {
    action,
    operationId,
    phase: 'pending',
    createdAt: Date.now(),
    params: structuredClone(params),
  };
}
export function proposalChanges(form, proposal, timezone) {
  return proposal.proposals
    .filter((p) => p.interval)
    .map((p) => {
      const originalDate = p.date || localDay(p.interval[0], timezone);
      const originalStart = wallClock(p.interval[0], timezone),
        originalEnd = wallClock(p.interval[1], timezone);
      const date = String(form.get('date:' + p.id) || originalDate);
      const startTime = String(form.get('start:' + p.id) || originalStart);
      const endTime = String(form.get('end:' + p.id) || originalEnd);
      if (date === originalDate && startTime === originalStart && endTime === originalEnd)
        return null;
      const start = instant(date, startTime, timezone);
      const end = instant(
        endTime <= startTime ? addDays(date, 1) : date,
        endTime,
        timezone,
      );
      if (!(end > start)) throw Error('Intervalo inválido.');
      return { itemId: p.id, start, end };
    })
    .filter(Boolean);
}
export const operationError = (result) =>
  result?.message || result?.code || 'Operación no confirmada.';

export function taskDailyMinutes(snapshot, task, day) {
  if (!snapshot.civilDaysReliable) return null;
  return areaMetrics(
    { ...snapshot, leaves: [task], hasIncompleteTasks: false, matches: () => true },
    { projectIds: [], tagIds: [] },
    day,
  ).dailyMinutes;
}
